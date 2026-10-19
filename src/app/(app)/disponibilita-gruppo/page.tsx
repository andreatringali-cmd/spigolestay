"use client";

// Gruppo: si scelgono le strutture del gruppo, Xenora riconosce le tipologie e per ciascuna si indica il numero di camere reali.
// Le tipologie con lo stesso nome dividono le stesse camere; la disponibilità resta sincronizzata tra le strutture (portali, calendario, sito diretto).
// Logica in src/lib/inventory-pool.ts.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { POOL_DEF, POOL_KEY, parsePool, poolFamilies, poolListings, poolOccupancy, type PoolConfig } from "@/lib/inventory-pool";
import { CHANNEX_DIRTY_EVENT } from "@/components/ChannexAutoSync";
import { addDays, toISO, parseISO, fmtDM } from "@/lib/dates";
import Toggle from "@/components/Toggle";

const NONE = ""; // famiglia "non condivisa"
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/** Il logo della struttura (se l'ha caricato), altrimenti un pallino con l'iniziale nel suo colore: due strutture con la stessa iniziale e lo stesso colore si distinguono dal logo. */
function Dot({ name, color, logo, size = 22 }: { name: string; color?: string; logo?: string; size?: number }) {
  if (logo) return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt="" aria-hidden className="shrink-0 rounded-full border border-line bg-white object-contain" style={{ width: size, height: size }} />
  );
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ width: size, height: size, fontSize: Math.round(size * 0.46), backgroundColor: color ?? "var(--focus)" }} aria-hidden>
      {(name || "?")[0]?.toUpperCase()}
    </span>
  );
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color, backgroundColor: tint(color, 14) }}>{children}</span>;
}

