"use client";

// Scadenzario incassi: documenti emessi non (del tutto) incassati, per scadenza.
// Il residuo tiene conto degli incassi registrati E delle note di credito emesse che stornano la fattura;
// le note di credito non sono mai crediti. Solleciti: testo pronto da aprire in WhatsApp/email o da copiare.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { useData } from "@/lib/store";
import { useConfirm } from "@/components/ConfirmProvider";
import { PageHeader, Card, StatCard } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";
import { DOC_KIND_LABEL } from "@/lib/invoicing/client";
import { buildCsv, centsToCsv, downloadCsv } from "@/lib/invoicing/csv";
import { computeResidui, daysOverdue, todayLocalISO, agingBucket, AGING_LABEL, type AgingKey } from "@/lib/invoicing/receivables";
import { reminderText, reminderSubject, waReminderLink, mailReminderLink, waDigits } from "@/lib/invoicing/reminders";

interface Doc {
  id: string; number_label: string | null; issue_date: string | null; due_date: string | null; total_cents: number;
  counterpart: { name?: string; lastName?: string; email?: string | null } | null; booking_code: string | null; structure_id: string | null;
  doc_kind: string; stato: string; related_document_id: string | null;
}
interface Reminder { count: number; last: string }
const cents = (c: number) => c / 100;
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
const BUCKETS: AgingKey[] = ["future", "nodue", "d30", "d60", "d90", "over90"];

