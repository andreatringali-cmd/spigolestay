// Cosa manca per poter inviare il check-in online (pagina pubblica /checkin). Puro, senza React.
// Requisiti per l'invio: nome, cognome, data di nascita e numero documento dell'ospite principale,
// consenso al trattamento dei dati e (per l'ospite, non per l'operatore) la firma. In più, per i gruppi, almeno un ospite per camera.
// Per la schedina Alloggiati servono anche sesso, luogo di nascita e cittadinanza di ogni persona e, per l'ospite principale (capo),
// il luogo di rilascio del documento: se mancano la schedina nascerebbe "da validare" e il gestore dovrebbe raccogliere i dati a mano.
// Per i co-ospiti (compilati con nome e cognome) bastano data e luogo di nascita, sesso e cittadinanza.
// Nei GRUPPI (più camere) il primo ospite di ogni camera è il "capocamera": per la sua schedina (ruolo 17) il documento è obbligatorio come per l'ospite principale.
// La foto del documento NON è obbligatoria (REQUIRE_DOC_PHOTOS = false): se manca compare come consiglio, non come blocco.
// I testi li compone la pagina (tradotti): qui solo codici, passo e id del campo da evidenziare.

export const REQUIRE_DOC_PHOTOS = false;

export type MissCode = "firstName" | "lastName" | "sex" | "birthDate" | "birthPlace" | "citizenship" | "docNumber" | "docPlace" | "group" | "docPhoto" | "consent" | "signature";
export type CheckinStep = 1 | 2 | 3;

/** Qualcosa che BLOCCA l'invio. `guest` = numero dell'ospite (1 = principale). */
export interface Miss { code: MissCode; step: CheckinStep; id: string; guest?: number; rooms?: string[] }
/** Qualcosa da segnalare ma che NON blocca. */
export interface Advice { code: "fewGuests" | "partialGuest" | "docPhoto"; guest?: number; entered?: number; total?: number }

export interface FlowInput {
  doc: { firstName?: string; lastName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docNumber?: string; docPlace?: string } | null;
  extras: { firstName?: string; lastName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docNumber?: string; docPlace?: string; photoFront?: string; room?: string }[];
  /** Gruppi: camera dell'ospite principale (chi prenota). */
  primaryRoom?: string;
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

export interface RoomPerson { room: string; birthDate?: string; named?: boolean }
/**
 * Capocamera di ogni camera di un gruppo. `persons[0]` è l'ospite principale (chi prenota) e guida la sua camera; nelle altre camere guida la persona
 * più grande (data di nascita più lontana; chi non ha la data viene dopo), così un minore non diventa mai titolare del documento se c'è un adulto.
 * Ritorna camera → indice in `persons`. Le persone senza nome (named === false) non contano.
 */
export function roomHeads(persons: RoomPerson[], primaryRoom: string): Map<string, number> {
  const heads = new Map<string, number>();
  if (persons.length) heads.set(primaryRoom, 0);
  persons.forEach((p, i) => {
    if (i === 0 || p.named === false || !p.room || p.room === primaryRoom) return;
    const cur = heads.get(p.room);
    if (cur === undefined) { heads.set(p.room, i); return; }
    const a = persons[cur].birthDate || "", b = p.birthDate || "";
    if (b && (!a || b < a)) heads.set(p.room, i);
  });
  return heads;
}
export const fieldId = (code: MissCode, guest = 1) => (code === "docPhoto" ? `f-docPhoto-${guest}` : code === "group" ? "f-group" : guest > 1 ? `f-${code}-${guest}` : `f-${code}`);

export function checkinStatus(i: FlowInput): { blocking: Miss[]; advice: Advice[]; entered: number; valid: boolean } {
  const blocking: Miss[] = [];
  const d = i.doc;
  const need = (code: MissCode, ok: boolean) => { if (!ok) blocking.push({ code, step: 1, id: fieldId(code), guest: 1 }); };
  need("firstName", has(d?.firstName));
  need("lastName", has(d?.lastName));
  need("sex", d?.sex === "M" || d?.sex === "F");
  need("birthDate", !!d?.birthDate);
  need("birthPlace", has(d?.birthPlace));
  need("citizenship", has(d?.citizenship));
  need("docNumber", has(d?.docNumber));
  need("docPlace", has(d?.docPlace));
  // Co-ospiti compilati (nome e cognome): per la loro schedina servono sesso, data e luogo di nascita, cittadinanza.
  i.extras.forEach((e, k) => {
    if (!(has(e.firstName) && has(e.lastName))) return;
    const g = k + 2;
    const needX = (code: MissCode, ok: boolean) => { if (!ok) blocking.push({ code, step: 1, id: fieldId(code, g), guest: g }); };
    needX("sex", e.sex === "M" || e.sex === "F");
    needX("birthDate", !!e.birthDate);
    needX("birthPlace", has(e.birthPlace));
    needX("citizenship", has(e.citizenship));
  });
  // Gruppi: il capocamera di ogni camera (diverso dall'ospite principale) deve avere il documento.
  if (i.isGroup && i.primaryRoom) {
    const named = i.extras.map((e, k) => ({ e, k })).filter(({ e }) => has(e.firstName) && has(e.lastName));
    const heads = roomHeads([{ room: i.primaryRoom, birthDate: d?.birthDate }, ...named.map(({ e }) => ({ room: e.room || i.primaryRoom!, birthDate: e.birthDate }))], i.primaryRoom);
    for (const [room, idx] of heads) {
      if (room === i.primaryRoom || idx === 0) continue;
      const { e, k } = named[idx - 1];
      const g = k + 2;
      if (!has(e.docNumber)) blocking.push({ code: "docNumber", step: 1, id: fieldId("docNumber", g), guest: g });
      if (!has(e.docPlace)) blocking.push({ code: "docPlace", step: 1, id: fieldId("docPlace", g), guest: g });
    }
  }
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

/**
 * Tipo documento letto dall'AI (testo libero) → una delle voci del menu (DOC_TYPES). undefined se non riconosciuto.
 * Serve perché il modulo parte con "Carta d'identità": un passaporto fotografato non deve restare salvato come carta d'identità.
 */
export function docTypeFromText(v: unknown): string | undefined {
  const n = String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!n.trim()) return undefined;
  if (/passaport|passport|reisepass|passeport|pasaporte/.test(n)) return "Passaporto";
  if (/patent|licen[sc]e|fuhrerschein|permis de conduire/.test(n)) return "Patente di guida";
  if (/permesso|residence permit|titre de sejour|aufenthalt/.test(n)) return "Permesso di soggiorno";
  if (/identit|carta|identity|id card|personalausweis|carte nationale/.test(n)) return "Carta d'identità";
  return undefined;
}
