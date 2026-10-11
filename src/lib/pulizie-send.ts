// Consegna del Planning pulizie (email + WhatsApp) di UNA struttura. Usata dal cron giornaliero e dal pulsante "Invia ora" di Pulizie → Invio automatico:
// stessa logica, così la prova mostra esattamente cosa succederà con l'invio automatico.
import type { SupabaseClient } from "@supabase/supabase-js";
import { internalFetch } from "@/lib/server-auth";
import { sendWhatsapp } from "@/lib/whatsapp";
import { logInvio } from "@/lib/invii-log";
import { computePuliziePlan, buildPuliziePlanText } from "@/lib/puliziePlan";
import type { Booking, Unit, RoomType, Structure, Guest } from "@/lib/types";

export interface PulizieSendCfg { email: boolean; emailTo: string; whatsapp: boolean; whatsappTo: string }
export interface PulizieSendResult { channel: "email" | "whatsapp"; ok: boolean; detail: string }

/** Data (Y-M-D) e "HH:MM" adesso nel fuso Europe/Rome. */
export function romeNowSlot(): { ymd: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { ymd: `${g("year")}-${g("month")}-${g("day")}`, hm: `${g("hour")}:${g("minute")}` };
}

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
  const text = buildPuliziePlanText({ date, scopedStructures: [st], rooms, guests: a.guests, notes: a.notes });
  const subject = `Planning pulizie · ${name} · ${date}`;
  const out: PulizieSendResult[] = [];

  if (cfg.email && cfg.emailTo) {
    let r: PulizieSendResult;
    try {
      const resp = await internalFetch(`${origin}/api/email`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "guest_message", to: cfg.emailTo, subject, text, booking: { structureName: name, color: str(stJ.photoColor), logo: str(stJ.logo) } }),
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
      // Il testo libero viene accettato dall'API ma poi NON consegnato (errore 131047) se il destinatario non ha scritto negli ultimi 24 ore: per questo non è il primo tentativo.
      // (corpo del modello con 3 variabili: {{1}} struttura, {{2}} data, {{3}} planning in una riga)
      let w = await sendWhatsapp(admin, tenantId, { to: cfg.whatsappTo, country: "IT", templateName: process.env.WHATSAPP_PULIZIE_TEMPLATE || "planning_pulizie", lang: "it", params: [name, date, text] });
      const tplErr = w.ok ? "" : w.message;
      if (!w.ok) w = await sendWhatsapp(admin, tenantId, { to: cfg.whatsappTo, country: "IT", text }); // ripiego: arriva solo se il destinatario ha scritto nelle ultime 24 ore
      wamid = w.id;
      r = w.ok
        ? { channel: "whatsapp", ok: true, detail: tplErr ? `testo libero (il modello non è partito: ${tplErr}): consegnato solo se hai scritto negli ultimi 24 ore` : `modello a ${cfg.whatsappTo}` }
        : { channel: "whatsapp", ok: false, detail: `modello: ${tplErr} · testo libero: ${w.message}` };
    } catch (e) { r = { channel: "whatsapp", ok: false, detail: e instanceof Error ? e.message : "errore" }; }
    await logInvio(admin, tenantId, { job: "pulizie", ref: structureId, channel: "whatsapp", ok: r.ok, wamid, detail: r.detail });
    out.push(r);
  }
  return out;
}
