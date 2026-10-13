import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { allowedChannexProperties } from "@/lib/channex-guard";
import {
  channexEnabled, listFacilityOptions, findHotelPolicyId, saveHotelPolicy, findCancellationPolicyId, updateProperty, uploadPhotoFile, createPhoto, countPhotos,
} from "@/lib/channex";
import { buildHotelPolicyBody, buildPropertyUpdate, matchFacilities, type StructureContent } from "@/lib/channex-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Invia a Channex i dati della struttura che Google Hotel richiede (descrizione, servizi, politica della struttura, posizione) e le foto.
//   POST { action: "sync", propertyId, content }   → { ok, steps: [{ key, label, ok, detail }] }
//   POST { action: "photo", propertyId, dataUrl, description? } → { ok, error? }   (una foto per volta, già ridimensionata dal browser)
// La property deve essere collegata a questo account (channex_map). La chiave Channex non esce mai dal server.

interface Step { key: string; label: string; ok: boolean; detail?: string }

const str = (v: unknown, max = 500): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function sanitizeContent(raw: unknown): StructureContent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, 255);
  if (!name) return null;
  const cp = r.cancelPolicy;
  return {
    name, description: str(r.description, 4000), type: str(r.type, 80), city: str(r.city, 120), address: str(r.address, 255), postalCode: str(r.postalCode, 20),
    country: str(r.country, 60), phone: str(r.phone, 32), email: str(r.email, 200), lat: num(r.lat), lng: num(r.lng),
    services: Array.isArray(r.services) ? r.services.filter((x): x is string => typeof x === "string").slice(0, 60).map((x) => x.slice(0, 80)) : [],
    checkInFrom: str(r.checkInFrom, 5), checkInTo: str(r.checkInTo, 5), checkOutBy: str(r.checkOutBy, 5), smoking: r.smoking === true, pets: r.pets === true, minAge: num(r.minAge),
    cancelPolicy: cp === "flessibile" || cp === "moderata" || cp === "rigida" ? cp : undefined, maxGuests: num(r.maxGuests), currency: str(r.currency, 3),
  };
}

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const propertyId = str(body.propertyId, 80) ?? "";
  if (!propertyId) return NextResponse.json({ ok: false, error: "Struttura non collegata a Channex." }, { status: 400 });
  const allowed = await allowedChannexProperties(auth.admin, auth.tenantId);
  if (!allowed.has(propertyId)) return NextResponse.json({ ok: false, error: "Struttura non trovata per questo account." }, { status: 404 });

  if (body.action === "photo") {
    const m = typeof body.dataUrl === "string" ? body.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
    if (!m) return NextResponse.json({ ok: false, error: "Immagine non valida (servono JPEG, PNG o WebP)." }, { status: 400 });
    const bytes = Uint8Array.from(Buffer.from(m[2], "base64"));
    if (bytes.length > 3_500_000) return NextResponse.json({ ok: false, error: "Foto troppo pesante: riduci la dimensione." }, { status: 413 });
    const up = await uploadPhotoFile(bytes, m[1], `foto.${m[1].split("/")[1] === "jpeg" ? "jpg" : m[1].split("/")[1]}`);
    if (!up.ok || !up.url) return NextResponse.json({ ok: false, error: `Caricamento su Channex non riuscito: ${up.error ?? "errore"}` });
    const ph = await createPhoto(propertyId, up.url, str(body.description, 200));
    return ph.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: `Foto non aggiunta alla struttura: ${ph.error ?? "errore"}` });
  }

  if (body.action !== "sync") return NextResponse.json({ ok: false, error: "Azione sconosciuta." }, { status: 400 });
  const content = sanitizeContent(body.content);
  if (!content) return NextResponse.json({ ok: false, error: "Dati della struttura mancanti." }, { status: 400 });

  const steps: Step[] = [];

  // 1) Servizi → facility di Channex
  let facilityIds: string[] = [];
  const fac = await listFacilityOptions();
  if (!fac.ok) steps.push({ key: "facilities", label: "Servizi", ok: false, detail: `Elenco servizi di Channex non letto: ${fac.error ?? "errore"}` });
  else {
    const m = matchFacilities(content.services, fac.options);
    facilityIds = m.ids;
    steps.push({ key: "facilities", label: "Servizi", ok: m.ids.length > 0, detail: m.ids.length ? `${m.ids.length} servizi abbinati${m.unmatched.length ? ` · senza corrispondenza: ${m.unmatched.join(", ")}` : ""}` : "Nessun servizio abbinato: spunta i servizi in Strutture." });
  }

  // 2) Politica della struttura (orari, internet, parcheggio, animali, fumo): si aggiorna quella esistente o se ne crea una
  let hotelPolicyId: string | undefined;
  const existing = await findHotelPolicyId(propertyId);
  if (!existing.ok) steps.push({ key: "policy", label: "Politica della struttura", ok: false, detail: `Lettura non riuscita: ${existing.error ?? "errore"}` });
  else {
    const saved = await saveHotelPolicy(existing.id, buildHotelPolicyBody(existing.id ? null : propertyId, content));
    hotelPolicyId = saved.id;
    steps.push({ key: "policy", label: "Politica della struttura", ok: saved.ok && !!saved.id, detail: saved.ok ? (existing.id ? "Aggiornata" : "Creata") : `Non salvata: ${saved.error ?? "errore"}` });
  }

  // 3) Politica di cancellazione: Channex non la documenta tra le API. Si cerca solo una già esistente da usare come predefinita.
  let cancellationPolicyId: string | undefined;
  const canc = await findCancellationPolicyId(propertyId);
  if (canc.ok && canc.id) { cancellationPolicyId = canc.id; steps.push({ key: "cancel", label: "Politica di cancellazione", ok: true, detail: "Usata quella già presente su Channex" }); }
  else steps.push({ key: "cancel", label: "Politica di cancellazione", ok: false, detail: "Da creare una volta su Channex (la sua pagina non permette di crearla da qui): struttura → Politiche di cancellazione → imposta come predefinita." });

  // 4) Descrizione, indirizzo, posizione, collegamento di politica e servizi alla struttura
  const upd = await updateProperty(propertyId, buildPropertyUpdate(content, { hotelPolicyId, cancellationPolicyId, facilityIds }));
  steps.push({ key: "property", label: "Descrizione, indirizzo e posizione", ok: upd.ok, detail: upd.ok ? "Inviati" : `Non inviati: ${upd.error ?? "errore"}` });

  // 5) Foto già presenti su Channex (Google ne richiede almeno una): le carichi con "Carica foto per Google"
  const ph = await countPhotos(propertyId);
  steps.push({ key: "photos", label: "Foto", ok: ph.ok && ph.count > 0, detail: !ph.ok ? "Non riesco a leggere le foto di Channex" : ph.count > 0 ? `${ph.count} foto su Channex` : "Nessuna foto su Channex: usa \"Carica foto per Google\" (scegli i file originali dal computer)." });

  return NextResponse.json({ ok: steps.every((s) => s.ok), steps });
}
