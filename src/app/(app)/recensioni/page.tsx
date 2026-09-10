"use client";

import { useEffect, useState } from "react";
import { parseISO } from "@/lib/dates";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";

const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" });

// Fonti recensioni: OTA + Google. Il collegamento reale (API) arriva con il white-label.
const SOURCES = [
  { k: "google", label: "Google", color: "#4285F4", note: "Recensioni + risposta diretta (Business Profile)." },
  { k: "booking", label: "Booking.com", color: "#003580", note: "Via connessione partner / channel manager." },
  { k: "airbnb", label: "Airbnb", color: "#FF5A5F", note: "Copertura parziale (nessuna API pubblica)." },
  { k: "expedia", label: "Expedia", color: "#FFC72C", note: "Dipende dal contratto." },
  { k: "tripadvisor", label: "Tripadvisor", color: "#00AA6C", note: "Via Content/Review API." },
  { k: "direct", label: "Diretta", color: "#7A8450", note: "Recensioni dei tuoi ospiti diretti." },
] as const;
type SourceKey = typeof SOURCES[number]["k"];
const SRC = Object.fromEntries(SOURCES.map((s) => [s.k, s])) as Record<SourceKey, typeof SOURCES[number]>;
const CONN_KEY = "spigolestay:reviewsources";

