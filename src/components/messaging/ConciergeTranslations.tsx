"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { apiPost } from "@/lib/invoicing/client";
import { CATEGORY_LABEL, type ConciergeEntry } from "@/lib/concierge-kb";
import {
  LANG_LABEL, TRANSLATE_LANGS, chunk, pickMasters, tKey, translationState, validateTranslation,
  type TranslateLang, type TranslationItem, type TranslationState,
} from "@/lib/concierge-i18n";

// Traduzioni della base di conoscenza in tedesco, francese e spagnolo. Le traduzioni NON stanno nella tabella (lang it/en):
// le salva/legge la route /api/concierge/translate nel blob app_state del tenant. Qui: stato per lingua, pulsante Traduci/Aggiorna
// con avanzamento, anteprima con modifica e "Approva".
type Row = ConciergeEntry & { id: string };
const CHUNK = 4;                        // voci per chiamata AI (costo/tempo contenuti, errori circoscritti)
const FLAG: Record<TranslateLang, string> = { de: "🇩🇪", fr: "🇫🇷", es: "🇪🇸" };
const inputCls = "w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus";
const catLabel = (c: string) => CATEGORY_LABEL[c] ?? c;

const STATE_LABEL: Record<TranslationState, string> = { missing: "Non tradotta", draft: "Da rivedere", reviewed: "Rivista", stale: "Da aggiornare" };
const STATE_COLOR: Record<TranslationState, string> = { missing: "var(--faint)", draft: "var(--warn)", reviewed: "var(--ok)", stale: "var(--err)" };

type Key = { id: string; lang: TranslateLang };
interface Prog { done: number; total: number; label: string }

