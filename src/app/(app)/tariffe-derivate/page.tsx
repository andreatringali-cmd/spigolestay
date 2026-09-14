"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import type { RoomType } from "@/lib/types";
import { AV_COLORS } from "@/lib/users";
import { effectiveBase, effectiveMinStay, effectiveClosed } from "@/lib/pricing";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";
const typeColor = (rt: RoomType, i: number) => rt.color ?? AV_COLORS[i % AV_COLORS.length];

const PLANS_KEY = "spigolestay:rateplans";
const DEFAULT_PLAN_NAMES = ["Standard", "Colazione inclusa", "Non rimborsabile", "Flessibile"];
function loadPlanNames(): string[] {
  try { const p = localStorage.getItem(PLANS_KEY); if (p) { const arr = JSON.parse(p) as { name: string }[]; const n = arr.map((x) => x.name).filter(Boolean); if (n.length) return n; } } catch {}
  return DEFAULT_PLAN_NAMES;
}
const scartoOf = (rt: RoomType) => { const v = rt.deriveValue ?? 0; const sign = v >= 0 ? "+" : ""; return rt.deriveMode === "amount" ? `${sign}${v} €` : `${sign}${v}%`; };

// Iconcine ospiti (occupazione della tariffa)
function Occ({ n }: { n: number }) {
  const c = Math.max(1, Math.min(Math.round(n) || 1, 8));
  return (
    <span className="inline-flex items-center gap-0.5 align-middle text-dim" title={`${c} ${c === 1 ? "ospite" : "ospiti"}`}>
      {Array.from({ length: c }).map((_, i) => (
        <svg key={i} width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 8a7 7 0 1114 0H3z" /></svg>
      ))}
    </span>
  );
}
// Icona catena (derivata: condivide le camere della madre)
function Catena() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 15l6-6" /><path d="M11 6l1-1a4 4 0 015.66 5.66l-1 1" /><path d="M13 18l-1 1a4 4 0 01-5.66-5.66l1-1" /></svg>;
}

// Modale creazione/modifica tariffa derivata (stile Octorate)
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[6vh]">
      <button aria-label={t("Chiudi")} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{title}</h2><button onClick={onClose} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
        {children}
      </div>
    </div>
  );
}
function Toggle({ on, onClick, color = "var(--focus)" }: { on: boolean; onClick?: () => void; color?: string }) {
  return <button type="button" onClick={onClick} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? color : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>;
}

