"use client";

// Colonna "Stato" della vista Compatta: 8 icone fisse (check-in, pagamento, guida, schedina Questura, osservatorio,
// tassa, fattura, check-out), nello stesso ordine della vista Dettagliata. Il colore dice lo stato (fatto / da fare /
// in ritardo / non applicabile), l'icona dice il passaggio; cliccando uno non ancora fatto si apre la finestra
// "Risolvi" (StepActions), come nella Dettagliata. I percorsi si calcolano solo per le righe visibili.
import { createContext, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { toISO } from "@/lib/dates";
import { journeyOf, isLiveBooking, type StepState } from "@/lib/booking-journey";
import { isGuideSent, reminderNotes, useReminderLog } from "@/lib/guest-messages";
import { useAutoCtx } from "@/lib/use-auto-ctx";
import { useDatiPercorso } from "@/app/(app)/calendario/_dati";
import { SLOT_KEYS, SLOT_LABELS, slotsOf, type Slot, type SlotKey } from "@/lib/journey-slots";
import type { Booking } from "@/lib/types";
import Icon from "@/components/Icon";
import StepActions from "./_azioni";

const SLOT_ICON: Record<SlotKey, string> = { checkin: "login", pay: "card", guide: "book", alloggiati: "shield", istat: "chart", tax: "coins", invoice: "invoice", checkout: "logout" };
const STATE_COLOR: Record<StepState, string> = { done: "var(--ok)", todo: "var(--warn)", late: "var(--err)", na: "var(--faint)" };
const STATE_WORD: Record<StepState, string> = { done: "fatto", todo: "da fare", late: "in ritardo", na: "non applicabile" };

const SEP = "\u0001";
interface Ctx { slots: (id: string) => Slot[]; open: (b: Booking, s: Slot) => void }
const StatoCtx = createContext<Ctx | null>(null);

/** Carica i dati dei percorsi e la finestra "Risolvi" per le righe indicate (`ids`). Va montato solo nella vista Compatta. */
export function StatoProvider({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const router = useRouter();
  const { bookings: allBookings, guests, getStructure } = useData();
  const { schedBy, istatBy, docBy, threads, rems, reload } = useDatiPercorso();
  const [modal, setModal] = useState<{ id: string; key: string } | null>(null);
  const today = toISO(new Date());

  const byId = useMemo(() => new Map(allBookings.map((b) => [b.id, b])), [allBookings]);
  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const idsKey = ids.join(SEP);
  // Solo le prenotazioni visibili (≈150 per pagina): niente calcolo sulle migliaia di righe fuori vista.
  const visible = useMemo(() => idsKey ? idsKey.split(SEP).map((id) => byId.get(id)).filter((b): b is Booking => !!b) : [], [idsKey, byId]);
  const remLog = useReminderLog(visible);
  const auto = useAutoCtx();

  const slotMap = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const b of visible) {
      const live = isLiveBooking(b);
      const j = live ? journeyOf(b, {
        today, guest: guestById.get(b.guestId), structure: getStructure(b.structureId),
        schedina: schedBy.get(b.id) ?? "none", istat: istatBy.get(b.id) ?? "none",
        guideSent: isGuideSent(b, threads[b.guestId], remLog[b.id]),
        invoiceStato: docBy.get(b.id),
        reminderNotes: reminderNotes(remLog[b.id]), auto,
      }) : null;
      m.set(b.id, slotsOf(j?.steps, live ? "Non applicabile" : "Prenotazione annullata"));
    }
    return m;
  }, [visible, guestById, getStructure, today, schedBy, istatBy, threads, docBy, rems, remLog, auto]);

  const ctx = useMemo<Ctx>(() => ({
    slots: (id) => slotMap.get(id) ?? slotsOf(null),
    // Stesso comportamento della Dettagliata: non ancora fatto → finestra "Risolvi"; fatto/non applicabile → pagina collegata.
    open: (b, s) => {
      if (!s.step) return;
      if (s.state !== "done" && s.state !== "na") setModal({ id: b.id, key: s.key });
      else if (s.step.href) router.push(s.step.href);
    },
  }), [slotMap, router]);

  const mb = modal ? byId.get(modal.id) : undefined;
  const mSlots = modal ? slotMap.get(modal.id) : undefined;
  const mStep = mSlots?.find((s) => s.key === modal?.key)?.step;

  return (
    <StatoCtx.Provider value={ctx}>
      {children}
      {modal && mb && mStep && (
        <StepActions
          key={`${modal.id}:${modal.key}`}
          b={mb} step={mStep}
          guest={guestById.get(mb.guestId)} structure={getStructure(mb.structureId)}
          checkinDone={mSlots?.find((s) => s.key === "checkin")?.state === "done"}
          schedina={schedBy.get(mb.id) ?? "none"} istat={istatBy.get(mb.id) ?? "none"}
          paySentInChat={(threads[mb.guestId] ?? []).some((m) => m.dir === "out" && m.text.includes("chat-pay/go"))}
          onClose={() => setModal(null)} onSwitch={(key) => setModal({ id: modal.id, key })} onChanged={() => { void reload(); }}
        />
      )}
    </StatoCtx.Provider>
  );
}

