// Recensioni Google REALI via Google Places API (Place Details), lato server.
// - Se GOOGLE_PLACES_API_KEY non è impostata -> { configured:false } (nessun crash).
// - Con la key: chiama Place Details (fields: name, rating, user_ratings_total, reviews),
//   normalizza le recensioni e converte il voto Google 1..5 in scala 0..10 (×2).
// NOTA: l'API Google restituisce solo ~5 recensioni (le più recenti/rilevanti).

export type ReviewSource = "google" | "booking" | "airbnb" | "expedia" | "tripadvisor" | "direct";

export interface NormalizedReview {
  id: string;
  guest: string;
  date: string; // ISO "YYYY-MM-DD"
  rating: number; // 0..10 (Google 1..5 × 2)
  text: string;
  source: ReviewSource;
  bucket: "pos" | "neu" | "neg";
}

export interface GoogleReviewsResult {
  configured: boolean; // la key server è impostata?
  placeId?: string;
  name?: string; // nome struttura restituito da Google
  rating?: number; // media 0..10
  total?: number; // numero totale di recensioni (user_ratings_total)
  reviews?: NormalizedReview[];
  truncated?: boolean; // true: Google espone solo ~5 recensioni
  error?: string;
}

function bucketOf(r10: number): "pos" | "neu" | "neg" {
  if (r10 >= 8) return "pos";
  if (r10 >= 6) return "neu";
  return "neg";
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface GoogleReviewRaw {
  author_name?: string;
  rating?: number; // 1..5
  text?: string;
  time?: number; // epoch seconds
}

interface GooglePlaceRaw {
  name?: string;
  rating?: number; // 1..5
  user_ratings_total?: number;
  reviews?: GoogleReviewRaw[];
}

// ---- Places API (New): https://places.googleapis.com/v1/places/{id} ----
interface NewReviewRaw {
  rating?: number; // 1..5
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: { displayName?: string };
  publishTime?: string; // ISO
}
interface NewPlaceRaw {
  displayName?: { text?: string };
  rating?: number; // 1..5
  userRatingCount?: number;
  reviews?: NewReviewRaw[];
}

async function fetchNew(id: string, key: string): Promise<GoogleReviewsResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=it`, {
      signal: ctrl.signal, cache: "no-store",
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,reviews" },
    });
    if (!r.ok) return null; // fallback alla legacy
    const j = (await r.json().catch(() => null)) as NewPlaceRaw | null;
    if (!j) return null;
    const raw = Array.isArray(j.reviews) ? j.reviews : [];
    const reviews: NormalizedReview[] = raw.map((rv, i) => {
      const r10 = Math.max(0, Math.min(10, Math.round((Number(rv.rating) || 0) * 2)));
      const when = rv.publishTime ? new Date(rv.publishTime) : new Date();
      return {
        id: `google-${id}-${rv.publishTime ?? i}`,
        guest: (rv.authorAttribution?.displayName || "Ospite Google").trim(),
        date: isoDay(isNaN(when.getTime()) ? new Date() : when),
        rating: r10,
        text: (rv.text?.text || rv.originalText?.text || "").trim(),
        source: "google" as const,
        bucket: bucketOf(r10),
      };
    });
    return {
      configured: true, placeId: id,
      name: j.displayName?.text,
      rating: typeof j.rating === "number" ? Math.round(j.rating * 2 * 10) / 10 : undefined,
      total: typeof j.userRatingCount === "number" ? j.userRatingCount : undefined,
      reviews, truncated: true,
    };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function fetchLegacy(id: string, key: string): Promise<GoogleReviewsResult> {
  const endpoint = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  endpoint.searchParams.set("place_id", id);
  endpoint.searchParams.set("fields", "name,rating,user_ratings_total,reviews");
  endpoint.searchParams.set("reviews_sort", "newest");
  endpoint.searchParams.set("language", "it");
  endpoint.searchParams.set("key", key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(endpoint.toString(), { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return { configured: true, placeId: id, error: `http_${r.status}` };
    const j = (await r.json().catch(() => null)) as { status?: string; error_message?: string; result?: GooglePlaceRaw } | null;
    if (!j) return { configured: true, placeId: id, error: "bad_response" };
    if (j.status && j.status !== "OK") return { configured: true, placeId: id, error: j.error_message || j.status };
    const res = j.result || {};
    const raw = Array.isArray(res.reviews) ? res.reviews : [];
    const reviews: NormalizedReview[] = raw.map((rv, i) => {
      const r10 = Math.max(0, Math.min(10, Math.round((Number(rv.rating) || 0) * 2)));
      const when = rv.time ? new Date(rv.time * 1000) : new Date();
      return {
        id: `google-${id}-${rv.time ?? i}`,
        guest: (rv.author_name || "Ospite Google").trim(),
        date: isoDay(when),
        rating: r10,
        text: (rv.text || "").trim(),
        source: "google" as const,
        bucket: bucketOf(r10),
      };
    });
    return {
      configured: true, placeId: id,
      name: res.name,
      rating: typeof res.rating === "number" ? Math.round(res.rating * 2 * 10) / 10 : undefined,
      total: typeof res.user_ratings_total === "number" ? res.user_ratings_total : undefined,
      reviews, truncated: true,
    };
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return { configured: true, placeId: id, error: aborted ? "timeout" : "fetch_failed" };
  } finally { clearTimeout(timer); }
}

export async function fetchGoogleReviews(placeId: string): Promise<GoogleReviewsResult> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { configured: false };
  const id = (placeId || "").trim();
  if (!id) return { configured: true, error: "missing_place_id" };
  // Prima la Places API (New) (progetti recenti); se non risponde, fallback alla classica.
  const viaNew = await fetchNew(id, key);
  if (viaNew && (viaNew.reviews?.length || viaNew.total != null || viaNew.name)) return viaNew;
  return fetchLegacy(id, key);
}
