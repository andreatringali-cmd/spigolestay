"use client";

// Menu discreto «Segnala all'OTA» nella scheda prenotazione (SOLO Booking.com via Channex).
// ALTO RISCHIO: ogni azione ha effetti reali su ospite e commissioni, quindi parte SOLO dopo
// un click esplicito + finestra di conferma che spiega l'effetto e richiede di scrivere una
// parola. Nessun automatismo la richiama. L'esito viene accodato alla nota della prenotazione.
import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { ymdRome } from "@/lib/dates-rome";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { apiPost } from "@/lib/invoicing/client";
import type { Booking } from "@/lib/types";
import {
  OTA_ACTIONS, OTA_ACTION_INFO, canReportToOta, channexBookingIdFromExtId, otaLogLine, windowHint, type OtaAction,
} from "@/lib/channex-booking-actions";

export default function OtaReportMenu({ booking }: { booking: Booking }) {
  const { t } = useLang();
  const { bookings, updateBooking } = useData();
  const [pending, setPending] = useState<OtaAction | null>(null);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!canReportToOta(booking)) return null;
  const chxId = channexBookingIdFromExtId(booking.extId)!;
  const info = pending ? OTA_ACTION_INFO[pending] : null;
  const todayISO = ymdRome(new Date());
  const hint = pending ? windowHint(pending, booking.checkIn, todayISO) : null;

  const close = () => { if (busy) return; setPending(null); setWord(""); };

  const run = async () => {
    if (!pending || !info || busy || word.trim() !== info.confirmWord) return;
    setBusy(true);
    let ok = false;
    let detail = "";
    try {
      const r = await apiPost<{ ok: boolean; error?: string; hint?: string }>("channex/booking-actions", { bookingId: chxId, action: pending, confirm: word.trim() });
      ok = !!r.ok;
      if (!ok) detail = [r.hint, r.error].filter(Boolean).join(" ");
    } catch (e) { detail = e instanceof Error ? e.message : "errore"; }
    // Registra l'esito (riuscito o fallito) nella nota della prenotazione, leggendo la nota aggiornata.
    const cur = bookings.find((x) => x.id === booking.id)?.note ?? booking.note ?? "";
    const line = otaLogLine(pending, ok, new Date().toISOString(), detail);
    updateBooking(booking.id, { note: cur ? `${cur}\n${line}` : line });
    setMsg({ ok, text: ok ? t("Segnalazione inviata a Booking.com.") : `${t("Segnalazione non riuscita")}: ${detail}` });
    setBusy(false);
    setPending(null);
    setWord("");
  };

  return (
    <>
      <details className="rounded-lg border border-line px-3 py-2 text-xs">
        <summary className="cursor-pointer select-none font-medium text-dim">{t("Segnala all'OTA")} (Booking.com)</summary>
        <div className="mt-2 flex flex-col gap-1.5">
          {OTA_ACTIONS.map((a) => (
            <button key={a} onClick={() => { setMsg(null); setWord(""); setPending(a); }} className="rounded-md border border-line px-2.5 py-1.5 text-left text-xs text-txt hover:bg-wash">
              {t(OTA_ACTION_INFO[a].label)}
            </button>
          ))}
          <p className="text-[11px] text-faint">{t("Azioni con effetto reale su ospite e commissioni: chiedono sempre conferma e non partono mai in automatico.")}</p>
        </div>
        {msg && <p className={`mt-1.5 text-[11px] ${msg.ok ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>{msg.text}</p>}
      </details>

      {pending && info && (
        <Modal open layer="top" onClose={close} busy={busy} title={t(info.title)} size="sm" closeLabel={t("Annulla")} footer={<>
        <Button variant="secondary" data-autofocus onClick={close} disabled={busy}>{t("Annulla")}</Button>
        <Button variant="danger" onClick={run} disabled={word.trim() !== info.confirmWord} loading={busy}>{busy ? t("Invio…") : t("Invia a Booking.com")}</Button>
        </>}>
            <p className="mt-2 text-xs text-txt">{t(info.effect)}</p>
            <p className="mt-2 text-[11px] text-dim"><span className="font-semibold">{t("Finestra ammessa")}:</span> {t(info.window)}</p>
            {hint && <p className="mt-2 rounded-md bg-wash px-2 py-1.5 text-[11px] text-[color:var(--warn)]">{t(hint)}</p>}
            <label className="mt-3 block text-[11px] text-dim">
              {t("Per confermare scrivi")} <span className="font-mono font-semibold text-txt">{info.confirmWord}</span>
              <input autoFocus value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" spellCheck={false}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
            </label>
            </Modal>
      )}
    </>
  );
}
