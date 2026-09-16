"use client";

// Assistente Xenora: risposte immediate calcolate sui dati reali + voce (parlato in/out) e
// briefing del giorno. Nessun LLM: capisce le domande via parole chiave. La voce usa le Web
// Speech API del browser (nessuna API esterna). L'assistente conversazionale vero = upgrade con API key.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { PageHeader, Card } from "@/components/ui";
import Icon from "@/components/Icon";
import { eur } from "@/lib/format";
import { bookingGrandTotal } from "@/lib/booking";

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthOf = (iso: string) => (iso || "").slice(0, 7);

type Ans = { title: string; value: string; detail?: string; go?: { label: string; href: string } };

export default function AssistentePage() {
  const router = useRouter();
  const { bookings, getGuest, getStructure } = useData();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<Ans | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recRef = useRef<unknown>(null);

  const t = todayISO();
  const ym = monthOf(t);
  const active = useMemo(() => bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked"), [bookings]);

  useEffect(() => {
    try { const v = localStorage.getItem("spigolestay:assistant:voice"); if (v !== null) setVoiceOn(v === "1"); } catch {}
    const SR = typeof window !== "undefined" ? ((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition) : undefined;
    setVoiceSupported(!!SR);
  }, []);
  const toggleVoice = () => setVoiceOn((v) => { const n = !v; try { localStorage.setItem("spigolestay:assistant:voice", n ? "1" : "0"); } catch {} if (!n) window.speechSynthesis?.cancel(); return n; });

  const speak = useCallback((text: string) => {
    if (!voiceOn || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "it-IT"; u.rate = 1.05; u.pitch = 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch {}
  }, [voiceOn]);

  // ── Dati calcolati ──
  const answers = useMemo(() => {
    const arrivalsToday = active.filter((b) => b.checkIn === t);
    const departuresToday = active.filter((b) => b.checkOut === t);
    const noCheckin = arrivalsToday.filter((b) => !b.webCheckin);
    const monthArr = active.filter((b) => monthOf(b.checkIn) === ym);
    const ricavoMese = monthArr.reduce((a, b) => a + bookingGrandTotal(b, getStructure(b.structureId)), 0);
    const incassatoMese = monthArr.reduce((a, b) => a + (b.paid ?? 0), 0);
    const nextArrival = active.filter((b) => b.checkIn > t).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
    const list = (bs: typeof bookings) => bs.slice(0, 6).map((b) => `${getGuest(b.guestId)?.fullName || "Ospite"} (${getStructure(b.structureId)?.name ?? ""})`).join(", ");
    return {
      arrivalsToday, departuresToday, noCheckin,
      arrivi: { title: "Arrivi di oggi", value: `${arrivalsToday.length}`, detail: list(arrivalsToday) || "Nessun arrivo oggi.", go: { label: "Prenotazioni", href: "/prenotazioni" } } as Ans,
      checkin: { title: "Arrivi senza check-in online", value: `${noCheckin.length}`, detail: list(noCheckin) || "Tutti hanno fatto il check-in.", go: { label: "Prenotazioni", href: "/prenotazioni" } } as Ans,
      partenze: { title: "Partenze di oggi", value: `${departuresToday.length}`, detail: list(departuresToday) || "Nessuna partenza oggi.", go: { label: "Pulizie", href: "/pulizie" } } as Ans,
      ricavo: { title: "Ricavo del mese", value: eur(ricavoMese), detail: `${monthArr.length} prenotazioni con arrivo questo mese.`, go: { label: "Statistiche", href: "/statistiche" } } as Ans,
      incassato: { title: "Incassato del mese", value: eur(incassatoMese), detail: `Su ${eur(ricavoMese)} di ricavo previsto.`, go: { label: "Incassi", href: "/pagamenti" } } as Ans,
      prossimo: { title: "Prossimo arrivo", value: nextArrival ? new Date(nextArrival.checkIn).toLocaleDateString("it-IT") : "—", detail: nextArrival ? `${getGuest(nextArrival.guestId)?.fullName || "Ospite"} · ${getStructure(nextArrival.structureId)?.name ?? ""}` : "Nessun arrivo futuro.", go: { label: "Calendario", href: "/calendario" } } as Ans,
    };
  }, [active, t, ym, getGuest, getStructure, bookings]);

  // ── Briefing del giorno ──
  const [dueCents, setDueCents] = useState<number | null>(null);
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [d, p] = await Promise.all([
        supabase.from("documents").select("id, total_cents").in("stato", ["emessa", "inviata_intermediario", "consegnata"]),
        supabase.from("document_payments").select("document_id, amount_cents"),
      ]);
      const paid = new Map<string, number>(); for (const x of (p.data ?? []) as { document_id: string; amount_cents: number }[]) paid.set(x.document_id, (paid.get(x.document_id) ?? 0) + x.amount_cents);
      const residuo = ((d.data ?? []) as { id: string; total_cents: number }[]).reduce((a, r) => a + Math.max(0, r.total_cents - (paid.get(r.id) ?? 0)), 0);
      setDueCents(residuo);
    })();
  }, []);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
  const firstName = ((user?.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.split(" ")[0] || "";
  const briefing = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${answers.arrivalsToday.length} arriv${answers.arrivalsToday.length === 1 ? "o" : "i"}`);
    parts.push(`${answers.departuresToday.length} partenz${answers.departuresToday.length === 1 ? "a" : "e"}`);
    if (answers.noCheckin.length) parts.push(`${answers.noCheckin.length} check-in da completare`);
    if (dueCents && dueCents > 0) parts.push(`${eur(dueCents / 100)} da incassare`);
    return `${greet}${firstName ? " " + firstName : ""}. Oggi: ${parts.join(", ")}.`;
  }, [answers, dueCents, greet, firstName]);

  const briefChips = useMemo(() => [
    { n: answers.arrivalsToday.length, l: "arrivi", tone: "var(--ok)" },
    { n: answers.departuresToday.length, l: "partenze", tone: "var(--warn)" },
    { n: answers.noCheckin.length, l: "check-in mancanti", tone: "var(--focus)" },
    ...(dueCents ? [{ n: -1, l: `${eur(dueCents / 100)} da incassare`, tone: "var(--err)" }] : []),
  ], [answers, dueCents]);

  // ── Motore risposte (parole chiave) ──
  const answer = useCallback(async (text: string): Promise<Ans> => {
    const s = text.toLowerCase();
    if (/check[\s-]?in|schedin/.test(s)) return answers.checkin;
    if (/partenz|check[\s-]?out|pulizi/.test(s)) return answers.partenze;
    if (/arriv|oggi|chi viene/.test(s)) return answers.arrivi;
    if (/incass|pagat/.test(s)) return answers.incassato;
    if (/ricav|fatturat|guadagn|incasso previst/.test(s)) return answers.ricavo;
    if (/prossim|futur/.test(s)) return answers.prossimo;
    if (/da incassare|residuo|scaden/.test(s) && supabase) {
      const v = dueCents ?? 0;
      return { title: "Da incassare", value: eur(v / 100), detail: "Documenti emessi non ancora saldati.", go: { label: "Scadenzario", href: "/scadenzario-incassi" } };
    }
    if (/fornitor|passiv|da pagare/.test(s) && supabase) {
      const { data } = await supabase.from("purchase_documents").select("total_cents, paid").eq("paid", false);
      const tot = ((data ?? []) as { total_cents: number }[]).reduce((a, r) => a + r.total_cents, 0);
      return { title: "Fatture fornitori da pagare", value: eur(tot / 100), detail: `${(data ?? []).length} fatture non pagate.`, go: { label: "Fatture passive", href: "/fatture-passive" } };
    }
    return { title: "Non ho capito", value: "🤔", detail: "Prova con una delle domande rapide qui sotto." };
  }, [answers, dueCents]);

  const ask = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const a = await answer(text);
    setAns(a);
    speak(`${a.title}. ${a.value}. ${a.detail ?? ""}`);
  }, [answer, speak]);

  // ── Voce in entrata ──
  const startListening = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) return;
    try { window.speechSynthesis?.cancel(); } catch {}
    const rec = new SR() as { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: (e: unknown) => void; onend: () => void; onerror: () => void };
    rec.lang = "it-IT"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onresult = (e: unknown) => {
      const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
      setQ(finalText || interim);
    };
    rec.onend = () => { setListening(false); const txt = finalText.trim(); if (txt) ask(txt); };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true); setAns(null);
    try { rec.start(); } catch { setListening(false); }
  };
  const stopListening = () => { try { (recRef.current as { stop: () => void } | null)?.stop(); } catch {} setListening(false); };
  const toggleListening = () => (listening ? stopListening() : startListening());

  const CHIPS: { label: string; q: string }[] = [
    { label: "Chi arriva oggi?", q: "arrivi oggi" },
    { label: "Arrivi senza check-in", q: "check-in mancanti" },
    { label: "Partenze di oggi", q: "partenze" },
    { label: "Ricavo del mese", q: "ricavo del mese" },
    { label: "Incassato del mese", q: "incassato" },
    { label: "Da incassare", q: "da incassare" },
    { label: "Fornitori da pagare", q: "fornitori da pagare" },
    { label: "Prossimo arrivo", q: "prossimo arrivo" },
  ];

  const state = listening ? "listen" : speaking ? "speak" : "idle";

  return (
    <div>
      <style>{`
        @keyframes xnPulse { 0%,100% { transform: scale(1); opacity:.55 } 50% { transform: scale(1.12); opacity:.9 } }
        @keyframes xnRing { 0% { transform: scale(.7); opacity:.6 } 100% { transform: scale(1.9); opacity:0 } }
        @keyframes xnSpin { to { transform: rotate(360deg) } }
        .xn-core { animation: xnPulse 3.6s ease-in-out infinite; }
        .xn-core[data-s="listen"] { animation-duration: 1.1s; }
        .xn-core[data-s="speak"] { animation-duration: 1.7s; }
        .xn-ring { animation: xnRing 2.4s ease-out infinite; }
        .xn-ring[data-s="listen"] { animation-duration: 1.1s; }
        .xn-halo { animation: xnSpin 14s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .xn-core,.xn-ring,.xn-halo { animation: none !important; } }
      `}</style>

      <PageHeader title="Assistente Xenora" subtitle="Chiedi a voce o scrivi — rispondo con i tuoi numeri" />

      {/* Core + briefing */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
          {/* Core animato */}
          <div className="relative grid h-36 w-36 shrink-0 place-items-center">
            <span className="xn-ring absolute h-24 w-24 rounded-full" data-s={state} style={{ border: "2px solid var(--focus)" }} />
            <span className="xn-halo absolute h-32 w-32 rounded-full opacity-40" style={{ background: "conic-gradient(from 0deg, transparent, color-mix(in srgb, var(--focus) 55%, transparent), transparent 60%)" }} />
            <span className="xn-core absolute h-24 w-24 rounded-full" data-s={state} style={{ background: "radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--focus) 45%, transparent), color-mix(in srgb, var(--focus) 12%, transparent))" }} />
            <button
              onClick={toggleListening}
              disabled={!voiceSupported}
              title={voiceSupported ? (listening ? "Sto ascoltando… tocca per fermare" : "Parla con l'assistente") : "Il microfono non è supportato da questo browser"}
              className="relative z-10 grid h-16 w-16 place-items-center rounded-full text-white shadow-lg transition active:scale-95 disabled:opacity-60"
              style={{ backgroundColor: listening ? "var(--err)" : "var(--focus)" }}
            >
              <Icon name={listening ? "chat" : "sparkles"} size={26} />
            </button>
          </div>

          {/* Testo briefing */}
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Briefing del giorno</div>
            <p className="mt-1 text-lg font-semibold text-txt">{briefing}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              {briefChips.map((c) => (
                <span key={c.l} className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${c.tone} 15%, transparent)`, color: c.tone }}>{c.n >= 0 ? `${c.n} ` : ""}{c.l}</span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
              <button onClick={() => speak(briefing)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash"><Icon name="chat" size={14} /> Ascolta il briefing</button>
              <button onClick={toggleVoice} title="Attiva/disattiva la voce nelle risposte" className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${voiceOn ? "border-focus text-focus" : "border-line text-dim hover:bg-wash"}`}>{voiceOn ? "🔊 Voce attiva" : "🔇 Voce spenta"}</button>
            </div>
          </div>
        </div>
      </Card>

      {/* Input + chips */}
      <Card className="mb-4">
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex items-center gap-2">
          {voiceSupported && (
            <button type="button" onClick={toggleListening} title="Parla" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-dim transition hover:bg-wash" style={listening ? { borderColor: "var(--err)", color: "var(--err)" } : undefined}><Icon name="chat" size={18} /></button>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={listening ? "Sto ascoltando…" : "Es. quanto ho incassato questo mese?"} className="min-w-0 flex-1 rounded-lg border border-line bg-wash px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
          <button type="submit" className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Chiedi</button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CHIPS.map((c) => <button key={c.q} onClick={() => { setQ(c.label); ask(c.q); }} className="rounded-full border border-line px-3 py-1 text-xs font-medium text-dim hover:bg-wash">{c.label}</button>)}
        </div>
      </Card>

      {ans && (
        <Card>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">{ans.title}</div>
              <div className="mt-1 font-mono text-3xl font-bold text-txt">{ans.value}</div>
              {ans.detail && <p className="mt-1 text-sm text-dim">{ans.detail}</p>}
            </div>
            <button onClick={() => speak(`${ans.title}. ${ans.value}. ${ans.detail ?? ""}`)} title="Rileggi ad alta voce" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-dim hover:bg-wash"><Icon name="chat" size={16} /></button>
          </div>
          {ans.go && <button onClick={() => router.push(ans.go!.href)} className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{ans.go.label} →</button>}
        </Card>
      )}

      <p className="mt-3 text-xs text-faint">Assistente a risposte calcolate sui tuoi dati, con voce del browser (nessun dato esce da Xenora). L'assistente conversazionale completo si attiverà collegando una API.</p>
    </div>
  );
}
