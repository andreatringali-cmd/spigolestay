"use client";

// Camere · Dettagliata: una riga alta per camera con anteprima, caratteristiche, stato di oggi, prossimo arrivo,
// occupazione, tariffa e segnalazioni. Le azioni risolvono sul posto (modifica, fuori servizio, nuova prenotazione, foto, codici, tariffa).
// Mostra le camere di UNA struttura già filtrate dalla pagina (ricerca per tipologia o camera).
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import type { Booking, RoomType, Structure, Unit } from "@/lib/types";
import { shiftISO, toISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { downscaleImage } from "@/lib/images";
import { AV_COLORS } from "@/lib/users";
import { byUnitName } from "@/lib/sortUnits";
import { amenityIcon } from "@/lib/amenities";
import { useAccess } from "@/lib/access";
import EmptyState from "@/components/EmptyState";
import { occupies } from "@/app/(app)/calendario/_modello";
import { CodiceDialog, FuoriServizioDialog, TariffaDialog } from "./_azioni";
import { flagsOf, readAccessMap, snapshotOf, TONE_VAR, type Flag, type FlagAction, type Snapshot } from "./_modello";

const FILTERS = [
  { key: "all", label: "Tutte" },
  { key: "free", label: "Libere oggi" },
  { key: "busy", label: "Occupate" },
  { key: "move", label: "Movimento oggi" },
  { key: "flags", label: "Con segnalazioni" },
  { key: "oos", label: "Fuori servizio" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const pill = (c: string) => ({ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` });
const btn = "rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-dim transition hover:border-focus hover:text-focus disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-dim";

interface Row { u: Unit; rt?: RoomType; color: string; snap: Snapshot; flags: Flag[] }

export default function CamereDettaglio({ structure, types, units, totalUnits, showStructure, highlight, onEdit, onClearSearch }: {
  structure: Structure;
  types: RoomType[];
  /** Camere della struttura già filtrate dalla ricerca. */
  units: Unit[];
  /** Camere della struttura prima del filtro di ricerca (per distinguere "nessuna camera" da "nessun risultato"). */
  totalUnits: number;
  showStructure: boolean;
  highlight: string | null;
  onEdit: (u: Unit) => void;
  onClearSearch: () => void;
}) {
  const router = useRouter();
  const { bookings, guests, units: allUnits, updateUnit, addActivity, openNewBooking } = useData();
  const { moduleOn } = useAccess();
  const today = toISO(new Date());
  const [filter, setFilter] = useState<FilterKey>("all");
  const [oosFor, setOosFor] = useState<string | null>(null);
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<string | null>(null);
  const unitsRef = useRef(allUnits);
  useEffect(() => { unitsRef.current = allUnits; }, [allUnits]);

  // Codici d'accesso: letti dal browser (come la Guida ospiti); si rileggono al ritorno sulla pagina.
  useEffect(() => {
    const h = () => setAccess(readAccessMap());
    h();
    window.addEventListener("focus", h);
    return () => window.removeEventListener("focus", h);
  }, []);
  useEffect(() => { if (!msg) return; const t = window.setTimeout(() => setMsg(null), 4000); return () => window.clearTimeout(t); }, [msg]);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const guestName = useMemo(() => (b: Booking) => guestById.get(b.guestId)?.fullName || [b.primaryGuest?.firstName, b.primaryGuest?.lastName].filter(Boolean).join(" ") || "Ospite", [guestById]);
  const byUnit = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of bookings) if (b.unitId && occupies(b)) (m.get(b.unitId) ?? m.set(b.unitId, []).get(b.unitId)!).push(b);
    return m;
  }, [bookings]);
  const checkAccess = moduleOn("concierge");

  const rows: Row[] = useMemo(() => {
    const typeIdx = (u: Unit) => { const i = types.findIndex((t) => t.id === u.roomTypeId); return i < 0 ? 9999 : i; };
    return [...units].sort((a, b) => typeIdx(a) - typeIdx(b) || byUnitName(a, b)).map((u) => {
      const i = types.findIndex((t) => t.id === u.roomTypeId);
      const rt = i >= 0 ? types[i] : undefined;
      const snap = snapshotOf(u, byUnit.get(u.id) ?? [], today, guestName);
      const accessOk = !!access[u.id] || !!(u.accessInfo || "").trim();
      return { u, rt, color: rt ? (rt.color ?? AV_COLORS[i % AV_COLORS.length]) : "var(--line)", snap, flags: flagsOf({ unit: u, rt, snap, accessOk, checkAccess }) };
    });
  }, [units, types, byUnit, today, guestName, access, checkAccess]);

  const match = (r: Row, f: FilterKey) => {
    const k = r.snap.stato.kind;
    if (f === "free") return k === "free";
    if (f === "busy") return k === "occupied" || k === "arrive" || k === "depart" || k === "turnover";
    if (f === "move") return k === "arrive" || k === "depart" || k === "turnover";
    if (f === "flags") return r.flags.length > 0;
    if (f === "oos") return !!r.u.outOfService;
    return true;
  };
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => match(r, f.key)).length])) as Record<FilterKey, number>, [rows]);
  const shown = rows.filter((r) => match(r, filter));

  // ── Azioni ──
  const pickPhoto = (u: Unit) => { photoTarget.current = u.id; fileRef.current?.click(); };
  const onFiles = async (files: FileList | null) => {
    const id = photoTarget.current;
    if (!files?.length || !id) return;
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try { urls.push(await downscaleImage(file, 900, 0.72)); } catch { /* immagine illeggibile: si salta */ }
    }
    if (!urls.length) { setMsg("Nessuna immagine valida selezionata."); return; }
    const cur = unitsRef.current.find((x) => x.id === id);
    updateUnit(id, { photos: [...(cur?.photos ?? []), ...urls] });
    addActivity("config", `Foto aggiunte — ${cur?.name ?? "camera"}`, cur?.structureId);
    setMsg(urls.length === 1 ? "Foto aggiunta." : `${urls.length} foto aggiunte.`);
  };
  const backInService = (u: Unit) => {
    updateUnit(u.id, { outOfService: false, oosReason: undefined });
    addActivity("config", `Camera rimessa in servizio — ${u.name}`, u.structureId);
    setMsg(`${u.name} è di nuovo in servizio.`);
  };
  const newBooking = (r: Row) => {
    const d = r.snap.firstFree ?? today;
    openNewBooking({ structureId: r.u.structureId, roomTypeId: r.u.roomTypeId, unitId: r.u.id, checkIn: d, checkOut: shiftISO(d, 1) });
  };
  const run = (r: Row, a: FlagAction) => {
    if (a === "photo") pickPhoto(r.u);
    else if (a === "code") setCodeFor(r.u.id);
    else if (a === "rate") setRateFor(r.u.id);
    else if (a === "edit") onEdit(r.u);
    else if (a === "back") backInService(r.u);
    else if (a === "calendar") router.push("/calendario");
  };

  const oosRow = oosFor ? rows.find((r) => r.u.id === oosFor) : undefined;
  const codeRow = codeFor ? rows.find((r) => r.u.id === codeFor) : undefined;
  const rateRow = rateFor ? rows.find((r) => r.u.id === rateFor) : undefined;

  if (totalUnits === 0) return <div className="mt-2 rounded-xl border border-dashed border-line"><EmptyState title="Nessuna camera. Aggiungine una col pulsante “+ Camera”." /></div>;

  return (
    <div className="mt-2">
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />

      <div className="no-print mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter === f.key ? "border-focus bg-focus text-white" : "border-line bg-surface text-dim hover:border-focus hover:text-focus"}`}>
            {f.label}{f.key !== "all" && counts[f.key] > 0 ? <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${filter === f.key ? "bg-white/25" : f.key === "flags" || f.key === "oos" ? "bg-[color:color-mix(in_srgb,var(--warn)_16%,transparent)] text-[color:var(--warn)]" : "bg-wash"}`}>{counts[f.key]}</span> : null}
          </button>
        ))}
        <span className="ml-auto text-xs text-faint">{shown.length} {shown.length === 1 ? "camera" : "camere"}</span>
      </div>
      {msg && <div role="status" className="mb-3 rounded-lg border border-line bg-wash px-3 py-2 text-xs font-medium text-txt">{msg}</div>}

      <div className="flex flex-col gap-3">
        {shown.map((r) => <RigaCamera key={r.u.id} r={r} today={today} structure={structure} showStructure={showStructure} highlight={highlight === r.u.id}
          onEdit={() => onEdit(r.u)} onPhoto={() => pickPhoto(r.u)} onOos={() => (r.u.outOfService ? backInService(r.u) : setOosFor(r.u.id))}
          onNew={() => newBooking(r)} onCalendar={() => router.push("/calendario")} onFlag={(a) => run(r, a)} />)}
        {shown.length === 0 && (
          <div className="rounded-xl border border-dashed border-line">
            {rows.length === 0
              ? <EmptyState title="Nessuna camera corrisponde alla ricerca" sub="Prova con un altro nome, codice o tipologia." />
              : <EmptyState title={filter === "free" ? "Nessuna camera libera oggi" : filter === "flags" ? "Nessuna segnalazione: è tutto a posto" : filter === "oos" ? "Nessuna camera fuori servizio" : "Nessuna camera in questa categoria"} />}
            <div className="flex justify-center gap-2 pb-5">
              {rows.length === 0 && <button onClick={onClearSearch} className={btn}>Cancella la ricerca</button>}
              {rows.length > 0 && filter !== "all" && <button onClick={() => setFilter("all")} className={btn}>Mostra tutte le camere</button>}
            </div>
          </div>
        )}
      </div>

      {oosRow && <FuoriServizioDialog unit={oosRow.u} openBookings={oosRow.snap.openBookings} guestName={guestName} onClose={() => setOosFor(null)} />}
      {codeRow && <CodiceDialog unit={codeRow.u} onClose={() => setCodeFor(null)} onSaved={() => { setAccess(readAccessMap()); setMsg(`Codice salvato per ${codeRow.u.name}.`); }} />}
      {rateRow && rateRow.rt && <TariffaDialog rt={rateRow.rt} units={allUnits.filter((x) => x.roomTypeId === rateRow.rt!.id).length} onClose={() => setRateFor(null)} />}
    </div>
  );
}

function RigaCamera({ r, today, structure, showStructure, highlight, onEdit, onPhoto, onOos, onNew, onCalendar, onFlag }: {
  r: Row; today: string; structure: Structure; showStructure: boolean; highlight: boolean;
  onEdit: () => void; onPhoto: () => void; onOos: () => void; onNew: () => void; onCalendar: () => void; onFlag: (a: FlagAction) => void;
}) {
  const { u, rt, color, snap, flags } = r;
  const photo = u.photos?.[0];
  const tint = rt?.color || structure.photoColor || "var(--focus)";
  const num = u.name.replace(/^camera\s*/i, "");
  const amen = Array.from(new Set([...(rt?.amenities ?? []), ...(u.amenities ?? [])]));
  const size = u.size ?? rt?.size;
  const bedConfig = u.bedConfig || rt?.bedConfig;
  const st = snap.stato;
  const stCol = TONE_VAR[st.tone];
  const nextLabel = snap.next ? new Date(snap.next.checkIn + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }) : "";
  const noRate = !rt || (!rt.deriveFrom && !(rt.basePrice > 0));
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <article id={`unit-${u.id}`} onClick={onEdit} className={`group flex cursor-pointer flex-col gap-3 rounded-2xl border bg-surface p-3 shadow-sm transition hover:border-focus hover:shadow-md ${highlight ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_8%,transparent)]" : "border-line"} ${u.outOfService ? "opacity-90" : ""}`} style={{ borderLeft: `4px solid ${color}` }}>
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-4">
        {/* Anteprima */}
        <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-xl md:h-auto md:min-h-[8.5rem] md:w-40" style={photo ? undefined : { background: `linear-gradient(145deg, color-mix(in srgb, ${tint} 85%, #fff), color-mix(in srgb, ${tint} 70%, #000))` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          {!photo && <div className="absolute inset-0 grid place-items-center text-center text-white"><div><div className="text-3xl font-extrabold leading-none drop-shadow">{num || "—"}</div></div></div>}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-white">
            <div className="truncate text-sm font-bold leading-tight">{photo ? num : (rt?.name ?? "Senza tipologia")}</div>
            {photo && <div className="truncate text-[11px] opacity-90">{rt?.name ?? "Senza tipologia"}</div>}
          </div>
          {!photo && <button onClick={stop(onPhoto)} className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-black/70">＋ Foto</button>}
          {photo && (u.photos?.length ?? 0) > 1 && <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">{u.photos!.length} foto</span>}
        </div>

        {/* Camera e caratteristiche */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className={`min-w-0 truncate text-base font-bold ${u.outOfService ? "text-faint line-through" : "text-txt"}`}>{u.name}</h3>
            {u.code && <span className="font-mono text-[11px] text-faint">{u.code}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-dim">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />{rt?.name ?? <span className="italic text-faint">Senza tipologia</span>}</span>
            {showStructure && <><span className="text-faint">·</span><span>{structure.name}</span></>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {u.floor && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">Piano {u.floor}</span>}
            {u.view && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">Vista {u.view.toLowerCase()}</span>}
            {rt?.beds ? <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{rt.beds} {rt.beds === 1 ? "posto letto" : "posti letto"}</span> : null}
            {size ? <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{size} m²</span> : null}
            {bedConfig && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{bedConfig}</span>}
          </div>
          {amen.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {amen.slice(0, 5).map((a) => <span key={a} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-dim"><span className="[&>svg]:h-3 [&>svg]:w-3" aria-hidden>{amenityIcon(a)}</span>{a}</span>)}
              {amen.length > 5 && <span className="self-center text-[11px] text-faint">+{amen.length - 5}</span>}
            </div>
          )}
          {u.notes && <div className="mt-1.5 truncate text-[11px] text-faint" title={u.notes}>Note: {u.notes}</div>}
        </div>

        {/* Stato di oggi, prossimo arrivo, occupazione, tariffa */}
        <div className="flex shrink-0 flex-col gap-2 border-t border-line pt-2 md:w-64 md:border-l md:border-t-0 md:pl-4 md:pt-0">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={pill(stCol)}>{st.label}</span>
              {st.kind === "free" && st.detail && <span className="text-[11px] text-faint">{st.detail}</span>}
            </div>
            {st.kind !== "free" && st.detail && <div className="mt-1 truncate text-xs font-medium text-txt" title={st.detail}>{st.detail}</div>}
            {st.kind === "oos" && snap.openBookings.length === 0 && !st.detail && <div className="mt-1 text-[11px] text-faint">Nessun motivo indicato</div>}
          </div>
          <div className="text-xs">
            <span className="text-faint">Prossimo arrivo: </span>
            {snap.next ? <span className="font-medium text-txt"><span className="capitalize">{nextLabel}</span> · {snap.nextGuest}</span> : <span className="text-faint">nessuno in programma</span>}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-dim">
              <span className="font-semibold">Prossimi 30 giorni: {snap.occ30n}/30 notti{snap.blocked30 ? ` · ${snap.blocked30} bloccate` : ""}</span>
            </div>
            <div className="flex h-2 gap-px overflow-hidden rounded-full" role="img" aria-label={`${snap.occ30n} notti occupate su 30`}>
              {snap.occ30.map((x, i) => <span key={i} className="h-full flex-1" style={{ background: x === "b" ? "var(--focus)" : x === "x" ? "var(--err)" : "var(--line)", opacity: x === "x" ? 0.6 : 1 }} />)}
            </div>
            <div className="mt-1 text-[11px] text-faint">Occupazione di {snap.monthLabel}: <span className="font-semibold text-dim">{snap.monthPct}%</span></div>
          </div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-faint">Tariffa base</span>
            {noRate ? <span className="font-semibold" style={{ color: "var(--err)" }}>non impostata</span> : <span className="font-mono text-sm font-bold text-txt">{rt && rt.basePrice > 0 ? eur(rt.basePrice) : "derivata"}<span className="text-[10px] font-normal text-faint"> /notte</span></span>}
          </div>
        </div>
      </div>

      {/* Segnalazioni risolvibili */}
      {flags.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
          {flags.map((f) => {
            const c = f.tone === "err" ? "var(--err)" : f.tone === "warn" ? "var(--warn)" : "var(--dim)";
            return (
              <div key={f.key} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg px-2.5 py-1.5" style={{ background: `color-mix(in srgb, ${c} 9%, transparent)` }} title={f.title}>
                <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-extrabold" style={{ color: c, border: `1.5px solid ${c}` }}>!</span>
                <span className="min-w-0 flex-1 text-xs font-medium text-txt">{f.label}</span>
                <span className="flex flex-wrap gap-1.5">
                  {f.actions.map((a) => <button key={a.run} onClick={stop(() => onFlag(a.run))} className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: c }}>{a.label}</button>)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Azioni sulla riga */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5" onClick={(e) => e.stopPropagation()}>
        <button onClick={onEdit} className={btn}>Modifica camera</button>
        <button onClick={onNew} disabled={!!u.outOfService} title={u.outOfService ? "La camera è fuori servizio" : snap.firstFree && snap.firstFree !== today ? `Prima notte libera: ${snap.firstFree}` : "Crea una prenotazione su questa camera"} className={btn}>Nuova prenotazione</button>
        <button onClick={onOos} className={btn}>{u.outOfService ? "Rimetti in servizio" : "Metti fuori servizio"}</button>
        <button onClick={onPhoto} className={btn}>＋ Foto</button>
        <button onClick={onCalendar} className={`${btn} md:ml-auto`}>Vedi nel calendario →</button>
      </div>
    </article>
  );
}
