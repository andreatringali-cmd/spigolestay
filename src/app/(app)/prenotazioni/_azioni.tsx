"use client";

// Finestra "Risolvi" di un passaggio della vista dettagliata: invece di portare su un'altra pagina, offre le azioni
// che chiudono davvero il problema (sollecitare l'ospite, mandare il link di pagamento, preparare/inviare la schedina…).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/invoicing/client";
import { useConfirm } from "@/components/ConfirmProvider";
import { shortenLink, buildGuestLink, buildGroupGuestLink } from "@/lib/guestlink";
import { chatPayGuestMessage } from "@/lib/chat-pay-core";
import { bookingPaidTotal } from "@/lib/booking";
import { googleReviewUrl, reviewRequestMessage } from "@/lib/reviews";
import { CHECKIN_MSG, CHECKIN_MORE_MSG, GUIDE_MSG, REMINDER_INTRO, greeting, langOf, markReminder, useReminderLog, whenLabel, agoLabel, REMINDER_COOLDOWN_MS, sendEmailToGuest, sendWhatsAppToGuest, type SendResult } from "@/lib/guest-messages";
import type { Booking, Guest, Structure } from "@/lib/types";
import type { JourneyStep } from "@/lib/booking-journey";
import { eur } from "@/lib/format";

export interface StepActionsProps {
  b: Booking;
  step: JourneyStep;
  guest?: Guest;
  structure?: Structure;
  checkinDone: boolean;
  schedina: "da_validare" | "pronta" | "inviata" | "none";
  istat: "pending" | "sent" | "none";
  paySentInChat: boolean;
  onClose: () => void;
  onSwitch: (key: string) => void;
  onChanged: () => void;
}

const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:opacity-50";
const btnPrimary = `${btn} border-transparent text-white hover:opacity-90`;
const btnGhost = `${btn} border-line bg-surface text-txt hover:border-focus hover:text-focus`;

