"use client";

// Finestre di azione della vista Camere · Dettagliata: fuori servizio (con motivo e avviso sulle prenotazioni),
// codice d'accesso e tariffa base. Ognuna risolve davvero il problema, senza portare in un'altra pagina.
import { useState, type ReactNode } from "react";
import { useData } from "@/lib/store";
import type { Booking, RoomType, Unit } from "@/lib/types";
import { eur } from "@/lib/format";
import { dayLabel, saveAccessCode } from "./_modello";

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Chiudi" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-display text-lg font-bold text-txt">{title}</h2><button onClick={onClose} className="rounded px-2 py-1 text-dim hover:bg-wash" aria-label="Chiudi">✕</button></div>
        {children}
      </div>
    </div>
  );
}

const Footer = ({ onClose, onOk, okLabel, disabled, danger }: { onClose: () => void; onOk: () => void; okLabel: string; disabled?: boolean; danger?: boolean }) => (
  <div className="mt-4 flex items-center justify-end gap-2">
    <button onClick={onClose} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
    <button onClick={onOk} disabled={disabled} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: danger ? "var(--err)" : "var(--focus)" }}>{okLabel}</button>
  </div>
);

// Metti fuori servizio: motivo facoltativo; se ci sono prenotazioni in corso o future lo dice chiaramente e chiede conferma.
export function FuoriServizioDialog({ unit, openBookings, guestName, onClose }: { unit: Unit; openBookings: Booking[]; guestName: (b: Booking) => string; onClose: () => void }) {
  const { updateUnit, addActivity } = useData();
  const [reason, setReason] = useState("");
  const n = openBookings.length;
  const apply = () => {
    const r = reason.trim();
    updateUnit(unit.id, { outOfService: true, oosReason: r || undefined });
    addActivity("config", `Camera fuori servizio — ${unit.name}${r ? " · " + r : ""}`, unit.structureId);
    onClose();
  };
  return (
    <Dialog title={`Metti fuori servizio · ${unit.name}`} onClose={onClose}>
      {n > 0 && (
        <div className="mb-3 rounded-lg border p-3 text-sm" style={{ borderColor: "color-mix(in srgb, var(--warn) 45%, var(--line))", backgroundColor: "color-mix(in srgb, var(--warn) 10%, transparent)" }}>
          <div className="font-semibold text-txt">{n === 1 ? "Questa camera ha 1 prenotazione in corso o futura" : `Questa camera ha ${n} prenotazioni in corso o future`}</div>
          <p className="mt-0.5 text-xs text-dim">Restano assegnate a una camera fuori servizio: nel calendario compariranno con l&apos;avviso «serve un&apos;altra camera». Dovrai spostarle tu.</p>
          <ul className="mt-2 space-y-0.5 text-xs text-dim">
            {openBookings.slice(0, 4).map((b) => <li key={b.id} className="truncate"><span className="font-medium text-txt">{guestName(b)}</span> · <span className="capitalize">{dayLabel(b.checkIn)}</span> → <span className="capitalize">{dayLabel(b.checkOut)}</span></li>)}
            {n > 4 && <li className="text-faint">… e altre {n - 4}</li>}
          </ul>
        </div>
      )}
      <label className={lbl}>Motivo <span className="font-normal text-faint">(facoltativo)</span>
        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} className={`${inp} mt-1`} placeholder="Es. ristrutturazione, perdita d'acqua…" />
      </label>
      <Footer onClose={onClose} onOk={apply} okLabel={n > 0 ? "Metti fuori servizio comunque" : "Metti fuori servizio"} danger={n > 0} />
    </Dialog>
  );
}

// Codice d'accesso della camera: stesso formato (etichetta + valore) della Guida ospiti.
export function CodiceDialog({ unit, onClose, onSaved }: { unit: Unit; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState("Porta");
  const [value, setValue] = useState("");
  const [err, setErr] = useState(false);
  const ok = label.trim() !== "" && value.trim() !== "";
  const save = () => { if (!ok) return; if (saveAccessCode(unit.id, label, value.trim())) { onSaved(); onClose(); } else setErr(true); };
  return (
    <Dialog title={`Codice d'accesso · ${unit.name}`} onClose={onClose}>
      <p className="mb-3 text-xs text-dim">Viaggia solo nel link personale dell&apos;ospite, mai nella guida pubblica. Altri codici (cancello, portone…) si gestiscono dalla Guida ospiti.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={lbl}>Etichetta<input value={label} onChange={(e) => setLabel(e.target.value)} className={`${inp} mt-1`} placeholder="Porta, Cancello, Portone…" /></label>
        <label className={lbl}>Codice<input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} className={`${inp} mt-1 font-mono`} placeholder="1234" inputMode="text" autoComplete="off" /></label>
      </div>
      {err && <p className="mt-2 text-xs" style={{ color: "var(--err)" }}>Impossibile salvare il codice su questo dispositivo.</p>}
      <Footer onClose={onClose} onOk={save} okLabel="Salva codice" disabled={!ok} />
    </Dialog>
  );
}

// Tariffa base della tipologia (vale per tutte le camere della tipologia).
export function TariffaDialog({ rt, units, onClose }: { rt: RoomType; units: number; onClose: () => void }) {
  const { updateRoomType } = useData();
  const [v, setV] = useState(rt.basePrice > 0 ? String(rt.basePrice) : "");
  const n = Number(v.replace(",", "."));
  const ok = Number.isFinite(n) && n > 0;
  const save = () => { if (!ok) return; updateRoomType(rt.id, { basePrice: Math.round(n * 100) / 100 }); onClose(); };
  return (
    <Dialog title={`Tariffa base · ${rt.name}`} onClose={onClose}>
      <p className="mb-3 text-xs text-dim">La tariffa base appartiene alla tipologia: si applica a {units === 1 ? "la 1 camera" : `tutte le ${units} camere`} di «{rt.name}».</p>
      <label className={lbl}>Prezzo per notte (€)
        <input autoFocus type="number" min={0} step="0.5" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} className={`${inp} mt-1 font-mono`} placeholder="Es. 90" />
      </label>
      {ok && <p className="mt-2 text-xs text-faint">Verrà salvata come {eur(n)} a notte.</p>}
      <Footer onClose={onClose} onOk={save} okLabel="Salva tariffa" disabled={!ok} />
    </Dialog>
  );
}
