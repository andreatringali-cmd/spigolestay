"use client";

// Store condiviso del prototipo (in memoria, niente localStorage — da brief).
// In produzione questi dati arriveranno da Supabase.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { campoCambiato, modificaMeritaEmail, spostamentoMeritaEmail } from "@/lib/notify-rules";
import { kvGet, kvSet, kvRemove, kvKeys, kvFlush } from "./bigstore";
import type { Structure, RoomType, Unit, Guest, Booking, Channel, CalEvent, DirectReview } from "./types";
import { CHANNELS } from "./types";
import { computeCommissionEstimates, setCommissionEstimates } from "./commission-estimate";
import { setGroupTaxContext } from "./booking";
import { playSound } from "./sound";
import { loadUsers } from "./users";
import { isPublicMode, lsGet, DATA_KEY } from "./publicdata";
import { apiPost } from "./invoicing/client";
import { loadNotifPrefs } from "./notifPrefs";
import { fmtDMY } from "./dates";
import { ymdRome } from "./dates-rome";
import { roomTypeCascadeIds } from "./pricing";
import { buildNotifyPayload, deleteMeritsCancelEmail } from "./mail/notify-payload";
import { moveGuestChats } from "./merge-threads";
import { orphanedRefs, privateRefsIn } from "./media-orphans";
import { keepsCheckinFiles } from "./checkin-sanitize";
import { deleteMedia } from "./media-client";
import { HOME_PREF_KEY, HOME_APPLIED_KEY, START_HINT_KEY, sortStructures, resolveSelection, nextOpenHint, serializeStartHint } from "./home-struct";
import { useStructLoad, ensureLoaded, structureLoaded, loadedSet, codeMaxFor, addLocalStructure } from "./struct-load";

export type ActivityType = "booking" | "cancel" | "block" | "move" | "event" | "rate" | "rateplan" | "quote" | "payment" | "login" | "auth" | "message" | "config";
export interface Activity {
  id: string;
  ts: number; // epoch ms
  type: ActivityType;
  text: string;
  by?: string; // utente che ha compiuto l'azione
  structureId?: string; // struttura a cui si riferisce (assente = generale, visibile in tutte)
}

export interface NewBookingPrefill {
  structureId?: string;
  roomTypeId?: string;
  unitId?: string | null;
  checkIn?: string;
  checkOut?: string;
}

interface DataContextValue {
  structures: Structure[];
  roomTypes: RoomType[];
  units: Unit[];
  guests: Guest[];
  bookings: Booking[];
  events: CalEvent[];
  rateOverrides: Record<string, number>; // tariffa forzata per giorno (ISO → €)
  activities: Activity[]; // registro attività
  directReviews: DirectReview[]; // recensioni dirette lasciate dagli ospiti sul mini-sito
  addActivity: (type: ActivityType, text: string, structureId?: string) => void;
  setDirectReviewReply: (id: string, reply: string) => void; // salva/pubblica la risposta a una recensione diretta

  // Scheda prenotazione (drawer globale)
  selectedBookingId: string | null;
  openBooking: (id: string) => void;
  closeBooking: () => void;

  // Nuova prenotazione (modale globale)
  newBooking: NewBookingPrefill | null;
  openNewBooking: (prefill?: NewBookingPrefill) => void;
  closeNewBooking: () => void;

  // Struttura attiva (globale, condivisa tra le pagine). "all" = tutte.
  // Selezione multipla: con 2 o più strutture scelte (ma non tutte) `activeStructureId` resta "all" e le liste esposte
  // (strutture, tipologie, camere, prenotazioni, eventi, attività) contengono SOLO le strutture scelte: tutte le pagine
  // ne mostrano così solo i dati senza dover conoscere la selezione. `allStructures` è l'elenco completo.
  activeStructureId: string;
  setActiveStructure: (id: string) => void;
  allStructures: Structure[];
  selectedStructureIds: string[];                 // strutture effettivamente selezionate (tutte, se "Tutte")
  setActiveStructures: (ids: string[]) => void;
  /** Dati COMPLETI, non filtrati dalla selezione: per i lavori in background (sincronizzazioni, autopilot) che non devono dipendere da ciò che si sta guardando. */
  raw: { structures: Structure[]; roomTypes: RoomType[]; units: Unit[]; bookings: Booking[]; events: CalEvent[] };

  // Azioni inventario
  addStructure: (s: { name: string; groupName: string; city?: string; address?: string; services?: string[] }) => string;
  updateStructure: (id: string, patch: Partial<Structure>) => void;
  moveStructure: (id: string, dir: "up" | "down") => void;
  addRoomType: (rt: { structureId: string; name: string; beds: number; basePrice: number }) => string;
  updateRoomType: (id: string, patch: Partial<RoomType>) => void;
  addUnit: (u: { structureId: string; roomTypeId: string; name: string }) => string;
  updateUnit: (id: string, patch: Partial<Unit>) => void;
  setUnitRoomType: (unitId: string, roomTypeId: string) => void;
  toggleOutOfService: (unitId: string) => void;
  deleteStructure: (id: string) => void;
  deleteRoomType: (id: string) => void;
  deleteUnit: (id: string) => void;

  // Azioni prenotazioni / ospiti
  addGuest: (g: { fullName?: string; firstName?: string; lastName?: string; email?: string; phone?: string; country?: string }) => string;
  updateGuest: (id: string, patch: Partial<Guest>) => void;
  updateGuests: (patches: { id: string; patch: Partial<Guest> }[]) => void; // molte schede in un colpo solo (es. uniformare i numeri di telefono)
  deleteGuest: (id: string) => void;
  mergeGuestGroups: (groups: { keepId: string; dropIds: string[]; patch?: Partial<Guest> }[]) => void; // unisce molti gruppi di doppioni in un colpo solo (una sola voce nel registro)
  mergeGuests: (keepId: string, dropIds: string[]) => void; // accorpa doppioni: sposta le prenotazioni e rimuove le voci duplicate
  addBooking: (b: Omit<Booking, "id">) => Booking;
  updateBooking: (id: string, patch: Partial<Booking>) => void;
  /** Correzioni automatiche in background (BookingHealer): applica le modifiche con updatedAt nuovo (così la sincronizzazione le adotta) SENZA voci nel registro attività, email di avviso né Google Calendar. */
  patchBookingsSilently: (patches: { id: string; patch: Partial<Booking> }[]) => void;
  moveBooking: (id: string, to: { unitId: string; checkIn: string; checkOut: string }) => void;
  deleteBooking: (id: string, opts?: { keepFiles?: boolean }) => void; // keepFiles: non toccare documenti/firma sullo Storage (es. sostituzione di un import iCal)
  deleteBookingGroup: (groupId: string) => void; // elimina tutte le camere di una prenotazione di gruppo

  // Eventi calendario
  addEvent: (e: Omit<CalEvent, "id">) => void;
  updateEvent: (id: string, patch: Partial<CalEvent>) => void;
  deleteEvent: (id: string) => void;

  // Tariffe per giorno
  setDayRates: (map: Record<string, number>) => void;
  clearDayRates: (isos: string[]) => void;

