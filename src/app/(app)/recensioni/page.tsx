"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseISO, toISO } from "@/lib/dates";
import { PageHeader, Card, SectionTitle, StatCard } from "@/components/ui";
import Icon from "@/components/Icon";
import ChannelLogo from "@/components/ChannelLogo";
import EmptyState from "@/components/EmptyState";
import SearchInput from "@/components/SearchInput";
import { useData } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/invoicing/client";
import { DATA_KEY } from "@/lib/publicdata";
import type { NormalizedReview } from "@/lib/reviews/google";
import { REVIEW_CHANNELS, mergeSummaries, summarizeFromReviews, type ReviewChannel, type ReviewScore, type ScoreSummary } from "@/lib/channex-review-scores";
import { googleReviewUrl, recentCheckouts, reviewRequestMessage, stayNights } from "@/lib/reviews";

const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" });

// Fonti recensioni: Google (reale via API) + OTA (collegamento partner in arrivo, per ora inserimento manuale).
const SOURCES = [
  { k: "google", label: "Google", color: "#4285F4", note: "Recensioni reali via Google Places API." },
  { k: "booking", label: "Booking.com", color: "#003580", note: "Collegamento partner in arrivo · inserimento manuale." },
  { k: "airbnb", label: "Airbnb", color: "#FF5A5F", note: "Collegamento partner in arrivo · inserimento manuale." },
  { k: "expedia", label: "Expedia", color: "#FFC72C", note: "Collegamento partner in arrivo · inserimento manuale." },
  { k: "tripadvisor", label: "Tripadvisor", color: "#00AA6C", note: "Collegamento partner in arrivo · inserimento manuale." },
  { k: "direct", label: "Diretta", color: "#7A8450", note: "Recensioni lasciate dagli ospiti sul tuo mini-sito · rispondi e pubblica." },
] as const;
type SourceKey = typeof SOURCES[number]["k"];
const SRC = Object.fromEntries(SOURCES.map((s) => [s.k, s])) as Record<SourceKey, typeof SOURCES[number]>;
// Fonti per cui è possibile l'inserimento manuale: tutte tranne Google (reale via API)
// e Diretta (le lasciano gli ospiti dal mini-sito, non si inseriscono a mano).
const MANUAL_SOURCES = SOURCES.filter((s) => s.k !== "google" && s.k !== "direct");

const PLACEID_KEY = (structureId: string) => `spigolestay:reviews:placeid:${structureId}`;
const MANUAL_KEY = "spigolestay:reviews:manual";

type ManualReview = NormalizedReview & { structureId?: string }; // stessa forma; source ≠ "google"; structureId assente = valida per tutte le strutture (retro-compat.)

// Recensioni Booking.com/Airbnb/Expedia reali via Channex (Reviews Collection API) — stessa forma
// restituita da /api/channex/reviews (vedi src/app/api/channex/reviews/route.ts).
interface ChxReviewRow {
  id: string; reviewId: string; guest: string; date: string; rating: number; text: string;
  source: "booking" | "airbnb" | "expedia" | "other"; bucket: "pos" | "neu" | "neg";
  isReplied: boolean; reply: string | null;
  scores?: ReviewScore[]; // punteggi per categoria (può mancare: n/d)
}
// Punteggi ufficiali Channex (GET /scores/:property/detailed) per struttura e per canale.
interface ChxStructureScores { property: ScoreSummary | null; byChannel: Partial<Record<ReviewChannel, ScoreSummary>> }
interface ChxStructureReviews { reviews: ChxReviewRow[]; scores?: ChxStructureScores; notInstalled?: boolean; error?: string }

