// Modelli di messaggio d'esempio, precaricati la prima volta (localStorage vuoto) così
// il menu "Inserisci un modello" e la coda invii non partono vuoti. Usati sia dalla chat
// (Conversazioni) sia dalla pagina Modelli & automazioni. Segnaposto: {ospite} {struttura}
// {camera} {checkin} {checkout} {saldo} {notti} {link_guida} {codice_accesso}.

export const MSG_TEMPLATES_KEY = "spigolestay:msgtemplates";

export interface MsgTemplateSeed {
  id: string;
  name: string;
  texts: { it: string; en: string; fr: string; de: string; es: string };
  trigger: "manual" | "before_arrival" | "on_arrival" | "after_arrival" | "on_checkout" | "after_checkout";
  days: number;
  time: string;
  active: boolean;
}

export const DEFAULT_TEMPLATES: MsgTemplateSeed[] = [
  {
    id: "seed-welcome", name: "Benvenuto pre-arrivo", trigger: "before_arrival", days: 2, time: "10:00", active: true,
    texts: {
      it: "Ciao {ospite}, benvenuto/a! Tra pochi giorni ti aspettiamo a {struttura}. Il check-in è {checkin}. Per qualsiasi cosa scrivici pure qui, a presto! 👋",
      en: "Hi {ospite}, welcome! We look forward to hosting you at {struttura} in a few days. Check-in is {checkin}. Message us here for anything — see you soon! 👋",
      fr: "Bonjour {ospite}, bienvenue ! Nous vous attendons à {struttura} dans quelques jours. L'arrivée est {checkin}. Écrivez-nous ici pour toute question, à bientôt ! 👋",
      de: "Hallo {ospite}, willkommen! In wenigen Tagen erwarten wir Sie in {struttura}. Check-in: {checkin}. Schreiben Sie uns hier bei Fragen – bis bald! 👋",
      es: "¡Hola {ospite}, bienvenido/a! Te esperamos en {struttura} en unos días. El check-in es {checkin}. Escríbenos aquí para lo que necesites, ¡hasta pronto! 👋",
    },
  },
  {
    id: "seed-checkin-online", name: "Richiesta check-in online", trigger: "before_arrival", days: 3, time: "10:00", active: false,
    texts: {
      it: "Ciao {ospite}, per velocizzare l'arrivo a {struttura} compila il check-in online (dati e documento): {link_checkin}. Bastano due minuti, grazie!",
      en: "Hi {ospite}, to speed up your arrival at {struttura}, please complete the online check-in (details and ID): {link_checkin}. It takes two minutes, thank you!",
      fr: "Bonjour {ospite}, pour accélérer votre arrivée à {struttura}, remplissez le check-in en ligne (données et pièce d'identité) : {link_checkin}. Deux minutes suffisent, merci !",
      de: "Hallo {ospite}, um Ihre Ankunft in {struttura} zu beschleunigen, füllen Sie bitte den Online-Check-in (Daten und Ausweis) aus: {link_checkin}. Dauert nur zwei Minuten, danke!",
      es: "¡Hola {ospite}! Para agilizar tu llegada a {struttura}, completa el check-in online (datos y documento): {link_checkin}. Solo dos minutos, ¡gracias!",
    },
  },
  {
    id: "seed-checkin", name: "Istruzioni check-in", trigger: "on_arrival", days: 0, time: "09:00", active: true,
    texts: {
      it: "Ciao {ospite}, oggi è il giorno dell'arrivo! Qui trovi la guida con tutte le info utili (accesso, wi-fi, dintorni): {link_guida}. Il check-in è {checkin}. Buon viaggio!",
      en: "Hi {ospite}, today is arrival day! Here's the guide with all the useful info (access, wi-fi, area): {link_guida}. Check-in is {checkin}. Safe travels!",
      fr: "Bonjour {ospite}, c'est le jour de l'arrivée ! Voici le guide avec toutes les infos utiles (accès, wi-fi, alentours) : {link_guida}. L'arrivée est {checkin}. Bon voyage !",
      de: "Hallo {ospite}, heute ist Anreisetag! Hier der Guide mit allen Infos (Zugang, WLAN, Umgebung): {link_guida}. Check-in: {checkin}. Gute Reise!",
      es: "¡Hola {ospite}, hoy es el día de llegada! Aquí tienes la guía con toda la info útil (acceso, wi-fi, alrededores): {link_guida}. El check-in es {checkin}. ¡Buen viaje!",
    },
  },
  {
    id: "seed-review", name: "Richiesta recensione", trigger: "after_checkout", days: 1, time: "11:00", active: true,
    texts: {
      it: "Grazie {ospite} per aver soggiornato a {struttura}! Se ti sei trovato bene, una recensione ci aiuterebbe tantissimo. A presto! 🙏",
      en: "Thank you {ospite} for staying at {struttura}! If you enjoyed it, a review would help us a lot. See you soon! 🙏",
      fr: "Merci {ospite} d'avoir séjourné à {struttura} ! Si vous avez apprécié, un avis nous aiderait beaucoup. À bientôt ! 🙏",
      de: "Danke {ospite} für Ihren Aufenthalt in {struttura}! Wenn es Ihnen gefallen hat, würde uns eine Bewertung sehr helfen. Bis bald! 🙏",
      es: "¡Gracias {ospite} por alojarte en {struttura}! Si te ha gustado, una reseña nos ayudaría mucho. ¡Hasta pronto! 🙏",
    },
  },
];
