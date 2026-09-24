// Astrazione dell'intermediario di fatturazione elettronica (SDI-as-a-service).
// Xenora costruisce l'XML FatturaPA e lo consegna all'intermediario, che lo
// trasmette allo SdI e restituisce esiti/ricevute. Qui: interfaccia + mock
// (dev/test) + provider REALE Openapi.it + scheletro Fatture in Cloud.
import { buildFatturaPaXml, fatturaPaFileName } from "./fatturapa";
import { FIC_API_BASE } from "./fic-oauth";

export type ProviderName = "mock" | "openapi" | "fattureincloud";

// Payload normalizzato inviato all'intermediario (non è XML).
export interface EInvoicePayload {
  docId: string;
  docKind: "fattura" | "nota_di_credito" | "ricevuta_non_fiscale";
  sdiType: string;              // TD01 / TD04 ...
  numberLabel: string;
  issueDate: string;           // ISO
  regime: string;
  currency: string;
  emittente: {
    denominazione?: string; vat?: string; taxCode?: string;
    address?: string; city?: string; cap?: string; province?: string; country?: string;
    regimeFiscale?: string;    // es. RF01 ordinario, RF19 forfettario
    pec?: string;
  };
  cliente: {
    kind: string; name: string; vat?: string | null; taxCode?: string | null;
    address?: string | null; city?: string | null; cap?: string | null;
    province?: string | null; country?: string; sdiCode?: string; pec?: string | null;
  };
  lines: { description: string; qty: number; unitPriceCents: number; vatRate: number; vatNature?: string | null; lineTotalCents: number }[];
  totals: { taxableCents: number; vatCents: number; outOfScopeCents: number; bolloCents: number; totalCents: number };
  payment?: { method?: string | null; dueDate?: string | null; terms?: string | null };
  relatedNumberLabel?: string; // per nota di credito → fattura riferita
  notes?: string | null;
}

export interface SendResult { providerRef: string; status: DocStatus; message?: string }
export type DocStatus = "inviata_intermediario" | "consegnata" | "scartata";
export interface StatusResult { status: DocStatus; message: string; xmlAvailable: boolean; raw?: unknown }
export interface ProviderNotification { providerRef: string; status: DocStatus; message: string; ts: string }

export interface EInvoiceProvider {
  readonly name: ProviderName;
  send(payload: EInvoicePayload): Promise<SendResult>;
  sendCreditNote(payload: EInvoicePayload): Promise<SendResult>;
  getStatus(providerRef: string): Promise<StatusResult>;
  getXml(providerRef: string): Promise<string | null>;   // XML prodotto dall'intermediario
  listNotifications(since?: string): Promise<ProviderNotification[]>;
}

// ---------------------------------------------------------------------------
// MOCK: per sviluppo e test. Deterministico e senza rete.
//  - send → "inviata_intermediario"
//  - getStatus → "consegnata" (RC), oppure "scartata" se totale = 0 (caso di test)
// ---------------------------------------------------------------------------
export class MockProvider implements EInvoiceProvider {
  readonly name = "mock" as const;
  private store = new Map<string, EInvoicePayload>();

  private ref() { return "mock:" + (globalThis.crypto?.randomUUID?.() ?? String(Date.now())); }

  async send(payload: EInvoicePayload): Promise<SendResult> {
    const providerRef = this.ref();
    this.store.set(providerRef, payload);
    return { providerRef, status: "inviata_intermediario", message: "Documento preso in carico dall'intermediario (mock)." };
  }
  async sendCreditNote(payload: EInvoicePayload): Promise<SendResult> { return this.send(payload); }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const p = this.store.get(providerRef);
    if (p && p.totals.totalCents === 0) {
      return { status: "scartata", message: "RC: scartata dallo SdI — totale documento a zero (mock).", xmlAvailable: false };
    }
    return { status: "consegnata", message: "RC: fattura consegnata al destinatario (mock).", xmlAvailable: true };
  }
  async getXml(providerRef: string): Promise<string | null> {
    const p = this.store.get(providerRef);
    if (!p) return null;
    // XML fittizio a solo scopo di verifica del flusso (NON è FatturaPA valido).
    return `<?xml version="1.0"?>\n<MockFattura ref="${providerRef}" numero="${p.numberLabel}" totale="${(p.totals.totalCents / 100).toFixed(2)}"/>`;
  }
  async listNotifications(): Promise<ProviderNotification[]> { return []; }
}

