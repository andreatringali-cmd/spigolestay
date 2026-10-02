// Assistente AI: costruisce un riepilogo compatto dei dati (già filtrati per la struttura selezionata)
// da mandare a /api/assistant/ask, così l'AI risponde a domande libere che le regole non capiscono.
// Il riepilogo nasce dallo store del browser: stessi dati e stesso perimetro che vede l'utente.

import type { AssistantCtx } from "./assistant";
import { CHANNELS } from "./types";
import { apiPost } from "./invoicing/client";

export interface AiTurn { role: "user" | "assistant"; text: string }

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const nightsOf = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
const MAX_LINES = 260;

export function buildDigest(ctx: AssistantCtx): string {
  const { today } = ctx;
  const todayISO = iso(today);
  const all = ctx.activeStructureId === "all";
  const scopedUnits = ctx.units.filter((u) => all || u.structureId === ctx.activeStructureId);
  const scopedStructures = ctx.structures.filter((s) => all || s.id === ctx.activeStructureId);
  const structName = (id: string) => ctx.structures.find((s) => s.id === id)?.name ?? "";
  const unitName = (id: string | null) => ctx.units.find((u) => u.id === id)?.name ?? "da assegnare";
  const guestOf = (id: string) => ctx.guests.find((g) => g.id === id);
  const live = ctx.bookings.filter((b) => (all || b.structureId === ctx.activeStructureId) && b.status !== "cancelled" && b.channel !== "blocked");
  const complete = (id: string) => { const g = guestOf(id); return !!(g && (g.lastName || g.fullName) && g.sex && g.birthDate && g.birthPlace && g.citizenship && g.docType && g.docNumber); };

  const out: string[] = [];
  out.push(`OGGI: ${today.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${todayISO})`);
  out.push(`PERIMETRO: ${all ? "tutte le strutture" : structName(ctx.activeStructureId) || "struttura selezionata"}`);
  out.push(`STRUTTURE E CAMERE: ${scopedStructures.map((s) => `${s.name} (${scopedUnits.filter((u) => u.structureId === s.id && !u.outOfService).map((u) => u.name).join(", ") || "nessuna camera"})`).join("; ")}`);

  // Indicatori di oggi
  const usable = scopedUnits.filter((u) => !u.outOfService);
  const inHouse = live.filter((b) => b.checkIn <= todayISO && todayISO < b.checkOut);
  const occ = inHouse.filter((b) => b.unitId && usable.some((u) => u.id === b.unitId)).length;
  const due = live.filter((b) => b.checkOut >= todayISO).reduce((a, b) => a + Math.max(0, (b.total ?? 0) + (b.cleaningFee ?? 0) - (b.paid ?? 0)), 0);
  out.push(`OGGI IN NUMERI: arrivi ${live.filter((b) => b.checkIn === todayISO).length}, partenze ${live.filter((b) => b.checkOut === todayISO).length}, in struttura ${inHouse.length}, occupazione ${usable.length ? Math.round((occ / usable.length) * 100) : 0}% (${occ}/${usable.length} camere), saldi aperti ${Math.round(due)} €`);
  const openQuotes = (all ? ctx.quotes : ctx.quotes.filter((q) => !q.structureId || q.structureId === ctx.activeStructureId)).filter((q) => q.status !== "confermato");
  out.push(`PREVENTIVI APERTI: ${openQuotes.length} (valore ${Math.round(openQuotes.reduce((a, q) => a + (q.total ?? 0), 0))} €)`);

  // Totali per mese di arrivo (anno corrente e precedente)
  const y0 = today.getFullYear();
  const months: string[] = [];
  for (const y of [y0 - 1, y0]) for (let m = 1; m <= 12; m++) {
    const key = `${y}-${pad(m)}`;
    const list = live.filter((b) => b.checkIn.startsWith(key));
    if (!list.length) continue;
    const nn = list.reduce((a, b) => a + nightsOf(b.checkIn, b.checkOut), 0);
    months.push(`${key}: ${list.length} pren., ${nn} notti, ricavi ${Math.round(list.reduce((a, b) => a + (b.total ?? 0), 0))} €, incassato ${Math.round(list.reduce((a, b) => a + (b.paid ?? 0), 0))} €`);
  }
  if (months.length) out.push(`TOTALI PER MESE DI ARRIVO:\n${months.join("\n")}`);

  // Elenco prenotazioni nella finestra utile (30 giorni indietro, 150 avanti)
  const from = iso(addDays(today, -30)), to = iso(addDays(today, 150));
  const win = live.filter((b) => b.checkOut >= from && b.checkIn <= to).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const lines = win.slice(0, MAX_LINES).map((b) => {
    const g = guestOf(b.guestId);
    const flags = [
      (g?.tags ?? []).includes("Animali") ? "animali" : "",
      b.webCheckin ? "check-in online fatto" : "check-in online da fare",
      b.checkIn >= todayISO ? (complete(b.guestId) ? "schedina ok" : "schedina mancante") : "",
      b.parking ? "parcheggio" : "",
      b.cityTaxExempt ? "esente tassa" : b.cityTaxPaid ? "tassa incassata" : "",
    ].filter(Boolean).join(", ");
    const resid = Math.max(0, (b.total ?? 0) + (b.cleaningFee ?? 0) - (b.paid ?? 0));
    return `${g?.fullName ?? "Ospite"} | ${unitName(b.unitId)}${all ? ` (${structName(b.structureId)})` : ""} | ${b.checkIn}→${b.checkOut} (${nightsOf(b.checkIn, b.checkOut)} n) | ${b.adults}+${b.children} | ${CHANNELS[b.channel]?.label ?? b.channel} | totale ${Math.round(b.total ?? 0)} € pagato ${Math.round(b.paid ?? 0)} € residuo ${Math.round(resid)} € | ${flags}${g?.country ? ` | ${g.country}` : ""}`;
  });
  out.push(`PRENOTAZIONI (da ${from} a ${to}${win.length > MAX_LINES ? `, mostrate ${MAX_LINES} su ${win.length}` : ""}):\n${lines.join("\n") || "nessuna"}`);
  return out.join("\n");
}

export async function askAssistantAi(question: string, ctx: AssistantCtx, history: AiTurn[] = []): Promise<string> {
  const r = await apiPost<{ ok: boolean; reply?: string; error?: string }>("assistant/ask", {
    question: question.slice(0, 600),
    digest: buildDigest(ctx),
    history: history.slice(-6),
  });
  if (!r.reply) throw new Error("Nessuna risposta");
  return r.reply;
}
