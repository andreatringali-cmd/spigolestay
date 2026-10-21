import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Inviti dei collaboratori fatti dal TITOLARE di un account (non solo dall'amministratore di piattaforma):
// api/admin/allowlist con un database finto. Verifica chi può invitare, chi no, i tetti e che l'amministratore non cambi.
register("./helpers/invite-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
delete process.env.ADMIN_EMAILS; // default: spigolehouse@gmail.com e andreatringali.spi@gmail.com
delete process.env.RESEND_API_KEY;
const G = globalThis as unknown as { __stubs: { calls: Record<string, unknown[]>; admin?: unknown; allowed?: boolean; rateLimited?: boolean; limitKeys?: string[] } };
G.__stubs = { calls: {} };
const route = await import("../src/app/api/admin/allowlist/route.ts");
const { makeFakeDb } = await import("./helpers/fake-supabase.ts");
const IA = await import("../src/lib/invite-access.ts");
const UA = await import("../src/lib/user-access.ts");
const NF = await import("../src/lib/invite-notify.ts");

type Row = Record<string, unknown>;
const ADMIN = "spigolehouse@gmail.com";
const T = "titolare@cliente.it";      // titolare di un account cliente
const T2 = "altro@cliente2.it";       // titolare di un ALTRO account cliente
const C = "collab@cliente.it";        // collaboratore di T
const NEW = "nuova.persona@esempio.it";
const ID: Record<string, string> = { [ADMIN]: "u-admin", [T]: "u-t", [T2]: "u-t2", [C]: "u-c", [NEW]: "u-new" };
const TOKENS: Record<string, string> = { admin: ADMIN, t: T, t2: T2, c: C };
const perms = (o: Record<string, string>) => o;

function setup(extra: Record<string, Row[]> = {}) {
  const { db, client } = makeFakeDb({
    access_allowlist: [
      { email: T, kind: "titolare", added_by: ADMIN, created_at: "2026-09-01T10:00:00Z" },
      { email: T2, kind: "titolare", added_by: ADMIN, created_at: "2026-09-02T10:00:00Z" },
      { email: C, kind: "collaboratore", added_by: T, note: "Utente: Chiara Collab", created_at: "2026-10-01T10:00:00Z", profile: { perms: perms({ utenti: "view", cassa: "view" }), allStructures: true } },
    ],
    profiles: [{ user_id: "u-t", email: T }, { user_id: "u-t2", email: T2 }, { user_id: "u-c", email: C }],
    app_state: [{ user_id: "u-t" }, { user_id: "u-t2" }],
    memberships: [], org_invites: [],
    ...extra,
  });
  const base = client as { from: (t: string) => Record<string, unknown> };
  const admin = {
    from: (t: string) => { const q = base.from(t); q.order = () => q; return q; },
    auth: {
      getUser: async (token: string) => {
        const email = TOKENS[token];
        return email ? { data: { user: { id: ID[email], email, user_metadata: { full_name: email === T ? "Tina Titolare" : undefined } } }, error: null } : { data: { user: null }, error: { message: "bad" } };
      },
    },
  };
  Object.assign(G.__stubs, { admin, allowed: true, rateLimited: false, limitKeys: [] });
  return db;
}
async function call(method: "GET" | "POST" | "DELETE", token: string | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = (await (route as Record<string, (r: Request) => Promise<{ status: number; json: () => Promise<Record<string, any>> }>>)[method](new Request("https://xenora.test/api/admin/allowlist", { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })));
  return { status: res.status, body: await res.json() };
}
const rowOf = (db: { tables: Record<string, Row[]> }, email: string) => db.tables.access_allowlist.find((r) => String(r.email).toLowerCase() === email);
const invite = { email: NEW, profile: { id: "u-x", firstName: "Nuova", lastName: "Persona", perms: { prenotazioni: "edit", cassa: "view", impostazioni: "bogus" }, templateKey: "custom", allStructures: false, structureIds: ["st1"] } };

// ---- il caso del bug ---------------------------------------------------------------------------------------------------------
test("il TITOLARE di un account cliente invita un collaboratore (prima: 403 «solo dal titolare»)", async () => {
  const db = setup();
  const r = await call("POST", "t", { ...invite, kind: "titolare", note: "falsa" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(typeof r.body.sentAt, "string");
  const row = rowOf(db, NEW)!;
  assert.equal(row.kind, "collaboratore", "kind lo decide il server: un titolare non crea altri titolari");
  assert.equal(row.added_by, T, "added_by = chi invita (dal token, non dal browser)");
  assert.equal(row.note, "Utente: Nuova Persona");
  assert.deepEqual((row.profile as Row).perms, { prenotazioni: "edit", cassa: "view" }, "solo livelli noti");
  // l'invito vale per il suo account: la radice è il titolare
  const collabs = await IA.loadCollaborators(G.__stubs.admin as never);
  assert.equal(IA.rootOf(collabs, NEW), T);
});

test("l'identità arriva dal token, non dal corpo: l'email del chiamante nel corpo non conta", async () => {
  const db = setup();
  const r = await call("POST", "t", { ...invite, addedBy: ADMIN, added_by: ADMIN, email: NEW });
  assert.equal(r.status, 200);
  assert.equal(rowOf(db, NEW)!.added_by, T);
});

test("senza token: 401; account non ammesso: 403; token non valido: 401", async () => {
  setup();
  assert.equal((await call("POST", null, invite)).status, 401);
  assert.equal((await call("POST", "boh", invite)).status, 401);
  G.__stubs.allowed = false;
  const r = await call("POST", "t", invite);
  assert.equal(r.status, 403);
  assert.match(r.body.message, /abilitato/);
});

test("indirizzo non valido: messaggio chiaro", async () => {
  setup();
  const r = await call("POST", "t", { email: "non-una-email" });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /non è valido/);
});

test("non puoi invitare te stesso", async () => {
  const db = setup();
  const r = await call("POST", "t", { email: T });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "self_invite");
  assert.equal(db.tables.access_allowlist.length, 3);
});

// ---- collaboratore: serve il permesso «Utenti» --------------------------------------------------------------------------------
test("collaboratore SENZA il permesso «Utenti» in modifica: rifiutato (anche con solo «view»)", async () => {
  const db = setup();
  const r = await call("POST", "c", invite);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "missing_permission");
  assert.match(r.body.message, /permesso «Utenti»/);
  assert.equal(rowOf(db, NEW), undefined);
  assert.equal((await call("DELETE", "c", { email: C })).status, 403);
  assert.equal((await call("POST", "c", { email: NEW, resend: true })).status, 403);
});

test("collaboratore CON «Utenti» in modifica: può invitare, ma non oltre i propri permessi; l'account resta quello del titolare", async () => {
  const db = setup();
  rowOf(db, C)!.profile = { perms: { utenti: "edit", cassa: "view", prenotazioni: "edit" }, allStructures: false, structureIds: ["st1", "st2"] };
  const r = await call("POST", "c", { email: NEW, profile: { firstName: "N", lastName: "P", templateKey: "owner", perms: { cassa: "edit", prenotazioni: "edit", utenti: "edit", tariffe: "view" }, allStructures: true, structureIds: ["st1", "st9"] } });
  assert.equal(r.status, 200);
  const p = rowOf(db, NEW)!.profile as Row;
  assert.deepEqual(p.perms, { cassa: "view", prenotazioni: "edit", utenti: "view", tariffe: "none" }, "mai più di quanto ha chi invita; il permesso «Utenti» in modifica lo delega solo il titolare");
  assert.equal(p.templateKey, "custom", "niente modello Titolare");
  assert.equal(p.allStructures, false);
  assert.deepEqual(p.structureIds, ["st1"], "solo strutture che vede anche chi invita");
  assert.equal(rowOf(db, NEW)!.added_by, C);
  const collabs = await IA.loadCollaborators(G.__stubs.admin as never);
  assert.equal(IA.rootOf(collabs, NEW), T, "risalendo la catena si arriva al titolare");
});

// ---- email già membro -----------------------------------------------------------------------------------------------------------
test("email già registrata nel TUO account: messaggio chiaro, nessuna modifica", async () => {
  const db = setup();
  const before = JSON.stringify(rowOf(db, C));
  const r = await call("POST", "t", { email: C, profile: { firstName: "X" } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "already_member");
  assert.match(r.body.message, /collab@cliente\.it fa già parte del tuo account/);
  assert.equal(JSON.stringify(rowOf(db, C)), before);
  // anche il rinvio
  assert.equal((await call("POST", "t", { email: C, resend: true })).body.error, "already_member");
});

test("aggiornare i permessi di un collaboratore già dentro (profileOnly) è consentito, senza email", async () => {
  const db = setup();
  const r = await call("POST", "t", { email: C, profileOnly: true, profile: { perms: { cassa: "edit" }, allStructures: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.updated, true);
  assert.deepEqual((rowOf(db, C)!.profile as Row).perms, { cassa: "edit" });
});

// ---- tetto di inviti ------------------------------------------------------------------------------------------------------------
test("tetto: con 20 inviti in attesa il 21° è rifiutato; chi si è già registrato non conta", async () => {
  const pending: Row[] = Array.from({ length: 20 }, (_, i) => ({ email: `p${i}@esempio.it`, kind: "collaboratore", added_by: T, created_at: "2026-10-02T10:00:00Z" }));
  const db = setup({ access_allowlist: [
    { email: T, kind: "titolare", added_by: ADMIN }, { email: T2, kind: "titolare", added_by: ADMIN }, ...pending,
  ] });
  const r = await call("POST", "t", invite);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "invite_limit");
  assert.match(r.body.message, /20 inviti in attesa/);
  assert.equal(rowOf(db, NEW), undefined);
  // 5 si registrano: restano 15 in attesa → ora si può
  for (let i = 0; i < 5; i++) db.tables.profiles.push({ user_id: `up${i}`, email: `p${i}@esempio.it` });
  assert.equal((await call("POST", "t", invite)).status, 200);
  // gli inviti di un ALTRO account non pesano su questo
  db.tables.access_allowlist.push(...Array.from({ length: 25 }, (_, i) => ({ email: `q${i}@esempio.it`, kind: "collaboratore", added_by: T2 })));
  assert.equal((await call("POST", "t", { email: "altra@esempio.it" })).status, 200);
});

test("rimandare un invito già esistente non è bloccato dal tetto", async () => {
  const pending: Row[] = Array.from({ length: 20 }, (_, i) => ({ email: `p${i}@esempio.it`, kind: "collaboratore", added_by: T }));
  setup({ access_allowlist: [{ email: T, kind: "titolare", added_by: ADMIN }, ...pending] });
  const r = await call("POST", "t", { email: "p3@esempio.it", resend: true });
  assert.equal(r.status, 200);
});

test("limite orario per utente: 429 con messaggio", async () => {
  const db = setup();
  G.__stubs.rateLimited = true;
  const r = await call("POST", "t", invite);
  assert.equal(r.status, 429);
  assert.match(r.body.message, /molti inviti/);
  assert.equal(rowOf(db, NEW), undefined);
  assert.ok(G.__stubs.limitKeys!.includes("invite:u-t"), "il tetto è per utente (id dal token)");
});

// ---- account altrui -------------------------------------------------------------------------------------------------------------
test("non si invita in un account altrui: collaboratore di un altro titolare, titolare indipendente, utente con account proprio, amministratore", async () => {
  const db = setup({ access_allowlist: [
    { email: T, kind: "titolare", added_by: ADMIN }, { email: T2, kind: "titolare", added_by: ADMIN },
    { email: "del.t2@esempio.it", kind: "collaboratore", added_by: T2, profile: { perms: { cassa: "edit" } } },
    { email: C, kind: "collaboratore", added_by: T },
  ] });
  db.tables.profiles.push({ user_id: "u-solo", email: "ha.account@esempio.it" });
  db.tables.app_state.push({ user_id: "u-solo" });
  const snapshot = JSON.stringify(db.tables.access_allowlist);
  for (const email of ["del.t2@esempio.it", T2, "ha.account@esempio.it", ADMIN]) {
    const r = await call("POST", "t", { email, profile: { firstName: "Hack", perms: { cassa: "edit" } } });
    assert.equal(r.status, 409, email);
    assert.equal(r.body.error, "email_other_account", email);
    assert.match(r.body.message, /altro account|proprio account/, email);
  }
  assert.equal(JSON.stringify(db.tables.access_allowlist), snapshot, "nessuna riga toccata");
  // profilo e rimozione di un collaboratore altrui: stesso rifiuto
  assert.equal((await call("POST", "t", { email: "del.t2@esempio.it", profileOnly: true, profile: { perms: { cassa: "none" } } })).status, 409);
  const d = await call("DELETE", "t", { email: "del.t2@esempio.it" });
  assert.equal(d.status, 403);
  assert.equal((await call("DELETE", "t", { email: T2 })).status, 403);
  assert.equal(JSON.stringify(db.tables.access_allowlist), snapshot);
  // un collaboratore di T non vede né tocca l'account di T2 (la radice è T)
  const collabs = await IA.loadCollaborators(G.__stubs.admin as never);
  assert.equal(IA.rootOf(collabs, "del.t2@esempio.it"), T2);
  assert.equal(await IA.sameAccount(G.__stubs.admin as never, T, "del.t2@esempio.it"), false);
  assert.equal(await IA.sameAccount(G.__stubs.admin as never, T, C), true);
  assert.equal(await IA.sameAccount(G.__stubs.admin as never, ADMIN, "del.t2@esempio.it"), true, "l'amministratore resta libero");
});

test("l'elenco inviti (GET) mostra solo quelli del proprio account", async () => {
  const db = setup();
  db.tables.access_allowlist.push({ email: "del.t2@esempio.it", kind: "collaboratore", added_by: T2, created_at: "2026-10-03T10:00:00Z" });
  const r = await call("GET", "t");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i: Row) => i.email), [C]);
  // collaboratore con «Utenti» in sola lettura: lo vede; senza «Utenti»: no
  assert.equal((await call("GET", "c")).status, 200);
  rowOf(db, C)!.profile = { perms: { cassa: "view" } };
  assert.equal((await call("GET", "c")).status, 403);
});