// ---------------------------------------------------------------------------
// OPENAPI (SDI-as-a-service): SCHELETRO — da completare quando il commercialista
// sceglie il provider e sono disponibili le credenziali cifrate del tenant.
// I punti da completare sono marcati con TODO.
// ---------------------------------------------------------------------------
export interface OpenapiConfig { token?: string; sandbox?: boolean; signature?: boolean; legalStorage?: boolean }

// Mappa gli stati/notifiche SdI di Openapi nei nostri stati.
//  - scarto (NS)            → scartata
//  - consegna (RC) / mancata consegna (MC) / decorrenza termini (DT) → consegnata
//  - altrimenti             → inviata_intermediario
function mapSdiStatus(raw: string | undefined | null): DocStatus {
  const s = (raw || "").toString().toLowerCase();
  if (/scart|ns\b|rifiut|error/.test(s)) return "scartata";
  if (/conseg|rc\b|mc\b|mancata|decorrenz|dt\b|accett|delivered/.test(s)) return "consegnata";
  return "inviata_intermediario";
}

export class OpenapiProvider implements EInvoiceProvider {
  readonly name = "openapi" as const;
  constructor(private cfg: OpenapiConfig) {}

  private base() { return this.cfg.sandbox ? "https://test.sdi.openapi.it" : "https://sdi.openapi.it"; }
  private headers() { return { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${this.cfg.token ?? ""}` }; }
  // Endpoint di invio in base alle opzioni (firma / conservazione a norma).
  private sendPath() {
    const s = this.cfg.signature, l = this.cfg.legalStorage;
    if (s && l) return "/invoices_signature_legal_storage";
    if (s) return "/invoices_signature";
    if (l) return "/invoices_legal_storage";
    return "/invoices";
  }

  private async req(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    if (!this.cfg.token) throw new Error("openapi_token_mancante");
    const res = await fetch(`${this.base()}${path}`, { method, headers: this.headers(), body: body != null ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
    return { ok: res.ok, status: res.status, json };
  }
  // Openapi incapsula in { success, data, message, error }: estrae data se presente.
  private data(json: Record<string, unknown>): Record<string, unknown> {
    const d = json.data;
    return (d && typeof d === "object") ? d as Record<string, unknown> : json;
  }
  private msg(json: Record<string, unknown>): string {
    return (json.message as string) || (json.error as string) || "";
  }

  async send(payload: EInvoicePayload): Promise<SendResult> {
    const xml = buildFatturaPaXml(payload);
    const body = { file_name: fatturaPaFileName(payload), payload: Buffer.from(xml, "utf8").toString("base64") };
    const r = await this.req("POST", this.sendPath(), body);
    if (!r.ok) throw new Error(`Openapi ${r.status}: ${this.msg(r.json) || "invio non riuscito"}`);
    const d = this.data(r.json);
    const uuid = (d.uuid as string) || (d.id as string) || "";
    if (!uuid) throw new Error(`Openapi: risposta senza uuid — ${this.msg(r.json)}`);
    return { providerRef: `openapi:${uuid}`, status: "inviata_intermediario", message: this.msg(r.json) || "Fattura trasmessa allo SdI." };
  }
  async sendCreditNote(payload: EInvoicePayload): Promise<SendResult> { return this.send(payload); }

  // Invia un XML FatturaPA già costruito (es. autofattura TD17 reverse charge).
  async sendRawXml(xml: string, fileName: string): Promise<SendResult> {
    const body = { file_name: fileName, payload: Buffer.from(xml, "utf8").toString("base64") };
    const r = await this.req("POST", this.sendPath(), body);
    if (!r.ok) throw new Error(`Openapi ${r.status}: ${this.msg(r.json) || "invio non riuscito"}`);
    const d = this.data(r.json);
    const uuid = (d.uuid as string) || (d.id as string) || "";
    if (!uuid) throw new Error(`Openapi: risposta senza uuid — ${this.msg(r.json)}`);
    return { providerRef: `openapi:${uuid}`, status: "inviata_intermediario", message: this.msg(r.json) || "Documento trasmesso allo SdI." };
  }

  private uuidOf(ref: string) { return ref.replace(/^openapi:/, ""); }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const uuid = this.uuidOf(providerRef);
    const r = await this.req("GET", `/invoices/${encodeURIComponent(uuid)}`);
    if (!r.ok) throw new Error(`Openapi ${r.status}: ${this.msg(r.json) || "stato non disponibile"}`);
    const d = this.data(r.json);
    // Alcune risposte annidano lo stato in campi diversi: prova più chiavi.
    const rawStatus = (d.status as string) || (d.state as string) || (d.last_update_status as string) || (d.sdi_status as string) || "";
    const status = mapSdiStatus(rawStatus);
    return { status, message: rawStatus ? `Stato SdI: ${rawStatus}` : "In elaborazione presso lo SdI.", xmlAvailable: true, raw: r.json };
  }

  async getXml(providerRef: string): Promise<string | null> {
    const uuid = this.uuidOf(providerRef);
    const r = await this.req("GET", `/invoices_download/${encodeURIComponent(uuid)}`);
    if (!r.ok) return null;
    const d = this.data(r.json);
    const raw = (d.payload as string) || (d.xml as string) || (d.file as string) || "";
    if (!raw) return null;
    // Il payload può tornare base64 o XML in chiaro.
    if (raw.trimStart().startsWith("<")) return raw;
    try { return Buffer.from(raw, "base64").toString("utf8"); } catch { return raw; }
  }

  async listNotifications(since?: string): Promise<ProviderNotification[]> {
    const q = since ? `?updated_after=${encodeURIComponent(since)}` : "";
    const r = await this.req("GET", `/invoices_notifications${q}`);
    if (!r.ok) return [];
    const d = this.data(r.json);
    const arr = Array.isArray(d) ? d : (Array.isArray(d.notifications) ? d.notifications : (Array.isArray(d.items) ? d.items : []));
    return (arr as Record<string, unknown>[]).map((n) => ({
      providerRef: `openapi:${(n.uuid as string) || (n.invoice_uuid as string) || ""}`,
      status: mapSdiStatus((n.type as string) || (n.status as string)),
      message: (n.message as string) || (n.type as string) || "notifica SdI",
      ts: (n.date as string) || (n.created_at as string) || new Date().toISOString(),
    }));
  }
}

// ---------------------------------------------------------------------------
// FATTURE IN CLOUD (scelta del commercialista): OAuth2, "spinge" la fattura nel
// conto Fatture in Cloud del cliente, che gestisce XML + SdI. SCHELETRO — da
// completare col flusso OAuth (token per tenant) e gli endpoint REST.
// Doc: https://developers.fattureincloud.it
// ---------------------------------------------------------------------------
export interface FicConfig { accessToken?: string; companyId?: string; dryRun?: boolean }

// Tipo aliquota IVA nel registro FIC (GET /c/{id}/info/vat_types).
interface FicVatType { id: number; value: number; ei_type?: string | null; is_disabled?: boolean; description?: string }

// Mappa lo stato e-fattura FIC (ei_status) nei nostri stati.
//  sent/pending/processing → inviata_intermediario
//  accepted/delivered      → consegnata
//  error/discarded/rejected → scartata
function mapEiStatus(raw: string | undefined | null): DocStatus {
  const s = (raw || "").toString().toLowerCase();
  if (/error|discard|reject|scart|rifiut/.test(s)) return "scartata";
  if (/accept|deliver|conseg/.test(s)) return "consegnata";
  return "inviata_intermediario";
}

export class FattureInCloudProvider implements EInvoiceProvider {
  readonly name = "fattureincloud" as const;
  private vatCache: FicVatType[] | null = null;
  constructor(private cfg: FicConfig) {}

  private base() { return FIC_API_BASE; }
  private headers() { return { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${this.cfg.accessToken ?? ""}` }; }
  private company() {
    if (!this.cfg.accessToken) throw new Error("fattureincloud_not_connected");
    if (!this.cfg.companyId) throw new Error("fattureincloud_no_company");
    return this.cfg.companyId;
  }

