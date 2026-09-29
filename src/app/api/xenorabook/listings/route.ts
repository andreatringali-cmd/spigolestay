// Catalogo PUBBLICO di XenoraBook (xenora.it/api/xenorabook/listings).
//
// A differenza del feed Metasearch (una struttura sola, per slug), qui leggiamo TUTTE
// le righe di `public_sites`: XenoraBook è la vetrina di TUTTE le strutture che hanno
// davvero pubblicato il proprio Xenosite. Nessun dato finto: nome, città, tipologie,
// prezzi, servizi e foto arrivano dallo stesso snapshot sanificato usato dal mini-sito
// pubblico (src/lib/publicdata.ts) e dal feed Metasearch.
//
// Rating: SOLO se calcolabile onestamente — priorità alle recensioni Google reali
// (googlePlaceId + GOOGLE_PLACES_API_KEY), altrimenti le recensioni dirette lasciate
// dagli ospiti sul mini-sito (già presenti nello snapshot pubblicato, blob.directReviews).
// Se nessuna delle due esiste, il rating resta null: niente numeri inventati.
//
// Sola lettura, nessuna PII: usa esclusivamente dati già pubblicati dal proprietario.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { effectiveBase, effectiveClosed } from "@/lib/pricing";
import { fetchGoogleReviews } from "@/lib/reviews/google";
import { RESERVED_SLUGS } from "@/lib/publicdata";
import type { RoomType, Unit } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_KEY = "spigolestay:data:v1";
const IMAGES_KEY = "spigolestay:images";
const MAX_IMAGES = 12;
const MAX_SERVICES = 10;

type StructRow = {
  id: string;
  name?: string;
  city?: string;
  zone?: string;
  address?: string;
  type?: string;
  services?: string[];
  description?: string;
  googlePlaceId?: string;
  cancelPolicy?: string;
};

type Blob = {
  structures?: StructRow[];
  roomTypes?: RoomType[];
  units?: Unit[];
  directReviews?: Array<{ structureId?: string; rating?: number }>;
};

export interface ListingRoom { id: string; name: string; occ: number; price: number; refundable: boolean }
export interface XenoraBookListing {
  slug: string;
  name: string;
  city: string;
  area: string;
  type: string;
  services: string[];
  priceFrom: number | null;
  capacity: number;
  beds: number;
  images: string[];
  hue: number;
  rating: number | null; // scala 0..5, reale
  reviews: number | null;
  ratingSource: "google" | "diretta" | null;
  rooms: ListingRoom[];
}

