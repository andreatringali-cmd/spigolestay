"use client";

// Selezione degli extra di una prenotazione: gli extra del catalogo della struttura (stesso catalogo del modulo Upselling) con quantità,
// più, in fondo, una voce libera (descrizione + importo) per ciò che non è a catalogo. Non salva nulla da solo: restituisce le nuove voci
// a chi lo usa (vista → updateBooking, modifica → bozza del form), così il totale non si calcola mai due volte.

import { useState } from "react";
import NumInput from "@/components/NumInput";
import { eur } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import type { ExtraService } from "@/lib/types";
import { PER_LABEL } from "@/lib/upselling";
import { entriesTotal, entryFor, entryQty, extraUnitAmount, freeEntries, maxQtyOf, pricingLabel, selectableExtras, setExtraQty, type BookingExtraEntry, type StayLike } from "@/lib/booking-extras";

const inp = "rounded-md border border-line bg-paper px-2 py-1 text-sm text-txt outline-none focus:border-focus";
const stepBtn = "flex h-7 w-7 items-center justify-center rounded-lg border text-base leading-none disabled:opacity-30";

export default function BookingExtrasPicker({ entries, onChange, catalog, stay, onConfigure }: {
  entries: BookingExtraEntry[];
  onChange: (next: BookingExtraEntry[]) => void;
  catalog: ExtraService[] | undefined;
  stay: StayLike;
  /** Apre la configurazione del catalogo extra (prezzi, modalità di calcolo, nuovi extra). */
  onConfigure?: () => void;
}) {
  const { t } = useLang();
  const [freeName, setFreeName] = useState("");
  const [freePrice, setFreePrice] = useState<number | null>(null);
  const list = selectableExtras(catalog);
  const free = freeEntries(entries, list);

  const setLinePrice = (e: ExtraService, price: number) => {
    const hit = entryFor(entries, e);
    if (!hit) return;
    onChange(entries.map((x) => (x === hit ? { ...x, price } : x)));
  };
  const addFree = () => {
    const name = freeName.trim();
    if (!name || !freePrice) return;
    onChange([...entries, { name, price: freePrice }]);
    setFreeName(""); setFreePrice(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {list.map((e) => {
        const q = entryQty(entries, e);
        const hit = entryFor(entries, e);
        const max = maxQtyOf(e);
        const unit = extraUnitAmount(e, stay);
        const isFree = !!e.free || !(e.price > 0);
        return (
          <div key={e.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5 ${q > 0 ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_6%,transparent)]" : "border-line bg-paper"}`}>
            <div className="min-w-0 flex-1 basis-40">
              <div className="truncate text-[13px] font-medium text-txt">{t(e.name)}</div>
              <div className="truncate text-[11px] text-faint">
                {isFree ? t(pricingLabel(e)) : `${eur(e.price)} ${t(PER_LABEL[e.per])}`}
                {!isFree && e.per !== "stay" && e.per !== "day" ? ` · ${eur(unit)} ${t("per questo soggiorno")}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" disabled={q <= 0} onClick={() => onChange(setExtraQty(entries, e, q - 1, stay))} aria-label={`${t("Meno")} ${e.name}`} className={`${stepBtn} border-line text-dim hover:bg-wash`}>−</button>
              <span className="w-5 text-center font-mono text-sm tabular-nums text-txt">{q}</span>
              <button type="button" disabled={q >= max} onClick={() => onChange(setExtraQty(entries, e, q + 1, stay))} aria-label={`${t("Più")} ${e.name}`} className={`${stepBtn} ${q > 0 ? "border-focus bg-focus text-white hover:opacity-90" : "border-line text-dim hover:bg-wash"}`}>+</button>
              {q > 0 && hit && (
                <span className="flex items-center gap-1 text-xs text-dim">€<NumInput value={hit.price} onChange={(v) => setLinePrice(e, v ?? 0)} className={`${inp} w-20 text-right font-mono`} aria-label={`${t("Importo")} ${e.name}`} /></span>
              )}
            </div>
          </div>
        );
      })}

      {free.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Altre voci")}</div>
          {free.map(({ entry, index }) => (
            <div key={index} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[13px] text-txt">{entry.name || t("Extra")}</span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-txt">{eur(entry.price || 0)}</span>
              <button type="button" onClick={() => onChange(entries.filter((_, i) => i !== index))} title={t("Rimuovi")} aria-label={t("Rimuovi")} className="shrink-0 px-1 text-faint hover:text-[color:var(--err)]">✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line p-2">
        <input value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder={t("Altra voce (es. Transfer)")} className={`${inp} min-w-[140px] flex-1`} />
        <span className="flex items-center gap-1 text-xs text-dim">€<NumInput value={freePrice} allowNull onChange={setFreePrice} className={`${inp} w-20 text-right font-mono`} placeholder="0" aria-label={t("Importo")} /></span>
        <button type="button" onClick={addFree} disabled={!freeName.trim() || !freePrice} className="rounded-md bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Aggiungi")}</button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-faint">
        <span>{t("Totale extra")}: <b className="font-mono text-txt">{eur(entriesTotal(entries))}</b> · {t("sommato al totale ospite")}</span>
        {onConfigure && <button type="button" onClick={onConfigure} className="font-semibold text-focus hover:underline">{t("Imposta prezzi e extra della struttura")} →</button>}
      </div>
    </div>
  );
}
