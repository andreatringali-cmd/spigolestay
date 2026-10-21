import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// WATCHDOG: controlli semplici sullo stato del sistema + avviso email al titolare SOLO se qualcosa non va.
// Tutta la logica sta qui (testabile con un database finto); la route /api/cron/watchdog si limita a autenticare e chiamare runWatchdog().
//
// Controlli:
//  - db        : il database risponde, e quanto in fretta (una lettura minima con tempo massimo).
//  - verify    : l'ultimo controllo notturno `entities-verify` (tabella entities_verify_log) esiste, è recente ed è ok.
//  - copie     : le copie giornaliere (tabelle app_state_daily / org_state_daily) sono di ieri o oggi. Se le tabelle non esistono ancora: nessun problema.
//  - errori    : righe nelle ultime 24 ore in entities_sync_errors / entities_extra_errors (tabella assente = nessun problema).
//
// Gli avvisi sono limitati a UNO ogni 6 ore PER TIPO di problema (stato nella tabella watchdog_state, migrazione 0020).
// Senza interruttore WATCHDOG_ENABLED=1 non si invia nulla: si restituisce solo il report.
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = "warn" | "crit";
export type CheckStatus = "ok" | "warn" | "crit" | "nd";
export interface Check { id: string; status: CheckStatus; text: string; ms?: number }
export interface Problem { key: string; severity: Severity; text: string }
export interface EmailOutcome { enabled: boolean; attempted: boolean; sent: boolean; to?: string; due: string[]; throttled: string[]; skipped?: string; error?: string }
export interface WatchdogReport { ok: boolean; generatedAt: string; checks: Check[]; problems: Problem[]; email: EmailOutcome }

export const THROTTLE_MS = 6 * 3600_000;          // una email ogni 6 ore per tipo di problema
export const DB_TIMEOUT_MS = 8000;                // oltre: database considerato non raggiungibile
export const DB_SLOW_MS = 2000;                   // oltre: lento (giallo)
export const VERIFY_MAX_AGE_H = 30;               // il controllo notturno gira ogni 24 h: oltre 30 h è in ritardo
export const DAILY_MAX_AGE_DAYS = 2;              // l'ultima copia giornaliera non deve avere più di 2 giorni
export const ERRORS_WINDOW_H = 24;
export const ERRORS_CRIT_COUNT = 20;

type Err = { message?: string; code?: string } | null;
type Res<T> = { data: T | null; error: Err; count?: number | null };

/** Tabella che non esiste (ancora): PostgREST risponde PGRST205 o 42P01. Non è un guasto. */
export function isMissingTable(e: Err | undefined): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  const msg = String(e.message ?? "").toLowerCase();
  return code === "PGRST205" || code === "42P01" || msg.includes("could not find the table") || /relation .* does not exist/.test(msg);
}

const ago = (ms: number, now: number) => new Date(now - ms).toISOString();
const hours = (ms: number) => Math.round((ms / 3600_000) * 10) / 10;

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve("timeout"), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Data (YYYY-MM-DD) di «oggi» in fuso Europe/Rome. */
export function romeDay(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400_000);

