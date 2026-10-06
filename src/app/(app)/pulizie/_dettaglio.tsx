"use client";

// Vista "Dettagliata" del planning pulizie: una riga alta per ogni camera da fare nel giorno scelto,
// con avanzamento complessivo, filtri rapidi con contatori e le azioni vere. Non duplica la
// persistenza: fatto/note/segnalazioni sono della pagina e arrivano come props e callback.
import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import type { Booking, Structure } from "@/lib/types";
import Icon from "@/components/Icon";
import EmptyState from "@/components/EmptyState";
import { WhatsAppIcon, MailIcon, PdfIcon } from "@/components/BrandIcons";
import RigaPulizia, { deadlineOf, type ActMap, type DetIssue, type DetRoom, type IssueMetaFn } from "./_riga";

type FilterKey = "tutte" | "dafare" | "fatte" | "turnover" | "partenze" | "arrivi" | "segnalazioni";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "tutte", label: "Tutte" },
  { key: "dafare", label: "Da fare" },
  { key: "fatte", label: "Fatte" },
  { key: "turnover", label: "Turnover" },
  { key: "partenze", label: "Partenze" },
  { key: "arrivi", label: "Arrivi" },
  { key: "segnalazioni", label: "Con segnalazioni" },
];

export interface DettaglioShare { whatsapp: () => void; email: () => void; copy: () => void; pdf: () => void; auto?: () => void; copied: boolean }

