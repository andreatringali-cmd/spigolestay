// Fatture in Cloud — anagrafica clienti: lettura, creazione, mapping e abbinamento con l'anagrafica Xenora.
//
// Doc ufficiale (SDK ufficiali, docs/ClientsApi.md e Client.md):
//   elenco:   GET  /c/{company_id}/entities/clients?fieldset=detailed&per_page=&page=&q=&sort=
//             risposta: { data: Client[], current_page, last_page, per_page, total, ... }
//   creazione: POST /c/{company_id}/entities/clients   body { data: { name, type, vat_number, ... } }
//             risposta: { data: Client } (con id)
//   Client: name, first_name, last_name, type (company|person|pa|condo), vat_number, tax_code,
//           address_street, address_postal_code, address_city, address_province, country (nome),
//           country_iso, email, certified_email, e_invoice, ei_code.
// Scope già concessi al collegamento OAuth: entity.clients:a (lettura + scrittura).
//
// Regole: NESSUNA modifica né cancellazione di clienti esistenti su Fatture in Cloud: solo lettura e creazione.
// Mai creare un cliente già presente: chiave P.IVA, poi codice fiscale, poi nome normalizzato.

import { FIC_API_BASE } from "@/lib/invoicing/fic-oauth";

export interface FicCfg { accessToken: string; companyId: string }

/** Cliente come restituito dall'API di Fatture in Cloud (solo i campi che usiamo). */
export interface FicClient {
  id?: number | string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  type?: string | null;
  vat_number?: string | null;
  tax_code?: string | null;
  address_street?: string | null;
  address_postal_code?: string | null;
  address_city?: string | null;
  address_province?: string | null;
  country?: string | null;
  country_iso?: string | null;
  email?: string | null;
  certified_email?: string | null;
  e_invoice?: boolean | null;
  ei_code?: string | null;
}

/** Riga dell'anagrafica Xenora (tabella counterparts). */
export interface Counterpart {
  id?: string;
  kind: string;
  name: string;
  vat?: string | null;
  tax_code?: string | null;
  address?: string | null;
  city?: string | null;
  cap?: string | null;
  province?: string | null;
  country?: string | null;
  sdi_code?: string | null;
  pec?: string | null;
  email?: string | null;
}

// ---- Normalizzazione chiavi ---------------------------------------------------

/** Partita IVA: solo lettere/cifre maiuscole, senza prefisso "IT" davanti a 11 cifre. */
export function normVat(v: string | null | undefined): string {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^IT\d{11}$/.test(s) ? s.slice(2) : s;
}
/** Codice fiscale: lettere/cifre maiuscole. */
export function normCf(v: string | null | undefined): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
/** Nome: minuscolo, senza accenti/punti/apostrofi ("S.r.l." = "SRL"), altra punteggiatura = spazio, parole ordinate ("Rossi Mario" = "Mario Rossi"). */
export function normName(v: string | null | undefined): string {
  const s = String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return s ? s.split(" ").sort().join(" ") : "";
}

const str = (v: unknown): string => (v == null ? "" : String(v).trim());

// ---- Mapping ------------------------------------------------------------------

/** Cliente Xenora → payload di creazione per Fatture in Cloud (campo `data` del body). */
export function counterpartToFicClient(c: Counterpart): Record<string, unknown> {
  const country = (str(c.country) || "IT").toUpperCase();
  const isIt = country === "IT" || country === "ITALIA" || country === "ITALY";
  const sdi = str(c.sdi_code).toUpperCase();
  const name = str(c.name);
  let type: "person" | "company" | "pa" = c.kind === "privato" ? "person" : "company";
  if (type === "company" && sdi.length === 6) type = "pa"; // codice univoco ufficio PA = 6 caratteri
  const out: Record<string, unknown> = { name, type };
  if (type === "person") {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) { out.first_name = parts[0]; out.last_name = parts.slice(1).join(" "); }
  }
  const put = (k: string, v: unknown) => { const s = str(v); if (s) out[k] = s; };
  put("vat_number", c.vat);
  put("tax_code", c.tax_code);
  put("address_street", c.address);
  put("address_postal_code", c.cap);
  put("address_city", c.city);
  put("address_province", c.province);
  put("email", c.email);
  put("certified_email", c.pec);
  if (isIt) { out.country = "Italia"; out.country_iso = "IT"; }
  else if (/^[A-Z]{2}$/.test(country)) out.country_iso = country;
  if (isIt) { out.e_invoice = true; out.ei_code = sdi || "0000000"; }
  return out;
}

