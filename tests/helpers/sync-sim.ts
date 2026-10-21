// Simulatore della sincronizzazione di PIU' dispositivi contro un «server» in memoria, con la logica VERA di fusione (sync-core, sync-delta, org-split, org-cassa-config,
// org-combine, sync-window). Riproduce l'orchestrazione di syncOnce (authsync.tsx): stato personale + una org, fusione a 3 vie, scrittura solo se il contenuto e' diverso,
// modalita' normale (blocco intero) o veloce (finestra in lettura + delta in scrittura). Non c'e' rete, ne' concorrenza: i dispositivi girano uno dopo l'altro.
// Le librerie sono passate dal chiamante (L) cosi' lo stesso simulatore puo' girare anche su una copia vecchia del codice per provare che il difetto c'era.

export const KEY = "spigolestay:data:v1";
export const CONTI = "spigolestay:cassa:conti";
export type Row = Record<string, string>;
type Json = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Libs = { Core: any; W: any; D: any; Split: any; OrgCfg: any; Combine: any; Canon?: any };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export class Srv {
  rows: Map<string, { data: Row; rev: number }> = new Map();
  writes: Map<string, number> = new Map();
  deltas: { id: string; delta: Json }[] = [];
  today: string;
  L: Libs;
  constructor(L: Libs, today: string) { this.L = L; this.today = today; }
  put(id: string, data: Row) { this.rows.set(id, { data: clone(data), rev: 1 }); }
  read(id: string, scope: string[] | null | undefined): { data: Row | null; rev: number | null } {
    const r = this.rows.get(id);
    if (!r) return { data: null, rev: null };
    const full = clone(r.data);
    return { data: scope === undefined ? full : this.L.W.windowRowData(full, this.today, 400, scope).data, rev: r.rev };
  }
  private bump(id: string) { this.writes.set(id, (this.writes.get(id) ?? 0) + 1); }
  writeFull(id: string, merged: Row, expected: number | null): number | null {
    const r = this.rows.get(id);
    if (expected === null) { if (r) return null; this.rows.set(id, { data: clone(merged), rev: 1 }); this.bump(id); return 1; }
    if (!r || r.rev !== expected) return null;
    r.data = clone(merged); r.rev++; this.bump(id); return r.rev;
  }
  postDelta(id: string, delta: Json, expected: number): number | null {
    const r = this.rows.get(id);
    if (!r || r.rev !== expected) return null;
    this.deltas.push({ id, delta: clone(delta) });
    let res: { row: Row; stats: { changed: boolean } };
    try { res = this.L.D.applyDelta(r.data, delta); } catch { return null; }
    if (res.stats.changed) { r.data = clone(res.row); r.rev++; this.bump(id); }
    return r.rev;
  }
  data(id: string): Json { return JSON.parse(this.rows.get(id)?.data[KEY] ?? "{}") as Json; }
  flat(id: string, key: string): string | undefined { return this.rows.get(id)?.data[key]; }
  totalWrites(id: string): number { return this.writes.get(id) ?? 0; }
}

type Ref = { rev: number; last: Row };

export class Dev {
  name: string; uid: string; orgId: string; delta: boolean; scope: string[] | null;
  local: Row; personal: Ref = { rev: -1, last: {} }; org: Ref = { rev: -1, last: {} };
  baseHashes: Record<string, string> | null = null;
  L: Libs;
  constructor(L: Libs, o: { name: string; uid: string; orgId: string; delta: boolean; scope?: string[] | null; local: Row }) {
    this.L = L; this.name = o.name; this.uid = o.uid; this.orgId = o.orgId; this.delta = o.delta; this.scope = o.scope ?? null; this.local = o.local;
  }
  data(): Json { return JSON.parse(this.local[KEY] ?? "{}") as Json; }