export default function StepActions(p: StepActionsProps) {
  const { b, step, guest, structure } = p;
  const router = useRouter();
  const ask = useConfirm();
  const { updateBooking, openBooking, bookings, getUnit } = useData();
  const lang = langOf(guest);
  const [busy, setBusy] = useState("");
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const hist = useReminderLog([b])[b.id] ?? {}; // cronologia dei messaggi già inviati per questa prenotazione
  const lastTs = (k: string) => hist[k]?.[hist[k].length - 1]?.ts;
  const [force, setForce] = useState<Record<string, boolean>>({}); // invio sbloccato a mano dopo un messaggio recente
  const [amount, setAmount] = useState("");
  const [cfg, setCfg] = useState<{ auto: boolean; ready: boolean } | null>(null);
  const [draftDoc, setDraftDoc] = useState<{ id: string; stato: string } | null | undefined>(undefined); // fattura già creata per questa prenotazione (undefined = in verifica)
  const hasPhone = !!(guest?.phone ?? "").replace(/\D/g, "");
  const hasMail = !!guest?.email;
  const due = Math.max(0, bookingPaidTotal(b) - (b.paid ?? 0));

  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") p.onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [p]);

  // Invio automatico attivo? (Alloggiati Web e ISTAT, per la struttura della prenotazione)
  useEffect(() => {
    if (!supabase || (step.key !== "alloggiati" && step.key !== "istat")) return;
    let on = true;
    supabase.from(step.key === "alloggiati" ? "alloggiati_settings" : "istat_settings").select("auto_daily, username").eq("structure_id", b.structureId).maybeSingle()
      .then(({ data }) => { if (on) setCfg({ auto: !!data?.auto_daily, ready: !!data?.username }); });
    return () => { on = false; };
  }, [step.key, b.structureId]);

  // Fattura: c'è già un documento per questa prenotazione? In tal caso si apre, non se ne crea un altro.
  useEffect(() => {
    if (!supabase || step.key !== "invoice") return;
    let on = true;
    supabase.from("documents").select("id, stato").eq("booking_id", b.id).neq("stato", "scartata").order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (on) setDraftDoc((data as { id: string; stato: string } | null) ?? null); });
    return () => { on = false; };
  }, [step.key, b.id]);

  const run = async (key: string, fn: () => Promise<SendResult | { ok: boolean; message: string } | void>) => {
    setBusy(key); setRes(null);
    try { const r = await fn(); if (r) setRes({ ok: r.ok, text: r.message }); }
    catch (e) { setRes({ ok: false, text: e instanceof Error ? e.message : "Errore" }); }
    setBusy("");
  };
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const fullCheckin = `${origin}/checkin?b=${encodeURIComponent(b.id)}`;
  const intro = (kind: string) => (hist[kind]?.length ? REMINDER_INTRO[lang] : "");
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); return { ok: true, message: "Copiato negli appunti ✓" }; } catch { return { ok: false, message: "Copia non riuscita." }; } };

  // Cronologia di ciò che è già stato inviato per questo passaggio (evita di scrivere due volte all'ospite).
  const historyBox = (kind: string) => {
    const list = hist[kind] ?? [];
    if (!list.length) return <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-faint">Nessun messaggio inviato finora per questo passaggio.</p>;
    const last = list[list.length - 1];
    const recent = Date.now() - last.ts < REMINDER_COOLDOWN_MS;
    return (
      <div className="rounded-lg border border-line bg-paper px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-txt">Messaggi inviati: {list.length}</span><span className="text-dim">ultimo {agoLabel(last.ts)}</span></div>
        {recent && <div className="mt-1.5 rounded-md px-2 py-1 text-[11px] font-semibold" style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 14%, transparent)" }}>Hai scritto da poco ({whenLabel(last.ts)}): meglio aspettare prima di rimandare.</div>}
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-dim">
          {[...list].reverse().slice(0, 6).map((e, i) => <li key={i} className="flex justify-between gap-2"><span>{whenLabel(e.ts)}</span><span className="truncate text-faint">{e.via}</span></li>)}
          {list.length > 6 && <li className="text-faint">+ altri {list.length - 6} precedenti</li>}
        </ul>
      </div>
    );
  };
  // Messaggio recentissimo: l'invio resta BLOCCATO finché non lo sblocchi a mano (conferma esplicita).
  const isRecent = (kind: string) => { const l = lastTs(kind); return !!l && Date.now() - l < REMINDER_COOLDOWN_MS && !force[kind]; };
  const unlock = async (kind: string) => {
    const last = lastTs(kind);
    if (!last) return;
    if (await ask({ title: "Hai già scritto da poco", message: `L'ultimo messaggio è partito ${agoLabel(last)} (${whenLabel(last)}). Mandarne un altro adesso rischia di infastidire l'ospite. Sbloccare l'invio?`, confirmLabel: "Sblocca l'invio", danger: true })) setForce((f) => ({ ...f, [kind]: true }));
  };

  // Invio di un testo su WhatsApp o email + registro "inviato".
  const deliver = async (via: "wa" | "mail", text: string, subject: string, remKind: string, after?: () => void) => {
    const meta = { bid: b.id, rem: remKind };
    const r = via === "wa" ? await sendWhatsAppToGuest(guest, text, meta) : await sendEmailToGuest(guest, subject, text, structure, meta);
    if (r.ok) { markReminder(b.id, remKind); after?.(); p.onChanged(); }
    return r;
  };
  const sendButtons = (build: () => Promise<{ text: string; subject: string }>, remKind: string, label: string, after?: () => void) => (
    <>
    {historyBox(remKind)}
    <div className="flex flex-wrap gap-2">
      <button className={btnPrimary} style={{ background: "#25D366" }} disabled={!!busy || !hasPhone || isRecent(remKind)} title={hasPhone ? (isRecent(remKind) ? "Inviato da poco: sbloccalo qui sotto se serve davvero" : "") : "Manca il telefono dell'ospite"} onClick={() => run("wa", async () => { const m = await build(); return deliver("wa", m.text, m.subject, remKind, after); })}>{busy === "wa" ? "Invio…" : `WhatsApp · ${label}`}</button>
      <button className={btnPrimary} style={{ background: "var(--focus)" }} disabled={!!busy || !hasMail || isRecent(remKind)} title={hasMail ? (isRecent(remKind) ? "Inviato da poco: sbloccalo qui sotto se serve davvero" : "") : "Manca l'email dell'ospite"} onClick={() => run("mail", async () => { const m = await build(); return deliver("mail", m.text, m.subject, remKind, after); })}>{busy === "mail" ? "Invio…" : `Email · ${label}`}</button>
      <button className={btnGhost} disabled={!!busy} onClick={() => run("copy", async () => { const m = await build(); return copy(m.text); })}>Copia testo</button>
    </div>
    {isRecent(remKind) && <button className="self-start text-xs font-semibold text-[color:var(--err)] underline" onClick={() => void unlock(remKind)}>Invio bloccato: ho scritto da poco. Sblocca comunque</button>}
    </>
  );

  const guideUrl = () => {
    const group = b.groupId ? bookings.filter((x) => x.groupId === b.groupId) : [b];
    if (group.length > 1) return buildGroupGuestLink({ structureId: b.structureId, guestName: guest?.fullName || "", rooms: group.map((bb) => ({ unitId: bb.unitId, unitCode: getUnit(bb.unitId)?.code || getUnit(bb.unitId)?.name || "", parking: !!bb.parking })) });
    const u = getUnit(b.unitId);
    return buildGuestLink({ structureId: b.structureId, unitId: b.unitId, unitCode: u?.code || u?.name || "", guestName: guest?.fullName || "", parking: !!b.parking });
  };

  // ── Contenuti per passaggio ──
  let body: React.ReactNode = null;

  if (step.key === "checkin") {
    // Quanti ospiti hanno dato i dati e quanti ne servono (stessa regola di Adempimenti).
    const exp = Math.max(1, (b.adults ?? 1) + (b.children ?? 0));
    const dec = (b.webCheckin === true || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber) ? 1 : 0) + (b.extraGuests?.filter((e) => !!(e.lastName || e.firstName)).length ?? 0);
    const partial = dec > 0 && dec < exp;
    const missing = exp - dec;
    const build = async () => {
      const url = await shortenLink(fullCheckin);
      const core = partial ? CHECKIN_MORE_MSG[lang](missing, url) : CHECKIN_MSG[lang](url);
      return { text: `${intro("checkin")}${greeting(lang, guest)}${core}`, subject: `Check-in online${structure?.name ? ` · ${structure.name}` : ""}` };
    };
    body = (<>
      <p className="text-sm text-dim">{partial
        ? <>L'ospite ha compilato il check-in per <b>{dec} persona su {exp}</b>: <b>mancano i dati di {missing} {missing === 1 ? "ospite" : "ospiti"}</b>. Per la schedina Questura servono i dati di tutti, anche dei bambini. Puoi <b>sollecitare</b> (il modulo si riapre vuoto: l'ospite deve compilare di nuovo i dati di tutti) o <b>compilare tu</b> con i dati già salvati. Se in realtà sono meno persone, correggi il numero degli ospiti nella prenotazione.</>
        : <>L'ospite non ha ancora completato il check-in online. Puoi <b>sollecitarlo</b> (riceve il link) oppure <b>compilarlo tu</b> con i suoi dati.</>}</p>
      {sendButtons(build, "checkin", partial ? "Chiedi gli altri ospiti" : "Sollecita")}
      <div className="flex flex-wrap gap-2">
        <button className={btnGhost} onClick={() => { const w = window.open(fullCheckin, "_blank"); if (!w) window.location.href = fullCheckin; }}>Compila io (apri il modulo)</button>
        <button className={btnGhost} onClick={() => { p.onClose(); openBooking(b.id); }}>{partial ? "Apri la prenotazione (dati o numero ospiti)" : "Inserisci i dati nella scheda"}</button>
      </div>
    </>);
  } else if (step.key === "pay" || step.key === "tax") {
    const kind = step.key === "pay" ? "saldo" : "tassa";
    const remKind = `pay-${kind}`;
    const sent = (hist[remKind]?.length ?? 0) > 0 || (kind === "saldo" && p.paySentInChat);
    const mk = async () => {
      const asked = amount.trim() ? Number(amount.replace(",", ".")) : undefined;
      if (asked !== undefined && (!isFinite(asked) || asked <= 0)) throw new Error("Importo non valido.");
      const r = await apiPost<{ ok: boolean; url: string; amount: number }>("stripe/chat-pay", { bookingId: b.id, kind, ...(asked !== undefined ? { amount: asked } : {}) });
      return { text: `${intro(remKind) || (sent ? REMINDER_INTRO[lang] : "")}${greeting(lang, guest)}${chatPayGuestMessage(lang, kind, Math.round(r.amount * 100), r.url)}`, subject: `${structure?.name ? structure.name + " · " : ""}${kind === "saldo" ? "Saldo del soggiorno" : "Tassa di soggiorno"}` };
    };
    const manual = async () => {
      if (kind === "saldo") {
        const amt = amount.trim() ? Number(amount.replace(",", ".")) : due;
        if (!isFinite(amt) || amt <= 0) return { ok: false, message: "Importo non valido." };
        if (!(await ask({ title: "Registra incasso", message: `Segnare come incassati ${eur(amt)} per questa prenotazione?`, confirmLabel: "Registra incasso" }))) return;
        updateBooking(b.id, { paid: Math.round(((b.paid ?? 0) + amt) * 100) / 100 });
      } else {
        if (!(await ask({ title: "Tassa di soggiorno", message: "Segnare la tassa di soggiorno come incassata?", confirmLabel: "Sì, incassata" }))) return;
        updateBooking(b.id, { cityTaxPaid: true });
      }
      p.onChanged();
      return { ok: true, message: "Registrato ✓" };
    };
    body = (<>
      <p className="text-sm text-dim">{kind === "saldo" ? `Mancano ${eur(due)} sul soggiorno.` : "La tassa di soggiorno non risulta incassata."} {sent
        ? <><b>Il link di pagamento è già stato inviato</b>{lastTs(remKind) ? ` (${whenLabel(lastTs(remKind)!)})` : " in chat"}: l'ospite non ha ancora pagato. Puoi <b>sollecitarlo</b> con un nuovo messaggio.</>
        : <><b>Non hai ancora mandato il link di pagamento.</b> Invialo adesso: quando l'ospite paga, l'incasso si registra da solo.</>}</p>
      <label className="flex items-center gap-2 text-xs text-dim">Importo (lascia vuoto per tutto il residuo)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={kind === "saldo" ? eur(due) : "tutta la tassa"} className="w-32 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />
      </label>
      {sendButtons(mk, remKind, sent ? "Sollecita il pagamento" : "Invia link di pagamento")}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <span className="w-full text-xs text-faint">Ha pagato in contanti o con altro mezzo?</span>
        <button className={btnGhost} disabled={!!busy} onClick={() => run("manual", manual)}>{kind === "saldo" ? "Registra incasso a mano" : "Segna tassa incassata"}</button>
      </div>
    </>);
  } else if (step.key === "alloggiati" || step.key === "istat") {
    const isQ = step.key === "alloggiati";
    const name = isQ ? "schedina alla Questura (Alloggiati Web)" : "comunicazione all'Osservatorio turistico (ISTAT)";
    const st = isQ ? p.schedina : (p.istat === "pending" ? "pronta" : p.istat === "sent" ? "inviata" : "none");
    if (!p.checkinDone) {
      body = (<>
        <p className="text-sm text-dim">Senza il check-in online dell'ospite non si può preparare la {name}: mancano i dati e il documento. Qui non c'è nulla da fare finché non lo completa.</p>
        <div className="flex flex-wrap gap-2"><button className={btnPrimary} style={{ background: "var(--focus)" }} onClick={() => p.onSwitch("checkin")}>Vai al check-in: sollecita o compila</button></div>
      </>);
    } else {
      body = (<>
        <p className="text-sm text-dim">Il check-in è completo. {st === "inviata" ? "Già inviata." : st === "da_validare" ? "La schedina ha dati da correggere." : st === "pronta" ? "È pronta da inviare." : "La " + name + " non è ancora stata preparata."}</p>
        <div className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-dim">
          {cfg === null ? "Controllo le impostazioni…" : !cfg.ready ? <>Credenziali non impostate per questa struttura: l'invio non può partire, né in automatico né a mano. <button className="font-semibold text-focus underline" onClick={() => router.push(isQ ? "/alloggiati-web" : "/istat")}>Impostale ora</button></> : cfg.auto
            ? <><b className="text-[color:var(--ok)]">Invio automatico attivo</b>: {isQ ? "le schedine pronte partono da sole ogni sera (entro 24 ore dall'arrivo)." : "il movimento viene chiuso e inviato ogni giorno in automatico."} Non devi fare nulla, a meno che manchi qualcosa.</>
            : <><b className="text-[color:var(--warn)]">Invio automatico spento</b>: lo invii tu. Puoi attivarlo dalle impostazioni {isQ ? "di Alloggiati Web" : "ISTAT"}.</>}
        </div>
        <div className="flex flex-wrap gap-2">
          {st === "none" && <button className={btnPrimary} style={{ background: "var(--focus)" }} disabled={!!busy} onClick={() => run("prep", async () => { await apiPost(isQ ? "alloggiati/sync" : "istat/sync", { structureId: b.structureId }); p.onChanged(); return { ok: true, message: "Preparata ✓ Controlla lo stato qui sopra tra un istante." }; })}>{busy === "prep" ? "Preparo…" : `Prepara ${isQ ? "la schedina" : "i dati"}`}</button>}
          {st === "da_validare" && <button className={btnPrimary} style={{ background: "var(--warn)" }} onClick={() => { p.onClose(); openBooking(b.id); }}>Correggi i dati dell'ospite</button>}
          {isQ && st === "pronta" && <button className={btnPrimary} style={{ background: "var(--err)" }} disabled={!!busy || (cfg !== null && !cfg.ready)} onClick={() => run("send", async () => {
            if (!(await ask({ title: "Invia alla Questura", message: `Invio alla Questura tutte le schedine pronte di ${structure?.name ?? "questa struttura"}, non solo questa. L'invio è definitivo. Procedere?`, confirmLabel: "Invia alla Questura", danger: true }))) return;
            const r = await apiPost<{ message?: string; sent?: number }>("alloggiati/send", { structureId: b.structureId }); p.onChanged();
            return { ok: true, message: r.message || `Inviate: ${r.sent ?? 0}` };
          })}>{busy === "send" ? "Invio…" : "Invia ora alla Questura"}</button>}
          <button className={btnGhost} onClick={() => router.push(isQ ? "/alloggiati-web" : "/istat")}>{isQ ? "Apri Alloggiati Web" : "Apri Osservatorio"}</button>
        </div>
      </>);
    }
  } else if (step.key === "guide") {
    const build = async () => ({ text: `${intro("guide")}${greeting(lang, guest)}${GUIDE_MSG[lang](await shortenLink(guideUrl()))}`, subject: `Guida ospiti${structure?.name ? ` · ${structure.name}` : ""}` });
    body = (<>
      <p className="text-sm text-dim">La guida ospiti (check-in, Wi-Fi, dintorni, codici della camera) non risulta inviata. Mandala adesso all'ospite.</p>
      {sendButtons(build, "guide", "Invia la guida")}
    </>);
  } else if (step.key === "invoice") {
    const ir = b.invoiceRequest;
    const filled = ir ? [ir.name, ir.vat || ir.taxCode, ir.address].filter(Boolean).length : 0;
    body = (<>
      <p className="text-sm text-dim">
        {draftDoc ? <>La fattura è già stata creata ({draftDoc.stato === "bozza" ? "bozza" : draftDoc.stato}): aprila per controllare i dati ed emetterla.</>
          : <>{ir && filled ? "L'ospite ha inserito i suoi dati di fatturazione: li trovi già compilati nella bozza (intestatario, partita IVA o codice fiscale, indirizzo, codice destinatario e PEC)." : "Creo la bozza dai dati della prenotazione, compilata con quanto l'ospite ha lasciato al check-in."}</>}
      </p>
      {ir && filled > 0 && !draftDoc && (
        <div className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-dim">
          <b className="text-txt">{ir.name || guest?.fullName}</b>{ir.vat ? ` · P.IVA ${ir.vat}` : ""}{ir.taxCode ? ` · CF ${ir.taxCode}` : ""}{ir.address ? ` · ${[ir.address, ir.cap, ir.city, ir.province].filter(Boolean).join(" ")}` : ""}{ir.sdiCode ? ` · SDI ${ir.sdiCode}` : ""}{ir.pec ? ` · PEC ${ir.pec}` : ""}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {draftDoc
          ? <button className={btnPrimary} style={{ background: "var(--focus)" }} onClick={() => { p.onClose(); router.push(`/documenti/${draftDoc.id}`); }}>{draftDoc.stato === "bozza" ? "Apri la bozza" : "Apri la fattura"}</button>
          : <button className={btnPrimary} style={{ background: "var(--focus)" }} disabled={!!busy || draftDoc === undefined} onClick={() => run("inv", async () => { const r = await apiPost<{ documentId: string }>("invoicing/create", { bookingId: b.id }); p.onClose(); p.onChanged(); router.push(`/documenti/${r.documentId}`); })}>{busy === "inv" ? "Creo…" : "Crea la fattura"}</button>}
      </div>
    </>);
  } else if (step.key === "review") {
    const url = googleReviewUrl(structure?.googlePlaceId);
    const build = async () => ({ text: reviewRequestMessage({ guestName: guest?.fullName, structureName: structure?.name, reviewUrl: url }), subject: `Com'è andato il soggiorno${structure?.name ? ` da ${structure.name}` : ""}?` });
    body = url ? (<>
      <p className="text-sm text-dim">L'ospite è partito: una richiesta di recensione ora ha più probabilità di essere accolta.</p>
      {sendButtons(build, "review", "Richiedi la recensione", () => updateBooking(b.id, { reviewRequestedAt: Date.now(), reviewRequestChannel: "whatsapp" }))}
    </>) : (<>
      <p className="text-sm text-dim">Per chiedere la recensione serve il Google Place ID della struttura: non è ancora impostato.</p>
      <div className="flex flex-wrap gap-2"><button className={btnPrimary} style={{ background: "var(--focus)" }} onClick={() => router.push("/strutture")}>Imposta il Google Place ID</button></div>
    </>);
  } else {
    body = (<>
      <p className="text-sm text-dim">{step.detail}.</p>
      {step.href && <div className="flex flex-wrap gap-2"><button className={btnGhost} onClick={() => router.push(step.href!)}>Apri la pagina</button></div>}
    </>);
  }

  const guestLabel = guest?.fullName || [b.primaryGuest?.firstName, b.primaryGuest?.lastName].filter(Boolean).join(" ") || "Ospite";
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center">
      <button aria-label="Chiudi" onClick={p.onClose} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <div role="dialog" aria-label={step.label} className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="border-b border-line px-5 py-3.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{step.label}</div>
          <div className="text-base font-bold text-txt">{guestLabel}</div>
          <div className="text-xs" style={{ color: step.state === "late" ? "var(--err)" : "var(--dim)" }}>{step.detail}</div>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {body}
          {res && <div className="rounded-lg px-3 py-2 text-sm font-medium" style={{ color: res.ok ? "var(--ok)" : "var(--err)", background: `color-mix(in srgb, ${res.ok ? "var(--ok)" : "var(--err)"} 12%, transparent)` }}>{res.text}</div>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line bg-wash px-5 py-3">
          <button className="text-sm font-semibold text-focus hover:underline" onClick={() => { p.onClose(); openBooking(b.id); }}>Apri la prenotazione</button>
          <button className={btnGhost} onClick={p.onClose}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