/** Cliente di Fatture in Cloud → riga anagrafica Xenora (senza id / tenant_id). */
export function ficClientToCounterpart(f: FicClient): Counterpart {
  const type = str(f.type).toLowerCase();
  const iso = str(f.country_iso).toUpperCase();
  const countryName = str(f.country);
  const country = iso || (!countryName || /^(italia|italy)$/i.test(countryName) ? "IT" : countryName);
  const foreign = country !== "IT" && country.toUpperCase() !== "ITALIA";
  const first = str(f.first_name), last = str(f.last_name);
  const name = str(f.name) || `${first} ${last}`.trim();
  const kind = type === "person" ? "privato" : foreign ? "estero" : "societa";
  return {
    kind,
    name,
    vat: str(f.vat_number) || null,
    tax_code: str(f.tax_code) || null,
    address: str(f.address_street) || null,
    city: str(f.address_city) || null,
    cap: str(f.address_postal_code) || null,
    province: str(f.address_province) || null,
    country,
    sdi_code: str(f.ei_code) && str(f.ei_code) !== "0000000" ? str(f.ei_code) : null,
    pec: str(f.certified_email) || null,
    email: str(f.email) || null,
  };
}

// ---- Abbinamento --------------------------------------------------------------

interface Ident { vat: string; cf: string; name: string }
const identOfCp = (c: Counterpart): Ident => ({ vat: normVat(c.vat), cf: normCf(c.tax_code), name: normName(c.name) });
const identOfFic = (f: FicClient): Ident => ({
  vat: normVat(f.vat_number), cf: normCf(f.tax_code),
  name: normName(str(f.name) || `${str(f.first_name)} ${str(f.last_name)}`),
});
const idsOf = (i: Ident): string[] => [i.vat, i.cf].filter(Boolean);

/**
 * Indice di abbinamento su un elenco di identità. Ordine: P.IVA, poi codice fiscale (anche incrociati:
 * molte società hanno CF = P.IVA), poi nome normalizzato, ma solo se nessuno dei due ha identificativi
 * fiscali in conflitto (due anagrafiche con P.IVA diverse restano due clienti anche col nome uguale).
 */
function buildIndex(items: Ident[]) {
  const byId = new Map<string, number>();
  const byName = new Map<string, number[]>();
  items.forEach((it, i) => {
    idsOf(it).forEach((k) => { if (!byId.has(k)) byId.set(k, i); });
    if (it.name) byName.set(it.name, [...(byName.get(it.name) ?? []), i]);
  });
  return (q: Ident): number => {
    if (q.vat && byId.has(q.vat)) return byId.get(q.vat)!;
    if (q.cf && byId.has(q.cf)) return byId.get(q.cf)!;
    if (q.name) {
      for (const i of byName.get(q.name) ?? []) {
        const o = items[i];
        const qi = idsOf(q), oi = idsOf(o);
        const conflict = qi.length > 0 && oi.length > 0 && !qi.some((k) => oi.includes(k));
        if (!conflict) return i;
      }
    }
    return -1;
  };
}

export interface ClientSyncPlan {
  /** Clienti Xenora assenti su Fatture in Cloud: da creare lì. */
  toSend: Counterpart[];
  /** Clienti Fatture in Cloud assenti in Xenora: da importare. */
  toImport: FicClient[];
  /** Coppie già allineate (stesso cliente da entrambe le parti). */
  aligned: number;
  /** Doppioni dello stesso elenco (stesso cliente ripetuto): esclusi da invio/import. */
  duplicatesXenora: Counterpart[];
  duplicatesFic: FicClient[];
}

