"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseISO, toISO } from "@/lib/dates";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";
import { useData } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import type { NormalizedReview } from "@/lib/reviews/google";

const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" });

// Fonti recensioni: Google (reale via API) + OTA (collegamento partner in arrivo, per ora inserimento manuale).
const SOURCES = [
  { k: "google", label: "Google", color: "#4285F4", note: "Recensioni reali via Google Places API." },
  { k: "booking", label: "Booking.com", color: "#003580", note: "Collegamento partner in arrivo · inserimento manuale." },
  { k: "airbnb", label: "Airbnb", color: "#FF5A5F", note: "Collegamento partner in arrivo · inserimento manuale." },
  { k: "expedia", label: "Expedia", color: "#FFC72C", note: "Collegamento partner in arrivo · inserimento manuale." },
  { k: "tripadvisor", label: "Tripadvisor", color: "#00AA6C", note: "Collegamento partner in arrivo · inserimento manuale." },
  { k: "direct", label: "Diretta", color: "#7A8450", note: "Recensioni dei tuoi ospiti diretti · inserimento manuale." },
] as const;
type SourceKey = typeof SOURCES[number]["k"];
const SRC = Object.fromEntries(SOURCES.map((s) => [s.k, s])) as Record<SourceKey, typeof SOURCES[number]>;
// Fonti per cui è possibile l'inserimento manuale (tutte tranne Google, che è reale).
const MANUAL_SOURCES = SOURCES.filter((s) => s.k !== "google");

const PLACEID_KEY = (structureId: string) => `spigolestay:reviews:placeid:${structureId}`;
const MANUAL_KEY = "spigolestay:reviews:manual";

type ManualReview = NormalizedReview; // stessa forma; source ≠ "google"

const bucketOf = (r10: number): "pos" | "neu" | "neg" => (r10 >= 8 ? "pos" : r10 >= 6 ? "neu" : "neg");

interface GoogleState {
  loading: boolean;
  configured: boolean | null; // null = ancora ignoto
  reviews: NormalizedReview[];
  rating?: number;
  total?: number;
  name?: string;
  truncated?: boolean;
  error?: string;
}