  private saveOne(srv: Srv, rowId: string, snap: Row, ref: Ref, baseHashes?: Record<string, string> | null): { merged: Row; wrote: boolean } {
    const { Core, D } = this.L;
    const { data: sd, rev } = srv.read(rowId, this.delta ? this.scope : undefined);
    const merged: Row = Core.mergeSnapshots(snap, sd, ref.last, baseHashes);
    if (this.delta) {
      const delta = D.buildDelta(sd, ref.last, merged, this.scope);
      if (!D.isEmptyDelta(delta) && rev !== null) {
        const nr = srv.postDelta(rowId, delta, rev);
        if (nr === null) return { merged, wrote: false };
        ref.rev = nr; ref.last = merged; return { merged, wrote: true };
      }
      if (rev !== null) ref.rev = rev;
      ref.last = merged; return { merged, wrote: false };
    }
    if (Core.contentSig(merged) !== Core.contentSig(sd ?? {})) {
      const nr = srv.writeFull(rowId, merged, rev);
      if (nr === null) return { merged, wrote: false };
      ref.rev = nr; ref.last = merged; return { merged, wrote: true };
    }
    if (rev !== null) ref.rev = rev;
    ref.last = merged; return { merged, wrote: false };
  }

  /** Un ciclo di sincronizzazione (come syncOnce + restore). Ritorna quali righe del server sono state scritte. */
  cycle(srv: Srv): { personalWrote: boolean; orgWrote: boolean } {
    const { Core, Split, OrgCfg, Combine, Canon } = this.L;
    const snap: Row = { ...this.local };
    const fullData = JSON.parse(snap[KEY]) as Json;
    const { personal, orgs } = Split.splitByOrg(fullData);
    const orgSids: Set<string> = OrgCfg.orgStructureSets(fullData).get(this.orgId) ?? new Set<string>();
    const personalSnap: Row = { ...snap, [KEY]: JSON.stringify(personal) };
    const localOrg0 = orgs.get(this.orgId) ?? Split.EMPTY_ORG_DATA();
    const localOrg = Canon?.retainOrgGuests
      ? Canon.retainOrgGuests(localOrg0, this.org.last[KEY], fullData.guests, (fullData._deleted as { guests?: unknown } | undefined)?.guests)
      : localOrg0;
    const orgSnap: Row = { [KEY]: JSON.stringify(localOrg), ...OrgCfg.extractOrgCassaConfig(snap, orgSids), ...OrgCfg.extractOrgPoolConfig(snap, orgSids, this.org.last["spigolestay:inventorypool"]), ...OrgCfg.extractOrgMsgState(snap, orgSids) };

    const pRes = this.saveOne(srv, "app:" + this.uid, personalSnap, this.personal, this.baseHashes ?? {});
    const oRes = this.saveOne(srv, "org:" + this.orgId, orgSnap, this.org);

    const mergedPersonal = JSON.parse(pRes.merged[KEY] || "{}") as Json;
    const orgData = JSON.parse(oRes.merged[KEY] || "{}") as Json;
    const combined = Combine.combineData(mergedPersonal, [orgData]);
    const newBlob: Row = { ...pRes.merged, [KEY]: JSON.stringify(combined) };
    if (orgSids.size) { Object.assign(newBlob, OrgCfg.applyOrgCassaConfig(newBlob, oRes.merged, orgSids)); Object.assign(newBlob, OrgCfg.applyOrgPoolConfig(newBlob, oRes.merged, orgSids)); Object.assign(newBlob, OrgCfg.applyOrgMsgState(newBlob, oRes.merged, orgSids)); }
    const changedLocal = Core.contentSig(newBlob) !== Core.contentSig(snap);
    if (changedLocal) { const next: Row = {}; for (const [k, v] of Object.entries(newBlob)) if (Core.isSyncKey(k)) next[k] = v; this.local = next; }
    // base persistente per le chiavi piatte (come commitSyncBase)
    this.baseHashes = Core.readSyncBase(Core.syncBaseText(this.uid, this.personal.last), this.uid);
    return { personalWrote: pRes.wrote, orgWrote: oRes.wrote };
  }
}

