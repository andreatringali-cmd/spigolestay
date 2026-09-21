"use client";

import { Suspense, useEffect, useMemo, useState } from "react";

// Pagina PUBBLICA di gestione prenotazione per l'ospite (link nell'email di conferma).
// Mostra riepilogo + condizioni di cancellazione e consente: annullare (con rimborso
// automatico se entro policy), richiedere una modifica date, fare il check-in / aggiungere extra.

const box = "rounded-xl border border-line bg-surface";
const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

const eur = (v: number, cur = "€") => `${cur} ${(v || 0).toLocaleString("it-IT")}`;
const fmtD = (iso?: string) => { if (!iso) return ""; try { return new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; } };

interface Info {
  booking: {
    code: string; status: string; checkIn: string; checkOut: string; adults: number; children: number;
    total: number; paid: number; roomType: string; ratePlan: string; refundable: boolean; cancelDays: number;
    cancelPolicy: string; free: boolean; freeUntil: string | null; canRefund: boolean;
    cancelledAt: string | null; refundedAmount: number; guestFirst: string;
  };
  structure: { name: string; color: string; phone: string; email: string; checkInFrom: string; checkOutBy: string; currency: string };
}

export default function GestisciPage() {
  return <Suspense fallback={null}><Engine /></Suspense>;
}

