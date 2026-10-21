import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { internalFetch, siteOrigin } from "@/lib/server-auth";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsapp } from "@/lib/whatsapp";
import { logInvio } from "@/lib/invii-log";
import { waTemplateFrom } from "@/lib/wa-template";
import { windowOpenFrom } from "@/lib/wa-window";
import { stepsOfTemplate } from "@/lib/auto-schedule";
import { REVIEW_SETTINGS_KEY, parseReviewSettings, reviewLinksFor, reviewTokens, reviewDecision, usesReviewLinks, oneLine } from "@/lib/auto-review";
import { buildGuideUrl, structureWhatsapp, WHATSAPP_FALLBACK } from "@/lib/auto-guide-link";
import { guestLangOf } from "@/lib/guest-lang";
import { todayRome } from "@/lib/dates-rome";
import { eur } from "@/lib/format";
import { waDigits } from "@/lib/contacts-check";
import { setGroupTaxContext } from "@/lib/booking";
import { messageBalance } from "@/lib/msg-balance";
import { asLang, autoSubject, bulkImportDays, checkinDoneText, decideSend, dedupeGroups, dropRedundantRecovery, fillTokens, guestFallback, orgBlobFor, remKindsOf, stayTimeText, structureFallback, whatsappUsable } from "@/lib/auto-messages-core";
import { loadUserBlob, markReviewRequested, ownerOfOrg, recordAutoSent } from "@/lib/auto-trace";
import type { Structure } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Il cron scorre tutti gli account e invia uno per uno (email + WhatsApp + registro): il tetto di default (10 s) non basta. 60 s è il massimo
// consentito su ogni piano; con il «Fluid compute» o un piano superiore si può portare a 300.
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// CRON: messaggi automatici agli ospiti (Fase 2 — invio dal SERVER, senza click).
//
// Per ogni account (app_state/org_state) legge i "modelli & automazioni"
// (localStorage key `spigolestay:msgtemplates`) e le prenotazioni; per ogni modello
// automatico attivo calcola la data/orario previsti rispetto a check-in/check-out e,
// quando è il momento, invia l'email all'ospite (via /api/email kind guest_message).
// Anti-duplicati: tabella `auto_message_log` (unico per tenant+booking+template+giorno); in più, prima dell'invio, si controlla
// che per la stessa prenotazione e lo stesso modello non ci sia già una riga (qualunque giorno): se le date vengono spostate dopo l'invio non si rimanda.
//
// STRUTTURE CONDIVISE (org_state): la riga dell'organizzazione ha solo i dati condivisi. Modelli, codici per camera, guide, impostazioni recensioni
// e collegamento WhatsApp stanno nel blob PERSONALE del titolare (memberships role=owner): vengono letti da lì (vedi lib/auto-messages-core.ts → orgBlobFor).
//
// SICUREZZA: l'invio REALE avviene solo se AUTO_MESSAGES_LIVE=1 (interruttore lato
// server). Senza, il cron gira in "dry-run": calcola quanti messaggi partirebbero
// ma NON invia nulla. Così niente email agli ospiti finché non lo attivi tu.
//
// REGOLE: niente messaggi alle prenotazioni provvisorie; un solo messaggio per gruppo di camere; recupero last-minute (prenotazione creata dopo il giorno previsto,
// arrivo non ancora trascorso); {link_checkin} non si manda se il check-in online è già fatto; {saldo} non si manda a saldo zero; WhatsApp a testo libero
// solo con la finestra di 24 ore aperta (altrimenti serve un modello approvato, o si usa l'email). Dopo l'invio il messaggio compare nella chat dell'ospite,
// nel registro «Invii programmati» e (recensione) sulla prenotazione.
//
// RICHIESTA RECENSIONE (modelli con {link_recensioni}/{link_google}/{link_tripadvisor} o dello scopo "recensione" dopo il check-out): si invia solo se
// la prenotazione è confermata, non già sollecitata a mano, l'ospite non è «Da recuperare» (e, se l'host lo accende, non ha segnalato problemi) e c'è almeno un
// link (Google/Tripadvisor); vedi lib/auto-review.ts. PRE-ARRIVO: {link_guida} è il link personale della guida (con codici camera), {whatsapp} il numero della struttura.
//
// Auth: Bearer <CRON_SECRET> (Vercel Cron) oppure ?secret= per test.
// ─────────────────────────────────────────────────────────────────────────────

