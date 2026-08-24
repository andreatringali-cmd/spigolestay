"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const TIERS = [
  { key: "basic", name: "Basic", max: 5, price: 29, desc: "1 struttura · strumenti base", includes: ["pms", "cm", "cassa"] },
  { key: "pro", name: "Pro", max: 15, price: 49, desc: "Multi-struttura · strumenti di marketing", includes: ["pms", "cm", "cassa", "booking", "site", "concierge", "housekeeping", "messaging"] },
  { key: "enterprise", name: "Enterprise", max: 30, price: 89, desc: "Multi-struttura · funzioni avanzate", includes: ["pms", "cm", "cassa", "booking", "site", "concierge", "housekeeping", "messaging", "team", "bi", "rms", "ratecheck"] },
  { key: "premium", name: "Premium", max: Infinity, price: 149, desc: "Camere illimitate · tutto incluso", includes: ["pms", "cm", "cassa", "booking", "site", "concierge", "housekeeping", "messaging", "team", "bi", "rms", "ratecheck", "meta"] },
];

interface Module { key: string; name: string; desc: string; price: number; href: string; core?: boolean; plus?: boolean; }
const MODULES: Module[] = [
  { key: "pms", name: "PMS", desc: "Prenotazioni, calendario, camere, ospiti, Alloggiati Web + ISTAT e tassa di soggiorno.", price: 0, core: true, href: "/prenotazioni" },
  { key: "cm", name: "Channel Manager", desc: "Connessione ai portali OTA (Booking, Airbnb, Expedia…) con sincronizzazione prezzi e disponibilità.", price: 15, href: "/canali" },
  { key: "cassa", name: "Cassa · Prima Nota", desc: "Entrate e uscite, pagamenti ricorrenti, saldo per conto e analisi. Le entrate arrivano dalle prenotazioni.", price: 12, href: "/cassa", plus: true },
  { key: "booking", name: "Booking Engine", desc: "Motore prenotazioni sul tuo sito, senza commissioni.", price: 9, href: "/widget" },
  { key: "site", name: "Sito web", desc: "Mini-sito integrato con il motore prenotazioni.", price: 9, href: "/sito" },
  { key: "concierge", name: "Web Concierge", desc: "Preventivi e offerte personalizzati, upsell e check-in online.", price: 8, href: "/preventivi" },
  { key: "housekeeping", name: "Housekeeping", desc: "Planning pulizie giornaliero per camera, note e invio su WhatsApp a chi pulisce.", price: 8, href: "/pulizie" },
  { key: "messaging", name: "Automazioni & messaggi", desc: "Messaggi automatici agli ospiti (WhatsApp/email): benvenuto, check-in, recensione.", price: 7, href: "/messaggi", plus: true },
  { key: "team", name: "Utenti & permessi", desc: "Multi-utente con permessi granulari a 3 livelli, ruoli, turni, notifiche e limiti operativi.", price: 5, href: "/utenti", plus: true },
  { key: "rms", name: "Revenue · prezzi dinamici", desc: "Suggerimenti di prezzo in base a occupazione ed eventi.", price: 10, href: "/revenue" },
  { key: "ratecheck", name: "Rate checker", desc: "Confronto tariffe con i competitor.", price: 25, href: "/rate-checker" },
  { key: "bi", name: "Business Intelligence", desc: "Report avanzati e statistiche sui tuoi dati.", price: 12, href: "/statistiche" },
  { key: "meta", name: "Meta Search", desc: "Connessione ai principali metasearch (Google, Trivago…).", price: 0, href: "/metasearch" },
];

const INVOICES = [
  { id: "2026-08", date: "01/08/2026", amount: 49, status: "Pagata" },
  { id: "2026-07", date: "01/07/2026", amount: 49, status: "Pagata" },
  { id: "2026-06", date: "01/06/2026", amount: 49, status: "Pagata" },
];

