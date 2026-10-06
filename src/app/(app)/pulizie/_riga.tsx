"use client";

// Riga alta della vista "Dettagliata" del planning pulizie: una camera da fare, con targa, tipo di
// intervento, orario limite, ospiti in uscita/arrivo, note, segnalazioni e le azioni vere (pulita, nota,
// problema, apri prenotazione). Non possiede nessuno stato persistente: fatto/note/segnalazioni vivono
// nella pagina e arrivano qui come props + callback.
import { useState } from "react";
import { nights, parseISO, toISO } from "@/lib/dates";
import type { Booking, Guest } from "@/lib/types";
import type { PlanRoom, ActionKey } from "@/lib/puliziePlan";
import Icon from "@/components/Icon";

export type DetRoom = PlanRoom & { typeColor: string };
export interface DetIssue { id: string; unitId: string; unitName: string; structureName: string; date: string; type: string; note: string; photo?: string; createdAt: string }
export type ActMap = Record<ActionKey, { label: string; color: string }>;
export type IssueMetaFn = (key: string) => { label: string; icon: string; color: string };

const fmtShort = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
const timeOf = (iso: string) => { try { return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

const toMin = (s?: string) => { const m = s ? /(\d{1,2}):(\d{2})/.exec(s) : null; return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Orario entro cui la camera deve essere pronta: check-in della struttura, o l'arrivo comunicato dall'ospite se più presto. Solo se c'è un arrivo e almeno un dato reale. */
export function deadlineOf(r: DetRoom): { min: number; source: "struttura" | "ospite"; raw?: string } | null {
  if (!r.arr) return null;
  const a = toMin(r.structure.checkInFrom);
  const raw = r.arr.arrivalTime && r.arr.arrivalTime !== "Non lo so" ? r.arr.arrivalTime : undefined;
  const g = toMin(raw);
  if (a == null && g == null) return null;
  if (g != null && (a == null || g < a)) return { min: g, source: "ospite", raw };
  return { min: a as number, source: "struttura" };
}

const TYPE_LABEL: Record<ActionKey, string> = { turnover: "Turnover", partenza: "Partenza", arrivo: "Arrivo", riassetto: "Riassetto", niente: "Niente" };

function GuestLine({ kind, b, guest, name, checkOutBy, onOpen }: { kind: "out" | "in" | "stay"; b: Booking; guest?: Guest; name: string; checkOutBy?: string; onOpen: () => void }) {
  const col = kind === "in" ? "var(--ok)" : kind === "out" ? "var(--err)" : "var(--focus)";
  const label = kind === "in" ? "Entra" : kind === "out" ? "Esce" : "In casa";
  const icon = kind === "in" ? "login" : kind === "out" ? "logout" : "bed";
  const n = nights(b.checkIn, b.checkOut);
  const people = b.adults + b.children;
  const dog = (guest?.tags ?? []).includes("Animali");
  const request = kind !== "out" ? [b.guestRequests?.trim()].filter(Boolean) : [];
  const prefs = kind !== "out" ? guest?.preferences?.trim() : "";
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex w-[4.25rem] shrink-0 items-center gap-1 text-xs font-semibold" style={{ color: col }}><Icon name={icon} size={13} /> {label}</span>
        <span className="min-w-0 break-words text-sm font-bold text-txt">{name || "—"}</span>
        <button onClick={onOpen} title="Apri prenotazione" className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-focus transition hover:border-focus hover:bg-wash">Apri prenotazione</button>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-0 text-xs text-dim sm:pl-[4.75rem]">
        <span className="inline-flex items-center gap-1"><Icon name="users" size={12} />{people} {people === 1 ? "ospite" : "ospiti"}{b.children > 0 && <span className="text-faint">({b.adults} ad. + {b.children} bamb.)</span>}</span>
        <span className="text-faint">·</span>
        <span>{n} {n === 1 ? "notte" : "notti"}</span>
        <span className="text-faint">·</span>
        <span className="font-mono text-[11px]">{fmtShort(b.checkIn)} → {fmtShort(b.checkOut)}</span>
        {kind === "out" && checkOutBy && <span className="text-faint">· check-out entro le {checkOutBy}</span>}
        {dog && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 14%, transparent)" }}><Icon name="paw" size={12} /> Animale</span>}
        {(b.cribs ?? 0) > 0 && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: "var(--focus)", background: "color-mix(in srgb, var(--focus) 12%, transparent)" }}><Icon name="bed" size={12} /> {(b.cribs ?? 0) > 1 ? `${b.cribs} culle` : "Culla"}</span>}
      </div>
      {(request.length > 0 || prefs) && (
        <div className="mt-1.5 flex flex-col gap-1 sm:pl-[4.75rem]">
          {request.map((txt, i) => (
            <div key={i} className="flex items-start gap-1.5 rounded-lg px-2 py-1 text-[11px] leading-snug text-txt" style={{ background: "color-mix(in srgb, var(--focus) 10%, transparent)" }}>
              <span className="mt-0.5 shrink-0 text-focus"><Icon name="chat" size={12} /></span><span className="min-w-0 break-words"><b className="text-focus">Richiesta dell'ospite:</b> {txt}</span>
            </div>
          ))}
          {prefs && <div className="flex items-start gap-1.5 rounded-lg px-2 py-1 text-[11px] leading-snug text-txt" style={{ background: "color-mix(in srgb, var(--faint) 14%, transparent)" }}><span className="mt-0.5 shrink-0 text-dim"><Icon name="id" size={12} /></span><span className="min-w-0 break-words"><b className="text-dim">Preferenze:</b> {prefs}</span></div>}
        </div>
      )}
    </div>
  );
}

