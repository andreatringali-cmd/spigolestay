"use client";

import { useEffect, useMemo, useState } from "react";
import { eur } from "@/lib/format";
import { fmtDMY } from "@/lib/dates";
import { dateLocale } from "@/lib/guest-i18n";
import { GuestLangPicker, useGuestLang } from "@/components/GuestLang";
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
  lang?: string;     // lingua del preventivo (it/en/fr/de/es), se il gestore l'ha salvata
  // Facoltativi (se la fonte li fornisce): preventivo già pagato / scaduto → niente pulsante di pagamento.
  paid?: boolean; status?: string; validUntil?: string;
  // Servizi extra PROPONIBILI dalla struttura: l'ospite può aggiungerli qui, non sono ancora scelti.
  extras?: { id?: string; name: string; desc?: string; price: number; per?: string }[];
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}/;
// Giorno della settimana calcolato in UTC (come nelle email): con il fuso del browser (es. Americhe) una data "2026-10-17" scivolerebbe al giorno prima.
const weekdayOf = (iso: string, locale: string): string => { try { return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" }); } catch { return ""; } };
const todayIso = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function PreventivoPubblico() {
  const [data, setData] = useState<QData | null>(null);
  const [state, setState] = useState<"view" | "paying" | "paid" | "checking" | "confirmErr" | "error" | "noconfig" | "already">("view");
  const [msg, setMsg] = useState("");
  const [msgKey, setMsgKey] = useState(""); // messaggio in italiano da tradurre (le chiavi note); il testo del server NON si mostra tradotto a metà
  const [sessionRef, setSessionRef] = useState("");
  // Lingua: scelta a mano > ?lang= > lingua del preventivo > browser > italiano.
  const { lang, setLang, t } = useGuestLang(data?.lang);
  const locale = dateLocale(lang);
  const fmtD = (iso?: string) => (iso && ISO_RE.test(iso) ? `${weekdayOf(iso, locale)} ${fmtDMY(iso)}`.trim() : iso || "—");
  const PER_LABEL: Record<string, string> = { stay: t("a soggiorno"), night: t("a notte"), day: t("a giornata"), person: t("a persona") };
  // Servizi extra scelti dall'ospite su questa pagina: un sì/no per servizio (niente quantità,
  // il preventivo riguarda un unico soggiorno — se serve di più lo si concorda con la struttura).
  const [selectedExtras, setSelectedExtras] = useState<Record<number, boolean>>({});
  // Ospiti modificabili SOLO per aggiornare la scheda ospite/anagrafica alla conferma: non
  // ricalcolano il prezzo delle camere (cambierebbe la disponibilità/tariffa già concordata,
  // fuori scopo di questa pagina). Le DATE non sono modificabili per lo stesso motivo.
  const [adultsSel, setAdultsSel] = useState(1);
  const [childrenSel, setChildrenSel] = useState(0);

  const confirmPayment = async (sid: string, acct: string) => {
    setState("checking");
    setSessionRef(sid.slice(-8));
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch("/api/stripe/quote/confirm", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sid, acct }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok === true) { setState("paid"); return; } // la conferma compare SOLO con l'esito positivo del server
        if (j?.error === "not_paid" && attempt < 3) { await sleep(2500); continue; } // l'incasso può arrivare qualche secondo dopo
        if (!r.ok && r.status >= 500 && attempt < 3) { await sleep(2000); continue; }
        break;
      } catch { if (attempt < 3) { await sleep(2000); continue; } }
    }
    setState("confirmErr");
  };

  useEffect(() => {
    (async () => {
      try {
        const sp = new URLSearchParams(window.location.search);
        let parsed: QData | null = null;
        const c = sp.get("c"), q = sp.get("q");
        // Link corto: /preventivo?c=<codice> → carico il preventivo tramite la funzione get_quote,
        // che restituisce SOLO il preventivo corrispondente al codice. La tabella quotes non è più
        // leggibile in blocco dall'API pubblica (niente enumerazione dei preventivi altrui).
        if (c && supabase) {
          const { data: qd } = await supabase.rpc("get_quote", { p_code: c });
          if (qd) parsed = (Array.isArray(qd) ? qd[0] : qd) as QData;
        }
        // Compatibilità: vecchi link con il payload in base64 (?q=…). Quel payload NON è firmato: il server lo riconvalida sempre
        // (importo, struttura e conto Stripe vengono dai dati veri del proprietario), qui serve solo a mostrare la proposta.
        if (!parsed && q) parsed = JSON.parse(decodeURIComponent(atob(q))) as QData;
        if (parsed) {
          setData(parsed);
          setAdultsSel(Math.max(1, parsed.ad ?? 1));
          setChildrenSel(Math.max(0, parsed.ch ?? 0));
        }
        const paid = sp.get("paid"), sid = sp.get("session_id");
        if (paid === "1" && sid) void confirmPayment(sid, parsed?.acct ?? "");
        else if (!parsed) { setMsgKey("Link non valido."); }
      } catch { setMsgKey("Link non valido."); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const quoteCode = useMemo(() => { try { return new URLSearchParams(window.location.search).get("c") || ""; } catch { return ""; } }, []);
  const roomTotal = data?.tot ?? 0;
  // Preventivo salvato sul server (?c=): il pagamento online vale solo se c'è un acconto > 0 (altrimenti si salda in struttura). Vecchi link (?q=): 0 = paga l'intero.
  const hasDeposit = !!data?.dep && data.dep > 0;
  // L'acconto (se previsto) si applica SOLO al soggiorno, come deciso dal gestore nel preventivo.
  // I servizi extra aggiunti qui si pagano SEMPRE per intero e subito: così il saldo dovuto in
  // struttura resta esattamente quello concordato nel preventivo originale, senza sorprese.
  const stayPayNow = data ? (hasDeposit ? (data.dep as number) : quoteCode ? 0 : roomTotal) : 0;
  const payAmount = stayPayNow + extrasTotal;
  const grandTotal = roomTotal + extrasTotal;
  const balance = Math.max(0, roomTotal - stayPayNow);

  // Perché NON si può pagare da questa pagina (mai un pulsante "Conferma e paga" che poi fallisce).
  const payBlock = useMemo<string | null>(() => {
    if (!data) return null;
    const st = String(data.status || "").toLowerCase();
    if (data.paid === true || st === "paid" || st === "confirmed" || st === "pagato") return "Questo preventivo risulta già confermato e pagato.";
    if (st === "expired" || st === "scaduto" || (data.validUntil && ISO_RE.test(data.validUntil) && data.validUntil.slice(0, 10) < todayIso())) return "Questo preventivo è scaduto: chiedi alla struttura un nuovo link.";
    if (!data.acct) return "Il pagamento online non è ancora attivo. Contatta la struttura per completare la prenotazione.";
    if (quoteCode && !hasDeposit) return "Questo preventivo non prevede un pagamento online: l'importo si salda direttamente in struttura.";
    if (!(payAmount > 0)) return "Questo preventivo non prevede un pagamento online: l'importo si salda direttamente in struttura.";
    return null;
  }, [data, quoteCode, hasDeposit, payAmount]);

  const pay = async () => {
    if (!data || payBlock) return;
    setState("paying"); setMsg(""); setMsgKey("");
    try {
      const cur = new URLSearchParams(window.location.search);
      const idp = cur.get("c") ? `c=${encodeURIComponent(cur.get("c")!)}` : `q=${encodeURIComponent(cur.get("q") || "")}`;
      const url = window.location.href.split("?")[0] + "?" + idp;
      // Extra scelti in formato compatto "Nome:Prezzo|Nome2:Prezzo2" (i metadata Stripe troncano
      // ogni valore a 480 caratteri: meglio omettere l'ultimo extra che troncarlo a metà). Serve ai vecchi link (?q=).
      const extPairs = extrasList
        .map((e, i) => (selectedExtras[i] ? `${e.name.replace(/[|:]/g, " ").trim()}:${extraUnitPrice(e)}` : null))
        .filter((x): x is string => !!x);
      let extMeta = "";
      for (const p of extPairs) {
        const candidate = extMeta ? `${extMeta}|${p}` : p;
        if (candidate.length > 450) break;
        extMeta = candidate;
      }
      // Con il codice (?c=) il server ricava importo, conto e prezzi dal preventivo salvato: dal browser servono solo gli extra scelti (indici) e gli ospiti.
      const pickedIdx = extrasList.map((_, i) => i).filter((i) => selectedExtras[i]);
      const res = await fetch("/api/stripe/quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: cur.get("c") || undefined,
          extras: pickedIdx,
          adults: adultsSel, children: childrenSel,
          lang, locale: lang,
          amount: payAmount,
          label: `${data.s ?? t("Prenotazione")} · ${fmtDMY(data.ci)} → ${fmtDMY(data.co)}`,
          email: data.ge,
          successUrl: url,
          cancelUrl: url,
          acct: data.acct ?? "",
          metadata: { sid: data.sid ?? "", rt: data.rt ?? "", ci: data.ci ?? "", co: data.co ?? "", ad: adultsSel, ch: childrenSel, tot: data.tot ?? "", dep: payAmount, gn: data.gn ?? "", ge: data.ge ?? "", oe: data.oe ?? "", ref: data.ref ?? "", uid: data.uid ?? "", ext: extMeta },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (j?.url) { window.location.href = j.url; return; }
      const code = String(j?.error || "");
      if (res.status === 503 || code === "stripe_not_configured" || code === "stripe_not_connected" || code === "stripe_not_active") { setState("noconfig"); return; }
      if (code === "already_confirmed") { setState("already"); return; }
      setState("error");
      setMsgKey(
        code === "no_online_payment" ? "Questo preventivo non prevede un pagamento online: l'importo si salda direttamente in struttura."
          : code === "quote_not_found" ? "Preventivo non trovato: chiedi alla struttura un nuovo link."
            : res.status === 429 || code === "troppe_richieste" ? "Troppi tentativi ravvicinati. Attendi un minuto e riprova."
              : ["invalid_quote", "invalid_structure", "bad_dates", "price_mismatch", "invalid_amount"].includes(code) ? "Preventivo non valido: chiedi alla struttura un nuovo link."
                : "Impossibile avviare il pagamento.",
      );
    } catch { setState("error"); setMsgKey("Errore di rete."); }
  };

  const card = "w-full rounded-2xl border border-line bg-surface p-6 shadow-sm";
  const row = "flex items-baseline justify-between gap-3 py-1.5 text-sm";
  const accent = data?.accent || undefined;
  const shownMsg = msgKey ? t(msgKey) : msg;

  return (
    <div className="min-h-dvh py-8" style={{ background: "var(--wash)" }}>
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 px-1">
          {data?.logo
            ? /* eslint-disable-next-line @next/next/no-img-element */
              <img src={data.logo} alt="" width={44} height={44} style={{ objectFit: "contain", borderRadius: 10, background: "#fff", border: "1px solid var(--line)" }} />
            : /* eslint-disable-next-line @next/next/no-img-element */
              <img src="/xenora-mark.png" alt="" width={32} height={32} style={{ objectFit: "contain" }} />}
          <div className="min-w-0">
            <div className="font-display text-base font-bold text-txt">{data?.s ?? t("La tua prenotazione")}</div>
            {data?.ref && <div className="text-xs text-faint">{t("Preventivo n. {ref}", { ref: data.ref })}</div>}
          </div>
          <div className="ml-auto"><GuestLangPicker lang={lang} setLang={setLang} label={t("Lingua")} /></div>
        </div>

        {state === "checking" ? (
          <div className={card} role="status">
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-[color:var(--line)] border-t-[color:var(--focus)]" aria-hidden />
              <h1 className="font-display text-xl font-bold text-txt">{t("Stiamo verificando il pagamento…")}</h1>
              <p className="mt-1 text-sm text-dim">{t("Ci vuole qualche secondo: non chiudere questa pagina.")}</p>
            </div>
          </div>
        ) : state === "confirmErr" ? (
          <div className={card} role="alert">
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full text-2xl font-bold text-white" style={{ backgroundColor: "var(--warn)" }}>!</div>
              <h1 className="font-display text-xl font-bold text-txt">{t("Non riusciamo ancora a confermare la prenotazione")}</h1>
              <p className="mt-2 text-sm text-dim">{t("Il pagamento potrebbe essere andato a buon fine, ma non abbiamo ancora potuto registrare la prenotazione. Non pagare di nuovo: riprova tra un istante oppure contatta la struttura indicando questo riferimento.")}</p>
              <p className="mt-2 font-mono text-sm font-bold text-txt">{sessionRef}</p>
              <button onClick={() => { const sid = new URLSearchParams(window.location.search).get("session_id"); if (sid) void confirmPayment(sid, data?.acct ?? ""); }} className="mt-4 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Riprova")}</button>
            </div>
          </div>
        ) : state === "paid" ? (
          <div className={card}>
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full text-2xl text-white" style={{ backgroundColor: "var(--ok)" }}>✓</div>
              <h1 className="font-display text-xl font-bold text-txt">{t("Prenotazione confermata")}</h1>
              <p className="mt-1 text-sm text-dim">{data?.gn ? t("Grazie, {name}! Il pagamento è andato a buon fine e la struttura ha ricevuto la conferma.", { name: data.gn.split(" ")[0] }) : t("Grazie! Il pagamento è andato a buon fine e la struttura ha ricevuto la conferma.")}</p>
              {balance > 0 && <p className="mt-2 text-xs text-faint">{t("Saldo residuo {amount} da versare in struttura.", { amount: eur(balance) })}</p>}
            </div>
          </div>
        ) : state === "already" ? (
          <div className={card}>
            <p className="py-8 text-center text-sm text-dim">{t("Questo preventivo risulta già confermato e pagato.")}</p>
          </div>
        ) : !data ? (
          <div className={card}><p className="py-8 text-center text-sm text-faint">{shownMsg || t("Caricamento…")}</p></div>
        ) : (
          <>
            <h1 className="px-1 font-display text-2xl font-bold text-txt">{t("Rivedi e conferma la tua prenotazione")}</h1>
            <p className="px-1 text-sm text-dim">{t("Controlla i dati, aggiungi eventuali servizi e conferma con il pagamento in fondo alla pagina.")}</p>

            {/* Riepilogo soggiorno */}
            <div className={card}>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">{t("Il tuo soggiorno")}</div>
              <div className="divide-y divide-[color:var(--line)]">
                <div className={row}><span className="text-dim">{t("Check-in")}</span><span className="font-medium text-txt">{fmtD(data.ci)}</span></div>
                <div className={row}><span className="text-dim">{t("Check-out")}</span><span className="font-medium text-txt">{fmtD(data.co)}</span></div>
                <div className={row}><span className="text-dim">{t("Notti")}</span><span className="font-medium text-txt">{nights}</span></div>
                <div className={`${row} !flex-wrap !items-center`}>
                  <span className="text-dim">{t("Ospiti")}</span>
                  <span className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-dim">{t("Adulti")}
                      <input type="number" inputMode="numeric" min={1} max={30} value={adultsSel} onChange={(e) => setAdultsSel(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} className="w-14 rounded-md border border-line bg-paper px-1.5 py-1 text-center text-base font-medium text-txt outline-none focus:border-focus sm:w-12 sm:text-sm" />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-dim">{t("Bambini")}
                      <input type="number" inputMode="numeric" min={0} max={30} value={childrenSel} onChange={(e) => setChildrenSel(Math.min(30, Math.max(0, Number(e.target.value) || 0)))} className="w-14 rounded-md border border-line bg-paper px-1.5 py-1 text-center text-base font-medium text-txt outline-none focus:border-focus sm:w-12 sm:text-sm" />
                    </label>
                  </span>
                </div>
                {(data.rooms ?? []).map((r, i) => <div key={i} className={row}><span className="text-dim">{r.name}</span><span className="font-mono text-txt">{eur(r.amount)}</span></div>)}
              </div>
              <p className="mt-2 text-[11px] text-faint">{t("Le date e le tariffe delle camere sono quelle del preventivo. Per modificarle contatta la struttura.")}</p>
            </div>

            {/* Servizi extra proposti dalla struttura */}
            {extrasList.length > 0 && !payBlock && (
              <div className={card}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{t("Servizi extra")}</div>
                <p className="mb-3 text-xs text-dim">{t("Rendi il soggiorno ancora più speciale: aggiungi ciò che desideri, si paga per intero insieme alla conferma.")}</p>
                <div className="divide-y divide-[color:var(--line)]">
                  {extrasList.map((e, i) => {
                    const on = !!selectedExtras[i];
                    const unit = extraUnitPrice(e);
                    return (
                      <label key={e.id ?? i} className="flex cursor-pointer items-start gap-3 py-3">
                        <input type="checkbox" checked={on} onChange={(ev) => setSelectedExtras((prev) => ({ ...prev, [i]: ev.target.checked }))} className="mt-0.5 h-5 w-5 accent-[color:var(--focus)]" />
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
                <div className="flex items-baseline justify-between text-sm"><span className="text-dim">{t("Totale soggiorno")}</span><span className="font-mono font-semibold text-txt">{eur(roomTotal)}</span></div>
                {extrasTotal > 0 && <div className="mt-1 flex items-baseline justify-between text-sm"><span className="text-dim">{t("Servizi extra selezionati")}</span><span className="font-mono font-semibold text-txt">{eur(extrasTotal)}</span></div>}
                <div className="mt-2 flex items-baseline justify-between border-t border-[color:var(--line)] pt-2"><span className="text-sm font-semibold text-txt">{t("Totale prenotazione")}</span><span className="font-mono text-lg font-bold text-txt">{eur(grandTotal)}</span></div>
                {!payBlock && payAmount !== grandTotal && <div className="mt-1 flex items-baseline justify-between text-sm"><span className="text-dim">{t("Da pagare ora")}</span><span className="font-mono font-semibold text-txt">{eur(payAmount)}</span></div>}
                {!payBlock && balance > 0 && <div className="mt-0.5 flex items-baseline justify-between text-xs"><span className="text-faint">{t("Saldo in struttura")}</span><span className="font-mono text-faint">{eur(balance)}</span></div>}
              </div>

              {state === "noconfig" || payBlock ? (
                <div className="mt-4 rounded-lg border border-line bg-paper p-3 text-sm text-dim">{payBlock ? t(payBlock) : t("Il pagamento online non è ancora attivo. Contatta la struttura per completare la prenotazione.")}</div>
              ) : (
                <button onClick={pay} disabled={state === "paying"} className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: accent || "var(--focus)" }}>
                  {state === "paying" ? t("Avvio pagamento…") : t("Conferma e paga {amount}", { amount: eur(payAmount) })}
                </button>
              )}
              {shownMsg && state === "error" && <p role="alert" className="mt-2 text-center text-xs" style={{ color: "var(--err)" }}>{shownMsg}</p>}
              {!payBlock && state !== "noconfig" && <p className="mt-3 text-center text-[11px] text-faint">{t("Pagamento sicuro con Stripe · carta, PayPal, Klarna e altri metodi.")}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
