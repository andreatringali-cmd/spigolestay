import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { whatsappStatus } from "@/lib/whatsapp";
import { channexEnabled, listProperties } from "@/lib/channex";
import { shadowStructureNames } from "@/lib/entities-shadow";
import { classificaSalute, ultimiMessaggiWa, ENV_NAMES, type ChannexPing, type ChannexMapRow, type EnvFlag, type InvioRow } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_KEY = "spigolestay:data:v1";
const THREADS_KEY = "spigolestay:threads:v1";
const PING_TIMEOUT_MS = 4000;

// Salute del sistema dell'account: semaforo su invii automatici, attività notturne, Channex, WhatsApp e configurazione.
// Solo per utenti autenticati. Risposta SENZA dati personali: date, stati, conteggi; delle variabili d'ambiente solo "presente sì/no".
export async function GET(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const { admin, tenantId } = auth;

  // Ogni lettura è indipendente: se una fallisce, il resto della pagina funziona comunque.
  const [inviiRes, shareRes, mapRes, waRes, stateRes] = await Promise.all([
    admin.from("invii_log").select("at, job, channel, ok, detail").eq("tenant_id", tenantId).order("at", { ascending: false }).limit(300)
      .then((r) => r, () => ({ data: null, error: { message: "x" } })),
    admin.from("pulizie_share_log").select("*").eq("tenant_id", tenantId).order("slot_date", { ascending: false }).limit(1)
      .then((r) => r, () => ({ data: null, error: { message: "x" } })),
    admin.from("channex_map").select("structure_id, last_import_at, updated_at").eq("tenant_id", tenantId)
      .then((r) => r, () => ({ data: null, error: { message: "x" } })),
    whatsappStatus(admin, tenantId).catch(() => ({ connected: false, phoneId: "" })),
    admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle()
      .then((r) => r, () => ({ data: null, error: { message: "x" } })),
  ]);

  const blob = ((stateRes.data as { data?: Record<string, string> } | null)?.data ?? {}) as Record<string, string>;
  const { lastInAt, lastOutAt } = ultimiMessaggiWa(blob[THREADS_KEY]);

  // Nomi delle strutture (dal dato dell'account): servono solo come etichetta, nessun dato personale.
  const names = new Map<string, string>();
  try {
    const d = JSON.parse(blob[DATA_KEY] || "{}") as { structures?: { id?: string; name?: string }[] };
    for (const s of d.structures ?? []) if (s?.id && s.name) names.set(s.id, String(s.name).slice(0, 60));
  } catch { /* dato non leggibile: si usano etichette generiche */ }
  // Fase 3, passo 1: con SERVER_READ_ENTITIES=compare gli stessi nomi si confrontano con le tabelle; il risultato resta quello del blocco (con off e on non fa nulla).
  await shadowStructureNames(admin, "health.structureNames", { type: "u", id: tenantId }, Object.fromEntries(names), 60_000);

  const maps: ChannexMapRow[] = ((mapRes.data ?? []) as ChannexMapRow[]).map((m) => ({ structure_id: m.structure_id, last_import_at: m.last_import_at ?? null, updated_at: m.updated_at ?? null, name: m.structure_id ? names.get(m.structure_id) ?? null : null }));

  // Ping a Channex solo se c'è qualcosa di mappato, con timeout breve: la pagina non deve restare appesa.
  const enabled = channexEnabled();
  let ping: ChannexPing = "skipped";
  if (enabled && maps.length > 0) {
    ping = await Promise.race([
      listProperties().then((r): ChannexPing => (r.ok ? "ok" : "fail"), (): ChannexPing => "fail"),
      new Promise<ChannexPing>((res) => setTimeout(() => res("timeout"), PING_TIMEOUT_MS)),
    ]);
  }

  // Variabili d'ambiente: SOLO se presenti. Per gli interruttori "=1" si dice se sono accesi, mai il valore.
  const env: EnvFlag[] = ENV_NAMES.map((name) => {
    const v = (process.env[name] ?? "").trim();
    const f: EnvFlag = { name, present: v.length > 0 };
    if (name === "ALLOGGIATI_LIVE" || name === "AUTO_MESSAGES_LIVE") f.on = v === "1";
    return f;
  });

  const share = (shareRes.data as { sent_at?: string | null; slot_date?: string | null }[] | null)?.[0];
  const report = classificaSalute({
    invii: inviiRes.error ? null : ((inviiRes.data ?? []) as InvioRow[]),
    pulizieShareAt: share?.sent_at || share?.slot_date || null,
    channex: { enabled, maps, ping },
    whatsapp: { connected: !!waRes.connected, lastInAt, lastOutAt },
    env,
  });
  return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), ...report });
}