export default function RigaPulizia({ r, act, keyOf, guests, guestName, doneIso, now, todayISO, date, issues, issueMeta, note, setNote, onToggle, onIssue, onResolveIssue, onOpenBooking }: {
  r: DetRoom;
  act: ActMap;
  keyOf: (unitId: string) => string;
  guests: Guest[];
  guestName: (b: Booking) => string;
  doneIso?: string;
  now: Date;
  todayISO: string;
  date: string;
  issues: DetIssue[];
  issueMeta: IssueMetaFn;
  note: string;
  setNote: (k: string, v: string) => void;
  onToggle: () => void;
  onIssue: () => void;
  onResolveIssue: (id: string) => void;
  onOpenBooking: (id: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const k = keyOf(r.unit.id);
  const a = act[r.action];
  const isDone = !!doneIso;
  const tint = r.typeColor || r.structure.photoColor || "var(--focus)";
  const guestOf = (b: Booking) => guests.find((g) => g.id === b.guestId);
  const dl = deadlineOf(r);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const overdue = !!dl && !isDone && date === todayISO && nowMin > dl.min;
  const dlColor = overdue ? "var(--err)" : "var(--warn)";
  const doneLabel = (() => {
    if (!doneIso) return "";
    const d = new Date(doneIso);
    if (isNaN(d.getTime())) return "";
    return toISO(d) === todayISO ? `oggi alle ${timeOf(doneIso)}` : `${fmtShort(toISO(d))} alle ${timeOf(doneIso)}`;
  })();
  const hasNote = note.trim().length > 0;
  const poi = r.oosFrom ? (r.oosNote ? `Poi fuori servizio: ${r.oosNote}` : "Poi fuori servizio") : "";

  return (
    <article className={`flex flex-col gap-3 rounded-2xl border bg-surface p-3 shadow-sm transition md:flex-row md:items-stretch md:gap-4 ${isDone ? "border-line opacity-75" : "border-line hover:border-focus hover:shadow-md"}`} style={issues.length ? { borderColor: "color-mix(in srgb, var(--err) 45%, var(--line))" } : undefined}>
      {/* Targa camera: numero su fondo tenue del colore della tipologia (nessuna anteprima) */}
      <div className="grid h-12 w-12 shrink-0 place-items-center self-start rounded-lg text-base font-bold" title={r.typeName || "Senza tipologia"} style={{ background: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint }}>
        {isDone ? "✓" : r.unit.name.replace(/^camera\s*/i, "")}
      </div>

      {/* Intervento, ospiti, note, segnalazioni */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h3 className={`font-display text-base font-bold ${isDone ? "text-dim line-through" : "text-txt"}`}>{r.unit.name}</h3>
          <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: a.color, background: `color-mix(in srgb, ${a.color} 14%, transparent)` }}>{TYPE_LABEL[r.action]}</span>
          {dl && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: dlColor, background: `color-mix(in srgb, ${dlColor} 14%, transparent)` }} title={dl.source === "ospite" ? `L'ospite ha comunicato l'arrivo: ${dl.raw}` : "Orario di check-in della struttura"}>
              <Icon name="clock" size={12} /> entro le {hhmm(dl.min)}{overdue ? " · scaduto" : ""}
            </span>
          )}
          {dl?.source === "ospite" && dl.raw && <span className="text-[11px] text-faint">arrivo ospite {dl.raw}</span>}
          {isDone && <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ color: "var(--ok)", background: "color-mix(in srgb, var(--ok) 14%, transparent)" }}>✓ Pulita {doneLabel}</span>}
        </div>

        <div className="mt-2.5 flex flex-col gap-2.5">
          {r.dep && <GuestLine kind="out" b={r.dep} guest={guestOf(r.dep)} name={guestName(r.dep)} checkOutBy={r.structure.checkOutBy} onOpen={() => onOpenBooking(r.dep!.id)} />}
          {r.arr && <GuestLine kind="in" b={r.arr} guest={guestOf(r.arr)} name={guestName(r.arr)} onOpen={() => onOpenBooking(r.arr!.id)} />}
          {!r.dep && !r.arr && r.stay && <GuestLine kind="stay" b={r.stay} guest={guestOf(r.stay)} name={guestName(r.stay)} onOpen={() => onOpenBooking(r.stay!.id)} />}
          {r.action === "arrivo" && !r.dep && <div className="text-xs text-faint sm:pl-[4.75rem]">Nessuna partenza oggi: la camera è già libera</div>}
          {r.action === "partenza" && <div className="text-xs text-faint sm:pl-[4.75rem]">Nessun arrivo oggi</div>}
          {poi && <div className="flex items-start gap-1.5 rounded-lg px-2 py-1 text-[11px] text-dim" style={{ background: "color-mix(in srgb, var(--faint) 16%, transparent)" }}><Icon name="settings" size={12} /> <b>{poi}</b></div>}
        </div>

        {/* Note per la signora */}
        {(noteOpen || hasNote) && (
          <div className="mt-3">
            {noteOpen ? (
              <div className="flex items-center gap-2">
                <input autoFocus value={note} onChange={(e) => setNote(k, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setNoteOpen(false); }} placeholder="Nota per chi pulisce: culla, asciugamani, richieste…" className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
                <button onClick={() => setNoteOpen(false)} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-dim hover:bg-wash">Fine</button>
              </div>
            ) : (
              <button onClick={() => setNoteOpen(true)} title="Modifica la nota" className="flex w-full items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs leading-snug text-txt transition hover:opacity-80" style={{ background: "color-mix(in srgb, var(--warn) 12%, transparent)" }}>
                <span className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }}><Icon name="clipboard" size={13} /></span><span className="min-w-0 break-words"><b style={{ color: "var(--warn)" }}>Nota per chi pulisce:</b> {note}</span>
              </button>
            )}
          </div>
        )}

        {/* Segnalazioni aperte della camera */}
        {issues.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {issues.map((iss) => { const m = issueMeta(iss.type); return (
              <div key={iss.id} className="flex items-start gap-2 rounded-lg border bg-paper p-2" style={{ borderColor: "color-mix(in srgb, var(--err) 35%, var(--line))" }}>
                {iss.photo
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <button onClick={() => setZoom(iss.photo!)} title="Ingrandisci la foto" className="shrink-0"><img src={iss.photo} alt="" className="h-14 w-14 rounded-md object-cover" /></button>
                  : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${m.color} 14%, transparent)`, color: m.color }}><Icon name={m.icon} size={20} /></span>}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: m.color }}>{m.label}</div>
                  <div className="break-words text-xs text-txt">{iss.note}</div>
                  <div className="mt-0.5 text-[10px] text-faint">Segnalata {fmtShort(iss.date)}{timeOf(iss.createdAt) ? ` · ${timeOf(iss.createdAt)}` : ""}</div>
                </div>
                <button onClick={() => onResolveIssue(iss.id)} title="Segna come risolta" className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold hover:bg-wash" style={{ color: "var(--ok)" }}>✓ Risolta</button>
              </div>
            ); })}
          </div>
        )}
      </div>

      {/* Azioni */}
      <div className="flex shrink-0 flex-row flex-wrap items-stretch gap-2 border-t border-line pt-3 md:w-48 md:flex-col md:flex-nowrap md:border-l md:border-t-0 md:pl-4 md:pt-0">
        {isDone ? (
          <>
            <div className="min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-center text-xs font-semibold md:flex-none" style={{ color: "var(--ok)", background: "color-mix(in srgb, var(--ok) 14%, transparent)" }}>✓ Pulita<span className="block text-[11px] font-medium opacity-80">{doneLabel}</span></div>
            <button onClick={onToggle} className="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-dim transition hover:border-[color:var(--err)] hover:text-[color:var(--err)] md:flex-none">Annulla</button>
          </>
        ) : (
          <button onClick={onToggle} className="min-w-[8rem] flex-1 rounded-lg bg-focus px-3 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 md:flex-none">Segna come pulita</button>
        )}
        <button onClick={() => setNoteOpen((v) => !v)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition md:flex-none ${noteOpen ? "border-focus text-focus" : "border-line text-dim hover:border-focus hover:text-focus"}`}><Icon name="clipboard" size={14} /> {hasNote ? "Modifica nota" : "Aggiungi nota"}</button>
        <button onClick={onIssue} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-dim transition hover:border-[color:var(--err)] hover:text-[color:var(--err)] md:flex-none"><Icon name="alertTriangle" size={14} /> Segnala un problema</button>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setZoom(null)} className="absolute inset-0 bg-black/70" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="relative max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl" />
        </div>
      )}
    </article>
  );
}
