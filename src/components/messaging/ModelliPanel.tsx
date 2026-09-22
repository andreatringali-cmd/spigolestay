"use client";

import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import { DEFAULT_TEMPLATES } from "@/lib/msg-templates";
import VarLegend, { MSG_VARS } from "@/components/VarLegend";

type Lang = "it" | "en" | "fr" | "de" | "es";
type Trigger = "manual" | "before_arrival" | "on_arrival" | "after_arrival" | "on_checkout" | "after_checkout";
const LANGS: [Lang, string][] = [["it", "Italiano"], ["en", "English"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]];
const TRIGGERS: [Trigger, string][] = [["manual", "Manuale"], ["before_arrival", "Giorni prima dell'arrivo"], ["on_arrival", "Il giorno del check-in"], ["after_arrival", "Giorni dopo l'arrivo"], ["on_checkout", "Il giorno del check-out"], ["after_checkout", "Giorni dopo il check-out"]];
// I trigger "il giorno di…" non usano il conteggio giorni (sono ancorati esattamente a check-in/check-out).
const needsDays = (t: Trigger) => t === "before_arrival" || t === "after_arrival" || t === "after_checkout";
const LINKABLE: [string, string][] = [["", "Nessuna"], ["selfcheckin", "Self check-in"], ["guida", "Guida ospiti"], ["info", "Info e codici d'ingresso"], ["checkout", "Messaggio di check-out"], ["recensione", "Richiesta recensione"]];

// Fasi del ciclo ospite in ordine cronologico: usate per ordinare e raggruppare i modelli.
const PHASE_SEQUENCE: Trigger[] = ["before_arrival", "on_arrival", "after_arrival", "on_checkout", "after_checkout", "manual"];
const PHASE_ORDER: Record<Trigger, number> = { before_arrival: 0, on_arrival: 1, after_arrival: 2, on_checkout: 3, after_checkout: 4, manual: 5 };
const PHASE_LABEL: Record<Trigger, string> = { before_arrival: "Prima dell'arrivo", on_arrival: "All'arrivo", after_arrival: "Durante il soggiorno", on_checkout: "Alla partenza", after_checkout: "Dopo il soggiorno", manual: "Altri messaggi" };
// Ordine cronologico interno alla fase: "giorni prima" più alti = più presto; "giorni dopo" più alti = più tardi.
const chronoKey = (tp: MsgTemplate) => (tp.trigger === "before_arrival" ? -tp.days : tp.trigger === "after_arrival" || tp.trigger === "after_checkout" ? tp.days : 0);

interface MsgTemplate { id: string; name: string; texts: Record<Lang, string>; trigger: Trigger; days: number; time: string; active: boolean; srcId?: string; order?: number }
const emptyTpl = (): MsgTemplate => ({ id: (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random())), name: "", texts: { it: "", en: "", fr: "", de: "", es: "" }, trigger: "manual", days: 1, time: "10:00", active: true });
const triggerDesc = (tpl: MsgTemplate, tr: (s: string) => string) => {
  if (tpl.trigger === "manual") return tr("Invio manuale");
  if (tpl.trigger === "on_arrival") return `${tr("Il giorno del check-in")} · ${tpl.time}`;
  if (tpl.trigger === "on_checkout") return `${tr("Il giorno del check-out")} · ${tpl.time}`;
  const w = tpl.trigger === "before_arrival" ? tr("prima dell'arrivo") : tpl.trigger === "after_arrival" ? tr("dopo l'arrivo") : tr("dopo il check-out");
  return `${tpl.days} ${tr("gg")} ${w} · ${tpl.time}`;
};

