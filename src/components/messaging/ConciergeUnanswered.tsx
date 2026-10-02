"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { apiPost } from "@/lib/invoicing/client";
import { CATEGORY_LABEL, CATEGORY_ORDER, classifyQuestion, kbLang, type ConciergeLang } from "@/lib/concierge-kb";
import type { UnansweredItem } from "@/lib/concierge-unanswered";

// "Domande a cui non ho saputo rispondere": le domande degli ospiti su WhatsApp a cui il Concierge non ha risposto
// (le registra il webhook, vedi src/lib/concierge-unanswered.ts), raggruppate per argomento semplice.
// "Aggiungi alla base" apre il modulo "Nuova voce" di ConciergeKb già precompilato.

export interface KbPrefill { nonce: number; title: string; category: string; lang: ConciergeLang }

const normQ = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const topicLabel = (c: string) => (c === "altro" ? "Altro" : CATEGORY_LABEL[c] ?? c);
const whenOf = (ts: number) => { try { return new Date(ts).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

interface Row { key: string; q: string; ids: string[]; count: number; ts: number; noBooking: boolean }
interface Group { cat: string; rows: Row[] }

export default function ConciergeUnanswered({ sid, onAdd, createdTick }: {
  sid: string;
  onAdd: (p: KbPrefill) => void;
  createdTick: number; // cresce quando ConciergeKb crea la voce nata da una domanda: quella domanda esce dall'elenco
}) {
  const [items, setItems] = useState<UnansweredItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const pending = useRef<{ nonce: number; ids: string[] } | null>(null);
  const nonce = useRef(0);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await apiPost<{ ok: boolean; items?: UnansweredItem[] }>("concierge/unanswered", { action: "list" });
      setItems(Array.isArray(r.items) ? r.items : []);
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore"); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const dismiss = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    setItems((cur) => cur.filter((x) => !ids.includes(x.id)));
    try { await apiPost("concierge/unanswered", { action: "dismiss", ids }); } catch (e) { setErr(e instanceof Error ? e.message : "Errore"); await load(); }
  }, [load]);

  // La voce nata da una domanda è stata creata: toglie quella domanda dall'elenco.
  const lastTick = useRef(createdTick);
  useEffect(() => {
    if (createdTick === lastTick.current) return;
    lastTick.current = createdTick;
    if (pending.current) { const p = pending.current; pending.current = null; dismiss(p.ids); }
  }, [createdTick, dismiss]);

  // Solo domande vere (non errori tecnici) di questa struttura o senza struttura, raggruppate per argomento; uguali = una riga.
  const { groups, tech } = useMemo(() => {
    const mine = items.filter((x) => x.sid === sid || x.sid === "");
    const real = mine.filter((x) => x.code !== "ai");
    const byQ = new Map<string, Row>();
    for (const it of real) {
      const key = normQ(it.q) || it.id;
      const cur = byQ.get(key);
      if (cur) { cur.ids.push(it.id); cur.count++; if (it.ts > cur.ts) { cur.ts = it.ts; cur.q = it.q; } cur.noBooking = cur.noBooking && it.hasBooking === false; }
      else byQ.set(key, { key, q: it.q, ids: [it.id], count: 1, ts: it.ts, noBooking: it.hasBooking === false });
    }
    const cats = new Map<string, Row[]>();
    for (const r of byQ.values()) { const c = classifyQuestion(r.q); (cats.get(c) ?? cats.set(c, []).get(c)!).push(r); }
    const order = [...CATEGORY_ORDER, "altro"];
    const gs: Group[] = [...cats.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([cat, rows]) => ({ cat, rows: rows.sort((a, b) => b.ts - a.ts) }));
    return { groups: gs, tech: mine.length - real.length };
  }, [items, sid]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  const add = (r: Row, cat: string) => {
    const t = r.q.replace(/[?!.\s]+$/g, "").trim().slice(0, 80);
    nonce.current += 1;
    pending.current = { nonce: nonce.current, ids: r.ids };
    onAdd({ nonce: nonce.current, title: t.charAt(0).toUpperCase() + t.slice(1), category: cat === "altro" ? "servizi" : cat, lang: kbLang(undefined, r.q) });
  };

  return (
    <Card className="mb-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Domande a cui non ho saputo rispondere{total ? ` (${total})` : ""}</SectionTitle>
        <button onClick={load} disabled={loading} className="mb-3 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50">{loading ? "Carico…" : "Aggiorna"}</button>
      </div>
      <p className="mb-3 text-[11px] text-faint">Domande arrivate su WhatsApp che il Concierge ha lasciato a te perché la base di conoscenza non le copre. Aggiungi la risposta e la prossima volta risponderà da solo.</p>
      {err && <div className="mb-3 rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--err) 12%, transparent)", color: "var(--err)" }}>{err}</div>}
      {!loading && !err && total === 0 && <p className="text-xs text-faint">Nessuna domanda in sospeso per questa struttura.</p>}
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.cat} className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{topicLabel(g.cat)} <span className="font-normal">({g.rows.length})</span></div>
            {g.rows.map((r) => (
              <div key={r.key} className="flex flex-wrap items-start gap-2 rounded-lg border border-line bg-paper p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-line text-sm text-txt">{r.q}</div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {whenOf(r.ts)}{r.count > 1 ? ` · chiesta ${r.count} volte` : ""}{r.noBooking ? " · senza prenotazione" : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 text-xs">
                  <button onClick={() => add(r, g.cat)} className="rounded-lg border border-line px-2.5 py-1 font-semibold text-focus hover:bg-wash">Aggiungi alla base</button>
                  <button onClick={() => dismiss(r.ids)} className="text-faint hover:text-[color:var(--err)]">Ignora</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {tech > 0 && <p className="mt-3 text-[11px] text-faint">Altre {tech} {tech === 1 ? "domanda non gestita" : "domande non gestite"} per un problema tecnico (AI non configurata o in errore): non sono mostrate qui.</p>}
    </Card>
  );
}