export default function RecensioniPage() {
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [conn, setConn] = useState<Record<string, boolean>>({}); // nessuna fonte collegata di default: niente dati finti
  const [filter, setFilter] = useState<"all" | SourceKey>("all");
  useEffect(() => {
    try { const r = localStorage.getItem("spigolestay:reviews"); if (r) setReplies(JSON.parse(r)); } catch {}
    try { const c = localStorage.getItem(CONN_KEY); if (c) setConn(JSON.parse(c)); } catch {}
  }, []);
  const persist = (n: Record<string, string>) => { setReplies(n); try { localStorage.setItem("spigolestay:reviews", JSON.stringify(n)); } catch {} };
  const toggleConn = (k: SourceKey) => setConn((p) => { const n = { ...p, [k]: !p[k] }; try { localStorage.setItem(CONN_KEY, JSON.stringify(n)); } catch {} return n; });

  const connectedSources = SOURCES.filter((s) => conn[s.k]).map((s) => s.k);

  // Recensioni REALI: arrivano dal collegamento alle fonti (Google/Booking/…). Nessun dato finto.
  type Review = { id: string; guest: string; date: string; rating: number; text: string; bucket: "pos" | "neu" | "neg"; source: SourceKey };
  const reviews: Review[] = [];

  const shown = filter === "all" ? reviews : reviews.filter((r) => r.source === filter);
  const avg = reviews.length ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length : 0;
  const unanswered = reviews.filter((r) => !replies[r.id]).length;
  const bySource = connectedSources.map((c) => { const rs = reviews.filter((r) => r.source === c); return { c, n: rs.length, avg: rs.length ? rs.reduce((a, r) => a + r.rating, 0) / rs.length : 0 }; }).filter((x) => x.n);
  const dist = [10, 9, 8, 7, 6, 5].map((v) => ({ v, n: reviews.filter((r) => r.rating === v).length }));

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
      <PageHeader title="Recensioni & reputazione" subtitle="Tutte le recensioni delle OTA e di Google in un posto, con risposte suggerite dall'AI" />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">Media</div><div className="font-mono text-lg font-bold text-txt">{avg.toFixed(1)}<span className="text-xs text-faint">/10</span></div></div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">Recensioni</div><div className="font-mono text-lg font-bold text-txt">{reviews.length}</div></div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">Da rispondere</div><div className="font-mono text-lg font-bold" style={{ color: unanswered ? "var(--warn)" : "var(--ok)" }}>{unanswered}</div></div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">Positive</div><div className="font-mono text-lg font-bold text-[color:var(--ok)]">{reviews.length ? Math.round(reviews.filter((r) => r.bucket === "pos").length / reviews.length * 100) : 0}%</div></div>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card><SectionTitle>Media per fonte</SectionTitle><div className="space-y-2">{bySource.length === 0 ? <p className="text-sm text-faint">Collega una fonte per vedere i dati.</p> : bySource.map((x) => (<div key={x.c} className="flex items-center gap-2"><span className="w-24 text-sm text-txt">{SRC[x.c].label}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${x.avg * 10}%`, backgroundColor: SRC[x.c].color }} /></div><span className="w-16 text-right font-mono text-sm font-semibold text-txt">{x.avg.toFixed(1)} <span className="text-[10px] text-faint">({x.n})</span></span></div>))}</div></Card>
        <Card><SectionTitle>Distribuzione voti</SectionTitle><div className="space-y-1.5">{dist.map((d) => (<div key={d.v} className="flex items-center gap-2"><span className="w-6 text-right font-mono text-sm text-dim">{d.v}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full bg-focus" style={{ width: `${reviews.length ? (d.n / reviews.length) * 100 : 0}%` }} /></div><span className="w-8 text-right font-mono text-sm text-dim">{d.n}</span></div>))}</div></Card>
      </div>

      {/* Fonti recensioni: OTA + Google */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <SectionTitle>Fonti recensioni</SectionTitle>
        <span className="text-[11px] font-semibold text-faint">{connectedSources.length}/{SOURCES.length} collegate</span>
      </div>
      <div className="mb-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {SOURCES.map((s) => {
          const on = !!conn[s.k];
          return (
            <div key={s.k} className="flex items-center gap-3 rounded-xl border p-3 shadow-sm" style={{ borderColor: on ? s.color : "var(--line)" }}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: s.color }}>{s.label[0]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-txt">{s.label}</div>
                <div className="truncate text-[11px] text-faint">{s.note}</div>
              </div>
              <button onClick={() => toggleConn(s.k)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${on ? "text-white" : "border border-line text-dim hover:bg-wash"}`} style={on ? { backgroundColor: "var(--ok)" } : undefined}>{on ? "Collegato" : "Collega"}</button>
            </div>
          );
        })}
      </div>

      {/* Filtro per fonte */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <span className="mr-1 text-xs font-semibold text-faint">Fonte:</span>
        <button onClick={() => setFilter("all")} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${filter === "all" ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>Tutte</button>
        {connectedSources.map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${filter === c ? "text-white" : "text-dim hover:bg-wash"}`} style={filter === c ? { backgroundColor: SRC[c].color } : undefined}>{SRC[c].label}</button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color(r.bucket) }} />
              <span className="font-semibold text-txt">{r.guest}</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: SRC[r.source].color }}>{SRC[r.source].label}</span>
              <span className="text-sm" style={{ color: color(r.bucket) }}>{star(r.rating)}</span>
              <span className="font-mono text-sm text-dim">{r.rating}/10</span>
              <span className="ml-auto text-xs text-faint">{fmt(r.date)}</span>
            </div>
            <p className="mt-2 text-sm text-txt">{r.text}</p>
            {replies[r.id] ? (
              <div className="mt-2 rounded-lg border border-line bg-wash p-2.5 text-sm text-dim"><span className="text-[10px] font-semibold uppercase tracking-wide text-faint">La tua risposta</span><div className="mt-0.5 text-txt">{replies[r.id]}</div><button onClick={() => { const n = { ...replies }; delete n[r.id]; persist(n); }} className="mt-1 text-[11px] text-faint hover:text-[color:var(--err)]">Rimuovi</button></div>
            ) : (
              <div className="mt-2">
                <textarea value={draft[r.id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))} rows={2} placeholder="Scrivi una risposta…" className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
                <div className="mt-1.5 flex gap-2">
                  <button onClick={() => setDraft((d) => ({ ...d, [r.id]: suggest(r) }))} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash"><Icon name="sparkles" size={13} /> Suggerisci risposta AI</button>
                  <button onClick={() => { if ((draft[r.id] ?? "").trim()) persist({ ...replies, [r.id]: draft[r.id].trim() }); }} disabled={!(draft[r.id] ?? "").trim()} className="rounded-lg bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">Pubblica risposta</button>
                </div>
              </div>
            )}
          </Card>
        ))}
        {connectedSources.length === 0 && <Card className="py-8 text-center text-sm text-faint">Collega una fonte (Google, Booking…) per importare qui le recensioni.</Card>}
        {connectedSources.length > 0 && shown.length === 0 && <Card className="py-8 text-center text-sm text-faint">Nessuna recensione ancora: verranno importate dalle fonti collegate.</Card>}
      </div>
      <p className="mt-3 text-[11px] text-faint">Le recensioni vengono importate dalle fonti collegate (Google, Booking, Tripadvisor…). Il collegamento reale alle API verrà attivato con il white-label.</p>
    </div>
  );
}