// ─── Controlli ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function checkDb(db: SupabaseClient, now: () => number = Date.now, timeoutMs: number = DB_TIMEOUT_MS): Promise<{ check: Check; problems: Problem[] }> {
  const t0 = now();
  try {
    const r = await withTimeout(db.from("app_state").select("user_id").limit(1) as unknown as PromiseLike<Res<unknown[]>>, timeoutMs);
    const ms = now() - t0;
    if (r === "timeout") {
      return { check: { id: "db", status: "crit", text: `Il database non risponde entro ${timeoutMs / 1000} secondi.`, ms }, problems: [{ key: "db_down", severity: "crit", text: `Il database non risponde (nessuna risposta in ${timeoutMs / 1000} secondi). Gli utenti potrebbero vedere errori 522.` }] };
    }
    if (r.error) {
      return { check: { id: "db", status: "crit", text: "Il database risponde con un errore.", ms }, problems: [{ key: "db_down", severity: "crit", text: `Il database risponde con un errore: ${String(r.error.message ?? "sconosciuto").slice(0, 160)}` }] };
    }
    if (ms > DB_SLOW_MS) {
      return { check: { id: "db", status: "warn", text: `Il database risponde ma lentamente (${ms} ms).`, ms }, problems: [{ key: "db_slow", severity: "warn", text: `Il database è lento: una lettura minima ha impiegato ${ms} ms (soglia ${DB_SLOW_MS} ms).` }] };
    }
    return { check: { id: "db", status: "ok", text: `Il database risponde in ${ms} ms.`, ms }, problems: [] };
  } catch (e) {
    const ms = now() - t0;
    return { check: { id: "db", status: "crit", text: "Il database non è raggiungibile.", ms }, problems: [{ key: "db_down", severity: "crit", text: `Il database non è raggiungibile: ${String((e as Error)?.message ?? e).slice(0, 160)}` }] };
  }
}

export async function checkVerify(db: SupabaseClient, nowMs: number): Promise<{ check: Check; problems: Problem[] }> {
  try {
    const r = (await db.from("entities_verify_log").select("at, ok, summary").order("at", { ascending: false }).limit(1)) as unknown as Res<{ at: string; ok: boolean; summary?: { bad?: number; errors?: number } | null }[]>;
    if (r.error) {
      if (isMissingTable(r.error)) return { check: { id: "verify", status: "nd", text: "Registro del controllo notturno assente (tabella non presente)." }, problems: [] };
      return { check: { id: "verify", status: "warn", text: "Registro del controllo notturno illeggibile." }, problems: [{ key: "verify_unreadable", severity: "warn", text: `Non riesco a leggere il registro del controllo notturno: ${String(r.error.message ?? "").slice(0, 120)}` }] };
    }
    const last = r.data?.[0];
    if (!last) return { check: { id: "verify", status: "warn", text: "Il controllo notturno non ha ancora lasciato nessuna riga." }, problems: [{ key: "verify_never", severity: "warn", text: "Il controllo notturno dei dati (entities-verify) non ha mai lasciato una riga nel registro." }] };
    const ageMs = nowMs - Date.parse(last.at);
    if (!last.ok) {
      const bad = last.summary?.bad ?? "?";
      return { check: { id: "verify", status: "crit", text: `Ultimo controllo notturno con differenze (${bad}).` }, problems: [{ key: "verify_bad", severity: "crit", text: `L'ultimo controllo notturno (${last.at}) ha trovato ${bad} differenze tra i dati principali e le tabelle. Da guardare con attenzione.` }] };
    }
    if (ageMs > VERIFY_MAX_AGE_H * 3600_000) {
      return { check: { id: "verify", status: "warn", text: `Ultimo controllo notturno riuscito ${hours(ageMs)} ore fa (atteso entro ${VERIFY_MAX_AGE_H}).` }, problems: [{ key: "verify_late", severity: "warn", text: `Il controllo notturno è in ritardo: l'ultimo riuscito risale a ${hours(ageMs)} ore fa (dovrebbe girare ogni 24 ore).` }] };
    }
    return { check: { id: "verify", status: "ok", text: `Ultimo controllo notturno riuscito ${hours(ageMs)} ore fa.` }, problems: [] };
  } catch (e) {
    return { check: { id: "verify", status: "warn", text: "Controllo notturno non verificabile." }, problems: [{ key: "verify_unreadable", severity: "warn", text: `Non riesco a verificare il controllo notturno: ${String((e as Error)?.message ?? e).slice(0, 120)}` }] };
  }
}

async function latestDay(db: SupabaseClient, table: string): Promise<{ day: string | null; missing: boolean; error?: string }> {
  try {
    const r = (await db.from(table).select("day").order("day", { ascending: false }).limit(1)) as unknown as Res<{ day: string }[]>;
    if (r.error) return isMissingTable(r.error) ? { day: null, missing: true } : { day: null, missing: false, error: String(r.error.message ?? "errore") };
    return { day: r.data?.[0]?.day ?? null, missing: false };
  } catch (e) {
    return { day: null, missing: false, error: String((e as Error)?.message ?? e) };
  }
}

