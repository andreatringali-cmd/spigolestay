"use client";

// Scheda cliente (back-office) — pagina dedicata: anagrafica, abbonamento, strutture
// con camere/posti letto, membri divisi per struttura, storico pagamenti e note interne.
// Dati da /api/admin/account (service-role lato server, gate ADMIN_EMAILS).

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader, Card, StatCard } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { TIERS } from "@/lib/plans";

interface Member { id: string; name: string; email: string | null; phone: string | null }
interface Room { name: string; roomType: string; beds: number; bedConfig: string | null; size: number | null }
interface StructureD { id: string; name: string; city?: string; roomCount: number; bedCount: number; rooms: Room[]; members: Member[] }
interface Invoice { id: string; number: string | null; date: string | null; amount: number; currency: string; status: string | null; paid: boolean; pdf: string | null; hostedUrl: string | null; description: string | null }
interface AccountD {
  id: string; email: string | null; name: string; phone: string | null; createdAt: string | null; lastActive: string | null; emailConfirmed: boolean;
  plan: string | null; subStatus: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean; monthlyAmount: number | null; currency: string | null;
  totalPaid: number | null; amountDue: number | null; stripeCustomerId: string | null; structuresCount: number; roomsCount: number;
}
interface Data { ok: boolean; stripeConfigured: boolean; account: AccountD; structures: StructureD[]; membersOther: (Member & { structureName?: string })[]; invoices: Invoice[]; note: string; noteUpdatedAt: string | null }

const dmy = (iso: string | null) => { if (!iso) return "—"; const d = new Date(iso); if (isNaN(+d)) return "—"; return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };
const eur = (n: number | null | undefined, cur = "EUR") => n == null ? "—" : `${cur === "EUR" ? "€" : cur} ${n.toLocaleString("it-IT", { minimumFractionDigits: 2 })}`;
const tierOf = (plan: string | null) => TIERS.find((t) => t.key === (plan || "").toLowerCase());
const PLAN_COLOR: Record<string, string> = { basic: "#5E7C8B", pro: "#4F46E5", ultimate: "#C08A3A" };
const waLink = (phone: string | null) => { const d = (phone || "").replace(/[^\d]/g, ""); return d ? `https://wa.me/${d}` : ""; };