// ---- annulla / rimanda ----------------------------------------------------------------------------------------------------------
test("annulla invito: toglie l'abilitazione e le condivisioni in attesa fatte da te; se si è già registrata no", async () => {
  const db = setup({ org_invites: [
    { code: "AAA", email: NEW, status: "pending", invited_by: "u-t", org_id: "o1", created_at: "2026-10-05T10:00:00Z" },
    { code: "BBB", email: NEW, status: "pending", invited_by: "u-t2", org_id: "o2" },
  ] });
  assert.equal((await call("POST", "t", invite)).status, 200);
  const d = await call("DELETE", "t", { email: NEW });
  assert.equal(d.status, 200);
  assert.equal(d.body.removed, true);
  assert.equal(rowOf(db, NEW), undefined);
  assert.deepEqual(db.tables.org_invites.map((i) => i.code), ["BBB"], "la condivisione di un altro titolare non si tocca");
  // già registrata
  const r2 = await call("DELETE", "t", { email: C });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.error, "already_member");
  assert.ok(rowOf(db, C));
  // già annullato: va bene
  assert.equal((await call("DELETE", "t", { email: NEW })).body.removed, false);
});

test("rimanda invito: l'email contiene il link /accetta-invito con il codice di CHI invia e il link di registrazione", async () => {
  setup({ org_invites: [
    { code: "ALTRO", email: NEW, status: "pending", invited_by: "u-t2", created_at: "2026-10-09T10:00:00Z" },
    { code: "MIO123", email: NEW, status: "pending", invited_by: "u-t", created_at: "2026-10-08T10:00:00Z" },
  ] });
  assert.equal((await call("POST", "t", { ...invite, notify: false })).body.notified, false, "notify:false non manda nulla");
  const sent: { to: string[]; subject: string; html: string }[] = [];
  const realFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "re_finta";
  globalThis.fetch = (async (url: string, init: { body: string }) => { if (String(url).includes("resend")) sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}) }; }) as never;
  try {
    const r = await call("POST", "t", { email: NEW, resend: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.notified, true);
  } finally { globalThis.fetch = realFetch; delete process.env.RESEND_API_KEY; }
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [NEW]);
  assert.match(sent[0].html, /https:\/\/test\.xenora\.local\/accetta-invito\?code=MIO123/);
  assert.doesNotMatch(sent[0].html, /ALTRO/);
  assert.match(sent[0].html, /login\?mode=signup&amp;email=nuova\.persona%40esempio\.it|login\?mode=signup&email=nuova\.persona%40esempio\.it/);
  assert.match(sent[0].html, /Tina Titolare/, "nome di chi invita dal profilo del token");
});