export default function RecensioniPage() {
  const { structures, activeStructureId, updateStructure } = useData();

  const [replies, setReplies] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | SourceKey>("all");
  const [ratingFilter, setRatingFilter] = useState<"all" | "pos" | "neu" | "neg">("all");

  // Struttura selezionata per configurazione/visualizzazione recensioni.
  const [selStructureId, setSelStructureId] = useState<string>("");
  const [placeId, setPlaceId] = useState<string>(""); // salvato per la struttura selezionata
  const [placeIdInput, setPlaceIdInput] = useState<string>("");

  const [google, setGoogle] = useState<GoogleState>({ loading: false, configured: null, reviews: [] });
  const [manual, setManual] = useState<ManualReview[]>([]);

  // Form inserimento manuale
  const [showManual, setShowManual] = useState(false);
  const [mForm, setMForm] = useState<{ source: SourceKey; guest: string; date: string; rating: number; text: string }>({
    source: "booking", guest: "", date: toISO(new Date()), rating: 9, text: "",
  });

  // Struttura effettiva: se l'utente ha scelto "tutte", usa la prima; altrimenti quella attiva.
  useEffect(() => {
    if (selStructureId && structures.some((s) => s.id === selStructureId)) return;
    const fallback = activeStructureId !== "all" ? activeStructureId : structures[0]?.id ?? "";
    setSelStructureId(fallback);
  }, [structures, activeStructureId, selStructureId]);

  // Segui il cambio di struttura attiva dal selettore globale.
  useEffect(() => {
    if (activeStructureId !== "all") setSelStructureId(activeStructureId);
  }, [activeStructureId]);

  // Carica risposte + recensioni manuali una volta.
  useEffect(() => {
    try { const r = localStorage.getItem("spigolestay:reviews"); if (r) setReplies(JSON.parse(r)); } catch {}
    try { const m = localStorage.getItem(MANUAL_KEY); if (m) setManual(JSON.parse(m)); } catch {}
  }, []);

  // Quando cambia la struttura selezionata, leggi il Place ID salvato.
  // Se manca in localStorage, ripiega su quello salvato sulla struttura (googlePlaceId).
  useEffect(() => {
    if (!selStructureId) { setPlaceId(""); setPlaceIdInput(""); return; }
    let saved = "";
    try { saved = localStorage.getItem(PLACEID_KEY(selStructureId)) || ""; } catch {}
    if (!saved) saved = structures.find((s) => s.id === selStructureId)?.googlePlaceId || "";
    setPlaceId(saved);
    setPlaceIdInput(saved);
  }, [selStructureId, structures]);

  const persistReplies = (n: Record<string, string>) => { setReplies(n); try { localStorage.setItem("spigolestay:reviews", JSON.stringify(n)); } catch {} };
  const persistManual = (n: ManualReview[]) => { setManual(n); try { localStorage.setItem(MANUAL_KEY, JSON.stringify(n)); } catch {} };

  const savePlaceId = () => {
    const v = placeIdInput.trim();
    setPlaceId(v);
    try { if (v) localStorage.setItem(PLACEID_KEY(selStructureId), v); else localStorage.removeItem(PLACEID_KEY(selStructureId)); } catch {}
    // Salva anche sulla struttura, così il sito pubblico (Xenosite) conosce il Place ID.
    if (selStructureId) updateStructure(selStructureId, { googlePlaceId: v || undefined, updatedAt: Date.now() });
  };
  const clearPlaceId = () => {
    setPlaceId(""); setPlaceIdInput("");
    try { localStorage.removeItem(PLACEID_KEY(selStructureId)); } catch {}
    if (selStructureId) updateStructure(selStructureId, { googlePlaceId: undefined, updatedAt: Date.now() });
  };

  const [cfgOpen, setCfgOpen] = useState(false); // finestra di configurazione Google (ricerca + Place ID)
  const [srcCfg, setSrcCfg] = useState<SourceKey | null>(null); // impostazioni di una fonte OTA
  // Ricerca automatica della struttura su Google → candidati con Place ID (niente ricerca manuale).
  const [findQ, setFindQ] = useState("");
  const [finding, setFinding] = useState(false);
  const [candidates, setCandidates] = useState<{ id: string; name: string; address?: string }[] | null>(null);
  const runFind = async () => {
    const st = structures.find((s) => s.id === selStructureId);
    const q = (findQ.trim() || [st?.name, st?.city].filter(Boolean).join(" ")).trim();
    if (!q) return;
    setFinding(true); setCandidates(null);
    try {
      const token = supabase ? (await supabase.auth.getSession())?.data.session?.access_token : undefined;
      const r = await fetch(`/api/reviews?find=${encodeURIComponent(q)}`, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const j = await r.json().catch(() => ({}));
      setCandidates(Array.isArray(j.candidates) ? j.candidates : []);
    } catch { setCandidates([]); }
    finally { setFinding(false); }
  };
  const pickCandidate = (id: string) => { setPlaceIdInput(id); setPlaceId(id); try { if (selStructureId) localStorage.setItem(PLACEID_KEY(selStructureId), id); } catch {} if (selStructureId) updateStructure(selStructureId, { googlePlaceId: id, updatedAt: Date.now() }); setCandidates(null); };

  // Carica le recensioni Google reali dalla route API. Guardia "ultima richiesta vince":
  // se cambio struttura rapidamente, la risposta vecchia non sovrascrive quella nuova.
  const reqRef = useRef(0);
  const loadGoogle = useCallback(async (pid: string, sid: string) => {
    const myReq = ++reqRef.current;
    setGoogle((g) => ({ ...g, loading: true, error: undefined }));
    try {
      const token = supabase ? (await supabase.auth.getSession())?.data.session?.access_token : undefined;
      const params = new URLSearchParams();
      if (pid) params.set("placeId", pid);
      if (sid) params.set("structureId", sid);
      const r = await fetch(`/api/reviews?${params.toString()}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (myReq !== reqRef.current) return; // arrivata una richiesta più recente: ignora questa
      setGoogle({
        loading: false,
        configured: typeof j.configured === "boolean" ? j.configured : null,
        reviews: Array.isArray(j.reviews) ? j.reviews : [],
        rating: j.rating,
        total: j.total,
        name: j.name,
        truncated: j.truncated,
        error: j.error,
      });
    } catch {
      if (myReq !== reqRef.current) return;
      setGoogle({ loading: false, configured: null, reviews: [], error: "network" });
    }
  }, []);

  // Ricarica quando cambia il Place ID salvato (o la struttura).
  useEffect(() => {
    if (!selStructureId) return;
    loadGoogle(placeId, selStructureId);
  }, [placeId, selStructureId, loadGoogle]);

  const googleConnected = Boolean(placeId) && google.configured === true && !google.error;
  const keyMissing = google.configured === false;

  // Recensioni manuali della struttura selezionata (le salviamo con structureId nel campo id? no:
  // le teniamo globali ma filtriamo per struttura via prefisso). Per semplicità: manuali globali.
  const manualReviews = manual;

  // Insieme completo delle recensioni mostrate (Google reali + manuali).
  type Review = NormalizedReview;
  const reviews: Review[] = useMemo(() => {
    const g = placeId && google.configured ? google.reviews : [];
    return [...g, ...manualReviews];
  }, [google.reviews, google.configured, placeId, manualReviews]);

  const connectedSources = useMemo(() => {
    const set = new Set<SourceKey>();
    if (googleConnected) set.add("google");
    for (const r of manualReviews) set.add(r.source as SourceKey);
    return SOURCES.filter((s) => set.has(s.k)).map((s) => s.k);
  }, [googleConnected, manualReviews]);

  const shown = reviews
    .filter((r) => filter === "all" || r.source === filter)
    .filter((r) => ratingFilter === "all" || r.bucket === ratingFilter);
  // Media: con Google collegato usa la media REALE su tutte le recensioni (google.rating), non il campione di ~5.
  const avg = (googleConnected && typeof google.rating === "number") ? google.rating : (reviews.length ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length : 0);
  const totalCount = google.total && googleConnected ? google.total : reviews.length;
  const unanswered = reviews.filter((r) => !replies[r.id]).length;
  const bySource = connectedSources.map((c) => { const rs = reviews.filter((r) => r.source === c); return { c, n: rs.length, avg: rs.length ? rs.reduce((a, r) => a + r.rating, 0) / rs.length : 0 }; }).filter((x) => x.n);
  const dist = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((v) => ({ v, n: reviews.filter((r) => r.rating === v).length })).filter((d) => d.v >= 5 || d.n > 0);

  const addManual = () => {
    const guest = mForm.guest.trim() || "Ospite";
    const text = mForm.text.trim();
    const r10 = Math.max(0, Math.min(10, Math.round(mForm.rating)));
    const rev: ManualReview = {
      id: `manual-${Date.now()}`,
      guest,
      date: mForm.date || toISO(new Date()),
      rating: r10,
      text,
      source: mForm.source,
      bucket: bucketOf(r10),
    };
    persistManual([rev, ...manual]);
    setShowManual(false);
    setMForm({ source: "booking", guest: "", date: toISO(new Date()), rating: 9, text: "" });
  };
  const removeManual = (id: string) => persistManual(manual.filter((m) => m.id !== id));

  // Risposta AI REALE (Claude): personalizzata sul testo/voto; fallback al template se non disponibile.
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({});
  const structureName = structures.find((s) => s.id === selStructureId)?.name || "la struttura";
  const aiReply = async (r: Review) => {
    setAiBusy((b) => ({ ...b, [r.id]: true }));
    try {
      const token = supabase ? (await supabase.auth.getSession())?.data.session?.access_token : undefined;
      const res = await fetch("/api/reviews/reply", { method: "POST", headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ guest: r.guest, rating: r.rating, text: r.text, structureName, source: r.source }) });
      const j = await res.json().catch(() => ({}));
      setDraft((d) => ({ ...d, [r.id]: j?.ok && j.reply ? j.reply : suggest(r) }));
    } catch { setDraft((d) => ({ ...d, [r.id]: suggest(r) })); }
    finally { setAiBusy((b) => ({ ...b, [r.id]: false })); }
  };
  // Bridge per pubblicare su Google: copia la risposta e apre la gestione recensioni di Google Business.
  const publishOnGoogle = (id: string) => {
    try { navigator.clipboard?.writeText(replies[id] || "").catch(() => {}); } catch {}
    window.open("https://business.google.com/reviews", "_blank", "noopener");
  };

  const suggest = (r: { guest: string; bucket: string }) => {
    const first = r.guest.split(" ")[0];
    if (r.bucket === "pos") return `Grazie di cuore ${first}! Siamo felicissimi che il soggiorno sia stato all'altezza. Ti aspettiamo di nuovo a Siracusa — alla prossima con una sorpresa riservata a chi torna. 🌊`;
    if (r.bucket === "neu") return `Grazie ${first} per il feedback prezioso. Abbiamo preso nota dei punti da migliorare e ci stiamo già lavorando. Ci farebbe piacere riaverti per mostrarti i progressi!`;
    return `Ci dispiace ${first}, non è lo standard che vogliamo offrire. Grazie per la segnalazione: interverremo subito. Se vorrai darci un'altra occasione, ti riserveremo un'attenzione speciale.`;
  };
  const star = (rating: number) => "★".repeat(Math.round(rating / 2)) + "☆".repeat(5 - Math.round(rating / 2));
  const color = (b: string) => (b === "pos" ? "var(--ok)" : b === "neu" ? "var(--warn)" : "var(--err)");

  return (
    <div>
      <PageHeader title="Recensioni & reputazione" subtitle="Recensioni Google reali e OTA in un posto, con risposte suggerite dall'AI" />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">Media</div><div className="font-mono text-lg font-bold text-txt">{avg.toFixed(1)}<span className="text-xs text-faint">/10</span></div></div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">Recensioni</div><div className="font-mono text-lg font-bold text-txt">{totalCount}{googleConnected && google.total && google.total > reviews.length ? <span className="text-xs text-faint"> ({reviews.length} qui)</span> : null}</div></div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">Da rispondere</div><div className="font-mono text-lg font-bold" style={{ color: unanswered ? "var(--warn)" : "var(--ok)" }}>{unanswered}</div></div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">Positive</div><div className="font-mono text-lg font-bold text-[color:var(--ok)]">{reviews.length ? Math.round(reviews.filter((r) => r.bucket === "pos").length / reviews.length * 100) : 0}%</div></div>
      </div>


      {/* Finestra di configurazione Google: ricerca struttura + Place ID */}
      {cfgOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCfgOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-lg font-bold text-txt">Collega Google</div>
                <div className="mt-0.5 text-xs text-dim">Trova la struttura o incolla il Place ID{selStructureId && structures.find((s) => s.id === selStructureId) ? ` · ${structures.find((s) => s.id === selStructureId)?.name}` : ""}</div>
              </div>
              <button onClick={() => setCfgOpen(false)} className="rounded-lg p-1 text-faint hover:bg-wash hover:text-txt">✕</button>
            </div>

            {keyMissing && (
              <div className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--warn)", background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
                <div className="font-semibold text-txt">Import Google non ancora attivo</div>
                <p className="mt-0.5 text-dim">Serve <code className="rounded bg-wash px-1 py-0.5 font-mono text-[11px]">GOOGLE_PLACES_API_KEY</code> lato server. Una volta impostata, cerca la struttura o incolla il Place ID.</p>
              </div>
            )}

            {/* Ricerca automatica */}
            <div className="mt-3">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-faint">Trova la tua struttura</label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input value={findQ} onChange={(e) => setFindQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runFind(); }} placeholder="es. Spigolehouse Siracusa" className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
                <button onClick={runFind} disabled={finding} className="rounded-lg bg-focus px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{finding ? "Cerco…" : "Cerca"}</button>
              </div>
              {candidates && (
                <div className="mt-2 space-y-1.5">
                  {candidates.length === 0 && <p className="text-[12px] text-faint">Nessun risultato. Prova col nome esatto + città, oppure incolla il Place ID sotto.</p>}
                  {candidates.map((c) => (
                    <button key={c.id} onClick={() => { pickCandidate(c.id); setCfgOpen(false); }} className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-paper px-3 py-2 text-left transition hover:border-focus hover:bg-wash">
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-txt">{c.name}</span>{c.address && <span className="block truncate text-[11px] text-faint">{c.address}</span>}</span>
                      <span className="shrink-0 text-xs font-semibold text-focus">Usa questa →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Place ID manuale */}
            <div className="mt-4 border-t border-line pt-3">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-faint">Oppure incolla il Google Place ID</label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input value={placeIdInput} onChange={(e) => setPlaceIdInput(e.target.value)} placeholder="es. ChIJ...." className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm text-txt outline-none focus:border-focus" />
                <button onClick={() => { savePlaceId(); setCfgOpen(false); }} disabled={!selStructureId || placeIdInput.trim() === placeId} className="rounded-lg bg-focus px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">Salva</button>
                {placeId ? <button onClick={clearPlaceId} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-dim hover:bg-wash">Rimuovi</button> : null}
              </div>
              <p className="mt-1.5 text-[11px] text-faint">Google Places espone solo le <strong>~5 recensioni più recenti</strong>: media e totale restano completi, l&apos;elenco è parziale.</p>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card><SectionTitle>Media per fonte</SectionTitle><div className="space-y-2">{bySource.length === 0 ? <p className="text-sm text-faint">Nessuna recensione ancora.</p> : bySource.map((x) => (<div key={x.c} className="flex items-center gap-2"><span className="w-24 text-sm text-txt">{SRC[x.c].label}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${x.avg * 10}%`, backgroundColor: SRC[x.c].color }} /></div><span className="w-16 text-right font-mono text-sm font-semibold text-txt">{x.avg.toFixed(1)} <span className="text-[10px] text-faint">({x.n})</span></span></div>))}</div></Card>
        <Card><SectionTitle>Distribuzione voti</SectionTitle><div className="space-y-1.5">{dist.map((d) => (<div key={d.v} className="flex items-center gap-2"><span className="w-6 text-right font-mono text-sm text-dim">{d.v}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full bg-focus" style={{ width: `${reviews.length ? (d.n / reviews.length) * 100 : 0}%` }} /></div><span className="w-8 text-right font-mono text-sm text-dim">{d.n}</span></div>))}</div></Card>
      </div>

      {/* Fonti recensioni */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <SectionTitle>Fonti recensioni</SectionTitle>
        <span className="text-[11px] font-semibold text-faint">{connectedSources.length}/{SOURCES.length} attive</span>
      </div>
      <div className="mb-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {SOURCES.map((s) => {
          const on = connectedSources.includes(s.k);
          const isGoogle = s.k === "google";
          return (
            <button key={s.k} onClick={() => (isGoogle ? setCfgOpen(true) : setSrcCfg(s.k))} className="group relative flex items-center gap-3 rounded-xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--focus)] hover:bg-[color:color-mix(in_srgb,var(--focus)_6%,transparent)] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] active:translate-y-0" style={{ borderColor: on ? s.color : "var(--line)" }} title="Apri impostazioni">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white transition-transform duration-200 group-hover:scale-110" style={{ backgroundColor: s.color }}>{s.label[0]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-txt">{s.label}</div>
                <div className="truncate text-[11px] text-faint">{s.note}</div>
              </div>
              {isGoogle ? (
                <span className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition group-hover:opacity-0" style={on ? { backgroundColor: "var(--ok)", color: "#fff" } : { border: "1px solid var(--line)", color: "var(--dim)" }}>{on ? "Collegato" : "Configura"}</span>
              ) : (
                <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-faint transition group-hover:opacity-0">Impostazioni</span>
              )}
              <span className="pointer-events-none absolute right-3 shrink-0 rounded-full bg-focus px-2.5 py-1 text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">Apri →</span>
            </button>
          );
        })}
      </div>

      {/* Impostazioni di una fonte OTA (Booking/Airbnb/…): come Google, ma via connettore partner o inserimento manuale */}
      {srcCfg && srcCfg !== "google" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSrcCfg(null)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: SRC[srcCfg].color }}>{SRC[srcCfg].label[0]}</span>
                <div>
                  <div className="font-display text-lg font-bold text-txt">{SRC[srcCfg].label}</div>
                  <div className="text-xs text-dim">Impostazioni recensioni</div>
                </div>
              </div>
              <button onClick={() => setSrcCfg(null)} className="rounded-lg p-1 text-faint hover:bg-wash hover:text-txt">✕</button>
            </div>

            <div className="mt-3 rounded-lg border border-line bg-wash p-3 text-[13px] text-dim">
              {srcCfg === "direct"
                ? "Le recensioni dei tuoi ospiti diretti le raccogli e le inserisci qui. In futuro potrai chiederle in automatico via email post-soggiorno."
                : `${SRC[srcCfg].label} non espone un'API pubblica self-service per le recensioni: il collegamento avverrà tramite connettore partner (in arrivo). Nel frattempo puoi inserire le recensioni a mano — restano salvate e rientrano in media, distribuzione e risposte AI.`}
            </div>

            <button onClick={() => { setMForm((f) => ({ ...f, source: srcCfg })); setShowManual(true); setSrcCfg(null); }} className="mt-3 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90">＋ Aggiungi recensione {SRC[srcCfg].label} a mano</button>
            <p className="mt-2 text-center text-[11px] text-faint">Il connettore automatico {SRC[srcCfg].label} arriverà con le integrazioni partner.</p>
          </div>
        </div>
      )}

      {/* Filtro per fonte + aggiunta manuale */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <span className="mr-1 text-xs font-semibold text-faint">Fonte:</span>
        <button onClick={() => setFilter("all")} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${filter === "all" ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>Tutte</button>
        {connectedSources.map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${filter === c ? "text-white" : "text-dim hover:bg-wash"}`} style={filter === c ? { backgroundColor: SRC[c].color } : undefined}>{SRC[c].label}</button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="mr-1 text-xs font-semibold text-faint">Voto:</span>
        {([["all", "Tutte", "var(--focus)"], ["pos", "Positive (8-10)", "var(--ok)"], ["neu", "Neutre (6-7)", "var(--warn)"], ["neg", "Negative (<6)", "var(--err)"]] as const).map(([k, label, col]) => (
          <button key={k} onClick={() => setRatingFilter(k)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${ratingFilter === k ? "text-white" : "text-dim hover:bg-wash"}`} style={ratingFilter === k ? { backgroundColor: col } : undefined}>{label}</button>
        ))}
        <button onClick={() => setShowManual((v) => !v)} className="ml-auto flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash"><Icon name="plus" size={13} /> Aggiungi a mano</button>
      </div>

      {/* Form inserimento manuale */}
      {showManual && (
        <Card className="mb-3">
          <SectionTitle>Nuova recensione manuale</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">Fonte</span>
              <select value={mForm.source} onChange={(e) => setMForm((f) => ({ ...f, source: e.target.value as SourceKey }))} className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus">
                {MANUAL_SOURCES.map((s) => (<option key={s.k} value={s.k}>{s.label}</option>))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">Ospite</span>
              <input value={mForm.guest} onChange={(e) => setMForm((f) => ({ ...f, guest: e.target.value }))} placeholder="Nome ospite" className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">Data</span>
              <input type="date" value={mForm.date} onChange={(e) => setMForm((f) => ({ ...f, date: e.target.value }))} className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">Voto (0–10): {mForm.rating}</span>
              <input type="range" min={0} max={10} step={1} value={mForm.rating} onChange={(e) => setMForm((f) => ({ ...f, rating: Number(e.target.value) }))} className="w-full accent-[color:var(--focus)]" />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">Testo</span>
              <textarea value={mForm.text} onChange={(e) => setMForm((f) => ({ ...f, text: e.target.value }))} rows={3} placeholder="Testo della recensione…" className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
            </label>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button onClick={addManual} className="rounded-lg bg-focus px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90">Salva recensione</button>
            <button onClick={() => setShowManual(false)} className="rounded-lg border border-line px-3.5 py-1.5 text-sm font-semibold text-dim hover:bg-wash">Annulla</button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {shown.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color(r.bucket) }} />
              <span className="font-semibold text-txt">{r.guest}</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: SRC[r.source as SourceKey]?.color ?? "var(--dim)" }}>{SRC[r.source as SourceKey]?.label ?? r.source}</span>
              <span className="text-sm" style={{ color: color(r.bucket) }}>{star(r.rating)}</span>
              <span className="font-mono text-sm text-dim">{r.rating}/10</span>
              {r.id.startsWith("manual-") && <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">manuale</span>}
              <span className="ml-auto text-xs text-faint">{fmt(r.date)}</span>
              {r.id.startsWith("manual-") && <button onClick={() => removeManual(r.id)} className="text-faint hover:text-[color:var(--err)]" title="Elimina recensione manuale"><Icon name="trash" size={14} /></button>}
            </div>
            {r.text && <p className="mt-2 text-sm text-txt">{r.text}</p>}
            {replies[r.id] ? (
              <div className="mt-2 rounded-lg border border-line bg-wash p-2.5 text-sm text-dim"><span className="text-[10px] font-semibold uppercase tracking-wide text-faint">La tua risposta</span><div className="mt-0.5 text-txt">{replies[r.id]}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {r.source === "google" && <button onClick={() => publishOnGoogle(r.id)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-focus hover:bg-surface" title="Copia la risposta e apri la gestione recensioni di Google">📋 Copia e rispondi su Google →</button>}
                  <button onClick={() => { const n = { ...replies }; delete n[r.id]; persistReplies(n); }} className="text-[11px] text-faint hover:text-[color:var(--err)]">Rimuovi</button>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <textarea value={draft[r.id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))} rows={2} placeholder="Scrivi una risposta…" className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
                <div className="mt-1.5 flex gap-2">
                  <button onClick={() => aiReply(r)} disabled={!!aiBusy[r.id]} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50"><Icon name="sparkles" size={13} /> {aiBusy[r.id] ? "Scrivo…" : "Suggerisci risposta AI"}</button>
                  <button onClick={() => { if ((draft[r.id] ?? "").trim()) persistReplies({ ...replies, [r.id]: draft[r.id].trim() }); }} disabled={!(draft[r.id] ?? "").trim()} className="rounded-lg bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">Pubblica risposta</button>
                </div>
              </div>
            )}
          </Card>
        ))}
        {reviews.length === 0 && (
          <Card className="py-8 text-center text-sm text-faint">
            {keyMissing
              ? "Configura GOOGLE_PLACES_API_KEY e incolla il Place ID per importare le recensioni Google, oppure aggiungine una a mano."
              : placeId
              ? "Nessuna recensione ancora: verranno importate da Google, oppure aggiungine una a mano."
              : "Incolla il Place ID di Google per importare le recensioni, oppure aggiungine una a mano."}
          </Card>
        )}
        {reviews.length > 0 && shown.length === 0 && <Card className="py-8 text-center text-sm text-faint">Nessuna recensione per questa fonte.</Card>}
      </div>

      <p className="mt-3 text-[11px] text-faint">Google è collegato via Google Places API (recensioni reali, ~5 più recenti). Le altre fonti (Booking, Airbnb, Expedia, Tripadvisor) avranno il collegamento partner: nel frattempo puoi inserirle a mano.</p>
    </div>
  );
}
