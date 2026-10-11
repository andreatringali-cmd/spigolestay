"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { decidiAvviso, puoRichiedere, INTERVALLO_RICHIESTA_MS, type RigaInvio } from "@/lib/invii-avviso";

// Striscia sobria in cima alla pagina: compare solo se l'ultimo invio automatico (pulizie, messaggi, promemoria check-in)
// degli ultimi 2 giorni è fallito. Si può chiudere: la chiusura vale finché non arriva un errore diverso.
// Al massimo una richiesta al server ogni 5 minuti (l'esito è tenuto anche nel browser, così cambiare pagina non rifà la richiesta).
const LAST_KEY = "xn-invii-avviso-last";   // { at: ms ultima richiesta, rows }
const CLOSED_KEY = "xn-invii-avviso-chiuso"; // chiave dell'errore chiuso

function readLast(uid: string): { at: number; rows: RigaInvio[] } | null {
  try { const v = JSON.parse(localStorage.getItem(LAST_KEY) || "null"); return v && v.uid === uid && Array.isArray(v.rows) ? v : null; } catch { return null; }
}
function readClosed(): string | null { try { return localStorage.getItem(CLOSED_KEY); } catch { return null; } }

export default function InviiAvviso() {
  const [rows, setRows] = useState<RigaInvio[]>([]);
  const [closed, setClosed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    setClosed(readClosed());
    const run = async () => {
      try {
        const session = (await supabase?.auth.getSession())?.data.session;
        const token = session?.access_token, uid = session?.user?.id;
        if (!token || !uid) return;
        const last = readLast(uid);
        if (last && !puoRichiedere(last.at, Date.now())) { if (alive) { setRows(last.rows); setNow(Date.now()); } return; }
        // Si registra il tentativo prima della risposta: anche se il server è in errore non si insiste prima di 5 minuti.
        try { localStorage.setItem(LAST_KEY, JSON.stringify({ uid, at: Date.now(), rows: last?.rows ?? [] })); } catch { /* storage pieno: nessun limite persistente */ }
        const r = await fetch("/api/invii-log?jobs=pulizie,messaggi,checkin", { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const j = await r.json() as { rows?: RigaInvio[] };
        const next = Array.isArray(j.rows) ? j.rows : [];
        try { localStorage.setItem(LAST_KEY, JSON.stringify({ uid, at: Date.now(), rows: next })); } catch { /* ignora */ }
        if (alive) { setRows(next); setNow(Date.now()); }
      } catch { /* senza rete: nessun avviso */ }
    };
    const first = setTimeout(run, 2500);
    const iv = setInterval(run, INTERVALLO_RICHIESTA_MS + 15000);
    return () => { alive = false; clearTimeout(first); clearInterval(iv); };
  }, []);

  const avviso = decidiAvviso(rows, now, closed);
  if (!avviso) return null;
  const chiudi = () => { try { localStorage.setItem(CLOSED_KEY, avviso.key); } catch { /* ignora */ } setClosed(avviso.key); };
  return (
    <div role="status" className="no-print mb-4 flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 12%, transparent)" }}>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-txt">{avviso.titolo}</div>
        <div className="text-xs text-dim">{avviso.motivo}</div>
      </div>
      <Link href={avviso.href} className="shrink-0 text-xs font-semibold text-focus hover:underline">{avviso.linkLabel}</Link>
      <button type="button" onClick={chiudi} aria-label="Chiudi l'avviso" className="shrink-0 rounded px-1.5 text-dim hover:bg-wash hover:text-txt">×</button>
    </div>
  );
}
