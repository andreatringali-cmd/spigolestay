import type { Metadata } from "next";
import Link from "next/link";
import { BrandLockup, PUB } from "@/components/PublicUi";
import { TIERS, MODULES, ADDON_PRICE, ROOMS_PER_STRUCT, ROOM_OVERAGE, ANNUAL_OFF, TRIAL_DAYS } from "@/lib/plans";
import { STRIPE_PLANS, annualAmount } from "@/lib/stripe-plans";
import { CONTACT_EMAIL, FAQ, FEATURES, MODULE_BLURB, STEPS } from "./data";
import RequestAccessForm from "./RequestAccessForm";
import { AZIENDA, copyrightRiga, partitaIvaFooter } from "@/lib/azienda";

// Pagina pubblica «Prezzi e iscrizione». Resta sempre chiara (come login e pagine legali) e non legge nulla dal browser:
// piani, prezzi, moduli e limiti arrivano da src/lib/plans.ts, la stessa fonte della pagina Abbonamento.
const OG = "/og?t=Prezzi%20e%20piani&s=Gestionale%20e%20channel%20manager%20per%20B%26B&c=%232f6bb0";
export const metadata: Metadata = {
  title: "Prezzi e iscrizione · Xenora",
  description: `Piani Basic, Pro e Ultimate per gestire prenotazioni, canali, adempimenti e incassi della tua struttura. Prova gratuita di ${TRIAL_DAYS} giorni, nessuna commissione sulle prenotazioni dirette.`,
  alternates: { canonical: "/prezzi" },
  openGraph: {
    title: "Prezzi e iscrizione · Xenora",
    description: "Piani, moduli e condizioni di Xenora, il gestionale con channel manager per B&B e strutture ricettive.",
    url: "/prezzi",
    type: "website",
    images: [{ url: OG, width: 1200, height: 630, alt: "Xenora" }],
  },
  twitter: { card: "summary_large_image", images: [OG] },
};

const eur = (n: number) => `${n.toLocaleString("it-IT")} €`;
const pctOff = Math.round(ANNUAL_OFF * 100);
const FORM_ID = "richiedi-accesso";

