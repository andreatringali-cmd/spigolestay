"use client";

// Materiale acquistato (carta igienica, prodotti per la pulizia…). Usa gli stessi "ordini" di Scorte & spesa:
// se la voce è un prodotto in scorta, la giacenza sale da sola. Riepilogo per mese o per anno.
import { useMemo, useState } from "react";
import type { Structure } from "@/lib/types";
import {
  KEY_ORDERS, KEY_STOCK, matchStock, monthBounds, monthName, monthOf, parseMoney, removeEntity, shiftMonth, summarizePurchases,
  type PulizieOrder, type StockLite,
} from "@/lib/pulizie-addetta";
import { fmtDMY } from "@/lib/dates";
import { eur } from "@/lib/format";
import { useConfirm } from "@/components/ConfirmProvider";
import DateField from "@/components/DateField";
import Icon from "@/components/Icon";
import { useSyncedList } from "./useSyncedList";
import { Card, Seg, btnPrimary, inputCls, newId, stamp } from "./addetta-ui";

export default function AddettaPurchases({ structures, canEdit, activeStructureId }: { structures: Structure[]; canEdit: boolean; activeStructureId: string }) {
  const confirm = useConfirm();
  const [orders, setOrders] = useSyncedList<PulizieOrder>(KEY_ORDERS);
  const [stock, setStock] = useSyncedList<StockLite>(KEY_STOCK);
  const today = stamp().today;
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState(today);
  const [sid, setSid] = useState(activeStructureId !== "all" ? activeStructureId : (structures[0]?.id ?? ""));
  const [addStock, setAddStock] = useState(true);
  const [err, setErr] = useState("");
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [ym, setYm] = useState(monthOf(today));

  const structId = sid || structures[0]?.id || "";
  const match = matchStock(stock, name, structId);
  const suggestions = useMemo(() => [...new Set(stock.filter((p) => !p._deleted && p.structureId === structId).map((p) => p.name))].sort((a, b) => a.localeCompare(b, "it")), [stock, structId]);

  const range = period === "month" ? monthBounds(ym) : { from: `${ym.slice(0, 4)}-01-01`, to: `${ym.slice(0, 4)}-12-31` };
  const scoped = orders.filter((o) => activeStructureId === "all" || !o.structureId || o.structureId === activeStructureId);
  const sum = summarizePurchases(scoped, range.from, range.to);
  const list = scoped.filter((o) => !o._deleted && o.date.slice(0, 10) >= range.from && o.date.slice(0, 10) <= range.to).sort((a, b) => b.date.localeCompare(a.date));

  const add = () => {
    const q = Number(qty.replace(",", "."));
    if (!name.trim()) { setErr("Scrivi cosa hai comprato."); return; }
    if (!Number.isFinite(q) || q <= 0) { setErr("La quantità deve essere maggiore di zero."); return; }
    if (cost.trim() && parseMoney(cost) === undefined) { setErr("L'importo non è valido (es. 12,50)."); return; }
    if (!structId) { setErr("Scegli la struttura."); return; }
    setErr("");
    const n = stamp();
    const when = `${date || n.today}${n.iso.slice(10)}`;
    setOrders((prev) => [{ id: newId(), productId: match?.id ?? "", productName: match?.name ?? name.trim(), structureId: structId, date: when, qty: q, cost: parseMoney(cost), source: "addetta", updatedAt: n.ms }, ...prev]);
    if (match && addStock) setStock((prev) => prev.map((p) => (p.id === match.id ? { ...p, qty: (p.qty || 0) + q, updatedAt: n.ms } : p)));
    setName(""); setQty("1"); setCost("");
    if (date) setYm(monthOf(date));
  };
  const del = async (o: PulizieOrder) => {
    if (!(await confirm({ title: "Eliminare l'acquisto?", message: `${o.productName} · ${fmtDMY(o.date)}. Le scorte non vengono toccate.`, danger: true, confirmLabel: "Elimina" }))) return;
    setOrders((prev) => removeEntity(prev, o.id, Date.now()));
  };

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <Card className="p-3">
          <div className="mb-2 text-sm font-bold text-txt">Materiale acquistato</div>
          <input list="addetta-stock" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Cosa hai comprato (es. carta igienica)" className={inputCls + " py-2.5"} />
          <datalist id="addetta-stock">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label className="block"><div className="mb-1 text-[11px] font-medium text-dim">Quantità</div><input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls + " py-2.5"} /></label>
            <label className="block"><div className="mb-1 text-[11px] font-medium text-dim">Importo € <span className="text-faint">(facolt.)</span></div><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="0,00" className={inputCls + " py-2.5"} /></label>
            <div><div className="mb-1 text-[11px] font-medium text-dim">Data</div><DateField value={date} onChange={setDate} className="w-full rounded-lg border border-line bg-paper px-2 py-2.5 text-sm" /></div>
          </div>
          {structures.length > 1 && (
            <select value={structId} onChange={(e) => setSid(e.target.value)} className={inputCls + " mt-2"}>
              {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {match && (
            <label className="mt-2 flex min-h-[40px] cursor-pointer items-center gap-2 text-xs text-dim"><input type="checkbox" checked={addStock} onChange={(e) => setAddStock(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> Aggiungi alle scorte di «{match.name}» (ora {match.qty})</label>
          )}
          {err && <p className="mt-2 text-xs text-[color:var(--err)]">{err}</p>}
          <button onClick={add} className={btnPrimary + " mt-3 flex min-h-[48px] w-full items-center justify-center gap-2"}><Icon name="plus" size={15} /> Aggiungi acquisto</button>
        </Card>
      )}

      <Seg value={period} onChange={setPeriod} options={[{ key: "month", label: "Mese" }, { key: "year", label: "Anno" }]} />
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setYm((m) => shiftMonth(m, period === "month" ? -1 : -12))} aria-label="Periodo precedente" className="grid h-11 w-11 place-items-center rounded-lg border border-line text-lg text-dim hover:bg-wash">‹</button>
        <span className="text-sm font-bold capitalize text-txt">{period === "month" ? monthName(ym) : ym.slice(0, 4)}</span>
        <button onClick={() => setYm((m) => shiftMonth(m, period === "month" ? 1 : 12))} aria-label="Periodo successivo" className="grid h-11 w-11 place-items-center rounded-lg border border-line text-lg text-dim hover:bg-wash">›</button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-dim">Speso</div><div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-txt">{eur(sum.total)}</div>{sum.withoutCost > 0 && <div className="text-[10px] text-faint">{sum.withoutCost} {sum.withoutCost === 1 ? "acquisto senza importo" : "acquisti senza importo"}</div>}</Card>
        <Card className="p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-dim">Acquisti</div><div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-txt">{sum.count}</div></Card>
      </div>

      {sum.rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line bg-wash px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-dim">Per voce</div>
          <div className="divide-y divide-[color:var(--line)]">
            {sum.rows.map((r) => (
              <div key={r.name.toLowerCase()} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-txt">{r.name}</span>
                <span className="shrink-0 whitespace-nowrap text-dim">× {r.qty.toLocaleString("it-IT")}</span>
                <span className="w-20 shrink-0 whitespace-nowrap text-right font-semibold text-txt">{r.cost ? eur(r.cost) : "—"}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-line bg-wash px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-dim">Acquisti del periodo</div>
        {list.length === 0 ? <div className="px-3 py-4 text-center text-xs text-faint">Nessun acquisto in questo periodo.</div> : (
          <div className="divide-y divide-[color:var(--line)]">
            {list.map((o) => (
              <div key={o.id} className="flex min-h-[48px] items-center gap-2 px-3 py-1.5">
                <span className="w-12 shrink-0 whitespace-nowrap font-mono text-xs text-dim">{fmtDMY(o.date).slice(0, 5)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-txt">{o.productName} <span className="text-dim">× {o.qty}</span></span>
                <span className="w-16 shrink-0 whitespace-nowrap text-right text-xs font-semibold text-txt">{o.cost != null ? eur(o.cost) : "—"}</span>
                {canEdit && <button onClick={() => del(o)} aria-label="Elimina" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-faint hover:text-[color:var(--err)]"><Icon name="trash" size={15} /></button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
