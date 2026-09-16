"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { downscaleImage } from "@/lib/images";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { buildPublishData, slugify, RESERVED_SLUGS } from "@/lib/publicdata";

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
  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setC({ ...DEF, ...JSON.parse(r) }); } catch {} }, []);
  useEffect(() => { if ((!sid || !structures.some((s) => s.id === sid)) && structures[0]) setSid(structures[0].id); }, [structures, sid]);
  const set = (patch: Partial<Cfg>) => setC((p) => { const n = { ...p, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; });
  const toggleLang = (l: string) => set({ lang: c.lang.includes(l) ? c.lang.filter((x) => x !== l) : [...c.lang, l] });
  // Nome e link presi dalla struttura (fonte di verità = scheda struttura).
  const struct = structures.find((s) => s.id === sid);
  const siteName = struct?.name || "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // Dominio pubblico canonico: l'indirizzo del sito è SEMPRE su xenora.it,
  // anche se stai navigando l'app dal dominio *.vercel.app.
  const PUBLIC_HOST = "xenora.it";
  const publicBase = `https://${PUBLIC_HOST}`;
  // Preview del proprietario (legge dal browser). Il sito PUBBLICO usa lo slug.
  const previewLink = `${origin}/sito-web${sid ? `?s=${sid}` : ""}`;
  const openPreview = () => window.open(previewLink, "_blank");

  // --- Pubblicazione Xenosite (xenora.it/<slug>) -----------------------------
  const { user } = useAuth();
  const [slug, setSlug] = useState("");
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null); // slug attualmente online
  const [pubBusy, setPubBusy] = useState(false);
  const [pubMsg, setPubMsg] = useState("");
  const [pubCopied, setPubCopied] = useState(false);
  const publicUrl = slug ? `${publicBase}/${slug}` : "";

  // Slug proposto dal nome quando cambio struttura; carico lo stato pubblicato dal server.
  useEffect(() => {
    if (!sid) return;
    setSlug(slugify(siteName) || "struttura");
    setPublishedSlug(null);
    setPubMsg("");
    if (!supabase) return;
    supabase.from("public_sites").select("slug").eq("structure_id", sid).maybeSingle()
      .then(({ data }) => { if (data?.slug) { setSlug(data.slug); setPublishedSlug(data.slug); } });
  }, [sid, siteName]);

  const cleanSlug = (v: string) => slugify(v);

  const publish = async () => {
    if (!supabase || !user) { setPubMsg(t("Devi essere connesso per pubblicare.")); return; }
    const base = cleanSlug(slug) || slugify(siteName) || "struttura";
    if (RESERVED_SLUGS.has(base)) { setPubMsg(t("Questo indirizzo è riservato, scegline un altro.")); return; }
    const data = buildPublishData(sid);
    if (!data) { setPubMsg(t("Dati struttura non disponibili.")); return; }
    setPubBusy(true); setPubMsg("");
    try {
      // Risolvo eventuali collisioni con lo slug di un ALTRO utente aggiungendo un suffisso.
      let finalSlug = base;
      for (let i = 0; i < 30; i++) {
        const { data: row } = await supabase.from("public_sites").select("slug,user_id,structure_id").eq("slug", finalSlug).maybeSingle();
        if (!row) break; // libero
        if (row.user_id === user.id && row.structure_id === sid) break; // è già il mio (aggiorno)
        finalSlug = `${base}-${i + 2}`; // occupato da altri → provo base-2, base-3…
      }
      // Se questa struttura era pubblicata con uno slug diverso, rimuovo il vecchio record.
      if (publishedSlug && publishedSlug !== finalSlug) {
        await supabase.from("public_sites").delete().eq("slug", publishedSlug).eq("user_id", user.id);
      }
      const { error } = await supabase.from("public_sites").upsert({
        slug: finalSlug, user_id: user.id, structure_id: sid, structure_name: siteName, data, updated_at: new Date().toISOString(),
      });
      if (error) { setPubMsg(t("Pubblicazione non riuscita.") + " " + error.message); }
      else { setSlug(finalSlug); setPublishedSlug(finalSlug); setPubMsg(t("Sito online e aggiornato ✓")); }
    } catch (e) {
      setPubMsg(t("Pubblicazione non riuscita.") + " " + (e instanceof Error ? e.message : ""));
    } finally { setPubBusy(false); }
  };

  const unpublish = async () => {
    if (!supabase || !user || !publishedSlug) return;
    setPubBusy(true); setPubMsg("");
    try {
      await supabase.from("public_sites").delete().eq("slug", publishedSlug).eq("user_id", user.id);
      setPublishedSlug(null); setPubMsg(t("Sito rimosso dal pubblico."));
    } finally { setPubBusy(false); }
  };
  const isDirtySlug = publishedSlug !== null && cleanSlug(slug) !== publishedSlug;

  return (
    <div>
      <PageHeader title="Xenosite" subtitle={t("Il tuo mini-sito con motore di prenotazione integrato")} actions={<button onClick={openPreview} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">{t("Anteprima")} ↗</button>} />

      {/* Pubblicazione: l'indirizzo pubblico xenora.it/<nome> */}
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>{t("Indirizzo pubblico")}</SectionTitle>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${publishedSlug ? "text-white" : "bg-wash text-dim"}`} style={publishedSlug ? { backgroundColor: "var(--ok)" } : undefined}>{publishedSlug ? t("Online") : t("Non pubblicato")}</span>
        </div>
        <p className="mb-2 mt-0.5 text-xs text-dim">{t("Scegli l'indirizzo del tuo sito. I visitatori lo vedranno senza login; i dati degli ospiti non vengono pubblicati.")}</p>
        <div className="flex flex-wrap items-stretch gap-2">
          <div className="flex min-w-0 flex-1 items-center rounded-lg border border-line bg-paper focus-within:border-focus">
            <span className="whitespace-nowrap pl-3 text-sm text-faint">{PUBLIC_HOST}/</span>
            <input value={slug} onChange={(e) => setSlug(cleanSlug(e.target.value))} placeholder="nome-struttura" className="min-w-0 flex-1 bg-transparent py-2 pr-3 text-sm font-semibold text-txt outline-none" />
          </div>
          <button onClick={publish} disabled={pubBusy || !slug} className="shrink-0 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{pubBusy ? t("Pubblico…") : publishedSlug ? (isDirtySlug ? t("Cambia indirizzo") : t("Aggiorna")) : t("Pubblica")}</button>
        </div>
        {publishedSlug && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a href={`${publicBase}/${publishedSlug}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-focus hover:underline">{PUBLIC_HOST}/{publishedSlug} ↗</a>
            <button onClick={() => { navigator.clipboard?.writeText(`${publicBase}/${publishedSlug}`); setPubCopied(true); window.setTimeout(() => setPubCopied(false), 1500); }} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash">{pubCopied ? t("Copiato ✓") : t("Copia link")}</button>
            <button onClick={unpublish} disabled={pubBusy} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-faint hover:text-[color:var(--err)] disabled:opacity-50">{t("Rimuovi dal pubblico")}</button>
          </div>
        )}
        {pubMsg && <p className="mt-2 text-[12px] font-medium text-dim">{pubMsg}</p>}
        {publishedSlug && <p className="mt-1 text-[11px] text-faint">{t("Dopo ogni modifica ai contenuti o alle camere, premi «Aggiorna» per aggiornare il sito online.")}</p>}
      </Card>

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
          <div className="mb-3 flex items-center justify-between"><SectionTitle>{t("Anteprima")}</SectionTitle>{publishedSlug ? <a href={`${publicBase}/${publishedSlug}`} target="_blank" rel="noreferrer" className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-focus hover:underline">{PUBLIC_HOST}/{publishedSlug} ↗</a> : <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{slug ? `${PUBLIC_HOST}/${slug}` : t("non pubblicato")}</span>}</div>
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
