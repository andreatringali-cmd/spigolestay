// Lingua delle email transazionali all'OSPITE (conferma/voucher, annullamento, sollecito check-in): it · en · fr · de · es.
// La lingua è quella dell'ospite: impostata a mano nella scheda, altrimenti dal Paese o dal prefisso del telefono (lib/guest-lang.ts).
// Chiave = testo italiano; valori [en, fr, de, es]. Puro: lo usa la route /api/email (server).

import { dateLocale, translate, asGuestLang, type GuestDict } from "./guest-i18n";
import { guestLangOf } from "./guest-lang";
import type { GuestLang } from "./phone-country";

export const EMAIL_DICT: GuestDict = {
  "ospite": ["guest", "client", "Gast", "huésped"],
  "Ciao <b>{name}</b>,": ["Hello <b>{name}</b>,", "Bonjour <b>{name}</b>,", "Hallo <b>{name}</b>,", "Hola <b>{name}</b>,"],
  // conferma
  "Conferma prenotazione": ["Booking confirmation", "Confirmation de réservation", "Buchungsbestätigung", "Confirmación de reserva"],
  "la tua prenotazione presso <b>{structure}</b> è confermata. Ecco il riepilogo completo.": ["your booking at <b>{structure}</b> is confirmed. Here is the full summary.", "votre réservation à <b>{structure}</b> est confirmée. Voici le récapitulatif complet.", "Ihre Buchung in <b>{structure}</b> ist bestätigt. Hier die vollständige Übersicht.", "tu reserva en <b>{structure}</b> está confirmada. Aquí tienes el resumen completo."],
  "Codice prenotazione": ["Booking code", "Code de réservation", "Buchungscode", "Código de reserva"],
  "Arrivo": ["Arrival", "Arrivée", "Anreise", "Llegada"],
  "Partenza": ["Departure", "Départ", "Abreise", "Salida"],
  "Notti": ["Nights", "Nuits", "Nächte", "Noches"],
  "dalle {time}": ["from {time}", "dès {time}", "ab {time} Uhr", "desde las {time}"],
  "entro {time}": ["by {time}", "avant {time}", "bis {time} Uhr", "antes de las {time}"],
  "Riepilogo economico": ["Price summary", "Récapitulatif financier", "Preisübersicht", "Resumen económico"],
  "Totale camere": ["Rooms total", "Total des chambres", "Zimmer gesamt", "Total habitaciones"],
  "Totale extra": ["Extras total", "Total des extras", "Extras gesamt", "Total extras"],
  "Totale prenotazione": ["Booking total", "Total de la réservation", "Buchung gesamt", "Total de la reserva"],
  "Tassa di soggiorno": ["City tax", "Taxe de séjour", "Kurtaxe", "Tasa turística"],
  "Totale": ["Total", "Total", "Gesamt", "Total"],
  "Totale incassato": ["Total paid", "Total encaissé", "Bereits bezahlt", "Total cobrado"],
  "Totale da incassare": ["Balance due", "Reste à payer", "Noch zu zahlen", "Pendiente de cobro"],
  "Dettaglio costi": ["Cost details", "Détail des coûts", "Kostendetails", "Detalle de costes"],
  "Camera": ["Room", "Chambre", "Zimmer", "Habitación"],
  "Tariffa": ["Rate", "Tarif", "Tarif", "Tarifa"],
  "Servizi extra": ["Extra services", "Services supplémentaires", "Zusatzleistungen", "Servicios extra"],
  "Nessuno": ["None", "Aucun", "Keine", "Ninguno"],
  "Ospiti": ["Guests", "Voyageurs", "Gäste", "Huéspedes"],
  "Bambini": ["Children", "Enfants", "Kinder", "Niños"],
  "Richieste speciali": ["Special requests", "Demandes spéciales", "Besondere Wünsche", "Peticiones especiales"],
  "Nessuna richiesta specificata.": ["No request specified.", "Aucune demande indiquée.", "Keine Wünsche angegeben.", "Ninguna petición indicada."],
  "Termini e condizioni di prenotazione": ["Booking terms and conditions", "Conditions de réservation", "Buchungsbedingungen", "Términos y condiciones de la reserva"],
  "Gestisci la tua prenotazione →": ["Manage your booking →", "Gérez votre réservation →", "Buchung verwalten →", "Gestiona tu reserva →"],
  "Completare i dati mancanti e fare il <b>check-in online</b>": ["Complete any missing details and do the <b>online check-in</b>", "Compléter les données manquantes et faire le <b>check-in en ligne</b>", "Fehlende Daten ergänzen und den <b>Online-Check-in</b> durchführen", "Completar los datos que falten y hacer el <b>check-in online</b>"],
  "Vedere lo stato del pagamento e <b>saldare</b> l'importo dovuto": ["See the payment status and <b>pay</b> the amount due", "Voir l'état du paiement et <b>régler</b> le montant dû", "Zahlungsstatus einsehen und den offenen Betrag <b>bezahlen</b>", "Ver el estado del pago y <b>abonar</b> el importe pendiente"],
  "Inviare <b>richieste particolari</b> alla struttura": ["Send <b>special requests</b> to the property", "Envoyer des <b>demandes particulières</b> à l'établissement", "<b>Besondere Wünsche</b> an die Unterkunft senden", "Enviar <b>peticiones especiales</b> al alojamiento"],
  "Gestisci la prenotazione (modifica o annulla)": ["Manage the booking (change or cancel)", "Gérer la réservation (modifier ou annuler)", "Buchung verwalten (ändern oder stornieren)", "Gestionar la reserva (modificar o cancelar)"],
  "QR gestione prenotazione": ["Booking management QR code", "QR de gestion de la réservation", "QR-Code zur Buchungsverwaltung", "QR de gestión de la reserva"],
  "Inquadra per gestire la prenotazione dal telefono": ["Scan to manage the booking from your phone", "Scannez pour gérer la réservation depuis votre téléphone", "Scannen, um die Buchung auf dem Handy zu verwalten", "Escanea para gestionar la reserva desde el móvil"],
  "Visita il nostro sito": ["Visit our website", "Visitez notre site", "Besuchen Sie unsere Website", "Visita nuestra web"],
  "Apri in Google Maps": ["Open in Google Maps", "Ouvrir dans Google Maps", "In Google Maps öffnen", "Abrir en Google Maps"],
  "Confermata": ["Confirmed", "Confirmée", "Bestätigt", "Confirmada"],
  "In attesa di conferma": ["Pending confirmation", "En attente de confirmation", "Bestätigung ausstehend", "Pendiente de confirmación"],
  "Annullata": ["Cancelled", "Annulée", "Storniert", "Cancelada"],
  // annullamento
  "Prenotazione annullata": ["Booking cancelled", "Réservation annulée", "Buchung storniert", "Reserva cancelada"],
  "la tua prenotazione presso <b>{structure}</b> è stata <b>annullata</b>.": ["your booking at <b>{structure}</b> has been <b>cancelled</b>.", "votre réservation à <b>{structure}</b> a été <b>annulée</b>.", "Ihre Buchung in <b>{structure}</b> wurde <b>storniert</b>.", "tu reserva en <b>{structure}</b> ha sido <b>cancelada</b>."],
  "Codice": ["Code", "Code", "Code", "Código"],
  "Struttura": ["Property", "Établissement", "Unterkunft", "Alojamiento"],
  "Periodo": ["Period", "Période", "Zeitraum", "Periodo"],
  "Rimborso emesso: {amount}": ["Refund issued: {amount}", "Remboursement émis : {amount}", "Erstattung veranlasst: {amount}", "Reembolso emitido: {amount}"],
  "L'importo tornerà sul metodo di pagamento usato entro 5–10 giorni lavorativi (tempi della banca).": ["The amount will return to the payment method used within 5–10 working days (bank processing times).", "Le montant sera recrédité sur le moyen de paiement utilisé sous 5 à 10 jours ouvrés (délais bancaires).", "Der Betrag wird innerhalb von 5–10 Werktagen auf das verwendete Zahlungsmittel zurückgebucht (Bearbeitungszeit der Bank).", "El importe volverá al método de pago utilizado en 5–10 días laborables (plazos del banco)."],
  "Nessun rimborso previsto": ["No refund due", "Aucun remboursement prévu", "Keine Erstattung vorgesehen", "Sin reembolso previsto"],
  "Secondo le condizioni della tariffa prenotata.": ["According to the terms of the rate booked.", "Selon les conditions du tarif réservé.", "Gemäß den Bedingungen des gebuchten Tarifs.", "Según las condiciones de la tarifa reservada."],
  "Ci dispiace vederti annullare. Sarai sempre il benvenuto in futuro.": ["We are sorry to see you cancel. You will always be welcome in the future.", "Nous sommes désolés de cette annulation. Vous serez toujours le bienvenu.", "Schade, dass Sie stornieren. Sie sind jederzeit wieder willkommen.", "Lamentamos que canceles. Serás siempre bienvenido."],
  // sollecito check-in
  "Completa il check-in": ["Complete your check-in", "Terminez votre check-in", "Check-in abschließen", "Completa tu check-in"],
  "Completa il check-in online": ["Complete your online check-in", "Terminez votre check-in en ligne", "Schließen Sie Ihren Online-Check-in ab", "Completa tu check-in online"],
  "manca poco al tuo arrivo presso <b>{structure}</b>. Completa il <b>check-in online</b> adesso: è veloce e al tuo arrivo eviti l'attesa.": ["your arrival at <b>{structure}</b> is just around the corner. Complete the <b>online check-in</b> now: it is quick and saves you waiting on arrival.", "votre arrivée à <b>{structure}</b> approche. Terminez dès maintenant le <b>check-in en ligne</b> : c'est rapide et vous évitez l'attente à l'arrivée.", "Ihre Ankunft in <b>{structure}</b> steht kurz bevor. Schließen Sie jetzt den <b>Online-Check-in</b> ab: Das geht schnell und erspart Ihnen die Wartezeit bei der Ankunft.", "falta poco para tu llegada a <b>{structure}</b>. Completa ahora el <b>check-in online</b>: es rápido y evitas esperas a tu llegada."],
  "Fai il check-in online →": ["Do the online check-in →", "Faire le check-in en ligne →", "Online-Check-in durchführen →", "Hacer el check-in online →"],
  "Compila i dati prima dell'arrivo: risparmi tempo al check-in.": ["Fill in your details before arriving: you save time at check-in.", "Remplissez vos données avant l'arrivée : vous gagnez du temps au check-in.", "Tragen Sie Ihre Daten vor der Ankunft ein: So sparen Sie Zeit beim Check-in.", "Rellena los datos antes de llegar: ahorras tiempo en el check-in."],
  // politiche (composte dal server a partire dai dati strutturati)
  "La prenotazione non è rimborsabile.": ["The booking is non-refundable.", "La réservation n'est pas remboursable.", "Die Buchung ist nicht erstattungsfähig.", "La reserva no es reembolsable."],
  "Cancellazione gratuita fino a {days} giorni prima dell'arrivo. Oltre questo termine è dovuto l'intero importo della prenotazione.": ["Free cancellation up to {days} days before arrival. After that the full booking amount is due.", "Annulation gratuite jusqu'à {days} jours avant l'arrivée. Passé ce délai, le montant total de la réservation est dû.", "Kostenlose Stornierung bis {days} Tage vor Anreise. Danach ist der gesamte Buchungsbetrag fällig.", "Cancelación gratuita hasta {days} días antes de la llegada. Pasado ese plazo se debe el importe total de la reserva."],
  "Cancellazione gratuita fino al giorno di arrivo.": ["Free cancellation until the day of arrival.", "Annulation gratuite jusqu'au jour d'arrivée.", "Kostenlose Stornierung bis zum Anreisetag.", "Cancelación gratuita hasta el día de llegada."],
  "La tassa di soggiorno è pari al {pct}% della prenotazione.": ["The city tax is {pct}% of the booking.", "La taxe de séjour est de {pct} % de la réservation.", "Die Kurtaxe beträgt {pct} % der Buchung.", "La tasa turística es del {pct}% de la reserva."],
  "Massimo {cap} EUR a persona per notte.": ["Maximum {cap} EUR per person per night.", "Maximum {cap} EUR par personne et par nuit.", "Höchstens {cap} EUR pro Person und Nacht.", "Máximo {cap} EUR por persona y noche."],
  "La tassa di soggiorno è di {amount} EUR a persona per notte.": ["The city tax is {amount} EUR per person per night.", "La taxe de séjour est de {amount} EUR par personne et par nuit.", "Die Kurtaxe beträgt {amount} EUR pro Person und Nacht.", "La tasa turística es de {amount} EUR por persona y noche."],
  "Non si applica ai bambini con età inferiore a {age} anni.": ["It does not apply to children under {age}.", "Elle ne s'applique pas aux enfants de moins de {age} ans.", "Sie gilt nicht für Kinder unter {age} Jahren.", "No se aplica a los niños menores de {age} años."],
  "La tassa di soggiorno non è inclusa nel totale e sarà pagata in base alle politiche di pagamento definite dalla struttura.": ["The city tax is not included in the total and will be paid according to the property's payment policy.", "La taxe de séjour n'est pas incluse dans le total et sera réglée selon la politique de paiement de l'établissement.", "Die Kurtaxe ist im Gesamtbetrag nicht enthalten und wird gemäß den Zahlungsbedingungen der Unterkunft bezahlt.", "La tasa turística no está incluida en el total y se pagará según la política de pago del alojamiento."],
};