test("rimandare un invito che non esiste: errore chiaro", async () => {
  setup();
  const r = await call("POST", "t", { email: NEW, resend: true });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "invite_not_found");
});

// ---- amministratore: invariato ----------------------------------------------------------------------------------------------------
test("AMMINISTRATORE invariato: kind dal corpo/nota, upsert anche su righe altrui, elenco completo, rimozione, owner non rimovibile", async () => {
  const db = setup();
  // senza kind né nota «Utente:» → titolare (come prima)
  let r = await call("POST", "admin", { email: "cliente.nuovo@esempio.it", note: "Richiesta demo" });
  assert.equal(r.status, 200);
  assert.equal(rowOf(db, "cliente.nuovo@esempio.it")!.kind, "titolare");
  assert.equal(rowOf(db, "cliente.nuovo@esempio.it")!.added_by, ADMIN);
  // kind collaboratore dal corpo
  r = await call("POST", "admin", { email: "coll@esempio.it", kind: "collaboratore", profile: { firstName: "A", perms: { cassa: "edit" } } });
  assert.equal(rowOf(db, "coll@esempio.it")!.kind, "collaboratore");
  // nota «Utente:» → collaboratore
  await call("POST", "admin", { email: "coll2@esempio.it", note: "Utente: Mario" });
  assert.equal(rowOf(db, "coll2@esempio.it")!.kind, "collaboratore");
  // nessun controllo di appartenenza: sovrascrive anche la riga di un altro account (comportamento storico dell'amministratore)
  r = await call("POST", "admin", { email: T2, kind: "collaboratore", note: "Utente: X" });
  assert.equal(r.status, 200);
  assert.equal(rowOf(db, T2)!.kind, "collaboratore");
  // profileOnly
  r = await call("POST", "admin", { email: "coll@esempio.it", profileOnly: true, profile: { firstName: "Z" } });
  assert.equal(r.body.updated, true);
  // nessun tetto di inviti / nessun limite orario
  G.__stubs.rateLimited = true;
  assert.equal((await call("POST", "admin", { email: "x1@esempio.it" })).status, 200);
  assert.ok(!G.__stubs.limitKeys!.some((k) => k.startsWith("invite:u-admin")));
  // elenco completo
  r = await call("GET", "admin");
  assert.ok(r.body.items.length >= 6);
  // rimozione e owner non rimovibile
  assert.equal((await call("DELETE", "admin", { email: "x1@esempio.it" })).status, 200);
  assert.equal(rowOf(db, "x1@esempio.it"), undefined);
  const o = await call("DELETE", "admin", { email: "andreatringali.spi@gmail.com" });
  assert.equal(o.status, 400);
  assert.equal(o.body.error, "owner_non_rimovibile");
});

