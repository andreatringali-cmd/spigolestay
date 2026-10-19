"use client";

import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { useData } from "@/lib/store";
import { REVIEW_SETTINGS_KEY, DEFAULT_REVIEW_SETTINGS, parseReviewSettings, reviewLinksFor, cleanUrl, type ReviewSettings } from "@/lib/auto-review";

// Impostazioni della RICHIESTA DI RECENSIONE automatica (modello «Richiesta recensione», giorno dopo la partenza).
// Salvate in "spigolestay:reviewsettings" (si sincronizza con l'account, quindi le legge anche il cron dei messaggi automatici).
const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none placeholder:text-faint focus:border-focus";

export default function ReviewSettingsCard({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const { t } = useLang();
  const { structures: allStructures, activeStructureId } = useData();
  const structures = activeStructureId === "all" ? allStructures : allStructures.filter((x) => x.id === activeStructureId); // solo la struttura selezionata in alto a destra
  const [s, setS] = useState<ReviewSettings>(DEFAULT_REVIEW_SETTINGS);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // testo digitato per campo ("<id>:g" / "<id>:t"), anche se non ancora un link valido

  useEffect(() => { try { setS(parseReviewSettings(localStorage.getItem(REVIEW_SETTINGS_KEY))); } catch { /* storage non disponibile */ } setReady(true); }, []);
  useEffect(() => { if (!ready) return; try { localStorage.setItem(REVIEW_SETTINGS_KEY, JSON.stringify(s)); } catch { /* quota piena: resta in memoria */ } }, [s, ready]);

  const guideReviewUrl = (id: string) => { try { return JSON.parse(localStorage.getItem("spigolestay:guides") || "{}")?.[id]?.reviewUrl || ""; } catch { return ""; } };
  const setField = (id: string, f: "googleUrl" | "tripadvisorUrl", raw: string) => {
    setDrafts((d) => ({ ...d, [`${id}:${f}`]: raw }));
    setS((p) => {
      const cur = { ...(p.structures[id] ?? {}) };
      const v = cleanUrl(raw);
      if (v) cur[f] = v; else delete cur[f];
      const structuresNext = { ...p.structures };
      if (cur.googleUrl || cur.tripadvisorUrl) structuresNext[id] = cur; else delete structuresNext[id];
      return { ...p, structures: structuresNext };
    });
  };
  const shown = (id: string, f: "googleUrl" | "tripadvisorUrl") => drafts[`${id}:${f}`] ?? s.structures[id]?.[f] ?? "";
  const active = structures.filter((x) => x.active !== false);
  const missing = active.filter((x) => { const l = reviewLinksFor({ structureId: x.id, placeId: x.googlePlaceId, guideReviewUrl: guideReviewUrl(x.id), settings: s }); return !l.google && !l.tripadvisor; });

  return (
    <Card className="mb-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left">
        <span>
          <SectionTitle>{t("Link per le recensioni")}</SectionTitle>
          <span className="-mt-2 block text-xs text-dim">{t("I link ai portali da usare nei tuoi messaggi di richiesta recensione (segnaposto {link_recensioni}).")}{missing.length > 0 ? ` ${t("Senza almeno un link il messaggio non parte.")}` : ""}</span>
        </span>
        <span className="shrink-0 text-dim">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          <div className="rounded-lg border border-line bg-wash px-3 py-2 text-xs text-dim">
            {t("Nessuno sconto o regalo in cambio della recensione: i portali lo vietano. Booking.com manda già il suo invito agli ospiti, quindi qui non c'è un link Booking. Non ricevono la richiesta: prenotazioni annullate, no-show o provvisorie, ospiti con il tag «Da recuperare» e prenotazioni a cui l'hai già chiesta a mano.")}
          </div>
          {structures.length === 0 && <div className="text-xs text-dim">{t("Nessuna struttura configurata.")}</div>}
          {structures.map((st) => {
            const auto = reviewLinksFor({ structureId: st.id, placeId: st.googlePlaceId, guideReviewUrl: guideReviewUrl(st.id), settings: { ...s, structures: {} } });
            const gRaw = shown(st.id, "googleUrl"), tRaw = shown(st.id, "tripadvisorUrl");
            return (
              <div key={st.id} className="rounded-lg border border-line p-3">
                <div className="text-sm font-semibold text-txt">{st.name}</div>
                <label className="mt-2 block text-xs font-medium text-dim">{t("Link recensioni Google")}
                  <input value={gRaw} onChange={(e) => setField(st.id, "googleUrl", e.target.value)} placeholder={auto.google || "https://…"} className={inp} />
                  <span className="mt-1 block font-normal text-faint">{gRaw.trim() && !cleanUrl(gRaw) ? t("Inserisci un indirizzo che inizia con https://") : auto.google ? t("Se lo lasci vuoto uso il link ricavato dal Place ID o dalla guida ospiti.") : t("Vuoto: imposta il Place ID in Recensioni o il link nella guida ospiti.")}</span>
                </label>
                <label className="mt-2 block text-xs font-medium text-dim">{t("Link recensioni Tripadvisor")} <span className="font-normal text-faint">({t("facoltativo")})</span>
                  <input value={tRaw} onChange={(e) => setField(st.id, "tripadvisorUrl", e.target.value)} placeholder="https://www.tripadvisor.it/UserReviewEdit-…" className={inp} />
                  {tRaw.trim() && !cleanUrl(tRaw) && <span className="mt-1 block font-normal text-faint">{t("Inserisci un indirizzo che inizia con https://")}</span>}
                </label>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
