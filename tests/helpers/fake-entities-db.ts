// Finto client Supabase in memoria per i test della lettura dalle tabelle (src/lib/server-entities.ts).
// Oltre a quanto fa fake-supabase.ts (select / eq / in / update con blocco su "rev" per app_state e org_state) supporta quello che serve a public.entities:
// gte / lte / ilike / contains, percorsi JSON ("data->>campo", "data->campo"), order, range (le pagine da 1000 righe di PostgREST), limit,
// e colonne che "non esistono ancora" (missingColumns: la 0015 non e' applicata) con lo stesso errore 42703 di Postgres.
type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "in" | "gte" | "lte" | "ilike" | "contains"; val: unknown };
type Res = { data: unknown; error: { code?: string; message: string } | null };

export interface FakeEntitiesDb {
  tables: Record<string, Row[]>;
  /** Una voce per ogni richiesta eseguita (select / update), con tabella, filtri, colonne e limite. */
  log: { op: string; table: string; cols?: string; filters: Filter[]; limit?: number; range?: [number, number] }[];
  /** Colonne di public.entities che NON esistono (migrazione 0015 non applicata). */
  missingColumns: Set<string>;
  /** Se impostato, ogni select su public.entities fallisce con questo messaggio (simula un errore di lettura). */
  failEntities?: string;
}

const REV_TABLES = new Set(["app_state", "org_state"]);
const ENTITIES_COLS = new Set(["owner_type", "owner_id", "kind", "id", "structure_id", "data", "updated_ms", "check_in", "check_out", "status", "channel", "synced_at", "ota_code", "unit_id", "guest_id", "group_id"]);

function valueOf(row: Row, col: string): unknown {
  if (col.startsWith("data->>")) { const v = (row.data as Row | undefined)?.[col.slice(7)]; return v == null ? null : typeof v === "object" ? JSON.stringify(v) : String(v); }
  if (col.startsWith("data->")) return (row.data as Row | undefined)?.[col.slice(6)] ?? null;
  return row[col];
}
function contains(have: unknown, want: unknown): boolean {
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w) => have.some((h) => contains(h, w)));
  if (want && typeof want === "object") return !!have && typeof have === "object" && Object.entries(want as Row).every(([k, v]) => contains((have as Row)[k], v));
  return have === want;
}
const escRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function likeRe(pat: string): RegExp {
  let re = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "\\" && i + 1 < pat.length) re += escRe(pat[++i]);
    else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += escRe(c);
  }
  return new RegExp("^" + re + "$", "i");
}
const matches = (row: Row, fs: Filter[]) => fs.every((f) => {
  const v = valueOf(row, f.col);
  if (f.op === "eq") return v === f.val;
  if (f.op === "in") return (f.val as unknown[]).includes(v);
  if (f.op === "gte") return v != null && String(v) >= String(f.val);
  if (f.op === "lte") return v != null && String(v) <= String(f.val);
  if (f.op === "ilike") return v != null && likeRe(String(f.val)).test(String(v));
  return contains(valueOf(row, f.col), f.val);
});

