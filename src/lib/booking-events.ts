// Registro eventi per-prenotazione (timeline nella scheda prenotazione).
// Scritto lato server (service role) quando accade un adempimento.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function logBookingEvent(
  admin: SupabaseClient, tenantId: string, bookingId: string | null | undefined,
  kind: string, message: string, meta?: Record<string, unknown>,
): Promise<void> {
  if (!bookingId) return;
  try { await admin.from("booking_events").insert({ tenant_id: tenantId, booking_id: bookingId, kind, message, meta: meta ?? null }); } catch { /* best-effort */ }
}
