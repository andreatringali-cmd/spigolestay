"use client";

// Dettaglio struttura PUBBLICO di XenoraBook (xenora.it/xenorabook/[id]) — a tutta pagina.
// [id] è lo SLUG reale del Xenosite pubblicato (public_sites.slug). I dati (nome, città,
// camere, prezzi, foto) arrivano da /api/xenorabook/listings, quindi sono quelli davvero
// compilati dal gestore — nessun annuncio finto.
//
// La prenotazione NON è simulata qui: il pulsante porta al motore di prenotazione
// pubblico reale (/prenota?site=<slug>), lo stesso usato dal mini-sito Xenosite e dal
// feed Metasearch, con le stesse tariffe/disponibilità.
import { Suspense, useEffect, useMemo, useState } from "react";
import { ymdRome } from "@/lib/dates-rome";
import { shiftISO } from "@/lib/dates";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";
import DateField from "@/components/DateField";
import { ListingImage, StructImg, stars, type Listing, type Room } from "@/lib/xenorabook/data";

const c = (n: number) => `€${n}`;

export default function StructurePublicPage() {
  return <Suspense fallback={null}><Engine /></Suspense>;
}

function Engine() {
  const router = useRouter();
  const params = useParams();
  const qp = useSearchParams();
  const slug = String((params as { id?: string }).id || "").toLowerCase();

  const [status, setStatus] = useState<"loading" | "ok" | "notfound" | "error">("loading");
  const [listing, setListing] = useState<Listing | null>(null);

  useEffect(() => {
    let alive = true;
    if (!slug) { setStatus("notfound"); return; }
    fetch("/api/xenorabook/listings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.error) { setStatus("error"); return; }
        const found: Listing | undefined = Array.isArray(j?.listings) ? j.listings.find((l: Listing) => l.slug === slug) : undefined;
        if (!found) { setStatus("notfound"); return; }
        setListing(found); setStatus("ok");
      })
      .catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [slug]);

  const today = ymdRome(new Date());
  // Date dal link: arrivo non nel passato e partenza sempre DOPO l'arrivo (prima, senza ?to, arrivo e partenza coincidevano: 0 notti).
  const [from, setFrom] = useState(() => { const v = qp.get("from"); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today ? v : today; });
  const [to, setTo] = useState(() => { const v = qp.get("from"); const ci = v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today ? v : today; const t = qp.get("to"); return t && /^\d{4}-\d{2}-\d{2}$/.test(t) && t > ci ? t : shiftISO(ci, 1); });
  const [adults, setAdults] = useState(Number(qp.get("adults")) || 2);
  const [children, setChildren] = useState(Number(qp.get("children")) || 0);

  const rooms: Room[] = useMemo(() => listing?.rooms ?? [], [listing]);
  const nights = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) || 1);

  const shell = (inner: React.ReactNode) => (
    <div className="min-h-dvh bg-wash">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/xenorabook" className="flex min-h-11 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/xenora-mark.png" alt="Xenora" width={26} height={26} style={{ width: 26, height: 26, objectFit: "contain" }} />
            <span className="font-display text-lg font-bold text-txt">XenoraBook</span>
          </Link>
          <a href="https://xenora.it" className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-txt hover:bg-wash sm:min-h-0">Sei una struttura? Accedi</a>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{inner}</main>
    </div>
  );

  if (status === "loading") return shell(
    <div className="grid place-items-center py-16" role="status" aria-busy="true">
      {/* Solo la farfalla che pulsa, niente testo durante il caricamento. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/xenora-mark.png" alt="" width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
      <style>{`@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>,
  );
  if (status === "error") return shell(
    <div className="py-10 text-center">
      <div role="alert" className="text-sm text-dim">Struttura momentaneamente non disponibile. Riprova tra poco.</div>
      <button onClick={() => router.push("/xenorabook")} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-focus hover:underline">← Torna al portale</button>
    </div>
  );
  if (status === "notfound" || !listing) return shell(
    <div className="py-10 text-center">
      <div role="alert" className="text-sm text-dim">Struttura non trovata (o non più pubblicata).</div>
      <button onClick={() => router.push("/xenorabook")} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-focus hover:underline">← Torna al portale</button>
    </div>
  );

  // Motore di prenotazione REALE (stesso usato dal mini-sito Xenosite e dal feed
  // Metasearch): nessun flusso di checkout finto qui, solo il link con date/ospiti/camera.
  const bookHref = (roomId?: string) => {
    const qs = new URLSearchParams({ site: listing.slug, ci: from, co: to, ad: String(adults), ch: String(children) });
    if (roomId) qs.set("rt", roomId);
    return `/prenota?${qs.toString()}`;
  };

  return shell(
    <>
      <button onClick={() => router.push("/xenorabook")} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-dim hover:text-txt"><Icon name="chevron" size={14} style={{ transform: "rotate(180deg)" }} /> Portale</button>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          {listing.images.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 overflow-hidden rounded-2xl border border-line">
              <div className="col-span-4 sm:col-span-2 sm:row-span-2"><div className="aspect-[4/3] h-full w-full sm:aspect-auto"><ListingImage src={listing.images[0]} hue={listing.hue} initial={listing.name[0] || "X"} /></div></div>
              {listing.images.slice(1, 4).map((src, i) => <div key={i} className="hidden aspect-[4/3] sm:block"><ListingImage src={src} hue={(listing.hue + (i + 1) * 30) % 360} initial={listing.name[0] || "X"} /></div>)}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line">
              <div className="aspect-[16/9] w-full"><StructImg hue={listing.hue} initial={listing.name[0] || "X"} /></div>
              <div className="bg-wash px-3 py-1.5 text-center text-xs text-dim">Il gestore non ha ancora caricato foto per questa struttura.</div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ backgroundColor: "#3F7A5B" }}>Su Xenora</span>
            <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-dim">{listing.type}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-txt">{listing.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-dim">
            <span>📍 {listing.area}</span>
            {listing.rating != null ? (
              <span className="flex items-center gap-1 font-bold text-txt"><span style={{ color: "#D99A2B" }}>★</span>{listing.rating.toFixed(1)} <span className="font-semibold text-dim">({listing.reviews} recensioni{listing.ratingSource === "google" ? " Google" : " dirette"})</span></span>
            ) : (
              <span className="font-semibold text-dim">Nessuna recensione ancora</span>
            )}
          </div>
          {listing.rating != null && <div className="mt-1 text-[13px]" style={{ color: "#D99A2B" }} aria-hidden>{stars(listing.rating)}</div>}

          {listing.services.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-dim">Servizi</div>
              <div className="flex flex-wrap gap-2">{listing.services.map((a) => <span key={a} className="rounded-lg border border-line bg-wash px-2.5 py-1 text-[12.5px] text-dim">{a}</span>)}</div>
            </div>
          )}

          <div className="mt-6">
            <SectionTitle>Camere</SectionTitle>
            {rooms.length === 0 ? (
              <div className="rounded-xl border border-line bg-wash px-4 py-6 text-center text-sm text-dim">Nessuna tipologia in vendita al momento. Contatta la struttura tramite Xenora.</div>
            ) : (
              <div className="mt-2 space-y-3">
                {rooms.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-bold text-txt">{r.name}</div>
                      <div className="mt-0.5 text-xs text-dim">Fino a {r.occ} {r.occ === 1 ? "ospite" : "ospiti"} · {r.refundable ? "Cancellazione gratuita" : "Vedi condizioni sul motore di prenotazione"}</div>
                    </div>
                    <div className="text-right"><div className="text-lg font-extrabold text-txt">{c(r.price)}</div><div className="text-xs text-dim">/ notte</div></div>
                    <a href={bookHref(r.id)} className="inline-flex min-h-11 items-center rounded-lg bg-focus px-5 py-2 text-sm font-bold text-white hover:opacity-90">Prenota</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <Card className="sticky top-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-line px-2.5 py-1.5"><div className="text-xs font-bold uppercase text-dim">Check-in</div><DateField value={from} min={today} onChange={(v) => { setFrom(v); if (to <= v) setTo(shiftISO(v, 1)); }} className="min-h-11 w-full md:min-h-8 bg-transparent text-left text-base sm:text-sm font-semibold text-txt outline-none focus-visible:ring-2 focus-visible:ring-focus/40" /></div>
              <div className="rounded-lg border border-line px-2.5 py-1.5"><div className="text-xs font-bold uppercase text-dim">Check-out</div><DateField value={to} min={shiftISO(from, 1)} onChange={(v) => setTo(v)} className="min-h-11 w-full md:min-h-8 bg-transparent text-left text-base sm:text-sm font-semibold text-txt outline-none focus-visible:ring-2 focus-visible:ring-focus/40" /></div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5"><span className="text-dim">Adulti</span><span className="flex items-center gap-2"><button onClick={() => setAdults(Math.max(1, adults - 1))} aria-label="Adulti −" className="grid h-11 w-8 place-items-center text-dim sm:h-8">−</button><b>{adults}</b><button onClick={() => setAdults(adults + 1)} aria-label="Adulti +" className="grid h-11 w-8 place-items-center text-dim sm:h-8">+</button></span></div>
              <div className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5"><span className="text-dim">Bambini</span><span className="flex items-center gap-2"><button onClick={() => setChildren(Math.max(0, children - 1))} aria-label="Bambini −" className="grid h-11 w-8 place-items-center text-dim sm:h-8">−</button><b>{children}</b><button onClick={() => setChildren(children + 1)} aria-label="Bambini +" className="grid h-11 w-8 place-items-center text-dim sm:h-8">+</button></span></div>
            </div>
            <div className="mt-3 border-t border-line pt-3 text-sm">
              {listing.priceFrom != null ? (
                <div className="flex justify-between py-0.5"><span className="text-dim">A partire da · {nights}n</span><span className="font-semibold text-txt">{c(listing.priceFrom * nights)}</span></div>
              ) : (
                <div className="text-xs text-dim">Prezzo su richiesta: scegli una camera per vedere la tariffa.</div>
              )}
            </div>
            <a href={bookHref()} className="mt-3 flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-surface px-4 py-2.5 text-center text-sm font-bold text-focus hover:bg-wash">Vai al motore di prenotazione →</a>
            <div className="mt-2 text-center text-xs text-dim">Prenoti direttamente dal motore Xenora della struttura.</div>
          </Card>
        </div>
      </div>
    </>
  );
}
