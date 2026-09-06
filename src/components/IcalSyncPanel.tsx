"use client";

// Sincronizzazione calendari iCal in SOLA LETTURA (reale).
// Xenora scarica i calendari (Octorate o OTA) tramite il proxy /api/ical e importa le prenotazioni
// in modo idempotente: le nuove vengono aggiunte, quelle già presenti aggiornate (per UID),
// preservando la camera assegnata a mano. Non scrive nulla verso le OTA.

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import { parseICS, importIcsEvents } from "@/lib/ics";

interface Feed { id: string; name: string; url: string; structureId: string; lastSync?: number; lastCreated?: number; lastUpdated?: number; lastErr?: string }

const FEEDS_KEY = "spigolestay:icalfeeds:v1";
const AUTO_KEY = "spigolestay:icalauto:v1";
const AUTO_MS = 15 * 60 * 1000; // 15 minuti
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `f-${Math.floor(performance.now() * 1000)}`);

export default function IcalSyncPanel() {
  const data = useData();
  const { structures } = data;
  const ask = useConfirm();
  const { t } = useLang();

  // Refs sempre aggiornati sullo stato dello store, così la sync legge dati freschi tra un feed e l'altro.
  const bRef = useRef(data.bookings); const uRef = useRef(data.units); const rtRef = useRef(data.roomTypes);
  useEffect(() => { bRef.current = data.bookings; }, [data.bookings]);
  useEffect(() => { uRef.current = data.units; }, [data.units]);
  useEffect(() => { rtRef.current = data.roomTypes; }, [data.roomTypes]);

  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // id feed in sync, o "all"
  const [form, setForm] = useState<{ name: string; url: string; structureId: string }>({ name: "", url: "", structureId: "" });

  useEffect(() => {
    try { const f = localStorage.getItem(FEEDS_KEY); if (f) setFeeds(JSON.parse(f)); } catch {}
    try { setAuto(localStorage.getItem(AUTO_KEY) === "1"); } catch {}
  }, []);
  useEffect(() => { if (!form.structureId && structures[0]) setForm((f) => ({ ...f, structureId: structures[0].id })); }, [structures, form.structureId]);
  const save = (next: Feed[]) => { setFeeds(next); try { localStorage.setItem(FEEDS_KEY, JSON.stringify(next)); } catch {} };

  const ctx = () => ({
    bookings: bRef.current, units: uRef.current, roomTypes: rtRef.current,
    addGuest: data.addGuest, addBooking: data.addBooking, updateBooking: data.updateBooking,
    deleteBooking: data.deleteBooking, addRoomType: data.addRoomType, addUnit: data.addUnit, t,
  });

  const syncOne = async (feed: Feed): Promise<Feed> => {
    try {
      const res = await fetch(`/api/ical?url=${encodeURIComponent(feed.url)}`, { cache: "no-store" });
      if (!res.ok) { const msg = await res.text().catch(() => ""); return { ...feed, lastSync: Date.now(), lastErr: msg || `HTTP ${res.status}` }; }
      const text = await res.text();
      const events = parseICS(text);
      if (!events.length) return { ...feed, lastSync: Date.now(), lastErr: t("Nessuna prenotazione nel calendario"), lastCreated: 0, lastUpdated: 0 };
      const { created, updated } = importIcsEvents(events, { structureId: feed.structureId, includeBlocked: false, replacePrev: false, source: "iCal" }, ctx());
      return { ...feed, lastSync: Date.now(), lastErr: undefined, lastCreated: created, lastUpdated: updated };
    } catch {
      return { ...feed, lastSync: Date.now(), lastErr: t("Download fallito (verifica l'URL)") };
    }
  };

  const runFeed = async (id: string) => {
    const feed = feeds.find((f) => f.id === id); if (!feed || busy) return;
    setBusy(id);
    const res = await syncOne(feed);
    save(feeds.map((f) => (f.id === id ? res : f)));
    setBusy(null);
  };

  const runAll = async () => {
    if (busy || !feeds.length) return;
    setBusy("all");
    let cur = feeds;
    for (const f of cur) {
      const res = await syncOne(f);
      cur = cur.map((x) => (x.id === f.id ? res : x));
      save(cur);
      await new Promise((r) => setTimeout(r, 60)); // lascia aggiornare lo store tra un feed e l'altro
    }
    setBusy(null);
  };

  const addFeed = () => {
    const url = form.url.trim();
    if (!/^https?:\/\//i.test(url) || !form.structureId) return;
    const name = form.name.trim() || t("Calendario iCal");
    save([...feeds, { id: uid(), name, url, structureId: form.structureId }]);
    setForm({ name: "", url: "", structureId: form.structureId });
  };
  const removeFeed = async (id: string) => {
    const f = feeds.find((x) => x.id === id);
    if (await ask({ title: t("Rimuovi calendario"), message: `${t("Smettere di sincronizzare")} "${f?.name}"? ${t("Le prenotazioni già importate restano.")}`, danger: true, confirmLabel: t("Rimuovi") })) save(feeds.filter((x) => x.id !== id));
  };
  const toggleAuto = () => { const v = !auto; setAuto(v); try { localStorage.setItem(AUTO_KEY, v ? "1" : "0"); } catch {} };

  // Auto-sync mentre l'app è aperta (ogni 15 min).
  const runAllRef = useRef(runAll); runAllRef.current = runAll;
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => { runAllRef.current(); }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [auto]);

  const relTime = (ts?: number) => {
    if (!ts) return t("mai");
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return t("adesso");
    if (d < 3600) return `${Math.floor(d / 60)} ${t("min fa")}`;
    if (d < 86400) return `${Math.floor(d / 3600)} ${t("h fa")}`;
    return `${Math.floor(d / 86400)} ${t("g fa")}`;
  };
  const sName = (id: string) => structures.find((s) => s.id === id)?.name ?? "—";
  const inp = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <Card className="mb-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>{t("Sincronizzazione iCal")} <span className="ml-1 rounded-full bg-[color:color-mix(in_srgb,var(--ok)_16%,transparent)] px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-[color:var(--ok)]">{t("reale · sola lettura")}</span></SectionTitle>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-dim">{t("Auto ogni 15 min")}
            <button type="button" onClick={toggleAuto} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: auto ? "var(--ok)" : "var(--line)" }} aria-pressed={auto}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: auto ? "22px" : "2px" }} /></button>
          </label>
          <button onClick={runAll} disabled={!!busy || feeds.length === 0} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">↻ {busy === "all" ? t("Sincronizzo…") : t("Sincronizza tutti")}</button>
        </div>
      </div>
      <p className="mb-3 text-xs text-dim">{t("Incolla i link iCal esportati da Octorate (o dalle OTA). Xenora legge e importa le prenotazioni senza toccare la sincronizzazione live: Octorate resta il gestore, tu vedi tutto anche qui.")}</p>

      {/* Elenco feed */}
      {feeds.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {feeds.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-paper p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-txt"><span className="truncate">{f.name}</span><span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[10px] font-medium text-dim">{sName(f.structureId)}</span></div>
                <div className="truncate text-[11px] text-faint" title={f.url}>{f.url}</div>
                <div className="mt-0.5 text-[11px]">
                  {f.lastErr
                    ? <span className="text-[color:var(--err)]">⚠ {f.lastErr} · {relTime(f.lastSync)}</span>
                    : f.lastSync
                      ? <span className="text-[color:var(--ok)]">✓ {t("sync")} {relTime(f.lastSync)}{(f.lastCreated || f.lastUpdated) ? ` · +${f.lastCreated ?? 0} ${t("nuove")}, ${f.lastUpdated ?? 0} ${t("aggiornate")}` : ` · ${t("nessuna novità")}`}</span>
                      : <span className="text-faint">{t("mai sincronizzato")}</span>}
                </div>
              </div>
              <button onClick={() => runFeed(f.id)} disabled={!!busy} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40">{busy === f.id ? t("Sincronizzo…") : t("Sincronizza")}</button>
              <button onClick={() => removeFeed(f.id)} disabled={!!busy} title={t("Rimuovi")} className="rounded-lg px-2 py-1.5 text-faint hover:text-[color:var(--err)] disabled:opacity-40">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Aggiungi feed */}
      <div className="grid gap-2 rounded-xl border border-dashed border-line p-3 sm:grid-cols-[1fr_1.6fr_auto] sm:items-end">
        <label className="text-[11px] font-medium text-dim">{t("Nome")}
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("es. Octorate — tutte le camere")} className={`mt-1 ${inp}`} />
        </label>
        <label className="text-[11px] font-medium text-dim">{t("URL iCal")}
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…/calendar.ics" className={`mt-1 ${inp}`} />
        </label>
        <div className="flex gap-2">
          <select value={form.structureId} onChange={(e) => setForm({ ...form, structureId: e.target.value })} className={inp}>
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={addFeed} disabled={!/^https?:\/\//i.test(form.url.trim()) || !form.structureId} className="shrink-0 rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Aggiungi")}</button>
        </div>
      </div>
      {structures.length === 0 && <p className="mt-2 text-xs text-[color:var(--warn)]">{t("Prima crea una struttura.")}</p>}
    </Card>
  );
}