export default function TariffeDerivatePage() {
  const router = useRouter();
  const { t } = useLang();
  const { structures, roomTypes, units, activeStructureId, deleteRoomType } = useData();
  const ask = useConfirm();
  const [localS, setLocalS] = useState("all");
  const [view, setView] = useState<"table" | "map">("table");
  const [derivModal, setDerivModal] = useState<null | { structureId: string; parentId?: string; editId?: string }>(null);
  const [derivOpen, setDerivOpen] = useState<Set<string>>(new Set()); // vuoto = tutte chiuse all'apertura
  const toggleDeriv = (id: string) => setDerivOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const scoped = structures.filter((s) => (activeStructureId === "all" ? localS === "all" || s.id === localS : s.id === activeStructureId));

  return (
    <div>
      <PageHeader
        title={t("Tariffe derivate")}
        subtitle={t("Tariffe collegate a una tipologia (es. uso singola, non rimborsabile). Seguono il prezzo della madre con uno scarto e condividono le stesse camere.")}
        actions={activeStructureId === "all" ? (
          <select value={localS} onChange={(e) => setLocalS(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus">
            <option value="all">{t("Tutte le strutture")}</option>
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : null}
      />

      {/* Barra: vista Tabella / Mappa + legenda */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-dim shadow-sm">
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          <button onClick={() => setView("table")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition ${view === "table" ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5h18M3 12h18M3 19h18" /></svg>{t("Tabella")}
          </button>
          <button onClick={() => setView("map")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition ${view === "map" ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M12 12H6v4M12 12h6v4" /></svg>{t("Mappa")}
          </button>
        </div>
        <span className="h-4 w-px bg-line" />
        <span className="font-semibold uppercase tracking-wide text-faint">{t("Legenda")}</span>
        <span className="flex items-center gap-1.5"><span className="rounded-full bg-wash px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-dim">master</span> {t("tipologia con camere proprie")}</span>
        <span className="flex items-center gap-1.5"><span className="text-focus"><Catena /></span> {t("derivata: condivide le camere della madre")}</span>
        <span className="flex items-center gap-1.5"><span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--err) 15%, transparent)", color: "var(--err)" }}>−10%</span> {t("scarto sul prezzo della madre")}</span>
      </div>

      {scoped.length === 0 && <Card><div className="py-8 text-center text-sm text-faint">{t("Nessuna struttura. Creane una in")} <Link href="/strutture" className="text-focus underline">{t("Strutture")}</Link>.</div></Card>}

      <div className="flex flex-col gap-6">
        {scoped.map((s) => {
          const types = roomTypes.filter((rt) => rt.structureId === s.id);
          const sUnits = units.filter((u) => u.structureId === s.id);
          const masters = types.filter((rt) => !rt.deriveFrom || !types.some((x) => x.id === rt.deriveFrom));
          const kidsOf = (id: string) => types.filter((x) => x.deriveFrom === id);
          const hasAnyDeriv = types.some((rt) => rt.deriveFrom);
          return (
            <div key={s.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="font-display text-lg font-bold text-txt">{s.name}</div>
                <button onClick={() => setDerivModal({ structureId: s.id })} disabled={masters.length === 0} className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">＋ {t("Crea tariffa derivata")}</button>
              </div>

              {types.length === 0 ? (
                <Card><div className="py-6 text-center text-sm text-faint">{t("Nessuna tipologia in questa struttura. Creane una in")} <Link href="/camere" className="text-focus underline">{t("Camere")}</Link>.</div></Card>
              ) : view === "map" ? (
                <DerivMap
                  types={types}
                  sUnits={sUnits}
                  onAdd={(pid) => setDerivModal({ structureId: s.id, parentId: pid })}
                  onEdit={(id) => setDerivModal({ structureId: s.id, editId: id })}
                  onOpenType={(id) => router.push(`/camere/tipologia/${id}`)}
                  onDelete={async (id, name) => { if (await ask({ title: t("Elimina tariffa derivata"), message: `${t("Eliminare")} "${name}"?`, danger: true, confirmLabel: t("Elimina") })) deleteRoomType(id); }}
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[920px] text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                          <th className="px-3 py-2.5 font-semibold">{t("Nome")}</th>
                          <th className="px-3 py-2.5 text-center font-semibold">{t("Camere")}</th>
                          <th className="px-3 py-2.5 text-center font-semibold">{t("Ospiti")}</th>
                          <th className="px-3 py-2.5 font-semibold">{t("Tariffa")}</th>
                          <th className="px-3 py-2.5 font-semibold">{t("Piano")}</th>
                          <th className="px-3 py-2.5 text-center font-semibold">{t("Notti min.")}</th>
                          <th className="px-3 py-2.5 font-semibold">{t("Stato")}</th>
                          <th className="px-3 py-2.5 font-semibold"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {masters.map((rt) => {
                          const idx = types.findIndex((x) => x.id === rt.id);
                          const color = typeColor(rt, idx);
                          const kids = kidsOf(rt.id);
                          const open = derivOpen.has(rt.id);
                          const nCam = sUnits.filter((u) => u.roomTypeId === rt.id).length;
                          const mMin = effectiveMinStay(rt, roomTypes);
                          const mClosed = effectiveClosed(rt, roomTypes);
                          return (
                            <Fragment key={rt.id}>
                              <tr className="border-b border-line last:border-0">
                                <td className="px-3 py-2.5">
                                  <div className="flex min-w-0 items-center gap-2">
                                    {kids.length > 0 ? (
                                      <button onClick={() => toggleDeriv(rt.id)} className="shrink-0 text-faint hover:text-txt" title={open ? t("Comprimi") : t("Espandi")}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}><polyline points="9 18 15 12 9 6" /></svg>
                                      </button>
                                    ) : <span className="inline-block w-3 shrink-0" />}
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                    <span className="truncate font-semibold text-txt">{rt.name}</span>
                                    <span className="shrink-0 rounded-full bg-wash px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-dim">master</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-center font-mono text-dim">{nCam}</td>
                                <td className="px-3 py-2.5 text-center"><Occ n={rt.maxOccupancy ?? rt.beds} /></td>
                                <td className="px-3 py-2.5 font-mono text-dim">{eur(effectiveBase(rt, roomTypes))}<span className="text-[10px] text-faint">{t("/notte")}</span></td>
                                <td className="px-3 py-2.5 text-xs text-faint">—</td>
                                <td className="px-3 py-2.5 text-center font-mono text-dim">{Math.max(1, mMin || 1)}</td>
                                <td className="px-3 py-2.5">{mClosed
                                  ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--err) 15%, transparent)", color: "var(--err)" }}>{t("Chiusa")}</span>
                                  : <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 15%, transparent)", color: "var(--ok)" }}>{t("In vendita")}</span>}</td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button onClick={() => setDerivModal({ structureId: s.id, parentId: rt.id })} className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-focus hover:bg-wash">＋ {t("Derivata")}</button>
                                    <button onClick={() => router.push(`/camere/tipologia/${rt.id}`)} className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-dim hover:bg-wash">{t("Modifica")}</button>
                                  </div>
                                </td>
                              </tr>
                              {open && kids.map((k) => { const kMin = effectiveMinStay(k, roomTypes); const kClosed = effectiveClosed(k, roomTypes); return (
                                <tr key={k.id} className="border-b border-line bg-[color:color-mix(in_srgb,var(--focus)_4%,transparent)] last:border-0">
                                  <td className="px-3 py-2.5">
                                    <div className="flex min-w-0 items-center gap-2 pl-6">
                                      <span className="shrink-0 text-focus" title={t("Condivide le camere della tipologia madre")}><Catena /></span>
                                      <span className="truncate font-medium text-txt">{k.name}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-center" title={t("Condivide le camere della madre")}><span className="inline-flex justify-center text-focus"><Catena /></span></td>
                                  <td className="px-3 py-2.5 text-center"><Occ n={k.maxOccupancy ?? k.beds} /></td>
                                  <td className="px-3 py-2.5">
                                    <span className="mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: `color-mix(in srgb, ${(k.deriveValue ?? 0) >= 0 ? "var(--ok)" : "var(--err)"} 15%, transparent)`, color: (k.deriveValue ?? 0) >= 0 ? "var(--ok)" : "var(--err)" }}>{scartoOf(k)}</span>
                                    <span className="font-mono text-dim">{eur(effectiveBase(k, roomTypes))}</span>
                                  </td>
                                  <td className="px-3 py-2.5">{k.ratePlan ? <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{k.ratePlan}</span> : <span className="text-xs text-faint">—</span>}</td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className="font-mono text-dim">{Math.max(1, kMin || 1)}</span>
                                    {k.restrictionsInherit && <span className="ml-1 text-focus" title={t("Ereditate dalla madre")}><Catena /></span>}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    {kClosed
                                      ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--err) 15%, transparent)", color: "var(--err)" }}>{t("Chiusa")}</span>
                                      : <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 15%, transparent)", color: "var(--ok)" }}>{t("In vendita")}</span>}
                                    {k.deriveInherit && <span className="ml-1 align-middle text-focus" title={t("Disponibilità ereditata dalla madre")}><Catena /></span>}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button onClick={() => setDerivModal({ structureId: s.id, editId: k.id })} className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-dim hover:bg-wash">{t("Modifica")}</button>
                                      <button onClick={async () => { if (await ask({ title: t("Elimina tariffa derivata"), message: `${t("Eliminare")} "${k.name}"?`, danger: true, confirmLabel: t("Elimina") })) deleteRoomType(k.id); }} title={t("Elimina")} className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-[color:var(--err)] hover:bg-wash">✕</button>
                                    </div>
                                  </td>
                                </tr>
                              ); })}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!hasAnyDeriv && <div className="border-t border-line px-3 py-3 text-center text-xs text-faint">{t("Nessuna tariffa derivata. Usa “＋ Derivata” su una tipologia o “Crea tariffa derivata”.")}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {derivModal && <DerivataModal structureId={derivModal.structureId} parentId={derivModal.parentId} editId={derivModal.editId} onClose={() => setDerivModal(null)} />}
    </div>
  );
}

// Vista Mappa: albero master → derivate con connettori etichettati con lo scarto (stile Octorate).
function DerivMap({ types, sUnits, onAdd, onEdit, onOpenType, onDelete }: {
  types: RoomType[];
  sUnits: { roomTypeId: string }[];
  onAdd: (parentId: string) => void;
  onEdit: (id: string) => void;
  onOpenType: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const { roomTypes } = useData();
  const { t } = useLang();
  const kidsOf = (id: string) => types.filter((x) => x.deriveFrom === id);
  const masters = types.filter((rt) => !rt.deriveFrom || !types.some((x) => x.id === rt.deriveFrom));

  const Node = ({ rt, seen = new Set<string>() }: { rt: RoomType; seen?: Set<string> }) => {
    if (seen.has(rt.id)) return null;
    const ns = new Set(seen); ns.add(rt.id);
    const kids = kidsOf(rt.id);
    const derived = !!rt.deriveFrom;
    const idx = types.findIndex((x) => x.id === rt.id);
    const color = typeColor(rt, idx);
    const nCam = sUnits.filter((u) => u.roomTypeId === rt.id).length;
    return (
      <div className="flex flex-col items-center">
        <div className="w-[236px] overflow-hidden rounded-xl border bg-surface shadow-sm" style={{ borderColor: derived ? "var(--line)" : "color-mix(in srgb, var(--focus) 40%, var(--line))" }}>
          <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
          <div className="p-3">
            <div className="flex items-center justify-between gap-2">
              <Occ n={rt.maxOccupancy ?? rt.beds} />
              {derived
                ? <span className="inline-flex items-center gap-1 text-[11px] text-focus" title={t("Condivide le camere della madre")}><Catena /> {t("derivata")}</span>
                : <span className="text-[11px] text-faint">{nCam} {nCam === 1 ? t("camera") : t("camere")}</span>}
            </div>
            <div className="mt-1 truncate text-sm font-bold text-txt" title={rt.name}>{rt.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-sm font-semibold text-txt">{eur(effectiveBase(rt, roomTypes))}</span>
              {derived && rt.ratePlan && <span className="rounded-full bg-wash px-1.5 py-0.5 text-[10px] text-dim">{rt.ratePlan}</span>}
              {!derived && <span className="rounded-full bg-wash px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-dim">master</span>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-xs">
            <button onClick={() => onAdd(rt.id)} className="font-semibold text-focus hover:underline">＋ {t("Derivata")}</button>
            {derived ? (
              <span className="flex items-center gap-2.5">
                <button onClick={() => onEdit(rt.id)} className="font-medium text-dim hover:underline">{t("Modifica")}</button>
                <button onClick={() => onDelete(rt.id, rt.name)} title={t("Elimina")} className="font-medium text-[color:var(--err)] hover:underline">✕</button>
              </span>
            ) : (
              <button onClick={() => onOpenType(rt.id)} className="font-medium text-dim hover:underline">{t("Modifica")}</button>
            )}
          </div>
        </div>
        {kids.length > 0 && (
          <>
            <div className="h-5 w-px bg-line" />
            <div className="flex items-start gap-6">
              {kids.map((k) => (
                <div key={k.id} className="flex flex-col items-center">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: (k.deriveValue ?? 0) >= 0 ? "var(--ok)" : "var(--err)" }}>{scartoOf(k)}</span>
                  <div className="h-3 w-px bg-line" />
                  <Node rt={k} seen={ns} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-[color:color-mix(in_srgb,var(--focus)_3%,var(--surface))] shadow-sm">
      <div className="flex min-w-max items-start gap-10 p-5">
        {masters.map((rt) => <Node key={rt.id} rt={rt} />)}
      </div>
    </div>
  );
}

function DerivataModal({ structureId, parentId, editId, onClose }: { structureId: string; parentId?: string; editId?: string; onClose: () => void }) {
  const { roomTypes, addRoomType, updateRoomType, deleteRoomType, addActivity } = useData();
  const { t } = useLang();
  const ask = useConfirm();
  const types = roomTypes.filter((rt) => rt.structureId === structureId);
  const editing = editId ? types.find((x) => x.id === editId) : undefined;
  const [planNames, setPlanNames] = useState<string[]>(DEFAULT_PLAN_NAMES);
  useEffect(() => { setPlanNames(loadPlanNames()); }, []);

  // Evita cicli: una tariffa non può basarsi su una sua discendente.
  const descends = (a: RoomType | undefined, targetId: string, guard = new Set<string>()): boolean => {
    if (!a?.deriveFrom || guard.has(a.id)) return false; guard.add(a.id);
    if (a.deriveFrom === targetId) return true;
    return descends(types.find((x) => x.id === a.deriveFrom), targetId, guard);
  };
  const parentOptions = types.filter((x) => x.id !== editId && !(editId && descends(x, editId)));

  const initParent = editing?.deriveFrom ?? parentId ?? parentOptions[0]?.id ?? "";
  const parentOf = (id: string) => types.find((x) => x.id === id);

  const [name, setName] = useState(editing?.name ?? "");
  const [basedOn, setBasedOn] = useState(initParent);
  const [adults, setAdults] = useState<number>(editing?.maxAdults ?? editing?.maxOccupancy ?? 1);
  const [children, setChildren] = useState<number>(editing?.maxChildren ?? 0);
  const [infants, setInfants] = useState<number>(editing?.infants ?? 0);
  const [ratePlan, setRatePlan] = useState<string>(editing?.ratePlan ?? "");
  const [mode, setMode] = useState<"percent" | "amount">(editing?.deriveMode ?? "percent");
  const [value, setValue] = useState<number>(editing?.deriveValue ?? -10);
  const [inheritAvail, setInheritAvail] = useState<boolean>(editing?.deriveInherit ?? true);
  const [inheritLos, setInheritLos] = useState<boolean>(editing?.restrictionsInherit ?? true);
  const [salesClosed, setSalesClosed] = useState<boolean>(editing?.salesClosed ?? false);

  const parent = parentOf(basedOn);
  const parentBase = parent ? effectiveBase(parent, roomTypes) : 0;
  const preview = Math.max(0, Math.round(mode === "percent" ? parentBase * (1 + value / 100) : parentBase + value));
  const suggestedName = parent ? `${parent.name} · ${ratePlan || t("derivata")}` : t("Tariffa derivata");

  const num = (v: string, min = 0) => (v === "" ? min : Math.max(min, Math.floor(Number(v)) || 0));
  const canSave = !!basedOn && !!(name.trim() || suggestedName);

  const save = () => {
    if (!basedOn || !parent) return;
    const finalName = name.trim() || suggestedName;
    const patch: Partial<RoomType> = {
      name: finalName,
      deriveFrom: basedOn,
      deriveMode: mode,
      deriveValue: value,
      deriveRound: true,
      deriveInherit: inheritAvail,
      restrictionsInherit: inheritLos,
      salesClosed,
      ratePlan: ratePlan || undefined,
      maxAdults: adults,
      maxChildren: children,
      infants,
      maxOccupancy: Math.max(1, adults + children),
      color: parent.color,
    };
    if (editing) { updateRoomType(editing.id, patch); addActivity("config", `Tariffa derivata modificata — ${finalName}`); }
    else {
      const id = addRoomType({ structureId, name: finalName, beds: parent.beds, basePrice: parent.basePrice });
      updateRoomType(id, patch);
      addActivity("config", `Tariffa derivata creata — ${finalName}`);
    }
    onClose();
  };

  return (
    <Modal title={editing ? t("Modifica tariffa derivata") : t("Crea tariffa derivata")} onClose={onClose}>
      {parentOptions.length === 0 ? (
        <div className="py-4 text-sm text-faint">{t("Serve almeno una tipologia madre. Crea prima una tipologia in Camere.")}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className={`${lbl} col-span-2`}>{t("Nome")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName} className={`${inp} mt-1`} /></label>
            <label className={`${lbl} col-span-2`}>{t("Basato su")} <span className="font-normal text-faint">({t("tipologia madre")})</span>
              <select value={basedOn} onChange={(e) => setBasedOn(e.target.value)} className={`${inp} mt-1`}>
                {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.name} — {eur(effectiveBase(p, roomTypes))}</option>)}
              </select>
            </label>
            <label className={lbl}>{t("Adulti")}<input type="number" min={1} value={adults} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setAdults(num(e.target.value, 1))} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Bambini")}<input type="number" min={0} value={children} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setChildren(num(e.target.value))} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Neonati")} <span className="font-normal text-faint">({t("fuori conteggio")})</span><input type="number" min={0} value={infants} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setInfants(num(e.target.value))} className={`${inp} mt-1`} /></label>
          </div>

          {/* Piano tariffario */}
          <div className="mt-3">
            <span className={lbl}>{t("Piano tariffario")}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setRatePlan("")} className={`rounded-full border px-2.5 py-1 text-xs transition ${!ratePlan ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t("Nessuno")}</button>
              {planNames.map((p) => { const on = ratePlan === p; return <button key={p} type="button" onClick={() => setRatePlan(p)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(p)}</button>; })}
            </div>
            <p className="mt-1 text-[11px] text-faint">{t("Gestisci i piani dalla pagina Tariffe.")}</p>
          </div>

          {/* Prezzo */}
          <div className="mt-3 rounded-lg border border-line p-3">
            <span className={lbl}>{t("Prezzo")} <span className="font-normal text-faint">· {t("rispetto alla madre")}</span></span>
            <div className="mt-1.5 flex items-center gap-2">
              <select value={mode} onChange={(e) => setMode(e.target.value as "percent" | "amount")} className="shrink-0 rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">
                <option value="percent">{t("Variazione %")}</option>
                <option value="amount">{t("Variazione €")}</option>
              </select>
              <input type="number" value={value} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setValue(Math.floor(Number(e.target.value)) || 0)} className="w-20 shrink-0 rounded-lg border border-line bg-paper px-2.5 py-2 text-sm text-txt outline-none focus:border-focus" />
              <span className="shrink-0 text-sm text-dim">{mode === "percent" ? "%" : "€"}</span>
              <span className="ml-auto shrink-0 whitespace-nowrap text-sm text-dim">= <b className="font-mono text-base text-txt">{eur(preview)}</b>/{t("notte")}</span>
            </div>
            <p className="mt-1.5 text-[11px] text-faint">{t("Usa un valore negativo per una tariffa più bassa (es. −10% per uso singola o non rimborsabile).")}</p>
          </div>

          {/* Regole ereditate dalla madre */}
          <div className="mt-3">
            <span className={lbl}>{t("Eredita dalla tipologia madre")}</span>
            <div className="mt-1.5 flex flex-col gap-2 rounded-lg border border-line p-3">
              <label className="flex items-center justify-between gap-2 text-sm text-txt">{t("Disponibilità")}<Toggle on={inheritAvail} onClick={() => setInheritAvail((v) => !v)} /></label>
              <label className="flex items-center justify-between gap-2 text-sm text-txt">{t("Durata del soggiorno (notti minime)")}<Toggle on={inheritLos} onClick={() => setInheritLos((v) => !v)} /></label>
              <label className="flex items-center justify-between gap-2 text-sm text-txt">{t("Chiudi le vendite")}<Toggle on={salesClosed} onClick={() => setSalesClosed((v) => !v)} color="var(--err)" /></label>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            {editing && <button onClick={async () => { if (await ask({ title: t("Elimina tariffa derivata"), message: `${t("Eliminare")} "${editing.name}"?`, danger: true, confirmLabel: t("Elimina") })) { deleteRoomType(editing.id); onClose(); } }} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button>}
            <button onClick={onClose} className="ml-auto rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
            <button onClick={save} disabled={!canSave} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{editing ? t("Salva") : t("Crea derivata")}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