// Colore segnaposto deterministico (stesso slug -> stessa tonalità), usato SOLO
// quando la struttura non ha ancora caricato foto vere.
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export async function GET() {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!sbUrl || !key) {
    return NextResponse.json({ listings: [], cities: [], stats: { structures: 0, cities: 0, reviews: 0 }, error: "supabase_not_configured" }, { status: 503 });
  }

  type Row = { slug: string | null; structure_id: string | null; structure_name: string | null; data: Record<string, string> | null };
  let rows: Row[] = [];
  try {
    const db = createClient(sbUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from("public_sites").select("slug, structure_id, structure_name, data");
    if (error) return NextResponse.json({ listings: [], cities: [], stats: { structures: 0, cities: 0, reviews: 0 }, error: "read_error" }, { status: 500 });
    rows = (data || []) as Row[];
  } catch {
    return NextResponse.json({ listings: [], cities: [], stats: { structures: 0, cities: 0, reviews: 0 }, error: "read_error" }, { status: 500 });
  }

  const listings: XenoraBookListing[] = [];

  for (const row of rows) {
    const slug = (row.slug || "").trim().toLowerCase();
    if (!slug || RESERVED_SLUGS.has(slug) || !row.data) continue;

    let blob: Blob = {};
    try { blob = JSON.parse(row.data[DATA_KEY] || "{}") as Blob; } catch { continue; }

    const structs = Array.isArray(blob.structures) ? blob.structures : [];
    const structure = structs.find((s) => s.id === row.structure_id) || structs[0];
    if (!structure) continue;
    const sid = structure.id;

    const allTypes: RoomType[] = Array.isArray(blob.roomTypes) ? blob.roomTypes : [];
    // Stessa logica del feed Metasearch: solo tipologie vendibili, solo le "madri".
    const types = allTypes.filter((rt) => rt.structureId === sid && !effectiveClosed(rt, allTypes));
    const masters = types.filter((rt) => !rt.deriveFrom || !types.some((x) => x.id === rt.deriveFrom));

    const rooms: ListingRoom[] = masters
      .map((rt) => ({
        id: rt.id,
        name: rt.name || "Camera",
        occ: rt.maxOccupancy || rt.beds || 2,
        price: effectiveBase(rt, allTypes),
        refundable: structure.cancelPolicy === "flessibile",
      }))
      .sort((a, b) => a.price - b.price);

    const priceFrom = rooms.length ? Math.min(...rooms.map((r) => r.price)) : null;
    const capacity = masters.length ? Math.max(...masters.map((rt) => rt.maxOccupancy || rt.beds || 0)) : 0;
    const beds = masters.length ? Math.max(...masters.map((rt) => rt.beds || 0)) : 0;

    // Servizi reali: quelli della struttura + le dotazioni delle tipologie vendibili.
    const svcSet = new Set<string>();
    (structure.services ?? []).forEach((s) => s && svcSet.add(s));
    masters.forEach((rt) => (rt.amenities ?? []).forEach((a) => a && svcSet.add(a)));
    const services = Array.from(svcSet).slice(0, MAX_SERVICES);

    // Foto REALI: tutte quelle già caricate dal gestore per le tipologie + le camere
    // fisiche di questa struttura (chiave ausiliaria "spigolestay:images", copiata nello
    // snapshot pubblicato). Se non ce ne sono, l'array resta vuoto: niente foto finte.
    const images: string[] = [];
    try {
      const imgMap = JSON.parse(row.data[IMAGES_KEY] || "{}") as Record<string, string[]>;
      for (const rt of types) for (const u of imgMap[`rt:${rt.id}`] ?? []) images.push(u);
      const units = Array.isArray(blob.units) ? blob.units : [];
      for (const u of units.filter((x) => x.structureId === sid)) for (const p of u.photos ?? []) images.push(p);
    } catch {}
    const uniqueImages = Array.from(new Set(images)).slice(0, MAX_IMAGES);

    // Rating reale: recensioni dirette pubblicate (sempre nello snapshot) come base;
    // se c'è un Google Place ID configurato, il dato Google (più solido) ha priorità.
    let rating: number | null = null;
    let reviews: number | null = null;
    let ratingSource: "google" | "diretta" | null = null;
    const directReviews = (blob.directReviews ?? []).filter((r) => r && r.structureId === sid && typeof r.rating === "number");
    if (directReviews.length) {
      rating = Math.round((directReviews.reduce((a, r) => a + (r.rating || 0), 0) / directReviews.length) * 10) / 10;
      reviews = directReviews.length;
      ratingSource = "diretta";
    }
    const placeId = structure.googlePlaceId?.trim();
    if (placeId) {
      try {
        const g = await fetchGoogleReviews(placeId);
        if (g.configured && typeof g.rating === "number" && typeof g.total === "number" && g.total > 0) {
          rating = Math.round((g.rating / 2) * 10) / 10; // g.rating è 0..10 (Google x2) -> riporto a 0..5
          reviews = g.total;
          ratingSource = "google";
        }
      } catch { /* nessun crash: il rating resta quello diretto, se c'era */ }
    }

    const city = structure.city?.trim() || "";
    const zone = structure.zone?.trim() || "";
    const area = [zone, city].filter(Boolean).join(" · ") || structure.address?.trim() || "Sicilia sud-orientale";

    listings.push({
      slug,
      name: structure.name?.trim() || row.structure_name?.trim() || slug,
      city,
      area,
      type: structure.type?.trim() || "Struttura",
      services,
      priceFrom,
      capacity,
      beds,
      images: uniqueImages,
      hue: hueFromString(slug),
      rating,
      reviews,
      ratingSource,
      rooms,
    });
  }

  const cities = Array.from(new Set(listings.map((l) => l.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "it"));
  const totalReviews = listings.reduce((a, l) => a + (l.reviews || 0), 0);

  return NextResponse.json(
    { listings, cities, stats: { structures: listings.length, cities: cities.length, reviews: totalReviews } },
    { headers: { "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600" } },
  );
}
