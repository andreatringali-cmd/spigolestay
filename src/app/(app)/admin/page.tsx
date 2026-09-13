"use client";

// Back-office Xenora (super-admin) — visibile SOLO al titolare (email in ADMIN_EMAILS lato server).
// Elenca tutti gli utenti registrati con piano, strutture/camere, stato pagamento, scadenze e avvisi.
// I dati arrivano da /api/admin/overview (service_role lato server): il browser non vede mai le chiavi.

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { TIERS, ROOMS_PER_STRUCT } from "@/lib/plans";

interface Row {
  id: string; email: string | null; name: string; createdAt: string | null; lastSignIn: string | null;
  emailConfirmed: boolean; plan: string | null; structures: number; rooms: number; structureNames: string;
  stripeCustomerId: string | null; subStatus: string | null; periodEnd: string | null;
  cancelAtPeriodEnd: boolean; monthlyAmount: number | null; currency: string | null;
  invitedCount: number; referredByCode: string | null;
}
interface Alert { label: string; tone: "red" | "amber" | "info" }

const dmy = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso); if (isNaN(+d)) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const daysUntil = (iso: string | null) => { if (!iso) return null; const d = new Date(iso); if (isNaN(+d)) return null; return Math.round((+d - Date.now()) / 86400000); };
const tierOf = (plan: string | null) => TIERS.find((t) => t.key === (plan || "").toLowerCase());
const tierName = (plan: string | null) => tierOf(plan)?.name || (plan ? plan : "—");

