"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel, type RoomType, type Booking, type Guest } from "@/lib/types";
import { sendVoucher } from "@/lib/mailer";
import { effBase } from "@/lib/pricing";
import { shiftISO, toISO, nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { Card } from "@/components/ui";
import Icon from "@/components/Icon";

const CHANNEL_OPTS: Channel[] = ["direct", "booking", "airbnb", "expedia"];
const isWeekend = (iso: string) => { const d = new Date(iso).getDay(); return d === 5 || d === 6 || d === 0; };
const fmtDay = (iso: string) => { try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; } };

export default function NuovaPrenotazionePage() {
  const router = useRouter();
  const { structures, roomTypes, units, bookings, rateOverrides, addGuest, addBooking, getStructure, getRoomType, getUnit, activeStructureId } = useData();
  const weekendPct = useMemo(() => { try { const r = localStorage.getItem("spigolestay:pricerules"); if (r) return JSON.parse(r).weekendPct ?? 25; } catch {} return 25; }, []);

  const locked = activeStructureId !== "all";
  const structColor = (sId: string) => structures.find((s) => s.id === sId)?.photoColor || "var(--focus)";

  // ── Criteri di ricerca ──
  const today = toISO(new Date());
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(shiftISO(today, 1));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [childAges, setChildAges] = useState<number[]>([]);
  const [cribs, setCribs] = useState(0);
  const setChildrenN = (n: number) => { setChildren(n); setChildAges((prev) => { const next = prev.slice(0, n); while (next.length < n) next.push(8); return next; }); if (cribs > n) setCribs(n); };
  const [onlyAvail, setOnlyAvail] = useState(true);
  const [group, setGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [structFilter, setStructFilter] = useState<string>(locked ? activeStructureId : "all");
  const [phase, setPhase] = useState<"search" | "rooms" | "details">("search");
  const [extraQty, setExtraQty] = useState<Record<string, number>>({});

  // ── Selezione + intestatario ──
  const [qty, setQty] = useState<Record<string, number>>({});
  const [priceOv, setPriceOv] = useState<Record<string, number>>({});
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<Channel>("direct");
  const [parking, setParking] = useState(false);
  const [deposit, setDeposit] = useState("");
  const [sendConfirm, setSendConfirm] = useState(true);
  const [err, setErr] = useState("");

  const nightsN = Math.max(1, nights(checkIn, checkOut));
  const party = adults + children;

  // Camere della tipologia libere per le date scelte (stessa logica del calendario):
  // esclude quelle fuori servizio in permanenza e quelle con una prenotazione o un fuori
  // servizio (barra "blocked") che si sovrappone alle notti richieste. Le cancellate non contano.
  const availUnits = (rt: RoomType) => units.filter((u) => u.roomTypeId === rt.id && !u.outOfService && !bookings.some((b) => b.status !== "cancelled" && b.unitId === u.id && b.checkIn < checkOut && b.checkOut > checkIn));
  // Totale camere reali della tipologia (fuori servizio permanenti escluse): serve a mostrare "libere su totale".
  const unitsOfType = (rt: RoomType) => units.filter((u) => u.roomTypeId === rt.id && !u.outOfService).length;
  const dayPrice = (rt: RoomType, iso: string) => { const base = effBase(rt, roomTypes); const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(base * (isWeekend(iso) ? 1 + weekendPct / 100 : 1)); return Math.max(0, Math.round(raw)); };
  const stayPrice = (rt: RoomType) => { let s = 0; for (let i = 0; i < nightsN; i++) s += dayPrice(rt, shiftISO(checkIn, i)); return s; };
  const cap = (rt: RoomType) => rt.maxOccupancy ?? rt.beds ?? 2;
  const linePrice = (rt: RoomType) => priceOv[rt.id] ?? stayPrice(rt);
  const setQ = (rtId: string, n: number) => setQty((q) => ({ ...q, [rtId]: Math.max(0, n) }));

  const orderedStructs = structFilter === "all" ? structures : structures.filter((s) => s.id === structFilter);
  const rowsOf = (sId: string) => roomTypes.filter((rt) => rt.structureId === sId).filter((rt) => (onlyAvail ? availUnits(rt).length > 0 : true));
  const totalTypes = orderedStructs.reduce((a, s) => a + rowsOf(s.id).length, 0);

  const selected = roomTypes.filter((rt) => (qty[rt.id] ?? 0) > 0);
  const totalRooms = selected.reduce((a, rt) => a + (qty[rt.id] ?? 0), 0);
  const grandTotal = selected.reduce((a, rt) => a + linePrice(rt) * (qty[rt.id] ?? 0), 0);
  const totalCap = selected.reduce((a, rt) => a + cap(rt) * (qty[rt.id] ?? 0), 0);
  const isGroup = group || totalRooms > 1;

  // Extra proponibili: quelli attivi delle strutture delle camere scelte.
  const selectedStructIds = [...new Set(selected.map((rt) => rt.structureId))];
  const availExtras = structures.filter((s) => selectedStructIds.includes(s.id)).flatMap((s) => (s.extras ?? []).filter((e) => e.active !== false).map((e) => ({ id: e.id, name: e.name, desc: e.desc, price: e.price, per: e.per, structName: structures.length > 1 ? s.name : "" })));
  const extrasTotal = availExtras.reduce((a, e) => a + (extraQty[e.id] ?? 0) * e.price, 0);
  const grandWithExtras = grandTotal + extrasTotal;
  const chosenExtras = availExtras.filter((e) => (extraQty[e.id] ?? 0) > 0).map((e) => { const q = extraQty[e.id] ?? 0; return { name: q > 1 ? `${e.name} ×${q}` : e.name, price: e.price * q }; });
  const setExtraQ = (id: string, n: number) => setExtraQty((m) => ({ ...m, [id]: Math.max(0, n) }));

  const doSearch = () => {
    if (checkOut <= checkIn) { setErr("Il check-out deve essere dopo il check-in"); return; }
    setErr(""); setPhase("rooms");
  };

  const confirm = () => {
    if (totalRooms < 1) { setErr("Seleziona almeno una camera"); return; }
    if (!lastName.trim() && !firstName.trim()) { setErr("Inserisci nome o cognome dell'ospite"); return; }
    const guestId = addGuest({ lastName: lastName.trim() || undefined, firstName: firstName.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined });
    const groupId = isGroup ? ((typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())) : undefined;
    const flat: { rt: RoomType; unitId: string | null }[] = [];
    selected.forEach((rt) => { const free = availUnits(rt); const q = Math.min(qty[rt.id] ?? 0, free.length); for (let k = 0; k < q; k++) flat.push({ rt, unitId: free[k]?.id ?? null }); });
    const nR = Math.max(1, flat.length);
    const dist = (tot: number, i: number) => Math.floor(tot / nR) + (i < tot % nR ? 1 : 0);
    let ci = 0; // cursore per distribuire le età dei bambini tra le camere del gruppo
    let primary: Booking | undefined;
    flat.forEach((r, i) => {
      const kids = nR > 1 ? dist(children, i) : children;
      const ages = childAges.slice(ci, ci + kids); ci += kids;
      const roomCribs = nR > 1 ? Math.min(dist(cribs, i), kids) : cribs;
      const depositN = Math.max(0, Number(deposit) || 0);
      const created = addBooking({ groupId, structureId: r.rt.structureId, roomTypeId: r.rt.id, unitId: r.unitId, guestId, channel, status: "confirmed", checkIn, checkOut, adults: nR > 1 ? dist(adults, i) : adults, children: kids, childAges: ages.length ? ages : undefined, cribs: roomCribs || undefined, parking: parking || undefined, paid: i === 0 && depositN > 0 ? depositN : undefined, total: linePrice(r.rt) || undefined, extras: i === 0 && chosenExtras.length ? chosenExtras : undefined, note: isGroup && groupName.trim() ? groupName.trim() : undefined });
      if (i === 0) primary = created;
    });
    // Conferma all'ospite (voucher via email). Uso i dati appena inseriti per evitare i ritardi dello stato.
    if (sendConfirm && email.trim() && primary) {
      const guestObj = { id: guestId, fullName: `${firstName} ${lastName}`.trim(), firstName, lastName, email: email.trim(), phone: phone.trim() } as Guest;
      sendVoucher(primary, { getStructure, getGuest: () => guestObj, getRoomType, getUnit });
    }
    router.push("/prenotazioni");
  };

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick} className={`relative h-6 w-11 rounded-full transition ${on ? "bg-focus" : "bg-line"}`}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>
  );

  return (
    <div>
      {/* Titolo compatto */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-txt">Aggiungi prenotazione</h1>
          <p className="text-xs text-dim">Cerca la disponibilità e componi la prenotazione, anche di gruppo</p>
        </div>
        <Link href="/prenotazioni" className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash">← Prenotazioni</Link>
      </div>

      {/* Indicatore di step 1-2-3 */}
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold">
        {([["search", "1", "Disponibilità"], ["rooms", "2", "Camera"], ["details", "3", "Personalizza"]] as const).map(([ph, n, lab], i) => {
          const order = { search: 0, rooms: 1, details: 2 } as const;
          const state = order[phase] === i ? "current" : order[phase] > i ? "done" : "todo";
          return (
            <div key={ph} className="flex items-center gap-2">
              {i > 0 && <span className={`h-px w-5 ${order[phase] >= i ? "bg-focus" : "bg-line"}`} />}
              <button type="button" disabled={order[phase] < i} onClick={() => setPhase(ph)} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition ${state === "current" ? "bg-focus text-white" : state === "done" ? "text-focus hover:bg-wash" : "text-faint"}`}>
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${state === "current" ? "bg-white/25" : state === "done" ? "bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)]" : "bg-wash"}`}>{state === "done" ? "✓" : n}</span>
                <span className="hidden sm:inline">{lab}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ─────────── Step 1 · Barra di ricerca compatta (stile widget del sito) ─────────── */}
      {phase === "search" && (
      <div className="mb-5 rounded-2xl border border-line bg-surface p-3 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_88px_88px_auto]">
          <label className="block text-[11px] font-medium text-dim">Arrivo<input type="date" value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(shiftISO(e.target.value, 1)); }} className={`${barInp} mt-0.5`} /></label>
          <label className="block text-[11px] font-medium text-dim">Partenza<input type="date" value={checkOut} min={shiftISO(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} className={`${barInp} mt-0.5`} /></label>
          <label className="block text-[11px] font-medium text-dim">Adulti<input type="number" min={1} value={adults} onChange={(e) => setAdults(Math.max(1, +e.target.value))} className={`${barInp} mt-0.5`} /></label>
          <label className="block text-[11px] font-medium text-dim">Bambini<input type="number" min={0} value={children} onChange={(e) => setChildrenN(Math.max(0, +e.target.value))} className={`${barInp} mt-0.5`} /></label>
          <button onClick={doSearch} className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90"><Icon name="search" size={15} /> Cerca disponibilità</button>
        </div>

        {/* Riga opzioni compatta */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2 text-sm">
          <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] px-2.5 py-1 text-xs font-bold text-[color:var(--focus)]">{nightsN} {nightsN === 1 ? "notte" : "notti"}</span>
          <label className="flex items-center gap-2 text-dim"><Toggle on={onlyAvail} onClick={() => setOnlyAvail((v) => !v)} /> Solo disponibili</label>
          <label className="flex items-center gap-2 text-dim"><Toggle on={group} onClick={() => setGroup((v) => !v)} /> Gruppo</label>
          {group && <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Nome gruppo" className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />}
          {!locked && (
            <div className="flex flex-wrap items-center gap-1.5">
              {[{ id: "all", name: "Tutte" }, ...structures].map((s) => (
                <button key={s.id} onClick={() => setStructFilter(s.id)} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${structFilter === s.id ? "border-focus bg-focus text-white" : "border-line text-dim hover:bg-wash"}`}>
                  {s.id !== "all" && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: structColor(s.id) }} />}{s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Età bambini + culle (solo se ci sono bambini) */}
        {children > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2">
            <span className="text-[11px] font-medium text-dim">Età bambini:</span>
            {childAges.map((age, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2 py-1">
                <span className="text-[11px] text-faint">{i + 1}°</span>
                <input type="number" min={0} max={17} value={age} onChange={(e) => setChildAges((prev) => prev.map((a, j) => (j === i ? Math.max(0, Math.min(17, Number(e.target.value))) : a)))} className="w-12 rounded border border-line bg-surface px-1 py-0.5 text-sm text-txt outline-none focus:border-focus" />
              </div>
            ))}
            <label className="ml-2 flex items-center gap-1.5 text-sm text-dim">Culle
              <button onClick={() => setCribs((v) => Math.max(0, v - 1))} disabled={cribs <= 0} className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-base leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
              <span className="w-4 text-center text-sm font-bold tabular-nums text-txt">{cribs}</span>
              <button onClick={() => setCribs((v) => Math.min(children, v + 1))} disabled={cribs >= children} className="flex h-7 w-7 items-center justify-center rounded-full border border-focus bg-focus text-base leading-none text-white hover:opacity-90 disabled:opacity-30">+</button>
            </label>
          </div>
        )}

        {err && phase === "search" && <div className="mt-2 text-sm font-medium text-[color:var(--err)]">{err}</div>}
      </div>
      )}

      {/* ─────────── Step 2 · Scegli la camera ─────────── */}
      {phase === "rooms" && (
        <>
        <button onClick={() => setPhase("search")} className="mb-3 flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-sm shadow-sm transition hover:border-focus">
          <Icon name="calendar" size={15} /> <span className="font-semibold text-txt">{fmtDay(checkIn)} → {fmtDay(checkOut)}</span>
          <span className="text-xs text-faint">· {nightsN} {nightsN === 1 ? "notte" : "notti"} · {party} {party === 1 ? "ospite" : "ospiti"}</span>
          <span className="ml-auto text-xs font-semibold text-focus">Modifica ricerca</span>
        </button>
        {totalTypes === 0 ? (
          <Card className="mb-5 py-10 text-center text-sm text-faint">Nessuna camera disponibile per queste date.</Card>
        ) : (
          <div className="mb-5 space-y-5">
            {orderedStructs.map((s) => {
              const rows = rowsOf(s.id);
              if (!rows.length) return null;
              const sc = structColor(s.id);
              return (
                <div key={s.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                  {/* intestazione struttura */}
                  <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: `2px solid ${sc}` }}>
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: sc }} />
                    <span className="text-base font-bold text-txt">{s.name}</span>
                    <span className="text-xs text-faint">· {rows.length} {rows.length === 1 ? "tipologia" : "tipologie"}</span>
                  </div>
                  {/* tabella camere */}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="bg-wash text-left text-[11px] font-semibold uppercase tracking-wide text-dim">
                          <th className="px-4 py-2.5">Camera</th>
                          <th className="px-3 py-2.5 text-center">Ospiti</th>
                          <th className="px-3 py-2.5 text-center">Rimborsabile</th>
                          <th className="px-3 py-2.5 text-center">Disponibilità</th>
                          <th className="px-3 py-2.5 text-right">Totale camera</th>
                          <th className="px-4 py-2.5 text-right">Quantità</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[color:var(--line)]">
                        {rows.map((rt) => {
                          const av = availUnits(rt).length;
                          const q = qty[rt.id] ?? 0;
                          const fits = cap(rt) >= party;
                          return (
                            <tr key={rt.id} className={q > 0 ? "bg-[color:color-mix(in_srgb,var(--focus)_5%,transparent)]" : ""}>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-txt">{rt.name}</div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-dim"><Icon name="cup" size={12} /> BB · Flessibile 7 gg{!fits && <span className="text-[color:var(--warn)]">· capienza {cap(rt)} &lt; {party} ospiti</span>}</div>
                              </td>
                              <td className="px-3 py-3 text-center"><span className="inline-flex items-center gap-[1px] text-dim">{Array.from({ length: Math.min(cap(rt), 5) }).map((_, i) => <Person key={i} />)}</span></td>
                              <td className="px-3 py-3 text-center"><span className="inline-grid h-6 w-6 place-items-center rounded-full text-[color:var(--ok)]" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)" }}><Icon name="check" size={13} /></span></td>
                              <td className="px-3 py-3 text-center">{(() => { const tot = unitsOfType(rt); const occ = tot - av; return (<><span className={`font-semibold ${av > 0 ? "text-txt" : "text-[color:var(--err)]"}`}>{av}</span><span className="text-faint"> / {tot}</span>{occ > 0 && <div className="text-[10px] text-faint">{occ} {occ === 1 ? "occupata" : "occupate"}</div>}</>); })()}</td>
                              <td className="px-3 py-3 text-right"><span className="text-base font-extrabold text-txt">{eur(stayPrice(rt))}</span><div className="text-[10px] text-faint">{nightsN} {nightsN === 1 ? "notte" : "notti"}</div></td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button disabled={q <= 0} onClick={() => setQ(rt.id, q - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-lg leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
                                  <span className={`w-6 text-center text-sm font-bold ${q > 0 ? "text-[color:var(--focus)]" : "text-dim"}`}>{q}</span>
                                  <button disabled={q >= av} onClick={() => setQ(rt.id, q + 1)} className={`flex h-8 w-8 items-center justify-center rounded-lg border text-lg leading-none disabled:opacity-30 ${q > 0 ? "border-focus bg-focus text-white hover:opacity-90" : "border-line text-dim hover:bg-wash"}`}>+</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="sticky bottom-3 z-10 mt-2 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-lg">
          <div className="text-sm text-dim">{totalRooms > 0 ? (<>{totalRooms} {totalRooms === 1 ? "camera" : "camere"} · <b className="text-txt">{eur(grandTotal)}</b></>) : "Seleziona almeno una camera"}</div>
          <button onClick={() => setPhase("details")} disabled={totalRooms < 1} className="flex items-center gap-2 rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40">Continua →</button>
        </div>
        </>
      )}

      {/* ─────────── Step 3 · Personalizza ─────────── */}
      {phase === "details" && totalRooms > 0 && (
        <Card className="mb-10">
          <button onClick={() => setPhase("rooms")} className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-focus hover:underline">← Torna alle camere</button>
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-focus text-white"><Icon name="cart" size={16} /></span>
            <h3 className="font-display text-base font-bold text-txt">Le tue scelte</h3>
            <span className="text-xs text-faint">· {totalRooms} {totalRooms === 1 ? "camera" : "camere"}{isGroup ? " · gruppo ⛓" : ""}</span>
            {party > totalCap && <span className="ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>Posti insufficienti: {totalCap}/{party}</span>}
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="bg-wash text-left text-[11px] font-semibold uppercase tracking-wide text-dim"><th className="px-4 py-2.5">Camera</th><th className="px-3 py-2.5 text-center">Qtà</th><th className="px-3 py-2.5 text-right">Prezzo/camera</th><th className="px-4 py-2.5 text-right">Subtotale</th><th className="px-3 py-2.5"></th></tr></thead>
              <tbody className="divide-y divide-[color:var(--line)]">
                {selected.map((rt) => {
                  const st = structures.find((x) => x.id === rt.structureId);
                  return (
                    <tr key={rt.id}>
                      <td className="px-4 py-2.5"><span className="font-semibold text-txt">{rt.name}</span> <span className="text-faint">· {st?.name}</span></td>
                      <td className="px-3 py-2.5 text-center font-bold text-txt">{qty[rt.id]}</td>
                      <td className="px-3 py-2.5 text-right"><span className="inline-flex items-center gap-1">€ <input type="number" min={0} value={linePrice(rt)} onChange={(e) => setPriceOv((o) => ({ ...o, [rt.id]: Math.max(0, Number(e.target.value)) }))} className="w-20 rounded border border-line bg-paper px-1.5 py-1 text-right text-sm text-txt outline-none focus:border-focus" /></span></td>
                      <td className="px-4 py-2.5 text-right font-bold text-txt">{eur(linePrice(rt) * (qty[rt.id] ?? 0))}</td>
                      <td className="px-3 py-2.5 text-right"><button onClick={() => setQ(rt.id, 0)} title="Rimuovi" className="text-faint hover:text-[color:var(--err)]">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="border-t-2 border-line"><td className="px-4 py-3 font-semibold text-txt" colSpan={3}>Camere · {nightsN} {nightsN === 1 ? "notte" : "notti"}</td><td className="px-4 py-3 text-right font-bold text-txt">{eur(grandTotal)}</td><td /></tr></tfoot>
            </table>
          </div>

          {/* Extra / servizi (dal catalogo della struttura) */}
          {availExtras.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-faint">Extra e servizi</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {availExtras.map((e) => { const q = extraQty[e.id] ?? 0; return (
                  <div key={e.id} className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${q > 0 ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_6%,transparent)]" : "border-line"}`}>
                    <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-txt">{e.name}{e.structName ? <span className="font-normal text-faint"> · {e.structName}</span> : ""}</div>{e.desc && <div className="truncate text-[11px] text-faint">{e.desc}</div>}</div>
                    <span className="shrink-0 font-mono text-sm font-bold text-txt">{eur(e.price)}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button disabled={q <= 0} onClick={() => setExtraQ(e.id, q - 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-base leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
                      <span className={`w-5 text-center text-sm font-bold ${q > 0 ? "text-[color:var(--focus)]" : "text-dim"}`}>{q}</span>
                      <button onClick={() => setExtraQ(e.id, q + 1)} className={`flex h-7 w-7 items-center justify-center rounded-lg border text-base leading-none ${q > 0 ? "border-focus bg-focus text-white hover:opacity-90" : "border-line text-dim hover:bg-wash"}`}>+</button>
                    </div>
                  </div>
                ); })}
              </div>
            </div>
          )}

          {/* Intestatario */}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-3">
            <FieldL label="Cognome *"><input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inp} placeholder="Cognome" /></FieldL>
            <FieldL label="Nome"><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inp} placeholder="Nome" /></FieldL>
            <FieldL label="Canale"><select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={inp}>{CHANNEL_OPTS.map((c) => (<option key={c} value={c}>{CHANNELS[c].label}</option>))}</select></FieldL>
            <FieldL label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} className={inp} placeholder="opzionale" /></FieldL>
            <FieldL label="Telefono"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} placeholder="opzionale" /></FieldL>
          </div>

          {/* Dettagli facoltativi decisi al momento · il resto si gestisce dalla scheda prenotazione */}
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-paper p-3">
            <label className="flex items-center gap-2 text-sm text-txt"><Toggle on={parking} onClick={() => setParking((v) => !v)} /> Parcheggio</label>
            <label className="flex items-center gap-2 text-sm text-txt">Acconto <span className="flex items-center gap-1">€ <input type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" className="w-24 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></span></label>
            <label className={`flex items-center gap-2 text-sm ${email.trim() ? "text-txt" : "text-faint"}`} title={email.trim() ? undefined : "Inserisci l'email dell'ospite per inviare la conferma"}><Toggle on={sendConfirm && !!email.trim()} onClick={() => setSendConfirm((v) => !v)} /> Invia conferma via email all'ospite</label>
            <span className="w-full text-[11px] text-faint">Tassa di soggiorno, commissioni e fattura si aggiungono dalla scheda della prenotazione.</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            {err && <span className="mr-auto text-sm font-medium text-[color:var(--err)]">{err}</span>}
            <span className="text-sm text-dim">{extrasTotal > 0 ? <>Camere {eur(grandTotal)} + extra {eur(extrasTotal)} · </> : null}<b className="text-txt">Totale {eur(grandWithExtras)}</b></span>
            <button onClick={confirm} className="rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90">{isGroup ? "Crea gruppo" : "Crea prenotazione"}</button>
          </div>
        </Card>
      )}
    </div>
  );
}

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

const barInp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm font-semibold text-txt outline-none focus:border-focus";

function FieldL({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-dim">{label}<div className="mt-1">{children}</div></label>;
}
const Person = () => (<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5Z" /></svg>);