export async function checkDaily(db: SupabaseClient, nowMs: number): Promise<{ check: Check; problems: Problem[] }> {
  const [a, o] = await Promise.all([latestDay(db, "app_state_daily"), latestDay(db, "org_state_daily")]);
  if (a.missing && o.missing) return { check: { id: "copie", status: "nd", text: "Copie giornaliere non ancora attivate (tabelle assenti): nessun controllo." }, problems: [] };
  const today = romeDay(nowMs);
  const problems: Problem[] = [];
  const parts: string[] = [];
  for (const [label, key, r] of [["account", "daily_app", a], ["organizzazioni", "daily_org", o]] as const) {
    if (r.missing) { parts.push(`${label}: tabella assente`); continue; }
    if (r.error) { parts.push(`${label}: illeggibile`); problems.push({ key: `${key}_unreadable`, severity: "warn", text: `Non riesco a leggere le copie giornaliere (${label}): ${r.error.slice(0, 120)}` }); continue; }
    if (!r.day) { parts.push(`${label}: nessuna copia`); problems.push({ key: `${key}_none`, severity: "crit", text: `Le copie giornaliere (${label}) sono attive ma non c'è ancora nessuna copia.` }); continue; }
    const age = dayDiff(today, r.day);
    parts.push(`${label}: ultima copia del ${r.day}`);
    if (age > DAILY_MAX_AGE_DAYS) problems.push({ key: `${key}_late`, severity: "crit", text: `La copia giornaliera (${label}) è ferma al ${r.day}, cioè ${age} giorni fa: la copia automatica non sta partendo.` });
  }
  const worst: CheckStatus = problems.some((p) => p.severity === "crit") ? "crit" : problems.length ? "warn" : "ok";
  return { check: { id: "copie", status: worst, text: parts.join("; ") + "." }, problems };
}

