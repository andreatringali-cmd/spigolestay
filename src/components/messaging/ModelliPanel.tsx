"use client";

import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import { useData } from "@/lib/store";
import { mergeSeedTemplates, markSeedDeleted, unmarkSeedDeleted, ensureMandatoryTemplates } from "@/lib/msg-templates";
import ReviewSettingsCard from "@/components/messaging/ReviewSettingsCard";
import { waTemplateFrom } from "@/lib/wa-template";
import VarLegend, { MSG_VARS } from "@/components/VarLegend";

type Lang = "it" | "en" | "fr" | "de" | "es";
type Trigger = "manual" | "before_arrival" | "on_arrival" | "after_arrival" | "on_checkout" | "after_checkout";
const LANGS: [Lang, string][] = [["it", "Italiano"], ["en", "English"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]];
const TRIGGERS: [Trigger, string][] = [["manual", "Manuale"], ["before_arrival", "Giorni prima dell'arrivo"], ["on_arrival", "Il giorno del check-in"], ["after_arrival", "Giorni dopo l'arrivo"], ["on_checkout", "Il giorno del check-out"], ["after_checkout", "Giorni dopo il check-out"]];
// I trigger "il giorno di…" non usano il conteggio giorni (sono ancorati esattamente a check-in/check-out).
const needsDays = (t: Trigger) => t === "before_arrival" || t === "after_arrival" || t === "after_checkout";
// Ordine dei passaggi obbligatori della prenotazione (Check-in, Pagamento, Guida ospiti, … Check-out, recensione): i modelli collegati vengono per primi, in quest'ordine; poi quelli aggiunti dal titolare.
const STEP_RANK: Record<string, number> = { selfcheckin: 0, pay: 1, guida: 2, info: 3, tax: 5, checkout: 8, recensione: 8 };
const stepRank = (tp: { srcId?: string }) => (tp.srcId && tp.srcId in STEP_RANK ? STEP_RANK[tp.srcId] : 100);
const LINKABLE: [string, string][] = [["", "Nessuna"], ["selfcheckin", "Self check-in"], ["guida", "Guida ospiti"], ["info", "Info e codici d'ingresso"], ["checkout", "Messaggio di check-out"], ["recensione", "Richiesta recensione"]];

// Fasi del ciclo ospite in ordine cronologico: usate per ordinare e raggruppare i modelli.
const PHASE_SEQUENCE: Trigger[] = ["before_arrival", "on_arrival", "after_arrival", "on_checkout", "after_checkout", "manual"];
const PHASE_ORDER: Record<Trigger, number> = { before_arrival: 0, on_arrival: 1, after_arrival: 2, on_checkout: 3, after_checkout: 4, manual: 5 };
const PHASE_LABEL: Record<Trigger, string> = { before_arrival: "Prima dell'arrivo", on_arrival: "All'arrivo", after_arrival: "Durante il soggiorno", on_checkout: "Alla partenza", after_checkout: "Dopo il soggiorno", manual: "Altri messaggi" };
// Ordine cronologico interno alla fase: "giorni prima" più alti = più presto; "giorni dopo" più alti = più tardi.
const chronoKey = (tp: MsgTemplate) => (tp.trigger === "before_arrival" ? -tp.days : tp.trigger === "after_arrival" || tp.trigger === "after_checkout" ? tp.days : 0);

interface MsgTemplate { id: string; name: string; texts: Record<Lang, string>; trigger: Trigger; days: number; time: string; active: boolean; srcId?: string; order?: number; waTemplate?: string; showInBooking?: boolean /* spunta: compare come pulsante nella scheda della prenotazione */; structureIds?: string[] /* assente/vuoto = vale per tutte le strutture */ }
const emptyTpl = (structureIds?: string[]): MsgTemplate => ({ ...(structureIds?.length ? { structureIds } : {}), id: (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random())), name: "", texts: { it: "", en: "", fr: "", de: "", es: "" }, trigger: "manual", days: 1, time: "10:00", active: true });
const triggerDesc = (tpl: MsgTemplate, tr: (s: string) => string) => {
  if (tpl.trigger === "manual") return tr("Invio manuale");
  // L'invio automatico parte dal cron UNA volta al giorno (mattina italiana): l'orario scritto nel modello non lo sposta, quindi non lo si mostra come se fosse l'ora d'invio.
  if (tpl.trigger === "on_arrival") return `${tr("Il giorno del check-in")} · ${tr("invio al mattino")}`;
  if (tpl.trigger === "on_checkout") return `${tr("Il giorno del check-out")} · ${tr("invio al mattino")}`;
  const w = tpl.trigger === "before_arrival" ? tr("prima dell'arrivo") : tpl.trigger === "after_arrival" ? tr("dopo l'arrivo") : tr("dopo il check-out");
  return `${tpl.days} ${tr("gg")} ${w} · ${tr("invio al mattino")}`;
};

