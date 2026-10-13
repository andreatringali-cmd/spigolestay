// Modelli di messaggio d'esempio, precaricati la prima volta (localStorage vuoto) così
// il menu "Inserisci un modello" e la coda invii non partono vuoti. Usati sia dalla chat
// (Conversazioni) sia dalla pagina Modelli & automazioni. Segnaposto: {ospite} {struttura}
// {camera} {checkin} {checkout} {saldo} {notti} {link_guida} {link_checkin} {codice_accesso}
// {whatsapp} (numero della struttura) e, per la richiesta di recensione, {link_recensioni}
// (elenco dei link Google/Tripadvisor configurati; vedi lib/auto-review.ts).

export const MSG_TEMPLATES_KEY = "spigolestay:msgtemplates";

export interface MsgTemplateSeed {
  id: string;
  name: string;
  texts: { it: string; en: string; fr: string; de: string; es: string };
  trigger: "manual" | "before_arrival" | "on_arrival" | "after_arrival" | "on_checkout" | "after_checkout";
  days: number;
  time: string;
  active: boolean;
  structureIds?: string[]; // assente/vuoto = vale per tutte le strutture
}

export const DEFAULT_TEMPLATES: MsgTemplateSeed[] = [
  {
    // Pre-arrivo (giorno prima): check-in online + guida + come entrare. La struttura non ha reception: l'ospite scrive su WhatsApp.
    id: "seed-benvenuto-guida", name: "Benvenuto e guida", trigger: "before_arrival", days: 1, time: "10:00", active: true,
    texts: {
      it: "Buongiorno {ospite}, siamo lieti di accogliervi a {struttura}! 🌿\nLa struttura non ha una reception: l'arrivo è autonomo e vi accompagniamo noi.\n\n1) Check-in online (2 minuti, dati e documento):\n👉 {link_checkin}\n2) Guida con accesso, Wi-Fi e consigli utili:\n👉 {link_guida}\n\nQuando siete in arrivo scriveteci su WhatsApp ({whatsapp}) e vi guidiamo all'ingresso. Il check-in è {checkin}.\n— {struttura}",
      en: "Hello {ospite}, we're delighted to welcome you to {struttura}! 🌿\nThe property has no reception: arrival is self-service and we'll guide you every step of the way.\n\n1) Online check-in (2 minutes, details and ID):\n👉 {link_checkin}\n2) Guide with access, Wi-Fi and useful tips:\n👉 {link_guida}\n\nWhen you're on your way, message us on WhatsApp ({whatsapp}) and we'll guide you to the entrance. Check-in is {checkin}.\n— {struttura}",
      fr: "Bonjour {ospite}, nous sommes ravis de vous accueillir à {struttura} ! 🌿\nLe logement n'a pas de réception : l'arrivée est autonome et nous vous guidons pas à pas.\n\n1) Check-in en ligne (2 minutes, données et pièce d'identité) :\n👉 {link_checkin}\n2) Guide avec accès, Wi-Fi et conseils utiles :\n👉 {link_guida}\n\nEn route, écrivez-nous sur WhatsApp ({whatsapp}) et nous vous guidons jusqu'à l'entrée. L'arrivée est {checkin}.\n— {struttura}",
      de: "Guten Tag {ospite}, wir freuen uns, Sie in {struttura} begrüßen zu dürfen! 🌿\nDie Unterkunft hat keine Rezeption: Die Ankunft läuft selbstständig und wir führen Sie Schritt für Schritt.\n\n1) Online-Check-in (2 Minuten, Daten und Ausweis):\n👉 {link_checkin}\n2) Guide mit Zugang, WLAN und nützlichen Tipps:\n👉 {link_guida}\n\nWenn Sie unterwegs sind, schreiben Sie uns per WhatsApp ({whatsapp}) und wir lotsen Sie zum Eingang. Check-in: {checkin}.\n— {struttura}",
      es: "¡Buenos días {ospite}, estamos encantados de recibirte en {struttura}! 🌿\nEl alojamiento no tiene recepción: la llegada es autónoma y te guiamos nosotros.\n\n1) Check-in online (2 minutos, datos y documento):\n👉 {link_checkin}\n2) Guía con acceso, Wi-Fi y consejos útiles:\n👉 {link_guida}\n\nCuando vayas de camino, escríbenos por WhatsApp ({whatsapp}) y te guiamos hasta la entrada. El check-in es {checkin}.\n— {struttura}",
    },
  },
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
      it: "Ciao {ospite}, oggi è il giorno dell'arrivo! 🎉\nGuida con accesso, Wi-Fi e dintorni: {link_guida}\nIl check-in è {checkin}. Non c'è reception: all'arrivo, o se fate tardi, scriveteci su WhatsApp ({whatsapp}) e vi aiutiamo subito. Buon viaggio!",
      en: "Hi {ospite}, today is arrival day! 🎉\nGuide with access, Wi-Fi and the area: {link_guida}\nCheck-in is {checkin}. There's no reception: when you arrive, or if you're running late, message us on WhatsApp ({whatsapp}) and we'll help right away. Safe travels!",
      fr: "Bonjour {ospite}, c'est le jour de l'arrivée ! 🎉\nGuide avec accès, Wi-Fi et alentours : {link_guida}\nL'arrivée est {checkin}. Il n'y a pas de réception : à l'arrivée, ou en cas de retard, écrivez-nous sur WhatsApp ({whatsapp}) et nous vous aidons tout de suite. Bon voyage !",
      de: "Hallo {ospite}, heute ist Anreisetag! 🎉\nGuide mit Zugang, WLAN und Umgebung: {link_guida}\nCheck-in: {checkin}. Es gibt keine Rezeption: Schreiben Sie uns bei Ankunft oder Verspätung per WhatsApp ({whatsapp}), wir helfen sofort. Gute Reise!",
      es: "¡Hola {ospite}, hoy es el día de llegada! 🎉\nGuía con acceso, Wi-Fi y alrededores: {link_guida}\nEl check-in es {checkin}. No hay recepción: al llegar, o si te retrasas, escríbenos por WhatsApp ({whatsapp}) y te ayudamos enseguida. ¡Buen viaje!",
    },
  },
  {
    // Dopo il check-out (giorno dopo la partenza): invito a una recensione sincera, con i link ai portali configurati ({link_recensioni}).
    // Nessun incentivo. Il cron invia solo con almeno un link e salta annullate/no-show, ospiti "Da recuperare" e richieste già fatte (vedi lib/auto-review.ts).
    id: "seed-review", name: "Richiesta recensione", trigger: "after_checkout", days: 1, time: "11:00", active: true,
    texts: {
      it: "Grazie {ospite} per aver soggiornato a {struttura}! 🙏 Se ti va, lasciaci una recensione sincera sulla tua esperienza: per noi è molto importante e richiede un minuto.\n{link_recensioni}\nGrazie ancora e a presto!",
      en: "Thank you {ospite} for staying at {struttura}! 🙏 If you'd like, please share an honest review of your experience: it means a lot to us and takes just a minute.\n{link_recensioni}\nThanks again and see you soon!",
      fr: "Merci {ospite} d'avoir séjourné à {struttura} ! 🙏 Si vous le souhaitez, laissez-nous un avis sincère sur votre expérience : c'est très important pour nous et cela ne prend qu'une minute.\n{link_recensioni}\nMerci encore et à bientôt !",
      de: "Danke {ospite} für Ihren Aufenthalt in {struttura}! 🙏 Wenn Sie möchten, hinterlassen Sie uns eine ehrliche Bewertung Ihrer Erfahrung: Das ist uns sehr wichtig und dauert nur eine Minute.\n{link_recensioni}\nNochmals danke und bis bald!",
      es: "¡Gracias {ospite} por alojarte en {struttura}! 🙏 Si te apetece, déjanos una reseña sincera sobre tu experiencia: es muy importante para nosotros y solo lleva un minuto.\n{link_recensioni}\n¡Gracias de nuevo y hasta pronto!",
    },
  },
];

