"use client";

// Assistente Xenora: risposte immediate calcolate sui dati reali + voce (parlato in/out) e
// briefing del giorno. Nessun LLM: capisce le domande via parole chiave. La voce usa le Web
// Speech API del browser (nessuna API esterna). L'assistente conversazionale vero = upgrade con API key.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { useTheme } from "@/lib/theme";
import Icon from "@/components/Icon";
import NeuralShell from "@/components/NeuralShell";
import { eur } from "@/lib/format";
import { bookingGrandTotal } from "@/lib/booking";
import { nights } from "@/lib/dates";
import { CHANNELS, type Booking } from "@/lib/types";

// Data locale (NON UTC): altrimenti vicino a mezzanotte "oggi" sfasa di un giorno.
const todayISO = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const monthOf = (iso: string) => (iso || "").slice(0, 7);

// Terracotta con alpha, per riflessi/aloni caldi coerenti col nucleo (niente azzurrino).
function hexA(hex: string, a: number) {
  const h = (hex || "#B65C3C").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${isNaN(r) ? 182 : r},${isNaN(g) ? 92 : g},${isNaN(b) ? 60 : b},${Math.max(0, Math.min(1, a))})`;
}

// Glifo microfono in linea (l'icon-set non ha un "mic"): dà all'assistente un tono più "voce".
function Mic({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

type PickItem = { id: string; label: string; sub?: string };
type Ans = { title: string; value?: string; detail?: string; speech?: string; list?: PickItem[]; go?: { label: string; href: string } };

export default function AssistentePage() {
  const router = useRouter();
  const { bookings, roomTypes, units, getGuest, getStructure, getUnit } = useData();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [ans, setAns] = useState<Ans | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [micAvailable, setMicAvailable] = useState(true);
  const [micHint, setMicHint] = useState("");
  const recRef = useRef<unknown>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const t = todayISO();
  const ym = monthOf(t);
  const active = useMemo(() => bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked"), [bookings]);

  useEffect(() => {
    try { const v = localStorage.getItem("spigolestay:assistant:voice"); if (v !== null) setVoiceOn(v === "1"); } catch {}
    const SR = typeof window !== "undefined" ? ((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition) : undefined;
    setVoiceSupported(!!SR);
    setMicAvailable(!!SR);
    // Se il permesso microfono risulta già NEGATO/assente (es. dentro l'app di Claude), nascondi la voce.
    if (!SR || !navigator.mediaDevices?.getUserMedia) { setMicAvailable(false); return; }
    try {
      navigator.permissions?.query({ name: "microphone" as PermissionName }).then((p) => {
        if (p.state === "denied") setMicAvailable(false);
        p.onchange = () => setMicAvailable(p.state !== "denied");
      }).catch(() => {});
    } catch {}
  }, []);

  // Scelta della voce italiana più naturale disponibile (Google/cloud/neural), non quella robotica di default.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    // Priorità alla NATURALEZZA (voci cloud/Google/neural): quelle robotiche locali perdono.
    // Il maschile è solo una preferenza a parità di qualità, non a scapito della naturalezza.
    const MALE = /cosimo|diego|giorgio|luca|carlo|marco|paolo|giuseppe|antonio|maschile|uomo/;
    const score = (v: SpeechSynthesisVoice) => {
      const n = v.name.toLowerCase(); let s = 0;
      if (v.localService === false) s += 8;                                   // cloud = naturale
      if (/google|natural|neural|premium|enhanced|wavenet|siri/.test(n)) s += 8;
      if (MALE.test(n)) s += 3;                                               // preferenza maschile (tiebreak)
      return s;
    };
    const pick = () => {
      const vs = window.speechSynthesis.getVoices();
      const it = vs.filter((v) => /^it(-|_)?/i.test(v.lang) || /ital/i.test(v.name));
      it.sort((a, b) => score(b) - score(a));
      voiceRef.current = it[0] ?? vs.find((v) => /^it/i.test(v.lang)) ?? null;
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
    return () => { try { window.speechSynthesis.onvoiceschanged = null; } catch {} };
  }, []);
  const toggleVoice = () => setVoiceOn((v) => { const n = !v; try { localStorage.setItem("spigolestay:assistant:voice", n ? "1" : "0"); } catch {} if (!n) window.speechSynthesis?.cancel(); return n; });

  const speak = useCallback((text: string) => {
    if (!voiceOn || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "it-IT";
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 1.0; u.pitch = 1.02; u.volume = 1;
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
    return {
      arrivalsToday, departuresToday, noCheckin,
      ricavo: { title: "Ricavo del mese", value: eur(ricavoMese), detail: `${monthArr.length} prenotazioni con arrivo questo mese.`, go: { label: "Statistiche", href: "/statistiche" } } as Ans,
      incassato: { title: "Incassato del mese", value: eur(incassatoMese), detail: `Su ${eur(ricavoMese)} di ricavo previsto.`, go: { label: "Incassi", href: "/pagamenti" } } as Ans,
      prossimo: { title: "Prossimo arrivo", value: nextArrival ? new Date(nextArrival.checkIn).toLocaleDateString("it-IT") : "—", detail: nextArrival ? `${getGuest(nextArrival.guestId)?.fullName || "Ospite"} · ${getStructure(nextArrival.structureId)?.name ?? ""}` : "Nessun arrivo futuro.", go: { label: "Calendario", href: "/calendario" } } as Ans,
    };
  }, [active, t, ym, getGuest, getStructure]);

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

  // Descrizione COMPLETA e discorsiva di una prenotazione (per lettura vocale + testo).
  const narrate = useCallback((b: Booking): { title: string; text: string } => {
    const g = getGuest(b.guestId);
    const name = g?.fullName || [b.primaryGuest?.firstName, b.primaryGuest?.lastName].filter(Boolean).join(" ") || "Ospite";
    const st = getStructure(b.structureId);
    const unit = getUnit(b.unitId);
    const rt = roomTypes.find((r) => r.id === b.roomTypeId);
    const nN = nights(b.checkIn, b.checkOut);
    const dOf = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
    const ch = CHANNELS[b.channel]?.label || b.channel;
    const total = b.total ?? 0, paid = b.paid ?? 0, resid = Math.max(0, total - paid);
    const people = `${b.adults} adult${b.adults === 1 ? "o" : "i"}${b.children ? ` e ${b.children} bambin${b.children === 1 ? "o" : "i"}` : ""}`;
    const pay = total === 0 ? "Nessun importo registrato per il soggiorno." : paid <= 0 ? `Deve ancora pagare l'intero importo di ${eur(total)}: non ha versato nulla.` : resid <= 0 ? `Ha già saldato tutto, ${eur(total)}.` : `Ha versato ${eur(paid)} su ${eur(total)}; restano ${eur(resid)} da incassare.`;
    const p: string[] = [];
    p.push(`${name}: ${b.checkIn === todayISO() ? "arriva oggi" : `arriva ${dOf(b.checkIn)}`} e riparte ${dOf(b.checkOut)}, ${nN} nott${nN === 1 ? "e" : "i"}.`);
    p.push(`Ha prenotato tramite ${ch}.`);
    p.push(unit ? `Alloggia ${st ? `al ${st.name}, ` : ""}camera ${unit.name}${rt ? `, tipologia ${rt.name}` : ""}.` : `Camera non ancora assegnata${rt ? `, tipologia ${rt.name}` : ""}${st ? `, ${st.name}` : ""}.`);
    p.push(`Sono ${people}.`);
    if (b.arrivalTime) p.push(`Orario di arrivo previsto: ${b.arrivalTime}.`);
    p.push(pay);
    p.push(b.webCheckin ? "Ha già fatto il check-in online." : "Non ha ancora fatto il check-in online.");
    p.push(b.parking ? "Ha prenotato il parcheggio." : "Non ha prenotato il parcheggio.");
    if (b.extras && b.extras.length) p.push(`Extra richiesti: ${b.extras.map((e) => e.name).join(", ")}.`);
    if (b.cityTaxExempt) p.push("È esente dalla tassa di soggiorno.");
    else p.push(b.cityTaxPaid ? "La tassa di soggiorno è stata incassata." : "La tassa di soggiorno è ancora da incassare.");
    if (b.depositPaid) p.push("La caparra è stata ricevuta.");
    if (b.guestRequests) p.push(`Richieste dell'ospite: ${b.guestRequests}.`);
    else if (b.note) p.push(`Nota interna: ${b.note}.`);
    return { title: name, text: p.join(" ") };
  }, [getGuest, getStructure, getUnit, roomTypes]);

  const subOf = useCallback((b: Booking) => {
    const u = getUnit(b.unitId); const parts: string[] = [];
    if (u) parts.push(`Camera ${u.name}`);
    if (b.arrivalTime) parts.push(`arrivo ${b.arrivalTime}`);
    parts.push(CHANNELS[b.channel]?.label || b.channel);
    if (!b.webCheckin) parts.push("check-in da fare");
    return parts.join(" · ");
  }, [getUnit]);

  const pickBooking = useCallback((id: string) => {
    const b = bookings.find((x) => x.id === id); if (!b) return;
    const nb = narrate(b);
    setAns({ title: nb.title, detail: nb.text, speech: nb.text, go: { label: "Apri in Prenotazioni", href: "/prenotazioni" } });
    speak(nb.text);
  }, [bookings, narrate, speak]);

  // Racconta TUTTE le prenotazioni dell'elenco, una dopo l'altra, in un unico discorso.
  const readAllList = useCallback((list: PickItem[]) => {
    const parts = list.map((it, i) => { const b = bookings.find((x) => x.id === it.id); return b ? `${i + 1}) ${narrate(b).text}` : ""; }).filter(Boolean);
    if (!parts.length) return;
    const intro = `Ecco il riepilogo completo, ${parts.length} prenotazion${parts.length === 1 ? "e" : "i"}.`;
    const full = [intro, ...parts].join("  ");
    setAns({ title: "Riepilogo completo", detail: full, speech: full, go: { label: "Apri in Prenotazioni", href: "/prenotazioni" } });
    speak(full);
  }, [bookings, narrate, speak]);

  // Briefing "distribuito": ogni numero è una tessera a sé. Set ricco di indicatori reali.
  const tiles = useMemo(() => {
    const inHouse = active.filter((b) => b.checkIn <= t && t < b.checkOut);
    const cleanUnits = new Set<string>();
    for (const b of active) { if (b.checkOut === t || b.checkIn === t || (b.checkIn < t && t < b.checkOut)) if (b.unitId) cleanUnits.add(b.unitId); }
    const totUnits = units.filter((u) => !u.outOfService).length;
    const occToday = active.filter((b) => b.checkIn <= t && t < b.checkOut && b.unitId).length;
    const occPct = totUnits > 0 ? Math.round((occToday / totUnits) * 100) : 0;
    const monthArr = active.filter((b) => monthOf(b.checkIn) === ym);
    const next = active.filter((b) => b.checkIn > t).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
    const nextLabel = next ? new Date(next.checkIn + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) : "—";
    const unpaid = active.filter((b) => { const tot = bookingGrandTotal(b, getStructure(b.structureId)); return tot > 0 && (b.paid ?? 0) < tot - 0.01; }).length;
    const cityTaxDue = active.filter((b) => b.checkOut >= t && !b.cityTaxPaid).length;
    const weekArr = active.filter((b) => b.checkIn > t && b.checkIn <= new Date(Date.parse(t) + 7 * 86400000).toISOString().slice(0, 10)).length;
    // ── Serie giornaliere reali per i mini-grafici (stile HUD) ──
    const dayISO = (off: number) => { const d = new Date(t + "T00:00:00"); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const arrNext7 = Array.from({ length: 7 }, (_, i) => { const day = dayISO(i); return active.filter((b) => b.checkIn === day).length; });
    const depNext7 = Array.from({ length: 7 }, (_, i) => { const day = dayISO(i); return active.filter((b) => b.checkOut === day).length; });
    const inHouse7 = Array.from({ length: 7 }, (_, i) => { const day = dayISO(i); return active.filter((b) => b.checkIn <= day && day < b.checkOut && b.unitId).length; });
    const occ14 = Array.from({ length: 14 }, (_, i) => { const day = dayISO(i); const occ = active.filter((b) => b.checkIn <= day && day < b.checkOut && b.unitId).length; return totUnits > 0 ? Math.round((occ / totUnits) * 100) : 0; });
    const arrLast14 = Array.from({ length: 14 }, (_, i) => { const day = dayISO(i - 13); return active.filter((b) => b.checkIn === day).length; });
    const revLast6mo = Array.from({ length: 6 }, (_, i) => { const d = new Date(t + "T00:00:00"); d.setMonth(d.getMonth() - (5 - i)); const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; return Math.round(active.filter((b) => monthOf(b.checkIn) === m).reduce((a, b) => a + bookingGrandTotal(b, getStructure(b.structureId)), 0)); });
    return [
      { label: "Arrivi oggi", value: String(answers.arrivalsToday.length), tone: "var(--ok)", q: "arrivi oggi", spark: arrNext7 },
      { label: "Partenze oggi", value: String(answers.departuresToday.length), tone: "var(--warn)", q: "partenze", spark: depNext7 },
      { label: "In casa ora", value: String(inHouse.length), tone: "#38bdf8", q: "chi è in casa", spark: inHouse7 },
      { label: "Check-in mancanti", value: String(answers.noCheckin.length), tone: "var(--focus)", q: "check-in mancanti" },
      { label: "Camere da pulire", value: String(cleanUnits.size), tone: "#a78bfa", q: "pulizie" },
      { label: "Occupazione oggi", value: `${occPct}%`, tone: occPct >= 80 ? "var(--ok)" : occPct >= 40 ? "var(--warn)" : "var(--err)", q: "occupazione", spark: occ14 },
      { label: "Arrivi 7 giorni", value: String(weekArr), tone: "#2dd4bf", q: "prossimi arrivi", spark: arrNext7 },
      { label: "Prossimo arrivo", value: nextLabel, tone: "#38bdf8", q: "prossimo arrivo" },
      { label: "Prenotazioni mese", value: String(monthArr.length), tone: "var(--focus)", q: "prenotazioni del mese", spark: arrLast14 },
      { label: "Da incassare", value: dueCents != null ? eur(dueCents / 100) : "—", tone: "var(--err)", q: "da incassare" },
      { label: "Prenotazioni non saldate", value: String(unpaid), tone: "var(--warn)", q: "da incassare" },
      { label: "Tassa soggiorno da incassare", value: String(cityTaxDue), tone: "#f59e0b", q: "tassa di soggiorno" },
      { label: "Incassato mese", value: answers.incassato.value ?? "—", tone: "var(--ok)", q: "incassato" },
      { label: "Ricavo previsto", value: answers.ricavo.value ?? "—", tone: "var(--focus)", q: "ricavo", spark: revLast6mo },
    ];
  }, [answers, dueCents, active, t, ym, units, getStructure]);

  // ── Motore risposte (parole chiave) ──
  const answer = useCallback(async (text: string): Promise<Ans> => {
    const s = text.toLowerCase().trim();
    const itemsOf = (bs: Booking[]): PickItem[] => bs.map((b) => ({ id: b.id, label: getGuest(b.guestId)?.fullName || "Ospite", sub: subOf(b) }));

    // Nome ospite nella domanda → narrazione diretta di quella prenotazione.
    if (!/arriv|partenz|check|incass|ricav|fornitor|mese|prossim/.test(s)) {
      const named = active.find((b) => {
        const nm = (getGuest(b.guestId)?.fullName || "").toLowerCase(); if (!nm) return false;
        const parts = nm.split(/\s+/).filter((w) => w.length > 2);
        const matches = parts.filter((w) => s.includes(w)).length;
        return matches >= 2 || (matches >= 1 && /info|dimmi|parla|prenotaz|ospite|chi è/.test(s));
      });
      if (named) { const nb = narrate(named); return { title: nb.title, detail: nb.text, speech: nb.text, go: { label: "Apri in Prenotazioni", href: "/prenotazioni" } }; }
    }

    if (/check[\s-]?in|schedin/.test(s)) {
      const bs = answers.noCheckin, n = bs.length;
      const intro = n === 0 ? "Tutti gli arrivi di oggi hanno già fatto il check-in online." : `Ci ${n === 1 ? "è" : "sono"} ${n} arriv${n === 1 ? "o" : "i"} senza check-in online. Scegline uno e ti dico tutto.`;
      return { title: "Check-in da completare", value: String(n), detail: intro, speech: intro, list: itemsOf(bs) };
    }
    // Valori "dashboard": gestiti PRIMA delle keyword generiche (arriv/partenz) per evitare il misrouting dei tile.
    const weekEndISO = new Date(Date.parse(t) + 7 * 86400000).toISOString().slice(0, 10);
    const weekArrList = active.filter((b) => b.checkIn > t && b.checkIn <= weekEndISO);
    const inHouseList = active.filter((b) => b.checkIn <= t && t < b.checkOut);
    const cityTaxDue = active.filter((b) => b.checkOut >= t && !b.cityTaxPaid).length;
    const totUnits = units.filter((u) => !u.outOfService).length;
    const occToday = active.filter((b) => b.checkIn <= t && t < b.checkOut && b.unitId).length;
    const occPct = totUnits > 0 ? Math.round((occToday / totUnits) * 100) : 0;
    const cleanSet = new Set<string>(); for (const b of active) { if ((b.checkOut === t || b.checkIn === t || (b.checkIn < t && t < b.checkOut)) && b.unitId) cleanSet.add(b.unitId); }

    if (/tassa|soggiorno/.test(s)) {
      const intro = cityTaxDue === 0 ? "Nessuna tassa di soggiorno da incassare al momento." : `Ci sono ${cityTaxDue} soggiorni con tassa di soggiorno ancora da incassare.`;
      return { title: "Tassa di soggiorno", value: String(cityTaxDue), detail: intro, speech: intro, go: { label: "Tassa soggiorno", href: "/tassa-soggiorno" } };
    }
    if (/occupaz/.test(s)) {
      const intro = `Oggi sei al ${occPct}% di occupazione: ${occToday} camere occupate su ${totUnits}.`;
      return { title: "Occupazione oggi", value: `${occPct}%`, detail: intro, speech: intro, go: { label: "Calendario", href: "/calendario" } };
    }
    if (/in casa|in struttura|presenti|chi c'?è ora/.test(s)) {
      const n = inHouseList.length;
      const intro = n === 0 ? "In questo momento non c'è nessun ospite in casa." : `In casa adesso ci ${n === 1 ? "è" : "sono"} ${n} ospit${n === 1 ? "e" : "i"}.`;
      return { title: "In casa ora", value: String(n), detail: intro, speech: intro, list: itemsOf(inHouseList) };
    }
    if (/pulizi|da pulire|riassett/.test(s)) {
      const n = cleanSet.size;
      const intro = n === 0 ? "Nessuna camera da pulire oggi." : `Oggi ci ${n === 1 ? "è" : "sono"} ${n} camer${n === 1 ? "a" : "e"} da pulire.`;
      return { title: "Camere da pulire", value: String(n), detail: intro, speech: intro, go: { label: "Pulizie", href: "/pulizie" } };
    }
    if (/prossimi arriv|arrivi 7|7 giorni|settiman/.test(s)) {
      const n = weekArrList.length;
      const intro = n === 0 ? "Nessun arrivo nei prossimi 7 giorni." : `Nei prossimi 7 giorni ci ${n === 1 ? "è" : "sono"} ${n} arriv${n === 1 ? "o" : "i"}.`;
      return { title: "Arrivi · prossimi 7 giorni", value: String(n), detail: intro, speech: intro, list: itemsOf(weekArrList) };
    }
    if (/prossimo arrivo/.test(s)) return answers.prossimo;
    if (/partenz|check[\s-]?out/.test(s)) {
      const bs = answers.departuresToday, n = bs.length;
      const intro = n === 0 ? `${firstName ? firstName + ", o" : "O"}ggi non ci sono partenze.` : `Oggi ${n === 1 ? "parte" : "partono"} ${n} ospit${n === 1 ? "e" : "i"}. Toccane uno per i dettagli.`;
      return { title: "Partenze di oggi", value: String(n), detail: intro, speech: intro, list: itemsOf(bs) };
    }
    if (/arriv|chi viene|chi arriva/.test(s)) {
      const bs = answers.arrivalsToday, n = bs.length;
      const hello = `Ciao${firstName ? " " + firstName : ""}`;
      const intro = n === 0 ? `${hello}, oggi non ci sono arrivi.` : `${hello}! Oggi ci ${n === 1 ? "è un arrivo" : `sono ${n} arrivi`}. Se vuoi ti dico tutto di ognuno: scegli una prenotazione qui sotto o dimmi il nome dell'ospite.`;
      return { title: "Arrivi di oggi", value: String(n), detail: intro, speech: intro, list: itemsOf(bs) };
    }
    // "Da incassare/residuo/scadenze" PRIMA di "incassato", altrimenti verrebbe intercettato da /incass/.
    if (/da incassare|residuo|scaden|da riscuotere/.test(s)) {
      const v = dueCents ?? 0;
      return { title: "Da incassare", value: eur(v / 100), detail: "Documenti emessi non ancora saldati.", speech: `Da incassare: ${eur(v / 100)} di documenti emessi non ancora saldati.`, go: { label: "Scadenzario", href: "/scadenzario-incassi" } };
    }
    if (/incass|pagat/.test(s)) return answers.incassato;
    if (/ricav|fatturat|guadagn|incasso previst/.test(s)) return answers.ricavo;
    if (/prossim|futur/.test(s)) return answers.prossimo;
    if (/fornitor|passiv|da pagare/.test(s) && supabase) {
      const { data } = await supabase.from("purchase_documents").select("total_cents, paid").eq("paid", false);
      const tot = ((data ?? []) as { total_cents: number }[]).reduce((a, r) => a + r.total_cents, 0);
      return { title: "Fatture fornitori da pagare", value: eur(tot / 100), detail: `${(data ?? []).length} fatture non pagate.`, go: { label: "Fatture passive", href: "/fatture-passive" } };
    }
    return { title: "Non ho capito", value: "🤔", detail: "Prova con: chi arriva oggi, partenze, check-in, ricavo del mese, da incassare — oppure dimmi il nome di un ospite." };
  }, [answers, active, dueCents, firstName, getGuest, narrate, subOf, units, t]);

  const ask = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const a = await answer(text);
    setAns(a);
    speak(a.speech ?? [a.title, a.value, a.detail].filter(Boolean).join(". "));
  }, [answer, speak]);

  // ── Voce in entrata ──
  const startListening = async () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) { setMicHint("Microfono non supportato da questo browser"); return; }
    setMicHint("");
    const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();
    // Pre-controllo del permesso: NON blocca piu. Se fallisce annotiamo il motivo e proviamo
    // lo stesso, perche il riconoscimento vocale di Chrome chiede il permesso per conto suo.
    let preErr = "";
    let granted = false;
    try {
      const st = await (navigator.permissions as unknown as { query?: (d: { name: string }) => Promise<{ state: string }> })?.query?.({ name: "microphone" });
      granted = st?.state === "granted";
    } catch {}
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((tr) => tr.stop());
        granted = true;
      } catch (err) {
        const name = (err as { name?: string })?.name || "";
        console.warn("[Assistente] getUserMedia error:", err, { embedded, granted });
        if (name === "NotFoundError" || name === "DevicesNotFoundError") { setMicHint("Nessun microfono rilevato sul dispositivo."); return; }
        if (name === "NotReadableError" || name === "TrackStartError") { setMicHint("Il microfono è occupato da un'altra app (es. Zoom/Teams). Chiudila e riprova."); return; }
        preErr = embedded
          ? `Qui la pagina gira dentro un'altra app e il microfono non passa (${name || "sconosciuto"}). Apri xenora.it in una scheda di Chrome o Edge.`
          : granted
            ? "Il sito ha il permesso ma il microfono resta bloccato. Su Windows: Impostazioni → Privacy e sicurezza → Microfono → attiva anche «Consenti alle app desktop di accedere al microfono», poi riavvia il browser."
            : `Permesso negato (${name || "sconosciuto"}). Clicca il lucchetto accanto all'indirizzo, consenti il microfono e ricarica la pagina.`;
      }
    }
    try { window.speechSynthesis?.cancel(); } catch {}
    let rec: { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; start: () => void; stop: () => void; onresult: (e: unknown) => void; onend: () => void; onerror: (e: unknown) => void };
    try { rec = new SR() as typeof rec; } catch { setMicHint(preErr || "Microfono non disponibile"); return; }
    rec.lang = "it-IT"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let lastText = "";
    rec.onresult = (e: unknown) => {
      const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }>> };
      let txt = "";
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      lastText = txt; setQ(txt);
    };
    rec.onerror = (e: unknown) => {
      setListening(false);
      const err = (e as { error?: string })?.error;
      console.warn("[Assistente] SpeechRecognition error:", err);
      if (err === "not-allowed" || err === "service-not-allowed") setMicHint(preErr || "Microfono bloccato: clicca il lucchetto accanto all'indirizzo, consenti il microfono e ricarica.");
      else if (err === "no-speech") setMicHint("Non ho sentito nulla, riprova");
      else if (err === "audio-capture") setMicHint("Nessun microfono trovato.");
      else if (err === "network") setMicHint("Il riconoscimento vocale non raggiunge il server: serve Chrome o Edge con connessione attiva.");
      else if (err === "aborted") setMicHint("");
      else setMicHint(`Microfono non disponibile qui (${err || "sconosciuto"}).`);
    };
    rec.onend = () => { setListening(false); const txt = lastText.trim(); if (txt) ask(txt); };
    recRef.current = rec;
    setListening(true); setAns(null);
    try { rec.start(); } catch { setListening(false); setMicHint(preErr || "Impossibile avviare il microfono"); }
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

  // ── Identità cromatica dell'Assistente (theme-aware): greige caldo + terracotta in chiaro,
  //    notte calda con ambra/terracotta in scuro. NIENTE azzurrino. Stesse superfici del nucleo,
  //    così hero, barra comandi e risposta sembrano UNA cosa sola col Neural Shell.
  const { theme } = useTheme();
  const light = theme !== "dark";
  const accent = light ? "#B65C3C" : "#E08A5B";
  const accentInk = light ? "#FFFFFF" : "#1B1510";
  const gold = light ? "#C79544" : "#E7B968";
  const panelBg = light
    ? "radial-gradient(120% 100% at 50% 0%, #FCFBF9 0%, #F3EFE9 100%)"
    : "radial-gradient(120% 100% at 50% 0%, #1B1510 0%, #120D09 100%)";
  const panelBorder = light ? "rgba(160,152,138,.42)" : "rgba(120,110,95,.24)";
  const panelShadow = light
    ? "0 1px 0 rgba(255,255,255,.7) inset, 0 24px 56px -34px rgba(60,54,44,.4)"
    : "0 1px 0 rgba(255,255,255,.05) inset, 0 28px 64px -38px rgba(0,0,0,.75)";
  const eyebrowCol = light ? "rgba(90,85,76,.9)" : "rgba(210,200,188,.75)";
  const softFill = light ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.04)";
  const panelStyle = { background: panelBg, borderColor: panelBorder, boxShadow: panelShadow };

  // Briefing "vivo" del giorno reso a tessere eleganti (stessi dati del testo vocale `briefing`).
  const todayFacts: { k: string; v: string; tone: string }[] = [
    { k: "Arrivi oggi", v: String(answers.arrivalsToday.length), tone: accent },
    { k: "Partenze oggi", v: String(answers.departuresToday.length), tone: gold },
  ];
  if (answers.noCheckin.length) todayFacts.push({ k: "Check-in da fare", v: String(answers.noCheckin.length), tone: "var(--warn)" });
  if (dueCents && dueCents > 0) todayFacts.push({ k: "Da incassare", v: eur(dueCents / 100), tone: "var(--err)" });

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ─────────── HERO: saluto + briefing del giorno integrati, comandi voce eleganti ─────────── */}
      <header className="relative overflow-hidden rounded-3xl border p-5 sm:p-7" style={panelStyle}>
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full" style={{ background: `radial-gradient(circle, ${hexA(accent, light ? 0.14 : 0.22)} 0%, transparent 70%)` }} />
        <span aria-hidden className="pointer-events-none absolute -left-24 top-1/3 h-52 w-52 rounded-full" style={{ background: `radial-gradient(circle, ${hexA(gold, light ? 0.1 : 0.16)} 0%, transparent 70%)` }} />

        <div className="relative flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: eyebrowCol }}>
            <span aria-hidden className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: gold }} />
            </span>
            Assistente Xenora
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ borderColor: hexA(accent, 0.35), color: accent, background: hexA(accent, light ? 0.06 : 0.12) }}>
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: accent }} />
            {state === "listen" ? "In ascolto" : state === "speak" ? "Risposta" : "Online"}
          </span>
        </div>

        <div className="relative mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-[26px] font-bold leading-[1.08] tracking-tight text-txt sm:text-3xl">
              {greet}{firstName ? ` ${firstName}` : ""}<span style={{ color: accent }}>.</span>
            </h1>
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {todayFacts.map((f) => (
                <span key={f.k} className="inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1" style={{ borderColor: panelBorder, background: softFill }}>
                  <span className="font-mono text-sm font-bold tabular-nums" style={{ color: f.tone }}>{f.v}</span>
                  <span className="text-[11px] font-medium text-dim">{f.k}</span>
                </span>
              ))}
            </div>
            <p className="mt-3.5 max-w-md text-sm leading-relaxed text-dim">Chiedi a voce o scrivi: rispondo con i numeri reali della tua struttura.</p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {micAvailable && (
              <button onClick={toggleListening} title={listening ? "Sto ascoltando… tocca per fermare" : "Tocca per parlare"} className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold shadow-sm transition active:scale-95" style={{ backgroundColor: listening ? "var(--err)" : accent, color: listening ? "#fff" : accentInk }}><Mic /> {listening ? "Ascolto…" : "Parla"}</button>
            )}
            <button onClick={() => speak(briefing)} title="Ascolta il briefing del giorno" className="inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-semibold text-txt transition hover:bg-wash" style={{ borderColor: panelBorder }}><Icon name="chat" size={14} /> Ascolta</button>
            <button onClick={toggleVoice} title="Attiva/disattiva la voce nelle risposte" className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-xs font-semibold transition" style={voiceOn ? { borderColor: hexA(accent, 0.5), color: accent, background: hexA(accent, light ? 0.05 : 0.1) } : { borderColor: panelBorder, color: "var(--dim)" }}>{voiceOn ? "🔊 Voce attiva" : "🔇 Voce spenta"}</button>
          </div>
        </div>

        {(!micAvailable || micHint) && <p className="relative mt-4 text-xs font-medium" style={{ color: micHint ? "var(--err)" : "var(--faint)" }}>{micHint || "La voce in entrata si attiva aprendo Xenora in Chrome o Edge."}</p>}
      </header>

      {/* ─────────── NEURAL SHELL: il nucleo protagonista, con i dati che confluiscono al centro ─────────── */}
      <NeuralShell inputs={tiles} state={state} onInput={(query) => { setQ(query); ask(query); }} />

      {/* ─────────── BARRA COMANDI: input elegante + chips a pillola ─────────── */}
      <section className="rounded-3xl border p-4 sm:p-5" style={panelStyle}>
        <div className="mb-3 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: accent }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} /> Chiedi all&apos;assistente
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex items-center gap-2 rounded-2xl border p-1.5 transition-shadow" style={{ borderColor: focused ? accent : panelBorder, background: softFill, boxShadow: focused ? `0 0 0 3px ${hexA(accent, 0.14)}` : "none" }}>
          {micAvailable && (
            <button type="button" onClick={toggleListening} title="Parla" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl transition active:scale-95" style={listening ? { backgroundColor: "var(--err)", color: "#fff" } : { color: accent, background: hexA(accent, light ? 0.08 : 0.14) }}><Mic size={18} /></button>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder={listening ? "Sto ascoltando…" : "Es. quanto ho incassato questo mese?"} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-txt outline-none placeholder:text-faint" />
          <button type="submit" className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition hover:opacity-90 active:scale-95" style={{ backgroundColor: accent, color: accentInk }}>Chiedi</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <button key={c.q} onClick={() => { setQ(c.label); ask(c.q); }} className="rounded-full border px-3.5 py-1.5 text-xs font-medium text-dim transition-all hover:-translate-y-px" style={{ borderColor: panelBorder, background: softFill }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; e.currentTarget.style.background = hexA(accent, light ? 0.06 : 0.12); }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = panelBorder; e.currentTarget.style.color = ""; e.currentTarget.style.background = softFill; }}>{c.label}</button>
          ))}
        </div>
      </section>

      {/* ─────────── AREA RISPOSTA ─────────── */}
      {ans && (
        <section className="anim-pop relative overflow-hidden rounded-3xl border p-5 sm:p-6" style={panelStyle}>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5" style={{ background: `linear-gradient(${accent}, ${gold})` }} />
          <div className="flex items-start justify-between gap-3 pl-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: accent }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} /> {ans.title}
              </div>
              {ans.value && <div className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-txt sm:text-4xl">{ans.value}</div>}
              {ans.detail && <p className="mt-2 text-sm leading-relaxed text-dim">{ans.detail}</p>}
            </div>
            <button onClick={() => speak(ans.speech ?? [ans.title, ans.value, ans.detail].filter(Boolean).join(". "))} title="Rileggi ad alta voce" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border text-dim transition hover:bg-wash" style={{ borderColor: panelBorder }}><Icon name="chat" size={16} /></button>
          </div>
          {ans.list && ans.list.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 pl-2.5">
              <button onClick={() => readAllList(ans.list!)} className="mb-1 inline-flex items-center justify-center gap-1.5 self-start rounded-full px-4 py-2 text-xs font-semibold shadow-sm transition hover:opacity-90 active:scale-95" style={{ backgroundColor: accent, color: accentInk }}><Icon name="chat" size={14} /> Leggimi tutti</button>
              {ans.list.map((it) => (
                <button key={it.id} onClick={() => pickBooking(it.id)} className="group flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition" style={{ borderColor: panelBorder, background: softFill }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.background = hexA(accent, light ? 0.05 : 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = panelBorder; e.currentTarget.style.background = softFill; }}>
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-txt">{it.label}</span>{it.sub && <span className="block truncate text-[11px] text-faint">{it.sub}</span>}</span>
                  <span className="shrink-0 text-xs font-semibold transition-transform group-hover:translate-x-0.5" style={{ color: accent }}>Dettagli →</span>
                </button>
              ))}
            </div>
          )}
          {ans.go && <button onClick={() => router.push(ans.go!.href)} className="mt-4 ml-2.5 inline-flex rounded-full border px-4 py-2 text-xs font-semibold text-txt transition hover:bg-wash" style={{ borderColor: panelBorder }}>{ans.go.label} →</button>}
        </section>
      )}
    </div>
  );
}