function PlanBadge({ plan }: { plan: string | null }) {
  const t = tierOf(plan); const c = PLAN_COLOR[(plan || "").toLowerCase()] || "var(--faint)";
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={t ? { backgroundColor: `color-mix(in srgb, ${c} 16%, transparent)`, color: c } : { backgroundColor: "var(--wash)", color: "var(--faint)" }}>{t?.name || plan || "—"}</span>;
}
function Contacts({ email, phone }: { email: string | null; phone: string | null }) {
  return (
    <div className="flex items-center gap-1.5">
      {email && <a href={`mailto:${email}`} className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">✉ Email</a>}
      {waLink(phone) && <a href={waLink(phone)} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: "#25D366" }}>WhatsApp</a>}
    </div>
  );
}

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<{ saving?: boolean; saved?: boolean }>({});

  const token = async () => (await (supabase?.auth.getSession() ?? Promise.resolve({ data: { session: null } }))).data.session?.access_token || "";

  useEffect(() => {
    (async () => {
      setLoading(true); setErr("");
      try {
        const t = await token();
        if (!t) { setErr("no_session"); setLoading(false); return; }
        const res = await fetch("/api/admin/account", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ userId: id }) });
        if (res.status === 403) { setErr("forbidden"); setLoading(false); return; }
        const j = await res.json();
        if (!res.ok || !j.ok) { setErr(j?.error || "error"); setLoading(false); return; }
        setD(j); setNote(j.note || "");
      } catch { setErr("network"); }
      setLoading(false);
    })();
  }, [id]);

  const saveNote = async () => {
    setNoteState({ saving: true });
    try { const t = await token(); await fetch("/api/admin/notes", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ action: "save", userId: id, note }) }); setNoteState({ saved: true }); }
    catch { setNoteState({}); }
  };

  if (loading) return <div className="p-6 text-sm text-faint">Carico la scheda…</div>;
  if (err === "forbidden") return <div className="p-6 text-sm text-dim">🔒 Area riservata.</div>;
  if (err || !d) return <div className="p-6 text-sm text-dim">Impossibile caricare la scheda ({err}). <button onClick={() => router.push("/admin")} className="underline">Torna al registro</button></div>;

  const a = d.account;
  return (
    <div>
      <button onClick={() => router.push("/admin")} className="mb-2 text-sm font-semibold text-focus hover:underline">← Registro</button>
      <PageHeader title={a.name || a.email || "Account"} subtitle={a.email || ""} hideHelp
        actions={<Contacts email={a.email} phone={a.phone} />} />

      {/* Abbonamento */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Piano" value={<PlanBadge plan={a.plan} />} />
        <StatCard label="Stato" value={a.subStatus || "—"} color={a.subStatus === "active" ? "var(--ok)" : a.subStatus === "trialing" ? "var(--warn)" : undefined} />
        <StatCard label="Scadenza" value={dmy(a.periodEnd)} hint={a.cancelAtPeriodEnd ? "in disdetta" : undefined} />
        <StatCard label="Canone" value={a.monthlyAmount != null ? `${eur(a.monthlyAmount, a.currency || "EUR")}` : "—"} hint="al mese" />
        <StatCard label="Dovuto" value={a.amountDue != null && a.amountDue > 0 ? eur(a.amountDue, a.currency || "EUR") : "—"} color={a.amountDue && a.amountDue > 0 ? "var(--bad,#dc2626)" : undefined} />
        <StatCard label="Pagato finora" value={a.totalPaid != null ? eur(a.totalPaid, a.currency || "EUR") : "—"} color="var(--ok)" />
      </div>

      {/* Anagrafica */}
      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><div className="text-[11px] uppercase tracking-wide text-faint">Telefono</div><div className="font-medium text-txt">{a.phone || "—"}</div></div>
          <div><div className="text-[11px] uppercase tracking-wide text-faint">Registrato</div><div className="font-medium text-txt">{dmy(a.createdAt)}</div></div>
          <div><div className="text-[11px] uppercase tracking-wide text-faint">Ultimo accesso</div><div className="font-medium text-txt">{dmy(a.lastActive)}</div></div>
          <div><div className="text-[11px] uppercase tracking-wide text-faint">Email confermata</div><div className="font-medium text-txt">{a.emailConfirmed ? "Sì" : "No"}</div></div>
        </div>
      </Card>

      {/* Strutture con camere / posti letto / membri */}
      <div className="mb-2 text-sm font-semibold text-txt">Strutture ({d.structures.length})</div>
      <div className="mb-4 space-y-3">
        {d.structures.length === 0 ? <Card><div className="py-6 text-center text-sm text-faint">Nessuna struttura registrata.</div></Card> : d.structures.map((s) => (
          <Card key={s.id}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-txt">{s.name}</span>
              {s.city && <span className="text-[12px] text-dim">· {s.city}</span>}
              <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-dim">{s.roomCount} camere</span>
              <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-dim">{s.bedCount} posti letto</span>
              {s.members.length > 0 && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-dim">👥 {s.members.length} membri</span>}
            </div>

            {s.rooms.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[440px] text-sm">
                  <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="px-3 py-1.5 font-semibold">Camera</th><th className="px-3 py-1.5 font-semibold">Tipologia</th><th className="px-3 py-1.5 font-semibold text-right">Letti</th><th className="px-3 py-1.5 font-semibold">Configurazione</th><th className="px-3 py-1.5 font-semibold text-right">mq</th></tr></thead>
                  <tbody>
                    {s.rooms.map((r, i) => (
                      <tr key={i} className="border-b border-line/60">
                        <td className="px-3 py-1.5 font-medium text-txt">{r.name}</td>
                        <td className="px-3 py-1.5 text-dim">{r.roomType || "—"}</td>
                        <td className="px-3 py-1.5 text-right text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{r.beds || "—"}</td>
                        <td className="px-3 py-1.5 text-dim">{r.bedConfig || "—"}</td>
                        <td className="px-3 py-1.5 text-right text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{r.size || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {s.members.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Membri di questa struttura</div>
                <div className="space-y-1.5">
                  {s.members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
                      <span className="min-w-0 flex-1 truncate"><span className="font-medium text-txt">{m.name || m.email}</span> <span className="text-[12px] text-dim">{m.email}{m.phone ? ` · ${m.phone}` : ""}</span></span>
                      <Contacts email={m.email} phone={m.phone} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {d.membersOther.length > 0 && (
        <Card className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Altri collaboratori</div>
          <div className="space-y-1.5">
            {d.membersOther.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
                <span className="min-w-0 flex-1 truncate"><span className="font-medium text-txt">{m.name || m.email}</span> <span className="text-[12px] text-dim">{m.email}{m.structureName ? ` · ${m.structureName}` : ""}</span></span>
                <Contacts email={m.email} phone={m.phone} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Storico pagamenti */}
      <Card className="mb-4 overflow-x-auto">
        <div className="mb-2 text-sm font-semibold text-txt">Storico pagamenti / fatture</div>
        {!a.stripeCustomerId ? <div className="text-[12px] text-faint">Nessun cliente Stripe collegato.</div> : d.invoices.length === 0 ? <div className="text-[12px] text-faint">Nessun pagamento registrato.</div> : (
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="px-2 py-1.5 font-semibold">Data</th><th className="px-2 py-1.5 font-semibold">Descrizione</th><th className="px-2 py-1.5 font-semibold text-right">Importo</th><th className="px-2 py-1.5 font-semibold">Stato</th><th className="px-2 py-1.5 font-semibold">Fattura</th></tr></thead>
            <tbody>
              {d.invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-line/60">
                  <td className="px-2 py-1.5 whitespace-nowrap text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{dmy(inv.date)}</td>
                  <td className="px-2 py-1.5 text-dim">{inv.description || inv.number || "Abbonamento"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-right font-semibold text-txt" style={{ fontVariantNumeric: "tabular-nums" }}>{eur(inv.amount, inv.currency)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap"><span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={inv.paid ? { backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" } : { backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{inv.paid ? "pagata" : (inv.status || "—")}</span></td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{inv.pdf ? <a href={inv.pdf} target="_blank" rel="noreferrer" className="font-semibold text-focus hover:underline">PDF</a> : inv.hostedUrl ? <a href={inv.hostedUrl} target="_blank" rel="noreferrer" className="font-semibold text-focus hover:underline">Apri</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Note interne */}
      <Card>
        <div className="mb-1.5 text-sm font-semibold text-txt">Note interne (private)</div>
        <textarea value={note} onChange={(e) => { setNote(e.target.value); setNoteState({}); }} rows={4} placeholder="Appunti su questo cliente: contatti, accordi, promemoria…" className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
        <div className="mt-2 flex items-center gap-2">
          <button onClick={saveNote} disabled={noteState.saving} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{noteState.saving ? "Salvo…" : "Salva nota"}</button>
          {noteState.saved && <span className="text-[12px] font-medium text-[color:var(--ok)]">Salvato ✓</span>}
        </div>
      </Card>
    </div>
  );
}
