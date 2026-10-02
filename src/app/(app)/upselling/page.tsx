"use client";

// Upselling & extra: catalogo per struttura, proposte automatiche per prenotazione (con regole e
// ricavo potenziale), invio all'ospite, registro offerte con tasso di conversione e ricavo.
// Dati reali: prezzi = quelli del gestore; offerte = Booking.upsellOffers; venduti = Booking.extras.

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { toISO, shiftISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { DEFAULT_EXTRAS, type ExtraService } from "@/lib/types";
import { PageHeader, StatCard } from "@/components/ui";
import {
  estimateRate, isActive, isPriceUnverified, potentialOf, proposable, proposalsFor, upsellStats,
} from "@/lib/upselling";
import ProposalsTab, { type Candidate } from "./_proposals";
import RegistryTab from "./_registry";
import CatalogTab from "./_catalog";

type Tab = "proposte" | "registro" | "catalogo";
const PERIODS: { k: string; label: string; days: number | null }[] = [
  { k: "90", label: "Ultimi 90 giorni", days: 90 },
  { k: "365", label: "Ultimo anno", days: 365 },
  { k: "all", label: "Tutto", days: null },
];

export default function UpsellingPage() {
  const { bookings, structures, activeStructureId, updateStructure } = useData();
  const today = toISO(new Date());

  const [tab, setTab] = useState<Tab>("proposte");
  const [windowDays, setWindowDays] = useState(14);
  const [showEmpty, setShowEmpty] = useState(false);
  const [period, setPeriod] = useState("365");
  const [localCat, setLocalCat] = useState<string>(structures[0]?.id ?? "");

  // ── Catalogo extra della struttura selezionata (fonte unica, condivisa col motore prenotazioni) ──
  const catId = activeStructureId !== "all" ? activeStructureId : (structures.some((s) => s.id === localCat) ? localCat : structures[0]?.id ?? "");
  const catStruct = structures.find((s) => s.id === catId);
  const catExtras = catStruct?.extras ?? [];
  const saveCat = (next: ExtraService[]) => { if (catId) updateStructure(catId, { extras: next }); };

  // Alla PRIMA apertura del catalogo di una struttura (se vuoto) carica gli esempi, una sola volta
  // (se poi l'utente li elimina non ricompaiono). Sono marcati "confirmed: false": prezzi indicativi,
  // mai proposti agli ospiti finché il gestore non li conferma.
  useEffect(() => {
    if (!catId || !catStruct) return;
    try {
      const seeded: string[] = JSON.parse(localStorage.getItem("spigolestay:extrasseeded") || "[]");
      if (seeded.includes(catId)) return;
      if ((catStruct.extras ?? []).length === 0) updateStructure(catId, { extras: DEFAULT_EXTRAS.map((e) => ({ ...e, confirmed: false })) });
      localStorage.setItem("spigolestay:extrasseeded", JSON.stringify([...new Set([...seeded, catId])]));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catId]);

  // Cambiando struttura cataloghi/proposte sono di un altro ambito.
  const catalogOf = useMemo(() => {
    const m = new Map(structures.map((s) => [s.id, s.extras ?? []]));
    return (sid: string) => m.get(sid) ?? [];
  }, [structures]);

  // ── Prenotazioni nell'ambito della struttura attiva ──
  const scoped = useMemo(() => bookings.filter((b) => b.channel !== "blocked" && (activeStructureId === "all" || b.structureId === activeStructureId)), [bookings, activeStructureId]);

  // ── Proposte: prenotazioni confermate in arrivo (entro la finestra) o con ospite in casa ──
  const candidates: Candidate[] = useMemo(() => {
    const limit = shiftISO(today, windowDays);
    const byStruct = new Map<string, typeof scoped>();
    for (const b of bookings) { if (b.channel === "blocked") continue; const l = byStruct.get(b.structureId) ?? []; l.push(b); byStruct.set(b.structureId, l); }
    return scoped
      .filter((b) => b.status === "confirmed" && b.checkOut > today && b.checkIn <= limit)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
      .map((b) => ({ booking: b, structure: structures.find((s) => s.id === b.structureId), proposals: proposalsFor(b, { extras: catalogOf(b.structureId), bookings: byStruct.get(b.structureId) ?? [], today }) }));
  }, [scoped, bookings, structures, catalogOf, today, windowDays]);

  const withProposals = candidates.filter((c) => proposable(c.proposals).length > 0);
  const potential = Math.round(withProposals.reduce((a, c) => a + potentialOf(c.proposals), 0) * 100) / 100;

  // ── Statistiche (per periodo, sul check-in della prenotazione; le future sono sempre incluse) ──
  const periodDays = PERIODS.find((p) => p.k === period)?.days ?? null;
  const periodBookings = useMemo(() => {
    if (periodDays === null) return scoped;
    const from = shiftISO(today, -periodDays);
    return scoped.filter((b) => b.checkIn >= from);
  }, [scoped, periodDays, today]);
  const stats = useMemo(() => upsellStats({ bookings: periodBookings, catalogOf, today }), [periodBookings, catalogOf, today]);
  const rate = estimateRate(stats);
  const estimate = rate !== null && potential > 0 ? { rate, value: Math.round(potential * rate) } : null;

  // ── Stato catalogo (per tutte le strutture nell'ambito) ──
  const scopedStructures = activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId);
  const usable = scopedStructures.flatMap((s) => (s.extras ?? []).filter((e) => isActive(e) && e.price > 0 && !isPriceUnverified(e)));
  const catalogEmpty = usable.length === 0;

  const TABS: [Tab, string][] = [["proposte", `Proposte${withProposals.length ? ` (${withProposals.length})` : ""}`], ["registro", `Registro offerte${stats.offers ? ` (${stats.offers})` : ""}`], ["catalogo", `Catalogo${catExtras.length ? ` (${catExtras.length})` : ""}`]];
  const attach = stats.bookings ? Math.round((stats.withExtra / stats.bookings) * 100) : 0;

  return (
    <div>
      <PageHeader title="Upselling & extra" subtitle="Proponi servizi ed esperienze agli ospiti, registra le risposte e misura quanto ricavo aggiungono" />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Da proporre" value={String(withProposals.length)} hint={withProposals.length ? `potenziale max +${eur(potential)} (prossimi ${windowDays} gg)` : `prenotazioni con proposte (prossimi ${windowDays} gg)`} />
        <StatCard label="Offerte inviate" value={String(stats.offers)} hint={`${stats.pending} in attesa di risposta`} />
        <StatCard label="Conversione" value={stats.conversion === null ? "—" : `${Math.round(stats.conversion * 100)}%`} hint={stats.conversion === null ? "nessuna offerta ancora decisa" : `${stats.accepted} accettate su ${stats.accepted + stats.declined + stats.expired} decise`} />
        <StatCard label="Extra venduti" value={eur(stats.soldRevenue)} hint={stats.bookings ? `${attach}% delle prenotazioni ha un extra` : "nessuna prenotazione nel periodo"} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${tab === k ? "border-focus font-semibold text-focus" : "border-transparent text-dim hover:text-txt"}`}>{l}</button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2 pb-1">
          {tab === "catalogo" && activeStructureId === "all" && structures.length > 0 && (
            <select value={catId} onChange={(e) => setLocalCat(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-dim outline-none focus:border-focus">
              {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {tab === "registro" && (
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-dim outline-none focus:border-focus">
              {PERIODS.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
            </select>
          )}
        </div>
      </div>

      {tab === "proposte" && (
        <ProposalsTab key={activeStructureId} candidates={candidates} today={today} windowDays={windowDays} setWindowDays={setWindowDays} showEmpty={showEmpty} setShowEmpty={setShowEmpty} catalogEmpty={catalogEmpty} goCatalog={() => setTab("catalogo")} estimate={estimate} />
      )}
      {tab === "registro" && (
        <RegistryTab key={activeStructureId} bookings={periodBookings} stats={stats} today={today} structures={structures} multiStructure={activeStructureId === "all" && structures.length > 1} />
      )}
      {tab === "catalogo" && (
        structures.length === 0
          ? <div className="rounded-xl border border-dashed border-line bg-surface py-10 text-center text-sm text-faint">Crea prima una struttura per gestire il catalogo extra.</div>
          : <CatalogTab key={catId} structure={catStruct} extras={catExtras} onSave={saveCat} stats={stats.perExtra} addDisabled={!catId} />
      )}
    </div>
  );
}
