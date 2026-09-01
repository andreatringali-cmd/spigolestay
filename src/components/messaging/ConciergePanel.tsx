"use client";

import { useEffect, useRef, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";

interface FAQ { id: string; topic: string; keywords: string; answer: string }
const LANGS: [string, string][] = [["it", "🇮🇹"], ["en", "🇬🇧"], ["fr", "🇫🇷"], ["de", "🇩🇪"], ["es", "🇪🇸"]];
const GREET: Record<string, string> = { it: "Ciao! Sono l'assistente della struttura, come posso aiutarti?", en: "Hi! I'm the property assistant, how can I help?", fr: "Bonjour ! Je suis l'assistant, comment puis-je aider ?", de: "Hallo! Ich bin der Assistent, wie kann ich helfen?", es: "¡Hola! Soy el asistente, ¿cómo puedo ayudarte?" };
const NOANS: Record<string, string> = { it: "Giro la tua domanda al gestore, ti risponde a breve. Intanto posso aiutarti con check-in, Wi-Fi, parcheggio, colazione e cosa vedere a Ortigia.", en: "I'll forward your question to the host. Meanwhile I can help with check-in, Wi-Fi, parking, breakfast and what to see in Ortigia.", fr: "Je transmets votre question à l'hôte. En attendant : check-in, Wi-Fi, parking, petit-déjeuner, Ortigia.", de: "Ich leite deine Frage weiter. Ich helfe bei Check-in, WLAN, Parken, Frühstück und Ortigia.", es: "Reenvío tu pregunta al anfitrión. Mientras: check-in, Wi-Fi, parking, desayuno y Ortigia." };

const DEFAULT_FAQ: FAQ[] = [
  { id: "wifi", topic: "Wi-Fi", keywords: "wifi wi-fi internet password rete connessione", answer: "La rete Wi-Fi è «SpigoleGuest», password «ortigia2026». Copre tutta la struttura." },
  { id: "checkin", topic: "Check-in", keywords: "checkin check-in arrivo orario entrare codice ingresso chiavi", answer: "Il check-in è dalle 14:00. È self check-in: il giorno dell'arrivo ricevi il codice della serratura via messaggio." },
  { id: "checkout", topic: "Check-out", keywords: "checkout check-out partenza uscita orario lasciare", answer: "Il check-out è entro le 10:00. Lascia le chiavi/codice attivo, non serve altro." },
  { id: "parcheggio", topic: "Parcheggio", keywords: "parcheggio auto macchina posto sosta parking", answer: "Parcheggio libero nelle vie limitrofe; a 200 m c'è un parcheggio custodito (~12€/giorno)." },
  { id: "colazione", topic: "Colazione", keywords: "colazione breakfast mattina bar cornetto", answer: "Colazione servita 8:00–10:00 in sala, oppure convenzione con il bar sotto la struttura." },
  { id: "ortigia", topic: "Cosa vedere", keywords: "vedere visitare ortigia duomo fonte aretusa cosa fare attrazioni", answer: "Da non perdere: Duomo di Ortigia, Fonte Aretusa, Castello Maniace, mercato di Ortigia la mattina, e il Teatro Greco nel Parco della Neapolis." },
  { id: "spiagge", topic: "Spiagge", keywords: "spiaggia mare bagno spiagge fontane bianche", answer: "Le più belle: Cala Rossa e Fontane Bianche (15 min in auto). In Ortigia c'è la scaletta della Marina per un tuffo veloce." },
  { id: "ristoranti", topic: "Dove mangiare", keywords: "ristorante mangiare cena pizzeria dove pesce trattoria", answer: "Consigliati: trattorie di pesce sul mercato di Ortigia, e per la sera i locali di Via Cavour. Ti prenoto io un tavolo se vuoi." },
];

// Concierge AI: risponde da solo agli ospiti dalla base di conoscenza (tab di /messaggi).
export default function ConciergePanel() {
  const [lang, setLang] = useState("it");
  const [faq, setFaq] = useState<FAQ[]>([]);
  const [msgs, setMsgs] = useState<{ role: "guest" | "bot"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { try { const r = localStorage.getItem("spigolestay:concierge"); setFaq(r ? JSON.parse(r) : DEFAULT_FAQ); } catch { setFaq(DEFAULT_FAQ); } }, []);
  useEffect(() => { setMsgs([{ role: "bot", text: GREET[lang] }]); }, [lang]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);
  const persist = (n: FAQ[]) => { setFaq(n); try { localStorage.setItem("spigolestay:concierge", JSON.stringify(n)); } catch {} };

  const answer = (q: string): string => {
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    let best: FAQ | null = null, score = 0;
    for (const f of faq) {
      const keys = (f.keywords + " " + f.topic).toLowerCase();
      const s = words.reduce((a, w) => a + (keys.includes(w) ? 1 : 0), 0);
      if (s > score) { score = s; best = f; }
    }
    return score > 0 && best ? best.answer : NOANS[lang];
  };
  const send = (text?: string) => {
    const q = (text ?? input).trim(); if (!q) return;
    setMsgs((m) => [...m, { role: "guest", text: q }]);
    setInput("");
    setTimeout(() => setMsgs((m) => [...m, { role: "bot", text: answer(q) }]), 300);
  };

  const addFaq = () => { const f: FAQ = { id: String(Date.now()), topic: "Nuovo argomento", keywords: "", answer: "" }; persist([...faq, f]); setEditId(f.id); };
  const updFaq = (id: string, patch: Partial<FAQ>) => persist(faq.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const delFaq = (id: string) => persist(faq.filter((f) => f.id !== id));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      {/* Chat demo */}
      <Card className="order-2 flex flex-col">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Prova la chat</SectionTitle>
          <div className="flex items-center gap-0.5 rounded-lg border border-line p-0.5">
            {LANGS.map(([l, f]) => (<button key={l} onClick={() => setLang(l)} className={`rounded-md px-1.5 py-1 text-base leading-none transition ${lang === l ? "scale-110 bg-wash" : "opacity-50 grayscale hover:opacity-90"}`}>{f}</button>))}
          </div>
        </div>
        <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto rounded-xl border border-line bg-wash p-3" style={{ minHeight: 300, maxHeight: 420 }}>
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "guest" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.role === "guest" ? "bg-focus text-white" : "border border-line bg-surface text-txt"}`}>{m.text}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {faq.slice(0, 5).map((f) => (<button key={f.id} onClick={() => send(f.topic + "?")} className="rounded-full border border-line px-2.5 py-1 text-xs text-dim hover:bg-wash">{f.topic}</button>))}
        </div>
        <div className="mt-2 flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Scrivi una domanda…" className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
          <button onClick={() => send()} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Invia</button>
        </div>
      </Card>

      {/* Knowledge base */}
      <Card className="order-1 flex flex-col">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Base di conoscenza ({faq.length})</SectionTitle>
          <button onClick={addFaq} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash">+ Argomento</button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto" style={{ maxHeight: 460 }}>
          {faq.map((f) => (
            <div key={f.id} className="rounded-lg border border-line bg-paper p-2.5">
              {editId === f.id ? (
                <div className="space-y-1.5">
                  <input value={f.topic} onChange={(e) => updFaq(f.id, { topic: e.target.value })} placeholder="Argomento" className="w-full rounded border border-line bg-surface px-2 py-1 text-sm font-semibold text-txt outline-none focus:border-focus" />
                  <input value={f.keywords} onChange={(e) => updFaq(f.id, { keywords: e.target.value })} placeholder="parole chiave (separate da spazio)" className="w-full rounded border border-line bg-surface px-2 py-1 text-xs text-dim outline-none focus:border-focus" />
                  <textarea value={f.answer} onChange={(e) => updFaq(f.id, { answer: e.target.value })} rows={2} placeholder="Risposta" className="w-full resize-y rounded border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />
                  <div className="flex justify-end gap-2"><button onClick={() => delFaq(f.id)} className="text-xs text-faint hover:text-[color:var(--err)]">Elimina</button><button onClick={() => setEditId(null)} className="rounded bg-focus px-2.5 py-1 text-xs font-semibold text-white">Fatto</button></div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-txt">{f.topic}</div><div className="truncate text-xs text-dim">{f.answer}</div></div>
                  <button onClick={() => setEditId(f.id)} className="shrink-0 text-xs font-medium text-focus hover:underline">Modifica</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-faint"><Icon name="chat" size={12} /> In produzione il Concierge risponde da solo su <b className="text-dim">WhatsApp</b> e sul widget del sito, con AI generativa multilingua sulla tua base di conoscenza.</p>
      </Card>
    </div>
  );
}
