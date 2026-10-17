// Cache in memoria (per istanza serverless calda) delle conversazioni OTA lette da Channex.
// Modulo PURO: l'orologio è iniettabile, così si prova con `node --test`.
// Serve a ridurre le chiamate a Channex: la chiave API è UNICA per tutti i clienti e il limite (20 richieste/min) è condiviso.
import type { OtaThread } from "./channex-threads";

/** Conversazioni per id, con indice per id prenotazione Channex ed eviction (oltre `max` voci: via le scadute, poi si svuota). */
export class ThreadCache {
  private m = new Map<string, { t: OtaThread; at: number }>();
  private byBooking = new Map<string, Set<string>>();
  private ttl: number; private max: number; private now: () => number;
  constructor(ttl = 5 * 60_000, max = 2000, now: () => number = Date.now) { this.ttl = ttl; this.max = max; this.now = now; }

  get size(): number { return this.m.size; }

  get(id: string): OtaThread | undefined {
    const hit = this.m.get(id);
    if (!hit) return undefined;
    if (this.now() - hit.at >= this.ttl) { this.delete(id); return undefined; }
    return hit.t;
  }

  set(t: OtaThread): void {
    if (this.m.size >= this.max && !this.m.has(t.id)) this.evict();
    this.delete(t.id); // se il thread ha cambiato prenotazione l'indice resta coerente
    this.m.set(t.id, { t, at: this.now() });
    if (t.bookingId) {
      let s = this.byBooking.get(t.bookingId);
      if (!s) { s = new Set(); this.byBooking.set(t.bookingId, s); }
      s.add(t.id);
    }
  }

  delete(id: string): void {
    const hit = this.m.get(id);
    if (!hit) return;
    this.m.delete(id);
    const b = hit.t.bookingId;
    if (b) { const s = this.byBooking.get(b); if (s) { s.delete(id); if (!s.size) this.byBooking.delete(b); } }
  }

  /** Conversazioni (non scadute) di una prenotazione Channex, senza scorrere tutta la cache. */
  ofBooking(bookingId: string): OtaThread[] {
    const ids = this.byBooking.get(bookingId.trim());
    if (!ids) return [];
    const out: OtaThread[] = [];
    for (const id of [...ids]) { const t = this.get(id); if (t) out.push(t); }
    return out;
  }

  clear(): void { this.m.clear(); this.byBooking.clear(); }

  private evict(): void {
    const now = this.now();
    for (const [id, v] of [...this.m]) if (now - v.at >= this.ttl) this.delete(id);
    if (this.m.size >= this.max) this.clear();
  }
}

/** Insieme di chiavi con scadenza (es. «nessun thread per questa prenotazione», 60 s), con tetto alla dimensione. */
export class TtlFlags {
  private m = new Map<string, number>();
  private ttl: number; private max: number; private now: () => number;
  constructor(ttl = 60_000, max = 2000, now: () => number = Date.now) { this.ttl = ttl; this.max = max; this.now = now; }

  has(key: string): boolean {
    const at = this.m.get(key);
    if (at === undefined) return false;
    if (this.now() - at >= this.ttl) { this.m.delete(key); return false; }
    return true;
  }

  set(key: string): void {
    if (this.m.size >= this.max && !this.m.has(key)) {
      const now = this.now();
      for (const [k, at] of [...this.m]) if (now - at >= this.ttl) this.m.delete(k);
      if (this.m.size >= this.max) this.m.clear();
    }
    this.m.set(key, this.now());
  }

  delete(key: string): void { this.m.delete(key); }
  get size(): number { return this.m.size; }
}
