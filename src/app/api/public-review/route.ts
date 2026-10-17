import { NextResponse } from "next/server";
import { internalFetch, rateLimited } from "@/lib/server-auth";
import { clientIp } from "@/lib/server-booking-guard";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseNotifPrefs } from "@/lib/notifPrefs";
import { ymdRome } from "@/lib/dates-rome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recensione DIRETTA dal sito PUBBLICO (Xenosite, xenora.it/<slug>).
// Un visitatore anonimo lascia una recensione dal mini-sito: questa route
// (service role, nessuna autenticazione) risolve lo slug → proprietario + struttura
// dalla tabella public_sites e APPENDE la recensione all'array `directReviews` nel
// blob dati dove vive la struttura: la riga dell'ORGANIZZAZIONE (org_state) se la struttura è condivisa/di società,
// altrimenti quella personale del proprietario (app_state) — stesso criterio di findBookingStore (lib/manage-booking.ts).
// Il gestore la vedrà in "Recensioni" (fonte Diretta), potrà rispondere e pubblicare.
// Scrittura con rev-lock e più tentativi (come /api/public-booking).

const DATA_KEY = "spigolestay:data:v1";
const WRITE_ATTEMPTS = 3;
type Json = Record<string, unknown>;
type DirectReview = { id: string; updatedAt?: number; structureId: string; guest: string; date: string; rating: number; text: string; source: "direct"; reply?: string; createdAt: number };

const isoDay = () => ymdRome(new Date());
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
// Toglie i caratteri di controllo (il testo finisce in email e in pagina) e comprime gli spazi.
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]{2,}/g, " ").trim().slice(0, max);

