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
import { PageHeader, Card, StatCard, Button, Select, Textarea, Badge, Alert, buttonClass } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";
import { roundCents } from "@/lib/money";
import { balanceDue } from "@/lib/incassi";
import { DOC_KIND_LABEL, invPost } from "@/lib/invoicing/client";
import { buildCsv, centsToCsv, downloadCsv } from "@/lib/invoicing/csv";
import { computeResidui, daysOverdue, todayLocalISO, agingBucket, AGING_LABEL, type AgingKey } from "@/lib/invoicing/receivables";
import { reminderText, reminderSubject, waReminderLink, mailReminderLink, waDigits } from "@/lib/invoicing/reminders";
import { useTenantId } from "@/lib/tenant";
import { cashScopeOf, scopeVisible } from "@/lib/cassa";
import { fmtDate } from "@/lib/dates";
import { friendlyError } from "@/lib/friendly-error";
import { keyActivate } from "@/lib/a11y";

interface Doc {
  id: string; number_label: string | null; issue_date: string | null; due_date: string | null; total_cents: number;
  counterpart: { name?: string; lastName?: string; email?: string | null } | null; booking_code: string | null; structure_id: string | null;
  doc_kind: string; stato: string; related_document_id: string | null; provider_ref?: string | null;
}
interface Reminder { count: number; last: string }
const cents = (c: number) => c / 100;
const dmy = (iso: string | null) => (iso ? fmtDate(iso) : "");
const BUCKETS: AgingKey[] = ["future", "nodue", "d30", "d60", "d90", "over90"];

