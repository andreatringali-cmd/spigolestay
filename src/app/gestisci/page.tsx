"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { GuestLangPicker, useGuestLang } from "@/components/GuestLang";
import { dateLocale } from "@/lib/guest-i18n";
import DateField from "@/components/DateField";
import { fmtDate, shiftISO } from "@/lib/dates";
import { todayRome, ymdRome } from "@/lib/dates-rome";
import { eur as eurIT } from "@/lib/format";

// Pagina PUBBLICA di gestione prenotazione per l'ospite (link nell'email di conferma).
// Mostra riepilogo + condizioni di cancellazione e consente: annullare (con rimborso
// automatico se entro policy), richiedere una modifica date, fare il check-in / aggiungere extra.

const box = "rounded-xl border border-line bg-surface";
const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-base text-txt outline-none focus:border-focus sm:text-sm";

// Importi in formato italiano con 2 decimali (€ 45,50 · € 1.234,00); con un'altra valuta cambia solo il simbolo.
const eur = (v: number, cur = "€") => eurIT(v || 0).replace("€", cur);
const fmtDL = (iso: string | undefined, locale: string) => { if (!iso) return ""; try { return `${new Date(iso + "T00:00:00").toLocaleDateString(locale, { weekday: "short" })} ${fmtDate(iso)}`; } catch { return iso; } };

interface Info {
  booking: {
    code: string; status: string; checkIn: string; checkOut: string; adults: number; children: number;
    total: number; paid: number; roomType: string; ratePlan: string; refundable: boolean; cancelDays: number;
    cancelPolicy: string; free: boolean; freeUntil: string | null; canRefund: boolean; refundAmount?: number;
    cancelledAt: string | null; refundedAmount: number; guestFirst: string; guestLang?: string | null;
    // Facoltativi (se il server li fornisce): totale con tassa/pulizia/extra, residuo, annullabile da qui?, canale di prenotazione.
    grandTotal?: number; balance?: number; cancellable?: boolean; channel?: string;
    // Facoltativo: importo pagato e non ancora rimborsato su una prenotazione annullata (la struttura deve restituirlo a mano).
    unrefunded?: number;
  };
  structure: { name: string; color: string; logo?: string; phone: string; email: string; checkInFrom: string; checkOutBy: string; currency: string };
}

// Errori noti delle API di gestione → testo italiano (chiave del dizionario): la pagina li traduce nella lingua dell'ospite.
const CANCEL_ERR: Record<string, string> = {
  not_cancellable: "Questa prenotazione non può essere annullata da qui: contatta la struttura.",
  stay_started: "Il soggiorno è già iniziato o concluso: contatta la struttura.",
  stripe_not_configured: "Rimborso non disponibile al momento: riprova più tardi o contatta la struttura.",
  refund_failed: "Non siamo riusciti a rimborsare il pagamento, quindi la prenotazione NON è stata annullata. Riprova tra qualche minuto o contatta la struttura.",
  troppe_richieste: "Troppi tentativi ravvicinati. Attendi un minuto e riprova.",
  write_conflict: "Riprova tra un istante.",
  not_found: "Prenotazione non trovata.",
};

export default function GestisciPage() {
  return <Suspense fallback={null}><Engine /></Suspense>;
}

