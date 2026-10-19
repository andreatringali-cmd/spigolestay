// Consegna del Planning pulizie (email + WhatsApp) di UNA struttura. Usata dal cron giornaliero e dal pulsante "Invia ora" di Pulizie → Invio automatico:
// stessa logica, così la prova mostra esattamente cosa succederà con l'invio automatico.
import type { SupabaseClient } from "@supabase/supabase-js";
import { internalFetch } from "@/lib/server-auth";
import { sendWhatsapp } from "@/lib/whatsapp";
import { logInvio } from "@/lib/invii-log";
import { computePuliziePlan, buildPuliziePlanText, buildPuliziePlanSummary, buildPuliziePlanFields, fmtLongIT } from "@/lib/puliziePlan";
import type { Booking, Unit, RoomType, Structure, Guest } from "@/lib/types";

export interface PulizieSendCfg { email: boolean; emailTo: string; whatsapp: boolean; whatsappTo: string; intro?: string; outro?: string; subject?: string }
export interface PulizieSendResult { channel: "email" | "whatsapp"; ok: boolean; detail: string }

/** Data (Y-M-D) e "HH:MM" adesso nel fuso Europe/Rome. */
export function romeNowSlot(): { ymd: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { ymd: `${g("year")}-${g("month")}-${g("day")}`, hm: `${g("hour")}:${g("minute")}` };
}

const DETAIL_MAX = 780; // caratteri di variabili: il resto del corpo del modello occupa circa 200 dei 1024 ammessi
const errText = (j: { error?: unknown; message?: unknown } | null | undefined, status: number): string => (typeof j?.error === "string" ? j.error : j?.error ? JSON.stringify(j.error) : j?.message ? String(j.message) : `HTTP ${status}`);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function deliverPuliziePlan(a: {
  admin: SupabaseClient; tenantId: string; origin: string; structure: Structure; cfg: PulizieSendCfg; date: string;
  units: Unit[]; roomTypes: RoomType[]; bookings: Booking[]; guests: Guest[]; notes: Record<string, string>;
}): Promise<PulizieSendResult[]> {
  const { admin, tenantId, origin, structure: st, cfg, date } = a;
  const stJ = st as unknown as Record<string, unknown>;
  const structureId = str(stJ.id), name = str(stJ.name);
  const { rooms } = computePuliziePlan({ date, structures: [st], units: a.units, roomTypes: a.roomTypes, bookings: a.bookings });
  const planArgs = { date, scopedStructures: [st], rooms, guests: a.guests, notes: a.notes };
  const custom = { intro: cfg.intro, outro: cfg.outro }; // riga iniziale e finale scelte dal titolare
  const text = buildPuliziePlanText({ ...planArgs, ...custom, style: "whatsapp" });   // testo completo con grassetti: WhatsApp (ripiego a testo libero)
  const emailText = buildPuliziePlanText({ ...planArgs, ...custom, style: "plain" }); // email: niente asterischi
  const summary = buildPuliziePlanSummary(planArgs);
  // Una voce per tipo di lavoro, per il modello WhatsApp "a righe". Prima la versione dettagliata (chi esce, chi entra, persone, fino a quando: come nel messaggio condiviso a mano);
  // il corpo del modello Meta ha un limite (1024 caratteri in tutto), quindi se il dettaglio non ci sta si ripiega sulla versione con i soli numeri delle camere.
  const detailedF = buildPuliziePlanFields({ ...planArgs, detailed: true });
  const detailedLen = Object.values(detailedF).reduce((n, v) => n + v.length, 0);
  const f = detailedLen <= DETAIL_MAX ? detailedF : buildPuliziePlanFields(planArgs);
  const dateLong = fmtLongIT(date);                                         // "domenica 11.10.2026" invece di "2026-10-11"
  const subject = (cfg.subject ?? "").trim() || `Planning pulizie · ${name} · ${dateLong}`; // oggetto scelto dal titolare, altrimenti quello standard
  const out: PulizieSendResult[] = [];

  if (cfg.email && cfg.emailTo) {
    let r: PulizieSendResult;
    try {
      const resp = await internalFetch(`${origin}/api/email`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "guest_message", lang: "it", to: cfg.emailTo, subject, text: emailText, booking: { structureName: name, color: str(stJ.photoColor), logo: str(stJ.logo) } }),
      });
      const j = await resp.json().catch(() => ({}));
      r = resp.ok && j?.ok ? { channel: "email", ok: true, detail: cfg.emailTo } : { channel: "email", ok: false, detail: errText(j, resp.status) };
    } catch (e) { r = { channel: "email", ok: false, detail: e instanceof Error ? e.message : "errore" }; }
    await logInvio(admin, tenantId, { job: "pulizie", ref: structureId, channel: "email", ok: r.ok, detail: r.detail });
    out.push(r);
  }

  if (cfg.whatsapp && cfg.whatsappTo) {
    let r: PulizieSendResult; let wamid: string | undefined;
    try {
      // Il planning parte senza che il destinatario abbia scritto: per Meta è un messaggio "a freddo" e VA mandato col modello approvato.
      // Il testo libero viene accettato dall'API ma poi NON consegnato (errore 131047) se il destinatario non ha scritto nelle ultime 24 ore: per questo non è il primo tentativo.
      // (corpo del modello con 3 variabili: {{1}} struttura, {{2}} data, {{3}} planning in una riga)
      // 1) modello "a righe" (una riga per tipo di lavoro; si crea su Meta con il nome qui sotto); 2) se non esiste o non è approvato, il vecchio modello a una riga.
      const V2 = process.env.WHATSAPP_PULIZIE_TEMPLATE_V2 || "planning_pulizie_righe";
      let w = await sendWhatsapp(admin, tenantId, { to: cfg.whatsappTo, country: "IT", templateName: V2, lang: "it", params: [name, dateLong, f.cambio, f.arrivi, f.partenze, f.riassetto, f.fuori, f.niente] });
      if (!w.ok) w = await sendWhatsapp(admin, tenantId, { to: cfg.whatsappTo, country: "IT", templateName: process.env.WHATSAPP_PULIZIE_TEMPLATE || "planning_pulizie", lang: "it", params: [name, dateLong, summary] });
      const tplErr = w.ok ? "" : w.message;
      if (!w.ok) w = await sendWhatsapp(admin, tenantId, { to: cfg.whatsappTo, country: "IT", text }); // ripiego: arriva solo se il destinatario ha scritto nelle ultime 24 ore
      wamid = w.id;
      r = w.ok
        ? { channel: "whatsapp", ok: true, detail: tplErr ? `testo libero (il modello non è partito: ${tplErr}): consegnato solo se hai scritto nelle ultime 24 ore` : `modello a ${cfg.whatsappTo}` }
        : { channel: "whatsapp", ok: false, detail: `modello: ${tplErr} · testo libero: ${w.message}` };
    } catch (e) { r = { channel: "whatsapp", ok: false, detail: e instanceof Error ? e.message : "errore" }; }
    await logInvio(admin, tenantId, { job: "pulizie", ref: structureId, channel: "whatsapp", ok: r.ok, wamid, detail: r.detail });
    out.push(r);
  }
  return out;
}
