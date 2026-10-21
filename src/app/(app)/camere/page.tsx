"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import type { RoomType, Unit } from "@/lib/types";
import { VIEW_OPTIONS, ROOM_AMENITIES, BED_CONFIGS } from "@/lib/types";
import { uploadImage } from "@/lib/media-client";
import MediaImg from "@/components/MediaImg";
import { AV_COLORS } from "@/lib/users";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle, StatCard, Button } from "@/components/ui";
import WeatherWidget from "@/components/WeatherWidget";
import SearchInput from "@/components/SearchInput";
import Popover from "@/components/Popover";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmProvider";
import { useToast } from "@/components/ToastProvider";
import { useAccess } from "@/lib/access";
import { amenityIcon } from "@/lib/amenities";
import { sortRoomTypes, byUnitName } from "@/lib/sortUnits";
import { ROOMS_PER_STRUCT, ROOM_OVERAGE } from "@/lib/plan";
import { useLang } from "@/lib/i18n";
import Toggle from "@/components/Toggle";
import { keyActivate } from "@/lib/a11y";
import { Modal as UiModal } from "@/components/ui/index";

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";
const typeColor = (rt: RoomType, i: number) => rt.color ?? AV_COLORS[i % AV_COLORS.length];

// Finestra: adattatore sul <Modal> del design system (role=dialog, Esc, trappola e ritorno del focus, blocco scroll, sheet su telefono)
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useLang();
  return <UiModal open onClose={onClose} title={title} size="md" closeLabel={t("Chiudi")}>{children}</UiModal>;
}

// Telefono: pulsante unico «+ Aggiungi» con tendina (Camera / Tipologia), ancorato al pulsante. Da sm in su non c'è (restano i due pulsanti nella barra).
function AddMenu({ onRoom, onType }: { onRoom: () => void; onType: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="sm:hidden">
      <Button size="sm" ref={ref} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="whitespace-nowrap">+ {t("Aggiungi")}</Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="end" width={200} label={t("Aggiungi")}>
        <button type="button" onClick={() => { setOpen(false); onRoom(); }} className="flex h-12 w-full items-center rounded-lg px-3 text-left text-base font-semibold text-txt hover:bg-wash">{t("Camera")}</button>
        <button type="button" onClick={() => { setOpen(false); onType(); }} className="flex h-12 w-full items-center rounded-lg px-3 text-left text-base font-semibold text-txt hover:bg-wash">{t("Tipologia")}</button>
      </Popover>
    </div>
  );
}

