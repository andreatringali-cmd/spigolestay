import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import type { ConciergeEntry } from "@/lib/concierge-kb";
import { isTranslateLang, srcHashOf, validateTranslation, type TranslationItem } from "@/lib/concierge-i18n";
import { approveTranslations, loadTranslations, putTranslations, removeTranslation } from "@/lib/concierge-translations";
import { translateBlock } from "@/lib/ai/concierge-translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Traduzione della base di conoscenza del Concierge in de/fr/es. Le traduzioni NON vanno in concierge_entries (CHECK lang it/en):
// stanno nel blob app_state del tenant (src/lib/concierge-translations.ts). Nessun invio a nessuno: solo AI + salvataggio.
//   { action: "status" }                          -> { ok, items }
//   { action: "run", lang, ids: string[] }        -> traduce un BLOCCO di voci (max 6), valida, salva come "da rivedere"
//                                                    { ok, results: [{ id, ok, error? }], saved: TranslationItem[] }
//   { action: "save", id, lang, title, body }     -> modifica a mano (validata sull'originale), salva come rivista
//   { action: "approve", keys: [{id, lang}] }     -> segna come riviste (riallinea l'impronta all'originale attuale)
//   { action: "remove", id, lang }                -> elimina la traduzione (tornerà "mancante")
const MAX_IDS = 6;

type Row = ConciergeEntry & { id: string };

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b?.action || "status");

    if (action === "status") {
      return NextResponse.json({ ok: true, items: await loadTranslations(auth.admin, auth.tenantId) });
    }

    // Voci originali del tenant (fonte di verità per impronta e controlli).
    const loadRows = async (ids: string[]): Promise<Map<string, Row>> => {
      const { data } = await auth.admin.from("concierge_entries").select("*").eq("tenant_id", auth.tenantId).in("id", ids);
      return new Map(((data ?? []) as Row[]).map((r) => [r.id, r]));
    };
    const ids = (Array.isArray(b?.ids) ? b.ids : []).map((x: unknown) => String(x));

    if (action === "run") {
      const lang = b?.lang;
      if (!isTranslateLang(lang)) return NextResponse.json({ ok: false, error: "bad_lang" }, { status: 400 });
      const want = Array.from(new Set<string>(ids)).slice(0, MAX_IDS);
      if (!want.length) return NextResponse.json({ ok: false, error: "missing_ids" }, { status: 400 });
      const rows = await loadRows(want);
      const found = want.filter((id) => rows.has(id));
      const results: { id: string; ok: boolean; error?: string }[] = want.filter((id) => !rows.has(id)).map((id) => ({ id, ok: false, error: "voce non trovata (eliminata?)" }));
      if (!found.length) return NextResponse.json({ ok: true, results, saved: [] });

      const out = await translateBlock(lang, found.map((id) => {
        const r = rows.get(id)!;
        return { id, title: r.title, body: r.body, auto: r.field_type === "auto", srcLang: r.lang };
      }));
      if (!out.ok) {
        const msg = out.error === "ai_not_configured" ? "AI non configurata (manca ANTHROPIC_API_KEY)" : `errore AI (${out.error})`;
        return NextResponse.json({ ok: false, error: out.error, message: msg }, { status: out.error === "ai_not_configured" ? 503 : 502 });
      }
      const toSave: TranslationItem[] = [];
      const now = Date.now();
      for (const id of found) {
        const r = rows.get(id)!;
        const t = out.items.get(id);
        if (!t) { results.push({ id, ok: false, error: "l'AI non ha restituito questa voce" }); continue; }
        const v = validateTranslation(r, t);
        if (!v.ok) { results.push({ id, ok: false, error: `scartata: ${v.errors.join("; ")}` }); continue; }
        toSave.push({ id, lang, title: t.title, body: t.body, ts: now, reviewed: false, srcHash: srcHashOf(r), srcLang: r.lang });
        results.push({ id, ok: true });
      }
      const saved = await putTranslations(auth.admin, auth.tenantId, toSave);
      if (!saved) return NextResponse.json({ ok: false, error: "save_failed", message: "Salvataggio non riuscito, riprova" }, { status: 500 });
      return NextResponse.json({ ok: true, results, saved: toSave });
    }

    if (action === "save") {
      const id = String(b?.id || ""), lang = b?.lang;
      if (!id || !isTranslateLang(lang)) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
      const rows = await loadRows([id]);
      const r = rows.get(id);
      if (!r) return NextResponse.json({ ok: false, error: "not_found", message: "Voce originale non trovata" }, { status: 404 });
      const title = String(b?.title ?? "").trim().slice(0, 200), body = String(b?.body ?? "").trim().slice(0, 4000);
      const v = validateTranslation(r, { title, body });
      if (!v.ok) return NextResponse.json({ ok: false, error: "invalid_translation", message: `Controlla il testo: ${v.errors.join("; ")}` }, { status: 422 });
      const item: TranslationItem = { id, lang, title, body, ts: Date.now(), reviewed: true, srcHash: srcHashOf(r), srcLang: r.lang };
      if (!(await putTranslations(auth.admin, auth.tenantId, [item]))) return NextResponse.json({ ok: false, error: "save_failed", message: "Salvataggio non riuscito, riprova" }, { status: 500 });
      return NextResponse.json({ ok: true, saved: [item] });
    }

    if (action === "approve") {
      const keys = (Array.isArray(b?.keys) ? b.keys : []).map((k: { id?: unknown; lang?: unknown }) => ({ id: String(k?.id || ""), lang: String(k?.lang || "") }))
        .filter((k: { id: string; lang: string }) => k.id && isTranslateLang(k.lang)).slice(0, 500);
      if (!keys.length) return NextResponse.json({ ok: true, saved: [] });
      const rows = await loadRows(Array.from(new Set<string>(keys.map((k: { id: string }) => k.id))));
      const hashes = new Map(Array.from(rows.values()).map((r) => [r.id, srcHashOf(r)] as const));
      const saved = await approveTranslations(auth.admin, auth.tenantId, keys, hashes);
      return NextResponse.json({ ok: true, saved });
    }

    if (action === "remove") {
      const id = String(b?.id || ""), lang = b?.lang;
      if (!id || !isTranslateLang(lang)) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
      return NextResponse.json({ ok: await removeTranslation(auth.admin, auth.tenantId, id, lang) });
    }

    return NextResponse.json({ ok: false, error: "bad_action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "translate_failed", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
