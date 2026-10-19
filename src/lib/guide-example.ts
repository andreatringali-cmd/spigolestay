// «Parti dall'esempio» della Guida ospiti: i testi si ricavano DIRETTAMENTE dall'esempio che vedi nel telefono «Esempio»
// (public/guida/js/content/it.js), così la tua guida parte identica: stessi titoli, testi, ordine delle sezioni, passaggi e blocchi.
// Prima c'era una copia scritta a mano che col tempo si discostava dall'esempio (titoli, frasi, ordine).

type Json = Record<string, unknown>;
type Action = { label: string; href: string; type?: string; icon?: string };

export interface ExampleContent { home: { welcomeTitle: string; welcomeSub?: string; welcome: string[] }; sections: Json[] }

const arr = <T = Json>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const CODE_OF: Record<string, string> = { gateCode: "gate", doorCode: "door", doorCode2: "door2" }; // chiave del motore → scelta dell'editor
const FUNC_IDS = new Set(["wifi", "contacts", "review"]); // operative: testi e dati arrivano dalla struttura

/** Pulsanti dell'esempio come li vede un ospite senza dati nel link: quelli che dipendono da un dato (onlyIf) non compaiono. */
const actionsOf = (list: unknown): Action[] | undefined => {
  const out = arr(list).filter((a) => !a.onlyIf).map((a) => {
    const o: Action = { label: str(a.label), href: str(a.href) };
    if (a.type) o.type = str(a.type);
    if (a.icon) o.icon = str(a.icon);
    return o;
  });
  return out.length ? out : undefined;
};

/**
 * `it` = window.I18N.it del pacchetto guida. `old` = contenuto già pronto (foto d'esempio per sezione, ripiego se qualcosa manca).
 * Dall'esempio si prende ciò che l'ospite vede nei casi principali: i passaggi legati al parcheggio restano entrambi (con/senza), nessun testo «personale».
 */
export function exampleContentFrom(it: Json, old: ExampleContent): ExampleContent {
  const home = (it.home ?? {}) as Json;
  const byId = new Map(arr(it.sections).map((s) => [str(s.id), s]));
  const order = arr<Json>(it.groups).flatMap((g) => arr<string>(g.sections));
  const ids = [...order.filter((id) => byId.has(id)), ...[...byId.keys()].filter((id) => !order.includes(id))];
  const sections = ids.map((id) => {
    const s = byId.get(id) as Json;
    const o = old.sections.find((x) => x.id === id) as Json | undefined;
    const base: Json = { id, icon: str(s.icon), title: str(s.title), sub: str(s.sub), intro: str(s.intro), photos: arr<string>(o?.photos) };
    if (FUNC_IDS.has(id)) return { ...base, items: [] };
    const steps = arr(s.steps).map((st) => {
      const o2: Json = { h: str(st.h), p: str(st.p), code: CODE_OF[str(st.codeKey)] ?? "" };
      if (st.parkOnly) o2.parkOnly = true;          // «Parcheggio» per chi lo ha prenotato…
      if (st.noParkOnly) o2.noParkOnly = true;      // …e per chi NON lo ha prenotato: due passaggi, ognuno col suo testo
      if (st.codeSuffix) o2.codeNote = str(st.codeSuffix);
      const a = actionsOf(st.actions); if (a) o2.actions = a;
      return o2;
    });
    const amenities = arr(s.amenities).filter((a) => !a.onlyRooms).map((a) => ({ icon: str(a.icon), label: str(a.label) }));
    const items = arr(s.items).map((i) => {
      const o2: Json = { h: str(i.h), p: str(i.p) };
      const l = arr(i.list); if (l.length) o2.list = l;
      const a = actionsOf(i.actions); if (a) o2.actions = a;
      return o2;
    });
    return {
      ...base, items,
      ...(steps.length ? { steps } : {}),
      ...(amenities.length ? { amenities, amenitiesTitle: str(s.amenitiesTitle), amenitiesIntro: str(s.amenitiesIntro) } : {}),
    };
  });
  return {
    home: { welcomeTitle: str(home.welcomeTitle), welcomeSub: str(home.welcomeSub), welcome: arr<string>(home.welcome).map(str) },
    sections,
  };
}

/** Carica il contenuto italiano dell'esempio (lo stesso del telefono «Esempio»). Solo browser. */
export async function loadExampleIt(): Promise<Json> {
  const w = window as unknown as { I18N?: { it?: Json } };
  if (w.I18N?.it) return w.I18N.it;
  await new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "/guida/js/content/it.js";
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("esempio non raggiungibile"));
    document.head.appendChild(el);
  });
  if (!w.I18N?.it) throw new Error("esempio vuoto");
  return w.I18N.it;
}