export const et = (lang: GuestLang, s: string, vars?: Record<string, string | number>) => translate(EMAIL_DICT, lang, s, vars);
export { dateLocale };

/** Dati dell'ospite che servono a scegliere la lingua dell'email. `lang` = scelta esplicita di chi invia (vince su tutto). */
export interface EmailLangInput { lang?: string | null; guestLanguage?: string | null; guestCountry?: string | null; guestPhone?: string | null }
export function emailLang(b?: EmailLangInput | null): GuestLang {
  return asGuestLang(b?.lang) ?? guestLangOf({ language: b?.guestLanguage, country: b?.guestCountry, phone: b?.guestPhone });
}

/** Politica di cancellazione nella lingua dell'ospite, dai dati strutturati (stesse frasi di mailer.ts in italiano). */
export function cancelPolicyIn(lang: GuestLang, refundable?: boolean, cancelDays?: number): string {
  if (!refundable) return et(lang, "La prenotazione non è rimborsabile.");
  if (cancelDays && cancelDays > 0) return et(lang, "Cancellazione gratuita fino a {days} giorni prima dell'arrivo. Oltre questo termine è dovuto l'intero importo della prenotazione.", { days: cancelDays });
  return et(lang, "Cancellazione gratuita fino al giorno di arrivo.");
}

export interface CityTaxRule { mode?: string; percent?: number; cap?: number; amount?: number; childFreeUnder?: number }
/** Spiegazione della tassa di soggiorno nella lingua dell'ospite (stessa struttura del testo italiano di mailer.ts). */
export function cityTaxRuleIn(lang: GuestLang, r: CityTaxRule): string {
  const parts: string[] = [];
  if (r.mode === "percent") {
    parts.push(et(lang, "La tassa di soggiorno è pari al {pct}% della prenotazione.", { pct: r.percent ?? 0 }));
    if (r.cap) parts.push(et(lang, "Massimo {cap} EUR a persona per notte.", { cap: r.cap }));
  } else {
    parts.push(et(lang, "La tassa di soggiorno è di {amount} EUR a persona per notte.", { amount: r.amount ?? 0 }));
  }
  if (r.childFreeUnder) parts.push(et(lang, "Non si applica ai bambini con età inferiore a {age} anni.", { age: r.childFreeUnder }));
  parts.push(et(lang, "La tassa di soggiorno non è inclusa nel totale e sarà pagata in base alle politiche di pagamento definite dalla struttura."));
  return parts.join(" ");
}
