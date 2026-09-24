"use client";

// Back-office Xenora (super-admin) — visibile SOLO al titolare (email in ADMIN_EMAILS lato server).
// Vista per ACCOUNT PAGANTE: ogni titolare con i suoi collaboratori (member) e lo storico pagamenti
// a tendina. In più: vista "tutti i registrati", contatti rapidi, filtri scadenze, export CSV.
// I dati arrivano da /api/admin/overview e /api/admin/payments (service_role lato server).

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { TIERS, ROOMS_PER_STRUCT } from "@/lib/plans";

interface Row {
  id: string; email: string | null; name: string; phone: string | null; createdAt: string | null;
  lastSignIn: string | null; lastActive: string | null;
  emailConfirmed: boolean; plan: string | null; structures: number; rooms: number; structureNames: string;
  stripeCustomerId: string | null; subStatus: string | null; periodEnd: string | null;
  cancelAtPeriodEnd: boolean; monthlyAmount: number | null; currency: string | null;
  invitedCount: number; referredByCode: string | null;
  ownsOrg: boolean; memberOfOrgIds: string[]; isPayer: boolean;
}
interface Account { owner: Row; members: Row[] }
interface Invoice { id: string; number: string | null; date: string | null; periodEnd: string | null; amount: number; currency: string; status: string | null; paid: boolean; pdf: string | null; hostedUrl: string | null; description: string | null }
interface Alert { label: string; tone: "red" | "amber" | "info" }

const ACTIVE = ["active"];
const TRIALING = ["trialing"];
const PAST_DUE = ["past_due", "unpaid", "incomplete", "incomplete_expired", "canceled"];
const statusOf = (r: Row) => (r.subStatus || "").toLowerCase();
const isActive = (r: Row) => ACTIVE.includes(statusOf(r));
const isTrial = (r: Row) => TRIALING.includes(statusOf(r));
const isPastDue = (r: Row) => PAST_DUE.includes(statusOf(r));

const dmy = (iso: string | null) => { if (!iso) return "—"; const d = new Date(iso); if (isNaN(+d)) return "—"; return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };
const daysUntil = (iso: string | null) => { if (!iso) return null; const d = new Date(iso); if (isNaN(+d)) return null; return Math.round((+d - Date.now()) / 86400000); };
const tierOf = (plan: string | null) => TIERS.find((t) => t.key === (plan || "").toLowerCase());
const tierName = (plan: string | null) => tierOf(plan)?.name || (plan ? plan : "—");
// Un colore distinto per ogni piano (badge).
const PLAN_COLOR: Record<string, string> = { basic: "#5E7C8B", pro: "#4F46E5", ultimate: "#C08A3A" };
const planColor = (plan: string | null) => PLAN_COLOR[(plan || "").toLowerCase()] || "var(--faint)";
function PlanBadge({ plan }: { plan: string | null }) {
  const has = !!tierOf(plan); const c = planColor(plan);
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={has ? { backgroundColor: `color-mix(in srgb, ${c} 16%, transparent)`, color: c } : { backgroundColor: "var(--wash)", color: "var(--faint)" }}>{tierName(plan)}</span>;
}
const waLink = (phone: string | null) => { const d = (phone || "").replace(/[^\d]/g, ""); return d ? `https://wa.me/${d}` : ""; };
const eur = (n: number | null | undefined, cur = "EUR") => n == null ? "—" : `${cur === "EUR" ? "€" : cur} ${n.toLocaleString("it-IT", { minimumFractionDigits: 2 })}`;

