"use client";

// Scheda «Revisioni» del pannello prenotazione (come su Channex): elenco delle revisioni ricevute per la
// prenotazione (più recente in alto), ognuna espandibile col contenuto completo, con confronto rispetto alla
// revisione precedente e JSON originale. SOLA LETTURA: nessuna azione verso Channex oltre alla lettura.
import { useCallback, useEffect, useState } from "react";
import type { Booking } from "@/lib/types";
import { useLang } from "@/lib/i18n";
import { apiPost } from "@/lib/invoicing/client";
import { friendlyError } from "@/lib/friendly-error";
import { channexBookingIdFromExtId } from "@/lib/channex-booking-actions";
import {
  COLLECT_LABEL, PAYTYPE_LABEL, diffRevisions, dmy, guestsLabel, money,
  type RevisionKind, type RevisionView,
} from "@/lib/booking-revisions";

type Payload = { ok?: boolean; revisions?: RevisionView[]; notLinked?: boolean; noRecords?: boolean; unreadable?: number; warning?: string; truncated?: boolean; hasMore?: boolean; error?: string };

const TONE: Record<RevisionKind, string> = {
  new: "var(--ok)", modified: "var(--warn)", cancelled: "var(--err)", unknown: "var(--faint)",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === undefined || children === null || children === "") return null;
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-0.5 text-xs sm:grid-cols-[8rem_1fr]">
      <span className="text-faint">{label}</span>
      <span className="min-w-0 break-words text-txt">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-2 first:border-t-0 first:pt-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dim">{title}</p>
      {children}
    </div>
  );
}

function Badge({ rev }: { rev: RevisionView }) {
  const { t } = useLang();
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: TONE[rev.kind] }}>
      {t(rev.label)}
    </span>
  );
}

