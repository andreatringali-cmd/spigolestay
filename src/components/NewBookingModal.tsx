"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel, type RoomType } from "@/lib/types";
import { effBase, effectiveClosed } from "@/lib/pricing";
import { shiftISO, toISO } from "@/lib/dates";
import { useLang } from "@/lib/i18n";

const CHANNEL_OPTS: Channel[] = ["direct", "booking", "airbnb", "expedia"];
const isWeekend = (iso: string) => { const d = new Date(iso).getDay(); return d === 5 || d === 6 || d === 0; };
const fmtDay = (iso: string) => { try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }); } catch { return iso; } };

export default function NewBookingModal() {
  const { newBooking, closeNewBooking, structures, roomTypes, units, bookings, rateOverrides, addGuest, addBooking, activeStructureId } = useData();
  const { t } = useLang();
  const weekendPct = useMemo(() => { try { const r = localStorage.getItem("spigolestay:pricerules"); if (r) return JSON.parse(r).weekendPct ?? 25; } catch {} return 25; }, []);

  const [step, setStep] = useState<"search" | "results">("search");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<Channel>("direct");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [childAges, setChildAges] = useState<number[]>([]);
  const setChildrenN = (n: number) => { setChildren(n); setChildAges((prev) => { const next = prev.slice(0, n); while (next.length < n) next.push(8); return next; }); };
  const [qty, setQty] = useState<Record<string, number>>({});
  const [priceOv, setPriceOv] = useState<Record<string, number>>({});
  const [structFilter, setStructFilter] = useState<string>("all");
  const [err, setErr] = useState("");

  const locked = activeStructureId !== "all";
  const structColor = (sId: string) => structures.find((s) => s.id === sId)?.photoColor || "var(--focus)";

  // Prefill all'apertura (da click su cella calendario o da nuovo).
  useEffect(() => {
    if (!newBooking) return;
    const u = newBooking.unitId ? units.find((x) => x.id === newBooking.unitId) : undefined;
    const sId = newBooking.structureId ?? u?.structureId ?? "";
    const rtId = newBooking.roomTypeId ?? u?.roomTypeId ?? "";
    const ci = newBooking.checkIn ?? toISO(new Date());
    setLastName(""); setFirstName(""); setEmail(""); setPhone(""); setChannel("direct");
    setCheckIn(ci);
    setCheckOut(newBooking.checkOut && newBooking.checkOut > ci ? newBooking.checkOut : shiftISO(ci, 1));
    setAdults(2); setChildren(0); setChildAges([]);
    setStructFilter(activeStructureId !== "all" ? activeStructureId : (sId || "all"));
    setQty(rtId ? { [rtId]: 1 } : {});
    setPriceOv({});
    setErr("");
    // Se arrivo da una cella (camera già scelta) vado dritto ai risultati; altrimenti parto dalla ricerca.
    setStep(rtId ? "results" : "search");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newBooking]);

  const nightsN = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));
  const party = adults + children;

  const availUnits = (rt: RoomType) => units.filter((u) => u.roomTypeId === rt.id && !u.outOfService && !bookings.some((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.unitId === u.id && b.checkIn < checkOut && b.checkOut > checkIn));
  const dayPrice = (rt: RoomType, iso: string) => { const base = effBase(rt, roomTypes); const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(base * (isWeekend(iso) ? 1 + weekendPct / 100 : 1)); return Math.max(0, Math.round(raw)); };
  const stayPrice = (rt: RoomType) => { let s = 0; for (let i = 0; i < nightsN; i++) s += dayPrice(rt, shiftISO(checkIn, i)); return s; };
  const cap = (rt: RoomType) => rt.maxOccupancy ?? rt.beds ?? 2;
  const linePrice = (rt: RoomType) => priceOv[rt.id] ?? stayPrice(rt);

  const orderedStructs = structFilter === "all" ? structures : structures.filter((s) => s.id === structFilter);
  const availTypes = (sId: string) => roomTypes.filter((rt) => rt.structureId === sId && !effectiveClosed(rt, roomTypes) && availUnits(rt).length > 0);
  const totalAvail = orderedStructs.reduce((a, s) => a + availTypes(s.id).length, 0);

  const selectedLines = roomTypes.filter((rt) => (qty[rt.id] ?? 0) > 0);
  const totalRooms = selectedLines.reduce((a, rt) => a + (qty[rt.id] ?? 0), 0);
  const totalPrice = selectedLines.reduce((a, rt) => a + linePrice(rt) * (qty[rt.id] ?? 0), 0);
  const totalCap = selectedLines.reduce((a, rt) => a + cap(rt) * (qty[rt.id] ?? 0), 0);
  const isGroup = totalRooms > 1;
  const setQ = (rtId: string, n: number) => setQty((q) => ({ ...q, [rtId]: Math.max(0, n) }));

  if (!newBooking) return null;

  const goResults = () => {
    if (checkOut <= checkIn) return setErr(t("Il check-out deve essere dopo il check-in"));
    setErr("");
    setStep("results");
  };

  const submit = () => {
    if (!lastName.trim() && !firstName.trim()) return setErr(t("Inserisci nome o cognome dell'ospite"));
    if (totalRooms < 1) return setErr(t("Seleziona almeno una camera"));
    const guestId = addGuest({ lastName: lastName.trim() || undefined, firstName: firstName.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined });
    const groupId = isGroup ? ((typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())) : undefined;
    // Espande le camere selezionate assegnando unità reali libere.
    const flat: { rt: RoomType; unitId: string | null }[] = [];
    selectedLines.forEach((rt) => { const free = availUnits(rt); const q = Math.min(qty[rt.id] ?? 0, free.length); for (let k = 0; k < q; k++) flat.push({ rt, unitId: free[k]?.id ?? null }); });
    const nR = Math.max(1, flat.length);
    const dist = (tot: number, i: number) => Math.floor(tot / nR) + (i < tot % nR ? 1 : 0);
    let ci = 0;
    flat.forEach((r, i) => {
      const kidCount = nR > 1 ? dist(children, i) : children;
      const ages = childAges.slice(ci, ci + kidCount); ci += kidCount;
      addBooking({ groupId, structureId: r.rt.structureId, roomTypeId: r.rt.id, unitId: r.unitId, guestId, channel, status: "confirmed", checkIn, checkOut, adults: nR > 1 ? Math.max(dist(adults, i), 0) : adults, children: kidCount, childAges: ages.length ? ages : undefined, total: linePrice(r.rt) || undefined });
    });
    closeNewBooking();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label={t("Chiudi")} onClick={closeNewBooking} className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line bg-paper px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-focus text-white"><CalIcon /></span>
            <div>
              <h2 className="font-display text-base font-bold leading-tight text-txt">{t("Aggiungi prenotazione")}</h2>
              <p className="text-[11px] text-dim">{step === "search" ? t("Cerca la disponibilità per le date e gli ospiti") : t("Scegli le camere disponibili")}</p>
            </div>
          </div>
          <button onClick={closeNewBooking} className="rounded-md px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
        </div>

        {/* ─────────── STEP 1 · RICERCA ─────────── */}
        {step === "search" ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {/* Soggiorno */}
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-faint">{t("Soggiorno")}</div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex-1 text-[11px] font-medium text-dim">{t("Check-in")}
                  <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-txt outline-none focus:border-focus" />
                </label>
                <div className="grid h-11 w-9 shrink-0 place-items-center text-faint">→</div>
                <label className="flex-1 text-[11px] font-medium text-dim">{t("Check-out")}
                  <input type="date" value={checkOut} min={shiftISO(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-txt outline-none focus:border-focus" />
                </label>
                <span className="mb-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] px-3 py-1.5 text-xs font-bold text-[color:var(--focus)]">{nightsN} {nightsN === 1 ? t("notte") : t("notti")}</span>
              </div>
            </div>

            {/* Ospiti */}
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-faint">{t("Ospiti")}</div>
              <div className="grid grid-cols-2 gap-3">
                <Stepper label={t("Adulti")} sub={t("14 anni +")} value={adults} min={1} onChange={setAdults} icon={<PersonGlyph />} />
                <Stepper label={t("Bambini")} sub={t("0–13 anni")} value={children} min={0} onChange={setChildrenN} icon={<PersonGlyph small />} />
              </div>
              {children > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[11px] font-medium text-dim">{t("Età dei bambini")} <span className="text-faint">({t("per la tassa di soggiorno")})</span></div>
                  <div className="flex flex-wrap gap-2">
                    {childAges.map((age, i) => (
                      <div key={i} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5">
                        <span className="text-[11px] text-faint">{t("Bimbo")} {i + 1}</span>
                        <input type="number" min={0} max={17} value={age} onChange={(e) => setChildAges((prev) => prev.map((a, j) => (j === i ? Math.max(0, Math.min(17, Number(e.target.value))) : a)))} className="w-14 rounded border border-line bg-paper px-1.5 py-0.5 text-sm text-txt outline-none focus:border-focus" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Struttura — nascosta se già scelta in alto a destra */}
            {!locked && (
              <div className="rounded-2xl border border-line bg-paper p-4">
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-faint">{t("Struttura")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {[{ id: "all", name: t("Tutte") }, ...structures].map((s) => (
                    <button key={s.id} onClick={() => setStructFilter(s.id)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${structFilter === s.id ? "border-focus bg-focus text-white" : "border-line text-dim hover:bg-wash"}`}>
                      {s.id !== "all" && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: structColor(s.id) }} />}{s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {err && <div className="text-sm font-medium text-[color:var(--err)]">{err}</div>}
          </div>
        ) : (
          /* ─────────── STEP 2 · RISULTATI ─────────── */
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Riepilogo ricerca + modifica */}
            <button onClick={() => setStep("search")} className="flex w-full items-center gap-2 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-left transition hover:border-focus">
              <span className="text-[color:var(--focus)]"><CalIcon small /></span>
              <span className="text-sm font-semibold text-txt">{fmtDay(checkIn)} → {fmtDay(checkOut)}</span>
              <span className="text-xs text-faint">· {nightsN} {nightsN === 1 ? t("notte") : t("notti")} · {adults} {adults === 1 ? t("adulto") : t("adulti")}{children > 0 ? `, ${children} ${children === 1 ? t("bambino") : t("bambini")}` : ""}</span>
              <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-[color:var(--focus)]"><EditIcon /> {t("Modifica")}</span>
            </button>

            {/* Risultati camere */}
            {totalAvail === 0 ? (
              <div className="rounded-2xl border border-dashed border-line py-10 text-center text-sm text-faint">{t("Nessuna camera disponibile per queste date.")}</div>
            ) : (
              orderedStructs.map((s) => {
                const rows = availTypes(s.id);
                if (!rows.length) return null;
                const sc = structColor(s.id);
                return (
                  <div key={s.id}>
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: sc }}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sc }} /> {s.name}</div>
                    <div className="space-y-2">
                      {rows.map((rt) => {
                        const av = availUnits(rt).length;
                        const q = qty[rt.id] ?? 0;
                        const fits = cap(rt) >= party;
                        return (
                          <div key={rt.id} className={`flex items-center gap-3 rounded-xl border p-3 transition ${q > 0 ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_6%,transparent)]" : "border-line bg-paper hover:border-[color:color-mix(in_srgb,var(--focus)_40%,var(--line))]"}`}>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-sm font-bold text-txt">{rt.name}</span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-dim"><Guests n={cap(rt)} /> {t("fino a")} {cap(rt)}</span>
                                <span className="inline-flex items-center gap-1 text-[11px] text-faint"><BedIcon /> {rt.beds}</span>
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-[11px]">
                                <span className="inline-block rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 15%, transparent)", color: "var(--ok)" }}>✓ {av} {av === 1 ? t("disponibile") : t("disponibili")}</span>
                                {!fits && <span className="text-[color:var(--warn)]">{t("capienza inferiore agli ospiti")}</span>}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-lg font-extrabold leading-none text-txt">€{stayPrice(rt)}</div>
                              <div className="text-[10px] text-faint">{nightsN} {nightsN === 1 ? t("notte") : t("notti")}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button disabled={q <= 0} onClick={() => setQ(rt.id, q - 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-lg leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
                              <span className={`w-5 text-center text-sm font-bold ${q > 0 ? "text-[color:var(--focus)]" : "text-dim"}`}>{q}</span>
                              <button disabled={q >= av} onClick={() => setQ(rt.id, q + 1)} className={`flex h-8 w-8 items-center justify-center rounded-full border text-lg leading-none disabled:opacity-30 ${q > 0 ? "border-focus bg-focus text-white hover:opacity-90" : "border-line text-dim hover:bg-wash"}`}>+</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}

            {/* Carrello + intestatario */}
            {totalRooms > 0 && (
              <div className="space-y-3 rounded-2xl border p-3.5" style={{ borderColor: "color-mix(in srgb, var(--focus) 35%, var(--line))", backgroundColor: "color-mix(in srgb, var(--focus) 5%, transparent)" }}>
                <div className="flex items-center gap-2 text-sm font-bold text-txt">
                  <span>{isGroup ? <><span className="text-[color:var(--focus)]">⛓</span> {t("Prenotazione di gruppo")}</> : t("Riepilogo")}</span>
                  <span className="text-faint">· {totalRooms} {totalRooms === 1 ? t("camera") : t("camere")}</span>
                  {party > totalCap && <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("posti insufficienti")}: {totalCap}/{party}</span>}
                </div>
                <div className="space-y-1.5">
                  {selectedLines.map((rt) => {
                    const st = structures.find((x) => x.id === rt.structureId);
                    return (
                      <div key={rt.id} className="flex items-center gap-2 text-sm">
                        <span className="shrink-0 rounded bg-focus px-1.5 py-0.5 text-[11px] font-bold text-white">×{qty[rt.id]}</span>
                        <span className="min-w-0 flex-1 truncate text-txt">{rt.name} <span className="text-faint">· {st?.name}</span></span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-dim">€ <input type="number" min={0} value={linePrice(rt)} onChange={(e) => setPriceOv((o) => ({ ...o, [rt.id]: Math.max(0, Number(e.target.value)) }))} className="w-16 rounded border border-line bg-paper px-1.5 py-1 text-right text-sm text-txt outline-none focus:border-focus" /><span className="text-faint">/cam</span></span>
                        <button onClick={() => setQ(rt.id, 0)} title={t("Rimuovi")} className="shrink-0 text-faint hover:text-[color:var(--err)]">✕</button>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-line pt-3 sm:grid-cols-3">
                  <Field label={t("Cognome *")}><input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inp} placeholder={t("Cognome")} /></Field>
                  <Field label={t("Nome")}><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inp} placeholder={t("Nome")} /></Field>
                  <Field label={t("Canale")}>
                    <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={inp}>
                      {CHANNEL_OPTS.map((c) => (<option key={c} value={c}>{CHANNELS[c].label}</option>))}
                    </select>
                  </Field>
                  <Field label={t("Email")}><input value={email} onChange={(e) => setEmail(e.target.value)} className={inp} placeholder={t("opzionale")} /></Field>
                  <Field label={t("Telefono")}><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} placeholder={t("opzionale")} /></Field>
                </div>
              </div>
            )}

            {err && <div className="text-sm font-medium text-[color:var(--err)]">{err}</div>}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-line bg-paper px-5 py-3">
          {step === "search" ? (
            <>
              <span className="text-xs text-faint">{totalAvail > 0 ? `${totalAvail} ${t("tipologie disponibili")}` : ""}</span>
              <div className="flex gap-2">
                <button onClick={closeNewBooking} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash">{t("Annulla")}</button>
                <button onClick={goResults} className="flex items-center gap-1.5 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90"><SearchIcon /> {t("Cerca disponibilità")}</button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-dim">
                {totalRooms > 0 ? (<>{totalRooms} {totalRooms === 1 ? t("camera") : t("camere")} · <b className="text-txt">€ {totalPrice}</b> <span className="text-faint">· {nightsN} {nightsN === 1 ? t("notte") : t("notti")}</span></>) : t("Nessuna camera selezionata")}
              </div>
              <button onClick={submit} disabled={totalRooms < 1} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{isGroup ? t("Crea gruppo") : t("Crea prenotazione")}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-dim">{label}<div className="mt-1">{children}</div></label>;
}

// Stepper ospiti (− valore +)
function Stepper({ label, sub, value, min, onChange, icon }: { label: string; sub: string; value: number; min: number; onChange: (n: number) => void; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-dim">{icon}</span>
        <div><div className="text-sm font-semibold text-txt">{label}</div><div className="text-[10px] text-faint">{sub}</div></div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-lg leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
        <span className="w-5 text-center text-base font-bold tabular-nums text-txt">{value}</span>
        <button onClick={() => onChange(value + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-focus bg-focus text-lg leading-none text-white hover:opacity-90">+</button>
      </div>
    </div>
  );
}

// Icone
const PersonGlyph = ({ small }: { small?: boolean }) => (
  <svg width={small ? 9 : 11} height={small ? 9 : 11} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5Z" /></svg>
);
function Guests({ n }: { n: number }) {
  const shown = Math.min(Math.max(1, n), 4);
  return <span className="inline-flex items-center gap-[1px]">{Array.from({ length: shown }).map((_, i) => <PersonGlyph key={i} small />)}{n > 4 && <span className="ml-0.5 text-[8px] font-bold">+</span>}</span>;
}
const BedIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 9v10M2 13h20v6M22 19V9a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v4" /><circle cx="9" cy="11" r="1.5" /></svg>
);
const CalIcon = ({ small }: { small?: boolean }) => (
  <svg width={small ? 15 : 18} height={small ? 15 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
);
const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
);