export async function checkErrors(db: SupabaseClient, nowMs: number): Promise<{ check: Check; problems: Problem[] }> {
  const since = ago(ERRORS_WINDOW_H * 3600_000, nowMs);
  const problems: Problem[] = [];
  const parts: string[] = [];
  let anyMissing = 0;
  for (const [table, key, nome] of [["entities_sync_errors", "sync_errors", "di sincronizzazione"], ["entities_extra_errors", "extra_errors", "dei passi extra"]] as const) {
    try {
      const r = (await db.from(table).select("at", { count: "exact", head: true }).gte("at", since)) as unknown as Res<unknown>;
      if (r.error) {
        if (isMissingTable(r.error)) { anyMissing++; parts.push(`${table}: assente`); continue; }
        parts.push(`${table}: illeggibile`);
        problems.push({ key: `${key}_unreadable`, severity: "warn", text: `Non riesco a leggere il registro errori ${nome} (${table}): ${String(r.error.message ?? "").slice(0, 120)}` });
        continue;
      }
      const n = r.count ?? 0;
      parts.push(`${table}: ${n} nelle ultime ${ERRORS_WINDOW_H} ore`);
      if (n > 0) problems.push({ key, severity: n >= ERRORS_CRIT_COUNT ? "crit" : "warn", text: `${n} errori ${nome} nelle ultime ${ERRORS_WINDOW_H} ore (tabella ${table}).` });
    } catch (e) {
      parts.push(`${table}: illeggibile`);
      problems.push({ key: `${key}_unreadable`, severity: "warn", text: `Non riesco a leggere il registro errori ${nome}: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
    }
  }
  if (anyMissing === 2) return { check: { id: "errori", status: "nd", text: "Registri errori assenti (tabelle non presenti): nessun controllo." }, problems };
  const worst: CheckStatus = problems.some((p) => p.severity === "crit") ? "crit" : problems.length ? "warn" : "ok";
  return { check: { id: "errori", status: worst, text: parts.join("; ") + "." }, problems };
}

// ─── Limite di frequenza degli avvisi ─────────────────────────────────────────────────────────────────────────────────

export type ThrottleSource = "db" | "memory" | "none";
export interface ThrottleState { source: ThrottleSource; last: Map<string, number> }

/** In-memory (per istanza): ripiego SOLO quando il database è giù e quindi non può dirci quando abbiamo scritto l'ultima volta. */
const memoryLast = new Map<string, number>();
export function _resetMemoryThrottleForTests() { memoryLast.clear(); }

export async function loadThrottle(db: SupabaseClient, dbDown: boolean): Promise<ThrottleState> {
  if (dbDown) return { source: "memory", last: new Map(memoryLast) };
  try {
    const r = (await db.from("watchdog_state").select("key, last_sent_at")) as unknown as Res<{ key: string; last_sent_at: string | null }[]>;
    if (r.error) return { source: isMissingTable(r.error) ? "none" : "memory", last: new Map(memoryLast) };
    const m = new Map<string, number>();
    for (const row of r.data ?? []) if (row.last_sent_at) m.set(row.key, Date.parse(row.last_sent_at));
    return { source: "db", last: m };
  } catch {
    return { source: "memory", last: new Map(memoryLast) };
  }
}

export function splitDue(problems: Problem[], last: Map<string, number>, nowMs: number): { due: Problem[]; throttled: Problem[] } {
  const due: Problem[] = []; const throttled: Problem[] = [];
  for (const p of problems) {
    const t = last.get(p.key);
    (t !== undefined && Number.isFinite(t) && nowMs - t < THROTTLE_MS ? throttled : due).push(p);
  }
  return { due, throttled };
}

async function saveSent(db: SupabaseClient, state: ThrottleState, keys: string[], nowMs: number) {
  for (const k of keys) memoryLast.set(k, nowMs);
  if (state.source !== "db") return;
  try {
    await db.from("watchdog_state").upsert(keys.map((key) => ({ key, last_sent_at: new Date(nowMs).toISOString() })), { onConflict: "key" });
  } catch { /* se non si riesce a registrare, l'avviso successivo potrebbe ripetersi: meglio di non avvisare */ }
}

// ─── Email ──────────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export function buildEmail(problems: Problem[], nowMs: number): { subject: string; html: string; text: string } {
  const crit = problems.some((p) => p.severity === "crit");
  const subject = `[Xenora] ${crit ? "Problema da controllare" : "Attenzione"}: ${problems.length === 1 ? "1 segnalazione" : problems.length + " segnalazioni"}`;
  const when = new Date(nowMs).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  const rows = problems.map((p) => `<li style="margin:0 0 8px"><b>${p.severity === "crit" ? "Urgente" : "Da guardare"}.</b> ${esc(p.text)}</li>`).join("");
  const html = `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1f2430"><h2 style="margin:0 0 12px">Xenora: controllo automatico</h2><p style="margin:0 0 12px">Alle ${esc(when)} il controllo ha trovato:</p><ul style="padding-left:18px;margin:0 0 14px">${rows}</ul><p style="color:#6b7280;font-size:13px;margin:0">Riceverai al massimo una email ogni 6 ore per ogni tipo di problema. Nessuna azione automatica è stata eseguita sui dati.</p></div>`;
  const text = `Xenora: controllo automatico (${when})\n\n` + problems.map((p) => `- [${p.severity === "crit" ? "URGENTE" : "da guardare"}] ${p.text}`).join("\n") + "\n\nUna email ogni 6 ore al massimo per tipo di problema. Nessuna azione automatica sui dati.";
  return { subject, html, text };
}

export type SendFn = (m: { to: string; subject: string; html: string; text: string }) => Promise<{ ok: boolean; error?: string }>;

/** Invio reale con Resend (stesso sistema delle altre email dell'app). Non usato nei test. */
export function resendSender(env: { RESEND_API_KEY?: string; RESEND_FROM?: string }, fetchImpl: typeof fetch = fetch): SendFn {
  return async (m) => {
    const key = env.RESEND_API_KEY || "";
    if (!key) return { ok: false, error: "RESEND_API_KEY mancante" };
    const from = env.RESEND_FROM || "prenotazioni@xenora.it";
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: `Xenora <${from}>`, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { message?: string }; return { ok: false, error: d?.message || `Resend ${res.status}` }; }
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e as Error)?.message ?? e) }; }
  };
}