function alertsFor(r: Row): Alert[] {
  const out: Alert[] = [];
  const s = (r.subStatus || "").toLowerCase();
  if (["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(s)) out.push({ label: "Pagamento fallito", tone: "red" });
  const t = tierOf(r.plan);
  if (t && r.structures > t.structures) out.push({ label: `Oltre limite strutture (${r.structures}/${t.structures})`, tone: "red" });
  if (!r.emailConfirmed) out.push({ label: "Email non confermata", tone: "amber" });
  if (r.cancelAtPeriodEnd) out.push({ label: "In disdetta", tone: "amber" });
  const du = daysUntil(r.periodEnd);
  if (!r.cancelAtPeriodEnd && (s === "active" || s === "trialing") && du != null && du >= 0 && du <= 7)
    out.push({ label: `Scade tra ${du}g`, tone: "amber" });
  if (t) { const inc = t.structures * ROOMS_PER_STRUCT; if (r.rooms > inc) out.push({ label: `Camere extra +${r.rooms - inc}`, tone: "info" }); }
  if (!r.plan) out.push({ label: "Nessun piano", tone: "info" });
  return out;
}

export default function AdminPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string>("");
  const [stripeOn, setStripeOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const { data: sess } = await (supabase?.auth.getSession() ?? Promise.resolve({ data: { session: null } }));
      const token = sess?.session?.access_token;
      if (!token) { setErr("no_session"); setLoading(false); return; }
      const res = await fetch("/api/admin/overview", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) { setErr("forbidden"); setLoading(false); return; }
      if (res.status === 503) { setErr("not_configured"); setLoading(false); return; }
      const d = await res.json();
      if (!res.ok) { setErr(d?.error || "error"); setLoading(false); return; }
      setRows(d.rows || []); setStripeOn(!!d.stripeConfigured);
    } catch { setErr("network"); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const kpi = useMemo(() => {
    const rs = rows || [];
    const active = rs.filter((r) => ["active", "trialing"].includes((r.subStatus || "").toLowerCase())).length;
    const mrr = rs.reduce((a, r) => a + (["active", "trialing"].includes((r.subStatus || "").toLowerCase()) ? (r.monthlyAmount || 0) : 0), 0);
    const attention = rs.filter((r) => alertsFor(r).some((a) => a.tone === "red")).length;
    const structures = rs.reduce((a, r) => a + (r.structures || 0), 0);
    const invited = rs.reduce((a, r) => a + (r.invitedCount || 0), 0);
    return { total: rs.length, active, mrr, attention, structures, invited };
  }, [rows]);

  const filtered = useMemo(() => {
    let rs = rows || [];
    const term = q.trim().toLowerCase();
    if (term) rs = rs.filter((r) => (r.email || "").toLowerCase().includes(term) || (r.name || "").toLowerCase().includes(term) || (r.structureNames || "").toLowerCase().includes(term));
    if (onlyAlerts) rs = rs.filter((r) => alertsFor(r).some((a) => a.tone === "red"));
    return rs;
  }, [rows, q, onlyAlerts]);

  const toneStyle = (tone: Alert["tone"]) => tone === "red"
    ? { backgroundColor: "color-mix(in srgb, var(--bad,#dc2626) 14%, transparent)", color: "var(--bad,#dc2626)" }
    : tone === "amber"
    ? { backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }
    : { backgroundColor: "var(--wash)", color: "var(--dim)" };

  if (err === "forbidden") return (
    <div><PageHeader title="Back-office" hideHelp /><Card><div className="py-6 text-center text-sm text-dim">🔒 Area riservata. Il tuo account non ha accesso al back-office.</div></Card></div>
  );
  if (err === "not_configured") return (
    <div><PageHeader title="Back-office" hideHelp />
      <Card><div className="space-y-2 text-sm text-dim">
        <div className="font-semibold text-txt">Back-office non ancora configurato</div>
        <p>Per attivarlo serve la chiave <code className="rounded bg-wash px-1">SUPABASE_SERVICE_ROLE_KEY</code> tra le variabili d&apos;ambiente su Vercel (usata solo lato server, mai nel browser). Opzionale: <code className="rounded bg-wash px-1">ADMIN_EMAILS</code> per elencare le email autorizzate.</p>
      </div></Card>
    </div>
  );

  const kpis = [
    { label: "Utenti registrati", value: kpi.total, hint: "Account totali" },
    { label: "Abbonati attivi", value: kpi.active, hint: stripeOn ? "active + in prova" : "Stripe non collegato" },
    { label: "MRR stimato", value: stripeOn ? `€ ${kpi.mrr.toFixed(0)}` : "—", hint: "Ricavo mensile ricorrente" },
    { label: "Da controllare", value: kpi.attention, hint: "Con avvisi critici", danger: kpi.attention > 0 },
    { label: "Strutture totali", value: kpi.structures, hint: "Su tutti gli account" },
    { label: "Inviti convertiti", value: kpi.invited, hint: "Referral collegati" },
  ] as { label: string; value: string | number; hint: string; danger?: boolean }[];

  return (
    <div>
      <PageHeader title="Back-office" subtitle="Monitoraggio utenti, piani, incassi e scadenze di Xenora" hideHelp
        actions={<button onClick={load} disabled={loading} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-60">{loading ? "Aggiorno…" : "↻ Aggiorna"}</button>}
      />

      {!stripeOn && !err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 12%, transparent)", color: "var(--dim)" }}>
          <span>Stripe non è collegato: stato pagamenti, MRR e scadenze non sono disponibili. Aggiungi <code className="rounded bg-wash px-1">STRIPE_SECRET_KEY</code> su Vercel per attivarli.</span>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-surface p-3 shadow-sm">
            <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{k.label}</div>
            <div className="mt-1 text-2xl font-bold tracking-tight" style={{ color: k.danger ? "var(--bad,#dc2626)" : "var(--txt)" }}>{k.value}</div>
            <div className="mt-0.5 text-[11px] text-faint">{k.hint}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per email, nome o struttura…" className="min-w-[200px] flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
        <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-dim">
          <input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} /> Solo da controllare
        </label>
      </div>

      <Card className="overflow-x-auto p-0">
        {loading ? (
          <div className="py-10 text-center text-sm text-faint">Carico i dati…</div>
        ) : err ? (
          <div className="py-10 text-center text-sm text-dim">Impossibile caricare i dati ({err}). <button onClick={load} className="underline">Riprova</button></div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-faint">Nessun utente trovato.</div>
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-3 py-2 font-semibold">Utente</th>
                <th className="px-3 py-2 font-semibold">Registrato</th>
                <th className="px-3 py-2 font-semibold">Piano</th>
                <th className="px-3 py-2 font-semibold">Strutture / Camere</th>
                <th className="px-3 py-2 font-semibold">Pagamento</th>
                <th className="px-3 py-2 font-semibold">Rinnovo</th>
                <th className="px-3 py-2 font-semibold">Inviti</th>
                <th className="px-3 py-2 font-semibold">Avvisi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const al = alertsFor(r);
                const ok = !al.some((a) => a.tone === "red");
                return (
                  <tr key={r.id} className="border-b border-line/60 align-top hover:bg-wash/50">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-txt">{r.name || "—"}</div>
                      <div className="text-[12px] text-dim">{r.email}</div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{dmy(r.createdAt)}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[12px] font-medium text-txt">{tierName(r.plan)}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{r.structures} · {r.rooms}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{r.subStatus ? <span className="text-dim">{r.subStatus}</span> : <span className="text-faint">—</span>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{dmy(r.periodEnd)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{r.invitedCount || "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {ok && <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" }}>✓ In regola</span>}
                        {al.map((a, i) => (<span key={i} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={toneStyle(a.tone)}>{a.label}</span>))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <div className="mt-3 text-[11px] text-faint">I dati di piano/strutture/camere si aggiornano quando l&apos;utente apre l&apos;app. Pagamenti e scadenze arrivano da Stripe in tempo reale.</div>
    </div>
  );
}
