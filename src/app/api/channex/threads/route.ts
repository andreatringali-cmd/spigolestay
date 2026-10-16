import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { allowedChannexProperties } from "@/lib/channex-guard";
import {
  channexBase, getMessageThread, listMessageThreadsFor, listThreadMessages, sendThreadMessage, closeMessageThread, markThreadNoReplyNeeded, sendBookingAttachment,
} from "@/lib/channex";
import { parseAttachments } from "@/lib/channex-messages";
import { mergeThreads, noReplySupported, normalizeMessage, normalizeThread, threadAllowed, type OtaThread } from "@/lib/channex-threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Messaggi 2: conversazioni con gli ospiti delle OTA (Booking.com, Airbnb, Expedia) lette e scritte direttamente su Channex.
// Azioni (POST JSON): list · messages · send · send_attachment · close · no_reply.
// L'account Channex è UNICO per tutti i clienti: ogni azione verifica che la property del thread sia tra quelle dell'utente (proprie o di una struttura condivisa).
const MAX_PROPERTIES = 12;     // oltre: si prendono le prime (chiamate a Channex limitate a 20/min)
const PAGES = 2;               // 2 pagine da 100 per property: le conversazioni più recenti bastano per il lavoro quotidiano

// Thread → property, in memoria per qualche minuto: evita una chiamata a Channex per ogni azione sulla stessa conversazione.
const threadCache = new Map<string, { t: OtaThread; at: number }>();
const TTL = 5 * 60_000;

async function loadThread(id: string): Promise<{ t?: OtaThread; error?: string; status?: number }> {
  const hit = threadCache.get(id);
  if (hit && Date.now() - hit.at < TTL) return { t: hit.t };
  const res = await getMessageThread(id);
  if (!res.ok) return { error: res.error || `errore Channex (status ${res.status})`, status: res.status === 404 ? 404 : 502 };
  const t = normalizeThread(res.data?.data);
  if (!t) return { error: "Conversazione non trovata.", status: 404 };
  threadCache.set(id, { t, at: Date.now() });
  return { t };
}

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "list").trim();
  const allowed = await allowedChannexProperties(auth.admin, auth.tenantId);

  if (action === "list") {
    const props = [...allowed].slice(0, MAX_PROPERTIES);
    if (!props.length) return NextResponse.json({ ok: true, threads: [], note: "Nessuna struttura collegata a Channex." });
    const errors: string[] = [];
    const lists = await Promise.all(props.map(async (pid) => {
      const out: OtaThread[] = [];
      for (let page = 1; page <= PAGES; page++) {
        const res = await listMessageThreadsFor(pid, page, 100);
        if (!res.ok) { errors.push(res.error || `errore Channex (status ${res.status})`); break; }
        const rows = Array.isArray(res.data?.data) ? res.data!.data! : [];
        for (const r of rows) { const t = normalizeThread(r); if (t && threadAllowed(t, allowed)) { out.push(t); threadCache.set(t.id, { t, at: Date.now() }); } }
        if (rows.length < 100) break;
      }
      return out;
    }));
    const threads = mergeThreads(lists);
    // Tutte le chiamate fallite e nessuna conversazione: l'app "Messages" non è installata o Channex non risponde. Si dice com'è, senza inventare un elenco vuoto.
    if (!threads.length && errors.length) return NextResponse.json({ ok: false, error: errors[0], threads: [] });
    return NextResponse.json({ ok: true, threads, ...(errors.length ? { partial: true } : {}) });
  }

  const threadId = String(body.threadId || "").trim();
  if (!threadId) return NextResponse.json({ error: "missing_threadId" }, { status: 400 });
  const lt = await loadThread(threadId);
  if (!lt.t) return NextResponse.json({ ok: false, error: lt.error }, { status: lt.status ?? 502 });
  if (!threadAllowed(lt.t, allowed)) return NextResponse.json({ error: "non_autorizzato" }, { status: 403 });
  const thread = lt.t;

  if (action === "messages") {
    const res = await listThreadMessages(threadId, 100);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || `errore Channex (status ${res.status})` });
    const base = channexBase();
    const rows = Array.isArray(res.data?.data) ? res.data!.data! : [];
    const messages = rows.map((r) => normalizeMessage(r, (raw) => parseAttachments(raw, base))).filter((m): m is NonNullable<typeof m> => !!m).sort((a, b) => a.ts - b.ts);
    return NextResponse.json({ ok: true, thread, messages });
  }

  if (action === "send") {
    const text = String(body.text || "").trim();
    if (!text) return NextResponse.json({ error: "missing_text" }, { status: 400 });
    if (text.length > 4000) return NextResponse.json({ ok: false, error: "Messaggio troppo lungo (massimo 4000 caratteri)." });
    if (thread.closed) return NextResponse.json({ ok: false, error: "La conversazione è chiusa su Channex." });
    const res = await sendThreadMessage(threadId, text);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || `errore Channex (status ${res.status})` });
    threadCache.delete(threadId);
    return NextResponse.json({ ok: true });
  }

  if (action === "send_attachment") {
    // L'invio di un file passa dalla prenotazione (l'API non documenta l'allegato su un thread): serve che la conversazione abbia una prenotazione.
    if (!thread.bookingId) return NextResponse.json({ ok: false, error: "Questa conversazione non ha una prenotazione: l'allegato non si può inviare." });
    const base64 = String(body.base64 || "").replace(/^data:[^,]*,/, "");
    const name = String(body.name || "").trim().slice(0, 120) || "allegato";
    const type = String(body.type || "").trim();
    if (!base64) return NextResponse.json({ error: "missing_file" }, { status: 400 });
    if (!/^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(type)) return NextResponse.json({ ok: false, error: "Formato non supportato: solo immagini (JPG, PNG, WebP, GIF) e PDF." });
    if (base64.length > 4_200_000) return NextResponse.json({ ok: false, error: "File troppo grande (massimo circa 3 MB)." });
    const res = await sendBookingAttachment(thread.bookingId, { base64, name, type });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || `errore Channex (status ${res.status})` });
    return NextResponse.json({ ok: true });
  }

  if (action === "close") {
    const res = await closeMessageThread(threadId);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || `errore Channex (status ${res.status})` });
    threadCache.delete(threadId);
    return NextResponse.json({ ok: true });
  }

  if (action === "no_reply") {
    if (!noReplySupported(thread.provider)) return NextResponse.json({ ok: false, error: "\"Non è richiesta una risposta\" è disponibile solo per Booking.com." });
    const res = await markThreadNoReplyNeeded(threadId);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || `errore Channex (status ${res.status})` });
    threadCache.delete(threadId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "azione_non_valida" }, { status: 400 });
}