// ── Scenario di produzione: org con 2 strutture (sh, sr), un titolare in modalita' veloce che apre solo «sr», due soci in modalita' normale ──────────────────────────────
export const TODAY = "2026-10-21";
const day = (o: number) => new Date(Date.parse(TODAY + "T00:00:00Z") + o * 86400000).toISOString().slice(0, 10);
export const GUEST_G = "ecedd175-cd79-4cf7-b629-918049c4b9d0";
const CONTO = (key: string, label: string) => ({ key, label, structureIds: ["sh", "sr"] });

export function fullBlob(): Json {
  const bookings: Json[] = [], guests: Json[] = [];
  for (let i = 0; i < 10; i++) {
    for (const s of ["sr", "sh"]) {
      bookings.push({ id: `b-${s}-${i}`, structureId: s, guestId: `g-${s}-${i}`, checkIn: day(5 + i * 3), checkOut: day(7 + i * 3), status: "confirmed", updatedAt: 1000 });
      guests.push({ id: `g-${s}-${i}`, fullName: `Ospite ${s} ${i}`, updatedAt: 1000 });
    }
  }
  // l'ospite del titolare: creato 2 giorni fa (dentro i 3 giorni di «ospite fresco» della finestra), citato da una prenotazione di «sh»
  bookings.push({ id: "b-G", structureId: "sh", guestId: GUEST_G, checkIn: day(30), checkOut: day(32), status: "confirmed", updatedAt: 1000 });
  guests.push({ id: GUEST_G, fullName: "andrea tringali", updatedAt: Date.parse(TODAY + "T12:00:00Z") - 2 * 86400000 });
  return {
    structures: [{ id: "sh", orgId: "o1", name: "Spigolehouse", updatedAt: 1 }, { id: "sr", orgId: "o1", name: "Spigole Rooms", updatedAt: 1 }],
    roomTypes: [], units: [], bookings, guests, events: [], directReviews: [], rateOverrides: {}, activities: [], _deleted: {},
  };
}

const ORDERS: Record<string, string[]> = {
  titolare: ["conto-revolut", "contanti", "banca"],
  greta: ["contanti", "banca", "conto-revolut"],
  stefano: ["banca", "conto-revolut", "contanti"],
};
const LABEL: Record<string, string> = { contanti: "Contanti", banca: "Banca", "conto-revolut": "Revolut" };
export const contiRaw = (order: string[]): string => JSON.stringify(order.map((k) => CONTO(k, LABEL[k])));
const prefsRaw = JSON.stringify({ order: ["conto-revolut", "banca", "contanti"], principal: "conto-revolut", principalBy: { sh: "conto-revolut", sr: "conto-revolut" } });

export function scenario(L: Libs): { srv: Srv; titolare: Dev; greta: Dev; stefano: Dev } {
  const full = fullBlob();
  const { personal, orgs } = L.Split.splitByOrg(full);
  const srv = new Srv(L, TODAY);
  srv.put("org:o1", { [KEY]: JSON.stringify(orgs.get("o1")), [CONTI]: contiRaw(ORDERS.greta), "spigolestay:cassa:conti-prefs": JSON.stringify({ principalBy: { sh: "conto-revolut", sr: "conto-revolut" } }) });
  const mk = (name: string, uid: string, delta: boolean, data: Json): Dev => {
    srv.put("app:" + uid, { [KEY]: JSON.stringify(personal), [CONTI]: contiRaw(ORDERS[name]), "spigolestay:cassa:conti-prefs": prefsRaw });
    return new Dev(L, { name, uid, orgId: "o1", delta, scope: delta ? ["sr"] : null, local: { [KEY]: JSON.stringify(data), [CONTI]: contiRaw(ORDERS[name]), "spigolestay:cassa:conti-prefs": prefsRaw } });
  };
  const win = L.W.windowDataObject(full, TODAY, 400, ["sr"]).data as Json;
  return { srv, titolare: mk("titolare", "u-andrea", true, win), greta: mk("greta", "u-greta", false, full), stefano: mk("stefano", "u-stefano", false, full) };
}