export default function ConciergeTranslations({ sid, rows }: { sid: string; rows: Row[] }) {
  const [items, setItems] = useState<Map<string, TranslationItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [prog, setProg] = useState<Prog | null>(null);
  const [fails, setFails] = useState<Map<string, string>>(new Map()); // "id|lang" -> motivo
  const [tab, setTab] = useState<TranslateLang>("de");
  const [filter, setFilter] = useState<"all" | TranslationState>("all");
  const [edit, setEdit] = useState<{ id: string; lang: TranslateLang; title: string; body: string } | null>(null);
  const [editErr, setEditErr] = useState("");
  const [busy, setBusy] = useState(false);
  const cancel = useRef(false);

  const masters = useMemo(() => pickMasters(rows.filter((r) => r.level === "shared" || r.property_id === sid)), [rows, sid]);
  const byId = useMemo(() => new Map(masters.map((m) => [m.id, m])), [masters]);

  useEffect(() => {
    let alive = true;
    apiPost<{ items: TranslationItem[] }>("concierge/translate", { action: "status" })
      .then((r) => { if (alive) setItems(new Map((r.items ?? []).map((i) => [tKey(i.id, i.lang), i]))); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Errore"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const merge = (saved: TranslationItem[]) => setItems((prev) => { const n = new Map(prev); for (const i of saved) n.set(tKey(i.id, i.lang), i); return n; });
  const stateOf = (m: Row, lang: TranslateLang) => translationState(m, items.get(tKey(m.id, lang)));

  const stats = useMemo(() => TRANSLATE_LANGS.map((lang) => {
    let fresh = 0, draft = 0, stale = 0;
    for (const m of masters) {
      const s = translationState(m, items.get(tKey(m.id, lang)));
      if (s === "draft") { fresh++; draft++; } else if (s === "reviewed") fresh++; else if (s === "stale") stale++;
    }
    return { lang, fresh, draft, stale, todo: masters.length - fresh };
  }), [masters, items]);
  const todoTotal = stats.reduce((n, s) => n + s.todo, 0);
  const anyTranslation = stats.some((s) => s.fresh + s.stale > 0);

  // Traduce le chiavi indicate a blocchi di CHUNK per lingua; salva ogni blocco appena arriva (niente si perde se ci si ferma).
  const runKeys = async (keys: Key[], label: string) => {
    if (!keys.length || prog) return;
    cancel.current = false; setErr("");
    setFails((prev) => { const n = new Map(prev); for (const k of keys) n.delete(tKey(k.id, k.lang)); return n; });
    let done = 0;
    setProg({ done, total: keys.length, label });
    let abort = false;
    for (const lang of TRANSLATE_LANGS) {
      const ids = keys.filter((k) => k.lang === lang).map((k) => k.id);
      for (const part of chunk(ids, CHUNK)) {
        if (cancel.current || abort) break;
        try {
          const r = await apiPost<{ results: { id: string; ok: boolean; error?: string }[]; saved: TranslationItem[] }>("concierge/translate", { action: "run", lang, ids: part });
          merge(r.saved ?? []);
          const bad = (r.results ?? []).filter((x) => !x.ok);
          if (bad.length) setFails((prev) => { const n = new Map(prev); for (const b of bad) n.set(tKey(b.id, lang), b.error || "errore"); return n; });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Errore";
          if (/non configurata/i.test(msg)) { setErr(msg); abort = true; }
          setFails((prev) => { const n = new Map(prev); for (const id of part) n.set(tKey(id, lang), msg); return n; });
        }
        done += part.length;
        setProg({ done, total: keys.length, label });
      }
    }
    setProg(null);
  };

  const todoKeys = (langs: TranslateLang[]): Key[] => langs.flatMap((lang) => masters.filter((m) => stateOf(m, lang) === "missing" || stateOf(m, lang) === "stale").map((m) => ({ id: m.id, lang })));
  const failedKeys = (): Key[] => Array.from(fails.keys()).map((k) => { const [id, lang] = k.split("|"); return { id, lang: lang as TranslateLang }; }).filter((k) => byId.has(k.id));

  const approve = async (keys: Key[]) => {
    if (!keys.length || busy) return;
    setBusy(true); setErr("");
    try {
      for (const part of chunk(keys, 100)) {
        const r = await apiPost<{ saved: TranslationItem[] }>("concierge/translate", { action: "approve", keys: part });
        merge(r.saved ?? []);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore"); }
    setBusy(false);
  };

  const saveEdit = async () => {
    if (!edit || busy) return;
    const m = byId.get(edit.id);
    if (!m) return;
    const v = validateTranslation(m, edit);
    if (!v.ok) { setEditErr(`Controlla il testo: ${v.errors.join("; ")}`); return; }
    setBusy(true); setEditErr("");
    try {
      const r = await apiPost<{ saved: TranslationItem[] }>("concierge/translate", { action: "save", id: edit.id, lang: edit.lang, title: edit.title, body: edit.body });
      merge(r.saved ?? []);
      setEdit(null);
    } catch (e) { setEditErr(e instanceof Error ? e.message : "Errore"); }
    setBusy(false);
  };

  const remove = async (k: Key) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      await apiPost("concierge/translate", { action: "remove", id: k.id, lang: k.lang });
      setItems((prev) => { const n = new Map(prev); n.delete(tKey(k.id, k.lang)); return n; });
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore"); }
    setBusy(false);
  };

  const shown = masters.filter((m) => filter === "all" || stateOf(m, tab) === filter);
  const draftKeys = masters.filter((m) => stateOf(m, tab) === "draft").map((m) => ({ id: m.id, lang: tab }));
  const failCount = failedKeys().length;

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Base in 5 lingue (tedesco, francese, spagnolo)</SectionTitle>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {prog ? (
            <button onClick={() => { cancel.current = true; }} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-dim hover:bg-wash">Ferma</button>
          ) : (
            <button
              onClick={() => runKeys(todoKeys(TRANSLATE_LANGS), anyTranslation ? "Aggiorno le traduzioni" : "Traduco la base")}
              disabled={loading || !masters.length || todoTotal === 0}
              className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >{anyTranslation ? "Aggiorna traduzioni" : "Traduci la base in tedesco, francese e spagnolo"}</button>
          )}
        </div>
      </div>
      <p className="mb-3 text-[11px] text-faint">
        L&apos;AI traduce le voci (italiano, o inglese se manca l&apos;italiano) e tu le rivedi. Link, telefoni, indirizzi, password Wi-Fi, codici e il segnaposto {"{{value}}"} restano identici: una traduzione che li altera viene scartata. Le voci automatiche si compilano sempre dalla prenotazione. Dove manca una traduzione il Concierge ripiega sull&apos;inglese e poi sull&apos;italiano. Se cambi una voce originale, la sua traduzione diventa «da aggiornare» e non viene usata finché non la aggiorni o la riapprovi.
      </p>
      {err && <div className="mb-3 rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--err) 12%, transparent)", color: "var(--err)" }}>{err}</div>}

      {loading ? <p className="text-sm text-faint">Carico…</p> : !masters.length ? (
        <p className="text-xs text-faint">Nessuna voce da tradurre per questa struttura.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {stats.map((s) => (
              <button key={s.lang} onClick={() => { setTab(s.lang); setEdit(null); }} className={`rounded-lg border p-2.5 text-left transition ${tab === s.lang ? "border-focus bg-wash" : "border-line bg-paper hover:bg-wash"}`}>
                <div className="text-sm font-semibold text-txt">{FLAG[s.lang]} {LANG_LABEL[s.lang]}</div>
                <div className="text-xs text-dim">{s.fresh}/{masters.length} voci{s.draft ? `, ${s.draft} da rivedere` : ""}{s.stale ? `, ${s.stale} da aggiornare` : ""}</div>
              </button>
            ))}
          </div>

          {prog && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-dim">{prog.label}… {prog.done}/{prog.total} voci</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-wash"><div className="h-full bg-focus transition-all" style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div>
            </div>
          )}

          {failCount > 0 && !prog && (
            <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--warn)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b>{failCount} {failCount === 1 ? "voce non tradotta" : "voci non tradotte"}</b>
                <button onClick={() => runKeys(failedKeys(), "Riprovo")} className="rounded-lg border border-line bg-paper px-2.5 py-1 font-semibold text-focus hover:bg-wash">Riprova</button>
              </div>
              <ul className="mt-1 space-y-0.5 font-normal">
                {failedKeys().slice(0, 6).map((k) => <li key={tKey(k.id, k.lang)}>{FLAG[k.lang]} «{byId.get(k.id)?.title}»: {fails.get(tKey(k.id, k.lang))}</li>)}
                {failCount > 6 && <li>… e altre {failCount - 6}</li>}
              </ul>
            </div>
          )}

          <div className="mb-2 mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold text-txt">Anteprima {FLAG[tab]} {LANG_LABEL[tab]}</div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="rounded-lg border border-line bg-paper px-2 py-1 text-xs text-txt outline-none focus:border-focus">
                <option value="all">Tutte le voci</option>
                <option value="draft">Da rivedere</option>
                <option value="stale">Da aggiornare</option>
                <option value="missing">Non tradotte</option>
                <option value="reviewed">Riviste</option>
              </select>
              {draftKeys.length > 0 && <button onClick={() => approve(draftKeys)} disabled={busy} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50">Approva tutte le da rivedere ({draftKeys.length})</button>}
            </div>
          </div>

          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 520 }}>
            {shown.length === 0 && <p className="text-xs text-faint">Nessuna voce con questo filtro.</p>}
            {shown.map((m) => {
              const it = items.get(tKey(m.id, tab));
              const st = translationState(m, it);
              const editing = edit?.id === m.id && edit.lang === tab;
              const reason = fails.get(tKey(m.id, tab));
              return (
                <div key={m.id} className="rounded-lg border border-line bg-paper p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{catLabel(m.category)}</span>
                    {m.field_type === "auto" && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>Automatico</span>}
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${STATE_COLOR[st]} 14%, transparent)`, color: STATE_COLOR[st] }}>{STATE_LABEL[st]}</span>
                    {it && <span className="text-[10px] text-faint">tradotta il {new Date(it.ts).toLocaleDateString("it-IT")}</span>}
                  </div>
                  <div className="mt-1.5 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Originale ({m.lang.toUpperCase()})</div>
                      <div className="text-sm font-semibold text-txt">{m.title}</div>
                      <div className="whitespace-pre-line text-xs text-dim">{m.body}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Traduzione ({tab.toUpperCase()})</div>
                      {editing && edit ? (
                        <div className="space-y-1.5">
                          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className={`${inputCls} font-semibold`} />
                          <textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={5} className={`${inputCls} resize-y`} />
                          {m.field_type === "auto" && <p className="text-[11px] text-faint">Lascia {"{{value}}"} nel testo: viene sostituito col valore preso dalla prenotazione.</p>}
                          {editErr && <p className="text-[11px] font-medium" style={{ color: "var(--err)" }}>{editErr}</p>}
                          <div className="flex justify-end gap-2">
                            <button onClick={() => { setEdit(null); setEditErr(""); }} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-dim hover:bg-wash disabled:opacity-50">Annulla</button>
                            <button onClick={saveEdit} disabled={busy || !edit.title.trim() || !edit.body.trim()} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? "Salvo…" : "Salva e approva"}</button>
                          </div>
                        </div>
                      ) : it ? (
                        <>
                          <div className="text-sm font-semibold text-txt">{it.title}</div>
                          <div className="whitespace-pre-line text-xs text-dim">{it.body}</div>
                          {st === "stale" && <div className="mt-1 text-[11px]" style={{ color: "var(--err)" }}>L&apos;originale è cambiato dopo la traduzione: finché non la aggiorni il Concierge non la usa.</div>}
                        </>
                      ) : (
                        <div className="text-xs text-faint">—{reason ? ` ${reason}` : ""}</div>
                      )}
                    </div>
                  </div>
                  {!editing && (
                    <div className="mt-1.5 flex flex-wrap justify-end gap-3 text-xs">
                      {(st === "draft" || st === "stale") && it && <button onClick={() => approve([{ id: m.id, lang: tab }])} disabled={busy || !!prog} className="font-medium text-focus hover:underline disabled:opacity-50">Approva</button>}
                      {(st === "missing" || st === "stale") && <button onClick={() => runKeys([{ id: m.id, lang: tab }], "Traduco")} disabled={!!prog || busy} className="font-medium text-focus hover:underline disabled:opacity-50">{st === "stale" ? "Ritraduci" : "Traduci"}</button>}
                      <button onClick={() => { setEdit({ id: m.id, lang: tab, title: it?.title ?? m.title, body: it?.body ?? m.body }); setEditErr(""); }} className="font-medium text-dim hover:underline">{it ? "Modifica" : "Scrivi a mano"}</button>
                      {it && <button onClick={() => remove({ id: m.id, lang: tab })} disabled={busy} className="text-faint hover:text-[color:var(--err)] disabled:opacity-50">Elimina traduzione</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
