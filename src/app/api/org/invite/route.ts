import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Invito di un socio a co-gestire una struttura.
//  1) verifica l'utente chiamante (proprietario della struttura);
//  2) se la struttura non è ancora condivisa: crea un'organizzazione + membership (owner) e
//     MIGRA la struttura (con camere/tipologie/prenotazioni/ospiti citati/tariffe) da app_state a org_state;
//  3) crea un invito (codice) e invia l'email al socio con il link per accettare.
// Usa il service role lato server (mai esposto al browser).

const DATA_KEY = "spigolestay:data:v1";
const FROM = process.env.RESEND_FROM || "onboarding@resend.dev";
const RESEND = process.env.RESEND_API_KEY || "";

type J = Record<string, unknown>;
const arr = (x: unknown): J[] => (Array.isArray(x) ? (x as J[]) : []);
const esc = (s: unknown) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c));

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const structureId = String(body?.structureId || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    if (!structureId) return NextResponse.json({ error: "missing_structure", message: "Struttura mancante." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "invalid_email", message: "Email non valida." }, { status: 400 });

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (whoErr || !caller?.id) return NextResponse.json({ error: "unauthorized", message: "Sessione non valida, esci e rientra." }, { status: 401 });
    if (caller.email && caller.email.toLowerCase() === email) return NextResponse.json({ error: "self_invite" }, { status: 400 });

    // REGOLA DI SICUREZZA: si può invitare SOLO un'email già registrata su Xenora.
    // Così non si invita per errore un indirizzo sbagliato/non registrato (che, registrandosi
    // dopo, potrebbe entrare nella struttura). Il socio deve prima creare l'account con quell'email.
    const { data: prof } = await admin.from("profiles").select("user_id").ilike("email", email).maybeSingle();
    if (!prof?.user_id) {
      return NextResponse.json({ error: "email_not_registered", message: `L'email ${email} non è registrata su Xenora. Il socio deve prima creare un account con questa email, poi potrai invitarlo.` }, { status: 400 });
    }

    // Carica lo stato del chiamante e trova la struttura.
    const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", caller.id).maybeSingle();
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    let d: J = {};
    try { d = JSON.parse(blob[DATA_KEY] || "{}") as J; } catch { d = {}; }
    const structures = arr(d.structures);
    let S = structures.find((s) => s?.id === structureId) as J | undefined;
    let orgId = (S?.orgId as string) || "";

    // Struttura NON nel personale: forse è già condivisa (in org_state). Trova l'org di cui il
    // chiamante è membro che contiene questa struttura, così può invitare un altro socio.
    if (!S) {
      const { data: mships } = await admin.from("memberships").select("org_id").eq("user_id", caller.id);
      for (const m of arr(mships)) {
        const oid = m.org_id as string;
        const { data: os } = await admin.from("org_state").select("data").eq("org_id", oid).maybeSingle();
        let od: J = {}; try { od = JSON.parse(((os?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as J; } catch { od = {}; }
        const found = arr(od.structures).find((s) => s?.id === structureId) as J | undefined;
        if (found) { S = found; orgId = oid; break; }
      }
    }
    if (!S) return NextResponse.json({ error: "structure_not_found", message: "Struttura non trovata nel tuo account. Ricarica la pagina e riprova." }, { status: 404 });

    // Prima condivisione: crea org + membership owner e migra la struttura in org_state.
    if (!orgId) {
      const { data: org, error: orgErr } = await admin.from("organizations")
        .insert({ name: (S.name as string) || "Struttura condivisa", owner_id: caller.id }).select("id").single();
      if (orgErr || !org?.id) return NextResponse.json({ error: "org_create_failed", message: orgErr?.message }, { status: 500 });
      orgId = org.id as string;
      await admin.from("memberships").insert({ org_id: orgId, user_id: caller.id, role: "owner" });

      // Estrai la struttura e tutto ciò che le appartiene.
      const roomTypes = arr(d.roomTypes);
      const units = arr(d.units);
      const bookings = arr(d.bookings);
      const guests = arr(d.guests);
      const ro = (d.rateOverrides && typeof d.rateOverrides === "object") ? d.rateOverrides as Record<string, number> : {};

      const rtOfStruct = new Set(roomTypes.filter((rt) => rt?.structureId === structureId).map((rt) => rt.id as string));
      const orgStruct = { ...S, orgId };
      const orgRoomTypes = roomTypes.filter((rt) => rt?.structureId === structureId);
      const orgUnits = units.filter((u) => u?.structureId === structureId);
      const orgBookings = bookings.filter((b) => b?.structureId === structureId);
      const orgGuestIds = new Set(orgBookings.map((b) => b.guestId as string).filter(Boolean));
      const orgGuests = guests.filter((g) => orgGuestIds.has(g.id as string));
      const orgRates: Record<string, number> = {};
      for (const [k, v] of Object.entries(ro)) { const rtId = k.includes("|") ? k.split("|")[0] : ""; if (rtId && rtOfStruct.has(rtId)) orgRates[k] = v; }

      const orgData = { structures: [orgStruct], roomTypes: orgRoomTypes, units: orgUnits, bookings: orgBookings, guests: orgGuests, rateOverrides: orgRates };
      const { error: osErr } = await admin.from("org_state").insert({ org_id: orgId, data: { [DATA_KEY]: JSON.stringify(orgData) } });
      if (osErr) return NextResponse.json({ error: "org_state_failed", message: osErr.message }, { status: 500 });

      // Rimuovi la struttura (e ciò che le appartiene) dal personale del chiamante.
      d.structures = structures.filter((s) => s?.id !== structureId);
      d.roomTypes = roomTypes.filter((rt) => rt?.structureId !== structureId);
      d.units = units.filter((u) => u?.structureId !== structureId);
      d.bookings = bookings.filter((b) => b?.structureId !== structureId);
      const restRates: Record<string, number> = {};
      for (const [k, v] of Object.entries(ro)) { const rtId = k.includes("|") ? k.split("|")[0] : ""; if (!(rtId && rtOfStruct.has(rtId))) restRates[k] = v; }
      d.rateOverrides = restRates;
      // (gli ospiti restano nel personale: sono globali)
      blob[DATA_KEY] = JSON.stringify(d);
      await admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", caller.id);
    }

    // Crea l'invito.
    const code = (globalThis.crypto?.randomUUID?.() ?? `inv_${Date.now()}`).replace(/-/g, "").slice(0, 24);
    await admin.from("org_invites").insert({
      org_id: orgId, structure_id: structureId, structure_name: (S.name as string) || "",
      email, code, invited_by: caller.id, inviter_email: caller.email ?? null, status: "pending",
    });

    // Invia l'email con il link per accettare.
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const link = `${origin}/accetta-invito?code=${code}`;
    let emailSent = false;
    if (RESEND) {
      const inviter = caller.email || "un collega";
      const html = `<!doctype html><html lang="it"><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
      <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
        <div style="background:#fff;border-radius:16px;border:1px solid #e6e8ec;overflow:hidden;">
          <div style="background:#285f92;padding:20px 24px;color:#fff;font-weight:700;">Invito a co-gestire una struttura</div>
          <div style="padding:24px;font-size:14px;line-height:1.6;">
            <p style="margin:0 0 12px;"><b>${esc(inviter)}</b> ti invita a gestire insieme la struttura <b>${esc(S.name)}</b> su Xenora.</p>
            <p style="margin:0 0 18px;color:#4b5563;">Accettando, la struttura comparirà nel tuo account e potrete gestirla entrambi (calendario, tariffe, prenotazioni).</p>
            <div style="margin:22px 0 6px;"><a href="${esc(link)}" style="display:block;text-align:center;background:#285f92;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:10px;">Accetta l'invito →</a></div>
            <p style="margin:12px 0 0;font-size:12px;color:#9aa1ac;">Se non ti aspettavi questo invito, ignora questa email. Accetta accedendo con l'email ${esc(email)}.</p>
          </div>
        </div>
        <div style="text-align:center;color:#9aa1ac;font-size:11px;margin-top:14px;">Inviato con Xenora · Digital Solution</div>
      </div></body></html>`;
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: `Xenora <${FROM}>`, to: [email], subject: `${inviter} ti invita a gestire ${S.name} su Xenora`, html, ...(caller.email ? { reply_to: caller.email } : {}) }),
        });
        emailSent = r.ok;
      } catch { emailSent = false; }
    }

    return NextResponse.json({ ok: true, orgId, link, emailSent });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
