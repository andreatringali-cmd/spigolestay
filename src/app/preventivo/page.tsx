"use client";

import { useEffect, useMemo, useState } from "react";
import { eur } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type QData = {
  s?: string;        // nome struttura
  ci?: string; co?: string;
  ad?: number; ch?: number;
  rooms?: { name: string; amount: number }[];
  tot?: number;      // totale soggiorno
  dep?: number;      // acconto € sul soggiorno (0/assente = paga intero)
  gn?: string; ge?: string; // ospite nome/email
  oe?: string;       // email proprietario
  sid?: string; rt?: string; // riferimenti (per la conferma lato struttura)
  ref?: string;      // codice preventivo
  acct?: string;     // account Stripe Connect della struttura (incassa il proprietario)
  uid?: string;      // id utente del proprietario (destinatario della prenotazione)
  logo?: string;     // logo struttura (dataURL), se disponibile
  accent?: string;   // colore struttura, se disponibile
  // Servizi extra PROPONIBILI dalla struttura: l'ospite può aggiungerli qui, non sono ancora scelti.
  extras?: { id?: string; name: string; desc?: string; price: number; per?: string }[];
};

const fmtDate = (iso?: string) => { if (!iso) return "—"; try { return new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; } };
const PER_LABEL: Record<string, string> = { stay: "a soggiorno", night: "a notte", day: "a giornata", person: "a persona" };