const errText = (j: { error?: unknown; message?: unknown } | null | undefined, status: number): string => (typeof j?.error === "string" ? j.error : j?.error ? JSON.stringify(j.error) : j?.message ? String(j.message) : `HTTP ${status}`);
type Json = Record<string, unknown>;
const DATA_KEY = "spigolestay:data:v1";
const TPL_KEY = "spigolestay:msgtemplates";
const GUIDES_KEY = "spigolestay:guides";
const ROOMACCESS_KEY = "spigolestay:roomaccess";
const THREADS_KEY = "spigolestay:threads:v1";
const SL_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

type Trigger = "manual" | "before_arrival" | "on_arrival" | "after_arrival" | "on_checkout" | "after_checkout";
interface Tpl { id: string; name: string; texts: Record<string, string>; trigger: Trigger; days: number; time: string; active: boolean; waTemplate?: string; structureIds?: string[]; srcId?: string }

const nights = (ci?: string, co?: string) => { if (!ci || !co) return 0; return Math.max(0, Math.round((Date.parse(co) - Date.parse(ci)) / 86400000)); };

/** /g/<codice> al posto del link lungo della guida/check-in (come il pulsante «Invia guida»). Se qualcosa va storto resta il link originale. */
async function shorten(admin: SupabaseClient, fullUrl: string): Promise<string> {
  try {
    const u = new URL(fullUrl);
    const target = u.pathname + u.search;
    if (!target.startsWith("/guida/") && !target.startsWith("/checkin")) return fullUrl;
    let code = ""; for (let i = 0; i < 6; i++) code += SL_ALPHABET[Math.floor(Math.random() * SL_ALPHABET.length)];
    const { error } = await admin.from("short_links").insert({ code, target });
    return error ? fullUrl : `${u.origin}/g/${code}`;
  } catch { return fullUrl; }
}

// Messaggi automatici agli ospiti SPENTI (decisione del titolare, ottobre 2026): i messaggi li manda lui, a mano, dalla scheda della prenotazione.
// Il cron non è più programmato in vercel.json e, se qualcuno lo chiama lo stesso, non invia nulla. Per riaccenderlo: rimettere la riga in vercel.json e questa costante a true.
const GUEST_AUTO_MESSAGES_ENABLED = false;

