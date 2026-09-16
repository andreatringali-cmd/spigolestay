"use client";

// Chiusura cassa: quadratura del contante. Legge i movimenti di Cassa (localStorage),
// calcola il saldo teorico del conto contanti; l'utente conta il cassetto e salva la chiusura.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";

interface Mov { date: string; kind: "in" | "out"; amount: number; conto: string }
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const numv = (v: string) => { const n = Number(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };

export default function ChiusuraCassaPage() {
  const { user } = useAuth();
  const [movs, setMovs] = useState<Mov[]>([]);
  const [day, setDay] = useState(todayISO());
  const [conto, setConto] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [closures, setClosures] = useState<{ id: string; day: string; conto: string | null; expected_cents: number; counted_cents: number; diff_cents: number }[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    try { const raw = localStorage.getItem("spigolestay:cassa:v1"); if (raw) setMovs(JSON.parse(raw) as Mov[]); } catch {}
  }, []);
  const loadClosures = async () => { if (!supabase) return; const { data } = await supabase.from("cash_closures").select("id, day, conto, expected_cents, counted_cents, diff_cents").order("day", { ascending: false }).limit(30); setClosures((data ?? []) as typeof closures); };
  useEffect(() => { loadClosures(); }, []);

  const conti = useMemo(() => Array.from(new Set(movs.map((m) => m.conto).filter(Boolean))), [movs]);
  useEffect(() => { if (!conto && conti.length) setConto(conti.find((c) => /contant|cassa/i.test(c)) ?? conti[0]); }, [conti, conto]);

  const dayMovs = movs.filter((m) => m.conto === conto && m.date === day);
  const entrate = dayMovs.filter((m) => m.kind === "in").reduce((a, m) => a + m.amount, 0);
  const uscite = dayMovs.filter((m) => m.kind === "out").reduce((a, m) => a + m.amount, 0);
  // Saldo teorico cumulato del conto fino al giorno scelto.
  const expected = movs.filter((m) => m.conto === conto && m.date <= day).reduce((a, m) => a + (m.kind === "in" ? m.amount : -m.amount), 0);
  const diff = numv(counted) - expected;

  const save = async () => {
    if (!supabase || !user) { setMsg("Devi essere connesso."); return; }
    const { error } = await supabase.from("cash_closures").insert({ tenant_id: user.id, day, conto: conto || null, expected_cents: Math.round(expected * 100), counted_cents: Math.round(numv(counted) * 100), diff_cents: Math.round(diff * 100), note: note || null });
    setMsg(error ? "Errore: " + error.message : "Chiusura salvata ✓");
    if (!error) { setCounted(""); setNote(""); loadClosures(); }
  };

  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  return (
    <div>
      <PageHeader title="Chiusura cassa" subtitle="Quadratura del contante di giornata" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Quadratura</SectionTitle>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={lbl}>Giorno<input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inp} /></label>
            <label className={lbl}>Conto<select value={conto} onChange={(e) => setConto(e.target.value)} className={inp}>{conti.length === 0 && <option value="">—</option>}{conti.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          </div>
          <div className="mt-3 flex flex-col gap-1 rounded-lg bg-wash p-3 text-sm">
            <div className="flex justify-between"><span className="text-dim">Entrate del giorno</span><span className="font-mono text-[color:var(--ok)]">{eur(entrate)}</span></div>
            <div className="flex justify-between"><span className="text-dim">Uscite del giorno</span><span className="font-mono text-[color:var(--err)]">−{eur(uscite)}</span></div>
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><span>Saldo teorico cassa</span><span className="font-mono">{eur(expected)}</span></div>
          </div>
          <label className={`${lbl} mt-3 block`}>Contato in cassa €<input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" className={inp} placeholder="0,00" /></label>
          {counted !== "" && <div className="mt-2 flex justify-between rounded-lg px-3 py-2 text-sm font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${Math.abs(diff) < 0.005 ? "var(--ok)" : "var(--err)"} 14%, transparent)`, color: Math.abs(diff) < 0.005 ? "var(--ok)" : "var(--err)" }}><span>Differenza</span><span className="font-mono">{diff >= 0 ? "+" : ""}{eur(diff)}</span></div>}
          <label className={`${lbl} mt-2 block`}>Note<input value={note} onChange={(e) => setNote(e.target.value)} className={inp} /></label>
          <button onClick={save} disabled={counted === ""} className="mt-3 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Chiudi giornata</button>
          {msg && <p className="mt-2 text-[12px] font-medium text-dim">{msg}</p>}
        </Card>

        <Card>
          <SectionTitle>Chiusure recenti</SectionTitle>
          <div className="mt-2">
            {closures.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-0 text-sm">
                <div><div className="text-txt">{new Date(c.day).toLocaleDateString("it-IT")}</div><div className="text-[11px] text-faint">{c.conto ?? "—"}</div></div>
                <div className="text-right"><div className="font-mono text-txt">{eur(c.counted_cents / 100)}</div><div className="text-[11px]" style={{ color: c.diff_cents === 0 ? "var(--ok)" : "var(--err)" }}>{c.diff_cents >= 0 ? "+" : ""}{eur(c.diff_cents / 100)}</div></div>
              </div>
            ))}
            {closures.length === 0 && <EmptyState title="Nessuna chiusura" sub="Salva la prima quadratura di giornata." />}
          </div>
        </Card>
      </div>
    </div>
  );
}