export default function PreventivoPubblico() {
  const [data, setData] = useState<QData | null>(null);
  const [state, setState] = useState<"view" | "paying" | "paid" | "error" | "noconfig">("view");
  const [msg, setMsg] = useState("");
  // Servizi extra scelti dall'ospite su questa pagina: un sì/no per servizio (niente quantità,
  // il preventivo riguarda un unico soggiorno — se serve di più lo si concorda con la struttura).
  const [selectedExtras, setSelectedExtras] = useState<Record<number, boolean>>({});
  // Ospiti modificabili SOLO per aggiornare la scheda ospite/anagrafica alla conferma: non
  // ricalcolano il prezzo delle camere (cambierebbe la disponibilità/tariffa già concordata,
  // fuori scopo di questa pagina). Le DATE non sono modificabili per lo stesso motivo.
  const [adultsSel, setAdultsSel] = useState(1);
  const [childrenSel, setChildrenSel] = useState(0);

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
        if (parsed) {
          setData(parsed);
          setAdultsSel(Math.max(1, parsed.ad ?? 1));
          setChildrenSel(Math.max(0, parsed.ch ?? 0));
        }
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

  const extrasList = data?.extras ?? [];
  // Prezzo del singolo extra applicato al soggiorno: "a notte"/"a giornata" → per le notti,
  // "a persona" → per gli ospiti attuali (adulti+bambini), "a soggiorno" (o assente) → una tantum.
  const extraUnitPrice = (e: { price: number; per?: string }) => {
    if (e.per === "night" || e.per === "day") return e.price * Math.max(1, nights);
    if (e.per === "person") return e.price * Math.max(1, adultsSel + childrenSel);
    return e.price;
  };
  const extrasTotal = extrasList.reduce((sum, e, i) => sum + (selectedExtras[i] ? extraUnitPrice(e) : 0), 0);

  const roomTotal = data?.tot ?? 0;
  // L'acconto (se previsto) si applica SOLO al soggiorno, come deciso dal gestore nel preventivo.
  // I servizi extra aggiunti qui si pagano SEMPRE per intero e subito: così il saldo dovuto in
  // struttura resta esattamente quello concordato nel preventivo originale, senza sorprese.
  const stayPayNow = data ? (data.dep && data.dep > 0 ? data.dep : roomTotal) : 0;
  const payAmount = stayPayNow + extrasTotal;
  const grandTotal = roomTotal + extrasTotal;
  const balance = Math.max(0, roomTotal - stayPayNow);

  const pay = async () => {
    if (!data) return;
    setState("paying"); setMsg("");
    try {
      const cur = new URLSearchParams(window.location.search);
      const idp = cur.get("c") ? `c=${encodeURIComponent(cur.get("c")!)}` : `q=${encodeURIComponent(cur.get("q") || "")}`;
      const url = window.location.href.split("?")[0] + "?" + idp;
      // Extra scelti in formato compatto "Nome:Prezzo|Nome2:Prezzo2" (i metadata Stripe troncano
      // ogni valore a 480 caratteri: meglio omettere l'ultimo extra che troncarlo a metà).
      const extPairs = extrasList
        .map((e, i) => (selectedExtras[i] ? `${e.name.replace(/[|:]/g, " ").trim()}:${extraUnitPrice(e)}` : null))
        .filter((x): x is string => !!x);
      let extMeta = "";
      for (const p of extPairs) {
        const candidate = extMeta ? `${extMeta}|${p}` : p;
        if (candidate.length > 450) break;
        extMeta = candidate;
      }
      const res = await fetch("/api/stripe/quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: payAmount,
          label: `${data.s ?? "Prenotazione"} · ${fmtDate(data.ci)} → ${fmtDate(data.co)}`,
          email: data.ge,
          successUrl: url,
          cancelUrl: url,
          acct: data.acct ?? "",
          metadata: { sid: data.sid ?? "", rt: data.rt ?? "", ci: data.ci ?? "", co: data.co ?? "", ad: adultsSel, ch: childrenSel, tot: data.tot ?? "", dep: payAmount, gn: data.gn ?? "", ge: data.ge ?? "", oe: data.oe ?? "", ref: data.ref ?? "", uid: data.uid ?? "", ext: extMeta },
        }),
      });
      if (res.status === 503) { setState("noconfig"); return; }
      const j = await res.json();
      if (j?.url) { window.location.href = j.url; return; }
      setState("error"); setMsg(j?.message || "Impossibile avviare il pagamento.");
    } catch { setState("error"); setMsg("Errore di rete."); }
  };

  const card = "w-full rounded-2xl border border-line bg-surface p-6 shadow-sm";
  const row = "flex items-baseline justify-between gap-3 py-1.5 text-sm";
  const accent = data?.accent || undefined;

  return (
    <div className="min-h-screen py-8" style={{ background: "var(--wash)" }}>
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4">
        {/* Header */}
        <div className="flex items-center gap-3 px-1">
          {data?.logo
            ? /* eslint-disable-next-line @next/next/no-img-element */
              <img src={data.logo} alt="" width={44} height={44} style={{ objectFit: "contain", borderRadius: 10, background: "#fff", border: "1px solid var(--line)" }} />
            : /* eslint-disable-next-line @next/next/no-img-element */
              <img src="/xenora-mark.png" alt="" width={32} height={32} style={{ objectFit: "contain" }} />}
          <div>
            <div className="font-display text-base font-bold text-txt">{data?.s ?? "La tua prenotazione"}</div>
            {data?.ref && <div className="text-xs text-faint">Preventivo n. {data.ref}</div>}
          </div>
        </div>

        {state === "paid" ? (
          <div className={card}>
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full text-2xl text-white" style={{ backgroundColor: "var(--ok)" }}>✓</div>
              <h1 className="font-display text-xl font-bold text-txt">Prenotazione confermata</h1>
              <p className="mt-1 text-sm text-dim">Grazie{data?.gn ? `, ${data.gn.split(" ")[0]}` : ""}! Il pagamento è andato a buon fine e la struttura ha ricevuto la conferma.</p>
              {balance > 0 && <p className="mt-2 text-xs text-faint">Saldo residuo {eur(balance)} da versare in struttura.</p>}
            </div>
          </div>
        ) : !data ? (
          <div className={card}><p className="py-8 text-center text-sm text-faint">{msg || "Caricamento…"}</p></div>
        ) : (
          <>
            <h1 className="px-1 font-display text-2xl font-bold text-txt">Rivedi e conferma la tua prenotazione</h1>
            <p className="px-1 text-sm text-dim">Controlla i dati, aggiungi eventuali servizi e conferma con il pagamento in fondo alla pagina.</p>

            {/* Riepilogo soggiorno */}
            <div className={card}>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Il tuo soggiorno</div>
              <div className="divide-y divide-[color:var(--line)]">
                <div className={row}><span className="text-dim">Check-in</span><span className="font-medium text-txt">{fmtDate(data.ci)}</span></div>
                <div className={row}><span className="text-dim">Check-out</span><span className="font-medium text-txt">{fmtDate(data.co)}</span></div>
                <div className={row}><span className="text-dim">Notti</span><span className="font-medium text-txt">{nights}</span></div>
                <div className={`${row} !items-center`}>
                  <span className="text-dim">Ospiti</span>
                  <span className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-dim">Adulti
                      <input type="number" min={1} value={adultsSel} onChange={(e) => setAdultsSel(Math.max(1, Number(e.target.value) || 1))} className="w-12 rounded-md border border-line bg-paper px-1.5 py-1 text-center text-sm font-medium text-txt outline-none focus:border-focus" />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-dim">Bambini
                      <input type="number" min={0} value={childrenSel} onChange={(e) => setChildrenSel(Math.max(0, Number(e.target.value) || 0))} className="w-12 rounded-md border border-line bg-paper px-1.5 py-1 text-center text-sm font-medium text-txt outline-none focus:border-focus" />
                    </label>
                  </span>
                </div>
                {(data.rooms ?? []).map((r, i) => <div key={i} className={row}><span className="text-dim">{r.name}</span><span className="font-mono text-txt">{eur(r.amount)}</span></div>)}
              </div>
              <p className="mt-2 text-[11px] text-faint">Le date e le tariffe delle camere sono quelle del preventivo. Per modificarle contatta la struttura.</p>
            </div>

            {/* Servizi extra proposti dalla struttura */}
            {extrasList.length > 0 && (
              <div className={card}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Servizi extra</div>
                <p className="mb-3 text-xs text-dim">Rendi il soggiorno ancora più speciale: aggiungi ciò che desideri, si paga per intero insieme alla conferma.</p>
                <div className="divide-y divide-[color:var(--line)]">
                  {extrasList.map((e, i) => {
                    const on = !!selectedExtras[i];
                    const unit = extraUnitPrice(e);
                    return (
                      <label key={e.id ?? i} className="flex cursor-pointer items-start gap-3 py-3">
                        <input type="checkbox" checked={on} onChange={(ev) => setSelectedExtras((prev) => ({ ...prev, [i]: ev.target.checked }))} className="mt-0.5 h-4 w-4 accent-[color:var(--focus)]" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-txt">{e.name}</div>
                          {e.desc && <div className="mt-0.5 text-xs text-faint">{e.desc}</div>}
                          <div className="mt-0.5 text-xs text-dim">{eur(e.price)} {e.per ? (PER_LABEL[e.per] ?? e.per) : PER_LABEL.stay}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`font-mono text-sm font-semibold ${on ? "text-txt" : "text-faint"}`}>{eur(unit)}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Totali */}
            <div className={card}>
              <div className="rounded-xl bg-wash px-4 py-3">
                <div className="flex items-baseline justify-between text-sm"><span className="text-dim">Totale soggiorno</span><span className="font-mono font-semibold text-txt">{eur(roomTotal)}</span></div>
                {extrasTotal > 0 && <div className="mt-1 flex items-baseline justify-between text-sm"><span className="text-dim">Servizi extra selezionati</span><span className="font-mono font-semibold text-txt">{eur(extrasTotal)}</span></div>}
                <div className="mt-2 flex items-baseline justify-between border-t border-[color:var(--line)] pt-2"><span className="text-sm font-semibold text-txt">Totale prenotazione</span><span className="font-mono text-lg font-bold text-txt">{eur(grandTotal)}</span></div>
                {payAmount !== grandTotal && <div className="mt-1 flex items-baseline justify-between text-sm"><span className="text-dim">Da pagare ora</span><span className="font-mono font-semibold text-txt">{eur(payAmount)}</span></div>}
                {balance > 0 && <div className="mt-0.5 flex items-baseline justify-between text-xs"><span className="text-faint">Saldo in struttura</span><span className="font-mono text-faint">{eur(balance)}</span></div>}
              </div>

              {state === "noconfig" ? (
                <div className="mt-4 rounded-lg border border-line bg-paper p-3 text-sm text-dim">Il pagamento online non è ancora attivo. Contatta la struttura per completare la prenotazione.</div>
              ) : (
                <button onClick={pay} disabled={state === "paying"} className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: accent || "var(--focus)" }}>
                  {state === "paying" ? "Avvio pagamento…" : `Conferma e paga ${eur(payAmount)}`}
                </button>
              )}
              {msg && state === "error" && <p className="mt-2 text-center text-xs" style={{ color: "var(--err)" }}>{msg}</p>}
              <p className="mt-3 text-center text-[11px] text-faint">Pagamento sicuro con Stripe · carta, PayPal, Klarna e altri metodi.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