// Modelli & automazioni: crea i messaggi riutilizzabili (tab di /messaggi).
export default function ModelliPanel() {
  const ask = useConfirm();
  const { t } = useLang();
  const { structures, activeStructureId } = useData();
  const [templates, setTemplates] = useState<MsgTemplate[]>([]);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [flt, setFlt] = useState<"all" | "auto" | "manual">("all");
  useEffect(() => {
    try {
      const r = localStorage.getItem("spigolestay:msgtemplates"); const parsed = r ? JSON.parse(r) : null;
      const base: MsgTemplate[] = Array.isArray(parsed) ? parsed : [];
      setTemplates(ensureMandatoryTemplates(mergeSeedTemplates(base)).map((tp) => (tp.trigger === "manual" && !tp.active ? tp : { ...tp, trigger: "manual" as Trigger, active: false }))); // messaggi automatici spenti: tutti i modelli sono manuali
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => { if (!ready) return; try { localStorage.setItem("spigolestay:msgtemplates", JSON.stringify(templates)); } catch {} }, [templates, ready]);

  const [showSettings, setShowSettings] = useState(false); // ingranaggio: impostazioni (link recensioni…)
  const [editing, setEditing] = useState<MsgTemplate | null>(null);
  const [editLang, setEditLang] = useState<Lang>("it");
  const saveTpl = () => { if (!editing || !editing.name.trim()) return; unmarkSeedDeleted(editing.id); setTemplates((prev) => (prev.some((t) => t.id === editing.id) ? prev.map((t) => (t.id === editing.id ? editing : t)) : [...prev, editing])); setEditing(null); };
  const insertVar = (token: string) => setEditing((e) => (e ? { ...e, texts: { ...e.texts, [editLang]: `${e.texts[editLang] ?? ""}${token}` } } : e));
  const del = async (tpl: MsgTemplate) => { if (await ask({ title: t("Elimina modello"), message: `${t("Eliminare il modello")} "${tpl.name}"? ${t("L'operazione non è reversibile.")}`, danger: true, confirmLabel: t("Elimina") })) { markSeedDeleted(tpl.id); setTemplates((p) => p.filter((x) => x.id !== tpl.id)); } };
  const isAuto = (tp: MsgTemplate) => tp.trigger !== "manual"; // "automatico" = ha un orario/trigger (a prescindere se è in pausa)
  const shown = [...templates]
    .sort((a, b) =>
      stepRank(a) - stepRank(b) ||
      PHASE_ORDER[a.trigger] - PHASE_ORDER[b.trigger] ||
      (a.order ?? 9999) - (b.order ?? 9999) ||
      chronoKey(a) - chronoKey(b) ||
      (a.time ?? "").localeCompare(b.time ?? "") ||
      a.name.localeCompare(b.name, "it", { sensitivity: "base" })
    )
    // Con una struttura selezionata: i modelli di quella struttura + quelli validi per tutte (senza structureIds).
    .filter((tp) => activeStructureId === "all" || !tp.structureIds?.length || tp.structureIds.includes(activeStructureId))
    .filter((tp) =>
      (search.trim() === "" || tp.name.toLowerCase().includes(search.trim().toLowerCase())) &&
      (flt === "all" || (flt === "auto" ? isAuto(tp) : !isAuto(tp)))
    );
  // Modelli raggruppati per fase del ciclo ospite (solo le fasi non vuote), nell'ordine cronologico.
  const groups = PHASE_SEQUENCE.map((ph) => ({ ph, items: shown.filter((tp) => tp.trigger === ph) })).filter((g) => g.items.length > 0);

  return (
    <div>
      {/* Riga filtri (stile barra come le altre pagine): campo cerca a sinistra + filtri */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Cerca un modello…")} className="min-w-[180px] flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
        <button type="button" onClick={() => { setEditing(emptyTpl(activeStructureId !== "all" ? [activeStructureId] : undefined)); setEditLang("it"); }} className="inline-flex items-center gap-1.5 rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90"><span aria-hidden className="text-base leading-none">+</span>{t("Nuovo modello")}</button>
        <button type="button" onClick={() => setShowSettings((v) => !v)} aria-pressed={showSettings} aria-label={t("Impostazioni")} title={t("Impostazioni (link recensioni…)")} className={`grid h-9 w-9 place-items-center rounded-lg border transition ${showSettings ? "border-focus text-focus" : "border-line text-dim hover:bg-wash hover:text-txt"}`}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
      </div>

      {/* Impostazioni (ingranaggio): per ora i link alle recensioni */}
      {showSettings && <ReviewSettingsCard defaultOpen />}

      {/* Modelli raggruppati per fase del ciclo ospite, in ordine cronologico */}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.ph}>
            <SectionTitle>{t(PHASE_LABEL[g.ph])}</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2">
              {g.items.map((tpl) => (
                <Card key={tpl.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5"><span className="font-display text-base font-bold text-txt">{tpl.name}</span>{tpl.srcId && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-focus" title={t("Collegato a un'attività del «Da fare oggi»")}>{t("Da fare oggi")}</span>}</div>
                      <div className="mt-0.5 text-xs text-dim">{tpl.structureIds?.length ? ` · ${tpl.structureIds.map((id) => structures.find((s) => s.id === id)?.name).filter(Boolean).join(", ")}` : ""}</div>
                    </div>
                    {(tpl.showInBooking || tpl.srcId) && <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 18%, transparent)", color: "var(--ok)" }}>{t("Nella scheda")}</span>}
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs text-dim">{tpl.texts.it || tpl.texts.en || "—"}</div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => { setEditing({ ...tpl, texts: { ...tpl.texts } }); setEditLang("it"); }} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-txt hover:bg-wash">{t("Modifica")}</button>
                    {!tpl.srcId && <button onClick={() => del(tpl)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button>}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
        {/* Card "aggiungi" tratteggiata, stessa dimensione dei modelli */}
        <div className="grid gap-3 md:grid-cols-2">
          <button onClick={() => { setEditing(emptyTpl(activeStructureId !== "all" ? [activeStructureId] : undefined)); setEditLang("it"); }} className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-dim transition hover:border-focus hover:text-focus" style={{ background: "var(--surface)" }}>
            <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-current text-2xl font-light leading-none">+</span>
            <span className="text-sm font-semibold">{t("Nuovo modello")}</span>
          </button>
        </div>
      </div>

      {/* Editor */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[6dvh]">
          <button aria-label={t("Chiudi")} onClick={() => setEditing(null)} className="absolute inset-0 bg-black/40" />
          <Card className="relative w-full max-w-xl">
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle>{t("Modello messaggio")}</SectionTitle>
              <button onClick={() => setEditing(null)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
            </div>
            <div className="flex items-end gap-2">
              <label className="block flex-1 text-xs font-medium text-dim">{t("Nome modello")} *<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" placeholder={t("Es. Benvenuto pre-arrivo")} /></label>
              <label className="block w-20 text-xs font-medium text-dim" title={t("Numero d'ordine: più basso = più in alto nella lista")}>{t("Ordine")}<input type="number" min={0} value={editing.order ?? ""} onChange={(e) => setEditing({ ...editing, order: e.target.value === "" ? undefined : Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus" placeholder="—" /></label>
            </div>

            {/* Nessuna scelta delle strutture: un modello nuovo vale per la struttura selezionata in alto a destra (o per tutte, con «Tutte») */}

            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-1">
                {LANGS.map(([l, n]) => (<button key={l} onClick={() => setEditLang(l)} className={`rounded-md px-2 py-1 text-xs font-medium ${editLang === l ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{n.slice(0, 3)}</button>))}
              </div>
              <textarea value={editing.texts[editLang]} onChange={(e) => setEditing({ ...editing, texts: { ...editing.texts, [editLang]: e.target.value } })} rows={5} className="w-full resize-none rounded-lg border border-line bg-paper p-3 text-sm text-txt outline-none focus:border-focus" placeholder={`${t("Testo in")} ${LANGS.find(([l]) => l === editLang)?.[1]}…`} />
              <div className="mt-2"><VarLegend vars={MSG_VARS} onInsert={insertVar} /></div>
            </div>

            <label className={`mt-4 flex items-start gap-2.5 rounded-lg border border-line p-3 ${editing.srcId ? "cursor-not-allowed" : "cursor-pointer"}`}>
              <input type="checkbox" checked={!!editing.srcId || !!editing.showInBooking} disabled={!!editing.srcId} onChange={(e) => setEditing({ ...editing, showInBooking: e.target.checked })} className="mt-0.5 h-4 w-4" />
              <span className="text-sm text-txt">{t("Mostra nella scheda della prenotazione")}
                <span className="mt-0.5 block text-xs text-dim">{editing.srcId
                  ? t("Obbligatorio: questo modello è un passaggio del percorso della prenotazione (check-in, guida, recensione…) e compare sempre.")
                  : t("Compare come pulsante: lo premi e si apre WhatsApp con il messaggio già pronto per l'ospite. Senza la spunta il modello resta qui e non compare nelle prenotazioni.")}</span>
              </span>
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
              <button onClick={saveTpl} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Salva modello")}</button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
