"use client";

// Materiale acquistato (carta igienica, prodotti per la pulizia…). Usa gli stessi "ordini" di Scorte & spesa:
// se la voce è un prodotto in scorta, la giacenza sale da sola. Ogni acquisto con importo diventa una USCITA nella Prima nota (Cassa),
// categoria Forniture, e può avere lo scontrino allegato (foto o PDF su Storage privato: qui resta solo il riferimento).
import { Button } from "@/components/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Structure } from "@/lib/types";
import { KEY_ORDERS, KEY_STOCK, matchStock, parseMoney, type PulizieOrder, type ReceiptRef, type StockLite } from "@/lib/pulizie-addetta";
import { DEFAULT_PAY_CONTO, PAY_OPTIONS, RECEIPT_ACCEPT, createPurchaseOrder, markCash, newUuid, planCashSync } from "@/lib/pulizie-purchase";
import { discardReceipt, recordPurchase, unrecordPurchase, uploadReceipt } from "@/lib/pulizie-purchase-client";
import { loadConti, loadContiPrefs, routeFor, type ContoDef } from "@/lib/cassa";
import DateField from "@/components/DateField";
import Icon from "@/components/Icon";
import { useSyncedList } from "./useSyncedList";
import { Card, Seg, btnPrimary, inputCls, stamp } from "./addetta-ui";

type Attached = { ref: ReceiptRef; preview?: string };

