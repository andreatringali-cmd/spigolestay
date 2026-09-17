// Astrazione dell'intermediario di fatturazione elettronica (SDI-as-a-service).
// Xenora costruisce l'XML FatturaPA e lo consegna all'intermediario, che lo
// trasmette allo SdI e restituisce esiti/ricevute. Qui: interfaccia + mock
// (dev/test) + provider REALE Openapi.it + scheletro Fatture in Cloud.
import { buildFatturaPaXml, fatturaPaFileName } from "./fatturapa";

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
export interface FicConfig { accessToken?: string; companyId?: string }

export class FattureInCloudProvider implements EInvoiceProvider {
  readonly name = "fattureincloud" as const;
  constructor(private cfg: FicConfig) {}

  // TODO(fic): base API. Auth = Bearer access_token OAuth del tenant (rinnovabile via refresh_token).
  private base() { return "https://api-v2.fattureincloud.it"; }
  private headers() { return { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${this.cfg.accessToken ?? ""}` }; }
  private company() {
    if (!this.cfg.companyId) throw new Error("fattureincloud_not_connected"); // manca il collegamento OAuth + company_id
    return this.cfg.companyId;
  }

  async send(_payload: EInvoicePayload): Promise<SendResult> {
    void _payload; void this.base; void this.headers; void this.company;
    // TODO(fic): POST /c/{company_id}/issued_documents con il documento (type=invoice),
    //   e_invoice=true per l'invio SdI; mappare l'id FIC in providerRef.
    //   Mappare le nostre righe/aliquote/nature nel formato FIC (vat, not_taxable...).
    throw new Error("fattureincloud_not_configured");
  }
  async sendCreditNote(payload: EInvoicePayload): Promise<SendResult> { return this.send(payload); }
  async getStatus(_ref: string): Promise<StatusResult> {
    void _ref;
    // TODO(fic): GET /c/{company_id}/issued_documents/{id}/e_invoice → stato SdI → nostri stati.
    throw new Error("fattureincloud_not_configured");
  }
  async getXml(_ref: string): Promise<string | null> {
    void _ref;
    // TODO(fic): GET dell'XML e-fattura prodotto da Fatture in Cloud.
    throw new Error("fattureincloud_not_configured");
  }
  async listNotifications(): Promise<ProviderNotification[]> {
    // TODO(fic): sincronizzazione periodica degli esiti SdI dei documenti aperti.
    throw new Error("fattureincloud_not_configured");
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
