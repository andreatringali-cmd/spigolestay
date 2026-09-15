"use client";

import { useEffect, useMemo, useState } from "react";
import { eur } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type QData = {
  s?: string;        // nome struttura
  ci?: string; co?: string;
  ad?: number; ch?: number;
  rooms?: { name: string; amount: number }[];
  tot?: number;      // totale
  dep?: number;      // acconto € (0 = paga intero)
  gn?: string; ge?: string; // ospite nome/email
  oe?: string;       // email proprietario
  sid?: string; rt?: string; // riferimenti (per la conferma lato struttura)
  ref?: string;      // codice preventivo
  acct?: string;     // account Stripe Connect della struttura (incassa il proprietario)
  uid?: string;      // id utente del proprietario (destinatario della prenotazione)
};

const fmtDate = (iso?: string) => { if (!iso) return "—"; try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; } };

export default function PreventivoPubblico() {
  const [data, setData] = useState<QData | null>(null);
  const [state, setState] = useState<"view" | "paying" | "paid" | "error" | "noconfig">("view");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const sp = new URLSearchParams(window.location.search);
        let parsed: QData | null = null;
        const c = sp.get("c"), q = sp.get("q");
        // Link corto: /preventivo?c=<codice> → carico il preventivo dal server (tabella quotes).
        if (c && supabase) {
          const { data: row } = await supabase.from("quotes").select("data").eq("code", c).maybeSingle();
          if (row?.data) parsed = row.data as QData;
        }
        // Compatibilità: vecchi link con il payload in base64 (?q=…).
        if (!parsed && q) parsed = JSON.parse(decodeURIComponent(atob(q))) as QData;
        if (parsed) setData(parsed);
        const paid = sp.get("paid"), sid = sp.get("session_id");
        if (paid === "1" && sid) {
          setState("paid");
          fetch("/api/stripe/quote/confirm", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sid, acct: parsed?.acct ?? "" }),
          }).then((r) => r.json()).then((j) => { if (j?.error === "not_paid") setState("view"); }).catch(() => {});
        } else if (!parsed) { setMsg("Link non valido."); }
      } catch { setMsg("Link non valido."); }
    })();
  }, []);

  const nights = useMemo(() => { if (!data?.ci || !data?.co) return 0; return Math.max(0, Math.round((Date.parse(data.co) - Date.parse(data.ci)) / 86400000)); }, [data]);
  const payAmount = data ? (data.dep && data.dep > 0 ? data.dep : (data.tot ?? 0)) : 0;
  const balance = data ? Math.max(0, (data.tot ?? 0) - payAmount) : 0;

  const pay = async () => {
    if (!data) return;
    setState("paying"); setMsg("");
    try {
      const cur = new URLSearchParams(window.location.search);
      const idp = cur.get("c") ? `c=${encodeURIComponent(cur.get("c")!)}` : `q=${encodeURIComponent(cur.get("q") || "")}`;
      const url = window.location.href.split("?")[0] + "?" + idp;
      const res = await fetch("/api/stripe/quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: payAmount,
          label: `${data.s ?? "Prenotazione"} · ${fmtDate(data.ci)} → ${fmtDate(data.co)}`,
          email: data.ge,
          successUrl: url,
          cancelUrl: url,
          acct: data.acct ?? "",
          metadata: { sid: data.sid ?? "", rt: data.rt ?? "", ci: data.ci ?? "", co: data.co ?? "", ad: data.ad ?? "", ch: data.ch ?? "", tot: data.tot ?? "", dep: payAmount, gn: data.gn ?? "", ge: data.ge ?? "", oe: data.oe ?? "", ref: data.ref ?? "", uid: data.uid ?? "" },
        }),
      });
      if (res.status === 503) { setState("noconfig"); return; }
      const j = await res.json();
      if (j?.url) { window.location.href = j.url; return; }
      setState("error"); setMsg(j?.message || "Impossibile avviare il pagamento.");
    } catch { setState("error"); setMsg("Errore di rete."); }
  };

  const card = "w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-sm";
  const row = "flex items-baseline justify-between gap-3 py-1.5 text-sm";

  return (
    <div className="flex min-h-screen items-center justify-center bg-wash p-4" style={{ background: "var(--wash)" }}>
      <div className={card}>
        <div className="mb-1 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/xenora-mark.png" alt="" width={26} height={26} style={{ objectFit: "contain" }} />
          <span className="text-sm font-bold text-txt">{data?.s ?? "La tua prenotazione"}</span>
        </div>

        {state === "paid" ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full text-2xl text-white" style={{ backgroundColor: "var(--ok)" }}>✓</div>
            <h1 className="font-display text-xl font-bold text-txt">Prenotazione confermata</h1>
            <p className="mt-1 text-sm text-dim">Grazie{data?.gn ? `, ${data.gn.split(" ")[0]}` : ""}! Il pagamento è andato a buon fine e la struttura ha ricevuto la conferma.</p>
            {balance > 0 && <p className="mt-2 text-xs text-faint">Saldo residuo {eur(balance)} da versare in struttura.</p>}
          </div>
        ) : !data ? (
          <p className="py-8 text-center text-sm text-faint">{msg || "Caricamento…"}</p>
        ) : (
          <>
            <h1 className="mb-3 font-display text-xl font-bold text-txt">Conferma la tua prenotazione</h1>
            <div className="divide-y divide-[color:var(--line)]">
              <div className={row}><span className="text-dim">Check-in</span><span className="font-medium text-txt">{fmtDate(data.ci)}</span></div>
              <div className={row}><span className="text-dim">Check-out</span><span className="font-medium text-txt">{fmtDate(data.co)}</span></div>
              <div className={row}><span className="text-dim">Notti</span><span className="font-medium text-txt">{nights}</span></div>
              <div className={row}><span className="text-dim">Ospiti</span><span className="font-medium text-txt">{data.ad ?? 0} adulti{data.ch ? ` · ${data.ch} bambini` : ""}</span></div>
              {(data.rooms ?? []).map((r, i) => <div key={i} className={row}><span className="text-dim">{r.name}</span><span className="font-mono text-txt">{eur(r.amount)}</span></div>)}
            </div>
            <div className="mt-3 rounded-xl bg-wash px-4 py-3">
              <div className="flex items-baseline justify-between"><span className="text-sm font-semibold text-txt">Totale soggiorno</span><span className="font-mono text-lg font-bold text-txt">{eur(data.tot ?? 0)}</span></div>
              {payAmount !== (data.tot ?? 0) && <div className="mt-1 flex items-baseline justify-between text-sm"><span className="text-dim">Acconto ora</span><span className="font-mono font-semibold text-txt">{eur(payAmount)}</span></div>}
              {balance > 0 && <div className="mt-0.5 flex items-baseline justify-between text-xs"><span className="text-faint">Saldo in struttura</span><span className="font-mono text-faint">{eur(balance)}</span></div>}
            </div>

            {state === "noconfig" ? (
              <div className="mt-4 rounded-lg border border-line bg-paper p-3 text-sm text-dim">Il pagamento online non è ancora attivo. Contatta la struttura per completare la prenotazione.</div>
            ) : (
              <button onClick={pay} disabled={state === "paying"} className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "var(--focus)" }}>
                {state === "paying" ? "Avvio pagamento…" : `Conferma e paga ${eur(payAmount)}`}
              </button>
            )}
            {msg && state === "error" && <p className="mt-2 text-center text-xs" style={{ color: "var(--err)" }}>{msg}</p>}
            <p className="mt-3 text-center text-[11px] text-faint">Pagamento sicuro con Stripe · carta, PayPal, Klarna e altri metodi.</p>
          </>
        )}
      </div>
    </div>
  );
}
