"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/authsync";
import { ROOMS_PER_STRUCT, ROOM_OVERAGE, ANNUAL_OFF, TIERS, MODULES, ADDON_PRICE } from "@/lib/plans";
import QRCode from "qrcode";

export default function AbbonamentoPage() {
  const { t } = useLang();
  const { units, structures } = useData();
  const { user } = useAuth();
  const rooms = units.filter((u) => !u.outOfService).length;
  const nStruct = Math.max(1, structures.length);

  const [selectedTier, setSelectedTier] = useState<string>("basic");
  const [annual, setAnnual] = useState(false);
  const [refCode, setRefCode] = useState("");
  const [refCopied, setRefCopied] = useState(false);
  useEffect(() => {
    try {
      let c = localStorage.getItem("spigolestay:refcode");
      if (!c) { c = "XEN-" + Math.random().toString(36).slice(2, 8).toUpperCase(); localStorage.setItem("spigolestay:refcode", c); }
      setRefCode(c);
    } catch {}
  }, []);
  const refLink = typeof window !== "undefined" ? `${window.location.origin}/abbonamento?ref=${refCode}` : "";
  const [refQr, setRefQr] = useState("");
  useEffect(() => {
    if (!refLink) { setRefQr(""); return; }
    let alive = true;
    QRCode.toDataURL(refLink, { margin: 1, width: 320 }).then((d) => { if (alive) setRefQr(d); }).catch(() => { if (alive) setRefQr(""); });
    return () => { alive = false; };
  }, [refLink]);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [pendingTier, setPendingTier] = useState<string | null>(null);
  const [pendingAddon, setPendingAddon] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [stripeCustomer, setStripeCustomer] = useState<string | null>(null);
  useEffect(() => {
    try {
      const r = localStorage.getItem("spigolestay:plan") || localStorage.getItem("spigolestay:tier");
      const k = (r && TIERS.some((x) => x.key === r)) ? r : "basic";
      setSelectedTier(k);
      const m = localStorage.getItem("spigolestay:modules");
      if (m) setActive(JSON.parse(m));
      else { const tr = TIERS.find((x) => x.key === k)!; const next: Record<string, boolean> = {}; MODULES.forEach((mm) => { next[mm.key] = !!mm.core || tr.includes.includes(mm.key); }); setActive(next); }
    } catch {}
  }, []);
  const tier = TIERS.find((x) => x.key === selectedTier) ?? TIERS[0];

  const persistModules = (next: Record<string, boolean>) => { try { localStorage.setItem("spigolestay:modules", JSON.stringify(next)); window.dispatchEvent(new Event("spigolestay:modules")); } catch {} };
  const choose = (k: string) => {
    setSelectedTier(k);
    const tr = TIERS.find((x) => x.key === k); if (!tr) return;
    // Scegliere un piano azzera ai soli moduli inclusi (gli add-on si aggiungono dopo, esplicitamente).
    const next: Record<string, boolean> = {}; MODULES.forEach((m) => { next[m.key] = !!m.core || tr.includes.includes(m.key); });
    setActive(next); persistModules(next);
    try { localStorage.setItem("spigolestay:plan", k); localStorage.setItem("spigolestay:tier", k); } catch {}
  };
  const toggleAddon = (key: string) => {
    if (MODULES.find((m) => m.key === key)?.core || tier.includes.includes(key)) return;
    setActive((prev) => { const next = { ...prev, [key]: !prev[key] }; persistModules(next); return next; });
  };

  // Stripe: cliente salvato + gestione del ritorno dal pagamento.
  useEffect(() => {
    try { const c = localStorage.getItem("spigolestay:stripecustomer"); if (c) setStripeCustomer(c); } catch {}
    try {
      const sp = new URLSearchParams(window.location.search);
      const co = sp.get("checkout");
      if (co === "success") {
        const sid = sp.get("session_id");
        if (sid) {
          fetch(`/api/stripe/session?id=${encodeURIComponent(sid)}`)
            .then((r) => r.json())
            .then((d) => {
              if (d?.plan) choose(d.plan);
              if (d?.customerId) { try { localStorage.setItem("spigolestay:stripecustomer", d.customerId); } catch {} setStripeCustomer(d.customerId); }
              setNotice("Abbonamento attivato ✅ Grazie! La prova di 7 giorni è iniziata.");
            })
            .catch(() => setNotice("Pagamento ricevuto. Aggiornamento in corso…"));
        }
        history.replaceState(null, "", window.location.pathname);
      } else if (co === "cancel") {
        setNotice("Pagamento annullato: nessun addebito.");
        history.replaceState(null, "", window.location.pathname);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recupera il cliente Stripe dall'email se non è memorizzato: così l'app riconosce una carta
  // già salvata (anche aggiunta fuori dall'app) e il cambio piano non richiede un nuovo pagamento.
  useEffect(() => {
    if (stripeCustomer || !user?.email) return;
    let cancel = false;
    fetch(`/api/stripe/customer?email=${encodeURIComponent(user.email)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancel && d?.customerId) { setStripeCustomer(d.customerId); try { localStorage.setItem("spigolestay:stripecustomer", d.customerId); } catch {} } })
      .catch(() => {});
    return () => { cancel = true; };
  }, [user?.email, stripeCustomer]);

  const startCheckout = async (planKey: string) => {
    setNotice(null); setCheckoutBusy(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey, email: user?.email, userId: user?.id }),
      });
      if (res.status === 503) { choose(planKey); setNotice("Stripe non è ancora collegato: piano impostato in modalità demo. Aggiungi la chiave Stripe per i pagamenti reali."); return; }
      const d = await res.json().catch(() => ({}));
      if (d?.url) { window.location.href = d.url; return; }
      setNotice("Non è stato possibile avviare il pagamento. Riprova.");
    } catch {
      setNotice("Errore di rete durante l'avvio del pagamento.");
    } finally { setCheckoutBusy(false); }
  };

  const addons = MODULES.filter((m) => !m.core && !tier.includes.includes(m.key));
  const addedModules = addons.filter((m) => active[m.key]); // moduli extra non inclusi nel piano
  const isCustom = addedModules.length > 0;
  const addonsTotal = addedModules.reduce((a, m) => a + (ADDON_PRICE[m.key] || 0), 0);

  // Camere incluse e overage.
  const roomsIncluded = tier.structures * ROOMS_PER_STRUCT;
  const extraRooms = Math.max(0, rooms - roomsIncluded);
  const overStructures = nStruct > tier.structures;
  const monthlyBase = tier.price + addonsTotal + extraRooms * ROOM_OVERAGE;
  const perMonth = useMemo(() => (annual ? Math.round(monthlyBase * (1 - ANNUAL_OFF)) : monthlyBase), [annual, monthlyBase]);
  // Scorporo IVA (i prezzi mostrati sono IVA inclusa, 22%).
  const netMonth = Math.round(perMonth / 1.22);
  const vatMonth = perMonth - netMonth;

  // Il piano consigliato è sempre Pro (il più equilibrato per la maggior parte delle strutture).
  const suggested = "pro";

  return (
    <div>
      <PageHeader title={t("Abbonamento")} subtitle={t("Scegli il piano e aggiungi solo i moduli che ti servono")} />

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-line px-4 py-3 text-sm text-txt" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 8%, transparent)" }}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 text-faint hover:text-txt">✕</button>
        </div>
      )}

      {/* Riga: info prova + struttura/camere (a sinistra) · toggle mensile/annuale (a destra) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-faint">
          <span className="font-bold" style={{ color: "var(--focus)" }}>{nStruct} {t("struttura/e")} · {rooms} {t("camere attive")}</span> · {t("Prova gratuita 7 giorni · nessun costo di attivazione · disdici quando vuoi")}
        </p>
        <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface p-0.5 text-sm">
          <button onClick={() => setAnnual(false)} className={`rounded-md px-3 py-1 font-semibold transition ${!annual ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{t("Mensile")}</button>
          <button onClick={() => setAnnual(true)} className={`rounded-md px-3 py-1 font-semibold transition ${annual ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{t("Annuale")} <span className="text-[10px] font-bold text-[color:var(--ok)]">−20%</span></button>
        </div>
      </div>

      {/* Effetto riflesso/luce che scorre sulle card */}
      <style>{`.xn-active{transform:translateY(-6px);box-shadow:0 22px 46px -20px color-mix(in srgb,var(--focus) 58%,transparent),0 6px 16px -8px rgba(0,0,0,.18);position:relative;overflow:hidden}.xn-active::before{content:"";position:absolute;inset:0 0 auto 0;height:42%;background:linear-gradient(180deg,color-mix(in srgb,var(--focus) 16%,transparent) 0%,transparent 100%);pointer-events:none}.xn-active::after{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--focus) 70%,#fff),transparent);opacity:.7;animation:xnGloss 4.5s ease-in-out infinite;pointer-events:none}@keyframes xnGloss{0%,100%{opacity:.35}50%{opacity:.9}}@media (prefers-reduced-motion:reduce){.xn-active::after{animation:none}}`}</style>

      {/* Piani */}
      <div className="grid gap-3 lg:grid-cols-4">
        {TIERS.map((tr) => {
          const on = tr.key === tier.key;
          const price = annual ? Math.round(tr.price * (1 - ANNUAL_OFF)) : tr.price;
          const adds = MODULES.filter((m) => !m.core && tr.includes.includes(m.key));
          return (
            <div key={tr.key} className={`flex flex-col rounded-xl border p-4 transition ${on ? "xn-active border-focus bg-surface ring-2 ring-[color:var(--focus)]" : "border-line hover:shadow-md"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg font-bold text-txt">{tr.name}</span>
                {on ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase text-focus">{t("Attivo")}</span>
                  : tr.key === suggested ? <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-bold uppercase text-dim">{t("Consigliato")}</span> : null}
              </div>
              <div className="mt-0.5 text-xs text-dim">{t(tr.tagline)}</div>
              <div className="mt-3 font-mono text-3xl font-bold text-txt">{eur(price)}<span className="text-xs font-normal text-dim">{t("/mese")}</span></div>
              <div className="text-[11px] text-faint">{t("IVA inclusa")} · {t("netto")} {eur(Math.round((price / 1.22) * 100) / 100)} + {t("IVA")} {eur(Math.round((price - price / 1.22) * 100) / 100)}</div>
              <div className="mt-1 text-[11px] text-faint">{tr.structures === 1 ? t("1 struttura") : `${t("fino a")} ${tr.structures} ${t("strutture")}`} · {t("6 camere incluse per struttura")}</div>
              <ul className="mt-3 flex-1 space-y-1 text-[12px] text-dim">
                {tr.key !== "basic" && <li className="font-semibold text-txt">{t("Tutto")} {TIERS[TIERS.findIndex((x) => x.key === tr.key) - 1].name}, {t("più:")}</li>}
                {(tr.key === "basic" ? adds : adds.filter((m) => !TIERS[TIERS.findIndex((x) => x.key === tr.key) - 1].includes.includes(m.key))).slice(0, 8).map((m) => (
                  <li key={m.key} className="flex items-start gap-1.5"><span className="text-[color:var(--ok)]">✓</span>{t(m.name)}</li>
                ))}
              </ul>
              <button onClick={() => setPendingTier(tr.key)} disabled={on} className={`mt-4 rounded-lg py-2 text-sm font-semibold transition ${on ? "cursor-default border border-line text-dim" : "bg-focus text-white hover:opacity-90"}`}>{on ? t("Piano attivo") : t("Scegli")} {tr.name}</button>
            </div>
          );
        })}

        {/* Su misura */}
        <div className="flex flex-col rounded-xl border border-dashed border-line p-4">
          <span className="font-display text-lg font-bold text-txt">{t("Su misura")}</span>
          <div className="mt-0.5 text-xs text-dim">{t("Catene · oltre 8 strutture")}</div>
          <div className="mt-3 font-display text-2xl font-bold text-txt">{t("Contattaci")}</div>
          <div className="mt-1 text-[11px] text-faint">{t("Strutture e camere su richiesta")}</div>
          <ul className="mt-3 flex-1 space-y-1 text-[12px] text-dim">
            <li className="flex items-start gap-1.5"><span className="text-[color:var(--ok)]">✓</span>{t("Tutto Ultimate")}</li>
            <li className="flex items-start gap-1.5"><span className="text-[color:var(--ok)]">✓</span>{t("Account manager dedicato")}</li>
            <li className="flex items-start gap-1.5"><span className="text-[color:var(--ok)]">✓</span>{t("White-label e API")}</li>
          </ul>
          <a href="mailto:sales@xenora.app?subject=Piano%20Su%20misura" className="mt-4 rounded-lg border border-focus py-2 text-center text-sm font-semibold text-focus transition hover:bg-wash">{t("Parla con noi")}</a>
        </div>
      </div>


      {/* Cosa include ogni piano */}
      <Card className="mt-6">
        <SectionTitle>{t("Cosa include ogni piano")}</SectionTitle>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-2 py-2 font-semibold">{t("Modulo")}</th>
                {TIERS.map((tr) => <th key={tr.key} className="px-2 py-2 text-center font-semibold">{tr.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.key} className="border-b border-line last:border-0">
                  <td className="px-2 py-2"><div className="text-sm font-medium text-txt">{t(m.name)}</div><div className="text-[11px] text-faint">{t(m.desc)}</div></td>
                  {TIERS.map((tr) => {
                    const inc = m.core || tr.includes.includes(m.key);
                    return <td key={tr.key} className="px-2 py-2 text-center">{inc ? <span className="text-[color:var(--ok)]">✓</span> : <span className="text-faint">🔒</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Moduli aggiuntivi (à la carte) */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>{t("Moduli aggiuntivi")}</SectionTitle>
          {addonsTotal > 0 && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] px-3 py-1 text-xs font-semibold text-focus">+{eur(addonsTotal)}{t("/mese")}</span>}
        </div>
        <p className="mb-3 mt-1 text-xs text-dim">{t("Aggiungi singoli moduli al piano")} <b className="text-txt">{tier.name}</b> {t("senza salire di fascia. Se ti servono più moduli, spesso conviene passare al piano superiore.")}</p>
        {addons.length === 0 ? (
          <p className="rounded-lg border border-line bg-wash px-3 py-4 text-center text-sm text-dim">{t("Il piano")} {tier.name} {t("include già tutti i moduli. 🎉")}</p>
        ) : (
          <div className="divide-y divide-line">
            {addons.map((m) => {
              const on = !!active[m.key];
              return (
                <div key={m.key} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-txt">{t(m.name)}</div>
                    <div className="text-[11px] text-faint">{t(m.desc)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-semibold text-txt">+{eur(ADDON_PRICE[m.key] || 0)}<span className="text-[10px] font-normal text-faint">{t("/mese")}</span></div>
                  </div>
                  <button onClick={() => setPendingAddon(m.key)} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${on ? "bg-[color:color-mix(in_srgb,var(--ok)_16%,transparent)] text-[color:var(--ok)]" : "border border-line text-txt hover:bg-wash"}`}>{on ? `${t("Attivo")} ✓` : t("Aggiungi")}</button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Riepilogo + Invita un amico su 2 colonne */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-stretch">
      {/* Invita un amico · reward-hero */}
      <div className="overflow-hidden rounded-2xl border p-5 lg:order-2" style={{ borderColor: "color-mix(in srgb, var(--focus) 35%, var(--line))", background: "linear-gradient(135deg, color-mix(in srgb, var(--focus) 10%, var(--surface)), var(--surface))" }}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          {/* Messaggio + azioni */}
          <div className="min-w-0">
            <SectionTitle>{t("Programma invita & guadagna")}</SectionTitle>
            <h3 className="mt-1 font-display text-3xl font-bold leading-tight text-txt sm:text-4xl">{t("Regala Xenora,")}<br /><span style={{ color: "var(--focus)" }}>{t("ottieni 1 mese gratis")}</span></h3>
            <p className="mt-1.5 max-w-sm text-sm text-dim">{t("Il mese gratis scatta quando l'amico, finita la prova, si abbona col tuo codice.")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(`Provo Xenora per gestire il mio B&B, dai un'occhiata: ${refLink}`)}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90" style={{ backgroundColor: "#25D366" }}>💬 WhatsApp</a>
              <button onClick={() => window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent("Ti invito su Xenora")}&body=${encodeURIComponent(`Ciao! Uso Xenora per gestire il mio B&B (prenotazioni, channel manager, guida ospiti). Provalo con il mio invito: ${refLink}`)}`, "_blank", "noopener,noreferrer")} className="flex items-center gap-1.5 rounded-lg bg-focus px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90">✉ Email</button>
              <button onClick={() => { navigator.clipboard?.writeText(refLink); setRefCopied(true); window.setTimeout(() => setRefCopied(false), 1500); }} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-txt transition hover:bg-wash">{refCopied ? t("Copiato ✓") : t("Copia link")}</button>
            </div>
          </div>
          {/* QR + codice + statistiche */}
          <div className="shrink-0 text-center">
            {refQr && <img src={refQr} alt="QR" title={t("Fai scansionare questo QR all'amico")} className="mx-auto h-28 w-28 rounded-xl border border-line bg-white p-2 shadow-sm" />}
            <div className="mt-2 inline-block rounded-lg border border-focus bg-surface px-3 py-1 text-center ring-1 ring-[color:var(--focus)]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{t("Codice")} </span><span className="font-mono text-sm font-bold text-txt">{refCode}</span>
            </div>
            <div className="mt-3 flex justify-center gap-2">
              <div className="rounded-lg border border-line bg-surface px-3 py-1.5 text-center"><div className="font-mono text-lg font-bold text-txt">0</div><div className="text-[9px] uppercase tracking-wide text-faint">{t("Amici")}</div></div>
              <div className="rounded-lg border border-line bg-surface px-3 py-1.5 text-center"><div className="font-mono text-lg font-bold" style={{ color: "var(--focus)" }}>0</div><div className="text-[9px] uppercase tracking-wide text-faint">{t("Mesi gratis")}</div></div>
            </div>
          </div>
        </div>

        {/* Come funziona · 3 passi */}
        <div className="mt-5 grid grid-cols-1 gap-2 border-t border-line pt-4 sm:grid-cols-3" style={{ borderColor: "color-mix(in srgb, var(--focus) 20%, var(--line))" }}>
          {([["📤", t("1. Condividi"), t("Manda il codice o il QR all'amico")], ["🧪", t("2. Prova gratis"), t("L'amico si registra e prova Xenora")], ["🎁", t("3. Mese gratis"), t("Quando si abbona, ricevi 1 mese")]] as [string, string, string][]).map(([ic, ti, de]) => (
            <div key={ti} className="flex items-start gap-2.5 rounded-lg bg-surface/60 px-3 py-2">
              <span className="text-lg leading-none" aria-hidden>{ic}</span>
              <div><div className="text-xs font-semibold text-txt">{ti}</div><div className="text-[11px] leading-snug text-dim">{de}</div></div>
            </div>
          ))}
        </div>
      </div>

      {/* Riepilogo abbonamento */}
      <div className="lg:order-1">
        <Card>
          <SectionTitle>{t("Il tuo abbonamento")}</SectionTitle>
          <div className="mb-3 rounded-lg border border-line bg-wash p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Piano attivo")}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-display text-base font-bold text-txt">{tier.name}{isCustom ? ` ${t("personalizzato")}` : ""}{annual ? ` · ${t("annuale")}` : ` · ${t("mensile")}`}</span>
              {isCustom && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 16%, transparent)", color: "var(--focus)" }}>+{addedModules.length} {t("extra")}</span>}
              <span className="text-[11px] text-dim">· {t("Prossimo rinnovo")}: <b className="font-semibold text-txt">{(() => { const d = new Date(); if (annual) d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1, 1); return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }); })()}</b></span>
            </div>
            {isCustom && <div className="mt-2 flex flex-wrap gap-1">{addedModules.map((m) => <span key={m.key} className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: "color-mix(in srgb, var(--focus) 40%, var(--line))", color: "var(--focus)" }}>{m.name}</span>)}</div>}
          </div>
          <div className="flex justify-between text-sm"><span className="text-dim">{t("Piano")} {tier.name}</span><span className="font-mono text-txt">{eur(annual ? Math.round(tier.price * (1 - ANNUAL_OFF)) : tier.price)}</span></div>
          {addonsTotal > 0 && <div className="mt-1.5 flex justify-between text-sm"><span className="font-semibold text-[color:var(--focus)]">{t("Moduli aggiuntivi")} ({addedModules.length}) <span className="font-normal text-faint">· {t("non inclusi nel piano")}</span></span><span className="font-mono font-semibold text-[color:var(--focus)]">{eur(annual ? Math.round(addonsTotal * (1 - ANNUAL_OFF)) : addonsTotal)}</span></div>}
          {extraRooms > 0 && <div className="mt-1.5 flex justify-between text-sm"><span className="text-dim">{extraRooms} {t("camere extra")} × {eur(ROOM_OVERAGE)}</span><span className="font-mono text-txt">{eur(annual ? Math.round(extraRooms * ROOM_OVERAGE * (1 - ANNUAL_OFF)) : extraRooms * ROOM_OVERAGE)}</span></div>}
          <div className="mt-2 text-[11px] text-faint">{t("Importi IVA inclusa (22%)")}</div>
          <div className="mt-2 border-t border-line pt-3">
            <div className="flex justify-between text-sm"><span className="text-dim">{t("Imponibile")}</span><span className="font-mono text-txt">{eur(netMonth)}</span></div>
            <div className="mt-1 flex justify-between text-sm"><span className="text-dim">{t("IVA")} 22%</span><span className="font-mono text-txt">{eur(vatMonth)}</span></div>
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
              <span className="text-sm font-semibold text-txt">{t("Totale / mese")} <span className="font-normal text-faint">({t("IVA inclusa")})</span></span>
              <span className="font-mono text-2xl font-bold text-txt">{eur(perMonth)}</span>
            </div>
          </div>
          {annual && <div className="mt-1 text-right text-[11px] text-[color:var(--ok)]">{t("fatturato annualmente")} ({eur(perMonth * 12)}/{t("anno")})</div>}
          {overStructures && <div className="mt-3 rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--warn)" }}>{t("Hai")} {nStruct} {t("strutture: superi il piano")} {tier.name}. {t("Passa a un piano superiore o «Su misura».")}</div>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/abbonamento/pagamento" className="rounded-lg border border-line py-2 text-center text-sm font-semibold text-txt hover:bg-wash">{t("Informazioni pagamento")}</Link>
            <Link href="/abbonamento/fatture" className="rounded-lg border border-line py-2 text-center text-sm font-semibold text-txt hover:bg-wash">{t("Fatture")}</Link>
          </div>
        </Card>
      </div>
      </div>

      <p className="mt-4 text-xs text-faint">{t("Ogni piano include 6 camere per struttura; le camere in più costano")} {eur(ROOM_OVERAGE)}{t("/camera/mese. I prezzi si intendono per mese; con la fatturazione annuale risparmi il 20%.")}</p>

      {/* Conferma cambio piano */}
      {pendingTier && (() => {
        const pt = TIERS.find((x) => x.key === pendingTier)!;
        const up = TIERS.findIndex((x) => x.key === pendingTier) > TIERS.findIndex((x) => x.key === tier.key);
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setPendingTier(null)}>
            <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="font-display text-lg font-bold text-txt">{up ? t("Passa al piano") : t("Cambia nel piano")} {pt.name}</div>
              <p className="mt-1 text-sm text-dim">{t("Vuoi confermare il cambio di piano?")}</p>
              <div className="mt-3 space-y-1 rounded-lg border border-line bg-wash p-3 text-sm">
                <div className="flex justify-between"><span className="text-dim">{t("Da")}</span><span className="font-semibold text-txt">{tier.name} · {eur(tier.price)}{t("/mese")}</span></div>
                <div className="flex justify-between"><span className="text-dim">{t("A")}</span><span className="font-semibold text-txt">{pt.name} · {eur(annual ? Math.round(pt.price * (1 - ANNUAL_OFF)) : pt.price)}{t("/mese")}</span></div>
                <div className="flex justify-between"><span className="text-dim">{t("Strutture")}</span><span className="text-txt">{pt.structures === 1 ? t("1 struttura") : `${t("fino a")} ${pt.structures}`}</span></div>
              </div>
              <div className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-snug" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 9%, transparent)", color: "var(--dim)" }}>
                <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: "var(--focus)" }}>i</span>
                <span>{stripeCustomer ? t("Hai già una carta salvata: il nuovo piano si attiva dal prossimo rinnovo, senza nuovo pagamento. L'addebito aggiornato parte dal prossimo mese.") : t("Il piano si attiva con un pagamento (prova gratuita di 7 giorni). Puoi disdire quando vuoi.")}</span>
              </div>
              <p className="mt-2 text-[11px] text-faint">{t("I moduli attivi verranno riportati a quelli inclusi nel piano; gli eventuali add-on li riaggiungi dopo.")}</p>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setPendingTier(null)} className="flex-1 rounded-lg border border-line py-2 text-sm font-semibold text-txt hover:bg-wash">{t("Annulla")}</button>
                <button disabled={checkoutBusy} onClick={() => { const k = pendingTier!; if (stripeCustomer) { choose(k); setPendingTier(null); setNotice(`${t("Piano aggiornato a")} ${pt.name} — ${t("attivo dal prossimo rinnovo, senza nuovo pagamento (usiamo la carta salvata).")}`); } else { setPendingTier(null); startCheckout(k); } }} className="flex-1 rounded-lg bg-focus py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">{checkoutBusy ? t("Attendi…") : (stripeCustomer ? t("Conferma cambio") : t("Vai al pagamento"))}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Conferma attivazione/rimozione add-on */}
      {pendingAddon && (() => {
        const m = MODULES.find((x) => x.key === pendingAddon)!;
        const on = !!active[pendingAddon];
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setPendingAddon(null)}>
            <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="font-display text-lg font-bold text-txt">{on ? t("Rimuovere il modulo?") : t("Attivare il modulo?")}</div>
              <div className="mt-3 rounded-lg border border-line bg-wash p-3">
                <div className="text-sm font-semibold text-txt">{t(m.name)}</div>
                <div className="text-[11px] text-faint">{t(m.desc)}</div>
                {!on && <div className="mt-2 font-mono text-sm font-semibold text-txt">+{eur(ADDON_PRICE[pendingAddon] || 0)}<span className="text-[10px] font-normal text-faint">{t("/mese")}</span></div>}
              </div>
              <p className="mt-2 text-[11px] text-faint">{on ? t("Il modulo verrà disattivato e tolto dal totale mensile.") : t("Il modulo verrà aggiunto al tuo piano e al totale mensile.")}</p>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setPendingAddon(null)} className="flex-1 rounded-lg border border-line py-2 text-sm font-semibold text-txt hover:bg-wash">{t("Annulla")}</button>
                <button onClick={() => { toggleAddon(pendingAddon!); setPendingAddon(null); }} className={`flex-1 rounded-lg py-2 text-sm font-semibold text-white hover:opacity-90`} style={{ backgroundColor: on ? "var(--err)" : "var(--focus)" }}>{on ? t("Rimuovi") : t("Attiva")}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
