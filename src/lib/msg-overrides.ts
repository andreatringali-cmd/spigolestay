// Messaggi "dei pulsanti" all'ospite (invito al check-in, link di pagamento, promemoria di partenza, conto, recensione…): testi MODIFICABILI.
// I testi di partenza stanno qui, uno per lingua, con i segnaposto tra graffe ({link}, {nome}…). Se il gestore ne cambia uno (Messaggi → Modelli),
// il testo modificato sta in localStorage ("spigolestay:msgoverrides", chiave sincronizzata come gli altri modelli) e vince sul predefinito.
// Modulo puro (senza React): usato dai costruttori dei messaggi (guest-messages, chat-pay-core, reviews, booking-bill) e dalla schermata dei modelli.

export type MsgLang = "it" | "en" | "fr" | "de" | "es";
export const MSG_LANGS: MsgLang[] = ["it", "en", "fr", "de", "es"];
export const MSG_LANG_LABEL: Record<MsgLang, string> = { it: "Italiano", en: "English", fr: "Français", de: "Deutsch", es: "Español" };

export const MSG_OVERRIDES_KEY = "spigolestay:msgoverrides";
export const MSG_OVERRIDES_EVENT = "spigolestay:msgoverrides";
export type OverrideMap = Record<string, Partial<Record<MsgLang, string>>>;

export function loadOverrides(): OverrideMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const p = JSON.parse(localStorage.getItem(MSG_OVERRIDES_KEY) || "{}");
    return p && typeof p === "object" && !Array.isArray(p) ? (p as OverrideMap) : {};
  } catch { return {}; }
}

/** Salva (o, con testo vuoto/null, toglie) il testo modificato di un messaggio in una lingua. */
export function saveOverride(id: string, lang: MsgLang, text: string | null): void {
  try {
    const all = loadOverrides();
    const cur = { ...(all[id] ?? {}) };
    if (text === null || !text.trim()) delete cur[lang]; else cur[lang] = text;
    if (Object.keys(cur).length) all[id] = cur; else delete all[id];
    localStorage.setItem(MSG_OVERRIDES_KEY, JSON.stringify(all));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(MSG_OVERRIDES_EVENT));
  } catch { /* storage non disponibile: il testo resta quello predefinito */ }
}

export function overrideFor(id: string, lang: MsgLang): string | undefined {
  const t = loadOverrides()[id]?.[lang];
  return typeof t === "string" && t.trim() ? t : undefined;
}

type Vars = Record<string, string | number | undefined | null>;

/**
 * Sostituisce i segnaposto {nome}. Un segnaposto senza valore sparisce insieme allo spazio che lo precede ("Ciao {nome}," → "Ciao,"); una riga fatta
 * solo di segnaposto vuoti viene tolta (e, se la riga prima finisce con ":" e introduceva proprio quel valore, anche quella). Segnaposto sconosciuti: tolti.
 */
export function fillTemplate(tpl: string, vars: Vars): string {
  const val = (k: string): string => { const v = vars[k]; return v === undefined || v === null ? "" : String(v); };
  const lines = tpl.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const onlyVars = keys.length > 0 && line.replace(/\{\w+\}/g, "").replace(/[—\-–\s]/g, "") === "";
    if (onlyVars && keys.every((k) => val(k) === "")) {
      if (out.length && /:\s*$/.test(out[out.length - 1])) out.pop(); // "Bastano 30 secondi da qui:" senza il link che introduce
      continue;
    }
    out.push(line.replace(/(\s?)\{(\w+)\}/g, (_m, sp: string, k: string) => (val(k) === "" ? "" : sp + val(k))));
  }
  return out.join("\n");
}

export interface SystemMessageDef {
  id: string;
  name: string;           // come si chiama nell'elenco
  when: string;           // quando lo manda Xenora
  vars: { key: string; hint: string }[];
  texts: Record<MsgLang, string>;   // testi predefiniti, con i segnaposto
}

