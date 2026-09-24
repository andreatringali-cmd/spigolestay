import { NextResponse } from "next/server";
import { authTenant, isResponse, type AuthOk } from "@/lib/invoicing/api";
import { syncSchedine, sendReady } from "@/lib/alloggiati/service";
import { syncIstat, closeDay } from "@/lib/istat/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gate di invio REALE (identici a quelli dei servizi): senza questi flag l'azione resta "prova".
const ALLOGGIATI_LIVE = process.env.ALLOGGIATI_LIVE === "1";
const ISTAT_LIVE = process.env.ISTAT_LIVE === "1";

type StepStatus = "fatto" | "prova" | "errore" | "niente";
interface Step { key: "schedine" | "istat"; label: string; status: StepStatus; detail: string; count: number }

const today = () => new Date().toISOString().slice(0, 10);

// Conta le schedine PRONTE (arrivo già avvenuto) per una struttura — quelle realmente inviabili.
async function countSchedineReady(auth: AuthOk, structureId: string): Promise<number> {
  const { count } = await auth.admin.from("alloggiati_schedine")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", auth.tenantId).eq("structure_id", structureId)
    .eq("stato", "pronta").lte("arrival", today());
  return count ?? 0;
}
// Conta i movimenti ISTAT da inviare (arrivo già avvenuto) per una struttura.
async function countIstatPending(auth: AuthOk, structureId: string): Promise<number> {
  const { count } = await auth.admin.from("istat_rows")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", auth.tenantId).eq("structure_id", structureId)
    .eq("stato", "pending").lte("arrival", today());
  return count ?? 0;
}

// "Elabora tutto": in un'unica chiamata sincronizza (e, in confirm + gate ON, invia) gli adempimenti PA.
// La tassa di soggiorno è calcolata lato client (dati già nello store) e mostrata nello stesso riepilogo.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const mode: "prepare" | "confirm" = body?.mode === "confirm" ? "confirm" : "prepare";
    const ids = (Array.isArray(body?.structureIds) ? body.structureIds : []).map(String).filter(Boolean) as string[];

    // ── 1) SCHEDINE ALLOGGIATI ─────────────────────────────────────────────
    // Rigenera sempre le schedine dagli arrivi con check-in completo (operazione non distruttiva).
    if (ids.length) { for (const id of ids) await syncSchedine(auth.admin, auth.tenantId, { structureId: id }); }
    else await syncSchedine(auth.admin, auth.tenantId);
    const readyPerStruct = ids.length
      ? await Promise.all(ids.map((id) => countSchedineReady(auth, id)))
      : [];
    const schedReady = readyPerStruct.reduce((a, b) => a + b, 0);

    let schedStep: Step;
    if (schedReady === 0) {
      schedStep = { key: "schedine", label: "Schedine Alloggiati (Questura)", status: "niente", detail: "Nessuna schedina pronta da inviare.", count: 0 };
    } else if (mode === "confirm" && ALLOGGIATI_LIVE) {
      // Invio REALE, per struttura. sendReady applica ancora i suoi controlli interni sulle credenziali.
      let sent = 0; const errs: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (readyPerStruct[i] === 0) continue;
        try { const r = await sendReady(auth.admin, auth.tenantId, ids[i]); sent += r.sent; if (!r.ok && r.message) errs.push(r.message); }
        catch (e) { errs.push((e as Error)?.message ?? "errore invio"); }
      }
      schedStep = {
        key: "schedine", label: "Schedine Alloggiati (Questura)",
        status: errs.length && sent === 0 ? "errore" : "fatto",
        detail: `Inviate ${sent} schedine alla Questura${errs.length ? ` · ${errs.join(" · ")}` : ""}.`, count: sent,
      };
    } else {
      // Prova: gate OFF oppure fase di preparazione → NON viene inviato nulla davvero.
      schedStep = {
        key: "schedine", label: "Schedine Alloggiati (Questura)", status: "prova",
        detail: ALLOGGIATI_LIVE
          ? `${schedReady} schedine pronte: verranno inviate alla conferma.`
          : `${schedReady} schedine pronte (prova): invio reale non attivo, nulla è stato inviato.`,
        count: schedReady,
      };
    }

    // ── 2) MOVIMENTI ISTAT / Turist@t ──────────────────────────────────────
    // Rigenera sempre i movimenti dagli arrivi (non distruttivo).
    if (ids.length) { for (const id of ids) await syncIstat(auth.admin, auth.tenantId, { structureId: id }); }
    else await syncIstat(auth.admin, auth.tenantId);
    const istatPerStruct = ids.length
      ? await Promise.all(ids.map((id) => countIstatPending(auth, id)))
      : [];
    const istatPending = istatPerStruct.reduce((a, b) => a + b, 0);

    let istatStep: Step;
    if (istatPending === 0) {
      istatStep = { key: "istat", label: "Movimenti ISTAT (Turist@t)", status: "niente", detail: "Nessun movimento da inviare.", count: 0 };
    } else if (mode === "confirm" && ISTAT_LIVE) {
      let sent = 0; const errs: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (istatPerStruct[i] === 0) continue;
        try { const r = await closeDay(auth.admin, auth.tenantId, ids[i]); sent += r.sent; if (!r.ok && r.message) errs.push(r.message); }
        catch (e) { errs.push((e as Error)?.message ?? "errore chiusura"); }
      }
      istatStep = {
        key: "istat", label: "Movimenti ISTAT (Turist@t)",
        status: errs.length && sent === 0 ? "errore" : "fatto",
        detail: `Inviati ${sent} movimenti al portale${errs.length ? ` · ${errs.join(" · ")}` : ""}.`, count: sent,
      };
    } else {
      // ISTAT è ancora in attesa delle API dell'Osservatorio: resta sempre in prova (dry-run).
      istatStep = {
        key: "istat", label: "Movimenti ISTAT (Turist@t)", status: "prova",
        detail: ISTAT_LIVE
          ? `${istatPending} movimenti pronti: verranno inviati alla conferma.`
          : `${istatPending} movimenti generati (prova): invio reale non attivo, nulla è stato inviato.`,
        count: istatPending,
      };
    }

    return NextResponse.json({
      ok: true,
      mode,
      live: { alloggiati: ALLOGGIATI_LIVE, istat: ISTAT_LIVE },
      steps: [schedStep, istatStep],
    });
  } catch (e) {
    return NextResponse.json({ error: "run_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
