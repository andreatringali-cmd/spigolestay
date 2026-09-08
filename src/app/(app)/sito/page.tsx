"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { downscaleImage } from "@/lib/images";
import { useLang } from "@/lib/i18n";

interface Cfg { nome: string; dominio: string; tagline: string; accent: string; heroBg?: string; googleUrl?: string; hero: boolean; camere: boolean; recensioni: boolean; mappa: boolean; contatti: boolean; lang: string[] }
const DEF: Cfg = { nome: "", dominio: "", tagline: "", accent: "#4F46E5", heroBg: "", googleUrl: "", hero: true, camere: true, recensioni: true, mappa: true, contatti: true, lang: ["it", "en"] };
const LANGS = [["it", "Italiano"], ["en", "English"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]] as const;
const SEZIONI: { key: keyof Cfg; label: string }[] = [
  { key: "hero", label: "Copertina (hero)" }, { key: "camere", label: "Camere e prezzi" }, { key: "recensioni", label: "Recensioni" }, { key: "mappa", label: "Mappa e dintorni" }, { key: "contatti", label: "Contatti" },
];
const KEY = "spigolestay:sito";

export default function SitoPage() {
  const { t } = useLang();
  const { structures } = useData();
  const [c, setC] = useState<Cfg>(DEF);
  const [sid, setSid] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setC({ ...DEF, ...JSON.parse(r) }); } catch {} }, []);
  useEffect(() => { if ((!sid || !structures.some((s) => s.id === sid)) && structures[0]) setSid(structures[0].id); }, [structures, sid]);
  const set = (patch: Partial<Cfg>) => setC((p) => { const n = { ...p, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; });
  const toggleLang = (l: string) => set({ lang: c.lang.includes(l) ? c.lang.filter((x) => x !== l) : [...c.lang, l] });
  // Nome e link presi dalla struttura (fonte di verità = scheda struttura).
  const struct = structures.find((s) => s.id === sid);
  const siteName = struct?.name || "";
  const slug = (siteName || "struttura").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicLink = `${origin}/sito-web${sid ? `?s=${sid}` : ""}`;
  const suggestedDomain = `${slug}.xenora.app`;
  const openPublic = () => window.open(publicLink, "_blank");

  return (
    <div>
      <PageHeader title={t("Sito web")} subtitle={t("Il tuo mini-sito con motore di prenotazione integrato")} actions={<a href="/sito-web" target="_blank" rel="noreferrer" className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Apri sito pubblico")} ↗</a>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("Contenuti")}</SectionTitle>
            {structures.length > 1 && (
              <label className="mb-2 block"><span className="text-xs text-dim">{t("Struttura")}</span>
                <select value={sid} onChange={(e) => setSid(e.target.value)} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus">{structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </label>
            )}
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Nome struttura")} <span className="text-faint">({t("dalla scheda struttura")})</span></span><input value={siteName} readOnly disabled className="mt-0.5 w-full cursor-not-allowed rounded-lg border border-line bg-wash px-3 py-2 text-sm text-dim" /></label>
            <div className="mb-2">
              <span className="text-xs text-dim">{t("Link del sito")}</span>
              <div className="mt-0.5 flex items-center gap-2">
                <input value={publicLink} readOnly className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none" />
                <button onClick={() => { navigator.clipboard?.writeText(publicLink); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-txt hover:bg-wash">{copied ? t("Copiato ✓") : t("Copia")}</button>
                <button onClick={openPublic} className="shrink-0 rounded-lg bg-focus px-3 py-2 text-xs font-semibold text-white hover:opacity-90">{t("Apri")} ↗</button>
              </div>
              <span className="mt-1 block text-[11px] text-faint">{t("Dominio consigliato")}: <b className="text-dim">{suggestedDomain}</b> — {t("in produzione potrai collegarlo al tuo dominio.")}</span>
            </div>
            <label className="mb-3 block"><span className="text-xs text-dim">{t("Sottotitolo")}</span><input value={c.tagline} onChange={(e) => set({ tagline: e.target.value })} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            <label className="mb-3 block"><span className="text-xs text-dim">{t("Link recensioni Google")} <span className="text-faint">({t("opzionale")})</span></span><input value={c.googleUrl ?? ""} onChange={(e) => set({ googleUrl: e.target.value })} placeholder="https://g.page/…/review" className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            <div className="mb-1 text-xs text-dim">{t("Colore")}</div>
            <div className="flex gap-2">{["#4F46E5", "#0E9F6E", "#BE5D38", "#2563EB", "#DB2777", "#0891B2"].map((col) => <button key={col} onClick={() => set({ accent: col })} className={`h-7 w-7 rounded-full border-2 ${c.accent === col ? "border-txt" : "border-transparent"}`} style={{ backgroundColor: col }} />)}</div>
            <div className="mb-1 mt-4 text-xs text-dim">{t("Sfondo copertina")}</div>
            <div className="flex items-center gap-2">
              {c.heroBg
                ? <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg border border-line" style={{ backgroundImage: `url(${c.heroBg})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                : <div className="grid h-12 w-20 shrink-0 place-items-center rounded-lg border border-line text-[10px] text-faint" style={{ background: `linear-gradient(135deg, ${c.accent}, color-mix(in srgb, ${c.accent} 55%, #000))` }}>{t("colore")}</div>}
              <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-focus hover:bg-wash">{c.heroBg ? t("Cambia foto") : t("Carica foto")}<input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { set({ heroBg: await downscaleImage(f, 1600, 0.72) }); } catch {} } e.target.value = ""; }} /></label>
              {c.heroBg && <button onClick={() => set({ heroBg: "" })} className="text-xs font-medium text-faint hover:text-[color:var(--err)]">{t("Rimuovi")}</button>}
            </div>
            <p className="mt-1 text-[11px] text-faint">{t("Se non carichi una foto, la copertina usa il colore scelto.")}</p>
          </Card>
          <Card>
            <SectionTitle>{t("Sezioni")}</SectionTitle>
            <div className="flex flex-col gap-2">
              {SEZIONI.map((s) => (
                <label key={s.key} className="flex cursor-pointer items-center justify-between">
                  <span className="text-sm text-txt">{t(s.label)}</span>
                  <input type="checkbox" checked={c[s.key] as boolean} onChange={(e) => set({ [s.key]: e.target.checked } as Partial<Cfg>)} className="h-4 w-4 accent-[color:var(--focus)]" />
                </label>
              ))}
            </div>
            <div className="mb-1 mt-4 text-xs text-dim">{t("Lingue")}</div>
            <div className="flex flex-wrap gap-1.5">{LANGS.map(([code, label]) => <button key={code} onClick={() => toggleLang(code)} className={`rounded-full px-3 py-1 text-xs font-medium transition ${c.lang.includes(code) ? "bg-focus text-white" : "border border-line text-dim hover:bg-wash"}`}>{label}</button>)}</div>
          </Card>
        </div>

        <Card>
          <div className="mb-3 flex items-center justify-between"><SectionTitle>{t("Anteprima")}</SectionTitle><span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{suggestedDomain}</span></div>
          <div className="overflow-hidden rounded-xl border border-line">
            {c.hero && (
              <div className="relative p-6 text-white" style={{ background: c.heroBg ? `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), url(${c.heroBg}) center/cover no-repeat` : `linear-gradient(135deg, ${c.accent}, color-mix(in srgb, ${c.accent} 55%, #000))` }}>
                <div className="text-lg font-bold">{siteName || c.nome}</div>
                <div className="mt-1 text-sm opacity-90">{c.tagline}</div>
                <div className="mt-4 inline-block rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold" style={{ color: c.accent }}>{t("Verifica disponibilità")} →</div>
              </div>
            )}
            <div className="flex flex-col divide-y divide-[color:var(--line)] bg-surface">
              {c.camere && <div className="px-4 py-3 text-sm text-txt">{t("Camere e prezzi")} <span className="text-faint">· {t("da")} {structures.length} {structures.length === 1 ? t("struttura") : t("strutture")}, {t("sincronizzate col calendario")}</span></div>}
              {c.recensioni && <div className="px-4 py-3 text-sm text-txt">{t("Recensioni")} <span className="text-faint">· ★ 9,4 · 128 {t("giudizi")}</span></div>}
              {c.mappa && <div className="px-4 py-3 text-sm text-txt">{t("Mappa e dintorni")} <span className="text-faint">· Ortigia, Siracusa</span></div>}
              {c.contatti && <div className="px-4 py-3 text-sm text-txt">{t("Contatti")} <span className="text-faint">· {t("WhatsApp, email, telefono")}</span></div>}
            </div>
          </div>
          <p className="mt-3 text-xs text-faint">{t("Il motore di prenotazione è lo stesso del")} <Link href="/widget" className="font-medium text-focus hover:underline">{t("Widget sito")}</Link>: {t("ogni prenotazione entra diretta nel calendario, senza commissioni.")}</p>
        </Card>
      </div>
    </div>
  );
}