function Engine() {
  const params = useMemo(() => { try { const u = new URLSearchParams(window.location.search); return { slug: u.get("site") || "", b: u.get("b") || "" }; } catch { return { slug: "", b: "" }; } }, []);
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Azioni
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<null | { refunded: number; free: boolean }>(null);
  const [modOpen, setModOpen] = useState(false);
  const [modCi, setModCi] = useState("");
  const [modCo, setModCo] = useState("");
  const [modMsg, setModMsg] = useState("");
  const [modSent, setModSent] = useState(false);

  const load = async () => {
    if (!params.slug || !params.b) { setErr("Link non valido."); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/manage-booking?slug=${encodeURIComponent(params.slug)}&b=${encodeURIComponent(params.b)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setErr(j?.error === "not_found" ? "Prenotazione non trovata." : "Impossibile caricare la prenotazione."); setInfo(null); }
      else setInfo(j as Info);
    } catch { setErr("Errore di rete."); }
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const doCancel = async () => {
    setWorking(true);
    try {
      const r = await fetch("/api/manage-booking/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: params.slug, b: params.b }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) { setResult({ refunded: j.refunded || 0, free: !!j.free }); setConfirmCancel(false); await load(); }
      else setErr(j?.message || "Annullamento non riuscito.");
    } catch { setErr("Errore di rete."); }
    setWorking(false);
  };

  const doModify = async () => {
    setWorking(true);
    try {
      const r = await fetch("/api/manage-booking/modify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: params.slug, b: params.b, ci: modCi || undefined, co: modCo || undefined, message: modMsg || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) { setModSent(true); setModOpen(false); }
      else setErr(j?.error === "empty_request" ? "Indica le nuove date o scrivi un messaggio." : "Invio non riuscito.");
    } catch { setErr("Errore di rete."); }
    setWorking(false);
  };

  const accent = info?.structure.color || "#285f92";
  const header = (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: accent }}>{(info?.structure.name ?? "XN").slice(0, 2).toUpperCase()}</div>
        <div className="leading-tight"><div className="text-sm font-bold text-txt">{info?.structure.name ?? "Xenora"}</div><div className="text-[11px] text-faint">Gestione prenotazione</div></div>
      </div>
    </div>
  );

  if (loading) return <div className="min-h-full bg-wash">{header}<div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-dim">Carico la prenotazione…</div></div>;

  if (!info) return (
    <div className="min-h-full bg-wash">{header}
      <div className="mx-auto max-w-md px-4 py-16">
        <div className={`${box} p-6 text-center`}>
          <div className="text-3xl">🔎</div>
          <h1 className="mt-2 font-display text-lg font-bold text-txt">{err || "Prenotazione non trovata"}</h1>
          <p className="mt-1 text-sm text-dim">Usa il link ricevuto nell&apos;email di conferma. Se il problema persiste, contatta la struttura.</p>
        </div>
      </div>
    </div>
  );

  const b = info.booking;
  const st = info.structure;
  const cur = st.currency || "€";
  const cancelled = b.status === "cancelled";
  const nights = (() => { try { return Math.max(1, Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86400000)); } catch { return 1; } })();
  const balance = Math.max(0, (b.total || 0) - (b.paid || 0));
  const checkinUrl = `/checkin?site=${encodeURIComponent(params.slug)}&b=${encodeURIComponent(params.b)}`;

  return (
    <div className="min-h-full bg-wash pb-16">{header}
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* Riepilogo */}
        <div className={`${box} mb-4 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-display text-xl font-bold text-txt">Ciao {b.guestFirst || "ospite"}!</div>
              <div className="mt-0.5 text-sm text-dim">{b.roomType}{b.ratePlan ? ` · ${b.ratePlan}` : ""} · {b.adults} adulti{b.children ? ` · ${b.children} bambini` : ""} · {nights} {nights === 1 ? "notte" : "notti"}</div>
            </div>
            <div className="rounded-lg bg-wash px-3 py-1.5 text-right">
              <div className="text-[10px] uppercase tracking-wide text-faint">Codice</div>
              <div className="font-mono text-sm font-bold" style={{ color: accent }}>{b.code}</div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-paper px-4 py-3">
            <div><div className="text-[11px] text-faint">Check-in</div><div className="text-sm font-semibold text-txt">{fmtD(b.checkIn)}</div>{st.checkInFrom && <div className="text-[11px] text-faint">dalle {st.checkInFrom}</div>}</div>
            <div className="text-faint">→</div>
            <div className="text-right"><div className="text-[11px] text-faint">Check-out</div><div className="text-sm font-semibold text-txt">{fmtD(b.checkOut)}</div>{st.checkOutBy && <div className="text-[11px] text-faint">entro {st.checkOutBy}</div>}</div>
          </div>
          {(b.total > 0) && (
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-dim">Totale soggiorno</span><span className="font-mono text-txt">{eur(b.total, cur)}</span></div>
              {b.paid > 0 && <div className="flex justify-between"><span className="text-dim">Acconto versato</span><span className="font-mono" style={{ color: "var(--ok)" }}>−{eur(b.paid, cur)}</span></div>}
              {balance > 0 && <div className="flex justify-between border-t border-line pt-1"><span className="font-semibold text-txt">Saldo in struttura</span><span className="font-mono font-bold text-txt">{eur(balance, cur)}</span></div>}
            </div>
          )}
        </div>

        {/* Stato annullata */}
        {cancelled ? (
          <div className={`${box} p-5`}>
            <div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full text-white" style={{ backgroundColor: "var(--err)" }}>✕</span><h2 className="font-display text-lg font-bold text-txt">Prenotazione annullata</h2></div>
            <p className="mt-2 text-sm text-dim">Questa prenotazione è stata annullata{b.cancelledAt ? ` il ${fmtD(b.cancelledAt.slice(0, 10))}` : ""}.</p>
            <div className="mt-3 rounded-lg border border-line bg-paper px-4 py-3 text-sm">
              {b.refundedAmount > 0
                ? <span style={{ color: "var(--ok)" }}>Rimborso emesso: <b>{eur(b.refundedAmount, cur)}</b> — l&apos;importo torna sul metodo di pagamento entro 5–10 giorni lavorativi.</span>
                : <span className="text-dim">Nessun rimborso previsto per questa tariffa.</span>}
            </div>
          </div>
        ) : (
          <>
            {/* Condizioni di cancellazione */}
            <div className={`${box} mb-4 p-5`}>
              <h2 className="mb-1 font-display text-base font-bold text-txt">Condizioni di cancellazione</h2>
              <p className="text-sm text-dim">{b.cancelPolicy}</p>
              {b.refundable && b.freeUntil && (
                <div className="mt-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ backgroundColor: b.free ? "color-mix(in srgb, var(--ok) 12%, transparent)" : "color-mix(in srgb, var(--warn) 14%, transparent)", color: b.free ? "var(--ok)" : "var(--warn)" }}>
                  {b.free ? `✓ Puoi annullare gratis fino al ${fmtD(b.freeUntil)}.` : `La cancellazione gratuita è scaduta il ${fmtD(b.freeUntil)}.`}
                </div>
              )}
            </div>

            {result && (
              <div className="mb-4 rounded-lg px-4 py-3 text-sm font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 12%, transparent)", color: "var(--ok)" }}>
                {result.refunded > 0 ? `✓ Prenotazione annullata e rimborso di ${eur(result.refunded, cur)} emesso.` : "✓ Prenotazione annullata."}
              </div>
            )}
            {err && <div className="mb-4 rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)", color: "var(--err)" }}>{err}</div>}

            {/* Azioni */}
            <div className={`${box} p-5`}>
              <h2 className="mb-3 font-display text-base font-bold text-txt">Cosa vuoi fare?</h2>
              <div className="flex flex-col gap-2.5">
                <a href={checkinUrl} className="flex items-center justify-between rounded-lg border border-line bg-paper px-4 py-3 text-sm font-semibold text-txt hover:border-focus">
                  <span>📝 Check-in online / aggiungi servizi extra</span><span className="text-faint">→</span>
                </a>

                {!modSent ? (
                  <button onClick={() => setModOpen((v) => !v)} className="flex items-center justify-between rounded-lg border border-line bg-paper px-4 py-3 text-sm font-semibold text-txt hover:border-focus">
                    <span>📅 Richiedi modifica date</span><span className="text-faint">{modOpen ? "▾" : "→"}</span>
                  </button>
                ) : (
                  <div className="rounded-lg border border-line bg-paper px-4 py-3 text-sm" style={{ color: "var(--ok)" }}>✓ Richiesta di modifica inviata alla struttura. Ti risponderanno per confermare.</div>
                )}
                {modOpen && !modSent && (
                  <div className="rounded-lg border border-line bg-wash p-3">
                    <p className="mb-2 text-xs text-dim">La struttura verificherà la disponibilità e ti confermerà le nuove date (e l&apos;eventuale differenza di prezzo).</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-faint">Nuovo check-in<input type="date" value={modCi} onChange={(e) => setModCi(e.target.value)} className={`${field} mt-1`} /></label>
                      <label className="text-[11px] text-faint">Nuovo check-out<input type="date" value={modCo} onChange={(e) => setModCo(e.target.value)} className={`${field} mt-1`} /></label>
                    </div>
                    <textarea value={modMsg} onChange={(e) => setModMsg(e.target.value)} rows={2} placeholder="Messaggio (facoltativo): es. arriviamo un giorno dopo…" className={`${field} mt-2 resize-y`} />
                    <button onClick={doModify} disabled={working} className="mt-2 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{working ? "Invio…" : "Invia richiesta"}</button>
                  </div>
                )}

                {!confirmCancel ? (
                  <button onClick={() => { setConfirmCancel(true); setErr(""); }} className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-semibold hover:opacity-90" style={{ borderColor: "var(--err)", color: "var(--err)" }}>
                    <span>✕ Annulla prenotazione</span><span>→</span>
                  </button>
                ) : (
                  <div className="rounded-lg border p-3" style={{ borderColor: "var(--err)" }}>
                    <p className="text-sm font-semibold text-txt">Confermi l&apos;annullamento?</p>
                    <p className="mt-1 text-xs text-dim">
                      {b.canRefund
                        ? `Riceverai un rimborso automatico di ${eur(b.paid, cur)} sul metodo di pagamento usato.`
                        : b.paid > 0
                          ? "Questa tariffa non prevede rimborso: l'acconto versato non sarà restituito."
                          : "Nessun importo è stato pagato online."}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button onClick={doCancel} disabled={working} className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "var(--err)" }}>{working ? "Annullo…" : "Sì, annulla"}</button>
                      <button onClick={() => setConfirmCancel(false)} disabled={working} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-txt hover:bg-wash">Torna indietro</button>
                    </div>
                  </div>
                )}
              </div>

              {(st.phone || st.email) && (
                <div className="mt-4 border-t border-line pt-3 text-xs text-dim">
                  Hai bisogno d&apos;aiuto? Contatta la struttura{st.phone ? <> · <a href={`tel:${st.phone}`} className="text-focus hover:underline">{st.phone}</a></> : ""}{st.email ? <> · <a href={`mailto:${st.email}`} className="text-focus hover:underline">{st.email}</a></> : ""}.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
