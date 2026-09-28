import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";

export const metadata: Metadata = { title: "Termini di servizio · Xenora" };

export default function TerminiPage() {
  return (
    <LegalShell title="Termini di servizio" updated="Settembre 2026">
      <p>I presenti Termini regolano l&apos;utilizzo del gestionale Xenora, fornito da <strong>Xenora Digital Solutions</strong>. Utilizzando il servizio accetti questi Termini.</p>

      <h2>1. Oggetto del servizio</h2>
      <p>Xenora è un software gestionale (PMS + Channel Manager) per strutture ricettive: gestione di prenotazioni, canali, check-in, adempimenti verso la PA, incassi e comunicazioni.</p>

      <h2>2. Account e accesso</h2>
      <p>L&apos;accesso avviene su invito/autorizzazione. L&apos;utente è responsabile della riservatezza delle proprie credenziali e delle attività svolte con il proprio account.</p>

      <h2>3. Uso corretto</h2>
      <p>L&apos;utente si impegna a usare il servizio nel rispetto della legge, a inserire dati veritieri e a non comprometterne la sicurezza o il funzionamento.</p>

      <h2>4. Abbonamento e pagamenti</h2>
      <p>Il servizio è offerto a canone secondo il piano scelto. Salvo diversa indicazione, non sono previste commissioni sulle prenotazioni dirette. Le condizioni economiche di dettaglio sono indicate al momento dell&apos;attivazione.</p>

      <h2>5. Dati e responsabilità</h2>
      <p>L&apos;utente è titolare dei dati inseriti (inclusi i dati degli ospiti) e ne garantisce la liceità. Xenora adotta misure di sicurezza adeguate ma non risponde di usi impropri da parte dell&apos;utente. Vedi l&apos;<a href="/privacy">Informativa sulla privacy</a>.</p>

      <h2>6. Disponibilità del servizio</h2>
      <p>Ci impegniamo a garantire la continuità del servizio, salvo interruzioni per manutenzione, cause tecniche o di forza maggiore.</p>

      <h2>7. Recesso</h2>
      <p>L&apos;utente può cessare l&apos;utilizzo in qualsiasi momento; i dati possono essere esportati prima della chiusura dell&apos;account.</p>

      <h2>8. Legge applicabile</h2>
      <p>I presenti Termini sono regolati dalla legge italiana. Per ogni controversia è competente il foro del luogo in cui ha sede il Titolare, salvo norme inderogabili a tutela del consumatore.</p>

      <h2>9. Contatti</h2>
      <p><a href="mailto:info@xenora.it">info@xenora.it</a></p>
    </LegalShell>
  );
}