export default function AddettaPurchases({ structures, canEdit, activeStructureId }: { structures: Structure[]; canEdit: boolean; activeStructureId: string }) {
  const [orders, setOrders] = useSyncedList<PulizieOrder>(KEY_ORDERS);
  const [stock, setStock] = useSyncedList<StockLite>(KEY_STOCK);
  const today = stamp().today;
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState(today);
  const [sid, setSid] = useState(activeStructureId !== "all" ? activeStructureId : (structures[0]?.id ?? ""));
  const [addStock, setAddStock] = useState(true);
  const [payConto, setPayConto] = useState<string>(DEFAULT_PAY_CONTO);
  const [att, setAtt] = useState<Attached | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [cashMsg, setCashMsg] = useState("");
  const [tick, setTick] = useState(0);
  const [contiAll, setContiAll] = useState<ContoDef[]>([]);
  const busy = useRef(new Set<string>());
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const structId = sid || structures[0]?.id || "";
  const match = matchStock(stock, name, structId);
  const suggestions = useMemo(() => [...new Set(stock.filter((p) => !p._deleted && p.structureId === structId).map((p) => p.name))].sort((a, b) => a.localeCompare(b, "it")), [stock, structId]);
  // Conti della Cassa PER STRUTTURA: Contanti / Carta / Bonifico cadono sui conti della struttura dell'acquisto (contanti e carta suoi, bonifico = banca o suo principale).
  const route = useMemo(() => (contiAll.length ? routeFor(contiAll, loadContiPrefs(), structId) : null), [contiAll, structId]);
  const realConto = (opt: string): string | undefined => {
    if (!route) return opt; // conti non ancora letti: chiavi di base
    if (opt === "contanti") return route.accounts?.cash ?? route.principal;
    if (opt === "carta") return route.accounts?.card;
    return route.validConti.includes("banca") ? "banca" : route.principal;
  };
  const payOptions = useMemo(() => PAY_OPTIONS.filter((o) => !!realConto(o.key)), [route]); // eslint-disable-line react-hooks/exhaustive-deps
  const effConto = payOptions.some((o) => o.key === payConto) ? payConto : DEFAULT_PAY_CONTO; // il conto scelto non esiste più nella Cassa → contanti
  const hasCost = (parseMoney(cost) ?? 0) > 0;

  // Conti esistenti nella Cassa (quelli di base si possono eliminare: carta).
  useEffect(() => {
    const read = () => { try { setContiAll(loadConti()); } catch { /* resta l'elenco di base */ } };
    read();
    window.addEventListener("spigolestay:datasync", read);
    return () => window.removeEventListener("spigolestay:datasync", read);
  }, []);

  // Allineamento con la Prima nota: i nuovi acquisti con importo (cash = pending) vengono registrati dal server; quelli registrati e poi eliminati
  // vengono tolti. Idempotente (stesso id = stesso movimento): ripetere non crea doppioni, e se la rete manca si riprova alla prossima occasione.
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("online", h); window.addEventListener("focus", h);
    return () => { window.removeEventListener("online", h); window.removeEventListener("focus", h); };
  }, []);
  useEffect(() => {
    if (!canEdit) return;
    const { create, remove } = planCashSync(orders);
    const mine = [...create, ...remove].filter((o) => !busy.current.has(o.id));
    if (!mine.length) { setCashMsg(""); return; }
    mine.forEach((o) => busy.current.add(o.id));
    let alive = true;
    (async () => {
      const done = new Set<string>(), failed = new Set<string>(), removed = new Set<string>();
      let retry = false;
      for (const o of mine) {
        if (o._deleted) { if (await unrecordPurchase(o)) removed.add(o.id); else retry = true; continue; }
        const r = await recordPurchase(o);
        if (r === "done") done.add(o.id); else if (r === "failed") failed.add(o.id); else retry = true;
      }
      mine.forEach((o) => busy.current.delete(o.id));
      if (done.size || failed.size || removed.size) {
        const now = Date.now();
        setOrders((prev) => markCash(markCash(markCash(prev, done, "done", now), failed, "failed", now), removed, "removed", now));
      }
      if (!alive) return;
      setCashMsg(failed.size ? "Un acquisto non è stato accettato dalla Prima nota: controlla importo e data." : retry ? "Registrazione in Prima nota in attesa: riprovo appena torna la connessione." : "");
    })();
    return () => { alive = false; };
  }, [orders, canEdit, setOrders, tick]);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(""); setUploading(true);
    const prev = att;
    const up = await uploadReceipt(f);
    setUploading(false);
    if (!up.ok) { setErr(up.error); return; }
    if (prev) { void discardReceipt(prev.ref.path); if (prev.preview) URL.revokeObjectURL(prev.preview); }
    setAtt({ ref: up.receipt, preview: up.file.type.startsWith("image/") ? URL.createObjectURL(up.file) : undefined });
  };
  const dropFile = () => {
    if (!att) return;
    void discardReceipt(att.ref.path); // non è ancora legato a nessun acquisto: si toglie anche dal server
    if (att.preview) URL.revokeObjectURL(att.preview);
    setAtt(null);
  };

  const add = () => {
    const q = Number(qty.replace(",", "."));
    if (!name.trim()) { setErr("Scrivi cosa hai comprato."); return; }
    if (!Number.isFinite(q) || q <= 0) { setErr("La quantità deve essere maggiore di zero."); return; }
    if (cost.trim() && parseMoney(cost) === undefined) { setErr("L'importo non è valido (es. 12,50)."); return; }
    if (!structId) { setErr("Scegli la struttura."); return; }
    if (uploading) { setErr("Attendi che lo scontrino sia caricato."); return; }
    setErr("");
    const n = stamp();
    const when = `${date || n.today}${n.iso.slice(10)}`;
    const order = createPurchaseOrder({ id: newUuid(), productId: match?.id, productName: match?.name ?? name.trim(), structureId: structId, date: when, qty: q, cost: parseMoney(cost), conto: realConto(effConto) ?? effConto, receipt: att?.ref, nowMs: n.ms });
    setOrders((prev) => [order, ...prev]);
    if (match && addStock) setStock((prev) => prev.map((p) => (p.id === match.id ? { ...p, qty: (p.qty || 0) + q, updatedAt: n.ms } : p)));
    if (att?.preview) URL.revokeObjectURL(att.preview);
    setAtt(null); setName(""); setQty("1"); setCost("");
  };

  if (!canEdit) return null;
  return (
    <div className="flex flex-col gap-3">
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
        {hasCost && (
          <div className="mt-2">
            <div className="mb-1 text-[11px] font-medium text-dim">Pagato con <span className="text-faint">(finisce nella Prima nota)</span></div>
            <Seg value={effConto} onChange={setPayConto} options={payOptions.map((o) => ({ key: o.key, label: o.label }))} />
          </div>
        )}
        {match && (
          <label className="mt-2 flex min-h-[40px] cursor-pointer items-center gap-2 text-xs text-dim"><input type="checkbox" checked={addStock} onChange={(e) => setAddStock(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> Aggiungi alle scorte di «{match.name}» (ora {match.qty})</label>
        )}

        <div className="mt-2">
          <div className="mb-1 text-[11px] font-medium text-dim">Scontrino <span className="text-faint">(facolt.)</span></div>
          {att ? (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-paper p-2">
              {att.preview
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={att.preview} alt="Anteprima scontrino" className="h-14 w-14 shrink-0 rounded-md border border-line object-cover" />
                : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md border border-line bg-surface text-dim"><Icon name="fileText" size={22} /></span>}
              <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-txt">{att.ref.name}</div><div className="text-[11px] text-faint">{att.ref.type === "application/pdf" ? "PDF allegato" : "Foto allegata"}</div></div>
              <Button variant="secondary" size="xs" type="button" onClick={dropFile} aria-label="Rimuovi lo scontrino" className="flex min-h-[40px] shrink-0 gap-1"><Icon name="trash" size={14} /> Rimuovi</Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="xs" type="button" disabled={uploading} onClick={() => camRef.current?.click()} className="flex min-h-[44px]"><Icon name="receipt" size={15} /> {uploading ? "Carico…" : "Scatta foto"}</Button>
              <Button variant="secondary" size="xs" type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="flex min-h-[44px]"><Icon name="fileText" size={15} /> {uploading ? "Carico…" : "Scegli foto o PDF"}</Button>
            </div>
          )}
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pickFile(f); }} />
          <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pickFile(f); }} />
        </div>

        {err && <p className="mt-2 text-xs text-[color:var(--err)]">{err}</p>}
        {cashMsg && <p className="mt-2 text-xs text-[color:var(--warn)]">{cashMsg}</p>}
        <button onClick={add} disabled={uploading} className={btnPrimary + " mt-3 flex min-h-[48px] w-full items-center justify-center gap-2"}><Icon name="plus" size={15} /> Aggiungi acquisto</button>
        <p className="mt-2 text-[11px] text-faint">Con un importo, l&apos;acquisto viene registrato come uscita nella Prima nota (Forniture). Lo scontrino lo ritrovi lì.</p>
      </Card>
    </div>
  );
}