/** Confronta i due elenchi. Non crea né importa mai un cliente già presente dall'altra parte o già ripetuto nello stesso elenco. */
export function planClientSync(xenora: Counterpart[], fic: FicClient[]): ClientSyncPlan {
  const xi = xenora.map(identOfCp);
  const fi = fic.map(identOfFic);
  const findInFic = buildIndex(fi);
  const findInXen = buildIndex(xi);
  const toSend: Counterpart[] = [], toImport: FicClient[] = [];
  const duplicatesXenora: Counterpart[] = [], duplicatesFic: FicClient[] = [];
  let aligned = 0;

  // Xenora → FIC. Il "visto" evita di inviare due volte lo stesso cliente ripetuto in Xenora.
  const seenSend: Ident[] = [];
  let seenIdx = buildIndex(seenSend);
  xenora.forEach((c, n) => {
    if (!str(c.name)) return;
    if (findInFic(xi[n]) >= 0) { aligned++; return; }
    if (seenIdx(xi[n]) >= 0) { duplicatesXenora.push(c); return; }
    toSend.push(c); seenSend.push(xi[n]); seenIdx = buildIndex(seenSend);
  });

  // FIC → Xenora.
  const seenImp: Ident[] = [];
  let seenImpIdx = buildIndex(seenImp);
  fic.forEach((f, n) => {
    if (!fi[n].name && !fi[n].vat && !fi[n].cf) return;
    if (findInXen(fi[n]) >= 0) return; // già in Xenora (contato come allineato sopra)
    if (seenImpIdx(fi[n]) >= 0) { duplicatesFic.push(f); return; }
    toImport.push(f); seenImp.push(fi[n]); seenImpIdx = buildIndex(seenImp);
  });
  return { toSend, toImport, aligned, duplicatesXenora, duplicatesFic };
}

// ---- Chiamate API -------------------------------------------------------------

const headers = (cfg: FicCfg) => ({ Authorization: `Bearer ${cfg.accessToken}`, Accept: "application/json", "Content-Type": "application/json" });

function errMsg(json: Record<string, unknown>): string {
  const e = json.error as Record<string, unknown> | string | undefined;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const vr = e.validation_result as Record<string, unknown> | undefined;
    const first = vr && typeof vr === "object" ? Object.values(vr)[0] : undefined;
    const detail = Array.isArray(first) ? String(first[0]) : first ? String(first) : "";
    return [e.message, detail].filter(Boolean).join(" — ");
  }
  return (json.message as string) || "";
}

export const FIC_CLIENTS_PER_PAGE = 100;

export interface FicClientPage { clients: FicClient[]; page: number; lastPage: number; total: number }

/** Una pagina dell'elenco clienti (fieldset "detailed": include indirizzo, codice destinatario, PEC). */
export async function listFicClients(cfg: FicCfg, page = 1): Promise<FicClientPage> {
  const q = new URLSearchParams({ fieldset: "detailed", per_page: String(FIC_CLIENTS_PER_PAGE), page: String(page), sort: "name" });
  const res = await fetch(`${FIC_API_BASE}/c/${encodeURIComponent(cfg.companyId)}/entities/clients?${q.toString()}`, { method: "GET", headers: headers(cfg) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
  if (!res.ok) throw new Error(`Fatture in Cloud ${res.status}: ${errMsg(json) || "elenco clienti non disponibile"}`);
  const data = Array.isArray(json.data) ? (json.data as FicClient[]) : [];
  return { clients: data, page: Number(json.current_page) || page, lastPage: Number(json.last_page) || page, total: Number(json.total) || data.length };
}

/** Tutti i clienti (pagina per pagina, con tetto di sicurezza). `truncated` se l'elenco supera il tetto. */
export async function listAllFicClients(cfg: FicCfg, maxPages = 30): Promise<{ clients: FicClient[]; total: number; truncated: boolean }> {
  const all: FicClient[] = [];
  let page = 1, last = 1, total = 0;
  do {
    const r = await listFicClients(cfg, page);
    all.push(...r.clients); last = r.lastPage; total = r.total; page++;
  } while (page <= last && page <= maxPages);
  return { clients: all, total, truncated: last > maxPages };
}

/** Crea UN cliente su Fatture in Cloud (sola creazione: mai modifiche). `client` è il payload di counterpartToFicClient. */
export async function createFicClient(cfg: FicCfg, client: Record<string, unknown>): Promise<{ id: number | string | null }> {
  const res = await fetch(`${FIC_API_BASE}/c/${encodeURIComponent(cfg.companyId)}/entities/clients`, {
    method: "POST", headers: headers(cfg), body: JSON.stringify({ data: client }),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
  if (!res.ok) throw new Error(`Fatture in Cloud ${res.status}: ${errMsg(json) || "creazione cliente non riuscita"}`);
  const d = (json.data && typeof json.data === "object" ? json.data : {}) as { id?: number | string };
  return { id: d.id ?? null };
}
