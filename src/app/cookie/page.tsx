import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";

export const metadata: Metadata = { title: "Cookie Policy · Xenora" };

export default function CookiePage() {
  return (
    <LegalShell title="Cookie Policy" updated="Settembre 2026">
      <p>Questa pagina spiega quali cookie e tecnologie simili utilizza Xenora e come gestirli.</p>

      <h2>1. Cosa sono i cookie</h2>
      <p>I cookie sono piccoli file salvati sul tuo dispositivo che permettono al servizio di funzionare correttamente e di ricordare alcune preferenze.</p>

      <h2>2. Cookie che utilizziamo</h2>
      <ul>
        <li><strong>Tecnici / necessari</strong>: indispensabili per l'accesso e il funzionamento del gestionale (sessione di login, sicurezza). Non richiedono consenso.</li>
        <li><strong>Di preferenza</strong>: memorizzano scelte come la lingua o le impostazioni dell'interfaccia.</li>
        <li><strong>Analitici</strong> (se attivati): ci aiutano a capire in forma aggregata come viene usato il servizio, per migliorarlo. Utilizzati solo previo consenso.</li>
      </ul>

      <h2>3. Cookie di terze parti</h2>
      <p>Alcune funzioni si appoggiano a fornitori (es. autenticazione, pagamenti) che possono impostare cookie tecnici necessari all'erogazione del servizio.</p>

      <h2>4. Gestione dei cookie</h2>
      <p>Puoi gestire o eliminare i cookie dalle impostazioni del tuo browser. La disattivazione dei cookie tecnici può compromettere il funzionamento del servizio.</p>

      <h2>5. Contatti</h2>
      <p>Per domande sui cookie scrivi a <a href="mailto:info@xenora.it">info@xenora.it</a>. Vedi anche l&apos;<a href="/privacy">Informativa sulla privacy</a>.</p>
    </LegalShell>
  );
}