class Query {
  private filters: Filter[] = [];
  private mode: "select" | "update" = "select";
  private payload: Row | undefined;
  private returning = false;
  private cols: string | undefined;
  private orders: string[] = [];
  private lim: number | undefined;
  private rng: [number, number] | undefined;
  private db: FakeEntitiesDb;
  private table: string;
  constructor(db: FakeEntitiesDb, table: string) { this.db = db; this.table = table; }
  select(cols?: string) { if (this.mode === "update") this.returning = true; else { this.mode = "select"; this.cols = cols; } return this; }
  update(p: Row) { this.mode = "update"; this.payload = p; return this; }
  eq(col: string, val: unknown) { this.filters.push({ col, op: "eq", val }); return this; }
  in(col: string, val: unknown[]) { this.filters.push({ col, op: "in", val }); return this; }
  gte(col: string, val: unknown) { this.filters.push({ col, op: "gte", val }); return this; }
  lte(col: string, val: unknown) { this.filters.push({ col, op: "lte", val }); return this; }
  ilike(col: string, val: string) { this.filters.push({ col, op: "ilike", val }); return this; }
  contains(col: string, val: unknown) { this.filters.push({ col, op: "contains", val }); return this; }
  order(col: string, _o?: unknown) { this.orders.push(col); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.rng = [a, b]; return this; }
  async maybeSingle() { const r = this.run(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }; }
  then<T>(resolve: (v: Res) => T, reject?: (e: unknown) => unknown) {
    try { return Promise.resolve(this.run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
  }
  private missing(): string | null {
    if (this.table !== "entities") return null;
    const used = [...(this.cols ? this.cols.split(",").map((c) => c.trim()) : []), ...this.filters.map((f) => f.col)].map((c) => c.split("->")[0]);
    for (const c of used) if (c && c !== "*" && (this.db.missingColumns.has(c) || !ENTITIES_COLS.has(c))) return c;
    return null;
  }
  private run(): Res {
    this.db.log.push({ op: this.mode, table: this.table, cols: this.cols, filters: [...this.filters], limit: this.lim, range: this.rng });
    if (this.table === "entities" && this.db.failEntities) return { data: null, error: { message: this.db.failEntities } };
    const miss = this.missing();
    if (miss) return { data: null, error: { code: "42703", message: `column entities.${miss} does not exist` } };
    const rows = (this.db.tables[this.table] ??= []);
    if (this.mode === "update") {
      const hit = rows.filter((r) => matches(r, this.filters));
      for (const r of hit) { Object.assign(r, structuredClone(this.payload)); if (REV_TABLES.has(this.table)) r.rev = Number(r.rev ?? 0) + 1; }
      return { data: this.returning ? hit.map((r) => ({ rev: r.rev })) : null, error: null };
    }
    let out = rows.filter((r) => matches(r, this.filters));
    if (this.orders.length) out = [...out].sort((a, b) => { for (const c of this.orders) { const x = String(valueOf(a, c) ?? ""), y = String(valueOf(b, c) ?? ""); if (x !== y) return x < y ? -1 : 1; } return 0; });
    if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim !== undefined) out = out.slice(0, this.lim);
    return { data: out.map((r) => structuredClone(r)), error: null };
  }
}

export function makeFakeEntitiesDb(tables: Record<string, Row[]> = {}, opts: { missingColumns?: string[] } = {}): { db: FakeEntitiesDb; client: unknown } {
  const db: FakeEntitiesDb = { tables: structuredClone(tables), log: [], missingColumns: new Set(opts.missingColumns ?? []) };
  const client = { from: (table: string) => new Query(db, table) };
  return { db, client };
}

export const NEW_COLUMNS = ["ota_code", "unit_id", "guest_id", "group_id"];

type Json = Record<string, any>;
/** Righe di public.entities equivalenti a un oggetto «data» del blocco (come le scrive il trigger blocco -> tabella). */
export function entityRowsFromBlock(owner: { type: "u" | "o"; id: string }, data: Json, extra: { withNewColumns?: boolean } = {}): Row[] {
  const rows: Row[] = [];
  for (const kind of ["structures", "roomTypes", "units", "bookings", "guests", "directReviews", "events"]) {
    for (const it of (data[kind] ?? []) as Json[]) {
      const row: Row = {
        owner_type: owner.type, owner_id: owner.id, kind, id: it.id, data: structuredClone(it), updated_ms: it.updatedAt ?? 0,
        structure_id: kind === "structures" ? it.id : (it.structureId ?? null),
        check_in: kind === "bookings" ? (it.checkIn ?? null) : null, check_out: kind === "bookings" ? (it.checkOut ?? null) : null,
        status: kind === "bookings" ? (it.status ?? null) : null, channel: kind === "bookings" ? (it.channel ?? null) : null,
      };
      if (extra.withNewColumns && kind === "bookings") Object.assign(row, { ota_code: it.extId?.startsWith?.("channex:") ? (it.code ?? null) : null, unit_id: it.unitId ?? null, guest_id: it.guestId ?? null, group_id: it.groupId ?? null });
      rows.push(row);
    }
  }
  return rows;
}
