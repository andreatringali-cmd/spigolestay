"use client";

// Impostazioni → Google Ads: ogni struttura può misurare le proprie prenotazioni dirette sul PROPRIO account Google Ads.
// Si incollano l'ID del tag (AW-…) e l'etichetta della conversione; si può anche incollare l'intero codice di Google, che qui si legge da solo.
// I due valori non sono segreti (compaiono nel codice delle pagine). Per applicarli alla pagina di prenotazione bisogna ripubblicare il sito della struttura.
import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { adsConfigOf, extractAdsFromText, isValidAdsId, isValidAdsLabel } from "@/lib/ads";

type St = { id: string; name: string; googleAdsId?: string; googleAdsLabel?: string };

export default function AdsSettingsCard() {
  const { structures, activeStructureId } = useData();
  const [pick, setPick] = useState("");
  // Struttura in modifica: quella del selettore globale; con "Tutte" la scelta locale (o la prima). Nessun effetto: si ricava a ogni disegno.
  const sid = activeStructureId !== "all" ? activeStructureId : structures.some((s) => s.id === pick) ? pick : structures[0]?.id ?? "";
  const st = structures.find((s) => s.id === sid);
  return <AdsForm key={`${st?.id}|${st?.googleAdsId ?? ""}|${st?.googleAdsLabel ?? ""}`} st={st} showPicker={activeStructureId === "all" && structures.length > 1} structures={structures} sid={sid} onPick={setPick} />;
}

function AdsForm({ st, showPicker, structures, sid, onPick }: { st: St | undefined; showPicker: boolean; structures: St[]; sid: string; onPick: (id: string) => void }) {
  const { updateStructure } = useData();
  const { t } = useLang();
  const [id, setId] = useState(st?.googleAdsId ?? "");
  const [label, setLabel] = useState(st?.googleAdsLabel ?? "");
  const [saved, setSaved] = useState(false);

  // Se si incolla l'intero codice di Google (tag o snippet evento) si riempiono i due campi.
  const onPaste = (text: string): boolean => {
    const f = extractAdsFromText(text);
    if (!f.id && !f.label) return false;
    if (f.id) setId(f.id);
    if (f.label) setLabel(f.label);
    return true;
  };
  const idOk = !id.trim() || isValidAdsId(id);
  const labelOk = !label.trim() || isValidAdsLabel(label);
  const canSave = !!st && idOk && labelOk;
  const save = () => {
    if (!st || !canSave) return;
    updateStructure(st.id, { googleAdsId: id.trim() || undefined, googleAdsLabel: id.trim() ? label.trim() || undefined : undefined, updatedAt: Date.now() });
    setSaved(true);
  };
  const active = !!adsConfigOf({ googleAdsId: id, googleAdsLabel: label });
  const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const num = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-wash text-[11px] font-bold text-txt";

  return (
    <Card className="mt-4">
      <SectionTitle>{t("Google Ads · misura le prenotazioni dirette")}</SectionTitle>
      <p className="mb-3 text-xs text-dim">{t("Se fai pubblicità su Google, qui colleghi il tuo account: ogni prenotazione diretta confermata sul tuo sito viene comunicata a Google (importo e codice), così vedi quali annunci rendono. Parte solo se l'ospite accetta i cookie. Senza questi dati non succede nulla.")}</p>
      <ol className="mb-3 space-y-2 text-xs text-dim">
        <li className="flex gap-2.5"><span className={num}>1</span><span className="pt-0.5">{t("In Google Ads: Obiettivi → Conversioni → Nuova conversione → Sito web → Manualmente con codice. Categoria Acquisto, nome \"Prenotazione diretta\", valori diversi per ogni conversione, conteggio \"Ogni\".")}</span></li>
        <li className="flex gap-2.5"><span className={num}>2</span><span className="pt-0.5">{t("Ti mostra due codici: l'ID del tag (inizia con AW-) e, nello snippet evento, l'etichetta (la parte dopo la barra in send_to).")}</span></li>
        <li className="flex gap-2.5"><span className={num}>3</span><span className="pt-0.5">{t("Incollali qui sotto (anche tutto il codice insieme: li leggiamo noi), premi Salva e poi ripubblica il sito della struttura.")}</span></li>
      </ol>
      {showPicker && (
        <label className="mb-2 block text-xs font-medium text-dim">{t("Struttura")}
          <select value={sid} onChange={(e) => onPick(e.target.value)} className={`mt-1 ${inp}`}>
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-dim">{t("ID del tag Google")}{st ? ` · ${st.name}` : ""}
          <input value={id} onChange={(e) => { setId(e.target.value); setSaved(false); }} onPaste={(e) => { const tx = e.clipboardData.getData("text"); if (onPaste(tx)) { e.preventDefault(); setSaved(false); } }} placeholder="AW-1234567890" className={`mt-1 ${inp} font-mono`} />
          {!idOk && <span className="mt-1 block text-[11px]" style={{ color: "var(--err)" }}>{t("Deve iniziare con AW- seguito da numeri.")}</span>}
        </label>
        <label className="block text-xs font-medium text-dim">{t("Etichetta di conversione")}
          <input value={label} onChange={(e) => { setLabel(e.target.value); setSaved(false); }} onPaste={(e) => { const tx = e.clipboardData.getData("text"); if (onPaste(tx)) { e.preventDefault(); setSaved(false); } }} placeholder="AbCdEfGhIjKlMnOp" className={`mt-1 ${inp} font-mono`} />
          {!labelOk && <span className="mt-1 block text-[11px]" style={{ color: "var(--err)" }}>{t("Solo lettere, numeri, trattino e sottolineato (8-40 caratteri).")}</span>}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={!canSave} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Salva")}</button>
        {saved && <span className="text-xs font-semibold" style={{ color: "var(--ok)" }}>✓ {t("Salvato. Ora ripubblica il sito della struttura per applicarlo alla pagina di prenotazione.")}</span>}
        {!saved && active && label.trim() === "" && <span className="text-xs" style={{ color: "var(--warn)" }}>{t("Senza etichetta il tag si carica ma non si inviano conversioni.")}</span>}
      </div>
    </Card>
  );
}
