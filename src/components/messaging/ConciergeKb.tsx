"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useData } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/invoicing/client";
import {
  CATEGORY_LABEL, CATEGORY_ORDER, mapUrlOf, renderEntry, resolveEntries,
  type AutoSource, type ConciergeEntry, type ConciergeLang,
} from "@/lib/concierge-kb";

const AUTO_LABEL: Record<AutoSource, string> = {
  access_code: "Codice di accesso", city_tax: "Tassa di soggiorno", checkin_time: "Orario check-in", checkout_time: "Orario check-out",
};
const AUTO_SOURCES = Object.keys(AUTO_LABEL) as AutoSource[];
const inputCls = "w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus";
const catLabel = (c: string) => CATEGORY_LABEL[c] ?? c;

type Row = ConciergeEntry & { id: string };

interface Draft {
  id?: string;
  level: "shared" | "property";
  category: string;
  lang: ConciergeLang;
  field_type: "editorial" | "auto";
  auto_source: AutoSource | null;
  title: string;
  body: string;
  phone: string;
  address: string;
  map_url: string;
  sort_order: string;
}

const emptyDraft = (lang: ConciergeLang): Draft => ({
  level: "property", category: "servizi", lang, field_type: "editorial", auto_source: null,
  title: "", body: "", phone: "", address: "", map_url: "", sort_order: "100",
});
const toDraft = (e: Row): Draft => ({
  id: e.id, level: e.level, category: e.category, lang: e.lang, field_type: e.field_type, auto_source: e.auto_source,
  title: e.title, body: e.body, phone: e.phone ?? "", address: e.address ?? "", map_url: e.map_url ?? "", sort_order: String(e.sort_order ?? 0),
});

const Badge = ({ children, tone }: { children: React.ReactNode; tone?: "auto" | "level" }) => (
  <span
    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
    style={tone === "auto"
      ? { backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }
      : { backgroundColor: "var(--wash)", color: "var(--dim)" }}
  >{children}</span>
);

function Actions({ phone, mapUrl, tel, waUrl }: { phone?: string | null; mapUrl: string; tel: string; waUrl: string }) {
  if (!mapUrl && !phone) return null;
  const cls = "rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash";
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {mapUrl && <a href={mapUrl} target="_blank" rel="noopener noreferrer" className={cls}>Apri la mappa</a>}
      {tel && <a href={tel} className={cls}>Chiama</a>}
      {waUrl && <a href={waUrl} target="_blank" rel="noopener noreferrer" className={cls}>WhatsApp</a>}
    </div>
  );
}

