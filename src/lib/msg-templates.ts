// Modelli di messaggio d'esempio, precaricati la prima volta (localStorage vuoto) così
// il menu "Inserisci un modello" e la coda invii non partono vuoti. Usati sia dalla chat
// (Conversazioni) sia dalla pagina Modelli & automazioni. Segnaposto: {ospite} {struttura}
// {camera} {checkin} {checkout} {saldo} {notti} {link_guida} {link_checkin} {codice_accesso}
// {whatsapp} (numero della struttura) e, per la richiesta di recensione, {link_recensioni}
// (elenco dei link Google/Tripadvisor configurati; vedi lib/auto-review.ts).

export const MSG_TEMPLATES_KEY = "spigolestay:msgtemplates";
// Id dei modelli d'esempio eliminati dall'host (tombstone): senza, mergeSeedTemplates li riaggiungerebbe attivi a ogni apertura.
// NB: per essere condivisa tra dispositivi/collaboratori la chiave va aggiunta a src/lib/workspace-keys.ts (EXACT: "msgtemplates:deleted").
export const MSG_TEMPLATES_DELETED_KEY = "spigolestay:msgtemplates:deleted";

export function loadDeletedSeedIds(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const p = JSON.parse(localStorage.getItem(MSG_TEMPLATES_DELETED_KEY) || "[]");
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
/** Da chiamare quando l'host elimina un modello: se è un modello d'esempio ne ricorda l'id, così non viene rimesso. */
export function markSeedDeleted(id: string): void {
  try {
    if (!DEFAULT_TEMPLATES.some((d) => d.id === id)) return;
    const cur = loadDeletedSeedIds();
    if (!cur.includes(id)) localStorage.setItem(MSG_TEMPLATES_DELETED_KEY, JSON.stringify([...cur, id]));
  } catch { /* quota/privato: pazienza */ }
}
/** Se l'host rimette a mano un modello con quell'id (es. lo ricrea), l'id esce dai tombstone. */
export function unmarkSeedDeleted(id: string): void {
  try {
    const cur = loadDeletedSeedIds();
    if (cur.includes(id)) localStorage.setItem(MSG_TEMPLATES_DELETED_KEY, JSON.stringify(cur.filter((x) => x !== id)));
  } catch { /* niente */ }
}

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
      it: "Buongiorno {ospite}, siamo lieti di accogliervi a {struttura}! 🌿\nEcco tutto il necessario per un arrivo senza pensieri.\n\n1) Check-in online (2 minuti, dati e documento):\n👉 {link_checkin}\n2) Guida con accesso, Wi-Fi e consigli utili:\n👉 {link_guida}\n\nPer qualsiasi cosa siamo a disposizione su WhatsApp ({whatsapp}): quando siete in arrivo scriveteci e vi aiutiamo con l'ingresso. Il check-in è {checkin}.\n— {struttura}",
      en: "Hello {ospite}, we're delighted to welcome you to {struttura}! 🌿\nHere is everything you need for a worry-free arrival.\n\n1) Online check-in (2 minutes, details and ID):\n👉 {link_checkin}\n2) Guide with access, Wi-Fi and useful tips:\n👉 {link_guida}\n\nWe're available on WhatsApp ({whatsapp}) for anything you need: when you're on your way, message us and we'll help you get in. Check-in is {checkin}.\n— {struttura}",
      fr: "Bonjour {ospite}, nous sommes ravis de vous accueillir à {struttura} ! 🌿\nVoici tout ce qu'il faut pour une arrivée sans souci.\n\n1) Check-in en ligne (2 minutes, données et pièce d'identité) :\n👉 {link_checkin}\n2) Guide avec accès, Wi-Fi et conseils utiles :\n👉 {link_guida}\n\nNous sommes joignables sur WhatsApp ({whatsapp}) pour toute question : en route, écrivez-nous et nous vous aidons à entrer. L'arrivée est {checkin}.\n— {struttura}",
      de: "Guten Tag {ospite}, wir freuen uns, Sie in {struttura} begrüßen zu dürfen! 🌿\nHier alles für eine unkomplizierte Ankunft.\n\n1) Online-Check-in (2 Minuten, Daten und Ausweis):\n👉 {link_checkin}\n2) Guide mit Zugang, WLAN und nützlichen Tipps:\n👉 {link_guida}\n\nBei Fragen sind wir per WhatsApp ({whatsapp}) für Sie da: Wenn Sie unterwegs sind, schreiben Sie uns, wir helfen Ihnen beim Zugang. Check-in: {checkin}.\n— {struttura}",
      es: "¡Buenos días {ospite}, estamos encantados de recibirte en {struttura}! 🌿\nAquí tienes todo lo necesario para una llegada sin preocupaciones.\n\n1) Check-in online (2 minutos, datos y documento):\n👉 {link_checkin}\n2) Guía con acceso, Wi-Fi y consejos útiles:\n👉 {link_guida}\n\nEstamos a tu disposición por WhatsApp ({whatsapp}): cuando vayas de camino, escríbenos y te ayudamos con la entrada. El check-in es {checkin}.\n— {struttura}",
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
      it: "Ciao {ospite}, oggi è il giorno dell'arrivo! 🎉\nGuida con accesso, Wi-Fi e dintorni: {link_guida}\nIl check-in è {checkin}. All'arrivo, o se fate tardi, scriveteci su WhatsApp ({whatsapp}) e vi aiutiamo subito. Buon viaggio!",
      en: "Hi {ospite}, today is arrival day! 🎉\nGuide with access, Wi-Fi and the area: {link_guida}\nCheck-in is {checkin}. When you arrive, or if you're running late, message us on WhatsApp ({whatsapp}) and we'll help right away. Safe travels!",
      fr: "Bonjour {ospite}, c'est le jour de l'arrivée ! 🎉\nGuide avec accès, Wi-Fi et alentours : {link_guida}\nL'arrivée est {checkin}. À l'arrivée, ou en cas de retard, écrivez-nous sur WhatsApp ({whatsapp}) et nous vous aidons tout de suite. Bon voyage !",
      de: "Hallo {ospite}, heute ist Anreisetag! 🎉\nGuide mit Zugang, WLAN und Umgebung: {link_guida}\nCheck-in: {checkin}. Schreiben Sie uns bei Ankunft oder Verspätung per WhatsApp ({whatsapp}), wir helfen sofort. Gute Reise!",
      es: "¡Hola {ospite}, hoy es el día de llegada! 🎉\nGuía con acceso, Wi-Fi y alrededores: {link_guida}\nEl check-in es {checkin}. Al llegar, o si te retrasas, escríbenos por WhatsApp ({whatsapp}) y te ayudamos enseguida. ¡Buen viaje!",
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
const LEGACY_SEED_TEXTS: Record<string, Record<string, string>[]> = {
  "seed-benvenuto-guida": [{
    it: "Buongiorno {ospite}, siamo lieti di accogliervi a {struttura}! 🌿\nA seguire la guida che vi permetterà di accedere alla struttura e vivere al meglio il soggiorno: check-in, Wi-Fi, consigli utili e i nostri contatti.\n\n👉 {link_guida}\n\nRestiamo a disposizione per qualsiasi cosa. A presto!\n— {struttura}",
    en: "Hello {ospite}, we're delighted to welcome you to {struttura}! 🌿\nHere is the guide that will let you access the property and make the most of your stay: check-in, Wi-Fi, useful tips and our contacts.\n\n👉 {link_guida}\n\nWe're here for anything you need. See you soon!\n— {struttura}",
    fr: "Bonjour {ospite}, nous sommes ravis de vous accueillir à {struttura} ! 🌿\nVoici le guide qui vous permettra d'accéder au logement et de profiter au mieux de votre séjour : arrivée, Wi-Fi, conseils utiles et nos contacts.\n\n👉 {link_guida}\n\nNous restons à votre disposition. À bientôt !\n— {struttura}",
    de: "Guten Tag {ospite}, wir freuen uns, Sie in {struttura} begrüßen zu dürfen! 🌿\nHier der Guide für den Zugang zur Unterkunft und einen perfekten Aufenthalt: Check-in, WLAN, nützliche Tipps und unsere Kontakte.\n\n👉 {link_guida}\n\nBei Fragen sind wir für Sie da. Bis bald!\n— {struttura}",
    es: "¡Buenos días {ospite}, estamos encantados de recibirte en {struttura}! 🌿\nA continuación la guía que te permitirá acceder al alojamiento y disfrutar al máximo tu estancia: check-in, Wi-Fi, consejos útiles y nuestros contactos.\n\n👉 {link_guida}\n\nQuedamos a tu disposición para cualquier cosa. ¡Hasta pronto!\n— {struttura}",
  }, {
      it: "Buongiorno {ospite}, siamo lieti di accogliervi a {struttura}! 🌿\nLa struttura non ha una reception: l'arrivo è autonomo e vi accompagniamo noi.\n\n1) Check-in online (2 minuti, dati e documento):\n👉 {link_checkin}\n2) Guida con accesso, Wi-Fi e consigli utili:\n👉 {link_guida}\n\nQuando siete in arrivo scriveteci su WhatsApp ({whatsapp}) e vi guidiamo all'ingresso. Il check-in è {checkin}.\n— {struttura}",
      en: "Hello {ospite}, we're delighted to welcome you to {struttura}! 🌿\nThe property has no reception: arrival is self-service and we'll guide you every step of the way.\n\n1) Online check-in (2 minutes, details and ID):\n👉 {link_checkin}\n2) Guide with access, Wi-Fi and useful tips:\n👉 {link_guida}\n\nWhen you're on your way, message us on WhatsApp ({whatsapp}) and we'll guide you to the entrance. Check-in is {checkin}.\n— {struttura}",
      fr: "Bonjour {ospite}, nous sommes ravis de vous accueillir à {struttura} ! 🌿\nLe logement n'a pas de réception : l'arrivée est autonome et nous vous guidons pas à pas.\n\n1) Check-in en ligne (2 minutes, données et pièce d'identité) :\n👉 {link_checkin}\n2) Guide avec accès, Wi-Fi et conseils utiles :\n👉 {link_guida}\n\nEn route, écrivez-nous sur WhatsApp ({whatsapp}) et nous vous guidons jusqu'à l'entrée. L'arrivée est {checkin}.\n— {struttura}",
      de: "Guten Tag {ospite}, wir freuen uns, Sie in {struttura} begrüßen zu dürfen! 🌿\nDie Unterkunft hat keine Rezeption: Die Ankunft läuft selbstständig und wir führen Sie Schritt für Schritt.\n\n1) Online-Check-in (2 Minuten, Daten und Ausweis):\n👉 {link_checkin}\n2) Guide mit Zugang, WLAN und nützlichen Tipps:\n👉 {link_guida}\n\nWenn Sie unterwegs sind, schreiben Sie uns per WhatsApp ({whatsapp}) und wir lotsen Sie zum Eingang. Check-in: {checkin}.\n— {struttura}",
      es: "¡Buenos días {ospite}, estamos encantados de recibirte en {struttura}! 🌿\nEl alojamiento no tiene recepción: la llegada es autónoma y te guiamos nosotros.\n\n1) Check-in online (2 minutos, datos y documento):\n👉 {link_checkin}\n2) Guía con acceso, Wi-Fi y consejos útiles:\n👉 {link_guida}\n\nCuando vayas de camino, escríbenos por WhatsApp ({whatsapp}) y te guiamos hasta la entrada. El check-in es {checkin}.\n— {struttura}",
    }],
  "seed-checkin": [{
    it: "Ciao {ospite}, oggi è il giorno dell'arrivo! Qui trovi la guida con tutte le info utili (accesso, wi-fi, dintorni): {link_guida}. Il check-in è {checkin}. Buon viaggio!",
    en: "Hi {ospite}, today is arrival day! Here's the guide with all the useful info (access, wi-fi, area): {link_guida}. Check-in is {checkin}. Safe travels!",
    fr: "Bonjour {ospite}, c'est le jour de l'arrivée ! Voici le guide avec toutes les infos utiles (accès, wi-fi, alentours) : {link_guida}. L'arrivée est {checkin}. Bon voyage !",
    de: "Hallo {ospite}, heute ist Anreisetag! Hier der Guide mit allen Infos (Zugang, WLAN, Umgebung): {link_guida}. Check-in: {checkin}. Gute Reise!",
    es: "¡Hola {ospite}, hoy es el día de llegada! Aquí tienes la guía con toda la info útil (acceso, wi-fi, alrededores): {link_guida}. El check-in es {checkin}. ¡Buen viaje!",
  }, {
      it: "Ciao {ospite}, oggi è il giorno dell'arrivo! 🎉\nGuida con accesso, Wi-Fi e dintorni: {link_guida}\nIl check-in è {checkin}. Non c'è reception: all'arrivo, o se fate tardi, scriveteci su WhatsApp ({whatsapp}) e vi aiutiamo subito. Buon viaggio!",
      en: "Hi {ospite}, today is arrival day! 🎉\nGuide with access, Wi-Fi and the area: {link_guida}\nCheck-in is {checkin}. There's no reception: when you arrive, or if you're running late, message us on WhatsApp ({whatsapp}) and we'll help right away. Safe travels!",
      fr: "Bonjour {ospite}, c'est le jour de l'arrivée ! 🎉\nGuide avec accès, Wi-Fi et alentours : {link_guida}\nL'arrivée est {checkin}. Il n'y a pas de réception : à l'arrivée, ou en cas de retard, écrivez-nous sur WhatsApp ({whatsapp}) et nous vous aidons tout de suite. Bon voyage !",
      de: "Hallo {ospite}, heute ist Anreisetag! 🎉\nGuide mit Zugang, WLAN und Umgebung: {link_guida}\nCheck-in: {checkin}. Es gibt keine Rezeption: Schreiben Sie uns bei Ankunft oder Verspätung per WhatsApp ({whatsapp}), wir helfen sofort. Gute Reise!",
      es: "¡Hola {ospite}, hoy es el día de llegada! 🎉\nGuía con acceso, Wi-Fi y alrededores: {link_guida}\nEl check-in es {checkin}. No hay recepción: al llegar, o si te retrasas, escríbenos por WhatsApp ({whatsapp}) y te ayudamos enseguida. ¡Buen viaje!",
    }],
  "seed-review": [{
    it: "Grazie {ospite} per aver soggiornato a {struttura}! Se ti sei trovato bene, una recensione ci aiuterebbe tantissimo. A presto! 🙏",
    en: "Thank you {ospite} for staying at {struttura}! If you enjoyed it, a review would help us a lot. See you soon! 🙏",
    fr: "Merci {ospite} d'avoir séjourné à {struttura} ! Si vous avez apprécié, un avis nous aiderait beaucoup. À bientôt ! 🙏",
    de: "Danke {ospite} für Ihren Aufenthalt in {struttura}! Wenn es Ihnen gefallen hat, würde uns eine Bewertung sehr helfen. Bis bald! 🙏",
    es: "¡Gracias {ospite} por alojarte en {struttura}! Si te ha gustado, una reseña nos ayudaría mucho. ¡Hasta pronto! 🙏",
  }],
};

const norm = (s: unknown) => (typeof s === "string" ? s.replace(/\r\n/g, "\n").trim() : "");

/**
 * Modelli salvati + modelli d'esempio: aggiunge quelli d'esempio mancanti (per id) e aggiorna i modelli d'esempio MAI MODIFICATI
 * (testi identici ai vecchi) alla versione nuova. Sostituisce solo i testi: attivazione, giorni, orario e strutture restano quelli dell'host.
 */
/**
 * Modelli dei passaggi OBBLIGATORI della prenotazione che ancora non esistono (Pagamento, Tassa, Check-out): se non c'è già un modello collegato a quel passaggio
 * (srcId) se ne aggiunge uno con un testo di partenza, che il titolare può riscrivere. Segnaposto speciali per i pagamenti: {importo} e {link_pagamento}.
 */
export const MANDATORY_TEMPLATES: (MsgTemplateSeed & { srcId: string })[] = [
  {
    id: "mand-pay", srcId: "pay", name: "Pagamento", trigger: "manual", days: 0, time: "10:00", active: false,
    texts: {
      it: "Ciao {ospite}, puoi pagare il saldo del soggiorno ({importo}) online con carta, in modo sicuro: {link_pagamento}",
      en: "Hi {ospite}, you can pay the balance of your stay ({importo}) online by card, securely, here: {link_pagamento}",
      fr: "Bonjour {ospite}, vous pouvez régler le solde de votre séjour ({importo}) en ligne par carte, en toute sécurité, ici : {link_pagamento}",
      de: "Hallo {ospite}, den Restbetrag Ihres Aufenthalts ({importo}) können Sie hier sicher online per Karte bezahlen: {link_pagamento}",
      es: "Hola {ospite}, puedes pagar el saldo de tu estancia ({importo}) online con tarjeta, de forma segura, aquí: {link_pagamento}",
    },
  },
  {
    id: "mand-tax", srcId: "tax", name: "Tassa di soggiorno", trigger: "manual", days: 0, time: "10:00", active: false,
    texts: {
      it: "Ciao {ospite}, puoi pagare la tassa di soggiorno ({importo}) online con carta, in modo sicuro: {link_pagamento}",
      en: "Hi {ospite}, you can pay the city tax ({importo}) online by card, securely, here: {link_pagamento}",
      fr: "Bonjour {ospite}, vous pouvez régler la taxe de séjour ({importo}) en ligne par carte, en toute sécurité, ici : {link_pagamento}",
      de: "Hallo {ospite}, die Kurtaxe ({importo}) können Sie hier sicher online per Karte bezahlen: {link_pagamento}",
      es: "Hola {ospite}, puedes pagar la tasa turística ({importo}) online con tarjeta, de forma segura, aquí: {link_pagamento}",
    },
  },
  {
    id: "mand-checkout", srcId: "checkout", name: "Check-out e recensione", trigger: "manual", days: 0, time: "10:00", active: false,
    texts: {
      it: "Ciao {ospite}, speriamo che tu abbia passato un bel soggiorno a {struttura}! 😊\n\nTi ricordiamo che il check-out è previsto il {checkout}. Se ti serve qualcosa (ad esempio il deposito bagagli), scrivici pure qui.\n\nSe ti è piaciuto, ci aiuteresti tantissimo lasciando una breve recensione sincera: bastano 30 secondi.\n👉 {link_recensioni}\n\nGrazie di cuore e a presto! 🌊",
      en: "Hi {ospite}, we hope you had a lovely stay at {struttura}! 😊\n\nA reminder that check-out is on {checkout}. If you need anything (for example luggage storage), just reply here.\n\nIf you enjoyed your stay, a short, honest review would help us a lot: it only takes 30 seconds.\n👉 {link_recensioni}\n\nThank you so much, and see you soon! 🌊",
      fr: "Bonjour {ospite}, nous espérons que vous avez passé un excellent séjour chez {struttura} ! 😊\n\nPetit rappel : le check-out est prévu le {checkout}. Pour toute demande (par exemple la consigne à bagages), répondez simplement ici.\n\nSi vous avez apprécié votre séjour, un court avis sincère nous aiderait énormément : cela ne prend que 30 secondes.\n👉 {link_recensioni}\n\nMerci de tout cœur et à bientôt ! 🌊",
      de: "Hallo {ospite}, wir hoffen, Sie hatten einen schönen Aufenthalt bei {struttura}! 😊\n\nZur Erinnerung: Der Check-out ist am {checkout}. Bei Fragen (zum Beispiel zur Gepäckaufbewahrung) schreiben Sie uns einfach hier.\n\nWenn es Ihnen gefallen hat, würde uns eine kurze, ehrliche Bewertung sehr helfen: Es dauert nur 30 Sekunden.\n👉 {link_recensioni}\n\nHerzlichen Dank und bis bald! 🌊",
      es: "Hola {ospite}, ¡esperamos que hayas disfrutado de tu estancia en {struttura}! 😊\n\nTe recordamos que el check-out es el {checkout}. Si necesitas algo (por ejemplo, consigna de equipaje), escríbenos aquí.\n\nSi te ha gustado, una breve reseña sincera nos ayudaría muchísimo: solo tardas 30 segundos.\n👉 {link_recensioni}\n\n¡Muchas gracias y hasta pronto! 🌊",
    },
  },
];

// ---- Testi APPROVATI dei 5 modelli obbligatori (19/10/2026) -------------------------------------------------------------------------
// Il titolare li aveva riscritti con questi testi; una copia vecchia salvata da un altro dispositivo li ha poi sovrascritti con quelli di partenza.
// Qui restano scritti nel codice: un modello che ha ANCORA un testo di partenza (cioè mai personalizzato dopo) passa al testo approvato; se il titolare ha
// scritto qualcosa di suo non si tocca. Solo la lingua italiana: le altre lingue restano come sono.
const APPROVED_IT: Record<string, string> = {
  "seed-checkin-online": "Ciao {ospite}, grazie per aver scelto {struttura}! 😊\n\nPer rendere il tuo arrivo più semplice e veloce, ti chiediamo di completare il check-in online: bastano due minuti e servono i dati e un documento di identità di ogni ospite.\n\n👉 {link_checkin}\n\nCi serve perché la legge italiana ci impone di registrare gli ospiti che alloggiano da noi. Se lo fai in anticipo, all'arrivo non dovrai compilare nulla e potrai entrare subito.\n\nSe hai qualche difficoltà, rispondi pure a questo messaggio: ti aiutiamo volentieri. A presto!",
  "seed-benvenuto-guida": "Buongiorno {ospite}, siamo lieti di accogliervi a {struttura}! 🌿\n\nVi condividiamo la guida per accedere alla struttura e vivere al meglio il soggiorno: check-in, Wi-Fi, consigli utili e contatti.\n\n👉 {link_guida}\n\nSe avete bisogno di qualsiasi cosa, scriveteci pure su WhatsApp: {whatsapp}.\n\nLo staff vi augura buon soggiorno!",
  "mand-pay": "Ciao {ospite}, grazie ancora per aver scelto {struttura}! 😊\n\nPer saldare il soggiorno l'importo da pagare è {importo}. Puoi farlo in due modi:\n\n💳 con carta, dal telefono, in modo sicuro:\n👉 {link_pagamento}\n\n💶 oppure in contanti: lasciali pure sulla scrivania della camera prima della partenza.\n\nPer qualsiasi dubbio rispondi pure a questo messaggio. Grazie!",
  "mand-tax": "Ciao {ospite}, grazie ancora per aver scelto {struttura}! 😊\n\nTi ricordiamo che per il soggiorno è prevista la tassa di soggiorno: l'importo da pagare è {importo}. Puoi farlo in due modi:\n\n💳 con carta, dal telefono, in modo sicuro:\n👉 {link_pagamento}\n\n💶 oppure in contanti: lasciali pure sulla scrivania della camera prima della partenza.\n\nPer qualsiasi dubbio rispondi pure a questo messaggio. Grazie!",
  "mand-checkout": "Ciao {ospite}, speriamo che tu abbia passato un bel soggiorno a {struttura}! 😊\n\nTi ricordiamo che il check-out è previsto il {checkout}.\n\nPrima di partire, controlla di non lasciare nulla in camera. Le chiavi lasciale attaccate alla porta, come le hai trovate al tuo arrivo, e chiudi bene la porta uscendo. Se ti serve qualcosa (ad esempio il deposito bagagli), scrivici pure qui.\n\nSe ti è piaciuto il soggiorno, ci aiuteresti tantissimo lasciando una breve recensione sincera: bastano 30 secondi.\n👉 {link_recensioni}\n\nGrazie di cuore per aver scelto {struttura}: è stato un piacere ospitarti, a presto! 🌊",
};
// Testi di partenza che hanno preso il posto di quelli approvati (versione vecchia = salvata tale e quale).
const OLD_IT: Record<string, string[]> = {
  "seed-checkin-online": ["Ciao {ospite}, per velocizzare l'arrivo a {struttura} compila il check-in online (dati e documento): {link_checkin}. Bastano due minuti, grazie!"],
  "seed-benvenuto-guida": [
    "Buongiorno {{1}}, siamo lieti di accogliervi a {{2}}. Vi condividiamo la guida per accedere alla struttura e vivere al meglio il soggiorno, con check-in, Wi-Fi, consigli utili e contatti, a questo link: {{3}} Lo staff vi augura buon soggiorno!",
    "Buongiorno {ospite}, siamo lieti di accogliervi a {struttura}! 🌿\nEcco tutto il necessario per un arrivo senza pensieri.\n\n1) Check-in online (2 minuti, dati e documento):\n👉 {link_checkin}\n2) Guida con accesso, Wi-Fi e consigli utili:\n👉 {link_guida}\n\nPer qualsiasi cosa siamo a disposizione su WhatsApp ({whatsapp}): quando siete in arrivo scriveteci e vi aiutiamo con l'ingresso. Il check-in è {checkin}.\n— {struttura}",
  ],
  "mand-pay": ["Ciao {ospite}, puoi pagare il saldo del soggiorno ({importo}) online con carta, in modo sicuro: {link_pagamento}"],
  "mand-tax": ["Ciao {ospite}, puoi pagare la tassa di soggiorno ({importo}) online con carta, in modo sicuro: {link_pagamento}"],
  "mand-checkout": ["Ciao {ospite}, speriamo che tu abbia passato un bel soggiorno a {struttura}! 😊\n\nTi ricordiamo che il check-out è previsto il {checkout}. Se ti serve qualcosa (ad esempio il deposito bagagli), scrivici pure qui.\n\nSe ti è piaciuto, ci aiuteresti tantissimo lasciando una breve recensione sincera: bastano 30 secondi.\n👉 {link_recensioni}\n\nGrazie di cuore e a presto! 🌊"],
};

/** Rimette i testi approvati nei 5 modelli obbligatori (anche nelle copie per struttura «<id>@<struttura>») che hanno ancora un testo di partenza. */
export function restoreApprovedTexts<T extends { id: string; texts?: Record<string, string> }>(saved: T[]): T[] {
  return saved.map((tp) => {
    const base = tp.id.split("@")[0];
    const approved = APPROVED_IT[base]; const olds = OLD_IT[base];
    if (!approved || !olds || !tp.texts) return tp;
    const cur = norm(tp.texts.it);
    if (cur === norm(approved) || !olds.some((o) => norm(o) === cur)) return tp; // già approvato, oppure personalizzato dal titolare: non si tocca
    return { ...tp, texts: { ...tp.texts, it: approved } } as T;
  });
}

/** Aggiunge i modelli dei passaggi obbligatori mancanti (uno per passaggio). */
export function ensureMandatoryTemplates<T extends { srcId?: string }>(saved: T[]): T[] {
  const have = new Set(saved.map((x) => x.srcId).filter(Boolean));
  return restoreApprovedTexts([...saved, ...(MANDATORY_TEMPLATES.filter((m) => !have.has(m.srcId)) as unknown as T[])] as unknown as (T & { id: string })[]) as unknown as T[];
}

/**
 * OGNI STRUTTURA È A SÉ: un modello appartiene a UNA sola struttura (structureIds = [id]). I modelli «per tutte le strutture» (senza structureIds) o per più strutture
 * vengono divisi in una copia per struttura, ciascuna indipendente: cambiare un testo in una struttura non tocca le altre. Le copie tengono lo stesso nome e collegamento (srcId).
 * La prima struttura mantiene l'id originale, le altre ricevono "<id>@<struttura>". Non fa nulla se i modelli sono già tutti di una sola struttura.
 */
export function splitTemplatesPerStructure<T extends { id: string; structureIds?: string[] }>(saved: T[], structureIds: string[]): T[] {
  const out: T[] = [];
  for (const tp of saved) {
    if ((tp.structureIds?.length ?? 0) === 1) { out.push(tp); continue; } // già di una sola struttura (anche se non è tra quelle visibili ora): mai toccato né scartato
    const targets = tp.structureIds?.length ? tp.structureIds : structureIds; // senza struttura = tutte quelle passate
    targets.forEach((sid, i) => out.push({ ...tp, id: i === 0 ? tp.id : `${tp.id}@${sid.slice(0, 8)}`, structureIds: [sid] }));
  }
  return out;
}

/** Per OGNI struttura, i modelli dei passaggi obbligatori mancanti (Pagamento, Tassa, Check-out e recensione). */
export function ensureMandatoryPerStructure<T extends { srcId?: string; structureIds?: string[] }>(saved: T[], structureIds: string[]): T[] {
  const out = [...saved];
  for (const sid of structureIds) {
    const have = new Set(saved.filter((x) => x.structureIds?.length === 1 && x.structureIds[0] === sid).map((x) => x.srcId).filter(Boolean));
    for (const m of MANDATORY_TEMPLATES) if (!have.has(m.srcId)) out.push({ ...m, id: `${m.id}@${sid.slice(0, 8)}`, structureIds: [sid] } as unknown as T);
  }
  return restoreApprovedTexts(out as unknown as (T & { id: string })[]) as unknown as T[]; // anche i modelli già esistenti tornano ai testi approvati se hanno ancora quelli di partenza
}

/**
 * Modelli d'esempio ELIMINATI dal titolare (richiesta del 19/10/2026) in ogni struttura: Benvenuto pre-arrivo, Istruzioni check-in, Richiesta recensione (con le loro copie «<id>@<struttura>»).
 * Se un dispositivo con la lista vecchia li rimette, al caricamento si tolgono di nuovo (la cancellazione resta locale e si sincronizza).
 */
const REMOVED_TEMPLATE_BASES = ["seed-welcome", "seed-checkin", "seed-review"];
export function dropRemovedTemplates<T extends { id: string }>(saved: T[]): T[] {
  return saved.filter((tp) => !REMOVED_TEMPLATE_BASES.includes(tp.id.split("@")[0]));
}

/** Se false i modelli d'esempio NON si aggiungono più da soli: i modelli li crea il titolare (ottobre 2026). */
export const SEED_TEMPLATES_ENABLED = false;
export function mergeSeedTemplates<T extends { id: string; texts?: Record<string, string> }>(saved: T[], deletedSeedIds: string[] = loadDeletedSeedIds(), enabled: boolean = SEED_TEMPLATES_ENABLED): T[] {
  if (!enabled) return saved;
  const have = new Set(saved.map((x) => x.id));
  for (const id of deletedSeedIds) have.add(id); // un modello d'esempio eliminato dall'host non torna più (tombstone)
  const upgraded = saved.map((tp) => {
    const gens = LEGACY_SEED_TEXTS[tp.id]; const seed = DEFAULT_TEMPLATES.find((d) => d.id === tp.id);
    if (!gens || !seed || !tp.texts) return tp;
    const untouched = gens.some((old) => (Object.keys(old) as (keyof typeof seed.texts)[]).every((l) => norm(tp.texts?.[l]) === norm(old[l])));
    return untouched ? ({ ...tp, texts: { ...seed.texts } } as T) : tp;
  });
  return [...upgraded, ...(DEFAULT_TEMPLATES.filter((d) => !have.has(d.id)) as unknown as T[])];
}