function RevisionBody({ rev, bookingId, chxId }: { rev: RevisionView; bookingId: string; chxId: string }) {
  const { t } = useLang();
  const cur = rev.currency;
  const c = rev.customer;
  const place = [c.city, c.country].filter(Boolean).join(", ");
  return (
    <div className="flex flex-col gap-2.5 px-3 pb-3 pt-1">
      <Section title={t("Prenotazione")}>
        <Row label={t("Stato")}>{t(rev.label)}</Row>
        <Row label={t("Canale")}>{rev.channel}</Row>
        <Row label={t("Codice OTA")}>{rev.otaCode}</Row>
        <Row label={t("ID revisione")}><span className="font-mono text-[11px]">{rev.revisionId}</span></Row>
        <Row label={t("ID prenotazione")}><span className="font-mono text-[11px]">{rev.bookingId}</span></Row>
        {rev.systemId && <Row label={t("ID messaggio OTA")}><span className="font-mono text-[11px]">{rev.systemId}</span></Row>}
        <Row label={t("Arrivo")}>{rev.checkIn ? dmy(rev.checkIn) : ""}</Row>
        <Row label={t("Partenza")}>{rev.checkOut ? dmy(rev.checkOut) : ""}</Row>
        <Row label={t("Notti")}>{rev.checkIn && rev.checkOut ? String(rev.nights) : ""}</Row>
        <Row label={t("Orario di arrivo")}>{rev.arrivalHour}</Row>
        <Row label={t("Ospiti")}>{guestsLabel(rev.adults, rev.children, rev.infants)}</Row>
        <Row label={t("Totale")}>{rev.total !== null ? money(rev.total, cur) : ""}</Row>
        <Row label={t("Commissione OTA")}>{rev.commission !== null ? money(rev.commission, cur) : ""}</Row>
        <Row label={t("Incassa")}>{rev.paymentCollect ? COLLECT_LABEL[rev.paymentCollect] ?? rev.paymentCollect : ""}</Row>
        <Row label={t("Tipo di pagamento")}>{rev.paymentType ? PAYTYPE_LABEL[rev.paymentType] ?? rev.paymentType : ""}</Row>
        {rev.guarantee && <Row label={t("Garanzia")}>{rev.guarantee.isVirtual ? t("Carta virtuale OTA") : t("Carta")}{rev.guarantee.cardType ? ` (${rev.guarantee.cardType})` : ""}</Row>}
      </Section>

      {(c.name || c.email || c.phone || place) && (
        <Section title={t("Cliente")}>
          <Row label={t("Nome")}>{c.name}</Row>
          <Row label={t("Email")}>{c.email}</Row>
          <Row label={t("Telefono")}>{c.phone}</Row>
          <Row label={t("Provenienza")}>{place}</Row>
          <Row label={t("Lingua")}>{c.language}</Row>
        </Section>
      )}

      {rev.rooms.length > 0 && (
        <Section title={rev.rooms.length > 1 ? `${t("Camere")} (${rev.rooms.length})` : t("Camera")}>
          <div className="flex flex-col gap-2">
            {rev.rooms.map((room, i) => (
              <div key={i} className="rounded-lg bg-wash px-2.5 py-2">
                {rev.rooms.length > 1 && <p className="mb-0.5 text-[11px] font-semibold text-dim">{t("Camera")} {i + 1}</p>}
                <Row label={t("Soggiorno")}>{room.checkIn ? `${dmy(room.checkIn)} → ${dmy(room.checkOut)} (${room.nights} ${room.nights === 1 ? t("notte") : t("notti")})` : ""}</Row>
                <Row label={t("Ospiti")}>{guestsLabel(room.adults, room.children, room.infants)}{room.childAges.length ? ` · ${t("età bambini")}: ${room.childAges.join(", ")}` : ""}</Row>
                <Row label={t("Nominativi")}>{room.guests.join(", ")}</Row>
                <Row label={t("Totale camera")}>{room.total !== null ? money(room.total, cur) : ""}</Row>
                {room.nightly.length > 0 && (
                  <div className="mt-1 border-t border-line pt-1">
                    <p className="text-[11px] text-faint">{t("Prezzo per notte")}</p>
                    <ul className="mt-0.5 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                      {room.nightly.map((n) => (
                        <li key={n.date} className="flex justify-between text-xs">
                          <span className="text-dim">{dmy(n.date)}</span>
                          <span className="tabular-nums text-txt">{money(n.amount, cur)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {rev.policies.length > 0 && (
        <Section title={t("Politiche")}>
          <ul className="flex flex-col gap-0.5">{rev.policies.map((p) => <li key={p} className="text-xs text-txt">{p}</li>)}</ul>
        </Section>
      )}

      {rev.charges.length > 0 && (
        <Section title={t("Spese e servizi")}>
          <ul className="flex flex-col gap-0.5">
            {rev.charges.map((x, i) => (
              <li key={i} className="flex justify-between gap-3 text-xs">
                <span className="min-w-0 text-txt">{x.label}{x.detail ? <span className="text-faint"> · {x.detail}</span> : null}{x.inclusive ? <span className="text-faint"> · {t("inclusa")}</span> : null}</span>
                <span className="shrink-0 tabular-nums text-txt">{x.amount !== null ? money(x.amount, cur) : "—"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {rev.notes && (
        <Section title={t("Appunti")}>
          <p className="whitespace-pre-wrap break-words text-xs text-txt">{rev.notes}</p>
        </Section>
      )}

      <RawBlock rev={rev} bookingId={bookingId} chxId={chxId} />
    </div>
  );
}

// Dati originali: riga chiusa con il JSON in un riquadro scorrevole e pulsante «Copia».
// Il JSON non arriva con l'elenco (pesa): si chiede al server solo alla prima apertura di questa revisione.
function RawBlock({ rev, bookingId, chxId }: { rev: RevisionView; bookingId: string; chxId: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [raw, setRaw] = useState<Record<string, unknown> | null>(rev.raw ?? null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    setLoading(true); setErr("");
    apiPost<{ ok?: boolean; raw?: Record<string, unknown> }>("channex/revisions", { bookingId, channexBookingId: chxId, rawFor: rev.revisionId })
      .then((r) => setRaw(r.raw ?? {}))
      .catch((e) => setErr(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [bookingId, chxId, rev.revisionId]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !raw && !loading) load();
  };
  const json = open && raw ? JSON.stringify(raw, null, 2) : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(raw, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* appunti non disponibili */ }
  };
  return (
    <div className="border-t border-line pt-2">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center justify-between text-left text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-txt">
        <span>{t("Dati originali")}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1.5">
          {loading && <p className="text-xs text-dim" role="status">{t("Carico i dati originali…")}</p>}
          {err && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-[color:var(--err)]" role="alert">{err}</p>
              <button onClick={load} className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-dim hover:bg-wash">{t("Riprova")}</button>
            </div>
          )}
          {raw && (
            <>
              <div className="mb-1 flex justify-end">
                <button onClick={copy} className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-dim hover:bg-wash">{copied ? t("Copiato") : t("Copia")}</button>
              </div>
              <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-paper p-2 text-[11px] leading-snug text-txt">{json}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function BookingRevisionsTab({ booking }: { booking: Booking }) {
  const { t } = useLang();
  const chxId = channexBookingIdFromExtId(booking.extId);
  const [state, setState] = useState<{ loading: boolean; error: string; data: Payload | null }>({ loading: !!chxId, error: "", data: null });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showDiff, setShowDiff] = useState(false);
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  // Le revisioni oltre alle prime 5 si leggono solo su richiesta (ogni lettura è una chiamata a Channex, che ha un limite condiviso).
  const loadMore = useCallback(() => {
    if (!chxId || loadingMore) return;
    setLoadingMore(true); setMoreError("");
    apiPost<Payload>("channex/revisions", { bookingId: booking.id, channexBookingId: chxId, more: true })
      .then((data) => setState((s) => ({ ...s, data })))
      .catch((e) => setMoreError(friendlyError(e)))
      .finally(() => setLoadingMore(false));
  }, [booking.id, chxId, loadingMore]);

  useEffect(() => {
    if (!chxId) { setState({ loading: false, error: "", data: { ok: true, revisions: [], notLinked: true } }); return; }
    let cancelled = false;
    setState({ loading: true, error: "", data: null });
    setOpen(new Set());
    apiPost<Payload>("channex/revisions", { bookingId: booking.id, channexBookingId: chxId })
      .then((data) => { if (!cancelled) setState({ loading: false, error: "", data }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: friendlyError(e), data: null }); });
    return () => { cancelled = true; };
  }, [booking.id, chxId, nonce]);

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (state.loading) return <p className="p-3 text-xs text-dim" role="status">{t("Carico le revisioni da Channex…")}</p>;
  if (state.error) {
    return (
      <div className="flex flex-col items-start gap-2 p-3">
        <p className="text-xs text-[color:var(--err)]" role="alert">{state.error}</p>
        <button onClick={retry} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-dim hover:bg-wash">{t("Riprova")}</button>
      </div>
    );
  }
  const data = state.data;
  if (!data || data.notLinked) return <p className="p-3 text-xs text-dim">{t("Questa prenotazione non arriva da Channex: non ci sono revisioni.")}</p>;
  if (data.ok === false && data.error) return <p className="p-3 text-xs text-[color:var(--err)]" role="alert">{friendlyError(data.error)}</p>;
  const revs = data.revisions ?? [];
  if (!revs.length) return <p className="p-3 text-xs text-dim">{t("Nessuna revisione registrata per questa prenotazione.")}</p>;
  // Elenco incompleto (revisioni più vecchie non mostrate o non lette): l'ultima mostrata NON è la prima ricevuta.
  const incomplete = !!(data.truncated || data.hasMore || data.unreadable);

  return (
    <div className="flex flex-col gap-2 p-2 sm:p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-dim">{revs.length} {revs.length === 1 ? t("revisione") : t("revisioni")}</p>
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-dim">
          <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} className="h-3.5 w-3.5 accent-[color:var(--focus)]" />
          {t("Mostra differenze")}
        </label>
      </div>

      <ul className="flex flex-col gap-2">
        {revs.map((rev, i) => {
          const isOpen = open.has(rev.revisionId);
          const prev = revs[i + 1] ?? null;
          const diff = showDiff ? diffRevisions(prev, rev) : [];
          return (
            <li key={rev.revisionId} className="overflow-hidden rounded-xl border border-line bg-surface">
              <button onClick={() => toggle(rev.revisionId)} aria-expanded={isOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-wash">
                <span aria-hidden className="text-xs text-faint">{isOpen ? "▾" : "▸"}</span>
                <span className="min-w-0 flex-1 text-xs text-txt">
                  <span className="text-faint">{t("Identificativo del sistema")}:</span>{" "}
                  <span className="font-mono font-semibold">{rev.shortId}</span>
                  {rev.atLabel && <span className="text-dim"> · {rev.atLabel}</span>}
                </span>
                <Badge rev={rev} />
              </button>

              {showDiff && (
                <div className="border-t border-line bg-wash px-3 py-2">
                  {!prev ? (
                    <p className="text-xs text-faint">{incomplete ? t("Confronto non disponibile (revisioni precedenti non lette)") : t("Prima revisione ricevuta: niente da confrontare.")}</p>
                  ) : diff.length === 0 ? (
                    <p className="text-xs text-faint">{t("Nessuna differenza di rilievo")}</p>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {diff.map((l) => <li key={l} className="break-words text-xs text-txt">{l}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {isOpen && <div className="border-t border-line pt-2"><RevisionBody rev={rev} bookingId={booking.id} chxId={chxId ?? ""} /></div>}
            </li>
          );
        })}
      </ul>

      {data.hasMore ? (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={loadMore} disabled={loadingMore} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-dim hover:bg-wash disabled:opacity-60">
            {loadingMore ? t("Carico…") : t("Mostra le revisioni precedenti")}
          </button>
          {moreError && <span className="text-[11px] text-[color:var(--err)]" role="alert">{moreError}</span>}
        </div>
      ) : null}

      {(data.truncated || data.unreadable) ? (
        <p className="text-[11px] text-faint">
          {data.truncated ? t("Sono mostrate solo le 10 revisioni più recenti.") : ""}{" "}
          {data.unreadable ? `${data.unreadable} ${t("revisioni non lette")}${data.warning ? `: ${data.warning}` : "."}` : ""}
        </p>
      ) : null}
      <p className="text-[11px] text-faint">{t("Le revisioni mostrate sono quelle importate in Xenora; le più vecchie dell'attivazione di Channex possono mancare.")}</p>
    </div>
  );
}
