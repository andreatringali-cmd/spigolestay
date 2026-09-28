import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";

export const metadata: Metadata = { title: "Informativa sulla privacy · Xenora" };

export default function PrivacyPage() {
  return (
    <LegalShell title="Informativa sulla privacy" updated="Settembre 2026">
      <p>La presente informativa descrive come <strong>Xenora Digital Solutions</strong> (di seguito &quot;Xenora&quot;, &quot;noi&quot;) tratta i dati personali degli utenti del gestionale Xenora e del sito, ai sensi del Regolamento (UE) 2016/679 (GDPR).</p>

      <h2>1. Titolare del trattamento</h2>
      <p>Titolare del trattamento è Xenora Digital Solutions — [ragione sociale], [indirizzo sede], P.IVA [__]. Contatto: <a href="mailto:info@xenora.it">info@xenora.it</a>.</p>

      <h2>2. Dati trattati</h2>
      <ul>
        <li><strong>Dati dell'account</strong>: nome, email, eventuale telefono (per l'accesso e la gestione del servizio).</li>
        <li><strong>Dati di gestione struttura</strong>: prenotazioni, ospiti, documenti caricati, incassi, comunicazioni — inseriti dall'utente per erogare il servizio.</li>
        <li><strong>Dati tecnici</strong>: log di accesso, indirizzo IP, dati d'uso necessari alla sicurezza e al funzionamento.</li>
      </ul>

      <h2>3. Finalità e basi giuridiche</h2>
      <ul>
        <li>Erogazione del servizio e adempimenti contrattuali (art. 6.1.b GDPR).</li>
        <li>Adempimenti di legge, inclusi gli obblighi verso la PA (Alloggiati Web, ISTAT) e fiscali (art. 6.1.c).</li>
        <li>Sicurezza, prevenzione abusi e miglioramento del servizio (legittimo interesse, art. 6.1.f).</li>
      </ul>

      <h2>4. Dati degli ospiti</h2>
      <p>L'utente (struttura ricettiva) è <strong>titolare autonomo</strong> del trattamento dei dati dei propri ospiti; Xenora agisce come <strong>responsabile del trattamento</strong> per suo conto, secondo un accordo (DPA) dedicato. I dati sono isolati per account e protetti da controlli di accesso.</p>

      <h2>5. Conservazione</h2>
      <p>I dati sono conservati per il tempo necessario alle finalità indicate e agli obblighi di legge. Le immagini dei documenti d'identità vengono rimosse dopo l'invio della schedina alla Questura.</p>

      <h2>6. Fornitori</h2>
      <p>Ci avvaliamo di fornitori che trattano dati per nostro conto (es. hosting e database, invio email, pagamenti, distribuzione sui canali), tutti vincolati contrattualmente e conformi al GDPR.</p>

      <h2>7. Diritti dell'interessato</h2>
      <p>Puoi esercitare i diritti di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione scrivendo a <a href="mailto:info@xenora.it">info@xenora.it</a>. Hai inoltre diritto di reclamo al Garante per la protezione dei dati personali.</p>
    </LegalShell>
  );
}
