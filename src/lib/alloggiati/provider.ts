// Astrazione del web service Alloggiati Web (Polizia di Stato).
// A differenza dello SdI, qui l'integrazione è DIRETTA col servizio della Polizia
// (SOAP). Interfaccia + mock (dev/test) + scheletro SOAP da completare con le
// credenziali reali del tenant (Username, Password, Webservice Code).

export interface AlloggiatiCreds { username?: string; password?: string; wsCode?: string }
export interface SchedinaPayload { record: string; guest: Record<string, unknown> } // record = riga tracciato 168 char
export interface TestResult { ok: boolean; message: string }
export interface SendResult { ok: boolean; ricevuta?: string; message: string; errors?: string[] }

export interface AlloggiatiProvider {
  readonly name: "mock" | "soap";
  test(creds: AlloggiatiCreds): Promise<TestResult>;
  send(creds: AlloggiatiCreds, records: SchedinaPayload[]): Promise<SendResult>;
}

// MOCK: nessuna rete. "Attivata" se ci sono tutte le credenziali; invio → ricevuta finta.
export class MockAlloggiati implements AlloggiatiProvider {
  readonly name = "mock" as const;
  async test(c: AlloggiatiCreds): Promise<TestResult> {
    if (!c.username || !c.password || !c.wsCode) return { ok: false, message: "Credenziali incomplete (Username, Password, Webservice Code)." };
    return { ok: true, message: "Connessione riuscita (mock)." };
  }
  async send(c: AlloggiatiCreds, records: SchedinaPayload[]): Promise<SendResult> {
    const t = await this.test(c);
    if (!t.ok) return { ok: false, message: t.message };
    if (!records.length) return { ok: false, message: "Nessuna schedina da inviare." };
    return { ok: true, ricevuta: "MOCK-RIC-" + new Date().toISOString().slice(0, 10) + "-" + records.length, message: `Inviate ${records.length} schedine (mock).` };
  }
}

// SOAP reale — SCHELETRO. Endpoint/metodi ufficiali dal portale Alloggiati
// (sezione Supporto tecnico → documentazione web service). Da completare e
// testare con credenziali reali.
export class SoapAlloggiati implements AlloggiatiProvider {
  readonly name = "soap" as const;
  // TODO(alloggiati): WSDL/endpoint del servizio (Authentication_Test, GestioneAllogiati Send/Test).
  async test(_c: AlloggiatiCreds): Promise<TestResult> {
    void _c;
    // TODO(alloggiati): chiamare il metodo di test di autenticazione del web service.
    throw new Error("alloggiati_soap_not_configured");
  }
  async send(_c: AlloggiatiCreds, _r: SchedinaPayload[]): Promise<SendResult> {
    void _c; void _r;
    // TODO(alloggiati): GestioneAppartamenti/Invio schedine; conservare la ricevuta restituita.
    throw new Error("alloggiati_soap_not_configured");
  }
}

export function getAlloggiatiProvider(name?: string): AlloggiatiProvider {
  return name === "soap" ? new SoapAlloggiati() : new MockAlloggiati();
}