export default function AbbonamentoPage() {
  const { t } = useLang();
  const { units } = useData();
  const rooms = units.filter((u) => !u.outOfService).length;
  const autoTier = TIERS.find((t) => rooms <= t.max) ?? TIERS[TIERS.length - 1];

  // Piano scelto (o automatico in base alle camere) + moduli attivi, salvati nel browser.
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const tier = TIERS.find((t) => t.key === selectedTier) ?? autoTier;
  const [active, setActive] = useState<Record<string, boolean>>({ pms: true, cm: true, booking: true, concierge: true });
  const chooseTier = (k: string) => {
    setSelectedTier(k);
    const t = TIERS.find((x) => x.key === k);
    if (t) {
      const next: Record<string, boolean> = {};
      MODULES.forEach((m) => { next[m.key] = !!m.core || t.includes.includes(m.key); });
      setActive(next);
      try { localStorage.setItem("spigolestay:modules", JSON.stringify(next)); } catch {}
    }
    try { localStorage.setItem("spigolestay:tier", k); } catch {}
  };
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:tier"); if (r) setSelectedTier(r); } catch {} }, []);
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:modules"); if (r) setActive(JSON.parse(r)); } catch {} }, []);
  const toggle = (m: Module) => {
    if (m.core) return;
    setActive((prev) => { const next = { ...prev, [m.key]: !prev[m.key] }; try { localStorage.setItem("spigolestay:modules", JSON.stringify(next)); } catch {} return next; });
  };

  const modulesTotal = MODULES.reduce((a, m) => a + (!m.core && active[m.key] ? m.price : 0), 0);
  const total = tier.price + modulesTotal;

  // Etichetta versione: piano puro o personalizzato (+ extra / − rimossi).
  const extras = MODULES.filter((m) => !m.core && active[m.key] && !tier.includes.includes(m.key));
  const missing = MODULES.filter((m) => !m.core && tier.includes.includes(m.key) && !active[m.key]);
  const custom = extras.length > 0 || missing.length > 0;
  const versionDetail = [extras.length ? `+ ${extras.map((m) => t(m.name)).join(", ")}` : "", missing.length ? `− ${missing.map((m) => t(m.name)).join(", ")}` : ""].filter(Boolean).join("   ");

  return (
    <div>
      <PageHeader title={t("Abbonamento")} subtitle={t("Versione, moduli e fatture")} />

      {/* Versione */}
      <Card className="mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>{t("Versione")}</SectionTitle>
          <span className="rounded-full bg-wash px-3 py-1 text-xs font-medium text-dim">{rooms} {t("camere attive · prezzo su questa base")}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tr) => {
            const on = tr.key === tier.key;
            const suggested = tr.key === autoTier.key;
            return (
              <button key={tr.key} onClick={() => chooseTier(tr.key)} className={`rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${on ? "border-focus ring-2 ring-[color:var(--focus)]" : "border-line"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-lg font-bold text-txt">{tr.name}</span>
                  {on ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase text-focus">{t("Attivo")}</span>
                    : suggested ? <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-bold uppercase text-dim">{t("Consigliato")}</span> : null}
                </div>
                <div className="mt-0.5 text-xs text-dim">{t(tr.desc)}</div>
                <div className="mt-2 text-[11px] text-faint">{tr.max === Infinity ? t("Camere illimitate") : `${t("Fino a")} ${tr.max} ${t("camere")}`}</div>
                <div className="mt-3 font-mono text-2xl font-bold text-txt">{eur(tr.price)}<span className="text-xs font-normal text-dim">{t("/30gg")}</span></div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Moduli */}
      <Card className="mb-5">
        <SectionTitle>{t("Moduli")}</SectionTitle>
        <div className="flex flex-col divide-y divide-[color:var(--line)]">
          {MODULES.map((m) => {
            const on = m.core || active[m.key];
            return (
              <div key={m.key} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-txt">{t(m.name)}</span>
                    {m.core && <span className="rounded bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-dim">{t("Incluso")}</span>}
                    {m.plus && <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 15%, transparent)", color: "var(--focus)" }}>{t("Esclusiva")}</span>}
                    {!m.core && tier.includes.includes(m.key) && <span className="rounded bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-dim">{t("nel piano")} {tier.name}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-dim">{t(m.desc)}</div>
                  {on && <Link href={m.href} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-focus hover:underline">{t("Apri la sezione")} →</Link>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-semibold text-txt">{m.price > 0 ? `${eur(m.price)}${t("/30gg")}` : m.core ? "—" : t("Gratis")}</div>
                  <button
                    onClick={() => toggle(m)}
                    disabled={m.core}
                    title={on ? t("Attivo") : t("Non attivo")}
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-default"
                    style={on
                      ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }
                      : { backgroundColor: "color-mix(in srgb, var(--err) 14%, transparent)", color: "var(--err)" }}
                  >
                    <span className="grid h-4 w-4 place-items-center rounded-full text-[10px] text-white" style={{ backgroundColor: on ? "var(--ok)" : "var(--err)" }}>{on ? "✓" : "×"}</span>
                    {on ? t("Attivo") : t("Attiva")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Totale + Fatture */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <SectionTitle>{t("Il tuo abbonamento")}</SectionTitle>
          <div className={`mb-3 rounded-lg border p-3 ${custom ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_7%,transparent)]" : "border-line bg-wash"}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{custom ? t("Versione personalizzata") : t("Versione attiva")}</div>
            <div className="mt-0.5 font-display text-base font-bold text-txt">{t("Piano")} {tier.name}{custom ? ` ${t("personalizzato")}` : ""}</div>
            {custom && <div className="mt-1 text-xs text-dim">{versionDetail}</div>}
          </div>
          <div className="flex justify-between text-sm"><span className="text-dim">{t("Versione")} {tier.name}</span><span className="font-mono text-txt">{eur(tier.price)}</span></div>
          <div className="mt-1.5 flex justify-between text-sm"><span className="text-dim">{t("Moduli attivi")}</span><span className="font-mono text-txt">{eur(modulesTotal)}</span></div>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-sm font-semibold text-txt">{t("Totale / 30 giorni")}</span>
            <span className="font-mono text-2xl font-bold text-txt">{eur(total)}</span>
          </div>
          <div className="mt-2 text-xs text-faint">{t("Prossimo rinnovo:")} 01/09/2026</div>
          <button className="mt-4 w-full rounded-lg bg-focus py-2 text-sm font-semibold text-white hover:opacity-90">{t("Gestisci pagamento")}</button>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>{t("Riepilogo fatture")}</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">{t("Periodo")}</th>
                  <th className="px-2 py-2 font-semibold">{t("Data")}</th>
                  <th className="px-2 py-2 font-semibold">{t("Importo")}</th>
                  <th className="px-2 py-2 font-semibold">{t("Stato")}</th>
                  <th className="px-2 py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {INVOICES.map((f) => (
                  <tr key={f.id} className="border-b border-line last:border-0">
                    <td className="px-2 py-2.5 font-medium text-txt">{f.id}</td>
                    <td className="px-2 py-2.5 font-mono text-xs text-dim">{f.date}</td>
                    <td className="px-2 py-2.5 font-mono text-txt">{eur(f.amount)}</td>
                    <td className="px-2 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 18%, transparent)", color: "var(--ok)" }}>{t(f.status)}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right"><button className="text-xs font-medium text-focus hover:underline">{t("Scarica PDF")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <p className="mt-4 text-xs text-faint">{t("Tutti i prezzi si riferiscono al costo dell'abbonamento per 30 giorni. Al momento ci sono")} <b className="text-dim">{rooms} {t("camere attive")}</b>{t(": il prezzo della Versione è calcolato su questa base.")}</p>
    </div>
  );
}