function alertsFor(r: Row): Alert[] {
  const out: Alert[] = [];
  const s = statusOf(r);
  if (["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(s)) out.push({ label: "Pagamento fallito", tone: "red" });
  const t = tierOf(r.plan);
  if (t && r.structures > t.structures) out.push({ label: `Oltre limite strutture (${r.structures}/${t.structures})`, tone: "red" });
  if (!r.emailConfirmed) out.push({ label: "Email non confermata", tone: "amber" });
  if (r.cancelAtPeriodEnd) out.push({ label: "In disdetta", tone: "amber" });
  const du = daysUntil(r.periodEnd);
  if (!r.cancelAtPeriodEnd && (s === "active" || s === "trialing") && du != null && du >= 0 && du <= 7) out.push({ label: `Scade tra ${du}g`, tone: "amber" });
  if (t) { const inc = t.structures * ROOMS_PER_STRUCT; if (r.rooms > inc) out.push({ label: `Camere extra +${r.rooms - inc}`, tone: "info" }); }
  return out;
}
const needsAttention = (r: Row) => isPastDue(r) || (() => { const du = daysUntil(r.periodEnd); return !r.cancelAtPeriodEnd && (isActive(r) || isTrial(r)) && du != null && du >= 0 && du <= 7; })() || r.cancelAtPeriodEnd;

export default function AdminPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [err, setErr] = useState("");
  const [stripeOn, setStripeOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"accounts" | "all">("accounts");
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<"all" | "paganti" | "trialing" | "recupero" | "none">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pay, setPay] = useState<Record<string, { loading: boolean; invoices: Invoice[]; error?: string }>>({});

  const authToken = async () => (await (supabase?.auth.getSession() ?? Promise.resolve({ data: { session: null } }))).data.session?.access_token || "";

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const token = await authToken();
      if (!token) { setErr("no_session"); setLoading(false); return; }
      const res = await fetch("/api/admin/overview", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) { setErr("forbidden"); setLoading(false); return; }
      if (res.status === 503) { setErr("not_configured"); setLoading(false); return; }
      const d = await res.json();
      if (!res.ok) { setErr(d?.error || "error"); setLoading(false); return; }
      setRows(d.rows || []); setAccounts(d.accounts || []); setStripeOn(!!d.stripeConfigured);
    } catch { setErr("network"); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const loadPayments = async (cid: string) => {
    if (pay[cid]?.invoices || pay[cid]?.loading) return;
    setPay((p) => ({ ...p, [cid]: { loading: true, invoices: [] } }));
    try {
      const token = await authToken();
      const res = await fetch("/api/admin/payments", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ customerId: cid }) });
      const d = await res.json();
      setPay((p) => ({ ...p, [cid]: { loading: false, invoices: d.invoices || [], error: d.error } }));
    } catch { setPay((p) => ({ ...p, [cid]: { loading: false, invoices: [], error: "network" } })); }
  };
  const toggle = (acc: Account) => {
    const id = acc.owner.id;
    const nowOpen = !expanded[id];
    setExpanded((e) => ({ ...e, [id]: nowOpen }));
    if (nowOpen && acc.owner.stripeCustomerId) loadPayments(acc.owner.stripeCustomerId);
  };

  const kpi = useMemo(() => {
    const rs = rows || [];
    const acc = accounts || [];
    const paganti = acc.filter((a) => a.owner.isPayer).length;
    const trialing = rs.filter(isTrial).length;
    const pastDue = rs.filter(isPastDue).length;
    const mrr = rs.reduce((a, r) => a + ((isActive(r) || isTrial(r)) ? (r.monthlyAmount || 0) : 0), 0);
    const recupero = acc.filter((a) => needsAttention(a.owner)).length;
    return { total: rs.length, paganti, trialing, pastDue, mrr, recupero };
  }, [rows, accounts]);

  const filteredAccounts = useMemo(() => {
    let as = accounts || [];
    const term = q.trim().toLowerCase();
    if (term) as = as.filter((a) => [a.owner, ...a.members].some((r) => (r.email || "").toLowerCase().includes(term) || (r.name || "").toLowerCase().includes(term) || (r.phone || "").toLowerCase().includes(term) || (r.structureNames || "").toLowerCase().includes(term)));
    if (statusF === "paganti") as = as.filter((a) => a.owner.isPayer && (isActive(a.owner) || isTrial(a.owner) || !!a.owner.stripeCustomerId));
    else if (statusF === "trialing") as = as.filter((a) => isTrial(a.owner));
    else if (statusF === "recupero") as = as.filter((a) => needsAttention(a.owner));
    else if (statusF === "none") as = as.filter((a) => !a.owner.isPayer);
    return as;
  }, [accounts, q, statusF]);

  const toneStyle = (tone: Alert["tone"]) => tone === "red"
    ? { backgroundColor: "color-mix(in srgb, var(--bad,#dc2626) 14%, transparent)", color: "var(--bad,#dc2626)" }
    : tone === "amber" ? { backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }
    : { backgroundColor: "var(--wash)", color: "var(--dim)" };

  const exportCsv = () => {
    const head = ["Titolare", "Email", "Telefono", "Piano", "Stato", "Rinnovo", "Canone mensile", "Collaboratori", "Strutture", "Camere"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = (accounts || []).map((a) => [a.owner.name, a.owner.email, a.owner.phone, tierName(a.owner.plan), a.owner.subStatus || "—", dmy(a.owner.periodEnd), a.owner.monthlyAmount ?? "", a.members.length, a.owner.structures, a.owner.rooms].map(esc).join(","));
    const csv = [head.map(esc).join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `xenora-abbonati-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (err === "forbidden") return (<div><PageHeader title="Back-office" hideHelp /><Card><div className="py-6 text-center text-sm text-dim">🔒 Area riservata. Il tuo account non ha accesso al back-office.</div></Card></div>);
  if (err === "not_configured") return (
    <div><PageHeader title="Back-office" hideHelp />
      <Card><div className="space-y-2 text-sm text-dim"><div className="font-semibold text-txt">Back-office non ancora configurato</div>
        <p>Serve la chiave <code className="rounded bg-wash px-1">SUPABASE_SERVICE_ROLE_KEY</code> tra le variabili d&apos;ambiente su Vercel (solo lato server).</p></div></Card>
    </div>
  );

  const ContactBtns = ({ r }: { r: Row }) => (
    <div className="flex items-center gap-1.5">
      {r.email && <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()} title={`Email a ${r.email}`} className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">✉ Email</a>}
      {waLink(r.phone) && <a href={waLink(r.phone)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Scrivi su WhatsApp" className="rounded-md px-2 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: "#25D366" }}>WhatsApp</a>}
    </div>
  );

  return (
    <div>
      <PageHeader title="Back-office" subtitle="Chi paga, abbonati, scadenze, piani e storico fatture di Xenora" hideHelp
        actions={<div className="flex items-center gap-2">
          <button onClick={exportCsv} disabled={loading || !accounts?.length} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">⤓ CSV</button>
          <button onClick={load} disabled={loading} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-60">{loading ? "Aggiorno…" : "↻ Aggiorna"}</button>
        </div>} />

      {!stripeOn && !err && (
        <div className="mb-4 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 12%, transparent)", color: "var(--dim)" }}>
          Stripe non collegato: stato pagamenti, MRR, scadenze e storico fatture non disponibili. Aggiungi <code className="rounded bg-wash px-1">STRIPE_SECRET_KEY</code> su Vercel.
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Abbonati paganti" value={stripeOn ? kpi.paganti : "—"} color="var(--ok)" hint="Account con abbonamento" />
        <StatCard label="In prova" value={stripeOn ? kpi.trialing : "—"} color="var(--warn)" hint="trial in corso" />
        <StatCard label="Da recuperare" value={stripeOn ? kpi.recupero : "—"} color={kpi.recupero > 0 ? "var(--bad,#dc2626)" : undefined} hint="scaduti o in scadenza 7g" />
        <StatCard label="MRR stimato" value={stripeOn ? `€ ${kpi.mrr.toFixed(0)}` : "—"} hint="ricavo mensile ricorrente" />
        <StatCard label="Iscritti totali" value={kpi.total} hint="account registrati" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          <button onClick={() => setView("accounts")} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === "accounts" ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>Account paganti</button>
          <button onClick={() => setView("all")} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === "all" ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>Tutti i registrati</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca email, nome, telefono, struttura…" className="min-w-[200px] flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
        {view === "accounts" && (
          <select value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus">
            <option value="all">Tutti</option>
            <option value="paganti">Solo paganti</option>
            <option value="trialing">In prova</option>
            <option value="recupero">Da recuperare / in scadenza</option>
            <option value="none">Senza abbonamento</option>
          </select>
        )}
      </div>

      {loading ? (
        <Card><div className="py-10 text-center text-sm text-faint">Carico i dati…</div></Card>
      ) : err ? (
        <Card><div className="py-10 text-center text-sm text-dim">Impossibile caricare i dati ({err}). <button onClick={load} className="underline">Riprova</button></div></Card>
      ) : view === "accounts" ? (
        <div className="space-y-2.5">
          {filteredAccounts.length === 0 ? <Card><div className="py-10 text-center text-sm text-faint">Nessun account trovato.</div></Card> : filteredAccounts.map((acc) => {
            const r = acc.owner; const al = alertsFor(r); const open = !!expanded[r.id];
            const p = r.stripeCustomerId ? pay[r.stripeCustomerId] : undefined;
            return (
              <Card key={r.id} className="!p-0 overflow-hidden">
                <button onClick={() => toggle(acc)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-wash/40">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: r.isPayer ? "var(--ok)" : "var(--faint)" }}>{(r.name || r.email || "?").slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-txt">{r.name || r.email || "—"}</span>
                      <PlanBadge plan={r.plan} />
                      {acc.members.length > 0 && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">👥 {acc.members.length} collaboratori</span>}
                    </div>
                    <div className="truncate text-[12px] text-dim">{r.email}{r.phone ? ` · ${r.phone}` : ""} · {r.structures} strutt. · {r.rooms} camere</div>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <div className="text-sm font-semibold text-txt" style={{ fontVariantNumeric: "tabular-nums" }}>{r.monthlyAmount != null ? `${eur(r.monthlyAmount, r.currency || "EUR")}/mese` : (r.isPayer ? "—" : "no abb.")}</div>
                    <div className="text-[11px] text-dim">{r.subStatus ? `${r.subStatus} · rinnovo ${dmy(r.periodEnd)}` : "nessun abbonamento"}</div>
                  </div>
                  <span className="ml-1 shrink-0 text-dim transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
                </button>

                <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
                  {al.map((a, i) => <span key={i} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={toneStyle(a.tone)}>{a.label}</span>)}
                  <div className="ml-auto"><ContactBtns r={r} /></div>
                </div>

                {open && (
                  <div className="border-t border-line bg-wash/30 px-4 py-3">
                    {acc.members.length > 0 && (
                      <div className="mb-3">
                        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Collaboratori (nel piano del titolare)</div>
                        <div className="space-y-1.5">
                          {acc.members.map((m) => (
                            <div key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                              <span className="min-w-0 flex-1"><span className="font-medium text-txt">{m.name || m.email}</span> <span className="text-[12px] text-dim">{m.email}{m.phone ? ` · ${m.phone}` : ""}</span></span>
                              <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">collaboratore</span>
                              <ContactBtns r={m} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Storico pagamenti / fatture</div>
                    {!r.stripeCustomerId ? (
                      <div className="text-[12px] text-faint">Nessun cliente Stripe collegato (account non pagante).</div>
                    ) : p?.loading ? (
                      <div className="text-[12px] text-faint">Carico lo storico…</div>
                    ) : p?.invoices?.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-faint"><th className="py-1 pr-3 font-semibold">Data</th><th className="py-1 pr-3 font-semibold">Descrizione</th><th className="py-1 pr-3 font-semibold">Importo</th><th className="py-1 pr-3 font-semibold">Stato</th><th className="py-1 font-semibold">Fattura</th></tr></thead>
                          <tbody>
                            {p.invoices.map((inv) => (
                              <tr key={inv.id} className="border-t border-line/60">
                                <td className="py-1.5 pr-3 whitespace-nowrap text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{dmy(inv.date)}</td>
                                <td className="py-1.5 pr-3 text-dim">{inv.description || inv.number || "Abbonamento"}</td>
                                <td className="py-1.5 pr-3 whitespace-nowrap font-semibold text-txt" style={{ fontVariantNumeric: "tabular-nums" }}>{eur(inv.amount, inv.currency)}</td>
                                <td className="py-1.5 pr-3 whitespace-nowrap"><span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={inv.paid ? { backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" } : { backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{inv.paid ? "pagata" : (inv.status || "—")}</span></td>
                                <td className="py-1.5 whitespace-nowrap">{inv.pdf ? <a href={inv.pdf} target="_blank" rel="noreferrer" className="font-semibold text-focus hover:underline">PDF</a> : inv.hostedUrl ? <a href={inv.hostedUrl} target="_blank" rel="noreferrer" className="font-semibold text-focus hover:underline">Apri</a> : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-[12px] text-faint">{p?.error ? `Errore: ${p.error}` : "Nessun pagamento registrato."}</div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-x-auto p-0">
          {(rows || []).length === 0 ? <div className="py-10 text-center text-sm text-faint">Nessun utente.</div> : (
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-3 py-2 font-semibold">Utente</th><th className="px-3 py-2 font-semibold">Registrato</th><th className="px-3 py-2 font-semibold">Ultimo accesso</th><th className="px-3 py-2 font-semibold">Piano</th><th className="px-3 py-2 font-semibold">Ruolo</th><th className="px-3 py-2 font-semibold">Pagamento</th><th className="px-3 py-2 font-semibold">Contatti</th>
              </tr></thead>
              <tbody>
                {(rows || []).filter((r) => { const t = q.trim().toLowerCase(); return !t || (r.email || "").toLowerCase().includes(t) || (r.name || "").toLowerCase().includes(t) || (r.phone || "").toLowerCase().includes(t); }).map((r) => (
                  <tr key={r.id} className="border-b border-line/60 hover:bg-wash/50">
                    <td className="px-3 py-2.5"><div className="font-semibold text-txt">{r.name || "—"}</div><div className="text-[12px] text-dim">{r.email}</div></td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{dmy(r.createdAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>{dmy(r.lastActive)}</td>
                    <td className="px-3 py-2.5"><PlanBadge plan={r.plan} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[12px] text-dim">{r.isPayer ? "pagante" : r.memberOfOrgIds.length ? "collaboratore" : r.ownsOrg ? "titolare" : "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-dim">{r.subStatus || "—"}</td>
                    <td className="px-3 py-2.5"><ContactBtns r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      <div className="mt-3 text-[11px] text-faint">Piano/strutture/camere si aggiornano quando l&apos;utente apre l&apos;app. Pagamenti, scadenze e storico fatture arrivano da Stripe in tempo reale.</div>
    </div>
  );
}
