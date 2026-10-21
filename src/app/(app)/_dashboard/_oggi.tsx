"use client";

// «Oggi»: chi arriva, chi parte, chi è in casa, in righe compatte (camera · ospite · dettaglio · stato). Ogni riga è un pulsante che apre la prenotazione.
// Colori col significato giusto: il rosso è SOLO errore/ritardo (qui «Senza camera»). Arrivi, partenze e soggiorni si riconoscono da icona e titolo, non dal colore.
import { useState } from "react";
import Icon from "@/components/Icon";
import { BTN_SM, Chip, EmptyRow, HeadLink, Panel, TONE_TEXT, type Tone } from "./_kit";

export interface MoveRow {
  id: string;
  kind: "arr" | "dep" | "stay";
  turnover: boolean;
  room: string | null;           // numero/nome breve della camera (null = da assegnare)
  name: string;
  sub: string;
  /** stato in chiaro: check-in, pagamento, senza camera, turnover */
  chips: { text: string; tone: Tone }[];
}

const KIND = {
  arr: { title: "Arrivi", icon: "login", tone: "focus", empty: "Nessun arrivo oggi", limit: 8 },
  dep: { title: "Partenze", icon: "logout", tone: "dim", empty: "Nessuna partenza oggi", limit: 8 },
  stay: { title: "In casa", icon: "bed", tone: "dim", empty: "Nessun ospite in casa", limit: 5 },
} as const;
const ORDER = ["arr", "dep", "stay"] as const;

function Row({ r, onOpen }: { r: MoveRow; onOpen: (id: string) => void }) {
  return (
    <li>
      <button
        type="button" onClick={() => onOpen(r.id)}
        className="grid min-h-11 w-full grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-x-3 px-3 py-1 text-left hover:bg-wash sm:grid-cols-[4.75rem_minmax(0,1fr)_auto]"
      >
        <span className="truncate text-[13px] font-semibold text-txt" title={r.room ? `Camera ${r.room}` : "Camera da assegnare"}>{r.room ?? "—"}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-5 text-txt">{r.name}</span>
          <span className="block truncate text-xs leading-4 text-dim">{r.sub}</span>
        </span>
        {r.chips.length > 0 && (
          <span className="col-start-2 mt-1 flex min-w-0 flex-wrap justify-end gap-1 max-sm:justify-start sm:col-start-auto sm:mt-0 sm:max-w-[15rem]">
            {r.chips.map((c) => <Chip key={c.text} tone={c.tone}>{c.text}</Chip>)}
          </span>
        )}
      </button>
    </li>
  );
}

function Gruppo({ k, list, onOpen, first }: { k: (typeof ORDER)[number]; list: MoveRow[]; onOpen: (id: string) => void; first: boolean }) {
  const [all, setAll] = useState(false);
  const meta = KIND[k];
  const hidden = !all && list.length > meta.limit + 1;
  const shown = hidden ? list.slice(0, meta.limit) : list;
  return (
    <div>
      <h3 className={`flex h-8 items-center gap-2 bg-wash px-3 text-xs font-semibold text-dim ${first ? "" : "border-t border-line"}`}>
        <span className={TONE_TEXT[meta.tone]} aria-hidden><Icon name={meta.icon} size={14} /></span>
        {meta.title}
        <span className="font-mono tabular-nums">{list.length}</span>
      </h3>
      {list.length === 0 ? (
        <div className="flex min-h-9 items-center px-3 text-xs text-dim">{meta.empty}</div>
      ) : (
        <>
          <ul className="divide-y divide-line">{shown.map((r) => <Row key={r.id} r={r} onOpen={onOpen} />)}</ul>
          {(hidden || (all && list.length > meta.limit + 1)) && (
            <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="flex min-h-9 w-full items-center px-3 text-xs font-medium text-focus hover:bg-wash max-sm:min-h-10">
              {all ? "Mostra meno" : `Mostra tutti (${list.length})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function Oggi({ rows, onOpen, onNew, noBookings, noStructures }: { rows: MoveRow[]; onOpen: (id: string) => void; onNew: () => void; noBookings: boolean; noStructures: boolean }) {
  return (
    <Panel
      id="oggi" title="Oggi" className="scroll-mt-4"
      right={<>{!noStructures && <button type="button" onClick={onNew} className={BTN_SM}>Nuova prenotazione</button>}<HeadLink href="/prenotazioni">Prenotazioni</HeadLink></>}
    >
      {noStructures ? (
        <EmptyRow action={<HeadLink href="/strutture">Crea la struttura</HeadLink>}>Nessuna struttura: creala per iniziare.</EmptyRow>
      ) : noBookings ? (
        <EmptyRow action={<button type="button" onClick={onNew} className={BTN_SM}>Aggiungi la prima prenotazione</button>}>Non ci sono ancora prenotazioni.</EmptyRow>
      ) : (
        ORDER.map((k, i) => <Gruppo key={k} k={k} first={i === 0} list={rows.filter((r) => r.kind === k)} onOpen={onOpen} />)
      )}
    </Panel>
  );
}
