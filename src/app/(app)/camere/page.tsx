"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import type { RoomType, Unit } from "@/lib/types";
import { VIEW_OPTIONS, ROOM_AMENITIES, BED_CONFIGS } from "@/lib/types";
import { downscaleImage } from "@/lib/images";
import { AV_COLORS } from "@/lib/users";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useAccess } from "@/lib/access";
import { ROOMS_PER_STRUCT, ROOM_OVERAGE } from "@/lib/plan";
import { useLang } from "@/lib/i18n";

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";
const typeColor = (rt: RoomType, i: number) => rt.color ?? AV_COLORS[i % AV_COLORS.length];

function Toggle({ on, onClick, color = "var(--focus)" }: { on: boolean; onClick?: () => void; color?: string }) {
  return <button type="button" onClick={onClick} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? color : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>;
}
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

export default function CamerePage() {
  const router = useRouter();
  const { t } = useLang();
  const { structures, roomTypes, units, activeStructureId, updateUnit } = useData();
  const ask = useConfirm();
  const [localS, setLocalS] = useState("all");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [roomModal, setRoomModal] = useState<{ structureId: string; unit?: Unit } | null>(null);
  const [sortKey, setSortKey] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const COLLAPSE_KEY = "spigolestay:camere:collapsed:v1";
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => { try { const r = localStorage.getItem(COLLAPSE_KEY); if (r) setCollapsed(new Set(JSON.parse(r))); } catch {} }, []);
  const toggleCollapse = (id: string) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...n])); } catch {} return n; });
  // Selezione multipla camere (modifica in blocco)
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setManySel = (ids: string[], on: boolean) => setSel((p) => { const n = new Set(p); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const clearSel = () => setSel(new Set());
  const [bulkFloor, setBulkFloor] = useState("");
  const [bulkView, setBulkView] = useState("");
  const [bulkAmen, setBulkAmen] = useState<Set<string>>(new Set());
  const [showAmen, setShowAmen] = useState(false);
  const toggleBulkAmen = (a: string) => setBulkAmen((p) => { const n = new Set(p); n.has(a) ? n.delete(a) : n.add(a); return n; });
  const applyBulk = () => {
    const patch: Partial<Unit> = {};
    if (bulkFloor.trim()) patch.floor = bulkFloor.trim();
    if (bulkView) patch.view = bulkView;
    if (Object.keys(patch).length === 0 && bulkAmen.size === 0) return;
    sel.forEach((id) => {
      const p: Partial<Unit> = { ...patch };
      if (bulkAmen.size) { const u = units.find((x) => x.id === id); p.amenities = Array.from(new Set([...(u?.amenities ?? []), ...bulkAmen])); }
      updateUnit(id, p);
    });
    clearSel(); setBulkFloor(""); setBulkView(""); setBulkAmen(new Set()); setShowAmen(false);
  };
  const toggleSort = (k: string) => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("asc"); } };
  const sortUnits = (list: Unit[], tps: typeof roomTypes) => {
    const rtOf = (u: Unit) => tps.find((x) => x.id === u.roomTypeId);
    const kv = (u: Unit): string | number => {
      const rt = rtOf(u);
      if (sortKey === "type") return (rt?.name ?? "").toLowerCase();
      if (sortKey === "code") return (u.code ?? "").toLowerCase();
      if (sortKey === "floor") return (u.floor ?? "").toLowerCase();
      if (sortKey === "view") return (u.view ?? "").toLowerCase();
      if (sortKey === "beds") return rt?.beds ?? 0;
      if (sortKey === "status") return u.outOfService ? 1 : 0;
      return (u.name ?? "").toLowerCase();
    };
    return [...list].sort((a, b) => {
      const va = kv(a), vb = kv(b);
      let c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      if (c === 0) c = (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true });
      return sortDir === "asc" ? c : -c;
    });
  };
  const SortTh = ({ k, label }: { k: string; label: string }) => (
    <th className="cursor-pointer select-none px-3 py-2 font-semibold hover:text-txt" onClick={() => toggleSort(k)}>
      {label}{sortKey === k ? <span className="ml-1 text-[color:var(--focus)]">{sortDir === "asc" ? "▲" : "▼"}</span> : ""}
    </th>
  );

  // Avvisa quando si supera il numero di camere incluse nel piano (6 per struttura).
  const addRoom = async (structureId: string, currentCount: number) => {
    if (currentCount >= ROOMS_PER_STRUCT) {
      const ok = await ask({
        title: t("Camera aggiuntiva"),
        message: `${t("Il piano include")} ${ROOMS_PER_STRUCT} ${t("camere per struttura")}. ${t("Questa camera in più costa")} ${ROOM_OVERAGE}€ ${t("al mese (fatturata a fine mese). Vuoi aggiungerla?")}`,
        confirmLabel: t("Aggiungi camera"),
        cancelLabel: t("Annulla"),
      });
      if (!ok) return;
    }
    setRoomModal({ structureId });
  };

  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("u");
    if (!u) return;
    const unit = units.find((x) => x.id === u);
    if (!unit) return;
    if (activeStructureId === "all") setLocalS(unit.structureId);
    setHighlight(u);
    const t1 = window.setTimeout(() => document.getElementById(`unit-${u}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    const t2 = window.setTimeout(() => setHighlight(null), 2800);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scoped = structures.filter((s) => (activeStructureId === "all" ? localS === "all" || s.id === localS : s.id === activeStructureId));

  return (
    <div>
      <PageHeader
        title={t("Camere")}
        subtitle={t("Tipologie e singole camere di ogni struttura")}
        actions={activeStructureId === "all" ? (
          <select value={localS} onChange={(e) => setLocalS(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus">
            <option value="all">{t("Tutte le strutture")}</option>
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : null}
      />

      {scoped.length === 0 && <Card><div className="py-8 text-center text-sm text-faint">{t("Nessuna struttura. Creane una in")} <Link href="/strutture" className="text-focus underline">{t("Strutture")}</Link>.</div></Card>}

      <div className="flex flex-col gap-5">
        {scoped.map((s) => {
          const types = roomTypes.filter((rt) => rt.structureId === s.id);
          const sUnits = units.filter((u) => u.structureId === s.id);
          const beds = sUnits.reduce((a, u) => a + (types.find((t) => t.id === u.roomTypeId)?.beds ?? 0), 0);
          const oos = sUnits.filter((u) => u.outOfService).length;
          const rowOf = (u: Unit, showType = false) => {
            const i = types.findIndex((tt) => tt.id === u.roomTypeId);
            const rt = types[i];
            const color = rt ? typeColor(rt, i) : "var(--line)";
            return (
              <tr key={u.id} id={`unit-${u.id}`} onClick={() => setRoomModal({ structureId: s.id, unit: u })} className={`cursor-pointer border-b border-line last:border-0 hover:bg-wash ${sel.has(u.id) ? "bg-[color:color-mix(in_srgb,var(--focus)_8%,transparent)]" : highlight === u.id ? "bg-[color:color-mix(in_srgb,var(--focus)_10%,transparent)]" : ""}`}>
                <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(u.id)} onChange={() => toggleSel(u.id)} className="h-4 w-4 accent-[color:var(--focus)]" /></td>
                <td className="px-3 py-2.5"><div className="flex items-center gap-2"><span className="h-6 w-1.5 rounded-full" style={{ backgroundColor: color }} /><span className={`font-medium ${u.outOfService ? "text-faint line-through" : "text-txt"}`}>{u.name}</span></div></td>
                <td className="px-3 py-2.5 font-mono text-xs text-dim">{u.code || "—"}</td>
                {showType && <td className="px-3 py-2.5 text-dim">{rt?.name ?? "—"}</td>}
                <td className="px-3 py-2.5 text-dim">{u.floor || "—"}</td>
                <td className="px-3 py-2.5 text-dim">{u.view || "—"}</td>
                <td className="px-3 py-2.5 text-dim">{rt?.beds ? <span className="inline-flex items-center gap-0.5 text-dim" title={`${rt.beds} posti letto`} aria-label={`${rt.beds} posti letto`}>{Array.from({ length: Math.min(rt.beds, 8) }).map((_, k) => (<svg key={k} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" /></svg>))}{rt.beds > 8 ? <span className="ml-0.5 text-xs">×{rt.beds}</span> : null}</span> : <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5 max-w-[180px] truncate text-xs text-dim" title={u.notes || ""}>{u.notes || <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5">{u.outOfService ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("Fuori servizio")}</span> : <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>{t("In servizio")}</span>}</td>
                <td className="px-3 py-2.5 text-right text-faint">›</td>
              </tr>
            );
          };
          return (
            <div key={s.id}>
              <div className="mb-2 flex items-center justify-between">
                <div className="font-display text-lg font-bold text-txt">{s.name}</div>
                <div className="flex gap-2">
                  <button onClick={() => router.push(`/camere/tipologia/nuovo?s=${s.id}`)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-txt hover:bg-wash">{t("+ Tipologia")}</button>
                  <button onClick={() => addRoom(s.id, sUnits.length)} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">{t("+ Camera")}</button>
                </div>
              </div>

              {/* Statistiche */}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["Camere", sUnits.length], ["Tipologie", types.length], ["Posti letto", beds], ["Fuori servizio", oos]].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-line bg-surface p-3"><div className="text-xs text-dim">{t(k as string)}</div><div className="mt-0.5 font-mono text-xl font-bold text-txt">{v}</div></div>
                ))}
              </div>

              {/* Tipologie */}
              <SectionTitle>{t("Tipologie")}</SectionTitle>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {types.map((rt, i) => {
                  const color = typeColor(rt, i);
                  const n = sUnits.filter((u) => u.roomTypeId === rt.id).length;
                  return (
                    <button key={rt.id} onClick={() => router.push(`/camere/tipologia/${rt.id}`)} className="group overflow-hidden rounded-xl border border-line bg-surface text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-txt">{rt.name}</div>
                          <div className="font-mono text-sm font-bold text-txt">{eur(rt.basePrice)}<span className="text-[10px] font-normal text-faint">{t("/notte")}</span></div>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{rt.beds} {t("letti")}</span>
                          {rt.maxOccupancy ? <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{t("max")} {rt.maxOccupancy} {t("ospiti")}</span> : null}
                          {rt.size ? <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{rt.size} m²</span> : null}
                          <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{n} {t("camere")}</span>
                        </div>
                        {rt.bedConfig && <div className="mt-1.5 text-[11px] text-faint">{rt.bedConfig}</div>}
                        {(rt.amenities ?? []).length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{(rt.amenities ?? []).slice(0, 4).map((a) => <span key={a} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-dim">{t(a)}</span>)}{(rt.amenities ?? []).length > 4 && <span className="text-[10px] text-faint">+{(rt.amenities ?? []).length - 4}</span>}</div>}
                        <div className="mt-2 text-[11px] font-medium text-focus opacity-0 transition group-hover:opacity-100">{t("Apri scheda")} →</div>
                      </div>
                    </button>
                  );
                })}
                {types.length === 0 && <div className="w-full rounded-xl border border-dashed border-line p-4 text-sm text-faint">{t("Nessuna tipologia. Aggiungine una col pulsante “+ Tipologia”.")}</div>}
              </div>

              {/* Camere — un box separato per ogni tipologia */}
              <SectionTitle>{t("Camere")}</SectionTitle>
              {sUnits.length === 0 ? (
                <div className="mt-2 rounded-xl border border-dashed border-line p-4 text-sm text-faint">{t("Nessuna camera. Aggiungine una col pulsante “+ Camera”.")}</div>
              ) : (
                <div className="mt-2 flex flex-col gap-4">
                  {types.map((rt, i) => {
                    const g = sortUnits(sUnits.filter((u) => u.roomTypeId === rt.id), types);
                    if (!g.length) return null;
                    const color = typeColor(rt, i);
                    const open = !collapsed.has(rt.id);
                    return (
                      <div key={rt.id} className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                        <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 ${open ? "border-b border-line" : ""}`} style={{ borderLeft: `4px solid ${color}` }}>
                          <button onClick={() => toggleCollapse(rt.id)} className="flex flex-1 flex-wrap items-center gap-2 text-left" title={open ? t("Comprimi") : t("Espandi")}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-faint transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}><polyline points="9 18 15 12 9 6" /></svg>
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                            <span className="font-display text-base font-bold text-txt">{rt.name}</span>
                            <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-dim">{g.length} {g.length === 1 ? t("camera") : t("camere")}</span>
                            <span className="text-[11px] text-faint">{rt.beds} {t("letti")} · {eur(rt.basePrice)}{t("/notte")}</span>
                          </button>
                          <button onClick={() => router.push(`/camere/tipologia/${rt.id}`)} className="text-[11px] font-medium text-focus hover:underline">{t("Apri tipologia")} →</button>
                        </div>
                        {open && (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[820px] text-sm">
                              <thead>
                                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                                  <th className="px-2 py-2"><input type="checkbox" checked={g.length > 0 && g.every((u) => sel.has(u.id))} onChange={(e) => setManySel(g.map((u) => u.id), e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" title={t("Seleziona tutte")} /></th>
                                  <SortTh k="name" label={t("Camera")} />
                                  <SortTh k="code" label={t("Codice")} />
                                  <SortTh k="floor" label={t("Piano")} />
                                  <SortTh k="view" label={t("Vista")} />
                                  <SortTh k="beds" label={t("Posti")} />
                                  <th className="px-3 py-2 font-semibold">{t("Note")}</th>
                                  <SortTh k="status" label={t("Stato")} />
                                  <th className="px-3 py-2 font-semibold"></th>
                                </tr>
                              </thead>
                              <tbody>{g.map((u) => rowOf(u))}</tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(() => {
                    const orphans = sortUnits(sUnits.filter((u) => !types.some((rt) => rt.id === u.roomTypeId)), types);
                    if (!orphans.length) return null;
                    return (
                      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                        <div className="border-b border-line px-3 py-2.5 text-sm font-semibold text-dim">{t("Altre camere (senza tipologia)")}</div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[560px] text-sm">
                            <thead>
                              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                                <th className="px-2 py-2"><input type="checkbox" checked={orphans.length > 0 && orphans.every((u) => sel.has(u.id))} onChange={(e) => setManySel(orphans.map((u) => u.id), e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" title={t("Seleziona tutte")} /></th>
                                <SortTh k="name" label={t("Camera")} />
                                <SortTh k="code" label={t("Codice")} />
                                <SortTh k="floor" label={t("Piano")} />
                                <SortTh k="view" label={t("Vista")} />
                                <SortTh k="beds" label={t("Posti")} />
                                <th className="px-3 py-2 font-semibold">{t("Note")}</th>
                                <SortTh k="status" label={t("Stato")} />
                                <th className="px-3 py-2 font-semibold"></th>
                              </tr>
                            </thead>
                            <tbody>{orphans.map((u) => rowOf(u))}</tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sel.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-50 max-h-[70vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-2xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-semibold text-txt">{sel.size} {sel.size === 1 ? t("camera selezionata") : t("camere selezionate")}</span>
            <label className="flex items-center gap-1.5 text-xs text-dim">{t("Piano")}<input value={bulkFloor} onChange={(e) => setBulkFloor(e.target.value)} placeholder={t("Terra / 1° / 2°")} className="w-28 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
            <label className="flex items-center gap-1.5 text-xs text-dim">{t("Vista")}<select value={bulkView} onChange={(e) => setBulkView(e.target.value)} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus"><option value="">—</option>{VIEW_OPTIONS.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></label>
            <button onClick={() => setShowAmen((s) => !s)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${showAmen || bulkAmen.size ? "border-focus text-focus" : "border-line text-dim hover:bg-wash"}`}>{t("Dotazioni")}{bulkAmen.size ? ` (${bulkAmen.size})` : ""}</button>
            <button onClick={applyBulk} disabled={!bulkFloor.trim() && !bulkView && bulkAmen.size === 0} className="rounded-lg bg-focus px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Applica a")} {sel.size}</button>
            <button onClick={() => { clearSel(); setBulkFloor(""); setBulkView(""); setBulkAmen(new Set()); setShowAmen(false); }} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
          </div>
          {showAmen && (
            <div className="mt-2 border-t border-line pt-2">
              <div className="mb-1 text-[11px] font-medium text-dim">{t("Dotazioni da aggiungere alle camere selezionate")}</div>
              <div className="flex flex-wrap gap-1.5">
                {ROOM_AMENITIES.map((a) => { const on = bulkAmen.has(a); return <button key={a} onClick={() => toggleBulkAmen(a)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(a)}</button>; })}
              </div>
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-faint">{t("Vengono aggiornati solo i campi compilati (piano, vista, dotazioni). Le dotazioni si aggiungono a quelle esistenti.")}</p>
        </div>
      )}

      {roomModal && <RoomModal structureId={roomModal.structureId} unit={roomModal.unit} onClose={() => setRoomModal(null)} />}
    </div>
  );
}

function RoomModal({ structureId, unit, onClose }: { structureId: string; unit?: Unit; onClose: () => void }) {
  const { roomTypes, units, addUnit, updateUnit, deleteUnit, setActiveStructure } = useData();
  const { t } = useLang();
  const ask = useConfirm();
  const router = useRouter();
  const { moduleOn } = useAccess();
  const hasGuide = moduleOn("concierge");
  const openGuide = () => { setActiveStructure(structureId); onClose(); router.push("/guida-ospiti"); };
  const types = roomTypes.filter((rt) => rt.structureId === structureId);
  const numFromName = (n: string) => { const m = (n || "").match(/(\d+)\s*$/); return m ? Number(m[1]) : 0; };
  // Default nuova camera: nome = numero crescente, codice = prime 3 lettere tipologia + numero.
  const nextRoom = (rtId: string) => {
    const mine = units.filter((x) => x.roomTypeId === rtId);
    const n = mine.reduce((mx, x) => Math.max(mx, numFromName(x.name)), 0) + 1;
    const rt = roomTypes.find((r) => r.id === rtId);
    const prefix = (rt?.name || "").replace(/\s+/g, "").slice(0, 3).toUpperCase();
    return { name: String(n), code: `${prefix}${n}` };
  };
  const amenitiesFor = (rtId: string) => roomTypes.find((r) => r.id === rtId)?.amenities ?? [];
  const [f, setF] = useState<Partial<Unit>>(() => unit ?? { ...nextRoom(types[0]?.id ?? ""), roomTypeId: types[0]?.id ?? "", amenities: [...amenitiesFor(types[0]?.id ?? "")], floor: "", view: "", outOfService: false });
  const set = <K extends keyof Unit>(k: K, v: Unit[K]) => setF((p) => ({ ...p, [k]: v }));
  // Codice camera automatico = prime 3 lettere tipologia + numero (nome). Non si digita.
  const codeOf = (name?: string, rtId?: string) => { const rt = roomTypes.find((r) => r.id === rtId); const prefix = (rt?.name || "").replace(/\s+/g, "").slice(0, 3).toUpperCase(); const nm = (name || "").trim(); return nm ? `${prefix}${nm}` : ""; };
  const autoCode = codeOf(f.name, f.roomTypeId);
  const onPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try { const url = await downscaleImage(file, 900, 0.72); setF((p) => ({ ...p, photos: [...(p.photos ?? []), url] })); } catch {}
    }
  };
  const removePhoto = (i: number) => setF((p) => ({ ...p, photos: (p.photos ?? []).filter((_, j) => j !== i) }));
  const toggleAmenity = (a: string) => setF((p) => { const cur = p.amenities ?? []; return { ...p, amenities: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] }; });

  const save = () => {
    if (!f.name?.trim() || !f.roomTypeId) return;
    const patch: Partial<Unit> = { name: f.name.trim(), roomTypeId: f.roomTypeId, code: codeOf(f.name, f.roomTypeId), floor: f.floor, view: f.view, accessInfo: f.accessInfo, notes: f.notes, outOfService: f.outOfService, oosReason: f.outOfService ? f.oosReason : undefined, photos: f.photos, amenities: f.amenities, bedConfig: f.bedConfig, size: f.size };
    if (unit) updateUnit(unit.id, patch);
    else { const id = addUnit({ structureId, roomTypeId: f.roomTypeId, name: patch.name! }); updateUnit(id, patch); }
    onClose();
  };

  return (
    <Modal title={unit ? t("Scheda camera") : t("Nuova camera")} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className={`${lbl} col-span-2`}>{t("Nome camera")} *<input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} className={`${inp} mt-1`} placeholder={t("Es. Camera Ortigia")} /></label>
        <label className={lbl}>{t("Codice")} <span className="font-normal text-faint">({t("automatico")})</span><input value={autoCode} readOnly title={t("Generato da tipologia + numero")} className={`${inp} mt-1 cursor-not-allowed bg-wash text-dim`} placeholder="—" /></label>
        <label className={lbl}>{t("Tipologia")}<select value={f.roomTypeId ?? ""} onChange={(e) => { const rid = e.target.value; if (unit) { set("roomTypeId", rid); } else { const nr = nextRoom(rid); setF((p) => ({ ...p, roomTypeId: rid, name: nr.name, amenities: [...amenitiesFor(rid)] })); } }} className={`${inp} mt-1`}>{types.length === 0 && <option value="">{t("Crea prima una tipologia")}</option>}{types.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}</select></label>
        <label className={lbl}>{t("Piano")}<input value={f.floor ?? ""} onChange={(e) => set("floor", e.target.value)} className={`${inp} mt-1`} placeholder={t("Terra / 1° / 2°")} /></label>
        <label className={lbl}>{t("Vista")}<select value={f.view ?? ""} onChange={(e) => set("view", e.target.value)} className={`${inp} mt-1`}><option value="">—</option>{VIEW_OPTIONS.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></label>
        <label className={lbl}>{t("Configurazione letti")}<select value={f.bedConfig ?? ""} onChange={(e) => set("bedConfig", e.target.value || undefined)} className={`${inp} mt-1`}><option value="">{t("Come tipologia")}</option>{BED_CONFIGS.map((b) => <option key={b} value={b}>{t(b)}</option>)}</select></label>
        <label className={lbl}>{t("Metri quadri")}<input type="number" min={0} value={f.size ?? ""} onChange={(e) => set("size", e.target.value ? Number(e.target.value) : undefined)} className={`${inp} mt-1`} placeholder={t("Come tipologia")} /></label>
      </div>
      {hasGuide ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper p-2.5">
          <span className="text-[11px] text-dim">{t("Questi codici e istruzioni possono comparire nella guida ospiti della camera.")}</span>
          <button type="button" onClick={openGuide} className="shrink-0 rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">{t("Apri la guida")} →</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5" style={{ borderColor: "color-mix(in srgb, var(--focus) 35%, var(--line))", backgroundColor: "color-mix(in srgb, var(--focus) 6%, transparent)" }}>
          <span className="text-[11px] text-dim">🔒 {t("Con la Guida ospiti, codici e istruzioni della camera compaiono in una pagina web per l'ospite.")}</span>
          <button type="button" onClick={() => { onClose(); router.push("/abbonamento"); }} className="shrink-0 rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">{t("Aggiungi il servizio")} →</button>
        </div>
      )}
      <label className={`${lbl} mt-3`}>{t("Note interne")}<textarea value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={2} className={`${inp} mt-1 resize-y`} placeholder={t("Manutenzioni, particolarità…")} /></label>

      {/* Foto della camera */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className={lbl}>{t("Foto della camera")}</span>
          <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-focus hover:bg-wash">＋ {t("Aggiungi foto")}<input type="file" accept="image/*" multiple hidden onChange={(e) => { onPhotos(e.target.files); e.target.value = ""; }} /></label>
        </div>
        {(f.photos ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {(f.photos ?? []).map((src, i) => (
              <div key={i} className="group relative h-20 w-28 overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover" />
                <button type="button" onClick={() => removePhoto(i)} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-xs text-white opacity-0 transition group-hover:opacity-100" title={t("Rimuovi")}>✕</button>
              </div>
            ))}
          </div>
        ) : <p className="text-[11px] text-faint">{t("Nessuna foto. Le foto della camera potranno comparire nella guida ospiti e nel booking.")}</p>}
      </div>

      {/* Dotazioni specifiche della camera */}
      <div className="mt-3">
        <span className={lbl}>{t("Dotazioni della camera")}</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ROOM_AMENITIES.map((a) => {
            const on = (f.amenities ?? []).includes(a);
            return <button key={a} type="button" onClick={() => toggleAmenity(a)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(a)}</button>;
          })}
        </div>
        <p className="mt-1 text-[11px] text-faint">{t("Specifiche di questa camera, in aggiunta a quelle della tipologia.")}</p>
      </div>

      <div className="mt-3 rounded-lg border border-line p-3">
        <div className="flex items-center justify-between"><span className="text-sm font-medium text-txt">{t("Fuori servizio")}</span><Toggle on={!!f.outOfService} onClick={() => set("outOfService", !f.outOfService)} color="var(--warn)" /></div>
        {f.outOfService && <input value={f.oosReason ?? ""} onChange={(e) => set("oosReason", e.target.value)} className={`${inp} mt-2`} placeholder={t("Motivo (es. ristrutturazione)")} />}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {unit && <button onClick={async () => { if (await ask({ title: t("Elimina camera"), message: `${t("Eliminare")} "${unit.name}"?`, danger: true, confirmLabel: t("Elimina") })) { deleteUnit(unit.id); onClose(); } }} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button>}
        <button onClick={onClose} className="ml-auto rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
        <button onClick={save} disabled={!f.name?.trim() || !f.roomTypeId} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{unit ? t("Salva") : t("Crea")}</button>
      </div>
    </Modal>
  );
}
