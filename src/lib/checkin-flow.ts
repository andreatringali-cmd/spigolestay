// Cosa manca per poter inviare il check-in online (pagina pubblica /checkin). Puro, senza React.
// Stessi requisiti di sempre per l'invio: nome, cognome, data di nascita e numero documento dell'ospite principale,
// consenso al trattamento dei dati e (per l'ospite, non per l'operatore) la firma. In più, per i gruppi, almeno un ospite per camera.
// La foto del documento NON è obbligatoria (REQUIRE_DOC_PHOTOS = false): se manca compare come consiglio, non come blocco.
// I testi li compone la pagina (tradotti): qui solo codici, passo e id del campo da evidenziare.

export const REQUIRE_DOC_PHOTOS = false;

export type MissCode = "firstName" | "lastName" | "birthDate" | "docNumber" | "group" | "docPhoto" | "consent" | "signature";
export type CheckinStep = 1 | 2 | 3;

/** Qualcosa che BLOCCA l'invio. `guest` = numero dell'ospite (1 = principale). */
export interface Miss { code: MissCode; step: CheckinStep; id: string; guest?: number; rooms?: string[] }
/** Qualcosa da segnalare ma che NON blocca. */
export interface Advice { code: "fewGuests" | "partialGuest" | "docPhoto"; guest?: number; entered?: number; total?: number }

export interface FlowInput {
  doc: { firstName?: string; lastName?: string; birthDate?: string; docNumber?: string } | null;
  extras: { firstName?: string; lastName?: string; photoFront?: string }[];
  photoFront?: string;
  consent: boolean;
  signature?: string;
  isOperator: boolean;
  /** Persone attese (adulti + bambini; nei gruppi la somma di tutte le camere). */
  expectedGuests: number;
  isGroup: boolean;
  /** Gruppi: etichette delle camere senza nessun ospite assegnato. */
  missingRooms?: string[];
  requireDocPhotos?: boolean;
}

const has = (v?: string) => !!(v ?? "").trim();
export const fieldId = (code: MissCode, guest = 1) => (code === "docPhoto" ? `f-docPhoto-${guest}` : code === "group" ? "f-group" : `f-${code}`);

export function checkinStatus(i: FlowInput): { blocking: Miss[]; advice: Advice[]; entered: number; valid: boolean } {
  const blocking: Miss[] = [];
  const d = i.doc;
  const need = (code: MissCode, ok: boolean) => { if (!ok) blocking.push({ code, step: 1, id: fieldId(code), guest: 1 }); };
  need("firstName", has(d?.firstName));
  need("lastName", has(d?.lastName));
  need("birthDate", !!d?.birthDate);
  need("docNumber", has(d?.docNumber));
  if (i.isGroup && i.missingRooms?.length) blocking.push({ code: "group", step: 1, id: fieldId("group"), rooms: i.missingRooms });
  if (i.requireDocPhotos) {
    if (!i.photoFront) blocking.push({ code: "docPhoto", step: 2, id: fieldId("docPhoto", 1), guest: 1 });
    i.extras.forEach((e, k) => { if (has(e.firstName) && has(e.lastName) && !e.photoFront) blocking.push({ code: "docPhoto", step: 2, id: fieldId("docPhoto", k + 2), guest: k + 2 }); });
  }
  if (!i.consent) blocking.push({ code: "consent", step: 3, id: fieldId("consent") });
  if (!i.isOperator && !i.signature) blocking.push({ code: "signature", step: 3, id: fieldId("signature") });

  const advice: Advice[] = [];
  const complete = i.extras.filter((e) => has(e.firstName) && has(e.lastName));
  const entered = 1 + complete.length;
  i.extras.forEach((e, k) => { if (has(e.firstName) !== has(e.lastName)) advice.push({ code: "partialGuest", guest: k + 2 }); });
  if (!i.isGroup && entered < i.expectedGuests) advice.push({ code: "fewGuests", entered, total: i.expectedGuests });
  if (!i.requireDocPhotos) {
    if (!i.photoFront) advice.push({ code: "docPhoto", guest: 1 });
    i.extras.forEach((e, k) => { if (has(e.firstName) && has(e.lastName) && !e.photoFront) advice.push({ code: "docPhoto", guest: k + 2 }); });
  }
  return { blocking, advice, entered, valid: blocking.length === 0 };
}

/** Passi che hanno almeno un blocco (per il pallino "!" nell'indicatore di avanzamento). */
export function stepsWithMissing(blocking: Miss[]): Set<CheckinStep> {
  return new Set(blocking.map((m) => m.step));
}

/**
 * Un check-in già inviato non va riproposto come modulo vuoto: se i dati ci sono tutti si mostra "già inviato".
 * Si riapre il modulo solo se mancano ospiti (adulti + bambini attesi > ospiti già registrati) o se l'ospite lo chiede.
 */
export function needsMoreGuests(expectedGuests: number, savedExtraGuests: number): boolean {
  return savedExtraGuests + 1 < Math.max(1, expectedGuests);
}
