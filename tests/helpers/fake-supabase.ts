// Finto client Supabase in memoria per i test dei moduli server. Supporta quanto serve a channex-inbound e public-booking:
// select / eq / in / is / maybeSingle / update (con select di ritorno) / upsert, e il blocco ottimistico su "rev"
// (app_state e org_state: ogni update riuscito fa salire rev di 1). Nessuna rete, nessun database vero.
type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "in" | "is"; val: unknown };

export interface FakeDb {
  tables: Record<string, Row[]>;
  log: { op: string; table: string; payload?: unknown; filters?: Filter[] }[];
  /** Chiamato dopo ogni select di una tabella: serve a simulare una scrittura concorrente tra lettura e scrittura. */
  afterSelect?: (table: string, db: FakeDb) => void;
  /** Se impostato, gli update su quella tabella falliscono con questo messaggio. */
  failUpdate?: Record<string, string>;
}

const REV_TABLES = new Set(["app_state", "org_state"]);
const matches = (row: Row, fs: Filter[]) => fs.every((f) => {
  if (f.op === "eq") return row[f.col] === f.val;
  if (f.op === "in") return (f.val as unknown[]).includes(row[f.col]);
  return f.val === null ? row[f.col] == null : row[f.col] === f.val;
});

class Query {
  private filters: Filter[] = [];
  private mode: "select" | "update" | "upsert" = "select";
  private payload: Row | undefined;
  private onConflict: string | undefined;
  private returning = false;
  private db: FakeDb;
  private table: string;
  constructor(db: FakeDb, table: string) { this.db = db; this.table = table; }
  select(_cols?: string) { if (this.mode === "update" || this.mode === "upsert") this.returning = true; else this.mode = "select"; return this; }
  update(p: Row) { this.mode = "update"; this.payload = p; return this; }
  upsert(p: Row, opts?: { onConflict?: string }) { this.mode = "upsert"; this.payload = p; this.onConflict = opts?.onConflict; return this; }
  eq(col: string, val: unknown) { this.filters.push({ col, op: "eq", val }); return this; }
  in(col: string, val: unknown[]) { this.filters.push({ col, op: "in", val }); return this; }
  is(col: string, val: unknown) { this.filters.push({ col, op: "is", val }); return this; }
  async maybeSingle() { const r = this.run(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }; }
  then<T>(resolve: (v: { data: unknown; error: { message: string } | null }) => T, reject?: (e: unknown) => unknown) {
    try { return Promise.resolve(this.run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
  }
  private run(): { data: unknown; error: { message: string } | null } {
    const rows = (this.db.tables[this.table] ??= []);
    this.db.log.push({ op: this.mode, table: this.table, payload: this.payload, filters: this.filters });
    if (this.mode === "select") {
      const data = rows.filter((r) => matches(r, this.filters)).map((r) => structuredClone(r));
      this.db.afterSelect?.(this.table, this.db);
      return { data, error: null };
    }
    if (this.mode === "update") {
      const fail = this.db.failUpdate?.[this.table];
      if (fail) return { data: null, error: { message: fail } };
      const hit = rows.filter((r) => matches(r, this.filters));
      for (const r of hit) { Object.assign(r, structuredClone(this.payload)); if (REV_TABLES.has(this.table)) r.rev = Number(r.rev ?? 0) + 1; }
      return { data: this.returning ? hit.map((r) => ({ rev: r.rev })) : null, error: null };
    }
    const key = this.onConflict;
    const incoming = structuredClone(this.payload!) as Row;
    const idx = key ? rows.findIndex((r) => r[key] === incoming[key]) : -1;
    if (idx >= 0) Object.assign(rows[idx], incoming); else rows.push(incoming);
    return { data: null, error: null };
  }
}

export function makeFakeDb(tables: Record<string, Row[]> = {}): { db: FakeDb; client: unknown } {
  const db: FakeDb = { tables: structuredClone(tables), log: [] };
  const client = { from: (table: string) => new Query(db, table) };
  return { db, client };
}
