"use client";

// Store condiviso del prototipo (in memoria, niente localStorage — da brief).
// In produzione questi dati arriveranno da Supabase.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Structure, RoomType, Unit, Guest, Booking, Channel, CalEvent } from "./types";
import { STRUCTURES, ROOM_TYPES, UNITS } from "./mock-data";
import { playSound } from "./sound";
import { loadUsers } from "./users";

export type ActivityType = "booking" | "cancel" | "block" | "move" | "event" | "rate" | "quote" | "payment" | "login" | "message" | "config";
export interface Activity {
  id: string;
  ts: number; // epoch ms
  type: ActivityType;
  text: string;
  by?: string; // utente che ha compiuto l'azione
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
  addActivity: (type: ActivityType, text: string) => void;

  // Scheda prenotazione (drawer globale)
  selectedBookingId: string | null;
  openBooking: (id: string) => void;
  closeBooking: () => void;

  // Nuova prenotazione (modale globale)
  newBooking: NewBookingPrefill | null;
  openNewBooking: (prefill?: NewBookingPrefill) => void;
  closeNewBooking: () => void;

  // Struttura attiva (globale, condivisa tra le pagine). "all" = tutte.
  activeStructureId: string;
  setActiveStructure: (id: string) => void;

  // Azioni inventario
  addStructure: (s: { name: string; groupName: string; city?: string; address?: string; services?: string[] }) => string;
  updateStructure: (id: string, patch: Partial<Structure>) => void;
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
  deleteGuest: (id: string) => void;
  mergeGuests: (keepId: string, dropIds: string[]) => void; // accorpa doppioni: sposta le prenotazioni e rimuove le voci duplicate
  addBooking: (b: Omit<Booking, "id">) => void;
  updateBooking: (id: string, patch: Partial<Booking>) => void;
  moveBooking: (id: string, to: { unitId: string; checkIn: string; checkOut: string }) => void;
  deleteBooking: (id: string) => void;

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
  const currentActor = (): string | undefined => {
    try {
      const cur = localStorage.getItem("spigolestay:currentuser");
      const us = loadUsers();
      const u = us.find((x) => x.id === cur) ?? us[0];
      return u ? (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.username) : undefined;
    } catch { return undefined; }
  };
  const logAct = (type: ActivityType, text: string) => {
    setActivities((prev) => [{ id: uid(), ts: Date.now(), type, text, by: currentActor() }, ...prev].slice(0, 500));
    playSound(type === "booking" ? "booking" : type === "cancel" ? "cancel" : "notify");
  };