// Testi PRECEDENTI dei modelli d'esempio che abbiamo migliorato: un modello salvato i cui testi sono ancora identici a questi (cioè mai
// modificato dall'host) passa in automatico alla versione nuova. Se l'host ha cambiato anche solo una parola, non si tocca.
const LEGACY_SEED_TEXTS: Record<string, Record<string, string>> = {
  "seed-benvenuto-guida": {
    it: "Buongiorno {ospite}, siamo lieti di accogliervi a {struttura}! 🌿\nA seguire la guida che vi permetterà di accedere alla struttura e vivere al meglio il soggiorno: check-in, Wi-Fi, consigli utili e i nostri contatti.\n\n👉 {link_guida}\n\nRestiamo a disposizione per qualsiasi cosa. A presto!\n— {struttura}",
    en: "Hello {ospite}, we're delighted to welcome you to {struttura}! 🌿\nHere is the guide that will let you access the property and make the most of your stay: check-in, Wi-Fi, useful tips and our contacts.\n\n👉 {link_guida}\n\nWe're here for anything you need. See you soon!\n— {struttura}",
    fr: "Bonjour {ospite}, nous sommes ravis de vous accueillir à {struttura} ! 🌿\nVoici le guide qui vous permettra d'accéder au logement et de profiter au mieux de votre séjour : arrivée, Wi-Fi, conseils utiles et nos contacts.\n\n👉 {link_guida}\n\nNous restons à votre disposition. À bientôt !\n— {struttura}",
    de: "Guten Tag {ospite}, wir freuen uns, Sie in {struttura} begrüßen zu dürfen! 🌿\nHier der Guide für den Zugang zur Unterkunft und einen perfekten Aufenthalt: Check-in, WLAN, nützliche Tipps und unsere Kontakte.\n\n👉 {link_guida}\n\nBei Fragen sind wir für Sie da. Bis bald!\n— {struttura}",
    es: "¡Buenos días {ospite}, estamos encantados de recibirte en {struttura}! 🌿\nA continuación la guía que te permitirá acceder al alojamiento y disfrutar al máximo tu estancia: check-in, Wi-Fi, consejos útiles y nuestros contactos.\n\n👉 {link_guida}\n\nQuedamos a tu disposición para cualquier cosa. ¡Hasta pronto!\n— {struttura}",
  },
  "seed-checkin": {
    it: "Ciao {ospite}, oggi è il giorno dell'arrivo! Qui trovi la guida con tutte le info utili (accesso, wi-fi, dintorni): {link_guida}. Il check-in è {checkin}. Buon viaggio!",
    en: "Hi {ospite}, today is arrival day! Here's the guide with all the useful info (access, wi-fi, area): {link_guida}. Check-in is {checkin}. Safe travels!",
    fr: "Bonjour {ospite}, c'est le jour de l'arrivée ! Voici le guide avec toutes les infos utiles (accès, wi-fi, alentours) : {link_guida}. L'arrivée est {checkin}. Bon voyage !",
    de: "Hallo {ospite}, heute ist Anreisetag! Hier der Guide mit allen Infos (Zugang, WLAN, Umgebung): {link_guida}. Check-in: {checkin}. Gute Reise!",
    es: "¡Hola {ospite}, hoy es el día de llegada! Aquí tienes la guía con toda la info útil (acceso, wi-fi, alrededores): {link_guida}. El check-in es {checkin}. ¡Buen viaje!",
  },
  "seed-review": {
    it: "Grazie {ospite} per aver soggiornato a {struttura}! Se ti sei trovato bene, una recensione ci aiuterebbe tantissimo. A presto! 🙏",
    en: "Thank you {ospite} for staying at {struttura}! If you enjoyed it, a review would help us a lot. See you soon! 🙏",
    fr: "Merci {ospite} d'avoir séjourné à {struttura} ! Si vous avez apprécié, un avis nous aiderait beaucoup. À bientôt ! 🙏",
    de: "Danke {ospite} für Ihren Aufenthalt in {struttura}! Wenn es Ihnen gefallen hat, würde uns eine Bewertung sehr helfen. Bis bald! 🙏",
    es: "¡Gracias {ospite} por alojarte en {struttura}! Si te ha gustado, una reseña nos ayudaría mucho. ¡Hasta pronto! 🙏",
  },
};

const norm = (s: unknown) => (typeof s === "string" ? s.replace(/\r\n/g, "\n").trim() : "");

/**
 * Modelli salvati + modelli d'esempio: aggiunge quelli d'esempio mancanti (per id) e aggiorna i modelli d'esempio MAI MODIFICATI
 * (testi identici ai vecchi) alla versione nuova. Sostituisce solo i testi: attivazione, giorni, orario e strutture restano quelli dell'host.
 */
export function mergeSeedTemplates<T extends { id: string; texts?: Record<string, string> }>(saved: T[]): T[] {
  const have = new Set(saved.map((x) => x.id));
  const upgraded = saved.map((tp) => {
    const old = LEGACY_SEED_TEXTS[tp.id]; const seed = DEFAULT_TEMPLATES.find((d) => d.id === tp.id);
    if (!old || !seed || !tp.texts) return tp;
    const untouched = (Object.keys(old) as (keyof typeof seed.texts)[]).every((l) => norm(tp.texts?.[l]) === norm(old[l]));
    return untouched ? ({ ...tp, texts: { ...seed.texts } } as T) : tp;
  });
  return [...upgraded, ...(DEFAULT_TEMPLATES.filter((d) => !have.has(d.id)) as unknown as T[])];
}