export default function PulizieDettaglio({ date, todayISO, rooms, scopedStructures, done, notes, openIssues, keyOf, issueMeta, act, setNote, onToggle, onIssue, onResolveIssue, share }: {
  date: string;
  todayISO: string;
  /** Tutte le camere delle strutture in ambito (già con colore tipologia), comprese quelle senza interventi o fuori servizio. */
  rooms: DetRoom[];
  scopedStructures: Structure[];
  done: Record<string, string>;
  notes: Record<string, string>;
  /** Segnalazioni non risolte già filtrate per la struttura attiva. */
  openIssues: DetIssue[];
  keyOf: (unitId: string) => string;
  issueMeta: IssueMetaFn;
  act: ActMap;
  setNote: (k: string, v: string) => void;
  onToggle: (k: string) => void;
  onIssue: (r: DetRoom) => void;
  onResolveIssue: (id: string) => void;
  share: DettaglioShare;
}) {
  const { guests, openBooking } = useData();
  const [filter, setFilter] = useState<FilterKey>("tutte");
  const [shareOpen, setShareOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(id); }, []);

  const guestName = (b: Booking) => {
    const g = guests.find((x) => x.id === b.guestId);
    if (g?.fullName?.trim()) return g.fullName.trim();
    if (g && (g.firstName || g.lastName)) return `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim();
    const p = b.primaryGuest;
    return p && (p.firstName || p.lastName) ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "";
  };

  const todo = useMemo(() => rooms.filter((r) => !r.oos && r.action !== "niente"), [rooms]);
  const isDone = (r: DetRoom) => !!done[keyOf(r.unit.id)];
  const issuesOf = (r: DetRoom) => openIssues.filter((i) => i.unitId === r.unit.id);
  const total = todo.length;
  const nDone = todo.filter(isDone).length;
  const pct = total ? Math.round((nDone / total) * 100) : 0;
  const idle = rooms.filter((r) => !r.oos && r.action === "niente").length;
  const oosRooms = rooms.filter((r) => r.oos);

  const match = (r: DetRoom, f: FilterKey) =>
    f === "tutte" ? true :
    f === "dafare" ? !isDone(r) :
    f === "fatte" ? isDone(r) :
    f === "turnover" ? r.action === "turnover" :
    f === "partenze" ? r.action === "partenza" || r.action === "turnover" :
    f === "arrivi" ? r.action === "arrivo" || r.action === "turnover" :
    issuesOf(r).length > 0;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, todo.filter((r) => match(r, f.key)).length])) as Record<FilterKey, number>;

  // Prima quelle da fare (con orario limite più vicino in alto), poi quelle già pulite.
  const sorted = (list: DetRoom[]) => list.map((r, i) => ({ r, i })).sort((x, y) => {
    const dx = isDone(x.r) ? 1 : 0, dy = isDone(y.r) ? 1 : 0;
    if (dx !== dy) return dx - dy;
    const lx = deadlineOf(x.r)?.min ?? Infinity, ly = deadlineOf(y.r)?.min ?? Infinity;
    if (lx !== ly) return lx < ly ? -1 : 1;
    return x.i - y.i;
  }).map((x) => x.r);

  const groups = scopedStructures
    .map((s) => ({ s, list: sorted(todo.filter((r) => r.structure.id === s.id && match(r, filter))), all: todo.filter((r) => r.structure.id === s.id) }))
    .filter((g) => g.all.length > 0);
  const shownCount = groups.reduce((n, g) => n + g.list.length, 0);
  const multi = scopedStructures.length > 1;

  const shareItem = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-txt hover:bg-wash";

  return (
    <div>
      {/* Avanzamento del giorno + condivisione */}
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <div className="min-w-[14rem] flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-bold text-txt">{total ? <><span className="font-mono text-xl tabular-nums">{nDone}</span> di <span className="font-mono text-xl tabular-nums">{total}</span> camere pulite</> : "Nessuna camera da pulire"}</span>
            {total > 0 && <span className="text-xs font-semibold text-dim">{pct}%</span>}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: total && nDone === total ? "var(--ok)" : "var(--focus)" }} /></div>
          {total > 0 && <div className="mt-1.5 text-xs" style={{ color: nDone === total ? "var(--ok)" : "var(--faint)" }}>{nDone === total ? "Tutto pulito ✓" : `${total - nDone} ${total - nDone === 1 ? "camera rimasta" : "camere rimaste"}`}</div>}
        </div>
        <div className="relative ml-auto">
          {share.copied && <span className="mr-2 text-xs font-medium text-[color:var(--ok)]">Copiato ✓</span>}
          <button onClick={() => setShareOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}><Icon name="share" size={15} /> Condividi con chi pulisce</button>
          {shareOpen && (<>
            <button aria-label="Chiudi" onClick={() => setShareOpen(false)} className="fixed inset-0 z-20 cursor-default" />
            <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl">
              <button onClick={() => { share.whatsapp(); setShareOpen(false); }} className={shareItem}><WhatsAppIcon size={16} /> WhatsApp</button>
              <button onClick={() => { share.email(); setShareOpen(false); }} className={shareItem}><MailIcon size={16} /> Email</button>
              <button onClick={() => { share.copy(); setShareOpen(false); }} className={shareItem}><Icon name="copy" size={15} /> Copia</button>
              <button onClick={() => { share.pdf(); setShareOpen(false); }} className={shareItem}><PdfIcon size={16} /> PDF</button>
              {share.auto && <><div className="my-1 border-t border-line" /><button onClick={() => { share.auto?.(); setShareOpen(false); }} className={shareItem}><Icon name="clock" size={15} /> Invio automatico</button></>}
            </div>
          </>)}
        </div>
      </div>

      {/* Filtri rapidi con contatori */}
      {total > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => {
            const on = filter === f.key;
            const warn = f.key === "segnalazioni" && counts[f.key] > 0;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={on} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${on ? "border-focus bg-focus text-white" : "border-line bg-surface text-dim hover:border-focus hover:text-focus"}`}>
                {f.label}
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${on ? "bg-white/25" : warn ? "bg-[color:color-mix(in_srgb,var(--err)_14%,transparent)] text-[color:var(--err)]" : "bg-wash"}`}>{counts[f.key]}</span>
              </button>
            );
          })}
        </div>
      )}

      {total === 0 ? (
        <div className="rounded-xl border border-line bg-surface"><EmptyState title="Nessuna pulizia in programma" sub="Nessuna partenza, arrivo o riassetto per questo giorno." /></div>
      ) : shownCount === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState title="Nessuna camera in questa categoria" />
          <div className="-mt-8 pb-8 text-center"><button onClick={() => setFilter("tutte")} className="text-xs font-semibold text-focus hover:underline">Mostra tutte</button></div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ s, list, all }) => list.length === 0 ? null : (
            <section key={s.id}>
              {multi && (
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.photoColor || "var(--focus)" }} />
                  <h2 className="font-display text-lg font-bold text-txt">{s.name}</h2>
                  <span className="text-xs text-faint">· {all.filter((r) => !isDone(r)).length} da fare</span>
                </div>
              )}
              <div className="flex flex-col gap-3">
                {list.map((r) => (
                  <RigaPulizia
                    key={r.unit.id} r={r} act={act} keyOf={keyOf} guests={guests} guestName={guestName}
                    doneIso={done[keyOf(r.unit.id)]} now={now} todayISO={todayISO} date={date}
                    issues={issuesOf(r)} issueMeta={issueMeta}
                    note={notes[keyOf(r.unit.id)] ?? ""} setNote={setNote}
                    onToggle={() => onToggle(keyOf(r.unit.id))} onIssue={() => onIssue(r)}
                    onResolveIssue={onResolveIssue} onOpenBooking={openBooking}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {(idle > 0 || oosRooms.length > 0) && (
        <p className="mt-4 text-xs text-faint">
          {idle > 0 && <>{idle} {idle === 1 ? "camera" : "camere"} senza interventi in questo giorno. </>}
          {oosRooms.length > 0 && <>Fuori servizio: {oosRooms.map((r) => r.unit.name + (r.oosNote ? ` (${r.oosNote})` : "")).join(", ")}.</>}
        </p>
      )}
    </div>
  );
}