export default function ScadenzarioIncassiPage() {
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = useTenantId(); // account di lavoro: per un collaboratore è quello di chi lo ha invitato
  const ask = useConfirm();
  const { raw, allStructures, selectedStructureIds, getGuest, getStructure, updateBooking } = useData();
  // Prenotazioni COMPLETE (non filtrate dalla selezione): un documento di una struttura fuori selezione deve poter aggiornare comunque il suo incasso.
  const bookings = raw.bookings;
  const scope = useMemo(() => cashScopeOf(selectedStructureIds, allStructures.map((x) => x.id)), [selectedStructureIds, allStructures]);
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
  const [ficNote, setFicNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const [d, p, ev] = await Promise.all([
      supabase.from("documents").select("id, number_label, issue_date, due_date, total_cents, counterpart, booking_code, structure_id, doc_kind, stato, related_document_id, provider_ref").in("stato", ["emessa", "inviata_intermediario", "consegnata"]),
      supabase.from("document_payments").select("document_id, amount_cents"),
      supabase.from("document_events").select("document_id, ts").eq("kind", "reminder"),
    ]);
    if (d.error) setErr(friendlyError(d.error));
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
    .filter((d) => scope === "all" || scopeVisible(d.structure_id, scope))
    .map((d) => ({ ...d, residuo: residui[d.id].residuo, credited: residui[d.id].credited, days: daysOverdue(d.due_date, t), bucket: agingBucket(d.due_date, t) })), [docs, residui, scope, t]);

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
    if (!supabase || !user || !tenantId) return; // senza l'account di lavoro (collaboratore) non si scrive: finirebbe sull'account sbagliato
    const { error } = await supabase.from("document_events").insert({ tenant_id: tenantId, document_id: docId, kind: "reminder", message: `Sollecito di pagamento inviato via ${via}` });
    if (!error) { setReminders((p) => ({ ...p, [docId]: { count: (p[docId]?.count ?? 0) + 1, last: new Date().toISOString() } })); }
  };
  const copy = async (docId: string) => {
    try { await navigator.clipboard.writeText(text); setNote("Testo copiato ✓"); await logReminder(docId, "copia manuale"); } catch { setNote("Copia non riuscita: seleziona il testo e copialo a mano."); }
  };

  const markPaid = async (r: Doc & { residuo: number }) => {
    if (!supabase || !user) return;
    if (!tenantId) { setErr("Account di lavoro non ancora caricato: riprova tra qualche secondo."); return; }
    if (!(await ask({ title: "Segna come incassato", message: `Registrare l'incasso di ${eur(cents(r.residuo))} per ${r.number_label ?? "il documento"}?`, confirmLabel: "Registra incasso" }))) return;
    setBusy(r.id); setErr("");
    const { error } = await supabase.from("document_payments").insert({ document_id: r.id, tenant_id: tenantId, amount_cents: r.residuo, method: "manuale" });
    if (error) { setErr("Errore incasso: " + friendlyError(error)); setBusy(""); return; }
    // Fonte di verità incassi = prenotazione (come nella scheda documento).
    const b = r.booking_code ? bookings.find((x) => x.code === r.booking_code) : undefined;
    // Si aggiunge al massimo il residuo VERO della prenotazione: se l'ospite aveva gia' pagato online (booking.paid include gia' quei soldi) il documento si chiude senza raddoppiare l'incassato.
    if (b) { const due = Math.round(r.residuo) / 100; const add = (b.total ?? 0) > 0 ? Math.min(due, balanceDue(b, getStructure(b.structureId))) : due; if (add > 0) updateBooking(b.id, { paid: roundCents((b.paid ?? 0) + add) }); }
    // Segna il pagamento anche su Fatture in Cloud (in background: non blocca né fa fallire l'incasso).
    if (r.provider_ref?.startsWith("fic:")) {
      const lbl = r.number_label ?? "documento";
      setFicNote(null);
      invPost<{ ok?: boolean; skipped?: boolean; message?: string }>("fic/payments", { documentId: r.id, paid: true })
        .then((x) => { if (x.skipped && x.ok) return; setFicNote({ ok: !!x.ok, text: x.ok ? `${lbl}: ${x.message ?? ""}` : `Incasso di ${lbl} registrato; su Fatture in Cloud non aggiornato: ${x.message ?? "motivo sconosciuto"}` }); })
        .catch((e) => setFicNote({ ok: false, text: `Incasso di ${lbl} registrato; su Fatture in Cloud non aggiornato: ${friendlyError(e)}` }));
    }
    await load(); setBusy("");
  };

  const exportCsv = () => {
    const head = ["Scadenza", "Giorni di ritardo", "Fascia", "Numero", "Data documento", "Cliente", "Prenotazione", "Totale", "Incassato", "Stornato da NC", "Residuo", "Solleciti inviati", "Ultimo sollecito"];
    const lines = rows.map((r) => [dmy(r.due_date), r.days || "", AGING_LABEL[r.bucket], r.number_label ?? "", dmy(r.issue_date), nameOf(r), r.booking_code ?? "",
      centsToCsv(r.total_cents), centsToCsv(paid[r.id] ?? 0), centsToCsv(r.credited), centsToCsv(r.residuo), reminders[r.id]?.count ?? 0, reminders[r.id] ? fmtDate(reminders[r.id].last) : ""]);
    downloadCsv(`scadenzario-incassi-${t}`, buildCsv(head, lines));
  };

  // Pannello «sollecito»: usato sotto la riga della tabella (tablet/desktop) e sotto la scheda (telefono)
  const remindPanel = (r: (typeof rows)[number], c: NonNullable<ReturnType<typeof contactOf>>) => (
    <>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">Testo del sollecito (modificabile)</div>
      <Textarea aria-label="Testo del sollecito" value={text} onChange={(e) => setText(e.target.value)} rows={6} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {waDigits(c.phone)
          ? <a href={waReminderLink(c.phone, text)} target="_blank" rel="noreferrer" onClick={() => logReminder(r.id, "WhatsApp")} className={buttonClass("primary", "sm", "bg-ok! text-on-ok!")}>💬 Apri WhatsApp</a>
          : <span className="text-[11px] text-faint">Nessun telefono: collega la prenotazione all&apos;ospite per usare WhatsApp.</span>}
        {c.email
          ? <a href={mailReminderLink(c.email, reminderSubject({ customerName: nameOf(r), docLabel: `${(DOC_KIND_LABEL[r.doc_kind] ?? "documento").toLowerCase()} ${r.number_label ?? ""}`.trim(), issueDate: r.issue_date, dueDate: r.due_date, residuoCents: r.residuo, daysLate: r.days, senderName: "" }), text)} onClick={() => logReminder(r.id, "email")} className={buttonClass("secondary", "sm")}>✉ Apri email</a>
          : <span className="text-[11px] text-faint">Nessuna email disponibile.</span>}
        <Button variant="secondary" size="sm" onClick={() => copy(r.id)}>Copia testo</Button>
        <Button variant="ghost" size="sm" onClick={() => setText(draftText(r))}>Ripristina testo</Button>
        {note && <span className="text-[11px] font-medium text-dim">{note}</span>}
      </div>
      <p className="mt-1 text-[11px] text-faint">Il messaggio non parte da solo: si apre in WhatsApp/email già compilato e lo invii tu. L&apos;invio viene annotato nello storico del documento.</p>
    </>
  );

  return (
    <div>
      <PageHeader title="Scadenzario incassi" subtitle="Documenti emessi ancora da incassare, per scadenza"
        actions={<Button variant="secondary" size="sm" onClick={exportCsv} disabled={rows.length === 0} className="max-sm:hidden">Esporta CSV</Button>} />

      <div className="mb-3 grid grid-cols-2 gap-3 max-sm:gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Totale da incassare" value={eur(cents(totalOpen))} hint={`${all.length} documenti`} onClick={() => setBucket("all")} active={bucket === "all"} />
        <StatCard label="Di cui scaduto" value={eur(cents(overdueTot))} color={overdueTot > 0 ? "var(--err)" : "var(--ok)"} onClick={() => setBucket("overdue")} active={bucket === "overdue"} />
        {BUCKETS.filter((k) => k !== "nodue" || byBucket("nodue") > 0).map((k) => (
          <StatCard key={k} label={AGING_LABEL[k]} value={eur(cents(byBucket(k)))} color={k === "future" || k === "nodue" ? undefined : "var(--err)"} onClick={() => setBucket(k)} active={bucket === k} hint={`${all.filter((r) => r.bucket === k).length} doc.`} />
        ))}
      </div>

      <Card className="mb-4 max-sm:mb-3 max-sm:!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Cerca numero, cliente, prenotazione…" className="w-full sm:w-72 max-sm:w-[calc(100%-5rem)]" />
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={rows.length === 0} className="w-[4.5rem] sm:hidden">CSV</Button>
          {/* Telefono: un solo filtro (la select) resta inline accanto al conteggio, senza pulsante né scorrimento */}
          <div className="contents">
          <Select aria-label="Fascia di scadenza" value={bucket} onChange={(e) => setBucket(e.target.value as AgingKey | "all" | "overdue")} className="max-sm:min-w-0">
            <option value="all">Tutti da incassare</option><option value="overdue">Solo scaduti</option>
            {BUCKETS.map((k) => <option key={k} value={k}>{AGING_LABEL[k]}</option>)}
          </Select>
          <span className="ml-auto text-xs text-dim max-sm:shrink-0 max-sm:whitespace-nowrap">{rows.length} documenti · <b className="font-mono text-txt">{eur(cents(shownTot))}</b></span>
          </div>
        </div>
        {err && <Alert tone="err" className="mt-2">{err}</Alert>}
        {ficNote && <Alert tone={ficNote.ok ? "ok" : "warn"} className="mt-2" onClose={() => setFicNote(null)}>{ficNote.text}</Alert>}
      </Card>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm max-md:hidden">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-dim"><th className="px-3 py-2 font-semibold">Scadenza</th><th className="px-3 py-2 font-semibold">Numero</th><th className="px-3 py-2 font-semibold">Cliente</th><th className="px-3 py-2 text-right font-semibold">Totale</th><th className="px-3 py-2 text-right font-semibold">Residuo</th><th className="px-3 py-2 font-semibold">Stato</th><th className="px-3 py-2 text-right font-semibold">Azioni</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const overdue = r.days > 0;
              const rem = reminders[r.id];
              const c = remind === r.id ? contactOf(r) : null;
              return (
                <Fragment key={r.id}>
                  <tr onClick={() => router.push(`/documenti/${r.id}`)} {...keyActivate(() => router.push(`/documenti/${r.id}`))} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs" style={{ color: overdue ? "var(--err)" : "var(--dim)" }}>{r.due_date ? dmy(r.due_date) : "senza scadenza"}{overdue && <div className="text-[11px]">{r.days} gg di ritardo</div>}</td>
                    <td className="px-3 py-2.5 font-mono text-txt">{r.number_label}</td>
                    <td className="px-3 py-2.5"><div className="text-txt">{nameOf(r) || "—"}</div>{r.booking_code && <div className="text-[11px] text-faint">{r.booking_code}</div>}{rem && <div className="text-[11px] text-faint">Solleciti: {rem.count} · ultimo {fmtDate(rem.last)}</div>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{eur(cents(r.total_cents))}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(cents(r.residuo))}{r.credited > 0 && <div className="text-[11px] font-normal text-faint">dopo NC −{eur(cents(r.credited))}</div>}</td>
                    <td className="px-3 py-2.5"><Badge tone={overdue ? "err" : "warn"}>{overdue ? "Scaduto" : r.due_date ? "Da incassare" : "Senza scadenza"}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="secondary" size="sm" className="mr-1" onClick={() => openRemind(r)}>Sollecita</Button>
                      <Button variant="secondary" size="sm" className="text-ok" onClick={() => markPaid(r)} loading={busy === r.id}>Incassato</Button>
                    </td>
                  </tr>
                  {remind === r.id && c && (
                    <tr className="border-b border-line bg-wash/40">
                      <td colSpan={7} className="px-3 py-3">
                        {remindPanel(r, c)}
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

      {/* Telefono: una scheda per documento (la tabella serve da tablet in su) */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => {
          const overdue = r.days > 0;
          const rem = reminders[r.id];
          const c = remind === r.id ? contactOf(r) : null;
          return (
            <div key={r.id} className="rounded-xl border border-line bg-surface p-3 shadow-sm">
              <div onClick={() => router.push(`/documenti/${r.id}`)} {...keyActivate(() => router.push(`/documenti/${r.id}`))} className="cursor-pointer">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-txt">{nameOf(r) || "—"}</div>
                    <div className="truncate text-xs text-dim"><span className="font-mono">{r.number_label}</span>{r.booking_code ? <> · {r.booking_code}</> : null}</div>
                    {rem && <div className="text-[11px] text-faint">Solleciti: {rem.count} · ultimo {fmtDate(rem.last)}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-semibold text-txt">{eur(cents(r.residuo))}</div>
                    <div className="text-[11px] text-faint">{r.credited > 0 ? `dopo NC −${eur(cents(r.credited))}` : `su ${eur(cents(r.total_cents))}`}</div>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={overdue ? "err" : "warn"}>{overdue ? "Scaduto" : r.due_date ? "Da incassare" : "Senza scadenza"}</Badge>
                  <span style={{ color: overdue ? "var(--err)" : "var(--dim)" }}>{r.due_date ? dmy(r.due_date) : "senza scadenza"}{overdue ? ` · ${r.days} gg di ritardo` : ""}</span>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => openRemind(r)}>Sollecita</Button>
                <Button variant="secondary" className="text-ok" onClick={() => markPaid(r)} loading={busy === r.id}>Incassato</Button>
              </div>
              {remind === r.id && c && <div className="mt-3 border-t border-line pt-3">{remindPanel(r, c)}</div>}
            </div>
          );
        })}
        {!loading && rows.length === 0 && <div className="rounded-xl border border-line bg-surface"><EmptyState title="Nessun incasso in sospeso" sub={bucket === "all" && !q ? "Tutti i documenti emessi risultano saldati." : "Nessun documento con questi filtri."} /></div>}
      </div>
    </div>
  );
}