export default function ScadenzarioIncassiPage() {
  const router = useRouter();
  const { user } = useAuth();
  const ask = useConfirm();
  const { activeStructureId, bookings, getGuest, getStructure, updateBooking } = useData();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [paid, setPaid] = useState<Record<string, number>>({});
  const [reminders, setReminders] = useState<Record<string, Reminder>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [bucket, setBucket] = useState<AgingKey | "all" | "overdue">("all");
  const [q, setQ] = useState("");
  const [remind, setRemind] = useState<string | null>(null); // id documento con il pannello sollecito aperto
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const [d, p, ev] = await Promise.all([
      supabase.from("documents").select("id, number_label, issue_date, due_date, total_cents, counterpart, booking_code, structure_id, doc_kind, stato, related_document_id").in("stato", ["emessa", "inviata_intermediario", "consegnata"]),
      supabase.from("document_payments").select("document_id, amount_cents"),
      supabase.from("document_events").select("document_id, ts").eq("kind", "reminder"),
    ]);
    if (d.error) setErr(d.error.message);
    setDocs((d.data ?? []) as Doc[]);
    const m: Record<string, number> = {}; for (const x of (p.data ?? []) as { document_id: string; amount_cents: number }[]) m[x.document_id] = (m[x.document_id] ?? 0) + x.amount_cents;
    setPaid(m);
    const r: Record<string, Reminder> = {};
    for (const e of (ev.data ?? []) as { document_id: string; ts: string }[]) { const c = r[e.document_id]; r[e.document_id] = { count: (c?.count ?? 0) + 1, last: !c || e.ts > c.last ? e.ts : c.last }; }
    setReminders(r);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const t = todayLocalISO();
  const residui = useMemo(() => computeResidui(docs, paid), [docs, paid]);
  const all = useMemo(() => docs
    .filter((d) => d.doc_kind !== "nota_di_credito" && (residui[d.id]?.residuo ?? 0) > 0)
    .filter((d) => activeStructureId === "all" || d.structure_id === activeStructureId)
    .map((d) => ({ ...d, residuo: residui[d.id].residuo, credited: residui[d.id].credited, days: daysOverdue(d.due_date, t), bucket: agingBucket(d.due_date, t) })), [docs, residui, activeStructureId, t]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((r) => bucket === "all" ? true : bucket === "overdue" ? r.days > 0 : r.bucket === bucket)
      .filter((r) => !term || `${r.number_label ?? ""} ${r.counterpart?.name ?? ""} ${r.counterpart?.lastName ?? ""} ${r.booking_code ?? ""}`.toLowerCase().includes(term))
      .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  }, [all, bucket, q]);

  const totalOpen = all.reduce((a, r) => a + r.residuo, 0);
  const overdueTot = all.filter((r) => r.days > 0).reduce((a, r) => a + r.residuo, 0);
  const byBucket = (k: AgingKey) => all.filter((r) => r.bucket === k).reduce((a, r) => a + r.residuo, 0);
  const shownTot = rows.reduce((a, r) => a + r.residuo, 0);
  const sel = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  const nameOf = (r: Doc) => `${r.counterpart?.name ?? ""} ${r.counterpart?.lastName ?? ""}`.trim();
  // Contatti: dall'ospite della prenotazione collegata (telefono) o dall'intestatario (email salvata nel documento).
  const contactOf = (r: Doc) => {
    const b = r.booking_code ? bookings.find((x) => x.code === r.booking_code) : undefined;
    const g = b ? getGuest(b.guestId) : undefined;
    return { phone: g?.phone ?? "", email: r.counterpart?.email || g?.email || "", booking: b };
  };
  const draftText = (r: Doc & { residuo: number; days: number }) => {
    const struct = getStructure(r.structure_id ?? "");
    return reminderText({
      customerName: nameOf(r), docLabel: `${(DOC_KIND_LABEL[r.doc_kind] ?? "documento").toLowerCase()} ${r.number_label ?? ""}`.trim(),
      issueDate: r.issue_date, dueDate: r.due_date, residuoCents: r.residuo, daysLate: r.days, senderName: struct?.name ?? "", bookingCode: r.booking_code,
    });
  };
  const openRemind = (r: Doc & { residuo: number; days: number }) => { if (remind === r.id) { setRemind(null); return; } setRemind(r.id); setText(draftText(r)); setNote(""); };

  // Registra nello storico del documento che il sollecito è stato preparato/inviato (tabella document_events già esistente).
  const logReminder = async (docId: string, via: string) => {
    if (!supabase || !user) return;
    const { error } = await supabase.from("document_events").insert({ tenant_id: user.id, document_id: docId, kind: "reminder", message: `Sollecito di pagamento inviato via ${via}` });
    if (!error) { setReminders((p) => ({ ...p, [docId]: { count: (p[docId]?.count ?? 0) + 1, last: new Date().toISOString() } })); }
  };
  const copy = async (docId: string) => {
    try { await navigator.clipboard.writeText(text); setNote("Testo copiato ✓"); await logReminder(docId, "copia manuale"); } catch { setNote("Copia non riuscita: seleziona il testo e copialo a mano."); }
  };

  const markPaid = async (r: Doc & { residuo: number }) => {
    if (!supabase || !user) return;
    if (!(await ask({ title: "Segna come incassato", message: `Registrare l'incasso di ${eur(cents(r.residuo))} per ${r.number_label ?? "il documento"}?`, confirmLabel: "Registra incasso" }))) return;
    setBusy(r.id); setErr("");
    const { error } = await supabase.from("document_payments").insert({ document_id: r.id, tenant_id: user.id, amount_cents: r.residuo, method: "manuale" });
    if (error) { setErr("Errore incasso: " + error.message); setBusy(""); return; }
    // Fonte di verità incassi = prenotazione (come nella scheda documento).
    const b = r.booking_code ? bookings.find((x) => x.code === r.booking_code) : undefined;
    if (b) updateBooking(b.id, { paid: (b.paid ?? 0) + Math.round(r.residuo) / 100 });
    await load(); setBusy("");
  };

  const exportCsv = () => {
    const head = ["Scadenza", "Giorni di ritardo", "Fascia", "Numero", "Data documento", "Cliente", "Prenotazione", "Totale", "Incassato", "Stornato da NC", "Residuo", "Solleciti inviati", "Ultimo sollecito"];
    const lines = rows.map((r) => [dmy(r.due_date), r.days || "", AGING_LABEL[r.bucket], r.number_label ?? "", dmy(r.issue_date), nameOf(r), r.booking_code ?? "",
      centsToCsv(r.total_cents), centsToCsv(paid[r.id] ?? 0), centsToCsv(r.credited), centsToCsv(r.residuo), reminders[r.id]?.count ?? 0, reminders[r.id] ? new Date(reminders[r.id].last).toLocaleDateString("it-IT") : ""]);
    downloadCsv(`scadenzario-incassi-${t}`, buildCsv(head, lines));
  };

  return (
    <div>
      <PageHeader title="Scadenzario incassi" subtitle="Documenti emessi ancora da incassare, per scadenza"
        actions={<button onClick={exportCsv} disabled={rows.length === 0} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">Esporta CSV</button>} />

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Totale da incassare" value={eur(cents(totalOpen))} hint={`${all.length} documenti`} onClick={() => setBucket("all")} active={bucket === "all"} />
        <StatCard label="Di cui scaduto" value={eur(cents(overdueTot))} color={overdueTot > 0 ? "var(--err)" : "var(--ok)"} onClick={() => setBucket("overdue")} active={bucket === "overdue"} />
        {BUCKETS.filter((k) => k !== "nodue" || byBucket("nodue") > 0).map((k) => (
          <StatCard key={k} label={AGING_LABEL[k]} value={eur(cents(byBucket(k)))} color={k === "future" || k === "nodue" ? undefined : "var(--err)"} onClick={() => setBucket(k)} active={bucket === k} hint={`${all.filter((r) => r.bucket === k).length} doc.`} />
        ))}
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Cerca numero, cliente, prenotazione…" />
          <select value={bucket} onChange={(e) => setBucket(e.target.value as AgingKey | "all" | "overdue")} className={sel}>
            <option value="all">Tutti da incassare</option><option value="overdue">Solo scaduti</option>
            {BUCKETS.map((k) => <option key={k} value={k}>{AGING_LABEL[k]}</option>)}
          </select>
          <span className="ml-auto text-xs text-dim">{rows.length} documenti · <b className="font-mono text-txt">{eur(cents(shownTot))}</b></span>
        </div>
        {err && <p className="mt-2 text-sm text-[color:var(--err)]">{err}</p>}
      </Card>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="px-3 py-2 font-semibold">Scadenza</th><th className="px-3 py-2 font-semibold">Numero</th><th className="px-3 py-2 font-semibold">Cliente</th><th className="px-3 py-2 text-right font-semibold">Totale</th><th className="px-3 py-2 text-right font-semibold">Residuo</th><th className="px-3 py-2 font-semibold">Stato</th><th className="px-3 py-2 text-right font-semibold">Azioni</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const overdue = r.days > 0;
              const rem = reminders[r.id];
              const c = remind === r.id ? contactOf(r) : null;
              return (
                <Fragment key={r.id}>
                  <tr onClick={() => router.push(`/documenti/${r.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs" style={{ color: overdue ? "var(--err)" : "var(--dim)" }}>{r.due_date ? dmy(r.due_date) : "senza scadenza"}{overdue && <div className="text-[10px]">{r.days} gg di ritardo</div>}</td>
                    <td className="px-3 py-2.5 font-mono text-txt">{r.number_label}</td>
                    <td className="px-3 py-2.5"><div className="text-txt">{nameOf(r) || "—"}</div>{r.booking_code && <div className="text-[11px] text-faint">{r.booking_code}</div>}{rem && <div className="text-[10px] text-faint">Solleciti: {rem.count} · ultimo {new Date(rem.last).toLocaleDateString("it-IT")}</div>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{eur(cents(r.total_cents))}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(cents(r.residuo))}{r.credited > 0 && <div className="text-[10px] font-normal text-faint">dopo NC −{eur(cents(r.credited))}</div>}</td>
                    <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${overdue ? "var(--err)" : "var(--warn)"} 16%, transparent)`, color: overdue ? "var(--err)" : "var(--warn)" }}>{overdue ? "Scaduto" : r.due_date ? "Da incassare" : "Senza scadenza"}</span></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => openRemind(r)} className="mr-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash">Sollecita</button>
                      <button onClick={() => markPaid(r)} disabled={busy === r.id} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-[color:var(--ok)] hover:bg-wash disabled:opacity-50">{busy === r.id ? "…" : "Incassato"}</button>
                    </td>
                  </tr>
                  {remind === r.id && c && (
                    <tr className="border-b border-line bg-wash/40">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Testo del sollecito (modificabile)</div>
                        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {waDigits(c.phone)
                            ? <a href={waReminderLink(c.phone, text)} target="_blank" rel="noreferrer" onClick={() => logReminder(r.id, "WhatsApp")} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#25D366" }}>💬 Apri WhatsApp</a>
                            : <span className="text-[11px] text-faint">Nessun telefono: collega la prenotazione all&apos;ospite per usare WhatsApp.</span>}
                          {c.email
                            ? <a href={mailReminderLink(c.email, reminderSubject({ customerName: nameOf(r), docLabel: `${(DOC_KIND_LABEL[r.doc_kind] ?? "documento").toLowerCase()} ${r.number_label ?? ""}`.trim(), issueDate: r.issue_date, dueDate: r.due_date, residuoCents: r.residuo, daysLate: r.days, senderName: "" }), text)} onClick={() => logReminder(r.id, "email")} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">✉ Apri email</a>
                            : <span className="text-[11px] text-faint">Nessuna email disponibile.</span>}
                          <button onClick={() => copy(r.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Copia testo</button>
                          <button onClick={() => setText(draftText(r))} className="text-xs font-medium text-dim hover:underline">Ripristina testo</button>
                          {note && <span className="text-[11px] font-medium text-dim">{note}</span>}
                        </div>
                        <p className="mt-1 text-[11px] text-faint">Il messaggio non parte da solo: si apre in WhatsApp/email già compilato e lo invii tu. L&apos;invio viene annotato nello storico del documento.</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && rows.length === 0 && <tr><td colSpan={7}><EmptyState title="Nessun incasso in sospeso" sub={bucket === "all" && !q ? "Tutti i documenti emessi risultano saldati." : "Nessun documento con questi filtri."} /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