  // Lookup
  getStructure: (id: string) => Structure | undefined;
  getRoomType: (id: string) => RoomType | undefined;
  getUnit: (id: string | null) => Unit | undefined;
  getGuest: (id: string) => Guest | undefined;
}

const DataContext = createContext<DataContextValue | null>(null);

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(performance.now() * 1000)}`;

/**
 * Foto del documento e firma (file PRIVATI su Storage) di ospiti/prenotazioni eliminati: via anche dallo Storage, ma SOLO i file che dopo l'eliminazione
 * non sono più usati da nessun'altra prenotazione o ospite (lo stesso file può stare sia sulla prenotazione sia sull'anagrafica). Best-effort: non blocca nulla.
 */
function dropOrphanFiles(removed: unknown[], keep: { bookings: Booking[]; guests: Guest[] }): void {
  try {
    // Prenotazioni con check-in fatto (e non annullate): i loro file restano (la cancellazione non è annullabile e può risorgere con la sincronizzazione).
    const toClean = removed.filter((x) => !(x && typeof x === "object" && keepsCheckinFiles(x as { webCheckin?: unknown; status?: unknown })));
    for (const ref of orphanedRefs(privateRefsIn(...toClean), keep)) void deleteMedia(ref);
  } catch { /* pulizia non critica */ }
}

export function DataProvider({ children }: { children: ReactNode }) {
  // Si parte a VUOTO: i dati reali arrivano dal caricamento (localStorage) nell'effetto di mount.
  // Così al refresh non c'è il "flash" dei vecchi dati demo prima del caricamento.
  const [structures, setStructures] = useState<Structure[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});
  const [activities, setActivities] = useState<Activity[]>([]);
  const [directReviews, setDirectReviews] = useState<DirectReview[]>([]);
  // Lapidi (tombstone): id delle entità cancellate qui. Servono a impedire che la fusione a 3 vie
  // con il server le "resusciti" al refresh (la base di fusione è vuota alla prima idratazione).
  const deletedRef = useRef<Record<string, string[]>>({});
  const freshGuests = useRef<Map<string, Guest>>(new Map()); // ospiti appena creati: lo stato si aggiorna dopo, ma la prenotazione creata nello stesso passaggio deve già trovarli (nome nell'email di notifica)
  const notifyTimes = useRef<number[]>([]); // orari delle ultime email di notifica inviate da questo browser (freno per le operazioni di massa)
  const tomb = (key: string, ...ids: (string | undefined | null)[]) => {
    const set = new Set(deletedRef.current[key] ?? []);
    for (const i of ids) if (i) set.add(i);
    deletedRef.current[key] = [...set];
  };
  // Tombstone di CONTATTO (email/telefono normalizzati) per gli iscritti newsletter / lead
  // cancellati: il tombstone per-id non basta perché il sito pubblico può re-inserirli con un id
  // nuovo. La fusione (authsync) usa questo elenco per non farli "riapparire dopo la sync".
  const deletedLeadsRef = useRef<string[]>([]);
  const tombLeadContact = (g?: { email?: string; phone?: string }) => {
    if (!g) return;
    const set = new Set(deletedLeadsRef.current);
    const email = (g.email ?? "").trim().toLowerCase(); if (email) set.add("email:" + email);
    const phone = (g.phone ?? "").replace(/[\s+()./-]/g, ""); if (phone.length >= 6) set.add("tel:" + phone);
    deletedLeadsRef.current = [...set];
  };
  const currentActor = (): string | undefined => {
    try {
      const cur = localStorage.getItem("spigolestay:currentuser");
      const us = loadUsers();
      const u = us.find((x) => x.id === cur) ?? us[0];
      return u ? (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.username) : undefined;
    } catch { return undefined; }
  };
  const logAct = (type: ActivityType, text: string, structureId?: string) => {
    setActivities((prev) => [{ id: uid(), ts: Date.now(), type, text, by: currentActor(), ...(structureId ? { structureId } : {}) }, ...prev].slice(0, 500));
    playSound(type === "booking" ? "booking" : type === "cancel" ? "cancel" : "notify");
  };

  // Sync in tempo reale col Google Calendar REALE dell'utente (se la struttura ha un gcalId
  // configurato in Impostazioni) — fire-and-forget: non blocca né fa fallire l'operazione
  // locale se Google non risponde o la funzione non è configurata lato server (vedi
  // googleCalendarSync.ts). Le prenotazioni "fuori servizio" (blocked) non vengono sincronizzate.
  const syncGcal = (b: Booking, action: "upsert" | "delete") => {
    if (b.channel === "blocked") return;
    const calendarId = structures.find((s) => s.id === b.structureId)?.gcalId?.trim();
    if (!calendarId) return;
    if (action === "delete") {
      apiPost("calendar/sync-event", { action: "delete", bookingId: b.id, calendarId }).catch(() => {});
      return;
    }
    const g = guests.find((x) => x.id === b.guestId) ?? freshGuests.current.get(b.guestId);
    const unit = units.find((u) => u.id === b.unitId);
    const rt = roomTypes.find((r) => r.id === (unit?.roomTypeId ?? b.roomTypeId));
    const roomLabel = [rt?.name, unit?.name].filter(Boolean).join(" · ");
    const summary = [g?.fullName || "Ospite", roomLabel].filter(Boolean).join(" — ");
    const description = [b.code && `Codice: ${b.code}`, b.channel && `Canale: ${b.channel}`].filter(Boolean).join(" · ");
    apiPost("calendar/sync-event", {
      action: "upsert", bookingId: b.id, calendarId, summary, description,
      startDate: b.checkIn, endDateExclusive: b.checkOut,
    }).catch(() => {});
  };

  // Notifica via email alla struttura (non all'ospite) per nuove prenotazioni, modifiche,
  // cancellazioni e pagamenti ricevuti — rispetta i toggle di Impostazioni → Notifiche.
  // Fire-and-forget come syncGcal: non deve mai bloccare né far fallire l'azione locale.
  const notifyOwner = (ev: "newBooking" | "modified" | "cancel" | "payment", b: Booking, extra?: { amount?: number; deleted?: boolean }) => {
    if (b.channel === "blocked") return; // "fuori servizio" non sono prenotazioni ospiti
    // Operazioni di massa (importazioni, cancellazioni in blocco): al massimo 5 email ogni 2 minuti da questo browser.
    const nowMs = Date.now();
    notifyTimes.current = notifyTimes.current.filter((t) => nowMs - t < 120000);
    if (notifyTimes.current.length >= 5) return;
    if (!loadNotifPrefs()[ev]) return; notifyTimes.current.push(nowMs); // le notifiche spente non consumano la quota anti-raffica
    const prefs = loadNotifPrefs();
    if (!prefs[ev]) return;
    const st = structures.find((s) => s.id === b.structureId);
    const to = st?.email?.trim();
    if (!to) return;
    const g = guests.find((x) => x.id === b.guestId) ?? freshGuests.current.get(b.guestId);
    const unit = units.find((u) => u.id === b.unitId);
    const rt = roomTypes.find((r) => r.id === (unit?.roomTypeId ?? b.roomTypeId));
    const roomLabel = [rt?.name, unit?.name].filter(Boolean).join(" · ");
    const chLabel = CHANNELS[b.channel]?.label ?? b.channel;
    // Email ricca al titolare: logo e nome della STRUTTURA della prenotazione, canale, importi, contatti dell'ospite e link diretto alla scheda (?b=<id>).
    // Il corpo è costruito da buildNotifyPayload (lo stesso usato dal server per le prenotazioni delle OTA).
    const payloadBody = buildNotifyPayload({
      ev, booking: b, guest: g ? { fullName: g.fullName, phone: g.phone, email: g.email, country: g.country } : undefined,
      structure: st, roomLabel, channelLabel: chLabel, paymentAmount: extra?.amount, deleted: extra?.deleted,
      origin: typeof window !== "undefined" ? window.location.origin : undefined,
    });
    fetch("/api/email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payloadBody, to }),
    }).catch(() => {});
  };

  // Persistenza nel browser (prototipo) — così i dati sopravvivono al refresh.
  const KEY = "spigolestay:data:v1";
  // 1) Caricamento una volta al mount + sblocco del salvataggio NELLO STESSO effetto.
  //    `ready` è uno STATE (non un ref): sotto StrictMode il doppio-invoke degli effetti
  //    non riesce così a salvare il seed sovrascrivendo i dati appena caricati.
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  useEffect(() => { readyRef.current = ready; }, [ready]);
  const [activeStructureId, setActiveStructureId] = useState<string>("all");
  // Sottoinsieme di 2+ strutture (vuoto = nessun sottoinsieme: vale activeStructureId).
  const [subsetIds, setSubsetIds] = useState<string[]>([]);
  const sl = useStructLoad(); // stato del caricamento per struttura (modalità veloce): cosa è già arrivato, "Carico…", errori
  const valueRef = useRef<DataContextValue | null>(null); // ultimo valore del contesto (per le azioni che aspettano il caricamento di altre strutture)
  const pendingRef = useRef<{ ids: string[]; fn: () => void }[]>([]);
  const selTokenRef = useRef(0); // l'ultima richiesta di cambio struttura vince (due clic ravvicinati)
  const homeDone = useRef(false);
  const [prefTick, setPrefTick] = useState(0);
  // Applica la struttura di apertura (una volta per sessione del browser; i ricaricamenti mantengono la scelta fatta). Ritorna false se non ci sono strutture.
  const applyHome = (list: Structure[]): boolean => {
    if (!list.length) return false;
    try {
      const sortedIds = sortStructures(list).map((x) => x.id);
      const sel = resolveSelection({
        pref: localStorage.getItem(HOME_PREF_KEY), sortedIds,
        savedActive: localStorage.getItem("spigolestay:activestruct"), savedSubset: localStorage.getItem("spigolestay:activestructs"),
        sessionApplied: sessionStorage.getItem(HOME_APPLIED_KEY) === "1",
      });
      setActiveStructureId(sel.active); setSubsetIds(sel.subset);
      localStorage.setItem("spigolestay:activestruct", sel.active);
      localStorage.setItem("spigolestay:activestructs", sel.subset.join(","));
      sessionStorage.setItem(HOME_APPLIED_KEY, "1");
      window.dispatchEvent(new Event("spigolestay:activestruct"));
    } catch { /* storage non disponibile: resta la vista di prima */ }
    return true;
  };
  useEffect(() => {
    // Modalità sito pubblico (xenora.it/<slug>): i dati arrivano dallo snapshot in
    // memoria, non dal localStorage. Non si esegue reset/onboarding e NON si salva.
    if (isPublicMode()) {
      try {
        const raw = lsGet(DATA_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          if (Array.isArray(d.structures)) setStructures(d.structures);
          if (Array.isArray(d.roomTypes)) setRoomTypes(d.roomTypes);
          if (Array.isArray(d.units)) setUnits(d.units);
          if (Array.isArray(d.guests)) setGuests(d.guests);
          if (Array.isArray(d.bookings)) setBookings(d.bookings);
          if (Array.isArray(d.events)) setEvents(d.events);
          if (d.rateOverrides && typeof d.rateOverrides === "object") setRateOverrides(d.rateOverrides);
          if (Array.isArray(d.directReviews)) setDirectReviews(d.directReviews);
        }
      } catch {}
      setReady(true);
      return;
    }
    try {
      // Reset forzato una-tantum: alla prima apertura dopo questo aggiornamento azzera TUTTO
      // (cancella ogni dato locale) e riparte dal primo accesso. Poi imposta un flag e non si ripete.
      if (localStorage.getItem("spigolestay:forcereset:v1") !== "1") {
        kvKeys().filter((k) => k.startsWith("spigolestay:")).forEach((k) => kvRemove(k));
        localStorage.setItem("spigolestay:forcereset:v1", "1");
        localStorage.setItem("spigolestay:onboarded", "0");
        void kvFlush().then(() => location.reload());
        return;
      }
    } catch {}
    try {
      // Prima di configurare (onboarding non completato) NON si caricano i dati demo.
      const onboarded = localStorage.getItem("spigolestay:onboarded") === "1";
      const raw = onboarded ? kvGet(KEY) : null;
      let mountStructs: Structure[] = [];
      // Migrazione una-tantum: azzera i prezzi dei dati già esistenti (basePrice + tariffe forzate).
      // Si esegue una sola volta, poi imposta un flag e non interviene più.
      const zeroPrices = localStorage.getItem("spigolestay:zeroprices:v1") !== "1";
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.structures)) { setStructures(d.structures as Structure[]); mountStructs = d.structures as Structure[]; }
        if (Array.isArray(d.roomTypes)) {
          let rts = d.roomTypes as RoomType[];
          if (zeroPrices) rts = rts.map((r) => ({ ...r, basePrice: 0 }));
          setRoomTypes(rts);
        }
        if (Array.isArray(d.units)) setUnits(d.units as Unit[]);
        if (d._deleted && typeof d._deleted === "object") deletedRef.current = d._deleted as Record<string, string[]>;
        if (Array.isArray(d._deletedLeads)) deletedLeadsRef.current = d._deletedLeads as string[];
        if (Array.isArray(d.guests)) setGuests(d.guests);
        if (Array.isArray(d.bookings)) setBookings(d.bookings);
        if (Array.isArray(d.events)) setEvents(d.events);
        if (d.rateOverrides && typeof d.rateOverrides === "object") setRateOverrides(zeroPrices ? {} : d.rateOverrides);
        if (Array.isArray(d.activities)) setActivities(d.activities);
        if (Array.isArray(d.directReviews)) setDirectReviews(d.directReviews);
      } else if (!onboarded) {
        // Primo accesso / reset: si parte vuoti, sarà l'onboarding a creare struttura e camere.
        setStructures([]); setRoomTypes([]); setUnits([]); setGuests([]); setBookings([]); setEvents([]); setRateOverrides({});
      }
      if (zeroPrices) localStorage.setItem("spigolestay:zeroprices:v1", "1");
      // Struttura di APERTURA: la principale (o quella scelta in Impostazioni), non «Tutte» né l'ultima usata. Se l'elenco delle strutture non c'è ancora
      // (primo accesso, dati in arrivo dal server) si applica appena compare (effetto più sotto).
      if (applyHome(mountStructs)) homeDone.current = true;
      else { const savedStruct = localStorage.getItem("spigolestay:activestruct"); if (savedStruct) setActiveStructureId(savedStruct); }
    } catch {}
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 2) Salvataggio ad ogni cambiamento, solo dopo il caricamento iniziale.
  useEffect(() => {
    if (!ready || isPublicMode()) return; // in pubblico non si scrive nel browser del visitatore
    try { kvSet(KEY, JSON.stringify({ structures, roomTypes, units, guests, bookings, events, rateOverrides, activities, directReviews, _deleted: deletedRef.current, _deletedLeads: deletedLeadsRef.current })); } catch { try { window.dispatchEvent(new Event("xenora:storage-full")); } catch { /* ambiente senza window */ } }
  }, [ready, structures, roomTypes, units, guests, bookings, events, rateOverrides, activities, directReviews]);

  // Ri-idratazione IN-PLACE: quando la sincronizzazione col server aggiorna i dati (anche solo
  // un campo, es. webCheckin/paid/status) o quando si torna sulla scheda, rileggiamo il blocco
  // salvato e aggiorniamo lo stato SENZA ricaricare la pagina. Così le card (Adempimenti, ecc.)
  // riflettono subito le modifiche fatte altrove (es. check-in completato in un altro tab).
  useEffect(() => {
    if (isPublicMode()) return;
    const rehydrate = () => {
      if (!readyRef.current) return;
      try {
        const raw = kvGet(KEY);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (Array.isArray(d.structures)) setStructures(d.structures);
        if (Array.isArray(d.roomTypes)) setRoomTypes(d.roomTypes);
        if (Array.isArray(d.units)) setUnits(d.units);
        if (Array.isArray(d.guests)) setGuests(d.guests);
        if (Array.isArray(d.bookings)) setBookings(d.bookings);
        if (Array.isArray(d.events)) setEvents(d.events);
        if (d.rateOverrides && typeof d.rateOverrides === "object") setRateOverrides(d.rateOverrides);
        if (Array.isArray(d.activities)) setActivities(d.activities);
        if (Array.isArray(d.directReviews)) setDirectReviews(d.directReviews);
        if (d._deleted && typeof d._deleted === "object") deletedRef.current = d._deleted as Record<string, string[]>;
        if (Array.isArray(d._deletedLeads)) deletedLeadsRef.current = d._deletedLeads as string[];
      } catch {}
    };
    const onVis = () => { if (document.visibilityState === "visible") rehydrate(); };
    window.addEventListener("spigolestay:datasync", rehydrate);
    window.addEventListener("focus", rehydrate);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("spigolestay:datasync", rehydrate);
      window.removeEventListener("focus", rehydrate);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  // Registra l'accesso al gestionale una volta per sessione del browser.
  useEffect(() => {
    if (!ready) return;
    try { if (!sessionStorage.getItem("spigolestay:loginlogged")) { sessionStorage.setItem("spigolestay:loginlogged", "1"); logAct("login", "Accesso al gestionale"); } } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [newBooking, setNewBooking] = useState<NewBookingPrefill | null>(null);
  useEffect(() => { try { const v = localStorage.getItem("spigolestay:activestructs"); if (v) setSubsetIds(v.split(",").filter(Boolean)); } catch {} }, []);
  // Se la struttura selezionata non esiste più (eliminata), torna a "Tutte".
  useEffect(() => {
    if (!ready) return;
    if (activeStructureId !== "all" && !structures.some((s) => s.id === activeStructureId)) setActiveStructureId("all");
    // Strutture del sottoinsieme eliminate: si tolgono; se ne resta meno di 2 il sottoinsieme decade.
    if (subsetIds.length && subsetIds.some((id) => !structures.some((s) => s.id === id))) {
      const kept = subsetIds.filter((id) => structures.some((s) => s.id === id));
      if (kept.length >= 2) setSubsetIds(kept); else { setSubsetIds([]); if (kept.length === 1) setActiveStructureId(kept[0]); }
    }
  }, [ready, structures, activeStructureId, subsetIds]);

  // Struttura di apertura rimandata: i dati delle strutture sono arrivati dopo il primo rendering (primo accesso, sincronizzazione in corso).
  useEffect(() => {
    if (!ready || homeDone.current || isPublicMode()) return;
    if (structures.length && applyHome(structures)) homeDone.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, structures]);
  // Cosa scaricare per prima alla PROSSIMA apertura (modalità veloce): si ricorda a ogni cambio di strutture, di selezione o di preferenza.
  useEffect(() => {
    const h = () => setPrefTick((t) => t + 1);
    window.addEventListener("spigolestay:homepref", h);
    return () => window.removeEventListener("spigolestay:homepref", h);
  }, []);
  useEffect(() => {
    if (!ready || isPublicMode() || !structures.length) return;
    try {
      const hint = nextOpenHint(localStorage.getItem(HOME_PREF_KEY), sortStructures(structures).map((x) => x.id), activeStructureId, subsetIds.join(","));
      const txt = serializeStartHint(hint);
      if (localStorage.getItem(START_HINT_KEY) !== txt) localStorage.setItem(START_HINT_KEY, txt);
    } catch { /* storage non disponibile */ }
  }, [ready, structures, activeStructureId, subsetIds, prefTick]);
  // Modalità veloce: la selezione corrente deve avere i dati caricati (apertura con indicazione vecchia, sottoinsiemi ripristinati…). Nessun effetto fuori dalla modalità veloce.
  useEffect(() => {
    if (!ready || isPublicMode() || !structures.length) return;
    const sorted = sortStructures(structures);
    const ids = subsetIds.length >= 2 ? subsetIds : activeStructureId === "all" ? sorted.map((x) => x.id) : [activeStructureId];
    const need = ids.filter((id) => !structureLoaded(id));
    if (need.length) void ensureLoaded(need, need.length === 1 ? (structures.find((x) => x.id === need[0])?.name ?? "la struttura") : "le strutture", activeStructureId === "all" && subsetIds.length < 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, structures, activeStructureId, subsetIds]);

  // Stima della commissione per le prenotazioni senza cifra reale: si ricalcola quando cambiano le prenotazioni, PRIMA che i componenti figli la leggano.
  // Tassa di soggiorno dei gruppi di camere: una quota per camera, calcolata sull'insieme (vedi setGroupTaxContext in booking.ts); PRIMA dei componenti figli.
  useMemo(() => { setGroupTaxContext(bookings as never, (id) => structures.find((x) => x.id === id)); }, [bookings, structures]);
  useMemo(() => { setCommissionEstimates(computeCommissionEstimates(bookings, ymdRome(new Date()))); }, [bookings]);

  const value = useMemo<DataContextValue>(() => {
    // Strutture ordinate secondo la preferenza dell'utente (campo order), poi per nome.
    // Un unico punto di ordinamento: vale ovunque (calendario, elenchi, menu a tendina).
    const sortedStructures = [...structures].sort((a, b) => {
      // Stesso ordine della pagina Strutture: prima le PROPRIE (senza orgId), poi le CONDIVISE;
      // dentro ciascun gruppo per "order" impostato (frecce su/giù) e infine per nome.
      const pa = a.orgId ? 1 : 0, pb = b.orgId ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const oa = typeof a.order === "number" ? a.order : 1e9;
      const ob = typeof b.order === "number" ? b.order : 1e9;
      return oa !== ob ? oa - ob : (a.name || "").localeCompare(b.name || "", "it");
    });
    // Modalità veloce: i lavori in sottofondo e le pagine che leggono i dati COMPLETI (raw) vedono solo le strutture già caricate (null = tutte): una struttura
    // non caricata ha camere ma non prenotazioni, e sembrerebbe libera. Fuori dalla modalità veloce nulla cambia.
    const lf = loadedSet();
    const inLoaded = (sid?: string | null) => !lf || !sid || lf.has(sid) || !sortedStructures.some((x) => x.id === sid);
    const rawStructures = lf ? sortedStructures.filter((x) => lf.has(x.id)) : sortedStructures;
    const rawRoomTypes = lf ? roomTypes.filter((x) => inLoaded(x.structureId)) : roomTypes;
    const rawUnits = lf ? units.filter((x) => inLoaded(x.structureId)) : units;
    const rawBookings = lf ? bookings.filter((x) => inLoaded(x.structureId)) : bookings;
    const rawEvents = lf ? events.filter((x) => inLoaded(x.structureId)) : events;
    // Cambio struttura: se i dati non sono ancora arrivati si caricano prima (con «Carico <nome>…»), poi si cambia; se fallisce resta la vista di prima.
    const nameOf = (id: string) => structures.find((x) => x.id === id)?.name ?? "la struttura";
    const switchWhenLoaded = (need: string[], label: string, all: boolean, go: () => void) => {
      const token = ++selTokenRef.current;
      if (need.every((i) => structureLoaded(i))) { go(); return; }
      void ensureLoaded(need, label, all).then((ok) => { if (ok && token === selTokenRef.current) go(); });
    };
    // Azioni che toccano dati di altre strutture (eliminare una struttura/tipologia/camera, unire o eliminare ospiti): servono quelle strutture caricate, altrimenti si
    // lascerebbero prenotazioni orfane. Se mancano si caricano e l'azione riparte da sola con i dati completi. true = si può procedere subito.
    const whenLoaded = (need: string[] | "all", label: string, redo: () => void): boolean => {
      const ids = need === "all" ? structures.map((x) => x.id) : need;
      if (ids.every((i) => structureLoaded(i))) return true;
      const p = { ids, fn: redo };
      pendingRef.current.push(p);
      void ensureLoaded(ids, label, need === "all").then((ok) => { if (!ok) pendingRef.current = pendingRef.current.filter((x) => x !== p); });
      return false;
    };
    const sub = subsetIds.length >= 2 ? new Set(subsetIds) : null;
    const inSub = (sid?: string | null) => !sub || !sid || sub.has(sid);
    const xStructures = sub ? sortedStructures.filter((x) => sub.has(x.id)) : sortedStructures;
    const xRoomTypes = sub ? roomTypes.filter((x) => inSub(x.structureId)) : roomTypes;
    const xUnits = sub ? units.filter((x) => inSub(x.structureId)) : units;
    // La prenotazione aperta si deve poter vedere anche se è di una struttura non selezionata (da una ricerca o da un link).
    const xBookings = sub ? bookings.filter((x) => inSub(x.structureId) || x.id === selectedBookingId) : bookings;
    const xEvents = sub ? events.filter((x) => inSub(x.structureId)) : events;
    const xActivities = sub ? activities.filter((x) => inSub((x as { structureId?: string }).structureId)) : activities;
    return {
      structures: xStructures,
      allStructures: sortedStructures,
      raw: { structures: rawStructures, roomTypes: rawRoomTypes, units: rawUnits, bookings: rawBookings, events: rawEvents },
      selectedStructureIds: sub ? subsetIds : activeStructureId === "all" ? sortedStructures.map((x) => x.id) : [activeStructureId],
      setActiveStructures: (ids) => {
        const valid = ids.filter((id) => structures.some((x) => x.id === id));
        const all = valid.length === 0 || valid.length >= structures.length;
        const single = !all && valid.length === 1;
        const go = () => {
          setActiveStructureId(all ? "all" : single ? valid[0] : "all");
          setSubsetIds(!all && !single ? valid : []);
          try {
            localStorage.setItem("spigolestay:activestruct", all ? "all" : single ? valid[0] : "all");
            localStorage.setItem("spigolestay:activestructs", !all && !single ? valid.join(",") : "");
            window.dispatchEvent(new Event("spigolestay:activestruct"));
          } catch {}
        };
        const need = all ? structures.map((x) => x.id) : valid;
        switchWhenLoaded(need, all ? "tutte le strutture" : valid.length === 1 ? nameOf(valid[0]) : valid.map(nameOf).join(", "), all, go);
      },
      roomTypes: xRoomTypes,
      units: xUnits,
      guests,
      bookings: xBookings,
      events: xEvents,
      rateOverrides,
      activities: xActivities,
      directReviews,
      addActivity: logAct,
      setDirectReviewReply: (id, reply) => setDirectReviews((prev) => prev.map((r) => (r.id === id ? { ...r, reply, updatedAt: Date.now() } : r))),

      selectedBookingId,
      openBooking: (id) => setSelectedBookingId(id),
      closeBooking: () => setSelectedBookingId(null),

      newBooking,
      openNewBooking: (prefill) => setNewBooking(prefill ?? {}),
      closeNewBooking: () => setNewBooking(null),

      activeStructureId,
      setActiveStructure: (id) => {
        const go = () => { setSubsetIds([]); try { localStorage.setItem("spigolestay:activestructs", ""); } catch {} setActiveStructureId(id); try { localStorage.setItem("spigolestay:activestruct", id); window.dispatchEvent(new Event("spigolestay:activestruct")); } catch {} };
        if (id === "all") switchWhenLoaded(structures.map((x) => x.id), "tutte le strutture", true, go);
        else switchWhenLoaded([id], nameOf(id), false, go);
      },

      addStructure: (s) => { const id = uid(); addLocalStructure(id); setStructures((prev) => [...prev, { id, city: "Siracusa", checkOutBy: "10:30", ...s, updatedAt: Date.now() }]); logAct("config", `Struttura creata — ${s.name}`); return id; },
      updateStructure: (id, patch) => setStructures((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x))),
      // Sposta una struttura su/giù nell'ordine di visualizzazione. Normalizza il campo
      // order su TUTTE le strutture (0..n) così l'ordine è stabile ovunque.
      moveStructure: (id, dir) => setStructures((prev) => {
        const ordered = [...prev].sort((a, b) => {
          const oa = typeof a.order === "number" ? a.order : 1e9;
          const ob = typeof b.order === "number" ? b.order : 1e9;
          return oa !== ob ? oa - ob : (a.name || "").localeCompare(b.name || "", "it");
        });
        const i = ordered.findIndex((s) => s.id === id);
        if (i < 0) return prev;
        const j = dir === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= ordered.length) return prev;
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
        const orderById = new Map(ordered.map((s, idx) => [s.id, idx]));
        const now = Date.now();
        return prev.map((s) => ({ ...s, order: orderById.get(s.id) ?? s.order, updatedAt: now }));
      }),
      addRoomType: (rt) => { const id = uid(); setRoomTypes((prev) => [...prev, { id, ...rt, updatedAt: Date.now() }]); logAct("config", `Tipologia creata — ${rt.name}`, rt.structureId); return id; },
      updateRoomType: (id, patch) => {
        // Punto centrale di scrittura delle tariffe base/restrizioni: logga qui, una volta sola,
        // qualunque sia la pagina che chiama updateRoomType (Tariffe, Tipologia…), confrontando
        // il valore precedente con quello nuovo così non si registra nulla se non è cambiato nulla.
        const before = roomTypes.find((x) => x.id === id);
        setRoomTypes((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x)));
        if (before) {
          if ("basePrice" in patch && typeof patch.basePrice === "number" && patch.basePrice !== before.basePrice)
            logAct("rate", `Tariffa base modificata — ${before.name}: €${before.basePrice} → €${patch.basePrice}`, before.structureId);
          if ("minStay" in patch && typeof patch.minStay === "number" && patch.minStay !== before.minStay)
            logAct("rate", `Soggiorno minimo modificato — ${before.name}: ${patch.minStay} nott${patch.minStay === 1 ? "e" : "i"}`, before.structureId);
          if ("salesClosed" in patch && patch.salesClosed !== before.salesClosed)
            logAct("rate", `Vendite ${patch.salesClosed ? "chiuse" : "riaperte"} — ${before.name}`, before.structureId);
        }
      },
      addUnit: (u) => { const id = uid(); setUnits((prev) => [...prev, { id, ...u, updatedAt: Date.now() }]); logAct("config", `Camera aggiunta — ${u.name}`, u.structureId); return id; },
      updateUnit: (id, patch) => setUnits((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x))),
      setUnitRoomType: (unitId, roomTypeId) =>
        setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, roomTypeId, updatedAt: Date.now() } : u))),
      toggleOutOfService: (unitId) =>
        setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, outOfService: !u.outOfService, updatedAt: Date.now() } : u))),

      deleteStructure: (id) => {
        if (!whenLoaded([id], nameOf(id), () => valueRef.current?.deleteStructure(id))) return; // le prenotazioni della struttura devono essere caricate: si eliminano con lei
        const nm = structures.find((s) => s.id === id)?.name;
        const rtIds = roomTypes.filter((rt) => rt.structureId === id).map((rt) => rt.id);
        const uIds = units.filter((u) => u.structureId === id).map((u) => u.id);
        const bIds = bookings.filter((b) => b.structureId === id).map((b) => b.id);
        tomb("structures", id); tomb("roomTypes", ...rtIds); tomb("units", ...uIds); tomb("bookings", ...bIds);
        setBookings((prev) => prev.filter((b) => b.structureId !== id));
        setUnits((prev) => prev.filter((u) => u.structureId !== id));
        setRoomTypes((prev) => prev.filter((rt) => rt.structureId !== id));
        setStructures((prev) => prev.filter((s) => s.id !== id));
        logAct("config", `Struttura eliminata${nm ? " — " + nm : ""}`);
      },
      deleteRoomType: (id) => {
        const rtSid = roomTypes.find((rt) => rt.id === id)?.structureId;
        if (rtSid && !whenLoaded([rtSid], nameOf(rtSid), () => valueRef.current?.deleteRoomType(id))) return;
        const nm = roomTypes.find((rt) => rt.id === id)?.name;
        // Cascata: la tipologia + TUTTE le tariffe derivate che pendono da lei (anche a più
        // livelli, es. Matrimoniale → Dus Tripla). Così sparisce anche da "Tariffe".
        const idList = roomTypeCascadeIds(id, roomTypes);
        const unitIds = units.filter((u) => idList.includes(u.roomTypeId)).map((u) => u.id);
        const bIds = bookings.filter((b) => idList.includes(b.roomTypeId) || unitIds.includes(b.unitId ?? "")).map((b) => b.id);
        tomb("roomTypes", ...idList); tomb("units", ...unitIds); tomb("bookings", ...bIds);
        setBookings((prev) => prev.filter((b) => !idList.includes(b.roomTypeId) && !unitIds.includes(b.unitId ?? "")));
        setUnits((prev) => prev.filter((u) => !idList.includes(u.roomTypeId)));
        setRoomTypes((prev) => prev.filter((rt) => !idList.includes(rt.id)));
        // Pulisci i prezzi manuali (rateOverrides "roomTypeId|ISO") delle tipologie rimosse.
        setRateOverrides((prev) => { const c = { ...prev }; for (const k of Object.keys(c)) { const rtId = k.includes("|") ? k.split("|")[0] : ""; if (idList.includes(rtId)) delete c[k]; } return c; });
        const extra = idList.length - 1;
        logAct("config", `Tipologia eliminata${nm ? " — " + nm : ""}${extra > 0 ? ` (+${extra} tariffe derivate)` : ""}`);
      },
      deleteUnit: (id) => {
        const uSid = units.find((u) => u.id === id)?.structureId;
        if (uSid && !whenLoaded([uSid], nameOf(uSid), () => valueRef.current?.deleteUnit(id))) return;
        const nm = units.find((u) => u.id === id)?.name;
        tomb("units", id);
        // I blocchi "fuori servizio" (channel "blocked") della camera vanno eliminati con lei: senza camera ripiegherebbero sulla tipologia
        // e toglierebbero dalla vendita un'altra camera vendibile (blocco fantasma).
        const blockIds = bookings.filter((b) => b.unitId === id && b.channel === "blocked").map((b) => b.id);
        if (blockIds.length) tomb("bookings", ...blockIds);
        // Le altre prenotazioni dell'unità restano ma tornano "da assegnare".
        // updatedAt aggiornato: nella fusione con gli altri dispositivi vince la versione più recente, così non resta una prenotazione agganciata a una camera che non esiste più.
        const ts = Date.now();
        setBookings((prev) => prev.filter((b) => !(b.unitId === id && b.channel === "blocked")).map((b) => (b.unitId === id ? { ...b, unitId: null, updatedAt: ts } : b)));
        setUnits((prev) => prev.filter((u) => u.id !== id));
        logAct("config", `Camera eliminata${nm ? " — " + nm : ""}`);
      },

      addGuest: (g) => {
        const id = uid();
        const fullName = g.fullName ?? `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim();
        const rec = { id, ...g, fullName, updatedAt: Date.now() };
        freshGuests.current.set(id, rec);
        setGuests((prev) => [...prev, rec]);
        return id;
      },
      updateGuest: (id, patch) => setGuests((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch, updatedAt: Date.now() } : g))),
      updateGuests: (patches) => { if (!patches.length) return; const by = new Map(patches.map((x) => [x.id, x.patch])); const ts = Date.now(); setGuests((prev) => prev.map((g) => (by.has(g.id) ? { ...g, ...by.get(g.id), updatedAt: ts } : g))); },
      deleteGuest: (id) => {
        if (!whenLoaded("all", "tutte le strutture", () => valueRef.current?.deleteGuest(id))) return; // l'ospite potrebbe avere prenotazioni in strutture non ancora caricate
        // Conserva i dati dell'ospite sulla prenotazione (per Alloggiati Web) prima di sganciarlo.
        const g = guests.find((x) => x.id === id);
        const snap = g ? { firstName: g.firstName, lastName: g.lastName, sex: g.sex, birthDate: g.birthDate, birthPlace: g.birthPlace, citizenship: g.citizenship, docType: g.docType, docNumber: g.docNumber, docPlace: g.docPlace } : undefined;
        tomb("guests", id);
        // Se è un contatto/lead (nessuna prenotazione reale, es. iscritto newsletter), tombstona
        // anche il CONTATTO: così se il sito pubblico lo re-inserisce con un id nuovo non risorge.
        const hasRealBooking = bookings.some((b) => b.guestId === id && b.status !== "cancelled" && b.channel !== "blocked");
        if (g && !hasRealBooking) tombLeadContact(g);
        setBookings((prev) => prev.map((b) => (b.guestId === id ? { ...b, guestId: "", primaryGuest: b.primaryGuest ?? snap } : b)));
        setGuests((prev) => prev.filter((x) => x.id !== id));
        if (g) dropOrphanFiles([g], { bookings, guests: guests.filter((x) => x.id !== id) }); // foto documento dell'anagrafica eliminata, se nessuna prenotazione le usa più
      },
      mergeGuestGroups: (groups) => {
        if (!whenLoaded("all", "tutte le strutture", () => valueRef.current?.mergeGuestGroups(groups))) return; // le prenotazioni dei doppioni vanno riagganciate in TUTTE le strutture
        const dropToKeep = new Map<string, string>();
        const patches = new Map<string, Partial<Guest>>();
        for (const g of groups) {
          for (const d of g.dropIds) if (d && d !== g.keepId) dropToKeep.set(d, g.keepId);
          if (g.patch) patches.set(g.keepId, g.patch);
        }
        if (dropToKeep.size === 0) return;
        const now = Date.now();
        tomb("guests", ...dropToKeep.keys());
        moveGuestChats(dropToKeep); // la conversazione segue la scheda che resta
        setBookings((prev) => prev.map((b) => (dropToKeep.has(b.guestId) ? { ...b, guestId: dropToKeep.get(b.guestId)!, updatedAt: now } : b)));
        setGuests((prev) => prev.filter((g) => !dropToKeep.has(g.id)).map((g) => (patches.has(g.id) ? { ...g, ...patches.get(g.id), updatedAt: now } : g)));
        logAct("config", `Anagrafica: ${dropToKeep.size} doppioni uniti in ${groups.length} schede`);
      },
      mergeGuests: (keepId, dropIds) => {
        if (!whenLoaded("all", "tutte le strutture", () => valueRef.current?.mergeGuests(keepId, dropIds))) return;
        const drop = new Set(dropIds.filter((d) => d && d !== keepId));
        if (drop.size === 0) return;
        tomb("guests", ...drop);
        moveGuestChats(new Map([...drop].map((d) => [d, keepId] as [string, string]))); // la conversazione segue la scheda che resta
        setBookings((prev) => prev.map((b) => (drop.has(b.guestId) ? { ...b, guestId: keepId } : b)));
        setGuests((prev) => prev.filter((g) => !drop.has(g.id)));
        logAct("config", `Anagrafica: ${drop.size} doppione/i uniti`);
      },
      addBooking: (b) => {
        // Codice leggibile progressivo per anno di arrivo: XEN-2026-0001.
        const year = (b.checkIn || ymdRome(new Date())).slice(0, 4);
        const prefix = `XEN-${year}-`;
        // (in modalità veloce le prenotazioni di strutture non caricate non sono qui: il massimo dei codici già usati lo dà il server a ogni lettura, per anno)
        const maxN = Math.max(codeMaxFor(year), bookings.reduce((mx, x) => (x.code?.startsWith(prefix) ? Math.max(mx, Number(x.code.slice(prefix.length)) || 0) : mx), 0));
        const code = b.code ?? `${prefix}${String(maxN + 1).padStart(4, "0")}`;
        // "Prenotata il" = oggi di default (se non fornita, es. import/iCal la passano esplicita).
        // Origine (logo): qualunque diretta creata da QUI (nuova, preventivo, import ICS/Excel, duplicati…) è "manuale"; chi chiama può passare source esplicito (es. booking engine = "sito").
        // Unica eccezione: un id esterno "site:…" (lo scrive solo il sito pubblico) lascia il campo vuoto, lo deduce directOriginOf.
        const source = b.source ?? (b.channel === "direct" && !(b.extId ?? "").startsWith("site:") ? "manuale" : undefined);
        const rec: Booking = { id: uid(), bookedOn: ymdRome(new Date()), ...b, ...(source ? { source } : {}), code, updatedAt: Date.now() };
        setBookings((prev) => [...prev, rec]);
        const gName = (guests.find((g) => g.id === b.guestId) ?? freshGuests.current.get(b.guestId))?.fullName;
        if (b.channel === "blocked") logAct("block", `Fuori servizio${b.note ? " — " + b.note : ""}`, b.structureId);
        else logAct("booking", `Nuova prenotazione${gName ? " — " + gName : ""} · ${b.channel}`, b.structureId);
        if (rec.status !== "cancelled") { syncGcal(rec, "upsert"); notifyOwner("newBooking", rec); }
        return rec;
      },
      updateBooking: (id, patch) => {
        // Punto centrale di scrittura delle prenotazioni: qualunque pagina chiami updateBooking
        // (scheda prenotazione, pagamenti, sync iCal/Channex…) la modifica finisce comunque nel
        // registro, con un confronto prima/dopo per non loggare nulla quando il valore non cambia
        // davvero (es. una re-sync che riscrive gli stessi dati non deve generare rumore).
        const before = bookings.find((b) => b.id === id);
        const updated: Booking | undefined = before ? { ...before, ...patch, updatedAt: Date.now() } : undefined;
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b)));
        const gName = guests.find((g) => g.id === (patch.guestId ?? before?.guestId))?.fullName;
        if (patch.status === "cancelled" && before?.status !== "cancelled") {
          logAct("cancel", `Prenotazione annullata${gName ? " — " + gName : ""}`, before?.structureId);
          if (updated) { syncGcal(updated, "delete"); notifyOwner("cancel", updated); }
          return;
        }
        if (updated) syncGcal(updated, updated.status === "cancelled" ? "delete" : "upsert");
        if (before) {
          const FIELDS: (keyof Booking)[] = ["checkIn", "checkOut", "unitId", "roomTypeId", "adults", "children", "total", "channel", "status", "guestId"];
          const changed = FIELDS.filter((f) => f in patch && campoCambiato(patch[f], before[f]));
          if (changed.length) {
            const labels: string[] = [];
            if (changed.includes("checkIn") || changed.includes("checkOut")) labels.push("date");
            if (changed.includes("unitId") || changed.includes("roomTypeId")) labels.push("camera");
            if (changed.includes("total")) labels.push("tariffa");
            if (changed.includes("channel")) labels.push("canale");
            if (changed.includes("status")) labels.push("stato");
            if (changed.includes("adults") || changed.includes("children")) labels.push("ospiti");
            const detail = labels.length ? ` (${labels.join(", ")})` : "";
            logAct("booking", `Prenotazione modificata${gName ? " — " + gName : ""}${detail}`, before.structureId);
          }
          // Notifica proprietario: pagamento ha priorità su "modificata" per lo stesso aggiornamento
          // (es. un salvataggio che tocca solo "paid" non deve generare anche un'email di modifica).
          if (updated) {
            const paidDelta = patch.paid != null && patch.paid !== before.paid ? patch.paid - (before.paid ?? 0) : 0;
            if (patch.paid != null && patch.paid !== before.paid && paidDelta > 0) {
              notifyOwner("payment", updated, { amount: paidDelta });
            } else if (modificaMeritaEmail(changed)) {
              // Solo il cambio di camera assegnata NON genera l'email di modifica (resta nel registro attività); date, ospiti, tariffa, canale e stato sì.
              notifyOwner("modified", updated);
            }
          }
        }
      },
      patchBookingsSilently: (patches) => {
        if (!patches.length) return;
        const byId = new Map(patches.map((p) => [p.id, p.patch]));
        const now = Date.now();
        setBookings((prev) => prev.map((x) => { const pt = byId.get(x.id); return pt ? { ...x, ...pt, updatedAt: now } : x; }));
      },
      moveBooking: (id, to) => {
        const target = units.find((u) => u.id === to.unitId);
        const cur = bookings.find((b) => b.id === id);
        const crossed = !!(target && cur && target.structureId !== cur.structureId);
        let moved: Booking | undefined;
        setBookings((prev) => prev.map((b) => {
          if (b.id !== id) return b;
          const next: Booking = { ...b, unitId: to.unitId, checkIn: to.checkIn, checkOut: to.checkOut, updatedAt: Date.now() };
          if (target && target.structureId !== b.structureId) {
            // Cambio struttura: la prenotazione passa alla nuova struttura (e alla tipologia della camera di arrivo)
            // e porta con sé l'avviso "spostata da…". Se torna alla struttura d'origine l'avviso sparisce.
            next.structureId = target.structureId;
            next.roomTypeId = target.roomTypeId;
            if (b.movedFrom?.structureId === target.structureId) delete next.movedFrom;
            else if (!b.movedFrom) next.movedFrom = { structureId: b.structureId, structureName: structures.find((s) => s.id === b.structureId)?.name ?? "", at: new Date().toISOString() };
          }
          moved = next;
          return next;
        }));
        // Se è cambiata struttura, l'evento sul vecchio calendario (se diverso) va tolto.
        if (moved && crossed && cur) syncGcal(cur, "delete");
        if (moved) {
          syncGcal(moved, "upsert");
          // Spostare solo la camera (stesse date, stessa struttura) non manda l'email di modifica; se cambiano le date o la struttura sì.
          if (!cur || spostamentoMeritaEmail(cur, to, crossed)) notifyOwner("modified", moved);
        }
        logAct("move", crossed ? `Prenotazione spostata a ${structures.find((s) => s.id === target!.structureId)?.name ?? "altra struttura"}` : "Prenotazione spostata di camera", cur?.structureId);
      },
      deleteBooking: (id, opts) => {
        const b = bookings.find((x) => x.id === id);
        const gName = b ? guests.find((g) => g.id === b.guestId)?.fullName : undefined;
        tomb("bookings", id);
        setBookings((prev) => prev.filter((b) => b.id !== id));
        if (b && !opts?.keepFiles) dropOrphanFiles([b], { bookings: bookings.filter((x) => x.id !== id), guests }); // foto documento e firma della prenotazione eliminata (salvo check-in fatto, vedi dropOrphanFiles)
        setSelectedBookingId((s) => (s === id ? null : s));
        logAct("cancel", `Cancellazione${gName ? " — " + gName : ""}`, b?.structureId);
        if (b) { syncGcal(b, "delete"); if (deleteMeritsCancelEmail(b, ymdRome(new Date()))) notifyOwner("cancel", b, { deleted: true }); } // già annullata/conclusa: pulizia archivio, niente avviso
      },

      deleteBookingGroup: (groupId) => {
        const members = bookings.filter((x) => x.groupId === groupId);
        if (!members.length) return;
        const ids = new Set(members.map((m) => m.id));
        const gName = guests.find((g) => g.id === members[0].guestId)?.fullName;
        tomb("bookings", ...ids);
        setBookings((prev) => prev.filter((b) => !ids.has(b.id)));
        dropOrphanFiles(members, { bookings: bookings.filter((x) => !ids.has(x.id)), guests });
        setSelectedBookingId((s) => (s && ids.has(s) ? null : s));
        logAct("cancel", `Cancellazione gruppo (${members.length} camere)${gName ? " — " + gName : ""}`, members[0].structureId);
        const todayRome = ymdRome(new Date());
        members.forEach((m) => { syncGcal(m, "delete"); if (deleteMeritsCancelEmail(m, todayRome)) notifyOwner("cancel", m, { deleted: true }); });
      },

      addEvent: (e) => { setEvents((prev) => [...prev, { id: uid(), ...e, updatedAt: Date.now() }]); logAct("event", `Evento: ${e.name}`, e.structureId); },
      updateEvent: (id, patch) => setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e))),
      deleteEvent: (id) => { tomb("events", id); setEvents((prev) => prev.filter((e) => e.id !== id)); },

      setDayRates: (map) => { setRateOverrides((prev) => ({ ...prev, ...map })); logAct("rate", `Tariffe aggiornate · ${Object.keys(map).length} giorni`); },
      clearDayRates: (isos) => setRateOverrides((prev) => { const c = { ...prev }; isos.forEach((i) => delete c[i]); return c; }),

      getStructure: (id) => structures.find((s) => s.id === id),
      getRoomType: (id) => roomTypes.find((rt) => rt.id === id),
      getUnit: (id) => (id ? units.find((u) => u.id === id) : undefined),
      getGuest: (id) => guests.find((g) => g.id === id),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structures, roomTypes, units, guests, bookings, events, rateOverrides, activities, directReviews, selectedBookingId, newBooking, activeStructureId, subsetIds, sl.version]);
  // (dopo il rendering, non durante: le azioni rimandate partono solo quando il contesto è già aggiornato con le strutture appena caricate)
  useEffect(() => { valueRef.current = value; }, [value]);
  // Azioni rimandate (eliminazioni, unioni di ospiti…) che aspettavano il caricamento di altre strutture: appena arrivano si eseguono, con i dati completi.
  useEffect(() => {
    const run = pendingRef.current.filter((p) => p.ids.every((i) => structureLoaded(i)));
    if (!run.length) return;
    pendingRef.current = pendingRef.current.filter((p) => !run.includes(p));
    run.forEach((p) => p.fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sl.version, value]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData deve stare dentro <DataProvider>");
  return ctx;
}

export type { Channel };