export default function GruppoPage() {
  const { raw } = useData();
  const [cfg, setCfg] = useState<PoolConfig>(POOL_DEF);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setCfg(parsePool(typeof window === "undefined" ? null : localStorage.getItem(POOL_KEY))); setLoaded(true); }, []);

  const save = (patch: Partial<PoolConfig>) => setCfg((p) => {
    const n = { ...p, ...patch, updatedAt: Date.now() }; // updatedAt: la copia più recente vince quando la configurazione si sincronizza tra account
    try { localStorage.setItem(POOL_KEY, JSON.stringify(n)); window.dispatchEvent(new Event(CHANNEX_DIRTY_EVENT)); } catch { /* storage non disponibile */ }
    return n;
  });

  const structures = raw.structures;
  const sOf = (id: string) => structures.find((s) => s.id === id);
  const sName = (id: string) => sOf(id)?.name ?? "—";
  const sColor = (id: string) => sOf(id)?.photoColor;
  const sLogo = (id: string) => sOf(id)?.logo;
  // Il gruppo si legge anche se ancora spento (la pagina deve poter mostrare le tipologie mentre si imposta).
  const view: PoolConfig = useMemo(() => ({ ...cfg, enabled: true }), [cfg]);
  const listings = useMemo(() => poolListings(view, raw.roomTypes, raw.units), [view, raw.roomTypes, raw.units]);
  const families = useMemo(() => poolFamilies(view, raw.roomTypes, raw.units), [view, raw.roomTypes, raw.units]);
  const unshared = listings.filter((l) => !l.famKey);
  const missing = families.filter((f) => !f.set).length;
  const ready = cfg.structureIds.length >= 2;

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
  const todayIso = days[0];
  const groups = useMemo(() => [
    ...families.map((f) => ({ key: f.key, title: f.name, real: f.real, items: f.listings })),
    ...(unshared.length ? [{ key: "_none", title: "Non condivise", real: undefined as number | undefined, items: unshared }] : []),
  ], [families, unshared]);

  if (!loaded) return <div role="status" aria-live="polite" className="p-6 text-sm text-dim">Caricamento…</div>;
  const sharedRooms = families.reduce((a, f) => a + f.real, 0);
  return (
    <div>
      <PageHeader title="Gruppo" subtitle="Strutture che mostrano le stesse camere: la disponibilità resta sincronizzata tra loro su portali, calendario e sito diretto." />

      {/* 1 · Il gruppo */}
      <Card className="anim-in">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <SectionTitle>Le strutture del gruppo</SectionTitle>
          </div>
          <div className="flex items-center gap-2.5 rounded-full border border-line bg-wash/60 py-1 pl-3 pr-1.5 text-xs font-semibold" style={{ color: cfg.enabled ? "var(--ok)" : "var(--dim)" }}>
            <span className="flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cfg.enabled ? "var(--ok)" : "var(--faint)" }} />{cfg.enabled ? "Gruppo attivo" : "Gruppo spento"}</span>
            <Toggle on={cfg.enabled} onClick={() => save({ enabled: !cfg.enabled })} label="Attiva il gruppo" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {structures.map((st) => {
            const on = cfg.structureIds.includes(st.id);
            return (
              <button key={st.id} type="button" aria-pressed={on} onClick={() => save({ structureIds: on ? cfg.structureIds.filter((x) => x !== st.id) : [...cfg.structureIds, st.id] })}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-semibold transition max-sm:min-h-10 ${on ? "border-focus text-txt" : "border-line text-dim hover:bg-wash"}`}
                style={on ? { backgroundColor: tint("var(--focus)", 9) } : undefined}>
                <Dot name={st.name} color={st.photoColor} logo={st.logo} size={24} />
                {st.name}
                {on && <span aria-hidden className="text-[color:var(--focus)]">✓</span>}
              </button>
            );
          })}
        </div>

        {ready ? (
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-xs text-dim">
            <span><b className="font-mono text-sm text-txt">{cfg.structureIds.length}</b> strutture</span>
            <span><b className="font-mono text-sm text-txt">{families.length}</b> {families.length === 1 ? "tipologia condivisa" : "tipologie condivise"}</span>
            <span><b className="font-mono text-sm text-txt">{sharedRooms}</b> camere reali in comune</span>
          </div>
        ) : (
          <p className="mt-4 rounded-lg px-3 py-2 text-xs" style={{ color: "var(--dim)", backgroundColor: tint("var(--focus)", 7) }}>Seleziona almeno due strutture per impostare il gruppo.</p>
        )}
      </Card>

      {ready && (
        <>
          {/* 2 · Tipologie e camere reali */}
          <div className="mb-3 mt-6 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-txt">Camere reali per tipologia</h2>
              <p className="max-w-2xl text-xs leading-relaxed text-dim">Le tipologie con lo stesso nome in strutture diverse sono la stessa camera. Indica quante ne esistono davvero: Xenora non ne vende più di così, anche se le strutture ne mostrano di più.</p>
            </div>
            {missing > 0 && <button type="button" onClick={confirmAll} className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-wash" style={{ borderColor: tint("var(--warn)", 45), color: "var(--warn)" }}>Conferma i numeri proposti ({missing})</button>}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {families.map((f, i) => (
              <div key={f.key} className="anim-in flex flex-col rounded-xl border border-line bg-surface p-4 shadow-sm" style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold text-txt">{f.name}</div>
                    <div className="mt-1">{f.set ? <Pill color="var(--ok)">✓ Confermato</Pill> : <Pill color="var(--warn)">Da confermare</Pill>}</div>
                  </div>
                  {/* Camere reali: contatore */}
                  <label className="flex shrink-0 flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Camere reali</span>
                    <span className="flex items-center gap-1">
                      <button type="button" onClick={() => setRooms(f.key, String(Math.max(0, f.real - 1)))} disabled={f.real <= 0} aria-label={`Una camera in meno per ${f.name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-line text-lg leading-none text-dim transition hover:bg-wash hover:text-txt disabled:opacity-40">−</button>
                      <input type="number" min={0} inputMode="numeric" value={f.set ? f.real : ""} placeholder={String(f.suggested)} onChange={(e) => setRooms(f.key, e.target.value)} aria-label={`Camere reali di ${f.name}`}
                        className="h-9 w-14 rounded-lg border bg-surface text-center font-mono text-lg font-bold text-txt outline-none focus:border-focus" style={{ borderColor: f.set ? "var(--line)" : tint("var(--warn)", 55) }} />
                      <button type="button" onClick={() => setRooms(f.key, String(f.real + 1))} aria-label={`Una camera in più per ${f.name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-line text-lg leading-none text-dim transition hover:bg-wash hover:text-txt">+</button>
                    </span>
                  </label>
                </div>

                {/* Cosa mostra ogni struttura rispetto alle camere reali */}
                <div className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
                  {f.listings.map((l) => {
                    const over = l.listed > f.real;
                    const pct = f.real > 0 ? Math.min(100, Math.round((l.listed / f.real) * 100)) : 100;
                    return (
                      <div key={l.typeId} className="text-xs">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Dot name={sName(l.structureId)} color={sColor(l.structureId)} logo={sLogo(l.structureId)} size={18} />
                          <span className="font-semibold text-txt">{sName(l.structureId)}</span>
                          <span className="text-dim">{l.name}</span>
                          <span className="ml-auto text-faint"><b className="font-mono font-semibold text-dim">{l.listed}</b> {l.listed === 1 ? "camera" : "camere"} in questa struttura</span>
                          <select value={l.famKey} onChange={(e) => setAssign(l.typeId, e.target.value)} className="rounded-lg border border-line bg-surface px-1.5 py-1 text-[11px] text-dim" aria-label={`Tipologia reale di ${l.name} in ${sName(l.structureId)}`}>
                            {families.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                            <option value={NONE}>Non condivisa</option>
                          </select>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: tint("var(--line)", 100) }} role="img" aria-label={`${l.listed} camere in questa struttura, ${f.real} reali nel gruppo`}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: over ? "var(--warn)" : "var(--ok)", opacity: 0.8 }} />
                        </div>
                        {over && <div className="mt-1 text-[11px]" style={{ color: "var(--warn)" }}>Ha più camere di quelle reali: il gruppo ne vende al massimo {f.real}, in tutte le strutture insieme.</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {unshared.length > 0 && (
              <div className="anim-in flex flex-col rounded-xl border border-dashed border-line p-4 md:col-span-2">
                <div className="text-sm font-bold text-dim">Non condivise</div>
                <p className="text-[11px] text-faint">Queste tipologie non fanno parte del gruppo: la loro disponibilità resta quella della sola struttura.</p>
                <div className="mt-2 flex flex-col divide-y divide-line">
                  {unshared.map((l) => (
                    <div key={l.typeId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-xs">
                      <Dot name={sName(l.structureId)} color={sColor(l.structureId)} logo={sLogo(l.structureId)} size={18} />
                      <span className="font-semibold text-txt">{sName(l.structureId)}</span>
                      <span className="text-dim">{l.name}</span>
                      <span className="font-mono text-faint">{l.listed} in Xenora</span>
                      <select value={NONE} onChange={(e) => setAssign(l.typeId, e.target.value)} className="ml-auto rounded-lg border border-line bg-surface px-1.5 py-1 text-[11px] text-dim" aria-label={`Tipologia reale di ${l.name}`}>
                        <option value={NONE}>Non condivisa</option>
                        {families.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 3 · Anteprima */}
          <Card className="anim-in mt-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <SectionTitle>Anteprima: camere libere nei prossimi 10 giorni</SectionTitle>
                <p className="max-w-2xl text-xs leading-relaxed text-dim">Sono i numeri che Xenora mostra nel Calendario e invia ai portali{cfg.enabled ? "" : " quando attivi il gruppo"}.</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill color="var(--err)">0 · completo</Pill>
                <Pill color="var(--warn)">1 · ultima</Pill>
                <Pill color="var(--ok)">2+ · libere</Pill>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[680px] border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-wash px-3 py-2 text-left font-semibold text-dim">Struttura · tipologia</th>
                    {days.map((d) => {
                      const dt = parseISO(d); const wk = dt.getDay() === 0 || dt.getDay() === 6; const today = d === todayIso;
                      return (
                        <th key={d} className="px-1 py-1.5 text-center font-medium" style={{ backgroundColor: today ? tint("var(--focus)", 12) : undefined, color: today ? "var(--focus)" : wk ? "var(--err)" : "var(--faint)" }}>
                          <div className="text-[10px] uppercase">{today ? "Oggi" : dt.toLocaleDateString("it-IT", { weekday: "short" })}</div>
                          <div className="font-mono">{fmtDM(dt)}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.key}>
                      <tr key={g.key + "-h"}>
                        <td colSpan={days.length + 1} className="sticky left-0 border-t border-line bg-wash/60 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-dim">
                          {g.title}{g.real !== undefined && <span className="ml-2 font-mono font-semibold normal-case text-faint">{g.real} {g.real === 1 ? "camera reale" : "camere reali"}</span>}
                        </td>
                      </tr>
                      {g.items.map((l) => (
                        <tr key={l.typeId}>
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5">
                            <span className="inline-flex items-center gap-2"><Dot name={sName(l.structureId)} color={sColor(l.structureId)} logo={sLogo(l.structureId)} size={16} /><span className="font-medium text-txt">{sName(l.structureId)}</span><span className="text-dim">{l.name}</span></span>
                          </td>
                          {days.map((d) => {
                            const a = occ.availFor(l.typeId, d);
                            const tone = a <= 0 ? "var(--err)" : a === 1 ? "var(--warn)" : "var(--ok)";
                            return <td key={d} className="px-0.5 py-0.5 text-center" style={d === todayIso ? { backgroundColor: tint("var(--focus)", 6) } : undefined}><span className="inline-block min-w-[2rem] rounded-md px-1 py-1 font-mono font-semibold tabular-nums" style={{ color: tone, backgroundColor: tint(tone, 14) }}>{a}</span></td>;
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {missing > 0 && <p className="mt-3 rounded-lg px-3 py-2 text-[11px]" style={{ color: "var(--warn)", backgroundColor: tint("var(--warn)", 10) }}>Alcuni numeri di camere reali sono solo proposti: confermali per applicare la regola con i tuoi valori.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