function Engine() {
  const params = useMemo(() => { try { const u = new URLSearchParams(window.location.search); return { slug: u.get("site") || "", b: u.get("b") || "" }; } catch { return { slug: "", b: "" }; } }, []);
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // Lingua: scelta a mano > ?lang= > ricavata dalla prenotazione (scheda → Paese → prefisso del telefono) > browser > italiano.
  const { lang, setLang, t } = useGuestLang(info?.booking.guestLang);
  const fmtD = (iso?: string) => fmtDL(iso, dateLocale(lang));

  // Azioni
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<null | { refunded: number; free: boolean }>(null);
  const [modOpen, setModOpen] = useState(false);
  const [modCi, setModCi] = useState("");
  const [modCo, setModCo] = useState("");
  const [modMsg, setModMsg] = useState("");
  const [modSent, setModSent] = useState(false);
  // "Oggi" = data di Roma (come il server in manage-booking), NON il fuso del browser dell'ospite: vale per il min dei DateField e per i controlli sulle date.
  const todayLocal = todayRome();
  const nPlural = (n: number, one: string, many: string) => `${n} ${n === 1 ? t(one) : t(many)}`;

  const load = async () => {
    if (!params.slug || !params.b) { setErr("Link non valido."); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/manage-booking?slug=${encodeURIComponent(params.slug)}&b=${encodeURIComponent(params.b)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setErr(j?.error === "not_found" ? "Prenotazione non trovata." : "Impossibile caricare la prenotazione."); setInfo(null); }
      else setInfo(j as Info);
    } catch { setErr("Errore di rete."); }
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const doCancel = async () => {
    setWorking(true);
    try {
      const r = await fetch("/api/manage-booking/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: params.slug, b: params.b }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) { setResult({ refunded: j.refunded || 0, free: !!j.free }); setConfirmCancel(false); await load(); }
      else setErr(CANCEL_ERR[String(j?.error || "")] ?? (r.status === 429 ? CANCEL_ERR.troppe_richieste : "Annullamento non riuscito."));
    } catch { setErr("Errore di rete."); }
    setWorking(false);
  };

  const doModify = async () => {
    if (modCi && modCo && modCo <= modCi) { setErr("Il check-out deve essere dopo il check-in."); return; }
    if ((modCi && modCi < todayLocal) || (modCo && modCo < todayLocal)) { setErr("Le nuove date non possono essere nel passato."); return; }
    setErr("");
    setWorking(true);
    try {
      const r = await fetch("/api/manage-booking/modify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: params.slug, b: params.b, ci: modCi || undefined, co: modCo || undefined, message: modMsg || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) { setModSent(true); setModOpen(false); }
      else setErr(j?.error === "empty_request" ? "Indica le nuove date o scrivi un messaggio." : j?.error === "cancelled" ? "Questa prenotazione è già stata annullata." : r.status === 429 || j?.error === "troppe_richieste" ? CANCEL_ERR.troppe_richieste : j?.error === "write_conflict" ? CANCEL_ERR.write_conflict : "Invio non riuscito.");
    } catch { setErr("Errore di rete."); }
    setWorking(false);
  };

  const accent = info?.structure.color || "#285f92";
  const header = (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        {info?.structure.logo
          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={info.structure.logo} alt={info.structure.name || "Logo"} className="h-9 w-auto max-w-[150px] rounded-md bg-white object-contain" />
          : <div className="grid h-9 w-9 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: accent }}>{(info?.structure.name ?? "XN").slice(0, 2).toUpperCase()}</div>}
        <div className="leading-tight"><div className="text-sm font-bold text-txt">{info?.structure.name ?? "Xenora"}</div><div className="text-[11px] text-faint">{t("Gestione prenotazione")}</div></div>
        <div className="ml-auto"><GuestLangPicker lang={lang} setLang={setLang} label={t("Lingua")} /></div>
      </div>
    </div>
  );

  if (loading) return <div className="min-h-full bg-wash">{header}<div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-dim">{t("Carico la prenotazione…")}</div></div>;

  if (!info) return (
    <div className="min-h-full bg-wash">{header}
      <div className="mx-auto max-w-md px-4 py-16">
        <div className={`${box} p-6 text-center`}>
          <div className="text-3xl">🔎</div>
          <h1 className="mt-2 font-display text-lg font-bold text-txt">{err ? t(err) : t("Prenotazione non trovata")}</h1>
          <p className="mt-1 text-sm text-dim">{t("Usa il link ricevuto nell'email di conferma. Se il problema persiste, contatta la struttura.")}</p>
        </div>
      </div>
    </div>
  );

  const b = info.booking;
  const st = info.structure;
  const cur = st.currency || "€";
  const cancelled = b.status === "cancelled";
  const nights = (() => { try { return Math.max(1, Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86400000)); } catch { return 1; } })();
  // Il residuo vale solo se calcolato dal server con la stessa funzione del resto dell'app (soggiorno + pulizia + extra + tassa − pagato): total − paid ignorerebbe tassa, pulizia ed extra.
  const balance = typeof b.balance === "number" ? Math.max(0, b.balance) : null;
  const grand = typeof b.grandTotal === "number" && b.grandTotal > 0 ? b.grandTotal : null;
  // Annullamento da qui: non per prenotazioni dei portali (Booking.com, Airbnb…) né a soggiorno iniziato.
  const stayStarted = !!b.checkIn && b.checkIn <= todayLocal;
  const viaPortal = b.cancellable === false || (!!b.channel && b.channel !== "direct");
  const cancelBlocked = stayStarted ? "Il soggiorno è già iniziato o concluso: per qualsiasi modifica contatta la struttura." : viaPortal ? "Questa prenotazione è stata fatta tramite un portale (es. Booking.com, Airbnb): per annullarla usa il portale o contatta la struttura." : "";
  const cancelPolicyText = !b.refundable ? t("Tariffa non rimborsabile.") : b.cancelDays === 1 ? t("Cancellazione gratuita fino a 1 giorno prima dell'arrivo.") : b.cancelDays > 0 ? t("Cancellazione gratuita fino a {n} giorni prima dell'arrivo.", { n: b.cancelDays }) : t("Cancellazione gratuita.");
  const checkinUrl = `/checkin?site=${encodeURIComponent(params.slug)}&b=${encodeURIComponent(params.b)}`;

  return (
    <div className="min-h-full bg-wash pb-16">{header}
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* Riepilogo */}
        <div className={`${box} mb-4 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-display text-xl font-bold text-txt">{t("Ciao {name}!", { name: b.guestFirst || t("ospite") })}</div>
              <div className="mt-0.5 text-sm text-dim">{b.roomType}{b.ratePlan ? ` · ${t(b.ratePlan)}` : ""} · {nPlural(b.adults, "adulto", "adulti")}{b.children ? ` · ${nPlural(b.children, "bambino", "bambini")}` : ""} · {nPlural(nights, "notte", "notti")}</div>
            </div>
            <div className="rounded-lg bg-wash px-3 py-1.5 text-right">
              <div className="text-[10px] uppercase tracking-wide text-faint">{t("Codice")}</div>
              <div className="font-mono text-sm font-bold" style={{ color: accent }}>{b.code}</div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-paper px-4 py-3">
            <div><div className="text-[11px] text-faint">{t("Check-in")}</div><div className="text-sm font-semibold text-txt">{fmtD(b.checkIn)}</div>{st.checkInFrom && <div className="text-[11px] text-faint">{t("dalle {time}", { time: st.checkInFrom })}</div>}</div>
            <div className="text-faint">→</div>
            <div className="text-right"><div className="text-[11px] text-faint">{t("Check-out")}</div><div className="text-sm font-semibold text-txt">{fmtD(b.checkOut)}</div>{st.checkOutBy && <div className="text-[11px] text-faint">{t("entro le {time}", { time: st.checkOutBy })}</div>}</div>
          </div>
          {(b.total > 0) && (
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-dim">{t("Totale soggiorno")}</span><span className="font-mono text-txt">{eur(b.total, cur)}</span></div>
              {b.paid > 0 && <div className="flex justify-between"><span className="text-dim">{t("Acconto versato")}</span><span className="font-mono" style={{ color: "var(--ok)" }}>−{eur(b.paid, cur)}</span></div>}
              {grand !== null && grand !== b.total && <div className="flex justify-between"><span className="text-dim">{t("Totale prenotazione")}</span><span className="font-mono text-txt">{eur(grand, cur)}</span></div>}
              {balance !== null && balance > 0 && <div className="flex justify-between border-t border-line pt-1"><span className="font-semibold text-txt">{t("Saldo in struttura")}</span><span className="font-mono font-bold text-txt">{eur(balance, cur)}</span></div>}
            </div>
          )}
        </div>

        {/* Stato annullata */}
        {cancelled ? (
          <div className={`${box} p-5`}>
            <div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full text-white" style={{ backgroundColor: "var(--err)" }}>✕</span><h2 className="font-display text-lg font-bold text-txt">{t("Prenotazione annullata")}</h2></div>
            <p className="mt-2 text-sm text-dim">{b.cancelledAt ? t("Questa prenotazione è stata annullata il {date}.", { date: fmtD(/T/.test(b.cancelledAt) ? ymdRome(b.cancelledAt) : b.cancelledAt.slice(0, 10)) }) : t("Questa prenotazione è stata annullata.")}</p>
            <div className="mt-3 rounded-lg border border-line bg-paper px-4 py-3 text-sm">
              {b.refundedAmount > 0
                ? <span style={{ color: "var(--ok)" }}>{t("Rimborso emesso: {amount} — l'importo torna sul metodo di pagamento entro 5–10 giorni lavorativi.", { amount: eur(b.refundedAmount, cur) })}</span>
                : (b.unrefunded ?? 0) > 0
                  ? <span className="text-dim">{t("La struttura ti contatterà per il rimborso.")}</span>
                  : <span className="text-dim">{t("Nessun rimborso previsto per questa tariffa.")}</span>}
            </div>
          </div>
        ) : (
          <>
            {/* Condizioni di cancellazione */}
            <div className={`${box} mb-4 p-5`}>
              <h2 className="mb-1 font-display text-base font-bold text-txt">{t("Condizioni di cancellazione")}</h2>
              <p className="text-sm text-dim">{cancelPolicyText}</p>
              {b.refundable && b.freeUntil && (
                <div className="mt-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ backgroundColor: b.free ? "color-mix(in srgb, var(--ok) 12%, transparent)" : "color-mix(in srgb, var(--warn) 14%, transparent)", color: b.free ? "var(--ok)" : "var(--warn)" }}>
                  {b.free ? t("✓ Puoi annullare gratis fino al {date}.", { date: fmtD(b.freeUntil) }) : t("La cancellazione gratuita è scaduta il {date}.", { date: fmtD(b.freeUntil) })}
                </div>
              )}
            </div>

            {result && (
              <div className="mb-4 rounded-lg px-4 py-3 text-sm font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 12%, transparent)", color: "var(--ok)" }}>
                {result.refunded > 0 ? t("✓ Prenotazione annullata e rimborso di {amount} emesso.", { amount: eur(result.refunded, cur) }) : t("✓ Prenotazione annullata.")}
              </div>
            )}
            {err && <div className="mb-4 rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)", color: "var(--err)" }}>{t(err)}</div>}

            {/* Azioni */}
            <div className={`${box} p-5`}>
              <h2 className="mb-3 font-display text-base font-bold text-txt">{t("Cosa vuoi fare?")}</h2>
              <div className="flex flex-col gap-2.5">
                <a href={checkinUrl} className="flex items-center justify-between rounded-lg border border-line bg-paper px-4 py-3 text-sm font-semibold text-txt hover:border-focus">
                  <span>📝 {t("Check-in online / aggiungi servizi extra")}</span><span className="text-faint">→</span>
                </a>

                {!modSent ? (
                  <button onClick={() => setModOpen((v) => !v)} className="flex items-center justify-between rounded-lg border border-line bg-paper px-4 py-3 text-sm font-semibold text-txt hover:border-focus">
                    <span>📅 {t("Richiedi modifica date")}</span><span className="text-faint">{modOpen ? "▾" : "→"}</span>
                  </button>
                ) : (
                  <div className="rounded-lg border border-line bg-paper px-4 py-3 text-sm" style={{ color: "var(--ok)" }}>{t("✓ Richiesta di modifica inviata alla struttura. Ti risponderanno per confermare.")}</div>
                )}
                {modOpen && !modSent && (
                  <div className="rounded-lg border border-line bg-wash p-3">
                    <p className="mb-2 text-xs text-dim">{t("La struttura verificherà la disponibilità e ti confermerà le nuove date (e l'eventuale differenza di prezzo).")}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-faint">{t("Nuovo check-in")}<DateField lang={lang} value={modCi} min={todayLocal} onChange={(v) => { setModCi(v); if (v && modCo && modCo <= v) setModCo(""); }} className={`${field} mt-1 w-full text-left`} /></label>
                      <label className="text-[11px] text-faint">{t("Nuovo check-out")}<DateField lang={lang} value={modCo} min={shiftISO(modCi && modCi >= todayLocal ? modCi : todayLocal, 1)} onChange={(v) => setModCo(v)} className={`${field} mt-1 w-full text-left`} /></label>
                    </div>
                    <textarea value={modMsg} onChange={(e) => setModMsg(e.target.value)} rows={2} placeholder={t("Messaggio (facoltativo): es. arriviamo un giorno dopo…")} className={`${field} mt-2 resize-y`} />
                    <button onClick={doModify} disabled={working} className="mt-2 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{working ? t("Invio…") : t("Invia richiesta")}</button>
                  </div>
                )}

                {cancelBlocked ? (
                  <div className="rounded-lg border border-line bg-wash px-4 py-3">
                    <button type="button" disabled className="flex w-full items-center justify-between text-sm font-semibold opacity-50" style={{ color: "var(--err)" }}><span>✕ {t("Annulla prenotazione")}</span></button>
                    <p className="mt-1.5 text-xs text-dim">{t(cancelBlocked)}</p>
                  </div>
                ) : !confirmCancel ? (
                  <button onClick={() => { setConfirmCancel(true); setErr(""); }} className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-semibold hover:opacity-90" style={{ borderColor: "var(--err)", color: "var(--err)" }}>
                    <span>✕ {t("Annulla prenotazione")}</span><span>→</span>
                  </button>
                ) : (
                  <div className="rounded-lg border p-3" style={{ borderColor: "var(--err)" }}>
                    <p className="text-sm font-semibold text-txt">{t("Confermi l'annullamento?")}</p>
                    <p className="mt-1 text-xs text-dim">
                      {b.canRefund
                        ? t("Riceverai un rimborso automatico di {amount} sul metodo di pagamento usato.", { amount: eur(b.refundAmount ?? b.paid, cur) })
                        : b.paid > 0
                          ? t("Questa tariffa non prevede rimborso: l'acconto versato non sarà restituito.")
                          : t("Nessun importo è stato pagato online.")}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button onClick={doCancel} disabled={working} className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "var(--err)" }}>{working ? t("Annullo…") : t("Sì, annulla")}</button>
                      <button onClick={() => setConfirmCancel(false)} disabled={working} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-txt hover:bg-wash">{t("Torna indietro")}</button>
                    </div>
                  </div>
                )}
              </div>

              {(st.phone || st.email) && (
                <div className="mt-4 border-t border-line pt-3 text-xs text-dim">
                  {t("Hai bisogno d'aiuto? Contatta la struttura")}{st.phone ? <> · <a href={`tel:${st.phone}`} className="text-focus hover:underline">{st.phone}</a></> : ""}{st.email ? <> · <a href={`mailto:${st.email}`} className="text-focus hover:underline">{st.email}</a></> : ""}.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
