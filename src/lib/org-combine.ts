// Ricombinazione dei dati personali e delle strutture condivise (org) nel blob locale. Modulo puro (testabile).
type DataObj = Record<string, unknown>;
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

// Ricombina personale + dati org in un unico blob per il locale (dedup per id; le copie org, che portano orgId, vincono sulle strutture).
export function combineData(personal: DataObj, orgDatas: DataObj[]): DataObj {
  const out: DataObj = { ...personal };
  // `newest`: la STESSA prenotazione/ospite può trovarsi in due org (spostata da una struttura all'altra: la copia vecchia resta un attimo nell'org di partenza). Vince la copia modificata per ULTIMA
  // (updatedAt), non quella dell'org letta per ultima: prima la copia vecchia poteva battere quella nuova e "annullare" lo spostamento (e liberare la camera sbagliata).
  const mergeColl = (key: string, newest = false) => {
    const map = new Map<string, unknown>();
    const ts = (it: unknown) => { const v = it && typeof it === "object" ? (it as { updatedAt?: unknown }).updatedAt : undefined; return typeof v === "number" && Number.isFinite(v) ? v : 0; };
    const add = (a: unknown[]) => { for (const it of a) { const id = (it && typeof it === "object") ? (it as { id?: unknown }).id : undefined; const k = id != null && id !== "" ? String(id) : JSON.stringify(it); if (newest && map.has(k) && ts(map.get(k)) > ts(it)) continue; map.set(k, it); } };
    add(arr(personal[key]));            // prima il personale…
    for (const od of orgDatas) add(arr(od[key])); // …poi le copie org sovrascrivono gli id in comune
    out[key] = [...map.values()];
  };
  mergeColl("structures"); mergeColl("roomTypes"); mergeColl("units"); mergeColl("bookings", true); mergeColl("guests", true);
  const ro: Record<string, number> = { ...((personal.rateOverrides as Record<string, number>) || {}) };
  for (const od of orgDatas) Object.assign(ro, (od.rateOverrides as Record<string, number>) || {});
  out.rateOverrides = ro;
  return out;
}

