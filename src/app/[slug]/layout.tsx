// Xenosite pubblico (xenora.it/<slug>): la pagina vera si costruisce nel browser, quindi i crawler senza JavaScript vedevano una schermata vuota.
// Questo layout (eseguito sul server) aggiunge ciò che serve a motori di ricerca e assistenti AI: titolo e descrizione, scheda strutturata
// schema.org (JSON-LD) e un riepilogo testuale per chi non esegue JavaScript. Solo dati pubblici (vedi lib/ai-site-core.ts).
import { cache } from "react";
import type { Metadata } from "next";
import { loadAiSite, buildJsonLd } from "@/lib/ai-site";

const ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://xenora.it").replace(/\/+$/, "");
const getSite = cache((slug: string) => loadAiSite(slug, ORIGIN));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = await getSite(slug);
  if (!d) return {};
  const s = d.site;
  const where = [s.city, s.province].filter(Boolean).join(", ");
  const title = `${s.name}${where ? ` · ${where}` : ""}`;
  const description = (s.tagline || s.description || `${s.type || "Struttura"} a ${s.city || "Italia"}: prenota direttamente, senza commissioni.`).slice(0, 200);
  return {
    title, description,
    alternates: { canonical: `${ORIGIN}/${s.slug}` },
    openGraph: { title, description, url: `${ORIGIN}/${s.slug}`, type: "website", siteName: s.name },
    robots: { index: true, follow: true },
  };
}

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await getSite(slug);
  if (!d) return <>{children}</>;
  const s = d.site;
  // "<" scritto come <: nessun testo del proprietario può chiudere il tag <script>.
  const ld = JSON.stringify(buildJsonLd(s, ORIGIN)).replace(/</g, "\\u003c");
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      {/* Per chi non esegue JavaScript: stesso contenuto essenziale della pagina. */}
      <noscript>
        <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h1>{s.name}</h1>
          {(s.tagline || s.description) && <p>{s.tagline || s.description}</p>}
          <p>{[s.address, s.postalCode, s.city, s.province, s.country].filter(Boolean).join(", ")}</p>
          {s.rooms.length > 0 && (
            <>
              <h2>Camere</h2>
              <ul>{s.rooms.map((r) => <li key={r.id}>{r.name}{r.maxGuests ? ` · fino a ${r.maxGuests} ospiti` : ""}{r.fromPrice ? ` · da ${r.fromPrice} ${s.currency} a notte` : ""}</li>)}</ul>
            </>
          )}
          <p>{s.policies.cancellation}</p>
          <p><a href={s.bookingUrl}>Prenota direttamente, senza commissioni</a></p>
          <p><a href={`/${s.slug}/llms.txt`}>Scheda in formato testo</a></p>
        </main>
      </noscript>
      {children}
    </>
  );
}