function EntryForm({ draft, setDraft, onSave, onCancel, saving, isNew, structureName }: {
  draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel: () => void; saving: boolean; isNew: boolean; structureName: string;
}) {
  const upd = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const isAuto = draft.field_type === "auto";
  const missingPh = isAuto && !/\{\{\s*value\s*\}\}/.test(draft.body);
  const invalid = !draft.title.trim() || !draft.body.trim() || (isAuto && !draft.auto_source) || missingPh;
  return (
    <div className="space-y-2 rounded-lg border border-focus bg-paper p-3">
      {isNew && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-[11px] font-semibold text-faint">Livello
            <select value={draft.level} onChange={(e) => upd({ level: e.target.value as Draft["level"] })} className={`${inputCls} mt-0.5`}>
              <option value="property">Struttura: {structureName}</option>
              <option value="shared">Condiviso</option>
            </select>
          </label>
          <label className="text-[11px] font-semibold text-faint">Categoria
            <select value={draft.category} onChange={(e) => upd({ category: e.target.value })} className={`${inputCls} mt-0.5`}>
              {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-faint">Lingua
            <select value={draft.lang} onChange={(e) => upd({ lang: e.target.value as ConciergeLang })} className={`${inputCls} mt-0.5`}>
              <option value="it">Italiano</option><option value="en">English</option>
            </select>
          </label>
          <label className="text-[11px] font-semibold text-faint">Tipo
            <select
              value={draft.field_type}
              onChange={(e) => {
                const t = e.target.value as Draft["field_type"];
                upd(t === "auto" ? { field_type: "auto", auto_source: draft.auto_source ?? "access_code", body: draft.body || "{{value}}" } : { field_type: "editorial", auto_source: null });
              }}
              className={`${inputCls} mt-0.5`}
            >
              <option value="editorial">Testo</option><option value="auto">Automatico</option>
            </select>
          </label>
        </div>
      )}
      {isAuto && (
        <label className="block text-[11px] font-semibold text-faint">Sorgente automatica
          <select value={draft.auto_source ?? ""} onChange={(e) => upd({ auto_source: (e.target.value || null) as AutoSource | null })} className={`${inputCls} mt-0.5`}>
            <option value="">Scegli…</option>
            {AUTO_SOURCES.map((s) => <option key={s} value={s}>{AUTO_LABEL[s]}</option>)}
          </select>
        </label>
      )}
      <label className="block text-[11px] font-semibold text-faint">Titolo
        <input value={draft.title} onChange={(e) => upd({ title: e.target.value })} className={`${inputCls} mt-0.5 font-semibold`} />
      </label>
      <label className="block text-[11px] font-semibold text-faint">Testo
        <textarea value={draft.body} onChange={(e) => upd({ body: e.target.value })} rows={4} className={`${inputCls} mt-0.5 resize-y`} />
      </label>
      {isAuto && (
        <p className="text-[11px]" style={{ color: missingPh ? "var(--err)" : "var(--faint)" }}>
          {missingPh
            ? "Il testo di una voce automatica deve contenere il segnaposto {{value}}: lì viene inserito il valore preso dalla prenotazione."
            : "Lascia {{value}} nel testo: viene sostituito col valore preso dalla prenotazione."}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-semibold text-faint">Telefono (con prefisso, es. +39…)
          <input value={draft.phone} onChange={(e) => upd({ phone: e.target.value })} className={`${inputCls} mt-0.5`} />
        </label>
        <label className="text-[11px] font-semibold text-faint">Ordine
          <input type="number" value={draft.sort_order} onChange={(e) => upd({ sort_order: e.target.value })} className={`${inputCls} mt-0.5`} />
        </label>
        <label className="text-[11px] font-semibold text-faint">Indirizzo (per la mappa)
          <input value={draft.address} onChange={(e) => upd({ address: e.target.value })} className={`${inputCls} mt-0.5`} />
        </label>
        <label className="text-[11px] font-semibold text-faint">Link mappa (override facoltativo)
          <input value={draft.map_url} onChange={(e) => upd({ map_url: e.target.value })} placeholder="https://…" className={`${inputCls} mt-0.5`} />
        </label>
      </div>
      <p className="text-[11px] text-faint">Link mappa: lascia vuoto, la mappa si genera dall&apos;indirizzo.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={saving} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-dim hover:bg-wash disabled:opacity-50">Annulla</button>
        <button onClick={onSave} disabled={saving || invalid} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{saving ? "Salvo…" : isNew ? "Crea voce" : "Salva"}</button>
      </div>
    </div>
  );
}

export default function ConciergeKb({ sid }: { sid: string }) {
  const { structures, bookings, guests } = useData();
  const ask = useConfirm();
  const st = structures.find((s) => s.id === sid);
  const stName = st?.name || "—";

  const [lang, setLang] = useState<ConciergeLang>("it");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setErr("Supabase non configurato: base di conoscenza non disponibile."); setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.from("concierge_entries").select("*").order("sort_order", { ascending: true });
    if (error) setErr(error.message); else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDraft(null); }, [sid]);

  // Voci visibili: della struttura scelta e condivise, nella lingua scelta.
  const visible = useMemo(() => rows.filter((r) => r.lang === lang && (r.level === "shared" || r.property_id === sid)), [rows, lang, sid]);
  const propRows = useMemo(() => visible.filter((r) => r.level === "property"), [visible]);
  const sharedRows = useMemo(() => visible.filter((r) => r.level === "shared"), [visible]);

  const group = (list: Row[]) => {
    const cats = [...new Set(list.map((r) => r.category))].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return cats.map((c) => ({ cat: c, items: list.filter((r) => r.category === c).sort((a, b) => a.sort_order - b.sort_order) }));
  };

  const other: ConciergeLang = lang === "it" ? "en" : "it";
  const hasTwin = (e: Row) => rows.some((r) => r.id !== e.id && r.lang === other && r.level === e.level && r.property_id === e.property_id && r.category === e.category && r.field_type === e.field_type && r.auto_source === e.auto_source);

  const payload = (d: Draft) => ({
    category: d.category, lang: d.lang, field_type: d.field_type, auto_source: d.field_type === "auto" ? d.auto_source : null,
    title: d.title.trim(), body: d.body.trim(),
    phone: d.phone.trim() || null, address: d.address.trim() || null, map_url: d.map_url.trim() || null,
    sort_order: Number.isFinite(parseInt(d.sort_order, 10)) ? parseInt(d.sort_order, 10) : 0,
  });

  const save = async () => {
    if (!supabase || !draft) return;
    setSaving(true); setErr("");
    const p = payload(draft);
    const res = draft.id
      ? await supabase.from("concierge_entries").update({ ...p, updated_at: new Date().toISOString() }).eq("id", draft.id)
      : await supabase.from("concierge_entries").insert({ ...p, level: draft.level, property_id: draft.level === "property" ? sid : null });
    setSaving(false);
    if (res.error) { setErr(`Salvataggio non riuscito: ${res.error.message}`); return; }
    setDraft(null);
    await load();
  };

  const remove = async (e: Row) => {
    if (!supabase) return;
    const ok = await ask({ title: "Eliminare la voce?", message: `«${e.title}» (${e.lang.toUpperCase()}) verrà eliminata definitivamente dalla base di conoscenza.`, confirmLabel: "Elimina", danger: true });
    if (!ok) return;
    const { error } = await supabase.from("concierge_entries").delete().eq("id", e.id);
    if (error) { setErr(`Eliminazione non riuscita: ${error.message}`); return; }
    setDraft(null);
    await load();
  };

  const duplicate = async (e: Row) => {
    if (!supabase) return;
    setErr("");
    const { error } = await supabase.from("concierge_entries").insert({
      level: e.level, property_id: e.property_id, category: e.category, field_type: e.field_type, auto_source: e.auto_source,
      title: e.title, body: e.body, lang: other, sort_order: e.sort_order, phone: e.phone ?? null, address: e.address ?? null, map_url: e.map_url ?? null,
    });
    if (error) { setErr(`Duplicazione non riuscita: ${error.message}`); return; }
    await load();
  };

  const renderRow = (e: Row) => {
    const r = renderEntry(e, {}, e.lang);
    if (draft?.id === e.id) {
      return <EntryForm key={e.id} draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setDraft(null)} saving={saving} isNew={false} structureName={stName} />;
    }
    return (
      <div key={e.id} className="rounded-lg border border-line bg-paper p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-txt">{e.title}</span>
          <Badge tone="level">{e.level === "property" ? "Struttura" : "Condiviso"}</Badge>
          {e.field_type === "auto" && <Badge tone="auto">Automatico · {e.auto_source ? AUTO_LABEL[e.auto_source] : "?"}</Badge>}
        </div>
        <div className="mt-1 whitespace-pre-line text-xs text-dim">{e.body}</div>
        <Actions phone={e.phone} mapUrl={mapUrlOf(e)} tel={r.tel} waUrl={r.waUrl} />
        <div className="mt-1.5 flex flex-wrap justify-end gap-3 text-xs">
          {!hasTwin(e) && <button onClick={() => duplicate(e)} className="font-medium text-dim hover:underline">Duplica in {other.toUpperCase()}</button>}
          <button onClick={() => setDraft(toDraft(e))} className="font-medium text-focus hover:underline">Modifica</button>
          <button onClick={() => remove(e)} className="text-faint hover:text-[color:var(--err)]">Elimina</button>
        </div>
      </div>
    );
  };

  const block = (title: string, list: Row[], empty: string) => (
    <div className="space-y-3">
      <div className="text-sm font-bold text-txt">{title} <span className="font-normal text-faint">({list.length})</span></div>
      {list.length === 0 && <p className="text-xs text-faint">{empty}</p>}
      {group(list).map((g) => (
        <div key={g.cat} className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{catLabel(g.cat)}</div>
          {g.items.map(renderRow)}
        </div>
      ))}
    </div>
  );

  // Anteprima: elenco risolto (struttura > condiviso) con valori AUTO di ripiego.
  const preview = useMemo(
    () => resolveEntries(rows, sid, lang).map((e) => ({ e, r: renderEntry(e, { structure: st }, lang) })),
    [rows, sid, lang, st],
  );

  // Prova il Concierge (route server).
  const [q, setQ] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState("");
  const [res, setRes] = useState<{ ok: boolean; answered: boolean; reply?: string; topic?: string; reason?: string; question: string } | null>(null);
  const bookingOptions = useMemo(() => bookings
    .filter((b) => b.structureId === sid)
    .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
    .slice(0, 80)
    .map((b) => {
      const g = guests.find((x) => x.id === b.guestId);
      const name = (g?.fullName || "").trim();
      const last = name.split(/\s+/).slice(-1)[0] || "Ospite";
      return { id: b.id, label: `${last} · ${b.checkIn} → ${b.checkOut}` };
    }), [bookings, guests, sid]);
  useEffect(() => { setBookingId(""); setRes(null); setAskErr(""); }, [sid]);

  const submit = async () => {
    const message = q.trim();
    if (!message || asking) return;
    setAsking(true); setAskErr(""); setRes(null);
    try {
      const r = await apiPost<{ ok: boolean; answered: boolean; reply?: string; topic?: string; reason?: string }>("concierge/ask", { structureId: sid, bookingId: bookingId || undefined, message });
      setRes({ ...r, question: message });
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : "Errore");
    }
    setAsking(false);
  };

  return (
    <div className="mb-4 space-y-4">
      <Card>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Base di conoscenza del Concierge</SectionTitle>
          <div className="mb-3 flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-line p-0.5">
              {(["it", "en"] as ConciergeLang[]).map((l) => (
                <button key={l} onClick={() => { setLang(l); setDraft(null); }} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${lang === l ? "bg-wash text-txt" : "text-faint hover:text-dim"}`}>{l.toUpperCase()}</button>
              ))}
            </div>
            <button onClick={() => setDraft(emptyDraft(lang))} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash">+ Nuova voce</button>
          </div>
        </div>
        <p className="mb-3 text-[11px] text-faint">Le voci della struttura sostituiscono quelle condivise della stessa categoria. Le voci automatiche prendono il valore dalla prenotazione; mappe e pulsanti si generano da indirizzo e telefono.</p>
        {err && <div className="mb-3 rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--err) 12%, transparent)", color: "var(--err)" }}>{err}</div>}
        {draft && !draft.id && <div className="mb-3"><EntryForm draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setDraft(null)} saving={saving} isNew structureName={stName} /></div>}
        {loading ? <p className="text-sm text-faint">Carico…</p> : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {block(`Struttura: ${stName}`, propRows, "Nessuna voce specifica per questa struttura in questa lingua.")}
            {block("Condiviso (tutta l'area)", sharedRows, "Nessuna voce condivisa in questa lingua.")}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Anteprima: come la vedrebbe l&apos;ospite ({lang.toUpperCase()})</SectionTitle>
          <p className="mb-2 text-[11px] text-faint">Elenco risolto: struttura prima del condiviso. I valori automatici appaiono col testo di ripiego.</p>
          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 460 }}>
            {preview.length === 0 && <p className="text-xs text-faint">Nessuna voce da mostrare.</p>}
            {preview.map(({ e, r }, i) => (
              <div key={(e.id ?? "") + i} className="rounded-lg border border-line bg-paper p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{catLabel(e.category)}</span>
                  <Badge tone="level">{e.level === "property" ? "Struttura" : "Condiviso"}</Badge>
                  {r.auto && <Badge tone="auto">Automatico</Badge>}
                </div>
                <div className="mt-0.5 text-sm font-semibold text-txt">{r.title}</div>
                <div className="whitespace-pre-line text-xs text-dim">{r.text}</div>
                <Actions phone={e.phone} mapUrl={r.mapUrl} tel={r.tel} waUrl={r.waUrl} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Prova il Concierge</SectionTitle>
          <p className="mb-2 text-[11px] text-faint">La domanda passa dal Concierge vero (stessa logica di WhatsApp): vedi cosa risponderebbe.</p>
          <label className="block text-[11px] font-semibold text-faint">Prenotazione (facoltativa)
            <select value={bookingId} onChange={(e) => setBookingId(e.target.value)} className={`${inputCls} mt-0.5`}>
              <option value="">Nessuna prenotazione</option>
              {bookingOptions.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
          <div className="mt-2 flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="Scrivi la domanda dell'ospite…" className={`${inputCls} flex-1`} />
            <button onClick={submit} disabled={asking || !q.trim()} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Invia</button>
          </div>
          <div className="mt-3 space-y-2 rounded-xl border border-line bg-wash p-3" style={{ minHeight: 120 }}>
            {!asking && !res && !askErr && <p className="text-xs text-faint">Nessuna prova ancora.</p>}
            {res && (
              <>
                <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl bg-focus px-3 py-2 text-sm text-white">{res.question}</div></div>
                {res.answered ? (
                  <div className="flex justify-start"><div className="max-w-[85%] whitespace-pre-line rounded-2xl border border-line bg-surface px-3 py-2 text-sm text-txt">
                    {res.reply}
                    {res.topic && <div className="mt-1 text-[10px] text-faint">Argomento: {res.topic}</div>}
                  </div></div>
                ) : (
                  <div className="rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--warn)" }}>
                    Il Concierge NON risponderebbe da solo: la domanda resta a te.
                    {res.reason && <div className="mt-0.5 font-normal">Motivo: {res.reason}</div>}
                  </div>
                )}
              </>
            )}
            {asking && <div className="text-xs italic text-dim">Sto pensando…</div>}
            {askErr && <div className="text-xs font-medium" style={{ color: "var(--err)" }}>Errore: {askErr}</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