export const SYSTEM_MESSAGES: SystemMessageDef[] = [
  {
    id: "checkin", name: "Invito al check-in online", when: "Pulsante «Check-in» (scheda prenotazione, Messaggi)",
    vars: [{ key: "link", hint: "link del check-in online" }],
    texts: {
      it: "Per velocizzare il suo arrivo la invitiamo a completare il check-in online (dati e documento, bastano due minuti): {link}",
      en: "To speed up your arrival, please complete the online check-in (details and ID) here: {link}",
      fr: "Pour accélérer votre arrivée, remplissez le check-in en ligne (données et pièce d'identité) ici : {link}",
      de: "Um Ihre Ankunft zu beschleunigen, füllen Sie bitte den Online-Check-in (Daten und Ausweis) hier aus: {link}",
      es: "Para agilizar tu llegada, completa el check-in online (datos y documento) aquí: {link}",
    },
  },
  {
    id: "checkinRequest", name: "Richiesta di check-in con firma", when: "Adempimenti → arrivi senza check-in",
    vars: [{ key: "nome", hint: "nome dell'ospite" }, { key: "struttura", hint: "nome della struttura" }, { key: "firma", hint: "nome della struttura per la firma (vuoto se manca)" }, { key: "link", hint: "link del check-in online" }],
    texts: {
      it: "Gentile {nome}, le scriviamo da {struttura}. Per velocizzare il suo arrivo la invitiamo a completare il check-in online (dati e documento, bastano 2 minuti): {link} . Grazie e a presto!\n— {firma}",
      en: "Dear {nome}, this is {struttura}. To speed up your arrival, please complete the online check-in (details and ID, it only takes 2 minutes): {link} . Thank you and see you soon!\n— {firma}",
      fr: "Bonjour {nome}, ici {struttura}. Pour accélérer votre arrivée, merci de remplir le check-in en ligne (données et pièce d'identité, 2 minutes suffisent) : {link} . Merci et à bientôt !\n— {firma}",
      de: "Guten Tag {nome}, hier ist {struttura}. Um Ihre Ankunft zu beschleunigen, füllen Sie bitte den Online-Check-in aus (Daten und Ausweis, es dauert nur 2 Minuten): {link} . Vielen Dank und bis bald!\n— {firma}",
      es: "Estimado/a {nome}, le escribimos desde {struttura}. Para agilizar su llegada, le invitamos a completar el check-in online (datos y documento, bastan 2 minutos): {link} . ¡Gracias y hasta pronto!\n— {firma}",
    },
  },
  {
    id: "checkinMore", name: "Check-in quasi completo", when: "Check-in online con ospiti mancanti",
    vars: [{ key: "n", hint: "quanti ospiti mancano" }, { key: "altri", hint: "«altro ospite» / «altri ospiti» (singolare o plurale)" }, { key: "link", hint: "link del check-in online" }],
    texts: {
      it: "Il check-in è quasi completo: ci mancano i dati di {n} {altri}. Apri il link e compila di nuovo il modulo con i dati di tutti gli ospiti: {link}",
      en: "Your check-in is almost done: we still need the details of {n} more {altri}. Open the link and fill in the form again with the details of all guests: {link}",
      fr: "Votre check-in est presque terminé : il nous manque les données de {n} {altri}. Ouvrez le lien et remplissez de nouveau le formulaire avec les données de tous les voyageurs : {link}",
      de: "Ihr Check-in ist fast fertig: Es fehlen noch die Daten von {n} weiteren {altri}. Öffnen Sie den Link und füllen Sie das Formular erneut mit den Daten aller Gäste aus: {link}",
      es: "Su check-in está casi completo: faltan los datos de {n} {altri}. Abra el enlace y rellene de nuevo el formulario con los datos de todos los huéspedes: {link}",
    },
  },
  {
    id: "reminderIntro", name: "Apertura dei solleciti", when: "Davanti a un messaggio già inviato in precedenza (promemoria)",
    vars: [],
    texts: {
      it: "Un promemoria dalla struttura. ",
      en: "A quick reminder from us. ",
      fr: "Un petit rappel de notre part. ",
      de: "Eine kurze Erinnerung von uns. ",
      es: "Un breve recordatorio de nuestra parte. ",
    },
  },
  {
    id: "guide", name: "Guida ospiti (pulsante)", when: "Pulsante «Guida» (scheda prenotazione, Messaggi). L'invito completo si cambia in Guida ospiti.",
    vars: [{ key: "link", hint: "link della guida" }],
    texts: {
      it: "Qui trovi la guida con tutte le info utili (check-in, wi-fi, dintorni): {link}",
      en: "Here is our guest guide with all the useful info: {link}",
      fr: "Voici le guide avec toutes les infos utiles : {link}",
      de: "Hier ist der Gäste-Guide mit allen Infos: {link}",
      es: "Aquí tienes la guía con toda la información útil: {link}",
    },
  },
  {
    id: "checkout", name: "Promemoria di partenza", when: "Pulsante «Partenza» (scheda prenotazione)",
    vars: [{ key: "data", hint: "data del check-out" }, { key: "orario", hint: "orario di check-out, già con la parola («entro le 11:00»); vuoto se non impostato" }, { key: "struttura", hint: "nome della struttura" }],
    texts: {
      it: "Il check-out è previsto il {data}{orario}. Per qualsiasi esigenza (ad esempio il deposito bagagli) ci scriva pure qui. Grazie per aver scelto {struttura}: è stato un piacere ospitarla!",
      en: "Check-out is on {data}{orario}. If you need anything (for example luggage storage), just reply here. Thank you for choosing {struttura}, it was a pleasure to host you!",
      fr: "Le check-out est prévu le {data}{orario}. Pour toute demande (par exemple la consigne à bagages), répondez simplement ici. Merci d'avoir choisi {struttura}, ce fut un plaisir de vous accueillir !",
      de: "Der Check-out ist am {data}{orario}. Bei Fragen (zum Beispiel zur Gepäckaufbewahrung) schreiben Sie uns einfach hier. Vielen Dank, dass Sie sich für {struttura} entschieden haben, es war uns eine Freude!",
      es: "El check-out es el {data}{orario}. Para cualquier necesidad (por ejemplo, consigna de equipaje), escríbanos aquí. Gracias por elegir {struttura}, ¡ha sido un placer recibirle!",
    },
  },
  {
    id: "paySaldo", name: "Link di pagamento del saldo", when: "Pulsanti «Link di pagamento» (saldo), conto, Messaggi",
    vars: [{ key: "importo", hint: "importo da pagare (es. € 120,00)" }, { key: "link", hint: "link di pagamento" }],
    texts: {
      it: "Può pagare il saldo del soggiorno ({importo}) online con carta, in modo sicuro: {link}",
      en: "You can pay the balance of your stay ({importo}) online by card, securely, here: {link}",
      fr: "Vous pouvez régler le solde de votre séjour ({importo}) en ligne par carte, en toute sécurité, ici : {link}",
      de: "Den Restbetrag Ihres Aufenthalts ({importo}) können Sie hier sicher online per Karte bezahlen: {link}",
      es: "Puedes pagar el saldo de tu estancia ({importo}) online con tarjeta, de forma segura, aquí: {link}",
    },
  },
  {
    id: "payTassa", name: "Link di pagamento della tassa di soggiorno", when: "Pulsante «Link» accanto alla tassa di soggiorno",
    vars: [{ key: "importo", hint: "importo della tassa (es. € 12,00)" }, { key: "link", hint: "link di pagamento" }],
    texts: {
      it: "Può pagare la tassa di soggiorno ({importo}) online con carta, in modo sicuro: {link}",
      en: "You can pay the city tax ({importo}) online by card, securely, here: {link}",
      fr: "Vous pouvez régler la taxe de séjour ({importo}) en ligne par carte, en toute sécurité, ici : {link}",
      de: "Die Kurtaxe ({importo}) können Sie hier sicher online per Karte bezahlen: {link}",
      es: "Puedes pagar la tasa turística ({importo}) online con tarjeta, de forma segura, aquí: {link}",
    },
  },
  {
    id: "bill", name: "Conto del soggiorno", when: "Gestione → Impostazioni dei pagamenti → Prepara conto",
    vars: [{ key: "nome", hint: "nome dell'ospite" }, { key: "struttura", hint: "nome della struttura" }, { key: "riepilogo", hint: "elenco delle voci, già pagato e da pagare (si compone da solo)" }],
    texts: {
      it: "Buongiorno {nome},\necco il conto del suo soggiorno presso {struttura}:\n\n{riepilogo}\n\nGrazie!",
      en: "Hello {nome},\nhere is the bill for your stay at {struttura}:\n\n{riepilogo}\n\nThank you!",
      fr: "Bonjour {nome},\nvoici l'addition de votre séjour chez {struttura} :\n\n{riepilogo}\n\nMerci !",
      de: "Guten Tag {nome},\nhier die Rechnung für Ihren Aufenthalt bei {struttura}:\n\n{riepilogo}\n\nVielen Dank!",
      es: "Hola {nome},\naquí tiene la cuenta de su estancia en {struttura}:\n\n{riepilogo}\n\n¡Gracias!",
    },
  },
  {
    id: "review", name: "Richiesta di recensione (pulsante)", when: "Pulsante «Recensione» (scheda prenotazione, Recensioni). Il messaggio automatico è un modello a parte.",
    vars: [{ key: "nome", hint: "nome dell'ospite" }, { key: "struttura", hint: "nome della struttura" }, { key: "link_recensioni", hint: "link alle recensioni configurati (Google, Tripadvisor)" }],
    texts: {
      it: "Ciao {nome},\ngrazie di aver scelto {struttura}! Speriamo che il tuo soggiorno sia stato speciale.\nSe ti va, ci aiuteresti tantissimo lasciando una breve recensione sincera.\n\nBastano 30 secondi da qui:\n{link_recensioni}\n\nGrazie di cuore e a presto! 🌊",
      en: "Hi {nome},\nthank you for choosing {struttura}! We hope your stay was special.\nIf you like, a short, honest review would help us a lot.\n\nIt only takes 30 seconds:\n{link_recensioni}\n\nThank you so much, and see you soon! 🌊",
      fr: "Bonjour {nome},\nmerci d'avoir choisi {struttura} ! Nous espérons que votre séjour a été exceptionnel.\nSi vous le souhaitez, un court avis sincère nous aiderait énormément.\n\nCela ne prend que 30 secondes :\n{link_recensioni}\n\nMerci de tout cœur et à bientôt ! 🌊",
      de: "Hallo {nome},\nvielen Dank, dass Sie sich für {struttura} entschieden haben! Wir hoffen, Ihr Aufenthalt war etwas Besonderes.\nWenn Sie möchten, würde uns eine kurze, ehrliche Bewertung sehr helfen.\n\nEs dauert nur 30 Sekunden:\n{link_recensioni}\n\nHerzlichen Dank und bis bald! 🌊",
      es: "Hola {nome},\n¡gracias por elegir {struttura}! Esperamos que tu estancia haya sido especial.\nSi te apetece, una breve reseña sincera nos ayudaría muchísimo.\n\nSolo tardas 30 segundos:\n{link_recensioni}\n\n¡Muchas gracias y hasta pronto! 🌊",
    },
  },
];

