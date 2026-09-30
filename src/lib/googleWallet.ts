import crypto from "node:crypto";

// Integrazione Google Wallet: genera il link "Aggiungi a Google Wallet" per il pass di
// soggiorno dell'ospite (Generic pass — https://developers.google.com/wallet/generic).
// Nessuna libreria esterna: il JWT RS256 richiesto dal flusso "Save to wallet"
// (https://developers.google.com/wallet/generic/use-cases/jwt) è firmato a mano con
// node:crypto. Classe e oggetto del pass sono incorporati direttamente nel JWT: Google
// li crea al volo al primo salvataggio, senza bisogno di chiamare prima la Wallet REST API.
//
// Gating: senza le env GOOGLE_WALLET_ISSUER_ID / GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL /
// GOOGLE_WALLET_PRIVATE_KEY la funzione è "pronta ma spenta" (stesso pattern del resto
// del repo, es. ANTHROPIC_API_KEY -> ai_not_configured): googleWalletConfigured() torna
// false e buildWalletSaveUrl torna null, MAI un'eccezione.

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// La chiave privata PEM si salva su Vercel con le newline codificate come \n letterali
// (stessa convenzione usata per altre chiavi PEM tipo Firebase/Google service account):
// qui le ripristiniamo prima di passarla a crypto.createSign.
function privateKeyPem(): string {
  const raw = process.env.GOOGLE_WALLET_PRIVATE_KEY || "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function googleWalletConfigured(): boolean {
  return !!(process.env.GOOGLE_WALLET_ISSUER_ID && process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL && privateKeyPem());
}

// Tiene negli id solo caratteri ammessi da Google Wallet (issuerId.identifier).
const safeId = (v: string) => (String(v || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) || "x");

export interface WalletPassInput {
  bookingId: string;
  bookingCode: string;
  structureName: string;
  structureColor?: string;
  structureLogoUrl?: string; // solo URL pubblico https: i loghi dataURL non sono utilizzabili da Google
  roomTypeName?: string;
  unitName?: string;
  checkIn: string;  // ISO yyyy-mm-dd
  checkOut: string; // ISO yyyy-mm-dd
  accessInfo?: string;
  address?: string;
  guestName?: string;
  originUrl: string; // es. https://xenora.it — deve comparire tra gli "origins" autorizzati
}

function fmtDateIt(iso: string): string {
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; }
}

// Genera il link "https://pay.google.com/gp/v/save/<JWT>" pronto per il pulsante
// "Aggiungi a Google Wallet". Ritorna null (mai eccezione) se non configurato o in
// caso di errore imprevisto nella firma: il chiamante deve gestire il null con garbo.
export function buildWalletSaveUrl(input: WalletPassInput): string | null {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID || "";
  const serviceAccountEmail = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL || "";
  const pem = privateKeyPem();
  if (!issuerId || !serviceAccountEmail || !pem) return null;

  try {
    const classId = `${issuerId}.spigolestay_stay`;
    const objectId = `${issuerId}.stay_${safeId(input.bookingId)}`;
    const roomLine = [input.roomTypeName, input.unitName].filter(Boolean).join(" · ");

    const textModulesData: { id: string; header: string; body: string }[] = [
      { id: "dates", header: "Check-in / Check-out", body: `${fmtDateIt(input.checkIn)} → ${fmtDateIt(input.checkOut)}` },
    ];
    if (input.bookingCode) textModulesData.push({ id: "code", header: "Codice prenotazione", body: input.bookingCode });
    if (roomLine) textModulesData.push({ id: "room", header: "Camera", body: roomLine });
    if (input.accessInfo) textModulesData.push({ id: "access", header: "Accesso", body: input.accessInfo });
    if (input.address) textModulesData.push({ id: "address", header: "Indirizzo", body: input.address });

    // Classe minima: un'unica classe riusata per tutti i pass di soggiorno di Xenora.
    const genericClass = { id: classId };

    const genericObject: Record<string, unknown> = {
      id: objectId,
      classId,
      genericType: "GENERIC_RESERVATIONS",
      cardTitle: { defaultValue: { language: "it", value: input.structureName || "Xenora" } },
      header: { defaultValue: { language: "it", value: input.guestName ? `Benvenuto/a, ${input.guestName}` : (roomLine || "Il tuo soggiorno") } },
      subheader: { defaultValue: { language: "it", value: `${fmtDateIt(input.checkIn)} → ${fmtDateIt(input.checkOut)}` } },
      hexBackgroundColor: /^#[0-9a-fA-F]{6}$/.test(input.structureColor || "") ? input.structureColor : "#4F46E5",
      textModulesData,
    };
    if (input.bookingCode) genericObject.barcode = { type: "QR_CODE", value: input.bookingCode, alternateText: input.bookingCode };
    if (input.structureLogoUrl && /^https:\/\//i.test(input.structureLogoUrl)) {
      genericObject.logo = { sourceUri: { uri: input.structureLogoUrl } };
    }

    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
      iss: serviceAccountEmail,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(Date.now() / 1000),
      origins: input.originUrl ? [input.originUrl] : [],
      payload: { genericClasses: [genericClass], genericObjects: [genericObject] },
    };

    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(pem);
    const jwt = `${signingInput}.${base64url(signature)}`;
    return `https://pay.google.com/gp/v/save/${jwt}`;
  } catch {
    return null;
  }
}