export default function CamerePage() {
  const router = useRouter();
  const { t } = useLang();
  const { structures, roomTypes, units, activeStructureId, updateUnit, updateRoomType, addActivity } = useData();
  const ask = useConfirm();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [roomModal, setRoomModal] = useState<{ structureId: string; unit?: Unit } | null>(null);
  const [sortKey, setSortKey] = useState<string>("name");
  const [dragId, setDragId] = useState<string | null>(null); // camera trascinata (riordino manuale)
  const [dragTypeId, setDragTypeId] = useState<string | null>(null); // tipologia trascinata (riordino manuale)
  const [search, setSearch] = useState(""); // filtro: cerca per tipologia o nome/codice camera
  const q = search.trim().toLowerCase();
  const typeMatchQ = (rt: { name: string }) => !q || rt.name.toLowerCase().includes(q);
  const unitMatchQ = (u: Unit) => !q || (u.name || "").toLowerCase().includes(q) || (u.code || "").toLowerCase().includes(q);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Tendine delle camere: SEMPRE chiuse all'apertura della pagina (non si ricordano più aperte).
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) => setOpened((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Selezione multipla camere (modifica in blocco)
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setManySel = (ids: string[], on: boolean) => setSel((p) => { const n = new Set(p); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const clearSel = () => setSel(new Set());
  // Vista: "compact" (tabelle per tipologia) oppure "detail" (righe alte, una per camera). Si ricorda l'ultima scelta.
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
    const n = sel.size;
    sel.forEach((id) => {
      const p: Partial<Unit> = { ...patch };
      if (bulkAmen.size) { const u = units.find((x) => x.id === id); p.amenities = Array.from(new Set([...(u?.amenities ?? []), ...bulkAmen])); }
      updateUnit(id, p);
    });
    if (n > 0) addActivity("config", `Camere aggiornate in blocco · ${n}`);
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
      // Vista predefinita "Camera": rispetta l'ordine manuale (drag & drop), poi il numero.
      if (sortKey === "name") { const c0 = byUnitName(a, b); return sortDir === "asc" ? c0 : -c0; }
      const va = kv(a), vb = kv(b);
      let c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      if (c === 0) c = byUnitName(a, b);
      return sortDir === "asc" ? c : -c;
    });
  };
  // Riordino manuale: sposta la camera trascinata prima di quella di destinazione e salva l'ordine.
  const reorderUnit = (group: Unit[], targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const rest = group.map((u) => u.id).filter((id) => id !== dragId);
    const ti = rest.indexOf(targetId);
    if (ti < 0) { setDragId(null); return; }
    rest.splice(ti, 0, dragId);
    rest.forEach((id, idx) => updateUnit(id, { order: idx }));
    if (sortKey !== "name") { setSortKey("name"); setSortDir("asc"); }
    setDragId(null);
  };
  // Riordino delle tipologie: sposta quella trascinata prima di quella di destinazione e salva l'ordine (vale anche per il Calendario).
  const reorderType = (group: RoomType[], targetId: string) => {
    if (!dragTypeId || dragTypeId === targetId) { setDragTypeId(null); return; }
    const rest = group.map((x) => x.id).filter((id) => id !== dragTypeId);
    const ti = rest.indexOf(targetId);
    if (ti < 0) { setDragTypeId(null); return; }
    rest.splice(ti, 0, dragTypeId);
    rest.forEach((id, idx) => updateRoomType(id, { order: idx }));
    setDragTypeId(null);
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
    setHighlight(u);
    const t1 = window.setTimeout(() => document.getElementById(`unit-${u}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    const t2 = window.setTimeout(() => setHighlight(null), 2800);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scoped = structures.filter((s) => activeStructureId === "all" || s.id === activeStructureId); // la struttura si sceglie solo dal selettore globale

  // Cambiando struttura si azzerano selezione multipla e modale aperto: le camere selezionate di un'altra
  // struttura non devono restare "invisibili" e finire nella modifica in blocco.
  useEffect(() => { setSel(new Set()); setRoomModal(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeStructureId]);

  return (
    <div>
      <PageHeader
        title={t("Camere")}
        subtitle={t("Tipologie e singole camere di ogni struttura")}
        actions={<>
          <WeatherWidget compact />
        </>}
      />

      {scoped.length === 0 && <Card><div className="py-8 text-center text-sm text-faint">{t("Nessuna struttura. Creane una in")} <Link href="/strutture" className="text-focus underline">{t("Strutture")}</Link>.</div></Card>}

      <div className="flex flex-col gap-5">
        {scoped.map((s) => {
          const typesRaw = roomTypes.filter((rt) => rt.structureId === s.id); // ordine di creazione: i colori di default restano legati a questo
          const types = sortRoomTypes(typesRaw);
          const colorIdx = (rt: RoomType) => typesRaw.findIndex((x) => x.id === rt.id);
          const sUnits = units.filter((u) => u.structureId === s.id);
          const beds = sUnits.reduce((a, u) => a + (types.find((t) => t.id === u.roomTypeId)?.beds ?? 0), 0);
          const oos = sUnits.filter((u) => u.outOfService).length;
          const rowOf = (u: Unit, showType = false, group?: Unit[]) => {
            const rt = types.find((tt) => tt.id === u.roomTypeId);
            const color = rt ? typeColor(rt, colorIdx(rt)) : "var(--line)";
            return (
              <tr key={u.id} id={`unit-${u.id}`}
                draggable={!!group}
                onDragStart={(e) => { setDragId(u.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (dragId && dragId !== u.id) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (group) reorderUnit(group, u.id); }}
                onDragEnd={() => setDragId(null)}
                onClick={() => setRoomModal({ structureId: s.id, unit: u })} {...keyActivate(() => setRoomModal({ structureId: s.id, unit: u }))}
                className={`cursor-pointer border-b border-line last:border-0 hover:bg-wash ${dragId === u.id ? "opacity-40" : ""} ${sel.has(u.id) ? "bg-[color:color-mix(in_srgb,var(--focus)_8%,transparent)]" : highlight === u.id ? "bg-[color:color-mix(in_srgb,var(--focus)_10%,transparent)]" : ""}`}>
                <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(u.id)} onChange={() => toggleSel(u.id)} className="h-4 w-4 accent-[color:var(--focus)]" /></td>
                <td className="px-3 py-2.5"><div className="flex min-w-0 items-center gap-2"><span className="shrink-0 cursor-grab text-faint active:cursor-grabbing" title={t("Trascina per riordinare")} aria-hidden><svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="4" cy="4" r="1.3" /><circle cx="8" cy="4" r="1.3" /><circle cx="4" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="4" cy="12" r="1.3" /><circle cx="8" cy="12" r="1.3" /></svg></span><span className="h-6 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} /><span className={`truncate font-medium ${u.outOfService ? "text-faint line-through" : "text-txt"}`}>{u.name}</span></div></td>
                <td className="px-3 py-2.5 font-mono text-xs text-dim">{u.code || "—"}</td>
                {showType && <td className="px-3 py-2.5 text-dim">{rt?.name ?? "—"}</td>}
                <td className="whitespace-nowrap px-3 py-2.5 text-dim">{u.floor || "—"}</td>
                <td className="truncate whitespace-nowrap px-3 py-2.5 text-dim" title={u.view || ""}>{u.view || "—"}</td>
                <td className="px-3 py-2.5 text-dim">{rt?.beds ? <span className="inline-flex items-center gap-0.5 text-dim" title={`${rt.beds} posti letto`} aria-label={`${rt.beds} posti letto`}>{Array.from({ length: Math.min(rt.beds, 8) }).map((_, k) => (<svg key={k} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" /></svg>))}{rt.beds > 8 ? <span className="ml-0.5 text-xs">×{rt.beds}</span> : null}</span> : <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5 max-w-[180px] truncate text-xs text-dim" title={u.notes || ""}>{u.notes || <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5">{u.outOfService ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("Fuori servizio")}</span> : <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>{t("In servizio")}</span>}</td>
                <td className="px-3 py-2.5 text-right text-faint">›</td>
              </tr>
            );
          };
          // Filtri camere: ricerca + azioni, sempre sotto le card Tipologie.
          const filtriRow = () => (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-sm max-sm:mb-2 max-sm:flex-nowrap">
              <SearchInput value={search} onChange={setSearch} placeholder={t("Cerca tipologia o camera…")} className="w-full sm:w-auto sm:flex-1 max-sm:min-w-0 max-sm:flex-1" />
              <div className="ml-auto flex items-center gap-2 max-sm:shrink-0">
                <Button variant="secondary" size="sm" onClick={() => router.push(`/camere/tipologia/nuovo?s=${s.id}`)} className="max-sm:hidden">{t("+ Tipologia")}</Button>
                <Button size="sm" onClick={() => addRoom(s.id, sUnits.length)} className="whitespace-nowrap max-sm:hidden">{t("+ Camera")}</Button>
                {/* Telefono: UN solo «+ Aggiungi» che apre la scelta Camera / Tipologia */}
                <AddMenu onRoom={() => addRoom(s.id, sUnits.length)} onType={() => router.push(`/camere/tipologia/nuovo?s=${s.id}`)} />
              </div>
            </div>
          );
          return (
            <div key={s.id}>
              <div className="mb-2 flex items-center justify-between">
                {activeStructureId === "all" ? <div className="font-display text-lg font-bold text-txt">{s.name}</div> : <div />}
                <div className="flex gap-2">
                  {sUnits.some((u) => u.order != null) && <Button variant="secondary" size="xs" onClick={() => sUnits.forEach((u) => updateUnit(u.id, { order: undefined }))} title={t("Riporta le camere all'ordine numerico crescente")}>↕ {t("Ordine numerico")}</Button>}
                </div>
              </div>

              {/* Statistiche */}
              <div className="mb-3 grid grid-cols-2 gap-3 max-sm:gap-2 sm:grid-cols-4">
                {([["Camere", sUnits.length], ["Tipologie", types.filter((rt) => !rt.deriveFrom).length], ["Posti letto", beds], ["Fuori servizio", oos]] as [string, number][]).map(([k, v]) => (
                  <StatCard key={k} label={t(k)} value={v} />
                ))}
              </div>

              {filtriRow()}

              {(<>
              {/* Tipologie */}
              <SectionTitle>{t("Tipologie")}</SectionTitle>
              <div className="mb-4 grid grid-cols-1 gap-2 sm:auto-rows-fr sm:grid-cols-2 lg:grid-cols-4 max-sm:mb-3 max-sm:grid-cols-2 max-sm:gap-2">
                {types.map((rt, i) => {
                  if (rt.deriveFrom) return null; // le derivate stanno nella tabella "Tariffe derivate"
                  const color = typeColor(rt, colorIdx(rt));
                  const n = sUnits.filter((u) => u.roomTypeId === rt.id).length;
                  return (
                    <button key={rt.id} onClick={() => router.push(`/camere/tipologia/${rt.id}`)} draggable onDragStart={(e) => { setDragTypeId(rt.id); e.dataTransfer.effectAllowed = "move"; }} onDragOver={(e) => { if (dragTypeId && dragTypeId !== rt.id) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); reorderType(types.filter((x) => !x.deriveFrom), rt.id); }} onDragEnd={() => setDragTypeId(null)} title={t("Trascina per cambiare l'ordine delle tipologie")} className={`${dragTypeId === rt.id ? "opacity-40 " : ""}cursor-grab group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}>
                      <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: color }} />
                      <div className="flex flex-1 flex-col p-3 max-sm:p-2.5">
                        <div className="flex items-start justify-between gap-x-2 max-sm:flex-wrap">
                          <div className="font-semibold text-txt">{rt.name}</div>
                          <div className="shrink-0 whitespace-nowrap font-mono text-sm font-bold text-txt">{eur(rt.basePrice)}<span className="text-[11px] font-normal text-faint">{t("/notte")}</span></div>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{rt.beds} {rt.beds === 1 ? t("letto") : t("letti")}</span>
                          {rt.maxOccupancy ? <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{t("max")} {rt.maxOccupancy} {rt.maxOccupancy === 1 ? t("ospite") : t("ospiti")}</span> : null}
                          {rt.size ? <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{rt.size} m²</span> : null}
                          <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{n} {n === 1 ? t("camera") : t("camere")}</span>
                        </div>
                        {rt.bedConfig && <div className="mt-1.5 text-[11px] text-faint">{rt.bedConfig}</div>}
                        {(rt.amenities ?? []).length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-dim">{(rt.amenities ?? []).slice(0, 6).map((a) => <span key={a} title={t(a)} aria-label={t(a)} className="[&>svg]:h-4 [&>svg]:w-4">{amenityIcon(a)}</span>)}{(rt.amenities ?? []).length > 6 && <span className="text-[11px] text-faint">+{(rt.amenities ?? []).length - 6}</span>}</div>}
                        <div className="mt-auto pt-2 text-[11px] font-medium text-focus opacity-0 transition group-hover:opacity-100 max-sm:hidden">{t("Apri scheda")} →</div>
                      </div>
                    </button>
                  );
                })}
                {types.length === 0 && <div className="w-full rounded-xl border border-dashed border-line"><EmptyState title={t("Nessuna tipologia. Aggiungine una col pulsante “+ Tipologia”.")} /></div>}
              </div>

              {/* Camere — un box separato per ogni tipologia */}
              <SectionTitle>{t("Camere")}</SectionTitle>
              {sUnits.length === 0 ? (
                <div className="mt-2 rounded-xl border border-dashed border-line"><EmptyState title={t("Nessuna camera. Aggiungine una col pulsante “+ Camera”.")} /></div>
              ) : (
                <div className="mt-2 flex flex-col gap-4">
                  {types.map((rt, i) => {
                    const g = sortUnits(sUnits.filter((u) => u.roomTypeId === rt.id && (typeMatchQ(rt) || unitMatchQ(u))), types);
                    if (!g.length) return null;
                    const color = typeColor(rt, colorIdx(rt));
                    const open = !!search.trim() || opened.has(rt.id); // cercando, apriamo i gruppi che corrispondono
                    return (
                      <div key={rt.id} className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                        <div draggable onDragStart={(e) => { setDragTypeId(rt.id); e.dataTransfer.effectAllowed = "move"; }} onDragOver={(e) => { if (dragTypeId && dragTypeId !== rt.id) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); reorderType(types, rt.id); }} onDragEnd={() => setDragTypeId(null)} title={t("Trascina per cambiare l'ordine delle tipologie")} className={`flex cursor-grab items-center justify-between gap-2 px-3 py-2.5 max-sm:flex-wrap ${dragTypeId === rt.id ? "opacity-40" : ""} ${open ? "border-b border-line" : ""}`} style={{ borderLeft: `4px solid ${color}` }}>
                          <button onClick={() => toggleOpen(rt.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left max-sm:basis-full max-sm:py-2.5" title={open ? t("Comprimi") : t("Espandi")}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-faint transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}><polyline points="9 18 15 12 9 6" /></svg>
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                            <span className="truncate font-display text-base font-bold text-txt">{rt.name}</span>
                            <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-dim">{g.length} {g.length === 1 ? t("camera") : t("camere")}</span>
                            <span className="hidden shrink-0 text-[11px] text-faint sm:inline">{rt.beds} {rt.beds === 1 ? t("letto") : t("letti")} · {eur(rt.basePrice)}{t("/notte")}</span>
                          </button>
                          <button onClick={() => router.push(`/camere/tipologia/${rt.id}`)} className="-my-2.5 shrink-0 whitespace-nowrap py-3 pl-2 text-[11px] font-medium text-focus hover:underline max-sm:ml-auto">{t("Apri tipologia")} →</button>
                        </div>
                        {open && (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[820px] table-fixed text-sm"><colgroup><col style={{ width: 40 }} /><col style={{ width: "26%" }} /><col style={{ width: "12%" }} /><col style={{ width: "10%" }} /><col style={{ width: "12%" }} /><col style={{ width: "10%" }} /><col style={{ width: "18%" }} /><col style={{ width: "12%" }} /><col style={{ width: 44 }} /></colgroup>
                              <thead>
                                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-dim">
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
                              <tbody>{g.map((u) => rowOf(u, false, g))}</tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {q && !sUnits.some((u) => { const rt = types.find((x) => x.id === u.roomTypeId); return rt ? typeMatchQ(rt) || unitMatchQ(u) : unitMatchQ(u); }) && <div className="rounded-xl border border-dashed border-line"><EmptyState title={t("Nessuna camera trovata")} /></div>}
                  {(() => {
                    const orphans = sortUnits(sUnits.filter((u) => !types.some((rt) => rt.id === u.roomTypeId) && unitMatchQ(u)), types);
                    if (!orphans.length) return null;
                    return (
                      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                        <div className="border-b border-line px-3 py-2.5 text-sm font-semibold text-dim">{t("Altre camere (senza tipologia)")}</div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[820px] table-fixed text-sm"><colgroup><col style={{ width: 40 }} /><col style={{ width: "26%" }} /><col style={{ width: "12%" }} /><col style={{ width: "10%" }} /><col style={{ width: "12%" }} /><col style={{ width: "10%" }} /><col style={{ width: "18%" }} /><col style={{ width: "12%" }} /><col style={{ width: 44 }} /></colgroup>
                            <thead>
                              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-dim">
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
                            <tbody>{orphans.map((u) => rowOf(u, false, orphans))}</tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              </>)}
            </div>
          );
        })}
      </div>

      {sel.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-50 max-h-[70dvh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-2xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-semibold text-txt">{sel.size} {sel.size === 1 ? t("camera selezionata") : t("camere selezionate")}</span>
            <label className="flex items-center gap-1.5 text-xs text-dim">{t("Piano")}<input value={bulkFloor} onChange={(e) => setBulkFloor(e.target.value)} placeholder={t("Terra / 1° / 2°")} className="w-28 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
            <label className="flex items-center gap-1.5 text-xs text-dim">{t("Vista")}<select value={bulkView} onChange={(e) => setBulkView(e.target.value)} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus"><option value="">—</option>{VIEW_OPTIONS.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></label>
            <button onClick={() => setShowAmen((s) => !s)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${showAmen || bulkAmen.size ? "border-focus text-focus" : "border-line text-dim hover:bg-wash"}`}>{t("Dotazioni")}{bulkAmen.size ? ` (${bulkAmen.size})` : ""}</button>
            <Button size="sm" onClick={applyBulk} disabled={!bulkFloor.trim() && !bulkView && bulkAmen.size === 0}>{t("Applica a")} {sel.size}</Button>
            <Button variant="secondary" size="sm" onClick={() => { clearSel(); setBulkFloor(""); setBulkView(""); setBulkAmen(new Set()); setShowAmen(false); }} className="ml-auto">{t("Annulla")}</Button>
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
  const { roomTypes, units, bookings, addUnit, updateUnit, deleteUnit, setActiveStructure, addActivity } = useData();
  const { t } = useLang();
  const ask = useConfirm();
  const toast = useToast();
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
  const [f, setF] = useState<Partial<Unit>>(() => unit
    ? { ...unit, amenities: Array.from(new Set([...amenitiesFor(unit.roomTypeId), ...(unit.amenities ?? [])])) }
    : { ...nextRoom(types[0]?.id ?? ""), roomTypeId: types[0]?.id ?? "", amenities: [...amenitiesFor(types[0]?.id ?? "")], floor: "", view: "", outOfService: false });
  const set = <K extends keyof Unit>(k: K, v: Unit[K]) => setF((p) => ({ ...p, [k]: v }));
  // Codice camera automatico = prime 3 lettere tipologia + numero (nome). Non si digita.
  const codeOf = (name?: string, rtId?: string) => { const rt = roomTypes.find((r) => r.id === rtId); const prefix = (rt?.name || "").replace(/\s+/g, "").slice(0, 3).toUpperCase(); const nm = (name || "").trim(); return nm ? `${prefix}${nm}` : ""; };
  const autoCode = codeOf(f.name, f.roomTypeId);
  const onPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try { const url = await uploadImage(file, "public"); setF((p) => ({ ...p, photos: [...(p.photos ?? []), url] })); } catch (e) { console.error("Caricamento foto non riuscito", e); toast(t("Impossibile caricare una foto"), "error"); }
    }
  };
  const removePhoto = (i: number) => setF((p) => ({ ...p, photos: (p.photos ?? []).filter((_, j) => j !== i) }));
  const toggleAmenity = (a: string) => setF((p) => { const cur = p.amenities ?? []; return { ...p, amenities: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] }; });

  const save = () => {
    if (!f.name?.trim() || !f.roomTypeId) return;
    // Due camere con lo stesso nome nella stessa struttura si confondono in calendario, prenotazioni e pulizie.
    if ((!unit || (unit.name || "").trim().toLowerCase() !== f.name.trim().toLowerCase()) && units.some((x) => x.structureId === structureId && x.id !== unit?.id && (x.name || "").trim().toLowerCase() === f.name!.trim().toLowerCase())) { toast(t("Esiste già una camera con questo nome in questa struttura.")); return; }
    const patch: Partial<Unit> = { name: f.name.trim(), roomTypeId: f.roomTypeId, code: codeOf(f.name, f.roomTypeId), floor: f.floor, view: f.view, accessInfo: f.accessInfo, notes: f.notes, outOfService: f.outOfService, oosReason: f.outOfService ? f.oosReason : undefined, photos: f.photos, amenities: f.amenities, bedConfig: f.bedConfig, size: f.size };
    if (unit) { updateUnit(unit.id, patch); addActivity("config", `Camera modificata — ${patch.name}`); }
    else { const id = addUnit({ structureId, roomTypeId: f.roomTypeId, name: patch.name! }); updateUnit(id, patch); }
    onClose();
  };

  return (
    <Modal title={unit ? t("Scheda camera") : t("Nuova camera")} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={`${lbl} sm:col-span-2`}>{t("Nome camera")} *<input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} className={`${inp} mt-1`} placeholder={t("Es. Camera Ortigia")} /></label>
        <label className={lbl}>{t("Codice")} <span className="font-normal text-faint">({t("automatico")})</span><input value={autoCode} readOnly title={t("Generato da tipologia + numero")} className={`${inp} mt-1 cursor-not-allowed bg-wash text-dim`} placeholder="—" /></label>
        <label className={lbl}>{t("Tipologia")}<select value={f.roomTypeId ?? ""} onChange={(e) => { const rid = e.target.value; if (unit) { setF((p) => ({ ...p, roomTypeId: rid, amenities: Array.from(new Set([...amenitiesFor(rid), ...(p.amenities ?? [])])) })); } else { const nr = nextRoom(rid); setF((p) => ({ ...p, roomTypeId: rid, name: nr.name, amenities: [...amenitiesFor(rid)] })); } }} className={`${inp} mt-1`}>{types.length === 0 && <option value="">{t("Crea prima una tipologia")}</option>}{types.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}</select></label>
        <label className={lbl}>{t("Piano")}<input value={f.floor ?? ""} onChange={(e) => set("floor", e.target.value)} className={`${inp} mt-1`} placeholder={t("Terra / 1° / 2°")} /></label>
        <label className={lbl}>{t("Vista")}<select value={f.view ?? ""} onChange={(e) => set("view", e.target.value)} className={`${inp} mt-1`}><option value="">—</option>{VIEW_OPTIONS.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></label>
        <label className={lbl}>{t("Configurazione letti")}<select value={f.bedConfig ?? ""} onChange={(e) => set("bedConfig", e.target.value || undefined)} className={`${inp} mt-1`}><option value="">{t("Come tipologia")}</option>{BED_CONFIGS.map((b) => <option key={b} value={b}>{t(b)}</option>)}</select></label>
        <label className={lbl}>{t("Metri quadri")}<input type="number" min={0} value={f.size ?? ""} onChange={(e) => set("size", e.target.value ? Number(e.target.value) : undefined)} className={`${inp} mt-1`} placeholder={t("Come tipologia")} /></label>
      </div>
      {hasGuide ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper p-2.5">
          <span className="text-[11px] text-dim">{t("Questi codici e istruzioni possono comparire nella guida ospiti della camera.")}</span>
          <Button size="xs" type="button" onClick={openGuide} className="shrink-0">{t("Apri la guida")} →</Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5" style={{ borderColor: "color-mix(in srgb, var(--focus) 35%, var(--line))", backgroundColor: "color-mix(in srgb, var(--focus) 6%, transparent)" }}>
          <span className="text-[11px] text-dim">🔒 {t("Con la Guida ospiti, codici e istruzioni della camera compaiono in una pagina web per l'ospite.")}</span>
          <Button size="xs" type="button" onClick={() => { onClose(); router.push("/abbonamento"); }} className="shrink-0">{t("Aggiungi il servizio")} →</Button>
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
                <MediaImg src={src} alt="" className="h-full w-full object-cover" />
                <button aria-label={t("Rimuovi")} type="button" onClick={() => removePhoto(i)} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-xs text-white opacity-0 transition group-hover:opacity-100" title={t("Rimuovi")}>✕</button>
              </div>
            ))}
          </div>
        ) : <p className="text-[11px] text-faint">{t("Nessuna foto. Le foto della camera potranno comparire nella guida ospiti e nel booking.")}</p>}
      </div>

      {/* Dotazioni specifiche della camera */}
      <div className="mt-3">
        <span className={lbl}>{t("Dotazioni della camera")} <span className="font-normal text-faint">· {t("ereditate dalla tipologia, personalizzabili")}</span></span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ROOM_AMENITIES.map((a) => {
            const on = (f.amenities ?? []).includes(a);
            return <button key={a} type="button" onClick={() => toggleAmenity(a)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(a)}</button>;
          })}
        </div>
        <p className="mt-1 text-[11px] text-faint">{t("Specifiche di questa camera, in aggiunta a quelle della tipologia.")}</p>
      </div>

      <div className="mt-3 rounded-lg border border-line p-3">
        <div className="flex items-center justify-between"><span className="text-sm font-medium text-txt">{t("Fuori servizio")}</span><Toggle label={t("Fuori servizio")} on={!!f.outOfService} onClick={() => set("outOfService", !f.outOfService)} color="var(--warn)" /></div>
        {f.outOfService && <input value={f.oosReason ?? ""} onChange={(e) => set("oosReason", e.target.value)} className={`${inp} mt-2`} placeholder={t("Motivo (es. ristrutturazione)")} />}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {unit && <button onClick={async () => { if (await ask({ title: t("Elimina camera"), message: `${t("Eliminare")} "${unit.name}"?${(() => { const today = new Date().toLocaleDateString("sv-SE"); const nb = bookings.filter((x) => x.unitId === unit.id && x.channel !== "blocked" && x.status !== "cancelled" && x.checkOut >= today).length; return nb ? ` ${nb} ${nb === 1 ? t("prenotazione in corso o futura resterà") : t("prenotazioni in corso o future resteranno")} ${t("senza camera (da assegnare).")}` : ""; })()}`, danger: true, confirmLabel: t("Elimina") })) { deleteUnit(unit.id); onClose(); } }} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button>}
        <Button variant="secondary" size="sm" onClick={onClose} className="ml-auto">{t("Annulla")}</Button>
        <Button size="sm" onClick={save} disabled={!f.name?.trim() || !f.roomTypeId}>{unit ? t("Salva") : t("Crea")}</Button>
      </div>
    </Modal>
  );
}