export async function GET(req: Request) {
  if (!GUEST_AUTO_MESSAGES_ENABLED) return NextResponse.json({ ok: true, skipped: "messaggi_automatici_disattivati" });
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, skipped: "no_secret" });
  if (!cronAuthorized(req, secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !service) return NextResponse.json({ ok: false, skipped: "supabase_not_configured" });
  const admin = createClient(supaUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const live = process.env.AUTO_MESSAGES_LIVE === "1";
  // Indirizzo FISSO del sito: l'origine della richiesta del cron è quella del deployment (…vercel.app), protetta da autenticazione → "Protected deployment 401".
  const origin = siteOrigin(req);
  // Su piano Hobby il cron gira UNA volta al giorno: inviamo tutti i messaggi previsti per
  // oggi al run giornaliero (l'orario del modello è indicativo). Dedup per prenotazione+modello.
  const today = todayRome();

  let accounts = 0, candidates = 0, sent = 0, waSent = 0, skippedReview = 0, skippedNoLink = 0, skippedWaClosed = 0, recovered = 0, skippedDup = 0, skippedOther = 0;
  const errors: string[] = [];
  const CAP = 300; // tetto di sicurezza per esecuzione
  // Tetto di tempo: la funzione muore a 60 s (maxDuration) e, se interrotta tra il claim e l'invio, il `finally` non gira e il claim resterebbe senza messaggio
  // (il modello non partirebbe più per quella prenotazione). Oltre ~50 s non si avvia nessun nuovo invio: quelli non elaborati non hanno il claim e ripartono al giro dopo.
  const started = Date.now();
  const TIME_BUDGET_MS = 50_000;
  let timeUp = false;
  const overBudget = () => { if (!timeUp && Date.now() - started > TIME_BUDGET_MS) { timeUp = true; errors.push("time_budget"); } return timeUp; };

  // Titolare di ogni organizzazione e suo blob personale (letti al massimo una volta).
  const ownerCache = new Map<string, string | null>();
  const blobCache = new Map<string, Record<string, string> | null>();
  const ownerOf = async (orgId: string) => { if (!ownerCache.has(orgId)) ownerCache.set(orgId, await ownerOfOrg(admin, orgId)); return ownerCache.get(orgId) ?? null; };
  const blobOf = async (userId: string) => { if (!blobCache.has(userId)) blobCache.set(userId, await loadUserBlob(admin, userId)); return blobCache.get(userId) ?? null; };

  /**
   * Elabora una riga. `tenantId` = chiave del registro anti-doppioni (user_id o org_id); per le righe org `orgId` è l'organizzazione e `ownerId` il titolare, da cui
   * arrivano modelli/codici/guide/recensioni e il collegamento WhatsApp.
   */
  const processRow = async (tenantId: string, rowBlob: Record<string, string>, org?: { orgId: string }) => {
    let ownerId = tenantId;
    let ownerBlob: Record<string, string> | null = null;
    let blob = rowBlob;
    if (org) {
      const o = await ownerOf(org.orgId);
      if (!o) return; // organizzazione senza titolare riconoscibile: niente modelli, niente credenziali
      ownerId = o;
      ownerBlob = await blobOf(o);
      blob = orgBlobFor(rowBlob, ownerBlob);
    }
    let data: Json = {}; let tpls: Tpl[] = [];
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { return; }
    try { tpls = (JSON.parse(blob[TPL_KEY] || "[]") as Tpl[]).filter((tp) => tp && tp.trigger !== "manual" && tp.active); } catch { tpls = []; }
    if (!tpls.length) return;
    accounts++;
    const bookings = arr(data.bookings);
    // Ospiti: quelli della riga; per le strutture condivise anche l'anagrafica del titolare (gli ospiti restano nel personale).
    const guests = new Map<string, Json>();
    if (org && ownerBlob) { try { for (const g of arr((JSON.parse(ownerBlob[DATA_KEY] || "{}") as Json).guests)) guests.set(s(g.id), g); } catch { /* anagrafica non leggibile */ } }
    for (const g of arr(data.guests)) guests.set(s(g.id), g as Json);
    const structures = new Map(arr(data.structures).map((x) => [s((x as Json).id), x as Json]));
    const units = new Map(arr(data.units).map((u) => [s((u as Json).id), u as Json]));
    const roomTypes = new Map(arr(data.roomTypes).map((r) => [s((r as Json).id), r as Json]));
    const reviewSettings = parseReviewSettings(blob[REVIEW_SETTINGS_KEY]);
    let guides: Record<string, Json> = {}; try { guides = JSON.parse(blob[GUIDES_KEY] || "{}") as Record<string, Json>; } catch { guides = {}; }
    // Chat dell'ospite (per la finestra WhatsApp di 24 ore): vive nel blob personale del titolare.
    let threads: Record<string, { dir?: string; ts?: number }[]> = {};
    try { threads = JSON.parse((org ? ownerBlob ?? {} : blob)[THREADS_KEY] || "{}"); } catch { threads = {}; }
    const store = org ? { table: "org_state" as const, keyCol: "org_id" as const, keyVal: org.orgId } : { table: "app_state" as const, keyCol: "user_id" as const, keyVal: tenantId };

    // Tassa di soggiorno dei gruppi: quote calcolate sull'insieme delle camere (come l'app), così {saldo} coincide con il voucher.
    try { setGroupTaxContext(bookings as never, (id) => structures.get(id) as unknown as Structure | undefined); } catch { /* resta il calcolo per camera */ }

    // Prenotazioni con cui lavorare: né annullate/no-show/blocchi, né provvisorie. Un solo messaggio per gruppo di camere.
    const live0 = bookings.filter((bk) => { const st = s(bk.status), ch = s(bk.channel); return st !== "cancelled" && st !== "no_show" && st !== "tentative" && ch !== "blocked" && s(bk.checkIn) && s(bk.checkOut); });
    const grp = dedupeGroups(live0.map((bk) => ({ id: s(bk.id), groupId: s(bk.groupId) || undefined, guestId: s(bk.guestId) || undefined, structureId: s(bk.structureId) || undefined, checkIn: s(bk.checkIn), bk })), { byGuest: true });
    // Giorni di import in blocco da Channex (prima connessione): la loro «data di prenotazione» è il giorno dell'import, quindi niente recupero last-minute.
    const bulkDays = bulkImportDays(bookings.map((x) => ({ id: s(x.id), groupId: s(x.groupId) || undefined, structureId: s(x.structureId), source: s(x.source), bookedOn: s(x.bookedOn) })));

    for (const row of grp.keep) {
      if (overBudget()) return;
      const bk = row.bk; const b = bk as Json;
      const bookingId = s(b.id);
      const status = s(b.status), channel = s(b.channel);
      const checkIn = s(b.checkIn), checkOut = s(b.checkOut);
      const members = grp.membersOf.get(bookingId); // id di tutte le camere del gruppo (se è un gruppo)
      const groupBookings = members ? bookings.filter((x) => members.includes(s((x as Json).id))) : [bk];
      const g = guests.get(s(b.guestId)) || (b.primaryGuest as Json) || {};
      const email = s(g.email);
      const phone = s(g.phone);
      if (!email && !phone) continue; // niente email né telefono → nessun canale
      const st = structures.get(s(b.structureId)) || {};
      const unit = units.get(s(b.unitId)) || {};
      const rt = roomTypes.get(s(b.roomTypeId)) || {};
      const lang = asLang(guestLangOf({ language: s(g.lang) || s(g.language), country: s(g.country), phone })); // lingua della scheda, altrimenti Paese/prefisso
      const nn = nights(checkIn, checkOut);
      const emptyStructure = !s(st.name).trim();
      const roomNames = groupBookings.map((x) => { const xu = units.get(s((x as Json).unitId)) || {}; const xr = roomTypes.get(s((x as Json).roomTypeId)) || {}; return s(xu.name) || s(xr.name); }).filter(Boolean);
      const balance = messageBalance(b as never, st as unknown as Structure, groupBookings.length > 1 ? (groupBookings as never) : undefined);
      const ctx: Record<string, string> = {
        ospite: s(g.firstName) || s(g.fullName).split(" ")[0] || guestFallback(lang),
        struttura: emptyStructure ? structureFallback(lang) : s(st.name),
        camera: groupBookings.length > 1 ? Array.from(new Set(roomNames)).join(", ") : s(unit.name) || s(rt.name),
        checkin: stayTimeText("checkin", lang, checkIn, s(st.checkInFrom)),
        checkout: stayTimeText("checkout", lang, checkOut, s(st.checkOutBy)),
        notti: String(nn),
        codice_accesso: s(unit.accessInfo) || s(st.accessInfo),
        saldo: balance > 0.004 ? eur(balance) : "",
        link_checkin: `${origin}/checkin?b=${bookingId}`,
        // Link PERSONALE della guida (struttura + camera + codici + nome), come quello copiato a mano dalla chat; l'indirizzo scelto a mano nella struttura ha la precedenza.
        link_guida: s(st.guideUrl) || buildGuideUrl({
          origin, structureId: s(b.structureId), guestName: s(g.fullName) || [s(g.firstName), s(g.lastName)].filter(Boolean).join(" "), roomAccess: blob[ROOMACCESS_KEY], lang,
          rooms: groupBookings.filter((x) => s((x as Json).status) !== "cancelled").map((x) => {
            const xu = units.get(s((x as Json).unitId)) || {};
            return { unitId: s((x as Json).unitId) || null, unitCode: s(xu.code) || s(xu.name), parking: !!(x as Json).parking };
          }),
        }) || s(st.website) || "",
        whatsapp: structureWhatsapp(st) || WHATSAPP_FALLBACK[lang] || WHATSAPP_FALLBACK.it,
        ...reviewTokens(reviewLinksFor({ structureId: s(b.structureId), placeId: s(st.googlePlaceId), guideReviewUrl: s(guides[s(b.structureId)]?.reviewUrl), settings: reviewSettings })),
      };
      const waWindowOpen = windowOpenFrom(threads, s(b.guestId)) || windowOpenFrom(threads, `wa:${waDigits(phone, s(g.country))}`);

      // Decisioni di tutti i modelli per questa prenotazione (modello legato a specifiche strutture: vale solo per le loro prenotazioni; assente/vuoto = tutte).
      // Un recupero last-minute che ripete gli stessi passaggi di un modello già dovuto oggi non parte (sarebbero due messaggi quasi uguali).
      const bulkImport = s(b.source) === "channex" && bulkDays.has(`${s(b.structureId)}|${s(b.bookedOn).slice(0, 10)}`);
      const decs = tpls
        .filter((tp) => !(tp.structureIds?.length && !tp.structureIds.includes(s(b.structureId))))
        .map((tp) => ({ tp, tpl: tp, dec: decideSend({ tpl: tp, booking: { status, checkIn, checkOut, webCheckin: b.webCheckin === true, bookedOn: s(b.bookedOn), bulkImport }, today, balance }) }));
      const redundant = dropRedundantRecovery(decs);

      for (const { tp, dec } of decs) {
        if (overBudget()) return;
        if (dec.send && dec.recovery && redundant.has(tp.id)) { skippedOther++; continue; }
        if (!dec.send) { if (dec.reason !== "not_due" && dec.reason !== "no_slot") skippedOther++; continue; }
        const slot = dec.slot;
        // Richiesta di recensione: regole di esclusione e almeno un link, altrimenti non si invia nulla (e non si consuma lo slot).
        const isReview = stepsOfTemplate(tp).includes("review");
        if (isReview) {
          if (!reviewDecision({ status, channel, reviewRequestedAt: num(b.reviewRequestedAt) || undefined, note: s(b.note), guestRequests: s(b.guestRequests) }, { tags: Array.isArray(g.tags) ? (g.tags as string[]) : [], notes: s(g.notes) }, reviewSettings).send) { skippedReview++; continue; }
          if (usesReviewLinks(Object.values(tp.texts ?? {}).join("\n")) && !ctx.link_recensioni) { skippedNoLink++; continue; }
        }
        // Già inviato in passato per questa prenotazione (o una camera del gruppo) e questo modello? Vale anche se le date sono state spostate dopo l'invio.
        const dupIds = members ?? [bookingId];
        const dupQ = await admin.from("auto_message_log").select("id").eq("tenant_id", tenantId).eq("template_id", tp.id).in("booking_id", dupIds).limit(1);
        if (dupQ.error) { errors.push(`dup: ${dupQ.error.message}`); continue; }
        if (dupQ.data && dupQ.data.length > 0) { skippedDup++; continue; }
        candidates++;
        if (dec.recovery) recovered++;
        if (!live) continue; // dry-run: non inviare
        if (sent + waSent >= CAP) { errors.push("cap_reached"); return; }
        // Claim anti-duplicato: inserisce la riga; se già presente (conflict) salta.
        const claim = await admin.from("auto_message_log")
          .upsert({ tenant_id: tenantId, booking_id: bookingId, template_id: tp.id, slot_date: slot }, { onConflict: "tenant_id,booking_id,template_id,slot_date", ignoreDuplicates: true })
          .select("id");
        if (claim.error) { errors.push(`claim: ${claim.error.message}`); continue; }
        if (!claim.data || claim.data.length === 0) continue; // già inviato in precedenza
        let okAny = false;
        try {
          const raw0 = tp.texts?.[lang] || tp.texts?.it || "";
          // Link lunghi (guida con codici, check-in) accorciati solo se il testo li usa.
          const sctx = { ...ctx };
          if (/\{link_guida\}/i.test(raw0)) sctx.link_guida = await shorten(admin, ctx.link_guida);
          if (/\{link_checkin\}/i.test(raw0)) sctx.link_checkin = b.webCheckin === true ? checkinDoneText(lang) : await shorten(admin, ctx.link_checkin);
          const text = fillTokens(raw0, sctx, { lang, emptyStructure });
          if (!text) continue; // (il claim si libera nel finally)
          let emailOk = false, waOk = false, waId: string | undefined;
          // Canale 1: EMAIL (se l'ospite ha email). Oggetto nella lingua dell'ospite, mai il nome interno del modello.
          if (email) {
            try {
              const r = await internalFetch(`${origin}/api/email`, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ kind: "guest_message", lang, to: email, subject: autoSubject(lang, s(st.name), checkIn), text, booking: { structureName: s(st.name), structureEmail: s(st.email), color: s(st.photoColor), logo: s(st.logo), website: s(st.website), address: [s(st.address), s(st.streetNumber), s(st.city)].filter(Boolean).join(" "), phone: s(st.phone), cin: s(st.cin), vat: s(st.vat) }, replyTo: s(st.email) || undefined }),
              });
              const j = await r.json().catch(() => ({}));
              if (r.ok && j?.ok) { emailOk = true; sent++; await logInvio(admin, ownerId, { job: "messaggi", ref: bookingId, channel: "email", ok: true, detail: `${tp.name || tp.id} → ${email}` }); }
              else { errors.push(`mail ${bookingId}/${tp.id}: ${errText(j, r.status)}`); await logInvio(admin, ownerId, { job: "messaggi", ref: bookingId, channel: "email", ok: false, detail: `${tp.name || tp.id} → ${email}: ${errText(j, r.status)}` }); }
            } catch (e) { errors.push(`mail ${bookingId}: ${e instanceof Error ? e.message : "err"}`); }
          }
          // Canale 2: WHATSAPP (se WA collegato per il titolare e l'ospite ha numero). Per i messaggi "a freddo" (proattivi) Meta richiede un template approvato:
          // se il modello ha waTemplate lo usa; altrimenti testo libero, che WhatsApp consegna SOLO entro 24h dall'ultimo messaggio dell'ospite → a finestra chiusa
          // WhatsApp si salta in silenzio (nessun errore nel registro: non è un guasto) e resta l'email, se c'è.
          if (phone) {
            if (!whatsappUsable({ hasTemplate: !!tp.waTemplate, windowOpen: waWindowOpen })) skippedWaClosed++;
            else {
              try {
                // Col modello approvato: i valori delle variabili {{1}}, {{2}}… sono i segnaposto del testo, in ordine di apparizione (vedi lib/wa-template).
                const params = tp.waTemplate ? waTemplateFrom(raw0).tokens.map((k) => oneLine(sctx[k] || "-")) : undefined; // Meta non ammette a capo nei valori
                const w = await sendWhatsapp(admin, ownerId, { to: phone, country: s(g.country), text, templateName: tp.waTemplate || undefined, lang, params });
                if (w.ok) { waOk = true; waId = w.id; waSent++; await logInvio(admin, ownerId, { job: "messaggi", ref: bookingId, channel: "whatsapp", ok: true, wamid: w.id, detail: `${tp.name || tp.id} → ${phone}` }); }
                else if (w.message && !/non collegato/i.test(w.message)) { errors.push(`wa ${bookingId}/${tp.id}: ${w.message}`); await logInvio(admin, ownerId, { job: "messaggi", ref: bookingId, channel: "whatsapp", ok: false, detail: `${tp.name || tp.id} → ${phone}: ${w.message}` }); }
              } catch (e) { errors.push(`wa ${bookingId}: ${e instanceof Error ? e.message : "err"}`); }
            }
          }
          okAny = emailOk || waOk;
          // Traccia nell'app: chat dell'ospite, registro «Invii programmati», richiesta di recensione sulla prenotazione.
          if (okAny) {
            const via = emailOk && waOk ? "Email e WhatsApp" : emailOk ? "Email" : "WhatsApp";
            const trace = await recordAutoSent(admin, { ownerId, guestId: s(b.guestId), bookingId, text, via, rems: remKindsOf(tp), wid: waId, msgsentKey: `${tp.srcId || tp.id}-${bookingId}-${slot}`, guestName: s(g.fullName) || ctx.ospite, tplName: tp.name || tp.id });
            if (!trace) errors.push(`traccia ${bookingId}/${tp.id}: non scritta`);
            if (isReview) for (const m of groupBookings) await markReviewRequested(admin, store, s((m as Json).id), emailOk ? "email" : "whatsapp");
          }
        } finally {
          // Se nessun canale è andato a buon fine (o è scattata un'eccezione), libera il claim così si riprova al prossimo giro.
          if (!okAny) await admin.from("auto_message_log").delete().eq("tenant_id", tenantId).eq("booking_id", bookingId).eq("template_id", tp.id).eq("slot_date", slot);
        }
      }
    }
  };

  try {
    const scan = async (table: "app_state" | "org_state", keyCol: "user_id" | "org_id") => {
      const { data: rows } = await admin.from(table).select(`${keyCol}, data`).limit(5000);
      for (const row of (rows ?? []) as Json[]) {
        const tenantId = s(row[keyCol]);
        const blob = ((row.data ?? {}) as Record<string, string>) || {};
        if (!tenantId) continue;
        if (overBudget()) break; // tempo esaurito: le righe non elaborate ripartono al giro dopo
        try { await processRow(tenantId, blob, table === "org_state" ? { orgId: tenantId } : undefined); } catch (e) { errors.push(`row ${tenantId.slice(0, 8)}: ${e instanceof Error ? e.message : "err"}`); }
      }
    };
    await scan("app_state", "user_id");
    await scan("org_state", "org_id");
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "scan_failed", accounts, candidates, sent }, { status: 500 });
  }

  return NextResponse.json({ ok: true, live, today, accounts, candidates, recovered, sent, waSent, skippedReview, skippedNoLink, skippedDup, skippedWaClosed, skippedOther, ...(errors.length ? { errors: errors.slice(0, 50) } : {}) });
}