// Modelli & automazioni: crea i messaggi riutilizzabili (tab di /messaggi).
export default function ModelliPanel() {
  const ask = useConfirm();
  const { t } = useLang();
  const [templates, setTemplates] = useState<MsgTemplate[]>([]);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [flt, setFlt] = useState<"all" | "auto" | "manual">("all");
  useEffect(() => {
    try {
      const r = localStorage.getItem("spigolestay:msgtemplates"); const parsed = r ? JSON.parse(r) : null;
      const base: MsgTemplate[] = Array.isArray(parsed) ? parsed : [];
      const haveIds = new Set(base.map((x) => x.id));
      setTemplates([...base, ...(DEFAULT_TEMPLATES as unknown as MsgTemplate[]).filter((d) => !haveIds.has(d.id))]);
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => { if (!ready) return; try { localStorage.setItem("spigolestay:msgtemplates", JSON.stringify(templates)); } catch {} }, [templates, ready]);

  const [editing, setEditing] = useState<MsgTemplate | null>(null);
  const [editLang, setEditLang] = useState<Lang>("it");
  const saveTpl = () => { if (!editing || !editing.name.trim()) return; setTemplates((prev) => (prev.some((t) => t.id === editing.id) ? prev.map((t) => (t.id === editing.id ? editing : t)) : [...prev, editing])); setEditing(null); };
  const insertVar = (token: string) => setEditing((e) => (e ? { ...e, texts: { ...e.texts, [editLang]: `${e.texts[editLang] ?? ""}${token}` } } : e));
  const del = async (tpl: MsgTemplate) => { if (await ask({ title: t("Elimina modello"), message: `${t("Eliminare il modello")} "${tpl.name}"? ${t("L'operazione non è reversibile.")}`, danger: true, confirmLabel: t("Elimina") })) setTemplates((p) => p.filter((x) => x.id !== tpl.id)); };
  const isAuto = (tp: MsgTemplate) => tp.trigger !== "manual"; // "automatico" = ha un orario/trigger (a prescindere se è in pausa)
  const shown = [...templates]
    .sort((a, b) =>
      PHASE_ORDER[a.trigger] - PHASE_ORDER[b.trigger] ||
      (a.order ?? 9999) - (b.order ?? 9999) ||
      chronoKey(a) - chronoKey(b) ||
      (a.time ?? "").localeCompare(b.time ?? "") ||
      a.name.localeCompare(b.name, "it", { sensitivity: "base" })
    )
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
        <div className="flex items-center overflow-hidden rounded-lg border border-line">
          {([["all", t("Tutti")], ["auto", t("Automatici")], ["manual", t("Manuali")]] as [typeof flt, string][]).map(([k, lab], i) => (
            <button key={k} onClick={() => setFlt(k)} className={`px-3 py-2 text-xs font-semibold transition ${i > 0 ? "border-l border-line" : ""} ${flt === k ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>{lab}</button>
          ))}
        </div>
      </div>

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
                      <div className="mt-0.5 text-xs text-dim">{triggerDesc(tpl, t)}</div>
                    </div>
                    {(() => {
                      const auto = tpl.trigger !== "manual";
                      const col = auto ? (tpl.active ? "var(--ok)" : "var(--warn)") : "var(--faint)";
                      const label = auto ? (tpl.active ? t("Automatico") : `${t("Automatico")} · ${t("in pausa")}`) : t("Manuale");
                      return <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${col} 18%, transparent)`, color: col }}>{label}</span>;
                    })()}
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs text-dim">{tpl.texts.it || tpl.texts.en || "—"}</div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => { setEditing({ ...tpl, texts: { ...tpl.texts } }); setEditLang("it"); }} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-txt hover:bg-wash">{t("Modifica")}</button>
                    <button onClick={() => del(tpl)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
        {/* Card "aggiungi" tratteggiata, stessa dimensione dei modelli */}
        <div className="grid gap-3 md:grid-cols-2">
          <button onClick={() => { setEditing(emptyTpl()); setEditLang("it"); }} className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-dim transition hover:border-focus hover:text-focus" style={{ background: "var(--surface)" }}>
            <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-current text-2xl font-light leading-none">+</span>
            <span className="text-sm font-semibold">{t("Nuovo modello")}</span>
          </button>
        </div>
      </div>

      {/* Editor */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[6vh]">
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

            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-1">
                {LANGS.map(([l, n]) => (<button key={l} onClick={() => setEditLang(l)} className={`rounded-md px-2 py-1 text-xs font-medium ${editLang === l ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{n.slice(0, 3)}</button>))}
              </div>
              <textarea value={editing.texts[editLang]} onChange={(e) => setEditing({ ...editing, texts: { ...editing.texts, [editLang]: e.target.value } })} rows={5} className="w-full resize-none rounded-lg border border-line bg-paper p-3 text-sm text-txt outline-none focus:border-focus" placeholder={`${t("Testo in")} ${LANGS.find(([l]) => l === editLang)?.[1]}…`} />
              <div className="mt-2"><VarLegend vars={MSG_VARS} onInsert={insertVar} /></div>
            </div>

            <div className="mt-4 rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Invio automatico")}</span>
                <label className="flex items-center gap-2 text-xs text-dim">{t("Attivo")}<input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-3 block text-xs font-medium text-dim sm:col-span-1">{t("Quando")}
                  <select value={editing.trigger} onChange={(e) => setEditing({ ...editing, trigger: e.target.value as Trigger })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">{TRIGGERS.map(([v, n]) => (<option key={v} value={v}>{t(n)}</option>))}</select>
                </label>
                {needsDays(editing.trigger) && (
                  <label className="block text-xs font-medium text-dim">{t("Giorni")}<input type="number" min={0} value={editing.days} onChange={(e) => setEditing({ ...editing, days: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
                )}
                {editing.trigger !== "manual" && (
                  <label className="block text-xs font-medium text-dim">{t("Orario")}<input type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
                )}
              </div>
              {editing.trigger !== "manual" && (
                <label className="mt-2 block text-xs font-medium text-dim">{t("Collega a un'attività del «Da fare oggi»")} <span className="font-normal text-faint">{t("(mostra lì la spunta automatica con l'orario)")}</span>
                  <select value={editing.srcId ?? ""} onChange={(e) => setEditing({ ...editing, srcId: e.target.value || undefined })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">
                    {LINKABLE.map(([v, n]) => <option key={v} value={v}>{t(n)}</option>)}
                  </select>
                </label>
              )}
            </div>

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