test("ADMIN_EMAILS da ambiente: un altro indirizzo diventa amministratore, il vecchio no", async () => {
  process.env.ADMIN_EMAILS = "nuovo.admin@esempio.it";
  try {
    assert.equal(IA.isAdminEmail("nuovo.admin@esempio.it"), true);
    assert.equal(IA.isAdminEmail(ADMIN), false);
  } finally { delete process.env.ADMIN_EMAILS; }
  assert.equal(IA.isAdminEmail(ADMIN), true);
});

// ---- parti pure: messaggi, stato, email --------------------------------------------------------------------------------------------
test("messaggi: un errore del server si mostra com'è; mai «solo dal titolare» quando lo si è", () => {
  assert.equal(UA.inviteFailureMessage(409, { error: "already_member", message: "X fa già parte del tuo account." }), "X fa già parte del tuo account.");
  assert.doesNotMatch(UA.inviteFailureMessage(403, {}), /solo dal titolare/);
  assert.match(UA.inviteFailureMessage(403, {}), /permesso/);
  assert.match(UA.inviteFailureMessage(401, null), /esci e rientra/);
  assert.match(UA.inviteFailureMessage(429, {}), /Troppi inviti/);
  assert.equal(UA.humanInviteError("invite_limit", "Hai già 20 inviti in attesa."), "Hai già 20 inviti in attesa.");
  assert.match(UA.humanInviteError("not_owner"), /titolare/);
});