function Mark({ state }: { state: StepState }) {
  if (state !== "done" && state !== "late") return null;
  return (
    <span aria-hidden className="pointer-events-none absolute -right-[3px] -top-[3px] grid h-[9px] w-[9px] place-items-center rounded-full text-white" style={{ backgroundColor: STATE_COLOR[state], boxShadow: "0 0 0 1.5px var(--surface)" }}>
      <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        {state === "done" ? <path d="M5 12.5l4.5 4.5L19 7" /> : <><path d="M12 5v9" /><path d="M12 19.5v.01" /></>}
      </svg>
    </span>
  );
}

/** Un passaggio: icona sul fondo tenue del colore dello stato, con un piccolo ✓ (fatto) o ! (in ritardo) nell'angolo. */
export function SlotIcon({ slot, onClick }: { slot: Slot; onClick?: () => void }) {
  const c = STATE_COLOR[slot.state];
  const na = slot.state === "na";
  const text = `${slot.label}: ${slot.detail}`;
  const style = { color: c, backgroundColor: na ? "transparent" : `color-mix(in srgb, ${c} ${slot.state === "todo" ? 12 : 14}%, transparent)`, opacity: na ? 0.4 : 1 };
  const body = (<><Icon name={SLOT_ICON[slot.key]} size={13} strokeWidth={1.8} /><Mark state={slot.state} /></>);
  const cls = "relative grid h-5 w-5 shrink-0 place-items-center rounded-md";
  if (!slot.step) return <span title={text} aria-label={`${text} (${STATE_WORD[slot.state]})`} role="img" className={cls} style={style}>{body}</span>;
  return (
    <button type="button" title={text} aria-label={`${slot.label} (${STATE_WORD[slot.state]}): ${slot.detail}`} onClick={(e) => { e.stopPropagation(); onClick?.(); }} className={`${cls} transition hover:ring-1 hover:ring-current focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)]`} style={style}>{body}</button>
  );
}

/** Cella della colonna Stato di una riga della tabella compatta. Fuori dal StatoProvider non mostra nulla. */
export function StatoCell({ b }: { b: Booking }) {
  const ctx = useContext(StatoCtx);
  if (!ctx) return null;
  return (
    <div className="flex items-center gap-[5px]">
      {ctx.slots(b.id).map((s) => <SlotIcon key={s.key} slot={s} onClick={() => ctx.open(b, s)} />)}
    </div>
  );
}

/** Legenda sobria sotto la tabella: ordine delle 8 icone e significato degli stati. */
export function StatoLegenda() {
  return (
    <div className="no-print mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-faint">
      <span className="font-semibold uppercase tracking-wide">Stato</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {SLOT_KEYS.map((k) => (
          <span key={k} className="inline-flex items-center gap-1"><Icon name={SLOT_ICON[k]} size={12} strokeWidth={1.8} />{SLOT_LABELS[k]}</span>
        ))}
      </span>
      <span className="flex items-center gap-x-3">
        <span style={{ color: "var(--ok)" }}>fatto</span>
        <span style={{ color: "var(--warn)" }}>da fare</span>
        <span style={{ color: "var(--err)" }}>in ritardo</span>
        <span>non applicabile</span>
      </span>
    </div>
  );
}