function Check({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

const H2 = "font-display text-xl font-bold tracking-tight text-txt sm:text-2xl";
const SECTION = "mx-auto w-full max-w-6xl px-4 sm:px-6";

export default function PrezziPage() {
  const planOptions = [...TIERS.map((t) => ({ key: t.key, label: t.name })), { key: "custom", label: "Su misura (oltre 8 strutture)" }];
  const nameOf = (k: string) => MODULES.find((m) => m.key === k)?.name ?? k;

  return (
    <div className={PUB.page}>
      <a href="#contenuto" className="sr-only rounded-lg bg-surface px-3 py-2 text-sm font-semibold text-txt focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:outline-2 focus:outline-focus">Vai al contenuto</a>

      <header className="border-b border-line bg-surface">
        <div className={`${SECTION} flex items-center justify-between gap-3 py-3`}>
          <BrandLockup size="sm" href="/prezzi" />
          <nav aria-label="Principale" className="flex items-center gap-2">
            <Link href="/login" className={PUB.btnSecondary}>Accedi</Link>
          </nav>
        </div>
      </header>

      <main id="contenuto">
        {/* Titolo e proposta di valore */}
        <section className={`${SECTION} pb-8 pt-10 sm:pb-10 sm:pt-14`} aria-labelledby="titolo">
          <h1 id="titolo" className="font-display text-3xl font-bold tracking-tight text-txt sm:text-4xl">Prezzi e iscrizione</h1>
          <p className="mt-3 max-w-2xl text-base text-dim sm:text-lg">
            Un unico gestionale per prenotazioni, canali, adempimenti e incassi della tua struttura. Canone mensile, nessuna commissione sulle prenotazioni dirette.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a href={`#${FORM_ID}`} className={PUB.btnPrimary}>Richiedi l&apos;accesso</a>
            <a href="#piani" className={PUB.btnSecondary}>Confronta i piani</a>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-dim" aria-label="Garanzie di base">
            {[`Prova gratuita di ${TRIAL_DAYS} giorni`, "Nessun costo di attivazione", "Disdici quando vuoi"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Check />{t}</li>
            ))}
          </ul>
        </section>

        {/* Piani */}
        <section id="piani" className={`${SECTION} scroll-mt-4 py-8 sm:py-10`} aria-labelledby="piani-titolo">
          <h2 id="piani-titolo" className={H2}>Piani</h2>
          <p className="mt-1 text-sm text-dim">Prezzi mensili, IVA inclusa. Con la fatturazione annuale lo sconto è del {pctOff}%.</p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((t, i) => {
              const sp = STRIPE_PLANS.find((p) => p.key === t.key);
              const prev = i > 0 ? TIERS[i - 1] : null;
              const keys = t.includes.filter((k) => k !== "pms" && !prev?.includes.includes(k));
              return (
                <article key={t.key} className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-sm" aria-labelledby={`piano-${t.key}`}>
                  <h3 id={`piano-${t.key}`} className="font-display text-lg font-bold text-txt">{t.name}</h3>
                  <p className="text-sm text-dim">{t.tagline}</p>
                  <p className="mt-4"><span className="font-display text-4xl font-bold text-txt">{eur(t.price)}</span><span className="text-sm text-dim"> al mese</span></p>
                  {sp && <p className="mt-1 text-xs text-dim">oppure {eur(annualAmount(sp))} all&apos;anno (−{pctOff}%)</p>}
                  <p className="mt-3 text-sm font-semibold text-txt">
                    {t.structures === 1 ? "1 struttura" : `Fino a ${t.structures} strutture`}
                    <span className="block font-normal text-dim">{t.structures * ROOMS_PER_STRUCT} camere incluse ({ROOMS_PER_STRUCT} per struttura)</span>
                  </p>
                  <div className="mt-4 flex-1 border-t border-line pt-4">
                    <p className="text-xs font-semibold text-dim">{prev ? `Tutto ${prev.name}, più:` : "Include:"}</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-txt">
                      {!prev && <li className="flex items-start gap-2"><Check className="mt-0.5" />{nameOf("pms")}</li>}
                      {keys.map((k) => <li key={k} className="flex items-start gap-2"><Check className="mt-0.5" />{nameOf(k)}</li>)}
                    </ul>
                  </div>
                  <a href={`#${FORM_ID}`} className={`${PUB.btnPrimary} mt-5`}>Richiedi l&apos;accesso<span className="sr-only"> al piano {t.name}</span></a>
                </article>
              );
            })}

            {/* Oltre gli 8 strutture: condizioni concordate (nessun prezzo pubblico nel codice) */}
            <article className="flex flex-col rounded-xl border border-dashed border-line-strong bg-surface p-5" aria-labelledby="piano-custom">
              <h3 id="piano-custom" className="font-display text-lg font-bold text-txt">Su misura</h3>
              <p className="text-sm text-dim">Catene e gruppi · oltre {TIERS[TIERS.length - 1].structures} strutture</p>
              <p className="mt-4 font-display text-2xl font-bold text-txt">Contattaci</p>
              <p className="mt-1 text-xs text-dim">Strutture e camere su richiesta</p>
              <div className="mt-4 flex-1 border-t border-line pt-4">
                <ul className="space-y-1.5 text-sm text-txt">
                  <li className="flex items-start gap-2"><Check className="mt-0.5" />Tutto il piano {TIERS[TIERS.length - 1].name}</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5" />Condizioni definite insieme a noi</li>
                </ul>
              </div>
              <a href={`#${FORM_ID}`} className={`${PUB.btnSecondary} mt-5`}>Parla con noi<span className="sr-only"> del piano su misura</span></a>
            </article>
          </div>

          <p className="mt-4 text-sm text-dim">
            Ogni camera oltre le {ROOMS_PER_STRUCT} incluse per struttura costa {eur(ROOM_OVERAGE)} al mese. Prova gratuita di {TRIAL_DAYS} giorni dall&apos;attivazione dell&apos;abbonamento, nessun costo di attivazione.
          </p>
        </section>

        {/* Confronto */}
        <section className={`${SECTION} py-8 sm:py-10`} aria-labelledby="confronto-titolo">
          <h2 id="confronto-titolo" className={H2}>Cosa include ogni piano</h2>
          <p className="mt-1 text-sm text-dim">
            Il segno di spunta indica che il modulo è compreso. Dove compare un importo (ad esempio «+6 €»), il modulo non è nel piano e si può attivare a parte, in euro al mese.
          </p>
          <div className="mt-5 overflow-x-auto rounded-xl border border-line bg-surface shadow-sm" role="region" aria-label="Confronto dei piani" tabIndex={0}>
            <table className="w-full min-w-[20rem] border-collapse text-left text-sm">
              <caption className="sr-only">Confronto tra i piani {TIERS.map((t) => t.name).join(", ")}: limiti e moduli inclusi</caption>
              <thead>
                <tr className="bg-wash text-txt">
                  <th scope="col" className="px-2.5 py-3 text-xs font-semibold sm:px-4">Funzione</th>
                  {TIERS.map((t) => <th key={t.key} scope="col" className="px-1.5 py-3 text-center font-display text-sm font-bold sm:px-4">{t.name}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <th scope="row" className="px-2.5 py-2.5 font-semibold text-txt sm:px-4">Strutture (massimo)</th>
                  {TIERS.map((t) => <td key={t.key} className="px-1.5 py-2.5 text-center text-txt sm:px-4">{t.structures}</td>)}
                </tr>
                <tr className="border-t border-line">
                  <th scope="row" className="px-2.5 py-2.5 font-semibold text-txt sm:px-4">Camere incluse</th>
                  {TIERS.map((t) => <td key={t.key} className="px-1.5 py-2.5 text-center text-txt sm:px-4">{t.structures * ROOMS_PER_STRUCT}</td>)}
                </tr>
                {MODULES.map((m) => (
                  <tr key={m.key} className="border-t border-line">
                    <th scope="row" className="px-2.5 py-2.5 align-top font-normal text-txt sm:px-4">
                      <span className="font-semibold">{m.name}</span>
                      {MODULE_BLURB[m.key] && <span className="mt-0.5 block text-xs text-dim">{MODULE_BLURB[m.key]}</span>}
                    </th>
                    {TIERS.map((t) => {
                      const inc = m.core || t.includes.includes(m.key);
                      const price = ADDON_PRICE[m.key];
                      return (
                        <td key={t.key} className="px-1.5 py-2.5 text-center align-top sm:px-4">
                          {inc ? (
                            <><Check className="mx-auto" /><span className="sr-only">Incluso</span></>
                          ) : price ? (
                            <><span aria-hidden className="whitespace-nowrap text-xs text-dim">+{eur(price)}</span><span className="sr-only">Non incluso, modulo aggiuntivo a {price} euro al mese</span></>
                          ) : (
                            <><span aria-hidden className="text-dim">—</span><span className="sr-only">Non incluso</span></>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-dim">{MODULES.length} moduli in totale. Il piano Ultimate li comprende tutti.</p>
        </section>

        {/* Funzioni */}
        <section className={`${SECTION} py-8 sm:py-10`} aria-labelledby="funzioni-titolo">
          <h2 id="funzioni-titolo" className={H2}>Che cosa trovi in Xenora</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-xl border border-line bg-surface p-5 shadow-sm">
                <h3 className="font-display text-base font-bold text-txt">{f.title}</h3>
                <p className="mt-2 text-sm text-dim">{f.text}</p>
                {f.status && <p className="mt-3"><span className="inline-block rounded-full border border-line bg-wash px-2 py-0.5 text-[11px] font-semibold text-txt">{f.status}</span></p>}
              </li>
            ))}
          </ul>
        </section>

        {/* Come si inizia */}
        <section className={`${SECTION} py-8 sm:py-10`} aria-labelledby="inizio-titolo">
          <h2 id="inizio-titolo" className={H2}>Come si inizia</h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3 rounded-xl border border-line bg-surface p-5">
                <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-focus text-sm font-bold text-on-focus">{i + 1}</span>
                <div>
                  <h3 className="font-display text-base font-bold text-txt">{s.title}</h3>
                  <p className="mt-1 text-sm text-dim">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Modulo di richiesta */}
        <section id={FORM_ID} className={`${SECTION} scroll-mt-4 py-8 sm:py-10`} aria-labelledby="richiesta-titolo">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 id="richiesta-titolo" className={H2}>Richiedi l&apos;accesso</h2>
              <p className="mt-2 text-sm text-dim">Xenora è ad accesso su invito. Lasciaci i tuoi riferimenti: abiliteremo il tuo indirizzo email e potrai entrare dalla pagina di accesso.</p>
              <p className="mt-3 text-sm text-dim">Preferisci scriverci? <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Richiesta di accesso a Xenora")}`} className={PUB.link}>{CONTACT_EMAIL}</a></p>
              <p className="mt-3 text-sm text-dim">Hai già un account? <Link href="/login" className={PUB.link}>Accedi</Link></p>
            </div>
            <div className={`${PUB.card} relative`}>
              <RequestAccessForm plans={planOptions} />
            </div>
          </div>
        </section>

        {/* Domande frequenti */}
        <section className={`${SECTION} py-8 sm:py-10`} aria-labelledby="faq-titolo">
          <h2 id="faq-titolo" className={H2}>Domande frequenti</h2>
          <div className="mt-5 max-w-3xl divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-4 sm:px-5">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 text-sm font-semibold text-txt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                  <span>{f.q}</span>
                  <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-dim transition-transform group-open:rotate-180"><path d="M6 9l6 6 6-6" /></svg>
                </summary>
                <p className="pb-4 text-sm leading-relaxed text-dim">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Fiducia */}
        <section className={`${SECTION} pb-12 pt-4 sm:pb-16`} aria-label="Sicurezza dei dati">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-5 py-4 text-sm text-txt">
            {["Hosting nell'Unione Europea (Francoforte)", "Backup giornalieri", "Dati isolati per account", "Pagamenti gestiti da Stripe"].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check />{t}</li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className={`${SECTION} flex flex-col gap-4 py-6 text-xs text-dim sm:flex-row sm:items-center sm:justify-between`}>
          <p>{copyrightRiga(new Date().getFullYear())}{partitaIvaFooter()} · <a href={AZIENDA.sitoVetrina} className={PUB.linkSubtle}>xenoradigitalsolutions.com</a> · <a href={`mailto:${CONTACT_EMAIL}`} className={PUB.linkSubtle}>{CONTACT_EMAIL}</a></p>
          <nav aria-label="Documenti legali" className="flex flex-wrap gap-x-4">
            <Link href="/termini" className={`${PUB.linkSubtle} py-2`}>Termini</Link>
            <Link href="/privacy" className={`${PUB.linkSubtle} py-2`}>Privacy</Link>
            <Link href="/cookie" className={`${PUB.linkSubtle} py-2`}>Cookie</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