// Voto: le stelle del sito sono SOLO 1..5 (numero intero). Fuori da 1..5 la richiesta è rifiutata (prima 6..10 passavano come "già in scala /10").
// Si salva in scala 0..10 (×2), come le altre recensioni.
function starsOf(raw: unknown): number | null {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

interface Located { table: "app_state" | "org_state"; keyCol: "user_id" | "org_id"; keyVal: string; blob: Record<string, string>; data: Json; rev: number | null }
const parseData = (blob: Record<string, string>): Json => { try { return JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { return {}; } };

// Dove sta la struttura: prima le organizzazioni di cui il proprietario è membro (fonte di verità per le strutture in società), poi la riga personale.
async function locateStore(admin: SupabaseClient, ownerId: string, sid: string, fresh?: Located): Promise<Located | null> {
  const read = async (table: "app_state" | "org_state", keyCol: "user_id" | "org_id", keyVal: string): Promise<Located | null> => {
    const { data: row } = await admin.from(table).select("data, rev").eq(keyCol, keyVal).maybeSingle();
    if (!row) return null;
    const blob = (((row as { data?: unknown }).data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number }).rev === "number" ? (row as { rev: number }).rev : null;
    return { table, keyCol, keyVal, blob, data: parseData(blob), rev };
  };
  // Rilettura dopo un conflitto di versione: stessa riga, dati freschi.
  if (fresh) return read(fresh.table, fresh.keyCol, fresh.keyVal);
  const { data: ms } = await admin.from("memberships").select("org_id, active").eq("user_id", ownerId);
  for (const m of arr(ms)) {
    if ((m as { active?: boolean }).active === false) continue;
    const orgId = String((m as { org_id?: string }).org_id || "");
    if (!orgId) continue;
    const hit = await read("org_state", "org_id", orgId);
    if (hit && arr(hit.data.structures).some((s) => s.id === sid)) return hit;
  }
  return read("app_state", "user_id", ownerId);
}

export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  const ip = clientIp(req);
  // Endpoint anonimo che scrive nei dati del proprietario: limite per IP al minuto e, più a lungo, per IP+struttura e per struttura (contro lo spam di recensioni).
  if (rateLimited("pr:" + ip, 5, 60_000)) return NextResponse.json({ error: "troppe_richieste" }, { status: 429 });

  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const stars = starsOf(body?.rating);
    const guest = clean(body?.guest, 60) || "Ospite";
    const text = clean(body?.text, 1000);

    if (!slug || stars === null) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    // Lunghezze massime sui valori GREZZI (il taglio a 60/1000 caratteri sopra resta come rete di sicurezza).
    if (slug.length > 80 || String(body?.guest ?? "").length > 120 || String(body?.text ?? "").length > 3000) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    if (rateLimited(`pr:${ip}:${slug}`, 3, 3_600_000)) return NextResponse.json({ error: "troppe_richieste" }, { status: 429 });
    if (rateLimited(`pr:slug:${slug}`, 30, 3_600_000)) return NextResponse.json({ error: "troppe_richieste" }, { status: 429 });
    const rating = stars * 2;

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1) slug → proprietario + struttura (il mini-sito di uno slug è di UNA struttura)
    const { data: site, error: siteErr } = await admin.from("public_sites").select("user_id, structure_id").eq("slug", slug).maybeSingle();
    if (siteErr) return NextResponse.json({ error: "read_error" }, { status: 500 });
    if (!site?.user_id || !site?.structure_id) return NextResponse.json({ error: "site_not_found" }, { status: 404 });
    const ownerId = site.user_id as string;
    const sid = site.structure_id as string;

    const now = Date.now();
    const review: DirectReview = {
      id: (globalThis.crypto?.randomUUID?.() ?? `dr_${now}`),
      updatedAt: now,
      structureId: sid,
      guest,
      date: isoDay(),
      rating,
      text,
      source: "direct",
      reply: "",
      createdAt: now,
    };

    // 2) trova dove vive la struttura (org_state se condivisa, altrimenti app_state), appendi la recensione e scrivi con lock su rev (più tentativi)
    let loc = await locateStore(admin, ownerId, sid);
    if (!loc) return NextResponse.json({ error: "read_error" }, { status: 500 });
    let written: Located | null = null;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS && loc; attempt++) {
      const data = loc.data;
      const list = (Array.isArray(data.directReviews) ? data.directReviews : []) as DirectReview[];
      if (list.some((r) => r?.id === review.id)) { written = loc; break; }
      data.directReviews = [...list, review];
      const blob = { ...loc.blob, [DATA_KEY]: JSON.stringify(data) };
      let write = admin.from(loc.table).update({ data: blob, updated_at: new Date().toISOString() }).eq(loc.keyCol, loc.keyVal);
      if (loc.rev !== null) write = write.eq("rev", loc.rev);
      const { data: updated, error: wErr } = await write.select("rev");
      if (wErr) return NextResponse.json({ error: "write_error", message: wErr.message }, { status: 500 });
      if (updated && updated.length > 0) { written = { ...loc, blob, data }; break; }
      // Conflitto di versione: rileggo la stessa riga fresca e riprovo.
      loc = await locateStore(admin, ownerId, sid, loc);
    }
    if (!written) return NextResponse.json({ error: "write_conflict" }, { status: 409 });
    const blob = written.blob;
    const data = written.data;

    // Notifica email al gestore (se ha l'interruttore "Nuove recensioni" attivo e una email
    // sulla struttura) — fire-and-forget, non deve mai far fallire la pubblicazione della
    // recensione. Stesso kind:"notify" già usato per prenotazioni/pagamenti.
    try {
      const notifs = parseNotifPrefs(blob["spigolestay:notifs"]);
      if (notifs.review) {
        const structuresArr = (Array.isArray(data.structures) ? data.structures : []) as { id: string; name?: string; email?: string; photoColor?: string; logo?: string }[];
        const st = structuresArr.find((s) => s.id === sid);
        if (st?.email) {
          const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://xenora.it";
          internalFetch(`${origin}/api/email`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "notify", to: st.email, accent: st.photoColor, event: "review", channelLabel: "Diretto", structureName: st.name,
              brand: { name: st.name, logoUrl: st.logo && /^https?:\/\//i.test(st.logo) ? st.logo : undefined, color: st.photoColor },
              ctaUrl: `${origin}/recensioni`, ctaLabel: "Apri le recensioni",
              subject: `Nuova recensione · ${guest} · ${st.name || "Xenora"}`,
              text: `${guest}\n${"★".repeat(stars)}${"☆".repeat(5 - stars)} (${rating}/10)\n\n${text || "(nessun testo)"}`,
            }),
          }).catch(() => {});
        }
      }
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
