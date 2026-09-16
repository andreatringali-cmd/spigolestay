// Astrazione dell'intermediario di fatturazione elettronica (SDI-as-a-service).
// Xenora NON genera l'XML FatturaPA né parla con lo SdI: manda un payload
// strutturato all'intermediario, che produce/firma/trasmette l'XML e restituisce
// esiti e ricevute. Qui: interfaccia + mock (dev/test) + scheletro Openapi.

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
export interface OpenapiConfig { token?: string; sandbox?: boolean }

export class OpenapiProvider implements EInvoiceProvider {
  readonly name = "openapi" as const;
  constructor(private cfg: OpenapiConfig) {}

  // TODO(openapi): base URL sandbox/produzione dalla doc Openapi "Fatture / SDI".
  private base() { return this.cfg.sandbox ? "https://test.oauth.openapi.it" : "https://oauth.openapi.it"; }
  // TODO(openapi): header di autenticazione (Bearer token dell'account intermediario).
  private headers() { return { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.token ?? ""}` }; }

  async send(_payload: EInvoicePayload): Promise<SendResult> {
    void _payload; void this.base; void this.headers;
    // TODO(openapi): POST del payload all'endpoint di emissione/invio; mappare la
    // risposta (id documento intermediario) in providerRef + stato.
    throw new Error("openapi_provider_not_configured");
  }
  async sendCreditNote(payload: EInvoicePayload): Promise<SendResult> { return this.send(payload); }
  async getStatus(_ref: string): Promise<StatusResult> {
    void _ref;
    // TODO(openapi): GET stato/notifiche SdI (RC/NS/MC…) e mappa nei nostri stati.
    throw new Error("openapi_provider_not_configured");
  }
  async getXml(_ref: string): Promise<string | null> {
    void _ref;
    // TODO(openapi): GET dell'XML FatturaPA prodotto dall'intermediario.
    throw new Error("openapi_provider_not_configured");
  }
  async listNotifications(): Promise<ProviderNotification[]> {
    // TODO(openapi): elenco notifiche da elaborare nel job di polling.
    throw new Error("openapi_provider_not_configured");
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
