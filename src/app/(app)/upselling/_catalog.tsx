"use client";

// Tab "Catalogo": gli extra della struttura (stessa fonte del motore prenotazioni e del check-in
// online) con prezzo, modalità, categoria, stagionalità, soggiorno minimo e quantità massima.
// I prezzi li decide il gestore: gli esempi precaricati restano "da confermare" e non vengono proposti.

import { useState } from "react";
import { eur } from "@/lib/format";
import type { ExtraKind, ExtraService, Structure } from "@/lib/types";
import { hasSeason, isActive, isPriceUnverified, KIND_LABEL, KINDS, kindOf, MONTHS_IT, PER_LABEL, seasonLabel, type ExtraStat } from "@/lib/upselling";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmProvider";

const inp = "w-full rounded border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus";

export default function CatalogTab({ structure, extras, onSave, stats, addDisabled }: {
  structure?: Structure; extras: ExtraService[]; onSave: (next: ExtraService[]) => void; stats: ExtraStat[]; addDisabled: boolean;
}) {
  const confirm = useConfirm();
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const upd = (id: string, patch: Partial<ExtraService>) => onSave(extras.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const add = () => {
    // Nessun prezzo inventato: parte a 0 e finché non lo imposti l'extra non viene proposto.
    const e: ExtraService = { id: String(Date.now()), name: "Nuovo extra", desc: "", price: 0, per: "stay", confirmed: true };
    onSave([...extras, e]); setEditId(e.id);
  };
  const del = async (e: ExtraService) => {
    if (await confirm({ title: "Eliminare l'extra?", message: `"${e.name}" sparisce dal catalogo, dal motore di prenotazione e dal check-in online. Gli extra già venduti restano nelle prenotazioni.`, confirmLabel: "Elimina", danger: true })) { onSave(extras.filter((x) => x.id !== e.id)); setEditId(null); }
  };
  const shown = extras.filter((e) => { const s = q.trim().toLowerCase(); return !s || e.name.toLowerCase().includes(s) || (e.desc ?? "").toLowerCase().includes(s); });
  const unverified = extras.filter((e) => isActive(e) && isPriceUnverified(e)).length;
  const statOf = (e: ExtraService) => stats.find((x) => x.extraId === e.id && x.structureId === structure?.id);
  const confirmAll = () => onSave(extras.map((e) => (isPriceUnverified(e) ? { ...e, confirmed: true } : e)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <SearchInput value={q} onChange={setQ} placeholder="Cerca extra…" className="w-full sm:w-64" />
        <button onClick={add} disabled={addDisabled} className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "var(--focus)" }}>+ Aggiungi extra</button>
      </div>

      {unverified > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--warn,#b7791f)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--warn,#b7791f)_10%,transparent)] px-3 py-2 text-xs text-txt">
          <span><b>{unverified} extra con prezzo di esempio.</b> Non vengono proposti agli ospiti finché non confermi (o modifichi) il prezzo. Attenzione: gli extra attivi compaiono comunque nel motore di prenotazione e nel check-in online.</span>
          <button onClick={confirmAll} className="ml-auto rounded border border-line bg-surface px-2 py-1 text-[11px] font-medium text-txt hover:bg-paper">Confermo tutti i prezzi</button>
        </div>
      )}

      <div className="space-y-2">
        {extras.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-surface"><EmptyState title="Nessun extra per questa struttura" sub="Aggiungi colazione, parcheggio, transfer, late check-out o esperienze con il tuo prezzo: li potrai proporre agli ospiti in un tocco." /></div>
        )}
        {extras.length > 0 && shown.length === 0 && <div className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-faint">Nessun extra trovato.</div>}
        {shown.map((e) => {
          const st = statOf(e);
          const kind = kindOf(e);
          const unv = isPriceUnverified(e);
          return (
            <div key={e.id} className={`rounded-lg border p-2.5 ${isActive(e) ? "border-line bg-paper" : "border-line bg-wash opacity-60"}`}>
              {editId === e.id ? (
                <div className="space-y-1.5">
                  <input value={e.name} onChange={(ev) => upd(e.id, { name: ev.target.value })} placeholder="Nome" className={`${inp} font-semibold`} />
                  <input value={e.desc ?? ""} onChange={(ev) => upd(e.id, { desc: ev.target.value })} placeholder="Descrizione (la vede l'ospite)" className={inp} />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="text-[11px] text-dim">Prezzo €<input type="number" min={0} step="0.5" value={e.price} onChange={(ev) => upd(e.id, { price: Math.max(0, Number(ev.target.value)), confirmed: true })} className={`${inp} mt-0.5`} /></label>
                    <label className="text-[11px] text-dim">Modalità<select value={e.per} onChange={(ev) => upd(e.id, { per: ev.target.value as ExtraService["per"] })} className={`${inp} mt-0.5`}>{(Object.keys(PER_LABEL) as ExtraService["per"][]).map((k) => <option key={k} value={k}>{PER_LABEL[k]}</option>)}</select></label>
                    <label className="text-[11px] text-dim">Categoria<select value={kind} onChange={(ev) => upd(e.id, { kind: ev.target.value as ExtraKind })} className={`${inp} mt-0.5`}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
                    <label className="text-[11px] text-dim">Quantità max<input type="number" min={1} value={e.maxQty ?? ""} placeholder="illimitata" onChange={(ev) => upd(e.id, { maxQty: ev.target.value ? Math.max(1, Math.round(Number(ev.target.value))) : undefined })} className={`${inp} mt-0.5`} /></label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="text-[11px] text-dim">Stagione: da<select value={e.seasonFrom ?? ""} onChange={(ev) => { const v = ev.target.value ? Number(ev.target.value) : undefined; upd(e.id, v ? { seasonFrom: v, seasonTo: e.seasonTo ?? v } : { seasonFrom: undefined, seasonTo: undefined }); }} className={`${inp} mt-0.5`}><option value="">Tutto l&apos;anno</option>{MONTHS_IT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
                    <label className="text-[11px] text-dim">a (incluso)<select value={e.seasonTo ?? ""} disabled={!e.seasonFrom} onChange={(ev) => upd(e.id, { seasonTo: ev.target.value ? Number(ev.target.value) : e.seasonFrom })} className={`${inp} mt-0.5 disabled:opacity-40`}>{MONTHS_IT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
                    <label className="text-[11px] text-dim">Notti minime<input type="number" min={1} value={e.minNights ?? ""} placeholder="nessun minimo" onChange={(ev) => upd(e.id, { minNights: ev.target.value ? Math.max(1, Math.round(Number(ev.target.value))) : undefined })} className={`${inp} mt-0.5`} /></label>
                  </div>
                  <div className="text-[10px] text-faint">Stagione, notti minime e quantità max guidano le <b>proposte</b> di questo modulo; il motore di prenotazione online e il check-in mostrano l&apos;extra finché è attivo.</div>
                  <div className="flex justify-end gap-2"><button onClick={() => del(e)} className="text-xs text-faint hover:text-[color:var(--err)]">Elimina</button><button onClick={() => setEditId(null)} className="rounded bg-focus px-2.5 py-1 text-xs font-semibold text-white">Fatto</button></div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => upd(e.id, { active: !isActive(e) })} title={isActive(e) ? "Disattiva" : "Attiva"} className={`relative h-5 w-9 shrink-0 rounded-full transition ${isActive(e) ? "bg-focus" : "bg-line"}`}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: isActive(e) ? "18px" : "2px" }} /></button>
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-txt">{e.name}
                      <span className="rounded bg-wash px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-faint">{KIND_LABEL[kind]}</span>
                      {hasSeason(e) && <span className="rounded bg-wash px-1.5 py-0.5 text-[9px] font-medium text-faint">{seasonLabel(e)}</span>}
                      {e.minNights ? <span className="rounded bg-wash px-1.5 py-0.5 text-[9px] font-medium text-faint">min {e.minNights} notti</span> : null}
                      {unv && <span className="rounded bg-[color:color-mix(in_srgb,var(--warn,#b7791f)_18%,transparent)] px-1.5 py-0.5 text-[9px] font-semibold text-[color:var(--warn,#b7791f)]">prezzo di esempio</span>}
                      {!(e.price > 0) && <span className="rounded bg-[color:color-mix(in_srgb,var(--err)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-semibold text-[color:var(--err)]">prezzo da impostare</span>}
                    </div>
                    {e.desc && <div className="truncate text-[11px] text-faint">{e.desc}</div>}
                    {st && (st.soldQty > 0 || st.offered > 0) && <div className="text-[11px] text-dim">Venduti {st.soldQty} · {eur(st.soldRevenue)}{st.offered > 0 ? ` · proposto ${st.offered} ${st.offered === 1 ? "volta" : "volte"}` : ""}</div>}
                  </div>
                  <span className="shrink-0 font-mono text-sm font-bold text-txt">{eur(e.price)} <span className="text-[10px] font-normal text-faint">{PER_LABEL[e.per]}</span></span>
                  {unv && <button onClick={() => upd(e.id, { confirmed: true })} className="shrink-0 rounded border border-line bg-surface px-2 py-1 text-[11px] font-medium text-txt hover:bg-paper">Conferma prezzo</button>}
                  <button onClick={() => setEditId(e.id)} className="shrink-0 text-xs font-medium text-focus hover:underline">Modifica</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
