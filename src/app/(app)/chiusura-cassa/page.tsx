"use client";

// Chiusura cassa: quadratura del contante di giornata. Il saldo teorico usa la STESSA logica
// della Prima Nota (movimenti auto dalle prenotazioni + programmati + manuali), letta da Supabase.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";
import { roundCents, sumCents } from "@/lib/money";
import { exportExcel } from "@/lib/export";
import { type Mov, type Rule, type CashScope, computeAuto, computeScheduled, scopeVisible, cashScopeOf, scopeIds, loadCash, loadConti, contiKeysInScope, contoDisplayLabel, isCashConto, type ContoDef } from "@/lib/cassa";
import { useTenantId } from "@/lib/tenant";

const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const numv = (v: string) => { const n = Number(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

interface Closure { id: string; day: string; conto: string | null; structure_id: string | null; expected_cents: number; counted_cents: number; diff_cents: number; note: string | null }

export default function ChiusuraCassaPage() {
  const { user } = useAuth();
  const tenantId = useTenantId(); // account di lavoro: per un collaboratore è quello di chi lo ha invitato
  const { bookings, guests, getStructure, allStructures, selectedStructureIds } = useData();

  // Dati Cassa dal server (movimenti manuali + regole + occorrenze saldate).
  const [manual, setManual] = useState<Mov[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [paid, setPaid] = useState<string[]>([]);
  const paidSet = useMemo(() => new Set(paid), [paid]);
  useEffect(() => { if (!user) return; (async () => { const c = await loadCash(); setManual(c.movements); setRules(c.rules); setPaid(c.paid); })(); }, [user]);

  // Conti della Cassa (PER STRUTTURA): si rileggono quando arrivano dal server.
  const [allConti, setAllConti] = useState<ContoDef[]>(() => (typeof window === "undefined" ? [] : loadConti()));
  useEffect(() => {
    const h = () => { try { setAllConti(loadConti()); } catch { /* storage non disponibile */ } };
    h();
    window.addEventListener("spigolestay:datasync", h);
    return () => window.removeEventListener("spigolestay:datasync", h);
  }, []);
  const [day, setDay] = useState(todayISO());
  const [conto, setConto] = useState("contanti");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [closures, setClosures] = useState<Closure[]>([]);
  const [msg, setMsg] = useState("");

  // Ambito: le strutture selezionate in alto a destra (una, più d'una o tutte). Con più strutture si può restringere a una sola; "all" qui = tutte quelle selezionate.
  const allIds = useMemo(() => allStructures.map((x) => x.id), [allStructures]);
  const baseScope = useMemo<CashScope>(() => cashScopeOf(selectedStructureIds, allIds), [selectedStructureIds, allIds]);
  const singleBase = typeof baseScope === "string" && baseScope !== "all";
  const baseKey = typeof baseScope === "string" ? baseScope : baseScope.join(",");
  const structures = useMemo(() => { const ids = scopeIds(baseScope, allIds); return allStructures.filter((x) => ids.includes(x.id)); }, [baseScope, allStructures, allIds]); // strutture tra cui scegliere
  const [struct, setStruct] = useState<string>("all");
  useEffect(() => { setStruct("all"); }, [baseKey]);
  const scope: CashScope = singleBase ? baseScope : struct !== "all" && structures.some((x) => x.id === struct) ? struct : baseScope;
  const scopeKey = typeof scope === "string" ? scope : scope.join(",");
  const scopeName = typeof scope === "string" ? (scope === "all" ? "Tutte le strutture" : getStructure(scope)?.name ?? "—") : scope.map((id) => getStructure(id)?.name ?? "—").join(" + ");

  // Chiusure recenti: con una struttura nello scope si vedono solo le sue (con "Tutte" tutte).
  const loadClosures = async () => {
    if (!supabase) return;
    let q = supabase.from("cash_closures").select("id, day, conto, structure_id, expected_cents, counted_cents, diff_cents, note");
    if (typeof scope !== "string") q = q.or(`structure_id.is.null,structure_id.in.(${scope.join(",")})`);
    else if (scope !== "all") q = q.eq("structure_id", scope);
    const { data } = await q.order("day", { ascending: false }).limit(40);
    setClosures((data ?? []) as Closure[]);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadClosures(); }, [scopeKey]);

  // Composizione movimenti (come Prima Nota) nello scope struttura scelto.
  const all = useMemo<Mov[]>(() => {
    const a = computeAuto(bookings, guests, getStructure, scope);
    const s = computeScheduled(rules, paidSet, scope, day);
    const m = manual.filter((mv) => scopeVisible(mv.structureId, scope));
    return [...a, ...s, ...m];
  }, [bookings, guests, getStructure, scopeKey, rules, paidSet, day, manual, allConti]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conti dell'ambito scelto (ognuna struttura ha i suoi), più quelli su cui ci sono movimenti (anche non assegnati).
  const conti = useMemo(() => { const s = new Set<string>(contiKeysInScope(allConti, all, scope)); all.forEach((m) => { if (m.conto) s.add(m.conto); }); return Array.from(s); }, [all, allConti, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Il conto scelto deve esistere nell'ambito: altrimenti si passa ai contanti (o al primo conto).
  useEffect(() => {
    if (conti.includes(conto)) return;
    const cash = conti.find((k) => { const c = allConti.find((x) => x.key === k); return !!c && isCashConto(c); });
    setConto(cash ?? conti[0] ?? "contanti");
  }, [conti, conto, allConti]);

  const dayMovs = useMemo(() => all.filter((m) => m.conto === conto && m.date === day).sort((a, b) => b.amount - a.amount), [all, conto, day]);
  const entrate = sumCents(dayMovs.filter((m) => m.kind === "in").map((m) => m.amount));
  const uscite = sumCents(dayMovs.filter((m) => m.kind === "out").map((m) => m.amount));
  // Saldo teorico cumulato del conto fino al giorno scelto.
  const expected = useMemo(() => sumCents(all.filter((m) => m.conto === conto && m.date <= day).map((m) => (m.kind === "in" ? m.amount : -m.amount))), [all, conto, day]);
  const diff = roundCents(numv(counted) - expected);

  const contoLabel = (k: string) => { const c = allConti.find((x) => x.key === k); return c ? contoDisplayLabel(c, allConti, (id) => getStructure(id)?.name ?? "—") : k; };
  const structOf = (id: string | null) => (!id || id === "all" ? "Tutte" : getStructure(id)?.name ?? "—");

  const save = async () => {
    if (!supabase || !user) { setMsg("Devi essere connesso."); return; }
    const { error } = await supabase.from("cash_closures").insert({ tenant_id: tenantId ?? user.id, day, conto: conto || null, structure_id: typeof scope === "string" && scope !== "all" ? scope : null, expected_cents: Math.round(expected * 100), counted_cents: Math.round(numv(counted) * 100), diff_cents: Math.round(diff * 100), note: note || null });
    setMsg(error ? "Errore: " + error.message : "Chiusura salvata ✓");
    if (!error) { setCounted(""); setNote(""); loadClosures(); }
  };

  const exportCsv = () => {
    const headers = ["Data", "Tipo", "Descrizione", "Conto", "Importo €"];
    const body = dayMovs.map((m) => [m.date, m.kind === "in" ? "Entrata" : "Uscita", m.desc + (m.sched ? " (programmato)" : m.auto ? " (auto)" : ""), contoLabel(m.conto), m.kind === "in" ? m.amount : -m.amount]);
    body.push(["", "", "Entrate", "", entrate]);
    body.push(["", "", "Uscite", "", -uscite]);
    body.push(["", "", "Saldo teorico", "", expected]);
    if (counted !== "") { body.push(["", "", "Contato", "", numv(counted)]); body.push(["", "", "Differenza", "", diff]); }
    exportExcel(`chiusura-cassa-${day}-${scope === "all" || typeof scope !== "string" ? "tutte" : scopeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, headers, body);
  };

  const printClose = () => {
    const w = window.open("", "_blank", "width=780,height=900"); if (!w) return;
    const rows = dayMovs.map((m) => `<tr><td>${m.kind === "in" ? "Entrata" : "Uscita"}</td><td>${esc(m.desc)}${m.auto ? " <i>(auto)</i>" : m.sched ? " <i>(prog.)</i>" : ""}</td><td style="text-align:right">${m.kind === "in" ? "" : "−"}${eur(m.amount)}</td></tr>`).join("");
    const dd = new Date(day).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Chiusura cassa ${day}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;color:#111;margin:32px;font-size:13px}h1{font-size:20px;margin:0 0 4px}.muted{color:#666}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-bottom:1px solid #e5e5e5;padding:6px 8px;text-align:left}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#666}.tot{margin-top:16px;width:280px;margin-left:auto}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .big{font-weight:700;border-top:2px solid #111;padding-top:8px;font-size:15px}</style></head><body>
      <h1>Verbale di chiusura cassa</h1>
      <div class="muted">${esc(scopeName)} · Conto ${esc(contoLabel(conto))} · ${dd}</div>
      <table><thead><tr><th>Tipo</th><th>Descrizione</th><th style="text-align:right">Importo</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">Nessun movimento in questo giorno.</td></tr>'}</tbody></table>
      <div class="tot">
        <div><span class="muted">Entrate del giorno</span><span>${eur(entrate)}</span></div>
        <div><span class="muted">Uscite del giorno</span><span>−${eur(uscite)}</span></div>
        <div class="big"><span>Saldo teorico</span><span>${eur(expected)}</span></div>
        ${counted !== "" ? `<div><span class="muted">Contato in cassa</span><span>${eur(numv(counted))}</span></div><div class="big"><span>Differenza</span><span>${diff >= 0 ? "+" : ""}${eur(diff)}</span></div>` : ""}
        ${note ? `<div style="margin-top:10px" class="muted">Note: ${esc(note)}</div>` : ""}
      </div>
      <p class="muted" style="margin-top:26px">Firma _______________________</p>
      <script>onload=()=>{print()}<\/script></body></html>`);
    w.document.close();
  };

  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  return (
    <div>
      <PageHeader title="Chiusura cassa" subtitle="Quadratura del contante di giornata"
        actions={<div className="flex items-center gap-2">
          <button onClick={exportCsv} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">Esporta</button>
          <button onClick={printClose} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">Stampa</button>
        </div>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Quadratura</SectionTitle>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={lbl}>Giorno<input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inp} /></label>
            <label className={lbl}>Conto<select value={conto} onChange={(e) => setConto(e.target.value)} className={inp}>{conti.map((c) => <option key={c} value={c}>{contoLabel(c)}</option>)}</select></label>
            {/* Filtro struttura solo se in alto a destra è selezionato "Tutte" */}
            {!singleBase ? (
              <label className={`${lbl} sm:col-span-2`}>Struttura<select value={struct} onChange={(e) => setStruct(e.target.value)} className={inp}><option value="all">{typeof baseScope === "string" ? "Tutte le strutture" : "Tutte le selezionate"}</option>{structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            ) : (
              <div className="sm:col-span-2 text-xs text-dim">Struttura: <b className="text-txt">{scopeName}</b></div>
            )}
          </div>
          <div className="mt-3 flex flex-col gap-1 rounded-lg bg-wash p-3 text-sm">
            <div className="flex justify-between"><span className="text-dim">Entrate del giorno</span><span className="font-mono text-[color:var(--ok)]">{eur(entrate)}</span></div>
            <div className="flex justify-between"><span className="text-dim">Uscite del giorno</span><span className="font-mono text-[color:var(--err)]">−{eur(uscite)}</span></div>
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><span>Saldo teorico {contoLabel(conto).toLowerCase()}</span><span className="font-mono">{eur(expected)}</span></div>
          </div>
          <label className={`${lbl} mt-3 block`}>Contato in cassa €<input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" className={inp} placeholder="0,00" /></label>
          {counted !== "" && <div className="mt-2 flex justify-between rounded-lg px-3 py-2 text-sm font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${Math.abs(diff) < 0.005 ? "var(--ok)" : "var(--err)"} 14%, transparent)`, color: Math.abs(diff) < 0.005 ? "var(--ok)" : "var(--err)" }}><span>Differenza</span><span className="font-mono">{diff >= 0 ? "+" : ""}{eur(diff)}</span></div>}
          <label className={`${lbl} mt-2 block`}>Note<input value={note} onChange={(e) => setNote(e.target.value)} className={inp} /></label>
          <button onClick={save} disabled={counted === ""} className="mt-3 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Chiudi giornata</button>
          {msg && <p className="mt-2 text-[12px] font-medium text-dim">{msg}</p>}
        </Card>

        <Card>
          <SectionTitle>Dettaglio movimenti del giorno</SectionTitle>
          <div className="mt-2 max-h-[42dvh] overflow-y-auto">
            {dayMovs.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-0 text-sm">
                <div className="min-w-0"><div className="truncate text-txt">{m.desc}</div><div className="text-[11px] text-faint">{m.auto ? "automatico" : m.sched ? "programmato" : "manuale"}</div></div>
                <div className="shrink-0 font-mono" style={{ color: m.kind === "in" ? "var(--ok)" : "var(--err)" }}>{m.kind === "in" ? "" : "−"}{eur(m.amount)}</div>
              </div>
            ))}
            {dayMovs.length === 0 && <EmptyState title="Nessun movimento" sub="Nessun movimento su questo conto nel giorno scelto." />}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <SectionTitle>Chiusure recenti</SectionTitle>
        <div className="mt-2">
          {closures.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-0 text-sm">
              <div><div className="text-txt">{new Date(c.day).toLocaleDateString("it-IT")}</div><div className="text-[11px] text-faint">{structOf(c.structure_id)} · {contoLabel(c.conto ?? "")}</div></div>
              <div className="text-right"><div className="font-mono text-txt">{eur(c.counted_cents / 100)}</div><div className="text-[11px]" style={{ color: c.diff_cents === 0 ? "var(--ok)" : "var(--err)" }}>{c.diff_cents >= 0 ? "+" : ""}{eur(c.diff_cents / 100)}</div></div>
            </div>
          ))}
          {closures.length === 0 && <EmptyState title="Nessuna chiusura" sub="Salva la prima quadratura di giornata." />}
        </div>
      </Card>
    </div>
  );
}
