"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { playSound } from "@/lib/sound";
import { PageHeader } from "@/components/ui";
import { useLang } from "@/lib/i18n";

interface Msg { id: string; dir: "out" | "in"; text: string; ts: number; via?: string }
type Threads = Record<string, Msg[]>;
const KEY = "spigolestay:threads:v1";
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));
const relTime = (ts: number, t: (s: string) => string) => { const d = Math.floor((Date.now() - ts) / 60000); if (d < 1) return t("adesso"); if (d < 60) return `${d} ${t("min fa")}`; if (d < 1440) return `${Math.floor(d / 60)} ${t("h fa")}`; return `${Math.floor(d / 1440)} ${t("g fa")}`; };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export default function ConversazioniPage() {
  const { bookings, guests, getStructure, activeStructureId } = useData();
  const { t } = useLang();
  const [threads, setThreads] = useState<Threads>({});
  const [ready, setReady] = useState(false);
  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setThreads(JSON.parse(r)); } catch {} setReady(true); }, []);
  useEffect(() => { if (!ready) return; try { localStorage.setItem(KEY, JSON.stringify(threads)); } catch {} }, [threads, ready]);

  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ospiti con almeno una prenotazione (nella struttura attiva), ordinati per attività thread poi per arrivo.
  const people = useMemo(() => {
    const map = new Map<string, { id: string; name: string; phone?: string; email?: string; struct: string; lastCheckIn: string }>();
    for (const b of bookings) {
      if (b.channel === "blocked" || b.status === "cancelled") continue;
      if (activeStructureId !== "all" && b.structureId !== activeStructureId) continue;
      const g = guests.find((x) => x.id === b.guestId); if (!g) continue;
      const cur = map.get(g.id);
      if (!cur || b.checkIn > cur.lastCheckIn) map.set(g.id, { id: g.id, name: g.fullName, phone: g.phone, email: g.email, struct: getStructure(b.structureId)?.name ?? "", lastCheckIn: b.checkIn });
    }
    let arr = [...map.values()];
    if (q.trim()) { const t = q.toLowerCase(); arr = arr.filter((p) => p.name.toLowerCase().includes(t)); }
    const lastTs = (id: string) => { const m = threads[id]; return m && m.length ? m[m.length - 1].ts : 0; };
    return arr.sort((a, b) => { const ta = lastTs(a.id), tb = lastTs(b.id); if (ta || tb) return tb - ta; return b.lastCheckIn.localeCompare(a.lastCheckIn); });
  }, [bookings, guests, activeStructureId, q, threads, getStructure]);

  const current = useMemo(() => {
    if (!sel) return null;
    const inList = people.find((p) => p.id === sel);
    if (inList) return inList;
    const g = guests.find((x) => x.id === sel);
    return g ? { id: g.id, name: g.fullName, phone: g.phone, email: g.email, struct: "", lastCheckIn: "" } : null;
  }, [sel, people, guests]);
  const msgs = sel ? threads[sel] ?? [] : [];
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [sel, msgs.length]);

  const add = (dir: "out" | "in", text: string, via?: string) => { if (!sel || !text.trim()) return; setThreads((t) => ({ ...t, [sel]: [...(t[sel] ?? []), { id: uid(), dir, text: text.trim(), ts: Date.now(), via }] })); playSound(dir === "out" ? "sent" : "received"); };

  const digits = (current?.phone ?? "").replace(/\D/g, "");
  const sendWa = () => { if (!draft.trim()) return; add("out", draft, "WhatsApp"); if (digits) window.open(`https://wa.me/${digits}?text=${encodeURIComponent(draft)}`, "_blank", "noopener"); setDraft(""); };
  const sendMail = () => { if (!draft.trim()) return; add("out", draft, "Email"); if (current?.email) window.open(`mailto:${current.email}?subject=${encodeURIComponent(t("Messaggio"))}&body=${encodeURIComponent(draft)}`, "_blank"); setDraft(""); };
  const logIn = () => { const text = draft.trim() || window.prompt(t("Testo della risposta ricevuta dall'ospite:")) || ""; if (text.trim()) { add("in", text, "manuale"); setDraft(""); } };

  return (
    <div>
      <PageHeader title={t("Conversazioni")} subtitle={t("Filo diretto con l'ospite · messaggi inviati e ricevuti in un unico thread")} />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Elenco */}
        <div className="flex max-h-[72vh] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line p-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cerca ospite…")} className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
          </div>
          <div className="flex-1 overflow-y-auto">
            {people.map((p) => {
              const th = threads[p.id] ?? []; const last = th[th.length - 1];
              return (
                <button key={p.id} onClick={() => setSel(p.id)} className={`flex w-full items-center gap-2.5 border-b border-line px-3 py-2.5 text-left last:border-0 ${sel === p.id ? "bg-wash" : "hover:bg-wash"}`}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-focus text-xs font-bold text-white">{initials(p.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-txt">{p.name}</span>{last && <span className="shrink-0 text-[10px] text-faint">{relTime(last.ts, t)}</span>}</span>
                    <span className="block truncate text-xs text-dim">{last ? `${last.dir === "out" ? `${t("Tu:")} ` : ""}${last.text}` : p.struct}</span>
                  </span>
                </button>
              );
            })}
            {people.length === 0 && <div className="px-3 py-6 text-center text-sm text-faint">{t("Nessun ospite.")}</div>}
          </div>
        </div>

        {/* Thread */}
        <div className="flex max-h-[72vh] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          {!current ? (
            <div className="grid flex-1 place-items-center p-8 text-center text-sm text-faint">{t("Seleziona un ospite per vedere la conversazione.")}</div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-focus text-xs font-bold text-white">{initials(current.name)}</span>
                <div className="min-w-0"><div className="truncate text-sm font-semibold text-txt">{current.name}</div><div className="truncate text-[11px] text-faint">{[current.phone, current.email].filter(Boolean).join(" · ") || t("nessun contatto")}</div></div>
              </div>
              <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-wash p-4">
                {msgs.length === 0 && <div className="mt-6 text-center text-xs text-faint">{t("Nessun messaggio. Scrivi qui sotto per iniziare.")}</div>}
                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.dir === "out" ? "rounded-br-md bg-focus text-white" : "rounded-bl-md border border-line bg-surface text-txt"}`}>
                      <div className="whitespace-pre-wrap break-words">{m.text}</div>
                      <div className={`mt-0.5 text-[10px] ${m.dir === "out" ? "text-white/70" : "text-faint"}`}>{relTime(m.ts, t)}{m.via ? ` · ${m.via}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-line p-2.5">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={t("Scrivi un messaggio…")} className="w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button onClick={sendWa} disabled={!draft.trim()} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40" style={{ backgroundColor: "#25D366" }}>{t("Invia")} WhatsApp</button>
                  <button onClick={sendMail} disabled={!draft.trim() || !current.email} className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">{t("Email")}</button>
                  <button onClick={logIn} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-dim hover:bg-wash" title={t("Registra una risposta arrivata dall'ospite")}>＋ {t("Risposta ricevuta")}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
