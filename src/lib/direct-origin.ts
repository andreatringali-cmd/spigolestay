import type { Channel } from "./types";

// Origine di una prenotazione del canale "Diretta":
//  - "sito"    = prenotata dall'ospite sul sito ufficiale / booking engine (mostra il LOGO DELLA STRUTTURA)
//  - "manuale" = inserita a mano dal gestionale (telefono, passaparola, preventivo…) (mostra il LOGO XENORA)
// Per le prenotazioni nuove vale il campo Booking.source, impostato alla creazione. Per quelle GIÀ ESISTENTI (senza `source`)
// si usano le tracce che SOLO il sito pubblico lascia (vedi api/public-booking e api/stripe/book/confirm):
//  - extId "site:<slug>:<token>" (scritto sempre e solo da /api/public-booking);
//  - riferimenti di pagamento Stripe del booking engine (stripePaymentIntent / stripeSessionId / stripeAccountId);
//  - codice "SPG-AAAA-n" generato dal booking engine (il gestionale genera "XEN-AAAA-nnnn");
//  - nota che inizia con "Prenotazione dal sito" (predefinita della route) o "Sito diretto ·" (nota del booking engine);
//  - nome del piano tariffario (ratePlanName): lo scrive solo il sito pubblico.
// In ogni altro caso (nessuna traccia) il ripiego è "manuale".

export type DirectOrigin = "sito" | "manuale";

export type DirectOriginInput = {
  channel?: Channel | string;
  source?: string | null;
  extId?: string | null;
  code?: string | null;
  note?: string | null;
  ratePlanName?: string | null;
  stripePaymentIntent?: string | null;
  stripeSessionId?: string | null;
  stripeAccountId?: string | null;
};

const has = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** Origine di una prenotazione diretta. Per qualunque altro canale (OTA, blocchi) restituisce null: il logo non cambia. */
export function directOriginOf(b: DirectOriginInput | null | undefined): DirectOrigin | null {
  if (!b || b.channel !== "direct") return null;
  if (b.source === "sito" || b.source === "manuale") return b.source;
  if (typeof b.extId === "string" && b.extId.startsWith("site:")) return "sito";
  if (has(b.stripePaymentIntent) || has(b.stripeSessionId) || has(b.stripeAccountId)) return "sito";
  if (typeof b.code === "string" && /^SPG-[0-9]{4}-[0-9]+$/.test(b.code.trim())) return "sito";
  const note = (b.note ?? "").trimStart();
  if (note.startsWith("Prenotazione dal sito") || note.startsWith("Sito diretto ·")) return "sito";
  if (has(b.ratePlanName)) return "sito";
  return "manuale";
}

/** Etichetta (tooltip) del logo di una prenotazione diretta. */
export function directOriginLabel(origin: DirectOrigin, structureName?: string | null): string {
  return origin === "sito" ? `Sito ufficiale${structureName ? ` · ${structureName}` : ""}` : "Diretta · inserita a mano";
}