test("stato dell'invito: inviato / email non partita / non inviato / nessuno", () => {
  const u = { id: "u-1", email: "persona@esempio.it", invitedAt: "2026-10-20T09:00:00Z" } as never;
  assert.deepEqual(UA.inviteStateOf(u, {}), { kind: "sent", at: "2026-10-20T09:00:00Z" });
  assert.deepEqual(UA.inviteStateOf({ ...(u as object), inviteMailFailed: true } as never, {}), { kind: "mail-failed", at: "2026-10-20T09:00:00Z" });
  assert.deepEqual(UA.inviteStateOf({ id: "u-2", email: "x@esempio.it" } as never, {}), { kind: "not-sent" });
  assert.deepEqual(UA.inviteStateOf({ id: "u-2", email: "x@esempio.it" } as never, { serverDates: { "x@esempio.it": "2026-09-01T00:00:00Z" } }), { kind: "sent", at: "2026-09-01T00:00:00Z" });
  assert.equal(UA.inviteStateOf(u, { lastAccess: "2026-10-21T08:00:00Z" }), null, "già entrato");
  assert.equal(UA.inviteStateOf(u, { selfEmail: "Persona@Esempio.it" }), null, "sei tu");
  assert.equal(UA.inviteStateOf({ id: "u-owner", email: "" } as never, {}), null);
  assert.equal(UA.inviteStateOf({ id: "u-3", email: "non-email" } as never, {}), null);
});

test("email d'invito: link a /accetta-invito se c'è il codice, sempre il link di registrazione; testo sanificato", () => {
  const m = NF.buildInviteEmail({ origin: "https://xenora.it/", email: "a+b@esempio.it", inviter: "<b>Mario</b>", code: "COD 1" });
  assert.equal(m.acceptLink, "https://xenora.it/accetta-invito?code=COD%201");
  assert.equal(m.signupLink, "https://xenora.it/login?mode=signup&email=a%2Bb%40esempio.it");
  assert.match(m.html, /accetta-invito\?code=COD%201/);
  assert.match(m.html, /Creane uno con questa email/);
  assert.doesNotMatch(m.html, /<b>Mario<\/b> ti ha/);
  assert.match(m.html, /&lt;b&gt;Mario&lt;\/b&gt;/);
  const n = NF.buildInviteEmail({ origin: "https://xenora.it", email: "a@esempio.it", inviter: "Mario" });
  assert.equal(n.acceptLink, null);
  assert.match(n.html, /login\?mode=signup/);
});