/** Destinatario: WATCHDOG_TO se impostato, altrimenti il primo amministratore (come il resto dell'app). */
export function ownerEmail(env: { WATCHDOG_TO?: string; ADMIN_EMAILS?: string }): string {
  const explicit = (env.WATCHDOG_TO || "").split(",")[0].trim();
  if (explicit) return explicit;
  return ((env.ADMIN_EMAILS || "spigolehouse@gmail.com").split(",")[0] || "").trim();
}
const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");

// ─── Orchestrazione ─────────────────────────────────────────────────────────────────────────────────────────────

export interface WatchdogDeps {
  db: SupabaseClient;
  env: { WATCHDOG_ENABLED?: string; WATCHDOG_TO?: string; ADMIN_EMAILS?: string };
  send: SendFn;
  now?: () => number;
  /** Solo per i test: tempo massimo della lettura di prova del database. */
  dbTimeoutMs?: number;
}

export async function runWatchdog(deps: WatchdogDeps): Promise<WatchdogReport> {
  const now = deps.now ?? Date.now;
  const nowMs = now();
  const enabled = deps.env.WATCHDOG_ENABLED === "1";

  const dbRes = await checkDb(deps.db, now, deps.dbTimeoutMs);
  const dbDown = dbRes.problems.some((p) => p.key === "db_down");
  // Se il database non risponde non ha senso interrogarlo ancora: gli altri controlli restano «non verificabili».
  const rest = dbDown
    ? [] as { check: Check; problems: Problem[] }[]
    : await Promise.all([checkVerify(deps.db, nowMs), checkDaily(deps.db, nowMs), checkErrors(deps.db, nowMs)]);
  const checks: Check[] = [dbRes.check, ...rest.map((r) => r.check)];
  if (dbDown) checks.push({ id: "altri", status: "nd", text: "Altri controlli saltati: database non raggiungibile." });
  const problems: Problem[] = [...dbRes.problems, ...rest.flatMap((r) => r.problems)];

  const email: EmailOutcome = { enabled, attempted: false, sent: false, due: [], throttled: [] };
  if (problems.length === 0) return { ok: true, generatedAt: new Date(nowMs).toISOString(), checks, problems, email };
  if (!enabled) { email.skipped = "WATCHDOG_ENABLED non è 1: nessun invio"; return { ok: false, generatedAt: new Date(nowMs).toISOString(), checks, problems, email }; }

  const state = await loadThrottle(deps.db, dbDown);
  if (state.source === "none") {
    email.skipped = "tabella watchdog_state assente (migrazione 0020 non applicata): per non rischiare ripetizioni non invio";
    return { ok: false, generatedAt: new Date(nowMs).toISOString(), checks, problems, email };
  }
  const { due, throttled } = splitDue(problems, state.last, nowMs);
  email.due = due.map((p) => p.key); email.throttled = throttled.map((p) => p.key);
  if (due.length === 0) { email.skipped = "già avvisato nelle ultime 6 ore"; return { ok: false, generatedAt: new Date(nowMs).toISOString(), checks, problems, email }; }

  const to = ownerEmail(deps.env);
  if (!to) { email.skipped = "nessun destinatario"; return { ok: false, generatedAt: new Date(nowMs).toISOString(), checks, problems, email }; }
  email.to = mask(to);
  email.attempted = true;
  const msg = buildEmail(due, nowMs);
  const r = await deps.send({ to, ...msg });
  email.sent = r.ok;
  if (r.ok) await saveSent(deps.db, state, due.map((p) => p.key), nowMs);
  else email.error = r.error ?? "invio fallito";
  return { ok: false, generatedAt: new Date(nowMs).toISOString(), checks, problems, email };
}
