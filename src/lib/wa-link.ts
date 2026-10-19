// Indirizzo per aprire WhatsApp con un messaggio già scritto per un numero.
// Sui computer si apre WhatsApp WEB: l'app WhatsApp per Windows, aperta dal link wa.me, mostra le emoji come «�» (il testo passa dal sistema con la codifica sbagliata);
// WhatsApp Web le mostra giuste. Sul telefono resta il link wa.me, che apre l'app. Solo browser.
export function isMobileBrowser(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

export function waSendUrl(digits: string, text: string, ua?: string): string {
  const enc = encodeURIComponent(text);
  return isMobileBrowser(ua)
    ? `https://wa.me/${digits}?text=${enc}`
    : `https://web.whatsapp.com/send?phone=${digits}&text=${enc}`;
}
