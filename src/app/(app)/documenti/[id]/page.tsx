"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { eur } from "@/lib/format";
import { invPost, centsEur, DOC_KIND_LABEL, STATO } from "@/lib/invoicing/client";

interface Doc { id: string; tenant_id: string; structure_id: string | null; booking_id: string | null; booking_code: string | null;
  doc_kind: string; sdi_type: string; regime: string | null; number_label: string | null; stato: string; issue_date: string | null;
  due_date: string | null; payment_method: string | null; vat_exigibility: string | null; notes: string | null;
  counterpart: Record<string, string> | null; taxable_cents: number; vat_cents: number; out_of_scope_cents: number;
  bollo_cents: number; total_cents: number; advance_cents: number; send_sdi: boolean; provider: string | null; provider_ref: string | null; }
interface Line { id: string; pos: number; description: string; qty: number; vat_rate: number; vat_nature: string | null; line_total_cents: number }
interface Ev { id: string; ts: string; kind: string; message: string }
interface Pay { id: string; amount_cents: number; method: string | null; paid_at: string; note: string | null }

export default function DocumentoPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const id = String(params.id || "");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const [d, l, e, p] = await Promise.all([
      supabase.from("documents").select("*").eq("id", id).maybeSingle(),
      supabase.from("document_lines").select("*").eq("document_id", id).order("pos"),
      supabase.from("document_events").select("*").eq("document_id", id).order("ts", { ascending: false }),
      supabase.from("document_payments").select("*").eq("document_id", id).order("paid_at"),
    ]);
    setDoc((d.data ?? null) as Doc | null);
    setLines((l.data ?? []) as Line[]);
    setEvents((e.data ?? []) as Ev[]);
    setPays((p.data ?? []) as Pay[]);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg("");
    try { await fn(); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };
  const issue = () => act("issue", async () => { await invPost("issue", { documentId: id }); });
  const send = () => act("send", async () => { const r = await invPost<{ message?: string }>("send", { documentId: id }); if (r.message) setMsg(r.message); });
  const refresh = () => act("status", async () => { const r = await invPost<{ message?: string }>("status", { documentId: id }); if (r.message) setMsg(r.message); });
  const downloadXml = () => act("xml", async () => {
    const r = await invPost<{ xml: string }>("xml", { documentId: id });
    const blob = new Blob([r.xml], { type: "application/xml" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${(doc?.number_label ?? id).replace(/[^\w-]/g, "_")}.xml`; a.click(); URL.revokeObjectURL(a.href);
  });

  const paid = pays.reduce((a, p) => a + p.amount_cents, 0);
  const residuo = (doc?.total_cents ?? 0) - paid;

  const addPayment = async (amountCents: number, method: string) => {
    if (!supabase || !user || amountCents <= 0) return;
    await act("pay", async () => {
      const { error } = await supabase!.from("document_payments").insert({ document_id: id, tenant_id: user.id, amount_cents: amountCents, method });
      if (error) throw new Error(error.message);
      await supabase!.from("document_events").insert({ tenant_id: user.id, document_id: id, kind: "payment", message: `Incasso registrato ${eur(centsEur(amountCents))}` });
    });
  };

  if (loading) return <div className="p-6 text-sm text-faint">Caricamento…</div>;
  if (!doc) return <div className="p-6 text-sm text-faint">Documento non trovato. <button onClick={() => router.push("/documenti")} className="font-semibold text-focus hover:underline">Torna ai documenti</button></div>;

  const st = STATO[doc.stato] ?? { label: doc.stato, color: "var(--dim)" };
  const frozen = doc.stato !== "bozza";
  const cp = doc.counterpart ?? {};

  return (
    <div>
      <PageHeader title={`${DOC_KIND_LABEL[doc.doc_kind] ?? "Documento"} ${doc.number_label ?? "(bozza)"}`}
        subtitle={doc.booking_code ? `Prenotazione ${doc.booking_code}` : undefined}
        actions={<button onClick={() => router.push("/documenti")} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">← Documenti</button>} />

      {frozen && (
        <div className="mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white" style={{ backgroundColor: "var(--err)" }}>
          🔒 Le informazioni fiscali di questo documento non sono più modificabili (documento {st.label.toLowerCase()}). Per correggere si emette una nota di credito.
        </div>
      )}
      {msg && <Card className="mb-4"><p className="text-sm text-dim">{msg}</p></Card>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stato + timeline */}
        <Card>
          <div className="mb-2 flex items-center justify-between"><SectionTitle>Stato</SectionTitle>
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</span>
          </div>
          <div className="flex flex-col gap-2">
            {events.map((e) => (
              <div key={e.id} className="flex gap-2 text-sm">
                <span className="w-28 shrink-0 text-[11px] text-faint">{new Date(e.ts).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-txt">{e.message}</span>
              </div>
            ))}
            {events.length === 0 && <p className="text-sm text-faint">Nessun evento.</p>}
          </div>
        </Card>

        {/* Voci */}
        <Card>
          <SectionTitle>Voci del documento</SectionTitle>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="py-1.5 pr-2 font-semibold">Descrizione</th><th className="py-1.5 px-2 text-right font-semibold">Q.tà</th><th className="py-1.5 px-2 text-right font-semibold">IVA</th><th className="py-1.5 pl-2 text-right font-semibold">Totale</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2 text-txt">{l.description}</td>
                    <td className="py-2 px-2 text-right font-mono text-dim">{Number(l.qty)}</td>
                    <td className="py-2 px-2 text-right font-mono text-dim">{l.vat_nature ? l.vat_nature : `${Number(l.vat_rate)}%`}</td>
                    <td className="py-2 pl-2 text-right font-mono text-txt">{eur(centsEur(l.line_total_cents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between"><span className="text-dim">Imponibile</span><span className="font-mono text-txt">{eur(centsEur(doc.taxable_cents))}</span></div>
            <div className="flex justify-between"><span className="text-dim">IVA</span><span className="font-mono text-txt">{eur(centsEur(doc.vat_cents))}</span></div>
            {doc.out_of_scope_cents > 0 && <div className="flex justify-between"><span className="text-dim">Tassa di soggiorno (fuori campo IVA)</span><span className="font-mono text-txt">{eur(centsEur(doc.out_of_scope_cents))}</span></div>}
            {doc.bollo_cents > 0 && <div className="flex justify-between"><span className="text-dim">Bollo</span><span className="font-mono text-txt">{eur(centsEur(doc.bollo_cents))}</span></div>}
            <div className="flex justify-between border-t border-line pt-1 text-base font-bold"><span>Totale</span><span className="font-mono">{eur(centsEur(doc.total_cents))}</span></div>
          </div>
        </Card>

        {/* Intestatario */}
        <Card>
          <SectionTitle>Intestatario</SectionTitle>
          <div className="mt-2 space-y-1 text-sm">
            <div className="font-semibold text-txt">{cp.name ?? "—"}</div>
            <div className="text-dim">{cp.kind === "societa" ? "Società" : cp.kind === "estero" ? "Estero" : cp.kind === "ota" ? "OTA" : "Privato"}</div>
            {cp.vat && <div className="text-dim">P.IVA {cp.vat}</div>}
            {cp.tax_code && <div className="text-dim">CF {cp.tax_code}</div>}
            {(cp.address || cp.city) && <div className="text-dim">{[cp.address, cp.cap, cp.city, cp.province].filter(Boolean).join(" ")}</div>}
            <div className="text-faint">Codice destinatario: {cp.sdi_code || "0000000"}{cp.pec ? ` · PEC ${cp.pec}` : ""}</div>
          </div>
        </Card>

        {/* Incassi */}
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle>Registra gli incassi</SectionTitle>
            {residuo > 0
              ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>Residuo {eur(centsEur(residuo))}</span>
              : <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>Incassato ✓</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            {pays.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-2 text-sm">
                <span className="text-dim">{new Date(p.paid_at).toLocaleDateString("it-IT")} · {p.method ?? "—"}</span>
                <span className="font-mono text-txt">{eur(centsEur(p.amount_cents))}</span>
              </div>
            ))}
            {pays.length === 0 && <p className="text-sm text-faint">Nessun incasso registrato.</p>}
          </div>
          {residuo > 0 && (
            <button onClick={() => addPayment(residuo, "manuale")} disabled={!!busy} className="mt-2 rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "pay" ? "…" : `Incassa tutto (${eur(centsEur(residuo))})`}</button>
          )}
        </Card>
      </div>

      {/* Barra azioni */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        {doc.stato === "bozza" && <button onClick={issue} disabled={!!busy} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "issue" ? "Emissione…" : "Emetti documento"}</button>}
        {doc.stato === "emessa" && doc.send_sdi && <button onClick={send} disabled={!!busy} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "send" ? "Invio…" : "Invia allo SdI"}</button>}
        {doc.stato === "inviata_intermediario" && <button onClick={refresh} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "status" ? "Controllo…" : "Aggiorna esito"}</button>}
        {doc.provider_ref && <button onClick={downloadXml} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "xml" ? "…" : "Scarica XML"}</button>}
        <span className="ml-auto text-[11px] text-faint">Regime: {doc.regime ?? "—"} · {doc.send_sdi ? "invio SDI attivo" : "no SDI"}</span>
      </div>
    </div>
  );
}