  private async req(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${this.base()}${path}`, { method, headers: this.headers(), body: body != null ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
    return { ok: res.ok, status: res.status, json };
  }
  private data(json: Record<string, unknown>): Record<string, unknown> {
    const d = json.data; return (d && typeof d === "object") ? d as Record<string, unknown> : json;
  }
  private errMsg(json: Record<string, unknown>): string {
    const e = json.error as Record<string, unknown> | string | undefined;
    if (typeof e === "string") return e;
    if (e && typeof e === "object") return (e.message as string) || JSON.stringify(e);
    return (json.message as string) || "";
  }

  // Registro IVA della company (cache per istanza).
  private async vatTypes(): Promise<FicVatType[]> {
    if (this.vatCache) return this.vatCache;
    const r = await this.req("GET", `/c/${this.company()}/info/vat_types`);
    if (!r.ok) throw new Error(`Fatture in Cloud vat_types ${r.status}: ${this.errMsg(r.json)}`);
    const arr = (this.data(r.json) as unknown as { vat_types?: FicVatType[] }).vat_types
      ?? (Array.isArray(this.data(r.json)) ? this.data(r.json) as unknown as FicVatType[] : []);
    this.vatCache = arr;
    return arr;
  }
  // Trova l'id aliquota per (rate, nature). Nature (N1/N2.2…) → aliquota 0% con ei_type corrispondente.
  private async vatIdFor(rate: number, nature?: string | null): Promise<number> {
    const types = (await this.vatTypes()).filter((t) => !t.is_disabled);
    if (nature) {
      const nat = nature.toUpperCase();
      const exact = types.find((t) => (t.ei_type || "").toUpperCase() === nat);
      if (exact) return exact.id;
      const byFamily = types.find((t) => Number(t.value) === 0 && (t.ei_type || "").toUpperCase().startsWith(nat.slice(0, 2)));
      if (byFamily) return byFamily.id;
      const anyZero = types.find((t) => Number(t.value) === 0 && (t.ei_type || ""));
      if (anyZero) return anyZero.id;
    }
    const byValue = types.find((t) => Number(t.value) === Number(rate) && !(t.ei_type));
    if (byValue) return byValue.id;
    const anyValue = types.find((t) => Number(t.value) === Number(rate));
    if (anyValue) return anyValue.id;
    throw new Error(`Fatture in Cloud: aliquota IVA ${rate}%${nature ? ` (${nature})` : ""} non trovata nel registro della tua azienda.`);
  }

  // Numero/numerazione dal nostro number_label (es. "12/2026" → number 12; "A/12/2026" → num "A").
  private numberOf(label: string): { number?: number; numeration?: string } {
    const num = (label.match(/(\d+)/) || [])[1];
    const pre = (label.match(/^([A-Za-z]+)/) || [])[1];
    return { number: num ? parseInt(num, 10) : undefined, numeration: pre || undefined };
  }

  private async buildData(payload: EInvoicePayload, type: "invoice" | "credit_note"): Promise<Record<string, unknown>> {
    const c = payload.cliente;
    const eInvoice = true; // send() è chiamato solo per documenti da trasmettere allo SdI
    const items = [];
    for (const l of payload.lines) {
      const isOoS = !!l.vatNature && /^N1/i.test(l.vatNature);
      items.push({
        name: l.description,
        qty: l.qty,
        net_price: l.unitPriceCents / 100,
        vat: { id: await this.vatIdFor(l.vatRate, l.vatNature) },
        ...(l.vatNature ? { not_taxable: isOoS } : {}),
      });
    }
    const totalEuro = payload.totals.totalCents / 100;
    const { number, numeration } = this.numberOf(payload.numberLabel || "");
    return {
      type,
      entity: {
        name: c.name,
        vat_number: c.vat || undefined,
        tax_code: c.taxCode || undefined,
        address_street: c.address || undefined,
        address_postal_code: c.cap || undefined,
        address_city: c.city || undefined,
        address_province: c.province || undefined,
        country_iso: c.country || "IT",
        e_invoice: eInvoice,
        ei_code: c.sdiCode || "0000000",
        certified_email: c.pec || undefined,
      },
      date: (payload.issueDate || "").slice(0, 10) || undefined,
      ...(number ? { number } : {}),
      ...(numeration ? { numeration } : {}),
      currency: { id: payload.currency || "EUR" },
      language: { code: "it" },
      items_list: items,
      payments_list: [{
        amount: totalEuro,
        due_date: (payload.payment?.dueDate || payload.issueDate || "").slice(0, 10) || undefined,
        status: "not_paid",
      }],
      e_invoice: eInvoice,
      ...(payload.notes ? { notes: payload.notes } : {}),
    };
  }

  async send(payload: EInvoicePayload): Promise<SendResult> {
    const type = payload.docKind === "nota_di_credito" ? "credit_note" : "invoice";
    const data = await this.buildData(payload, type);
    const r = await this.req("POST", `/c/${this.company()}/issued_documents`, { data });
    if (!r.ok) throw new Error(`Fatture in Cloud ${r.status}: ${this.errMsg(r.json) || "creazione documento non riuscita"}`);
    const docId = (this.data(r.json).id as number | string) ?? "";
    if (!docId) throw new Error("Fatture in Cloud: risposta senza id documento.");
    const providerRef = `fic:${docId}`;

    // Modalità prova: il documento è creato in Fatture in Cloud ma NON trasmesso allo SdI.
    if (this.cfg.dryRun) {
      return { providerRef, status: "inviata_intermediario", message: "Documento creato in Fatture in Cloud (MODALITÀ PROVA — non inviato allo SdI). Verificalo su Fatture in Cloud, poi disattiva la prova per l'invio reale." };
    }
    // Invio reale allo SdI.
    const s = await this.req("POST", `/c/${this.company()}/issued_documents/${docId}/e_invoice/send`);
    if (!s.ok) throw new Error(`Fatture in Cloud invio SdI ${s.status}: ${this.errMsg(s.json) || "invio non riuscito"}`);
    return { providerRef, status: "inviata_intermediario", message: "Fattura creata e trasmessa allo SdI tramite Fatture in Cloud." };
  }
  async sendCreditNote(payload: EInvoicePayload): Promise<SendResult> { return this.send(payload); }

  private idOf(ref: string) { return ref.replace(/^fic:/, ""); }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const id = this.idOf(providerRef);
    const r = await this.req("GET", `/c/${this.company()}/issued_documents/${encodeURIComponent(id)}?fieldset=detailed`);
    if (!r.ok) throw new Error(`Fatture in Cloud ${r.status}: ${this.errMsg(r.json) || "stato non disponibile"}`);
    const d = this.data(r.json);
    const ei = (d.ei_status as string) || ((d.e_invoice as boolean) ? "pending" : "");
    const status = mapEiStatus(ei);
    let message = ei ? `Stato e-fattura: ${ei}` : "Documento presente su Fatture in Cloud.";
    if (status === "scartata") {
      const er = await this.req("GET", `/c/${this.company()}/issued_documents/${encodeURIComponent(id)}/e_invoice/error_reason`).catch(() => null);
      const reason = er && er.ok ? (this.data(er.json).error_reason as string) : "";
      if (reason) message = `Scartata dallo SdI: ${reason}`;
    }
    return { status, message, xmlAvailable: true, raw: r.json };
  }

  async getXml(providerRef: string): Promise<string | null> {
    const id = this.idOf(providerRef);
    const r = await this.req("GET", `/c/${this.company()}/issued_documents/${encodeURIComponent(id)}/e_invoice/xml`);
    if (!r.ok) return null;
    const d = this.data(r.json);
    const raw = (d.xml as string) || (d.data as string) || "";
    if (!raw) return null;
    if (raw.trimStart().startsWith("<")) return raw;
    try { return Buffer.from(raw, "base64").toString("utf8"); } catch { return raw; }
  }

  // Verifica leggera del collegamento (usata da testProvider): elenca le aliquote.
  async listNotifications(): Promise<ProviderNotification[]> {
    await this.vatTypes(); // se il token/company sono validi non solleva
    return [];
  }
}

export function getProvider(name: ProviderName | string | undefined, config: Record<string, unknown> = {}): EInvoiceProvider {
  switch (name) {
    case "openapi": return new OpenapiProvider(config as OpenapiConfig);
    case "fattureincloud": return new FattureInCloudProvider(config as FicConfig);
    case "mock":
    default: return new MockProvider();
  }
}