SYSTEM_MESSAGES.push(
  {
    id: "contact", name: "Saluto di contatto (icona WhatsApp)", when: "Icona WhatsApp della scheda prenotazione",
    vars: [{ key: "nome", hint: "nome e cognome dell'ospite" }, { key: "struttura", hint: "nome della struttura" }, { key: "checkin", hint: "data di arrivo" }],
    texts: {
      it: "Buongiorno {nome}, le scriviamo da {struttura} riguardo al soggiorno del {checkin}.",
      en: "Hello {nome}, this is {struttura} regarding your stay on {checkin}.",
      fr: "Bonjour {nome}, nous vous écrivons de la part de {struttura} au sujet de votre séjour du {checkin}.",
      de: "Guten Tag {nome}, wir schreiben Ihnen von {struttura} bezüglich Ihres Aufenthalts am {checkin}.",
      es: "Buenos días {nome}, le escribimos desde {struttura} respecto a su estancia del {checkin}.",
    },
  },
  {
    id: "checkinShort", name: "Invito al check-in (scheda prenotazione)", when: "Scheda prenotazione, ospite in arrivo: invio del link di check-in",
    vars: [{ key: "nome", hint: "nome dell'ospite" }, { key: "struttura", hint: "nome della struttura" }, { key: "link", hint: "link del check-in online" }],
    texts: {
      it: "Buongiorno {nome}, per velocizzare l'arrivo a {struttura} completa il check-in online qui: {link}",
      en: "Hello {nome}, to speed up your arrival at {struttura}, please complete the online check-in here: {link}",
      fr: "Bonjour {nome}, pour accélérer votre arrivée chez {struttura}, remplissez le check-in en ligne ici : {link}",
      de: "Guten Tag {nome}, um Ihre Ankunft bei {struttura} zu beschleunigen, füllen Sie bitte hier den Online-Check-in aus: {link}",
      es: "Buenos días {nome}, para agilizar su llegada a {struttura}, complete el check-in online aquí: {link}",
    },
  },
  {
    id: "reviewQuick", name: "Richiesta di recensione rapida (scheda prenotazione)", when: "Scheda prenotazione, ospite in partenza: pulsanti WhatsApp ed email",
    vars: [{ key: "nome", hint: "nome dell'ospite" }, { key: "struttura", hint: "nome della struttura" }, { key: "link", hint: "link alla recensione Google" }],
    texts: {
      it: "Grazie {nome} per aver soggiornato da {struttura}! Se ti sei trovato bene, ci lasceresti una recensione su Google? Ci aiuta tantissimo. {link}",
      en: "Thank you {nome} for staying at {struttura}! If you enjoyed your stay, would you leave us a review on Google? It helps us a lot. {link}",
      fr: "Merci {nome} d'avoir séjourné chez {struttura} ! Si vous avez passé un bon séjour, pourriez-vous nous laisser un avis sur Google ? Cela nous aide énormément. {link}",
      de: "Vielen Dank {nome}, dass Sie bei {struttura} übernachtet haben! Wenn es Ihnen gefallen hat, hinterlassen Sie uns bitte eine Google-Bewertung. Das hilft uns sehr. {link}",
      es: "¡Gracias {nome} por alojarse en {struttura}! Si le gustó, ¿nos dejaría una reseña en Google? Nos ayuda muchísimo. {link}",
    },
  },
);

export const systemMessage = (id: string): SystemMessageDef | undefined => SYSTEM_MESSAGES.find((m) => m.id === id);

/** Testo del messaggio nella lingua: quello modificato dal gestore, altrimenti il predefinito (con i segnaposto, per la schermata dei modelli). */
export function templateText(id: string, lang: MsgLang): string {
  return overrideFor(id, lang) ?? systemMessage(id)?.texts[lang] ?? "";
}

/** Messaggio pronto: testo (modificato o predefinito) con i segnaposto riempiti. */
export function renderSystemMessage(id: string, lang: MsgLang, vars: Vars): string {
  return fillTemplate(templateText(id, lang), vars);
}