  // Persistenza nel browser (prototipo) — così i dati sopravvivono al refresh.
  const KEY = "spigolestay:data:v1";
  // 1) Caricamento una volta al mount + sblocco del salvataggio NELLO STESSO effetto.
  //    `ready` è uno STATE (non un ref): sotto StrictMode il doppio-invoke degli effetti
  //    non riesce così a salvare il seed sovrascrivendo i dati appena caricati.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      // Reset forzato una-tantum: alla prima apertura dopo questo aggiornamento azzera TUTTO
      // (cancella ogni dato locale) e riparte dal primo accesso. Poi imposta un flag e non si ripete.
      if (localStorage.getItem("spigolestay:forcereset:v1") !== "1") {
        Object.keys(localStorage).filter((k) => k.startsWith("spigolestay:")).forEach((k) => localStorage.removeItem(k));
        localStorage.setItem("spigolestay:forcereset:v1", "1");
        localStorage.setItem("spigolestay:onboarded", "0");
        location.reload();
        return;
      }
    } catch {}
    try {
      // Prima di configurare (onboarding non completato) NON si caricano i dati demo.
      const onboarded = localStorage.getItem("spigolestay:onboarded") === "1";
      const raw = onboarded ? localStorage.getItem(KEY) : null;
      // Migrazione una-tantum: azzera i prezzi dei dati già esistenti (basePrice + tariffe forzate).
      // Si esegue una sola volta, poi imposta un flag e non interviene più.
      const zeroPrices = localStorage.getItem("spigolestay:zeroprices:v1") !== "1";
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.structures)) setStructures(d.structures.map((s: Structure) => s.photoColor ? s : { ...s, photoColor: STRUCTURES.find((x) => x.id === s.id)?.photoColor }));
        // Auto-riparazione dati demo: Spigole House camera 2 → Tripla (idempotente).
        if (Array.isArray(d.roomTypes)) {
          let rts = d.roomTypes as typeof ROOM_TYPES;
          // Auto-riparazione SOLO sui dati demo (Spigole House): se l'utente ha resettato/creato
          // le proprie tipologie, non reintroduco quelle d'esempio.
          const isDemo = rts.some((r) => r.id === "rt_house" || r.structureId === "st_house");
          if (isDemo && !rts.some((r) => r.id === "rt_house_tri")) rts = [...rts, ROOM_TYPES.find((r) => r.id === "rt_house_tri")!];
          rts = rts.map((r) => (r.id === "rt_house" && r.name === "Matrimoniale" ? { ...r, name: "Deluxe" } : r));
          if (zeroPrices) rts = rts.map((r) => ({ ...r, basePrice: 0 }));
          setRoomTypes(rts);
        }
        if (Array.isArray(d.units)) {
          setUnits((d.units as typeof UNITS).map((u) => (u.id === "u_h2" && u.roomTypeId === "rt_house" ? { ...u, roomTypeId: "rt_house_tri" } : u)));
        }
        if (Array.isArray(d.guests)) setGuests(d.guests);
        if (Array.isArray(d.bookings)) setBookings(d.bookings);
        if (Array.isArray(d.events)) setEvents(d.events);
        if (d.rateOverrides && typeof d.rateOverrides === "object") setRateOverrides(zeroPrices ? {} : d.rateOverrides);
        if (Array.isArray(d.activities)) setActivities(d.activities);
      } else if (!onboarded) {
        // Primo accesso / reset: si parte vuoti, sarà l'onboarding a creare struttura e camere.
        setStructures([]); setRoomTypes([]); setUnits([]); setGuests([]); setBookings([]); setEvents([]); setRateOverrides({});
      }
      if (zeroPrices) localStorage.setItem("spigolestay:zeroprices:v1", "1");
      const savedStruct = localStorage.getItem("spigolestay:activestruct");
      if (savedStruct) setActiveStructureId(savedStruct);
    } catch {}
    setReady(true);
  }, []);
  // 2) Salvataggio ad ogni cambiamento, solo dopo il caricamento iniziale.
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify({ structures, roomTypes, units, guests, bookings, events, rateOverrides, activities })); } catch {}
  }, [ready, structures, roomTypes, units, guests, bookings, events, rateOverrides, activities]);
  // Registra l'accesso al gestionale una volta per sessione del browser.
  useEffect(() => {
    if (!ready) return;
    try { if (!sessionStorage.getItem("spigolestay:loginlogged")) { sessionStorage.setItem("spigolestay:loginlogged", "1"); logAct("login", "Accesso al gestionale"); } } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [newBooking, setNewBooking] = useState<NewBookingPrefill | null>(null);
  const [activeStructureId, setActiveStructureId] = useState<string>("all");
  // Se la struttura selezionata non esiste più (eliminata), torna a "Tutte".
  useEffect(() => {
    if (!ready) return;
    if (activeStructureId !== "all" && !structures.some((s) => s.id === activeStructureId)) setActiveStructureId("all");
  }, [ready, structures, activeStructureId]);

  const value = useMemo<DataContextValue>(() => {
    return {
      structures,
      roomTypes,
      units,
      guests,
      bookings,
      events,
      rateOverrides,
      activities,
      addActivity: logAct,

      selectedBookingId,
      openBooking: (id) => setSelectedBookingId(id),
      closeBooking: () => setSelectedBookingId(null),

      newBooking,
      openNewBooking: (prefill) => setNewBooking(prefill ?? {}),
      closeNewBooking: () => setNewBooking(null),

      activeStructureId,
      setActiveStructure: (id) => { setActiveStructureId(id); try { localStorage.setItem("spigolestay:activestruct", id); } catch {} },

      addStructure: (s) => { const id = uid(); setStructures((prev) => [...prev, { id, city: "Siracusa", checkOutBy: "10:30", ...s }]); logAct("config", `Struttura creata — ${s.name}`); return id; },
      updateStructure: (id, patch) => setStructures((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x))),
      addRoomType: (rt) => { const id = uid(); setRoomTypes((prev) => [...prev, { id, ...rt }]); logAct("config", `Tipologia creata — ${rt.name}`); return id; },
      updateRoomType: (id, patch) => setRoomTypes((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x))),
      addUnit: (u) => { const id = uid(); setUnits((prev) => [...prev, { id, ...u }]); logAct("config", `Camera aggiunta — ${u.name}`); return id; },
      updateUnit: (id, patch) => setUnits((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x))),
      setUnitRoomType: (unitId, roomTypeId) =>
        setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, roomTypeId } : u))),
      toggleOutOfService: (unitId) =>
        setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, outOfService: !u.outOfService } : u))),

      deleteStructure: (id) => {
        const nm = structures.find((s) => s.id === id)?.name;
        const rtIds = roomTypes.filter((rt) => rt.structureId === id).map((rt) => rt.id);
        setBookings((prev) => prev.filter((b) => b.structureId !== id));
        setUnits((prev) => prev.filter((u) => u.structureId !== id));
        setRoomTypes((prev) => prev.filter((rt) => rt.structureId !== id));
        setStructures((prev) => prev.filter((s) => s.id !== id));
        logAct("config", `Struttura eliminata${nm ? " — " + nm : ""}`);
        void rtIds;
      },
      deleteRoomType: (id) => {
        const nm = roomTypes.find((rt) => rt.id === id)?.name;
        const unitIds = units.filter((u) => u.roomTypeId === id).map((u) => u.id);
        setBookings((prev) => prev.filter((b) => b.roomTypeId !== id && !unitIds.includes(b.unitId ?? "")));
        setUnits((prev) => prev.filter((u) => u.roomTypeId !== id));
        setRoomTypes((prev) => prev.filter((rt) => rt.id !== id));
        logAct("config", `Tipologia eliminata${nm ? " — " + nm : ""}`);
      },
      deleteUnit: (id) => {
        const nm = units.find((u) => u.id === id)?.name;
        // Le prenotazioni dell'unità restano ma tornano "da assegnare".
        setBookings((prev) => prev.map((b) => (b.unitId === id ? { ...b, unitId: null } : b)));
        setUnits((prev) => prev.filter((u) => u.id !== id));
        logAct("config", `Camera eliminata${nm ? " — " + nm : ""}`);
      },

      addGuest: (g) => {
        const id = uid();
        const fullName = g.fullName ?? `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim();
        setGuests((prev) => [...prev, { id, ...g, fullName }]);
        return id;
      },
      updateGuest: (id, patch) => setGuests((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g))),
      deleteGuest: (id) => {
        // Conserva i dati dell'ospite sulla prenotazione (per Alloggiati Web) prima di sganciarlo.
        const g = guests.find((x) => x.id === id);
        const snap = g ? { firstName: g.firstName, lastName: g.lastName, sex: g.sex, birthDate: g.birthDate, birthPlace: g.birthPlace, citizenship: g.citizenship, docType: g.docType, docNumber: g.docNumber } : undefined;
        setBookings((prev) => prev.map((b) => (b.guestId === id ? { ...b, guestId: "", primaryGuest: b.primaryGuest ?? snap } : b)));
        setGuests((prev) => prev.filter((x) => x.id !== id));
      },
      mergeGuests: (keepId, dropIds) => {
        const drop = new Set(dropIds.filter((d) => d && d !== keepId));
        if (drop.size === 0) return;
        setBookings((prev) => prev.map((b) => (drop.has(b.guestId) ? { ...b, guestId: keepId } : b)));
        setGuests((prev) => prev.filter((g) => !drop.has(g.id)));
        logAct("config", `Anagrafica: ${drop.size} doppione/i uniti`);
      },
      addBooking: (b) => {
        // Codice leggibile progressivo per anno di arrivo: XEN-2026-0001.
        const year = (b.checkIn || new Date().toISOString()).slice(0, 4);
        const prefix = `XEN-${year}-`;
        const maxN = bookings.reduce((mx, x) => (x.code?.startsWith(prefix) ? Math.max(mx, Number(x.code.slice(prefix.length)) || 0) : mx), 0);
        const code = b.code ?? `${prefix}${String(maxN + 1).padStart(4, "0")}`;
        // "Prenotata il" = oggi di default (se non fornita, es. import/iCal la passano esplicita).
        setBookings((prev) => [...prev, { id: uid(), bookedOn: new Date().toISOString().slice(0, 10), ...b, code }]);
        const gName = guests.find((g) => g.id === b.guestId)?.fullName;
        if (b.channel === "blocked") logAct("block", `Fuori servizio${b.note ? " — " + b.note : ""}`);
        else logAct("booking", `Nuova prenotazione${gName ? " — " + gName : ""} · ${b.channel}`);
      },
      updateBooking: (id, patch) => {
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
        if (patch.status === "cancelled") logAct("cancel", "Prenotazione annullata");
      },
      moveBooking: (id, to) => {
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, unitId: to.unitId, checkIn: to.checkIn, checkOut: to.checkOut } : b)));
        logAct("move", "Prenotazione spostata di camera");
      },
      deleteBooking: (id) => {
        const b = bookings.find((x) => x.id === id);
        const gName = b ? guests.find((g) => g.id === b.guestId)?.fullName : undefined;
        setBookings((prev) => prev.filter((b) => b.id !== id));
        setSelectedBookingId((s) => (s === id ? null : s));
        logAct("cancel", `Cancellazione${gName ? " — " + gName : ""}`);
      },

      addEvent: (e) => { setEvents((prev) => [...prev, { id: uid(), ...e }]); logAct("event", `Evento: ${e.name}`); },
      updateEvent: (id, patch) => setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e))),
      deleteEvent: (id) => setEvents((prev) => prev.filter((e) => e.id !== id)),

      setDayRates: (map) => { setRateOverrides((prev) => ({ ...prev, ...map })); logAct("rate", `Tariffe aggiornate · ${Object.keys(map).length} giorni`); },
      clearDayRates: (isos) => setRateOverrides((prev) => { const c = { ...prev }; isos.forEach((i) => delete c[i]); return c; }),

      getStructure: (id) => structures.find((s) => s.id === id),
      getRoomType: (id) => roomTypes.find((rt) => rt.id === id),
      getUnit: (id) => (id ? units.find((u) => u.id === id) : undefined),
      getGuest: (id) => guests.find((g) => g.id === id),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structures, roomTypes, units, guests, bookings, events, rateOverrides, activities, selectedBookingId, newBooking, activeStructureId]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData deve stare dentro <DataProvider>");
  return ctx;
}

export type { Channel };