// Tinta tenue per una barra di punteggio 0..10 (stesse soglie di bucketOf: 8 / 6).
const scoreTint = (v: number) => `color-mix(in srgb, ${v >= 8 ? "var(--ok)" : v >= 6 ? "var(--warn)" : "var(--err)"} 55%, transparent)`;
const CHANNEL_LABEL: Record<ReviewChannel, string> = { booking: "Booking.com", airbnb: "Airbnb", expedia: "Expedia" };
const fmtScore = (v: number | null | undefined) => (v == null ? "n/d" : v.toFixed(1));

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
  const { structures, bookings, guests, activeStructureId, updateStructure, updateBooking, addActivity, directReviews, setDirectReviewReply } = useData();

  const [replies, setReplies] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | SourceKey>("all");
  const [ratingFilter, setRatingFilter] = useState<"all" | "pos" | "neu" | "neg">("all");
  const [replyFilter, setReplyFilter] = useState<"all" | "todo" | "done">("all"); // stato risposta
  const [search, setSearch] = useState(""); // ricerca testo (ospite / testo recensione)
  const [sortBy, setSortBy] = useState<"new" | "old" | "low" | "high">("new");
  const [trendDays, setTrendDays] = useState<30 | 90 | 365>(90); // finestra del confronto "media per periodo"

  // Struttura selezionata per configurazione/visualizzazione recensioni.
  const [selStructureId, setSelStructureId] = useState<string>("");
  const [placeId, setPlaceId] = useState<string>(""); // salvato per la struttura selezionata
  const [placeIdInput, setPlaceIdInput] = useState<string>("");

  const [google, setGoogle] = useState<GoogleState>({ loading: false, configured: null, reviews: [] });
  const [manual, setManual] = useState<ManualReview[]>([]);

  // Recensioni Channex (Booking.com/Airbnb/Expedia reali) per struttura, caricate una volta:
  // la route aggrega già tutte le property del tenant, non serve rifetchare al cambio struttura.
  const [chx, setChx] = useState<{ off: boolean; byStructure: Record<string, ChxStructureReviews> }>({ off: false, byStructure: {} });
  const [chxReplyBusy, setChxReplyBusy] = useState<Record<string, boolean>>({});
  const [chxReplyErr, setChxReplyErr] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    apiPost<{ ok: boolean; byStructure?: Record<string, ChxStructureReviews> }>("channex/reviews", { action: "list" })
      .then((j) => { if (!alive) return; setChx({ off: !j.ok, byStructure: j.byStructure ?? {} }); })
      .catch(() => { if (!alive) return; setChx({ off: true, byStructure: {} }); });
    return () => { alive = false; };
  }, []);

  // --- Richiesta recensione post check-out -------------------------------------------------
  const [reqWindow, setReqWindow] = useState<number>(30); // finestra giorni dei check-out recenti
  const [reqBusy, setReqBusy] = useState<Record<string, "wa" | "email">>({}); // invii in corso per prenotazione
  const [reqMsg, setReqMsg] = useState<string>(""); // feedback transitorio
  const [wa, setWa] = useState<{ connected: boolean; phoneId: string }>({ connected: false, phoneId: "" });
  useEffect(() => { apiPost<{ connected: boolean; phoneId: string }>("whatsapp/settings", { action: "status" }).then((r) => setWa({ connected: !!r.connected, phoneId: r.phoneId || "" })).catch(() => {}); }, []);

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

  // Recensioni manuali della struttura selezionata: quelle senza structureId (inserite prima
  // dell'indipendenza per struttura) restano visibili in tutte, le nuove portano la propria struttura.
  const manualReviews = useMemo(() => manual.filter((m) => !m.structureId || m.structureId === selStructureId), [manual, selStructureId]);

  // Recensioni DIRETTE REALI della struttura selezionata (dal blob sincronizzato / store),
  // normalizzate nella stessa forma delle altre così entrano in media/distribuzione/filtri/lista.
  const directList: NormalizedReview[] = useMemo(() => {
    return (directReviews || [])
      .filter((r) => r.structureId === selStructureId)
      .map((r) => ({ id: r.id, guest: r.guest || "Ospite", date: r.date, rating: r.rating, text: r.text || "", source: "direct" as const, bucket: bucketOf(r.rating) }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [directReviews, selStructureId]);

  // Recensioni Channex (Booking.com/Airbnb/Expedia reali) della struttura selezionata.
  const chxRowsSel: ChxReviewRow[] = chx.byStructure[selStructureId]?.reviews ?? [];
  const chxList: NormalizedReview[] = useMemo(() => {
    return chxRowsSel
      .filter((r) => r.source === "booking" || r.source === "airbnb" || r.source === "expedia")
      .map((r) => ({ id: r.id, guest: r.guest, date: r.date, rating: r.rating, text: r.text, source: r.source as SourceKey, bucket: r.bucket }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chx.byStructure, selStructureId]);
  // Punteggi per categoria per canale: ufficiali Channex se presenti, altrimenti ripiego calcolato
  // dalle recensioni scaricate (segnalato con "derived"). Nessun valore se Channex non lo dà → n/d.
  const scoreView = useMemo(() => {
    const official = chx.byStructure[selStructureId]?.scores;
    const perChannel = {} as Record<ReviewChannel, { overall: number | null; count: number; cats: Map<string, { label: string; score: number }>; derived: boolean; overallDerived: boolean }>;
    for (const ch of REVIEW_CHANNELS) {
      const rows = chxRowsSel.filter((r) => r.source === ch);
      const off = official?.byChannel[ch];
      const der = summarizeFromReviews(rows);
      const useOff = !!off?.categories.length;
      const cats = new Map<string, { label: string; score: number }>();
      for (const c of (useOff ? off!.categories : der?.categories ?? [])) cats.set(c.key, { label: c.label, score: c.score });
      const rated = rows.length ? Math.round(rows.reduce((a, r) => a + r.rating, 0) / rows.length * 10) / 10 : null;
      perChannel[ch] = {
        overall: off?.overall ?? rated,
        count: off?.overall != null && off.count ? off.count : rows.length,
        cats, derived: !useOff && cats.size > 0, overallDerived: off?.overall == null && rated != null,
      };
    }
    // Media per categoria su tutti i canali: riepilogo ufficiale della struttura se c'è, altrimenti fusione dei canali.
    const merged = official?.property?.categories.length
      ? official.property.categories
      : (mergeSummaries(REVIEW_CHANNELS.map((ch) => ({ overall: null, count: perChannel[ch].count, categories: Array.from(perChannel[ch].cats, ([key, v]) => ({ key, label: v.label, score: v.score, count: perChannel[ch].count })) }))
          .filter((x) => x.categories.length))?.categories ?? []);
    return { perChannel, categories: merged, hasAny: merged.length > 0 || REVIEW_CHANNELS.some((ch) => perChannel[ch].overall != null) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chx.byStructure, selStructureId]);
  const chxScoresById = useMemo(() => new Map(chxRowsSel.map((r) => [r.id, r.scores ?? []])), [chx.byStructure, selStructureId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stato Channex per una fonte OTA (null per Google/Diretta/Tripadvisor, non coperte da Channex):
  // "mapped" = la struttura ha una property Channex collegata; "notInstalled" = manca l'app
  // "Messages & Reviews" lato Channex (vedi channex.ts isReviewsNotInstalled).
  const chxSourceInfo = (k: SourceKey): { mapped: boolean; notInstalled: boolean } | null => {
    if (k !== "booking" && k !== "airbnb" && k !== "expedia") return null;
    const c = chx.byStructure[selStructureId];
    if (!c) return { mapped: false, notInstalled: false };
    return { mapped: true, notInstalled: !!c.notInstalled };
  };
  // Nota mostrata nella card della fonte: reale se Channex è collegato, altrimenti il testo
  // originale "collegamento partner in arrivo · manuale".
  const noteFor = (s: typeof SOURCES[number]): string => {
    const info = chxSourceInfo(s.k);
    if (!info) return s.note;
    if (info.notInstalled) return 'Channex è collegato, ma l\'app "Messages & Reviews" non è ancora installata per questa struttura (Channex → Applications). Nel frattempo: inserimento manuale.';
    if (info.mapped) return "Recensioni reali importate automaticamente via Channex.";
    return s.note;
  };
  const chxBadgeOn = (k: SourceKey) => { const info = chxSourceInfo(k); return !!info?.mapped && !info.notInstalled; };

  // Insieme completo delle recensioni mostrate (Google reali + Channex reali + dirette reali + manuali).
  type Review = NormalizedReview;
  const reviews: Review[] = useMemo(() => {
    const g = placeId && google.configured ? google.reviews : [];
    return [...g, ...chxList, ...directList, ...manualReviews];
  }, [google.reviews, google.configured, placeId, chxList, directList, manualReviews]);

  const connectedSources = useMemo(() => {
    const set = new Set<SourceKey>();
    if (googleConnected) set.add("google");
    for (const r of chxList) set.add(r.source as SourceKey);
    for (const r of directList) set.add(r.source as SourceKey);
    for (const r of manualReviews) set.add(r.source as SourceKey);
    return SOURCES.filter((s) => set.has(s.k)).map((s) => s.k);
  }, [googleConnected, chxList, directList, manualReviews]);

  // Precarica nel pannello risposte le risposte GIÀ pubblicate su Channex (Booking/Airbnb/Expedia),
  // così compaiono come "La tua risposta" invece di un form vuoto.
  useEffect(() => {
    const withReply = chxRowsSel.filter((r) => r.reply && r.reply.trim());
    if (!withReply.length) return;
    setReplies((prev) => {
      let changed = false; const n = { ...prev };
      for (const r of withReply) if (n[r.id] === undefined) { n[r.id] = r.reply!; changed = true; }
      return changed ? n : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chx.byStructure, selStructureId]);

  // Pubblica DAVVERO una risposta su Booking.com/Airbnb/Expedia tramite Channex (POST /reviews/:id/reply).
  // Se l'app "Messages & Reviews" non è installata su Channex, l'errore spiega cosa fare invece di fallire muto.
  const publishChxReply = async (r: Review) => {
    const t = (draft[r.id] ?? "").trim();
    const row = chxRowsSel.find((x) => x.id === r.id);
    if (!t || !row) return;
    // Recensione senza testo (solo punteggio): i portali non permettono di rispondere. Meglio dirlo subito che aspettare l'errore di Channex.
    if (!r.text.trim()) { setChxReplyErr((e) => ({ ...e, [r.id]: "Questa recensione non ha testo (solo punteggio): il portale non permette di rispondere." })); return; }
    setChxReplyBusy((b) => ({ ...b, [r.id]: true }));
    setChxReplyErr((e) => ({ ...e, [r.id]: "" }));
    try {
      const j = await apiPost<{ ok: boolean; error?: string }>("channex/reviews", { action: "reply", structureId: selStructureId, reviewId: row.reviewId, text: t });
      if (j.ok) persistReplies({ ...replies, [r.id]: t });
      else setChxReplyErr((e) => ({ ...e, [r.id]: j.error || "Invio non riuscito" }));
    } catch (e) {
      setChxReplyErr((e2) => ({ ...e2, [r.id]: e instanceof Error ? e.message : "errore di rete" }));
    } finally {
      setChxReplyBusy((b) => ({ ...b, [r.id]: false }));
    }
  };
  const isChx = (r: Review) => r.id.startsWith("chx-");

  // Precarica nel pannello risposte le risposte GIÀ pubblicate sulle recensioni dirette,
  // così compaiono come "La tua risposta" (fonte di verità = campo reply della recensione).
  useEffect(() => {
    const withReply = (directReviews || []).filter((r) => r.reply && r.reply.trim());
    if (!withReply.length) return;
    setReplies((prev) => {
      let changed = false; const n = { ...prev };
      for (const r of withReply) if (n[r.id] === undefined) { n[r.id] = r.reply!; changed = true; }
      return changed ? n : prev;
    });
  }, [directReviews]);

  const searchTerm = search.trim().toLowerCase();
  const shown = reviews
    .filter((r) => filter === "all" || r.source === filter)
    .filter((r) => ratingFilter === "all" || r.bucket === ratingFilter)
    .filter((r) => replyFilter === "all" || (replyFilter === "todo" ? !replies[r.id] : !!replies[r.id]))
    .filter((r) => !searchTerm || `${r.guest} ${r.text}`.toLowerCase().includes(searchTerm))
    .sort((a, b) => sortBy === "old" ? (a.date || "").localeCompare(b.date || "") : sortBy === "low" ? a.rating - b.rating || (b.date || "").localeCompare(a.date || "") : sortBy === "high" ? b.rating - a.rating || (b.date || "").localeCompare(a.date || "") : (b.date || "").localeCompare(a.date || ""));
  const filtersActive = filter !== "all" || ratingFilter !== "all" || replyFilter !== "all" || !!searchTerm;
  const resetFilters = () => { setFilter("all"); setRatingFilter("all"); setReplyFilter("all"); setSearch(""); };
  // Recensioni negative senza risposta: priorità per la reputazione.
  const negUnanswered = reviews.filter((r) => r.bucket === "neg" && !replies[r.id]).length;
  // Giorni trascorsi dalla recensione (per evidenziare quelle che aspettano da tempo).
  const ageDays = (iso: string) => { const t0 = parseISO(iso).getTime(); return isNaN(t0) ? 0 : Math.max(0, Math.floor((Date.now() - t0) / 86400000)); };
  // Media per periodo: ultimi N giorni vs N giorni precedenti, sulle recensioni realmente disponibili qui
  // (con Google solo le ~5 più recenti: il confronto è indicativo e lo dichiariamo in pagina).
  const trend = useMemo(() => {
    const now = Date.now(), W = trendDays * 86400000;
    const inWin = (r: NormalizedReview, from: number, to: number) => { const t0 = parseISO(r.date).getTime(); return !isNaN(t0) && t0 > from && t0 <= to; };
    const cur = reviews.filter((r) => inWin(r, now - W, now));
    const prv = reviews.filter((r) => inWin(r, now - 2 * W, now - W));
    const av = (xs: NormalizedReview[]) => (xs.length ? xs.reduce((a, r) => a + r.rating, 0) / xs.length : null);
    return { cur: av(cur), curN: cur.length, prv: av(prv), prvN: prv.length };
  }, [reviews, trendDays]);

  const exportCsv = () => {
    const head = ["Data", "Fonte", "Ospite", "Voto (0-10)", "Testo", "Risposta"];
    const q = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    const lines = shown.map((r) => [r.date, SRC[r.source as SourceKey]?.label ?? r.source, r.guest, r.rating, r.text, replies[r.id] ?? ""].map(q).join(";"));
    const csv = "\ufeff" + [head.map(q).join(";"), ...lines].join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `recensioni-${(structures.find((s) => s.id === selStructureId)?.name || "struttura").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${toISO(new Date())}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
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
      ...(selStructureId ? { structureId: selStructureId } : {}),
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
  // Aggiorna lo snapshot pubblico (public_sites) della struttura con la recensione diretta
  // + risposta, così la risposta compare SUBITO sul mini-sito. Best-effort: se il sito non è
  // pubblicato o la scrittura fallisce, la risposta resta salvata e comparirà alla prossima
  // pubblicazione del sito (buildPublishData include tutte le recensioni dirette).
  const pushDirectToSnapshot = async (reviewId: string, reply: string) => {
    if (!supabase) return;
    const rev = (directReviews || []).find((r) => r.id === reviewId);
    if (!rev) return;
    try {
      const { data: site } = await supabase.from("public_sites").select("data").eq("structure_id", rev.structureId).maybeSingle();
      if (!site?.data) return; // sito non pubblicato: niente snapshot da aggiornare
      const blob = { ...(site.data as Record<string, string>) };
      let d: Record<string, unknown> = {};
      try { d = JSON.parse(blob[DATA_KEY] || "{}"); } catch { d = {}; }
      const list = (Array.isArray(d.directReviews) ? d.directReviews : []) as Record<string, unknown>[];
      const merged = { ...rev, reply, updatedAt: Date.now() };
      const i = list.findIndex((x) => (x as { id?: string }).id === reviewId);
      if (i >= 0) list[i] = { ...list[i], ...merged }; else list.push(merged);
      d.directReviews = list;
      blob[DATA_KEY] = JSON.stringify(d);
      await supabase.from("public_sites").update({ data: blob, updated_at: new Date().toISOString() }).eq("structure_id", rev.structureId);
    } catch { /* best-effort */ }
  };

  // Bridge per pubblicare su Google: copia la risposta e apre la gestione recensioni di Google Business.
  const publishOnGoogle = (id: string) => {
    try { navigator.clipboard?.writeText(replies[id] || "").catch(() => {}); } catch {}
    window.open("https://business.google.com/reviews", "_blank", "noopener");
  };

  // Salvataggio "solo locale" della risposta (Google/OTA manuali).
  const saveLocalReply = (id: string) => {
    const t = (draft[id] ?? "").trim();
    if (t) persistReplies({ ...replies, [id]: t });
  };
  // Google: salva la bozza e apre Google Business (la vera pubblicazione su Google non è via API).
  const publishGoogleFromDraft = (id: string) => {
    const t = (draft[id] ?? "").trim();
    if (t) persistReplies({ ...replies, [id]: t });
    try { navigator.clipboard?.writeText(t || replies[id] || "").catch(() => {}); } catch {}
    window.open("https://business.google.com/reviews", "_blank", "noopener");
  };
  // Diretta: pubblica DAVVERO (salva la reply sulla recensione nel blob + snapshot pubblico → mini-sito).
  const publishDirect = async (id: string) => {
    const t = (draft[id] ?? "").trim();
    if (!t) return;
    persistReplies({ ...replies, [id]: t });
    setDirectReviewReply(id, t);          // → salvata nel blob (app_state) al prossimo sync
    await pushDirectToSnapshot(id, t);    // → visibile subito sul mini-sito
  };
  // Rimuove la risposta salvata; per le dirette la ritira anche dal mini-sito.
  const removeReply = async (r: Review) => {
    const n = { ...replies }; delete n[r.id]; persistReplies(n);
    if (r.source === "direct") { setDirectReviewReply(r.id, ""); await pushDirectToSnapshot(r.id, ""); }
  };

  // Check-out recenti (rispetta il selettore struttura globale). La struttura di ogni
  // prenotazione porta con sé il proprio Google Place ID → link recensione per-struttura.
  const checkouts = useMemo(
    () => recentCheckouts(bookings, guests, { days: reqWindow, structureId: activeStructureId }),
    [bookings, guests, reqWindow, activeStructureId],
  );
  const requestedCount = checkouts.filter((c) => c.requested).length;
  // Structure attive nell'elenco senza Place ID → avviso "imposta Google Place ID".
  const missingPlaceId = useMemo(() => {
    const ids = new Set(checkouts.map((c) => c.booking.structureId));
    return structures.filter((s) => ids.has(s.id) && !(s.googlePlaceId || "").trim());
  }, [checkouts, structures]);

  const flash = (m: string) => { setReqMsg(m); window.setTimeout(() => setReqMsg((cur) => (cur === m ? "" : cur)), 4000); };

  // Segna la richiesta come inviata sulla prenotazione (persistito nel blob via updateBooking,
  // che aggiorna updatedAt → la sync last-write-wins la propaga senza rompere nulla).
  const markRequested = (bookingId: string, channel: "whatsapp" | "email") => {
    updateBooking(bookingId, { reviewRequestedAt: Date.now(), reviewRequestChannel: channel });
  };

  // Richiesta via WhatsApp: se la Cloud API è collegata invia davvero; altrimenti apre wa.me.
  const requestWhatsapp = async (bookingId: string) => {
    const item = checkouts.find((c) => c.booking.id === bookingId);
    if (!item) return;
    const st = structures.find((s) => s.id === item.booking.structureId);
    const url = googleReviewUrl(st?.googlePlaceId);
    if (!url) { flash("Imposta prima il Google Place ID di questa struttura."); return; }
    const phone = (item.guest?.phone ?? "").replace(/\D/g, "");
    if (!phone) { flash("L'ospite non ha un numero di telefono."); return; }
    const text = reviewRequestMessage({ guestName: item.guestName, structureName: st?.name, reviewUrl: url });
    setReqBusy((b) => ({ ...b, [bookingId]: "wa" }));
    try {
      let sent = false;
      if (wa.connected) { try { const r = await apiPost<{ ok: boolean }>("whatsapp/send", { to: phone, text }); sent = !!r.ok; } catch { sent = false; } }
      if (!sent) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      markRequested(bookingId, "whatsapp");
      addActivity("message", `Richiesta recensione inviata (WhatsApp)${item.guestName ? " — " + item.guestName : ""}`);
      flash(sent ? "Richiesta inviata via WhatsApp." : "WhatsApp aperto con il messaggio pronto.");
    } finally { setReqBusy((b) => { const n = { ...b }; delete n[bookingId]; return n; }); }
  };

  // Richiesta via email (Resend, kind "guest_message"); fallback a Gmail compose se l'invio fallisce.
  const requestEmail = async (bookingId: string) => {
    const item = checkouts.find((c) => c.booking.id === bookingId);
    if (!item) return;
    const st = structures.find((s) => s.id === item.booking.structureId);
    const url = googleReviewUrl(st?.googlePlaceId);
    if (!url) { flash("Imposta prima il Google Place ID di questa struttura."); return; }
    const email = item.guest?.email?.trim();
    if (!email) { flash("L'ospite non ha un'email."); return; }
    const subject = `Com'è andato il soggiorno${st?.name ? ` a ${st.name}` : ""}?`;
    const text = reviewRequestMessage({ guestName: item.guestName, structureName: st?.name, reviewUrl: url });
    setReqBusy((b) => ({ ...b, [bookingId]: "email" }));
    try {
      let ok = false;
      try {
        const brand = { name: st?.name, logo: st?.logo, address: [st?.address, st?.streetNumber, st?.city].filter(Boolean).join(" "), phone: st?.phone, email: st?.email, website: st?.website, accent: st?.photoColor, cin: st?.cin, vat: st?.vat };
        const r = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "guest_message", to: email, subject, text, accent: st?.photoColor, replyTo: st?.email, brand }) });
        const j = await r.json().catch(() => ({}));
        ok = r.ok && !!j?.ok;
      } catch { ok = false; }
      if (!ok) window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, "_blank", "noopener");
      markRequested(bookingId, "email");
      addActivity("message", `Richiesta recensione inviata (email)${item.guestName ? " — " + item.guestName : ""}`);
      flash(ok ? "Richiesta inviata via email." : "Bozza email aperta con il messaggio pronto.");
    } finally { setReqBusy((b) => { const n = { ...b }; delete n[bookingId]; return n; }); }
  };

  const undoRequested = (bookingId: string) => updateBooking(bookingId, { reviewRequestedAt: undefined, reviewRequestChannel: undefined });

  const cityName = (structures.find((s) => s.id === selStructureId)?.city || "").trim();
  const suggest = (r: { guest: string; bucket: string }) => {
    const first = r.guest.split(" ")[0];
    if (r.bucket === "pos") return `Grazie di cuore ${first}! Siamo felicissimi che il soggiorno sia stato all'altezza. Ti aspettiamo di nuovo${cityName ? " a " + cityName : ""} — alla prossima con una sorpresa riservata a chi torna. 🌊`;
    if (r.bucket === "neu") return `Grazie ${first} per il feedback prezioso. Abbiamo preso nota dei punti da migliorare e ci stiamo già lavorando. Ci farebbe piacere riaverti per mostrarti i progressi!`;
    return `Ci dispiace ${first}, non è lo standard che vogliamo offrire. Grazie per la segnalazione: interverremo subito. Se vorrai darci un'altra occasione, ti riserveremo un'attenzione speciale.`;
  };
  const star = (rating: number) => "★".repeat(Math.round(rating / 2)) + "☆".repeat(5 - Math.round(rating / 2));
  const color = (b: string) => (b === "pos" ? "var(--ok)" : b === "neu" ? "var(--warn)" : "var(--err)");

  return (
    <div>
      <PageHeader title="Recensioni & reputazione" subtitle="Recensioni Google reali e OTA in un posto, con risposte suggerite dall'AI" />

      {/* Con "Tutte le strutture" le recensioni sono per singola struttura: scelta esplicita invece di ripiegare in silenzio sulla prima */}
      {activeStructureId === "all" && structures.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-faint">Recensioni di</span>
          <select value={selStructureId} onChange={(e) => setSelStructureId(e.target.value)} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus">
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="text-[11px] text-faint">Le recensioni sono separate per struttura; scegli quale vedere.</span>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Media" value={<>{avg.toFixed(1)}<span className="text-xs text-faint">/10</span></>} />
        <StatCard label="Recensioni" value={<>{totalCount}{googleConnected && google.total && google.total > reviews.length ? <span className="text-xs text-faint"> ({reviews.length} qui)</span> : null}</>} />
        <StatCard label="Da rispondere" value={unanswered} color={unanswered ? "var(--warn)" : "var(--ok)"} hint={negUnanswered ? `di cui ${negUnanswered} negative` : undefined} onClick={unanswered ? () => { setReplyFilter(replyFilter === "todo" ? "all" : "todo"); } : undefined} active={replyFilter === "todo"} />
        <StatCard label="Positive" value={`${reviews.length ? Math.round(reviews.filter((r) => r.bucket === "pos").length / reviews.length * 100) : 0}%`} color="var(--ok)" />
      </div>

      {/* Allerta reputazione: negative senza risposta */}
      {negUnanswered > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm" style={{ borderColor: "var(--err)", background: "color-mix(in srgb, var(--err) 8%, transparent)" }}>
          <span className="text-txt"><b>{negUnanswered}</b> {negUnanswered === 1 ? "recensione negativa senza risposta" : "recensioni negative senza risposta"}: rispondere in fretta limita il danno di reputazione.</span>
          <button onClick={() => { setRatingFilter("neg"); setReplyFilter("todo"); setFilter("all"); }} className="rounded-lg bg-[color:var(--err)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Mostrale</button>
        </div>
      )}

      {/* Media per periodo: ultimi N giorni vs N giorni precedenti */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Andamento della media</SectionTitle>
          <div className="mb-3 flex items-center gap-1">
            {([[30, "30 giorni"], [90, "90 giorni"], [365, "12 mesi"]] as const).map(([d, lab]) => (
              <button key={d} onClick={() => setTrendDays(d)} className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${trendDays === d ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>{lab}</button>
            ))}
          </div>
        </div>
        {trend.curN === 0 && trend.prvN === 0 ? (
          <p className="text-sm text-faint">Nessuna recensione datata in questo periodo: con più recensioni comparirà il confronto con il periodo precedente.</p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div><span className="font-mono text-2xl font-bold tabular-nums text-txt">{trend.cur != null ? trend.cur.toFixed(1) : "—"}</span><span className="text-xs text-faint">/10 · ultimi {trendDays === 365 ? "12 mesi" : trendDays + " giorni"} ({trend.curN})</span></div>
            <div><span className="font-mono text-lg font-semibold tabular-nums text-dim">{trend.prv != null ? trend.prv.toFixed(1) : "—"}</span><span className="text-xs text-faint">/10 · periodo precedente ({trend.prvN})</span></div>
            {trend.cur != null && trend.prv != null && (() => { const d = trend.cur - trend.prv; const up = d >= 0; return <span className="text-sm font-semibold" style={{ color: Math.abs(d) < 0.05 ? "var(--faint)" : up ? "var(--ok)" : "var(--err)" }}>{Math.abs(d) < 0.05 ? "stabile" : `${up ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}`}</span>; })()}
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-faint">Calcolata sulle recensioni disponibili qui sotto (di Google arrivano solo le ~5 più recenti): è un indicatore, non la media ufficiale della piattaforma.</p>
      </Card>

      {/* La richiesta di recensione si fa dalla prenotazione (passaggio «Recensione»): qui resta solo la lettura e la risposta. */}

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

      {/* Punteggi per categoria (Booking.com / Airbnb / Expedia via Channex): media per canale + per categoria */}
      {scoreView.hasAny && (
        <Card className="mb-4">
          <SectionTitle>Punteggi per categoria</SectionTitle>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {REVIEW_CHANNELS.map((ch) => {
              const v = scoreView.perChannel[ch];
              return (
                <div key={ch} className="rounded-lg border border-line bg-paper px-2.5 py-2" title={v.overallDerived ? "Media calcolata sulle recensioni scaricate (Channex non fornisce il riepilogo ufficiale)" : "Punteggio ufficiale Channex"}>
                  <div className="flex items-center gap-1.5"><ChannelLogo channel={ch} size={16} /><span className="truncate text-[11px] font-semibold text-dim">{CHANNEL_LABEL[ch]}</span></div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-txt">{fmtScore(v.overall)}{v.overall != null && <span className="text-[10px] font-normal text-faint">/10</span>}</div>
                  <div className="text-[10px] text-faint">{v.overall == null ? "nessun dato da Channex" : `${v.count} recens.${v.overallDerived ? " · calcolata" : ""}`}</div>
                </div>
              );
            })}
          </div>
          {scoreView.categories.length === 0 ? (
            <p className="text-sm text-faint">Channex non ha ancora fornito punteggi per categoria per questa struttura (n/d).</p>
          ) : (
            <div>
              <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
                <span className="w-32 shrink-0">Categoria</span><span className="flex-1">Media</span><span className="w-9 shrink-0" />
                {REVIEW_CHANNELS.map((ch) => <span key={ch} className="flex w-9 shrink-0 justify-center"><ChannelLogo channel={ch} size={14} /></span>)}
              </div>
              <div className="space-y-1.5">
                {scoreView.categories.map((c, i) => (
                  <div key={c.key} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate text-sm text-txt">{c.label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-wash"><div className="anim-grow h-full rounded-full" style={{ width: `${c.score * 10}%`, backgroundColor: scoreTint(c.score), animationDelay: `${i * 45}ms` }} /></div>
                    <span className="w-9 shrink-0 text-right font-mono text-sm font-semibold text-txt">{c.score.toFixed(1)}</span>
                    {REVIEW_CHANNELS.map((ch) => {
                      const cv = scoreView.perChannel[ch].cats.get(c.key);
                      return <span key={ch} className="w-9 shrink-0 text-center font-mono text-[11px] text-dim" style={cv ? undefined : { color: "var(--faint)" }} title={cv ? `${CHANNEL_LABEL[ch]}${scoreView.perChannel[ch].derived ? " · media delle recensioni scaricate" : ""}` : `${CHANNEL_LABEL[ch]}: dato non fornito`}>{cv ? cv.score.toFixed(1) : "n/d"}</span>;
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2 text-[11px] text-faint">Dati Channex (Reviews Collection). Ogni canale usa le proprie categorie (Booking.com: pulizia, comfort, posizione, personale, servizi, qualità/prezzo; Airbnb: anche corrispondenza annuncio, comunicazione, check-in): «n/d» = il canale non fornisce quel dato. Non include Google, dirette e recensioni manuali.</p>
        </Card>
      )}

      {/* Fonti recensioni */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <SectionTitle>Fonti recensioni</SectionTitle>
        <span className="text-[11px] font-semibold text-faint">{connectedSources.length}/{SOURCES.length} attive</span>
      </div>
      <div className="mb-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {SOURCES.map((s) => {
          const on = connectedSources.includes(s.k);
          const isGoogle = s.k === "google";
          const showConnectedBadge = isGoogle || chxBadgeOn(s.k);
          return (
            <button key={s.k} onClick={() => (isGoogle ? setCfgOpen(true) : setSrcCfg(s.k))} className="group relative flex items-center gap-3 rounded-xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--focus)] hover:bg-[color:color-mix(in_srgb,var(--focus)_6%,transparent)] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] active:translate-y-0" style={{ borderColor: on ? s.color : "var(--line)" }} title="Apri impostazioni">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white transition-transform duration-200 group-hover:scale-110" style={{ backgroundColor: s.color }}>{s.label[0]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-txt">{s.label}</div>
                <div className="truncate text-[11px] text-faint">{noteFor(s)}</div>
              </div>
              {showConnectedBadge ? (
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
                ? "Gli ospiti lasciano le recensioni dal tuo mini-sito (Xenosite): le trovi qui sotto la fonte «Diretta». Sono dati tuoi, quindi puoi rispondere e — con «Pubblica risposta» — la risposta compare davvero sul mini-sito. Puoi anche aggiungerne una a mano."
                : chxSourceInfo(srcCfg)?.notInstalled
                ? `Channex è collegato, ma l'app "Messages & Reviews" non è ancora installata su Channex per questa struttura (dashboard Channex → Applications). Una volta installata, le recensioni ${SRC[srcCfg].label} arriveranno qui in automatico. Nel frattempo puoi inserirle a mano.`
                : chxSourceInfo(srcCfg)?.mapped
                ? `${SRC[srcCfg].label} è collegato automaticamente via Channex: le recensioni reali vengono importate qui sotto, e puoi rispondere direttamente da qui (la risposta viene inviata davvero su ${SRC[srcCfg].label}). Puoi comunque aggiungerne una a mano per i casi non coperti dall'importazione.`
                : `${SRC[srcCfg].label} non espone un'API pubblica self-service per le recensioni: il collegamento avverrà tramite connettore partner (in arrivo, oppure configurando Channex). Nel frattempo puoi inserire le recensioni a mano — restano salvate e rientrano in media, distribuzione e risposte AI.`}
            </div>

            {srcCfg === "direct" ? (
              <p className="mt-3 text-center text-[11px] text-faint">Le recensioni dirette arrivano dal mini-sito (Xenosite) e compaiono qui automaticamente.</p>
            ) : (
              <>
                <button onClick={() => { setMForm((f) => ({ ...f, source: srcCfg })); setShowManual(true); setSrcCfg(null); }} className="mt-3 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90">＋ Aggiungi recensione {SRC[srcCfg].label} a mano</button>
                {!chxSourceInfo(srcCfg)?.mapped && <p className="mt-2 text-center text-[11px] text-faint">Il connettore automatico {SRC[srcCfg].label} arriva collegando Channex (pagina Canali), oppure con le integrazioni partner.</p>}
              </>
            )}
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
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="mr-1 text-xs font-semibold text-faint">Risposta:</span>
        {([["all", "Tutte"], ["todo", `Da rispondere (${unanswered})`], ["done", "Risposte"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setReplyFilter(k)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${replyFilter === k ? "text-white" : "text-dim hover:bg-wash"}`} style={replyFilter === k ? { backgroundColor: k === "todo" ? "var(--warn)" : "var(--focus)" } : undefined}>{label}</button>
        ))}
        <button onClick={() => setShowManual((v) => !v)} className="ml-auto flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash"><Icon name="plus" size={13} /> Aggiungi a mano</button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Cerca ospite o testo…" />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-faint">Ordina
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs font-semibold text-txt outline-none focus:border-focus">
            <option value="new">Più recenti</option><option value="old">Più vecchie</option><option value="low">Voto più basso</option><option value="high">Voto più alto</option>
          </select>
        </label>
        <span className="text-[11px] text-faint">{shown.length} di {reviews.length}</span>
        {filtersActive && <button onClick={resetFilters} className="text-[11px] font-semibold text-focus hover:underline">Azzera filtri</button>}
        <button onClick={exportCsv} disabled={!shown.length} className="ml-auto rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40" title="Esporta in CSV le recensioni attualmente mostrate">Esporta CSV</button>
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
          <Card key={r.id} className={!replies[r.id] ? (r.bucket === "neg" ? "border-l-4 border-l-[color:var(--err)]" : "border-l-4 border-l-[color:var(--warn)]") : ""}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color(r.bucket) }} />
              <span className="font-semibold text-txt">{r.guest}</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: SRC[r.source as SourceKey]?.color ?? "var(--dim)" }}>{SRC[r.source as SourceKey]?.label ?? r.source}</span>
              <span className="text-sm" style={{ color: color(r.bucket) }}>{star(r.rating)}</span>
              <span className="font-mono text-sm text-dim">{r.rating}/10</span>
              {r.id.startsWith("manual-") && <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">manuale</span>}
              {isChx(r) && <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint" title="Importata automaticamente da Channex">via Channex</span>}
              {!replies[r.id] && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${r.bucket === "neg" ? "var(--err)" : "var(--warn)"} 14%, transparent)`, color: r.bucket === "neg" ? "var(--err)" : "var(--warn)" }}>Da rispondere{ageDays(r.date) > 0 ? ` · da ${ageDays(r.date)} g` : ""}</span>}
              <span className="ml-auto text-xs text-faint">{fmt(r.date)}</span>
              {r.id.startsWith("manual-") && <button onClick={() => removeManual(r.id)} className="text-faint hover:text-[color:var(--err)]" title="Elimina recensione manuale"><Icon name="trash" size={14} /></button>}
            </div>
            {r.text && <p className="mt-2 text-sm text-txt">{r.text}</p>}
            {isChx(r) && (() => {
              const cs = chxScoresById.get(r.id) ?? [];
              if (!cs.length) return <p className="mt-1.5 text-[11px] text-faint">Punteggi per categoria: n/d</p>;
              return (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  {cs.map((c, i) => (
                    <div key={c.key} title={`${c.label}: ${c.score.toFixed(1)}/10`}>
                      <div className="flex items-baseline justify-between gap-2 text-[11px]"><span className="truncate text-dim">{c.label}</span><span className="font-mono font-semibold text-txt">{c.score.toFixed(1)}</span></div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-wash"><div className="anim-grow h-full rounded-full" style={{ width: `${c.score * 10}%`, backgroundColor: scoreTint(c.score), animationDelay: `${i * 40}ms` }} /></div>
                    </div>
                  ))}
                </div>
              );
            })()}
            {replies[r.id] ? (
              <div className="mt-2 rounded-lg border border-line bg-wash p-2.5 text-sm text-dim"><span className="text-[10px] font-semibold uppercase tracking-wide text-faint">La tua risposta</span><div className="mt-0.5 text-txt">{replies[r.id]}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {r.source === "google" && <button onClick={() => publishOnGoogle(r.id)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-focus hover:bg-surface" title="Copia la risposta e apri la gestione recensioni di Google">📋 Copia e rispondi su Google →</button>}
                  {r.source === "direct" && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" }} title="La risposta è pubblicata sul tuo mini-sito">✓ Pubblicata sul mini-sito</span>}
                  {isChx(r) && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" }} title={`La risposta è stata inviata su ${SRC[r.source as SourceKey]?.label} tramite Channex`}>✓ Pubblicata su {SRC[r.source as SourceKey]?.label}</span>}
                  {r.source !== "direct" && !isChx(r) && <button onClick={() => { setDraft((d) => ({ ...d, [r.id]: replies[r.id] ?? "" })); const n = { ...replies }; delete n[r.id]; persistReplies(n); }} className="text-[11px] font-semibold text-focus hover:underline">Modifica</button>}
                  <button onClick={() => removeReply(r)} className="text-[11px] text-faint hover:text-[color:var(--err)]">Rimuovi</button>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <textarea value={draft[r.id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))} rows={2} placeholder="Scrivi una risposta…" className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <button onClick={() => aiReply(r)} disabled={!!aiBusy[r.id]} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50"><Icon name="sparkles" size={13} /> {aiBusy[r.id] ? "Scrivo…" : "Suggerisci risposta AI"}</button>
                  {isChx(r) ? (
                    <button onClick={() => publishChxReply(r)} disabled={!(draft[r.id] ?? "").trim() || !!chxReplyBusy[r.id]} className="rounded-lg bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40" title={`Invia la risposta su ${SRC[r.source as SourceKey]?.label} tramite Channex`}>{chxReplyBusy[r.id] ? "Invio…" : "Pubblica risposta"}</button>
                  ) : r.source === "google" ? (
                    <button onClick={() => publishGoogleFromDraft(r.id)} disabled={!(draft[r.id] ?? "").trim()} className="inline-flex items-center gap-1 rounded-lg bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40" title="Copia la risposta e apri la gestione recensioni di Google (Google non consente la pubblicazione via API)">📋 Copia e rispondi su Google →</button>
                  ) : r.source === "direct" ? (
                    <button onClick={() => publishDirect(r.id)} disabled={!(draft[r.id] ?? "").trim()} className="rounded-lg bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40" title="Pubblica la risposta sul tuo mini-sito">Pubblica risposta</button>
                  ) : (
                    <button onClick={() => saveLocalReply(r.id)} disabled={!(draft[r.id] ?? "").trim()} className="rounded-lg bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40" title="Salva la risposta (solo in locale, per tua memoria)">Salva risposta</button>
                  )}
                  {isChx(r) && chxReplyErr[r.id] && <span className="text-[11px] text-[color:var(--err)]">{chxReplyErr[r.id]}</span>}
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
        {reviews.length > 0 && shown.length === 0 && <Card className="py-8 text-center text-sm text-faint">Nessuna recensione con questi filtri.{filtersActive && <> <button onClick={resetFilters} className="font-semibold text-focus hover:underline">Azzera i filtri</button></>}</Card>}
      </div>

      <p className="mt-3 text-[11px] text-faint">Google è collegato via Google Places API (recensioni reali, ~5 più recenti). Le recensioni <strong>Dirette</strong> le lasciano gli ospiti dal tuo mini-sito e qui puoi rispondere e pubblicare davvero la risposta. <strong>Booking.com, Airbnb ed Expedia</strong> si importano automaticamente quando Channex è collegato (serve l&apos;app &quot;Messages &amp; Reviews&quot; installata su Channex); <strong>Tripadvisor</strong> non è coperto e resta a inserimento manuale.</p>
    </div>
  );
}
