"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { toISO, parseISO } from "@/lib/dates";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";
import { type Promo, loadPromos, savePromos, newPromoId, applyPromo, promoMailto } from "@/lib/promos";

type Segment = "consenso" | "abituali" | "lapsed" | "tutti";
interface SendLog { id: string; promoName: string; date: string; recipients: number; segment: Segment; }

const SEGMENTS: { key: Segment; label: string; desc: string }[] = [
  { key: "lapsed", label: "Da ricontattare", desc: "Non tornano da oltre 10 mesi" },
  { key: "abituali", label: "Ospiti abituali", desc: "Più di un soggiorno" },
  { key: "consenso", label: "Con consenso marketing", desc: "Hanno dato il consenso" },
  { key: "tutti", label: "Tutti con email", desc: "Chiunque abbia un'email" },
];
const fmtD = (iso: string) => { try { return parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }); } catch { return iso; } };
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

export default function PromozioniPage() {
  const { guests, bookings, structures } = useData();
  const today = toISO(new Date());
  const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  // ── Libreria promo (salvate) ──
  const [promos, setPromos] = useState<Promo[]>([]);
  const [logs, setLogs] = useState<SendLog[]>([]);
  useEffect(() => { setPromos(loadPromos()); try { const r = localStorage.getItem("spigolestay:promolog"); if (r) setLogs(JSON.parse(r)); } catch {} }, []);
  const persistPromos = (n: Promo[]) => { setPromos(n); savePromos(n); };
  const persistLogs = (n: SendLog[]) => { setLogs(n); try { localStorage.setItem("spigolestay:promolog", JSON.stringify(n)); } catch {} };

  // ── Editor promo ──
  const empty = { name: "", subject: "Un'offerta speciale per te 🌊", discount: 15, code: "BENTORNATO15", body: "Ciao {nome},\nci piacerebbe riaverti come nostro ospite! Prenota direttamente e approfitta del {sconto}% di sconto con il codice {codice}.\nOfferta valida fino al {scadenza}.\nTi aspettiamo a Siracusa. ☀️\n\nA presto,\nAndrea e Agreta\n{struttura}\n{contatti}" };
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState(empty.name);
  const [subject, setSubject] = useState(empty.subject);
  const [discount, setDiscount] = useState(empty.discount);
  const [code, setCode] = useState(empty.code);
  const [validUntil, setValidUntil] = useState("");
  const [body, setBody] = useState(empty.body);

  const resetEditor = () => { setEditId(null); setName(""); setSubject(empty.subject); setDiscount(empty.discount); setCode(empty.code); setValidUntil(""); setBody(empty.body); };
  const savePromo = () => {
    if (!name.trim() && !subject.trim()) return;
    const data = { name: name.trim() || subject.trim(), subject: subject.trim(), body, discountPct: discount || undefined, code: code.trim() || undefined, validUntil: validUntil || undefined };
    if (editId) persistPromos(promos.map((p) => (p.id === editId ? { ...p, ...data } : p)));
    else persistPromos([{ id: newPromoId(), ...data, createdAt: today }, ...promos]);
    resetEditor();
  };
  const editPromo = (p: Promo) => { setEditId(p.id); setName(p.name); setSubject(p.subject); setDiscount(p.discountPct ?? 0); setCode(p.code ?? ""); setValidUntil(p.validUntil ?? ""); setBody(p.body); if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); };
  const dupPromo = (p: Promo) => persistPromos([{ ...p, id: newPromoId(), name: `${p.name} (copia)`, createdAt: today }, ...promos]);
  const delPromo = (id: string) => { persistPromos(promos.filter((p) => p.id !== id)); if (editId === id) resetEditor(); };

  const contactsOf = (s?: { phone?: string; email?: string; website?: string }) => [s?.phone, s?.email, s?.website].filter(Boolean).join(" · ");
  const defaultStruct = structures[0];
  const previewBody = applyPromo(body, { nome: "Marco", sconto: discount, codice: code || "—", scadenza: validUntil ? new Date(validUntil).toLocaleDateString("it-IT") : "—", struttura: defaultStruct?.name ?? "", contatti: contactsOf(defaultStruct) });

  // ── Invio (separato) ──
  const [sending, setSending] = useState<Promo | null>(null);
  const [segment, setSegment] = useState<Segment>("lapsed");
  const [structureId, setStructureId] = useState<string>("all");

  const audience = useMemo(() => {
    const withStruct = (gid: string) => structureId === "all" || bookings.some((b) => b.guestId === gid && b.structureId === structureId);
    return guests.filter((g) => {
      if (!g.email || !withStruct(g.id)) return false;
      const list = bookings.filter((b) => b.guestId === g.id && b.status !== "cancelled" && b.channel !== "blocked");
      const last = list.reduce((m, b) => (b.checkIn > m ? b.checkIn : m), "");
      switch (segment) {
        case "consenso": return !!g.marketingConsent;
        case "abituali": return list.length > 1;
        case "lapsed": return !!last && daysAgo(last) > 300;
        default: return true;
      }
    });
  }, [guests, bookings, segment, structureId]);

  const usedThisYear = logs.filter((l) => new Date(l.date).getFullYear() === new Date().getFullYear()).length;
  const limitReached = usedThisYear >= 4;

  const doSend = () => {
    if (!sending || audience.length === 0 || limitReached) return;
    const emails = audience.map((g) => g.email!).filter(Boolean);
    const st = structureId === "all" ? structures[0] : structures.find((s) => s.id === structureId);
    window.open(promoMailto(emails, sending, { struttura: st?.name, contatti: contactsOf(st) }), "_blank");
    persistLogs([{ id: newPromoId(), promoName: sending.name, date: today, recipients: emails.length, segment }, ...logs]);
    setSending(null);
  };

  return (
    <div>
      <PageHeader title="Promozioni" subtitle="Crea le tue promo, salvale e inviale quando vuoi · max 4 invii l'anno" />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {([["Promo salvate", String(promos.length)], ["Invii quest'anno", `${usedThisYear}/4`], ["Destinatari 'da ricontattare'", String(guests.filter((g) => { if (!g.email) return false; const list = bookings.filter((b) => b.guestId === g.id && b.status !== "cancelled"); const last = list.reduce((m, b) => (b.checkIn > m ? b.checkIn : m), ""); return !!last && daysAgo(last) > 300; }).length)], ["Ospiti con email", String(guests.filter((g) => g.email).length)]] as [string, string][]).map(([lab, val]) => (
          <div key={lab} className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm">
            <div className="text-[10px] font-medium uppercase tracking-wide text-faint">{lab}</div>
            <div className="font-mono text-lg font-bold leading-tight text-txt">{val}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Editor: crea/salva (nessun invio qui) */}
        <Card>
          <SectionTitle>{editId ? "Modifica promo" : "Nuova promo"}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 block text-xs font-medium text-dim">Nome promo *<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Promo primavera" className={`${inp} mt-1`} /></label>
            <label className="col-span-2 block text-xs font-medium text-dim">Oggetto email<input value={subject} onChange={(e) => setSubject(e.target.value)} className={`${inp} mt-1`} /></label>
            <label className="block text-xs font-medium text-dim">Sconto %<input type="number" min={0} max={90} value={discount} onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))} className={`${inp} mt-1`} /></label>
            <label className="block text-xs font-medium text-dim">Codice promo<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${inp} mt-1`} /></label>
            <label className="col-span-2 block text-xs font-medium text-dim">Scadenza offerta<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={`${inp} mt-1`} /></label>
            <label className="col-span-2 block text-xs font-medium text-dim">Messaggio <span className="font-normal text-faint">· {"{nome}"} {"{sconto}"} {"{codice}"} {"{scadenza}"} {"{struttura}"} {"{contatti}"}</span><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className={`${inp} mt-1 resize-y`} /></label>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-4">
            {editId && <button onClick={resetEditor} className="mr-auto rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash">Annulla modifica</button>}
            <button onClick={savePromo} disabled={!name.trim() && !subject.trim()} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{editId ? "Salva modifiche" : "Salva promo"}</button>
          </div>
          <p className="mt-3 text-[11px] text-faint">Qui crei e salvi la promo. L'invio è separato: lo fai dalla libreria qui sotto (a un segmento) o dalla pagina Ospiti (selezione multipla / singolo ospite).</p>
        </Card>

        {/* Anteprima */}
        <Card className="flex flex-col">
          <SectionTitle>Anteprima email</SectionTitle>
          <div className="flex-1 rounded-xl border border-line bg-wash p-4">
            <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <div className="text-sm font-bold text-txt">{subject || "—"}</div>
              {discount > 0 && <div className="my-3 inline-block rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 12%, transparent)", color: "var(--focus)" }}>-{discount}% · codice {code || "—"}</div>}
              <div className="whitespace-pre-wrap text-sm text-txt">{previewBody}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Promo salvate */}
      <div className="mt-6">
        <SectionTitle>Promo salvate ({promos.length})</SectionTitle>
        {promos.length === 0 ? (
          <Card className="py-8 text-center text-sm text-faint">Nessuna promo salvata. Creane una qui sopra e salvala per riutilizzarla.</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {promos.map((p) => (
              <div key={p.id} className="flex flex-col rounded-xl border border-line bg-surface p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="truncate font-bold text-txt">{p.name}</div><div className="truncate text-[11px] text-faint">{p.subject}</div></div>
                  {p.discountPct ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>-{p.discountPct}%</span> : null}
                </div>
                <p className="mt-1.5 line-clamp-2 flex-1 text-xs text-dim">{p.body}</p>
                <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
                  <button onClick={() => setSending(p)} className="flex items-center gap-1 rounded-lg bg-focus px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"><Icon name="mail" size={13} /> Invia</button>
                  <button onClick={() => editPromo(p)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-dim hover:bg-wash">Modifica</button>
                  <button onClick={() => dupPromo(p)} title="Duplica" className="rounded-lg border border-line px-2 py-1.5 text-xs text-dim hover:bg-wash"><Icon name="copy" size={13} /></button>
                  <button onClick={() => delPromo(p.id)} title="Elimina" className="ml-auto rounded-lg px-2 py-1.5 text-xs text-faint hover:text-[color:var(--err)]">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Storico invii */}
      {logs.length > 0 && (
        <div className="mt-6">
          <SectionTitle>Invii ({logs.length})</SectionTitle>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-line bg-wash text-left text-[11px] uppercase tracking-wide text-faint"><th className="px-3 py-2 font-semibold">Promo</th><th className="px-3 py-2 font-semibold">Segmento</th><th className="px-3 py-2 font-semibold">Destinatari</th><th className="px-3 py-2 font-semibold">Data</th><th className="px-3 py-2"></th></tr></thead>
              <tbody>{logs.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium text-txt">{l.promoName}</td>
                  <td className="px-3 py-2 text-dim">{SEGMENTS.find((s) => s.key === l.segment)?.label}</td>
                  <td className="px-3 py-2 font-mono text-txt">{l.recipients}</td>
                  <td className="px-3 py-2 text-dim">{fmtD(l.date)}</td>
                  <td className="px-3 py-2 text-right"><button onClick={() => persistLogs(logs.filter((x) => x.id !== l.id))} className="text-faint hover:text-[color:var(--err)]">✕</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modale invio */}
      {sending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setSending(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><span className="font-display text-lg font-bold text-txt">Invia «{sending.name}»</span><button onClick={() => setSending(null)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            {limitReached && <div className="mb-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in srgb, var(--warn) 40%, var(--line))", backgroundColor: "color-mix(in srgb, var(--warn) 8%, transparent)", color: "var(--warn)" }}>Hai già inviato 4 promo quest'anno. Meglio non sovraccaricare gli ospiti.</div>}
            <label className="block text-xs font-medium text-dim">Destinatari<select value={segment} onChange={(e) => setSegment(e.target.value as Segment)} className={`${inp} mt-1`}>{SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
            <label className="mt-3 block text-xs font-medium text-dim">Struttura<select value={structureId} onChange={(e) => setStructureId(e.target.value)} className={`${inp} mt-1`}><option value="all">Tutte le strutture</option>{structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <div className="mt-2 text-xs text-faint">{SEGMENTS.find((s) => s.key === segment)?.desc} · <b className="text-dim">{audience.length} destinatari</b></div>
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-4">
              <button onClick={() => setSending(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
              <button onClick={doSend} disabled={audience.length === 0 || limitReached} className="flex items-center gap-1.5 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"><Icon name="mail" size={14} /> Apri email ({audience.length})</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
