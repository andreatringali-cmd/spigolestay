"use client";

// Disponibilità di gruppo: si scelgono le strutture del gruppo, Xenora riconosce le tipologie e accanto a ciascuna si indica il numero di camere
// reali. Le tipologie con lo stesso nome dividono le stesse camere; la disponibilità resta sincronizzata tra le strutture (portali, calendario, sito diretto).
// Logica in src/lib/inventory-pool.ts.
import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { POOL_DEF, POOL_KEY, parsePool, poolFamilies, poolListings, poolOccupancy, type PoolConfig } from "@/lib/inventory-pool";
import { CHANNEX_DIRTY_EVENT } from "@/components/ChannexAutoSync";
import { addDays, toISO, parseISO } from "@/lib/dates";

const NONE = ""; // famiglia "non condivisa"

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? "var(--focus)" : "var(--line)" }}>
      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? 22 : 2 }} />
    </button>
  );
}

export default function CamereCondivisePage() {
  const { raw } = useData();
  const [cfg, setCfg] = useState<PoolConfig>(POOL_DEF);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setCfg(parsePool(typeof window === "undefined" ? null : localStorage.getItem(POOL_KEY))); setLoaded(true); }, []);

  const save = (patch: Partial<PoolConfig>) => setCfg((p) => {
    const n = { ...p, ...patch };
    try { localStorage.setItem(POOL_KEY, JSON.stringify(n)); window.dispatchEvent(new Event(CHANNEX_DIRTY_EVENT)); } catch { /* storage non disponibile */ }
    return n;
  });

  const structures = raw.structures;
  const sName = (id: string) => structures.find((s) => s.id === id)?.name ?? "—";
  // Il gruppo si legge anche se ancora spento (la pagina deve poter mostrare le tipologie mentre si imposta).
  const view: PoolConfig = useMemo(() => ({ ...cfg, enabled: true }), [cfg]);
  const listings = useMemo(() => poolListings(view, raw.roomTypes, raw.units), [view, raw.roomTypes, raw.units]);
  const families = useMemo(() => poolFamilies(view, raw.roomTypes, raw.units), [view, raw.roomTypes, raw.units]);
  const unshared = listings.filter((l) => !l.famKey);
  const missing = families.filter((f) => !f.set).length;

  const setRooms = (key: string, v: string) => {
    const rooms = { ...(cfg.rooms ?? {}) };
    const n = Math.floor(Number(v));
    if (v === "" || !Number.isFinite(n) || n < 0) delete rooms[key]; else rooms[key] = n;
    save({ rooms });
  };
  const confirmAll = () => { const rooms = { ...(cfg.rooms ?? {}) }; families.forEach((f) => { if (!f.set) rooms[f.key] = f.suggested; }); save({ rooms }); };
  const setAssign = (typeId: string, fam: string) => save({ assign: { ...(cfg.assign ?? {}), [typeId]: fam } });

  // Anteprima: disponibilità dei prossimi 10 giorni con le regole impostate.
  const occ = useMemo(() => poolOccupancy(view, raw.roomTypes, raw.units, raw.bookings), [view, raw.roomTypes, raw.units, raw.bookings]);
  const days = useMemo(() => Array.from({ length: 10 }, (_, i) => toISO(addDays(new Date(), i))), []);

  if (!loaded) return null;
  return (
    <div>
      <PageHeader title="Disponibilità gruppo (beta)" subtitle="Strutture che mostrano le stesse camere: la disponibilità resta sincronizzata tra loro su portali, calendario e sito diretto." />

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <SectionTitle>Gruppo di strutture</SectionTitle>
            <p className="max-w-2xl text-xs text-dim">Scegli le strutture che hanno camere in comune (per esempio nello stesso edificio). Se una camera viene prenotata in una struttura, la disponibilità dell&apos;altra scende da sola. Vale per Booking, Expedia, HotelBeds, per il sito diretto e per il Calendario.</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-dim">{cfg.enabled ? "Attivo" : "Spento"} <Toggle on={cfg.enabled} onClick={() => save({ enabled: !cfg.enabled })} /></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {structures.map((st) => {
            const on = cfg.structureIds.includes(st.id);
            return (
              <button key={st.id} type="button" aria-pressed={on} onClick={() => save({ structureIds: on ? cfg.structureIds.filter((x) => x !== st.id) : [...cfg.structureIds, st.id] })}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${on ? "border-focus text-focus" : "border-line text-dim hover:bg-wash"}`}
                style={on ? { backgroundColor: "color-mix(in srgb, var(--focus) 10%, transparent)" } : undefined}>{st.name}</button>
            );
          })}
        </div>
        {cfg.structureIds.length < 2 && <p className="mt-3 text-xs text-faint">Seleziona almeno due strutture per impostare il gruppo.</p>}
      </Card>

      {cfg.structureIds.length >= 2 && (
        <>
          <Card className="mt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <SectionTitle>Tipologie e camere reali</SectionTitle>
                <p className="max-w-2xl text-xs text-dim">Le tipologie con lo stesso nome, in strutture diverse, sono la stessa camera e vengono raggruppate. Accanto a ciascuna scrivi quante camere esistono davvero: le camere mostrate in Xenora possono essere di più, ma non si vendono più delle reali.</p>
              </div>
              {missing > 0 && <button type="button" onClick={confirmAll} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus transition hover:bg-wash">Conferma i numeri proposti ({missing})</button>}
            </div>

            <div className="mt-4 flex flex-col gap-4">
              {families.map((f) => (
                <div key={f.key} className="rounded-xl border border-line bg-paper p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-txt">{f.name}</div>
                    <label className="flex items-center gap-2 text-xs font-medium text-dim">Camere reali
                      <input type="number" min={0} inputMode="numeric" value={f.set ? f.real : ""} placeholder={String(f.suggested)} onChange={(e) => setRooms(f.key, e.target.value)}
                        className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-center font-mono text-sm text-txt" />
                      {!f.set && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: "var(--warn)", backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)" }}>da confermare</span>}
                    </label>
                  </div>
                  <div className="mt-2 flex flex-col divide-y divide-line">
                    {f.listings.map((l) => (
                      <div key={l.typeId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
                        <span className="min-w-[8rem] font-medium text-txt">{sName(l.structureId)}</span>
                        <span className="text-dim">{l.name}</span>
                        <span className="font-mono text-faint">{l.listed} {l.listed === 1 ? "camera" : "camere"} in Xenora</span>
                        <select value={l.famKey} onChange={(e) => setAssign(l.typeId, e.target.value)} className="ml-auto rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-txt" aria-label={`Tipologia reale di ${l.name} in ${sName(l.structureId)}`}>
                          {families.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                          <option value={NONE}>Non condivisa</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {unshared.length > 0 && (
                <div className="rounded-xl border border-dashed border-line p-3">
                  <div className="text-sm font-semibold text-dim">Non condivise</div>
                  <p className="text-[11px] text-faint">Queste tipologie non fanno parte del gruppo: la loro disponibilità resta quella della sola struttura.</p>
                  <div className="mt-2 flex flex-col divide-y divide-line">
                    {unshared.map((l) => (
                      <div key={l.typeId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
                        <span className="min-w-[8rem] font-medium text-txt">{sName(l.structureId)}</span>
                        <span className="text-dim">{l.name}</span>
                        <span className="font-mono text-faint">{l.listed} in Xenora</span>
                        <select value={NONE} onChange={(e) => setAssign(l.typeId, e.target.value)} className="ml-auto rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-txt" aria-label={`Tipologia reale di ${l.name}`}>
                          <option value={NONE}>Non condivisa</option>
                          {families.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card className="mt-4">
            <SectionTitle>Anteprima disponibilità</SectionTitle>
            <p className="mb-3 text-xs text-dim">Camere libere dei prossimi 10 giorni con queste regole: sono i numeri che Xenora mostra nel Calendario e invia ai portali{cfg.enabled ? "" : " (quando attivi il gruppo)"}.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-surface px-2 py-1.5 text-left font-semibold text-dim">Struttura · tipologia</th>
                    {days.map((d) => <th key={d} className="px-1 py-1.5 text-center font-mono font-medium text-faint">{parseISO(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={l.typeId}>
                      <td className="sticky left-0 whitespace-nowrap bg-surface px-2 py-1 text-txt"><span className="font-medium">{sName(l.structureId)}</span> · <span className="text-dim">{l.name}</span></td>
                      {days.map((d) => {
                        const a = occ.availFor(l.typeId, d);
                        const tone = a <= 0 ? "var(--err)" : a === 1 ? "var(--warn)" : "var(--ok)";
                        return <td key={d} className="px-0.5 py-0.5 text-center"><span className="inline-block min-w-[1.75rem] rounded-md px-1 py-1 font-mono font-semibold tabular-nums" style={{ color: tone, backgroundColor: `color-mix(in srgb, ${tone} 14%, transparent)` }}>{a}</span></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missing > 0 && <p className="mt-3 text-[11px]" style={{ color: "var(--warn)" }}>Alcuni numeri di camere reali sono solo proposti: confermali per applicare la regola con i tuoi valori.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
