"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel, type RoomType } from "@/lib/types";
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
  const { structures, roomTypes, units, bookings, rateOverrides, addGuest, addBooking, activeStructureId } = useData();
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
  const [searched, setSearched] = useState(false);

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

  const doSearch = () => {
    if (checkOut <= checkIn) { setErr("Il check-out deve essere dopo il check-in"); return; }
    setErr(""); setSearched(true);
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
    flat.forEach((r, i) => {
      const kids = nR > 1 ? dist(children, i) : children;
      const ages = childAges.slice(ci, ci + kids); ci += kids;
      const roomCribs = nR > 1 ? Math.min(dist(cribs, i), kids) : cribs;
      const depositN = Math.max(0, Number(deposit) || 0);
      addBooking({ groupId, structureId: r.rt.structureId, roomTypeId: r.rt.id, unitId: r.unitId, guestId, channel, status: "confirmed", checkIn, checkOut, adults: nR > 1 ? dist(adults, i) : adults, children: kids, childAges: ages.length ? ages : undefined, cribs: roomCribs || undefined, parking: parking || undefined, paid: i === 0 && depositN > 0 ? depositN : undefined, total: linePrice(r.rt) || undefined, note: isGroup && groupName.trim() ? groupName.trim() : undefined });
    });
    router.push("/prenotazioni");
  };

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick} className={`relative h-6 w-11 rounded-full transition ${on ? "bg-focus" : "bg-line"}`}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>
  );

  return (
    <div>
      {/* ─────────── Criteri di ricerca · card in stile widget ─────────── */}
      <div className="mb-5 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        {/* Header a banda colorata */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 text-white" style={{ background: "linear-gradient(135deg, var(--focus), color-mix(in srgb, var(--focus) 62%, #000))" }}>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/20 text-white"><Icon name="calendar" size={18} /></span>
            <div>
              <h2 className="font-display text-base font-bold leading-tight">Aggiungi prenotazione</h2>
              <p className="text-[11px] text-white/80">Cerca la disponibilità e componi la prenotazione, anche di gruppo</p>
            </div>
          </div>
          <Link href="/prenotazioni" className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/25">← Prenotazioni</Link>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-2">
          {/* Soggiorno */}
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-faint">Soggiorno</div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 text-[11px] font-medium text-dim">Check-in
                <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-txt outline-none focus:border-focus" />
              </label>
              <div className="grid h-11 w-9 shrink-0 place-items-center text-faint">→</div>
              <label className="flex-1 text-[11px] font-medium text-dim">Check-out
                <input type="date" value={checkOut} min={shiftISO(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-txt outline-none focus:border-focus" />
              </label>
              <span className="mb-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] px-3 py-1.5 text-xs font-bold text-[color:var(--focus)]">{nightsN} {nightsN === 1 ? "notte" : "notti"}</span>
            </div>
          </div>

          {/* Ospiti */}
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-faint">Ospiti</div>
            <div className="grid grid-cols-2 gap-3">
              <Stepper label="Adulti" sub="14 anni +" value={adults} min={1} onChange={setAdults} />
              <Stepper label="Bambini" sub="0–13 anni" value={children} min={0} onChange={setChildrenN} />
            </div>
            {children > 0 && (
              <div className="mt-3 space-y-3 rounded-xl border border-line bg-surface p-3">
                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-dim">Età dei bambini <span className="text-faint">(per la tassa di soggiorno)</span></div>
                  <div className="flex flex-wrap gap-2">
                    {childAges.map((age, i) => (
                      <div key={i} className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5">
                        <span className="text-[11px] text-faint">Bimbo {i + 1}</span>
                        <input type="number" min={0} max={17} value={age} onChange={(e) => setChildAges((prev) => prev.map((a, j) => (j === i ? Math.max(0, Math.min(17, Number(e.target.value))) : a)))} className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-sm text-txt outline-none focus:border-focus" />
                        <span className="text-[11px] text-faint">anni</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5">
                  <div><div className="text-sm font-semibold text-txt">Culla / lettino</div><div className="text-[10px] text-faint">Quante ne servono</div></div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCribs((v) => Math.max(0, v - 1))} disabled={cribs <= 0} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-lg leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
                    <span className="w-5 text-center text-base font-bold tabular-nums text-txt">{cribs}</span>
                    <button onClick={() => setCribs((v) => Math.min(children, v + 1))} disabled={cribs >= children} className="flex h-8 w-8 items-center justify-center rounded-full border border-focus bg-focus text-lg leading-none text-white hover:opacity-90 disabled:opacity-30">+</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          </div>

          {/* Opzioni + struttura */}
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-faint">Opzioni</div>
            <div className="divide-y divide-[color:var(--line)]">
              <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-sm text-txt">Mostra solo le camere disponibili</span><Toggle on={onlyAvail} onClick={() => setOnlyAvail((v) => !v)} /></div>
              <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-sm text-txt">Prenotazione di gruppo</span><Toggle on={group} onClick={() => setGroup((v) => !v)} /></div>
              {group && (
                <div className="py-2.5"><label className="block text-[11px] font-medium text-dim">Nome gruppo *<input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Es. Famiglia Rossi, Gruppo Tour…" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label></div>
              )}
            </div>
            {!locked && (
              <div className="mt-3">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">Struttura</div>
                <div className="flex flex-wrap gap-1.5">
                  {[{ id: "all", name: "Tutte" }, ...structures].map((s) => (
                    <button key={s.id} onClick={() => setStructFilter(s.id)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${structFilter === s.id ? "border-focus bg-focus text-white" : "border-line text-dim hover:bg-wash"}`}>
                      {s.id !== "all" && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: structColor(s.id) }} />}{s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {err && !searched && <div className="text-sm font-medium text-[color:var(--err)]">{err}</div>}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line bg-paper px-5 py-3">
          <button onClick={doSearch} className="flex items-center gap-2 rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90"><Icon name="search" size={15} /> Cerca disponibilità</button>
        </div>
      </div>

      {/* ─────────── Risultati ─────────── */}
      {searched && (
        totalTypes === 0 ? (
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
        )
      )}

      {/* ─────────── Le tue scelte ─────────── */}
      {searched && totalRooms > 0 && (
        <Card className="mb-10">
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
              <tfoot><tr className="border-t-2 border-line"><td className="px-4 py-3 font-semibold text-txt" colSpan={3}>Totale · {nightsN} {nightsN === 1 ? "notte" : "notti"}</td><td className="px-4 py-3 text-right text-lg font-extrabold text-[color:var(--focus)]">{eur(grandTotal)}</td><td /></tr></tfoot>
            </table>
          </div>

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
            <span className="text-[11px] text-faint">Extra, tassa di soggiorno, commissioni e fattura si aggiungono dalla scheda della prenotazione.</span>
          </div>

          <div className="mt-4 flex items-center justify-end gap-3 border-t border-line pt-4">
            {err && <span className="mr-auto text-sm font-medium text-[color:var(--err)]">{err}</span>}
            <span className="text-sm text-dim">{totalRooms} {totalRooms === 1 ? "camera" : "camere"} · <b className="text-txt">{eur(grandTotal)}</b></span>
            <button onClick={confirm} className="rounded-lg bg-focus px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90">{isGroup ? "Crea gruppo" : "Crea prenotazione"}</button>
          </div>
        </Card>
      )}
    </div>
  );
}

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

function FieldL({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-dim">{label}<div className="mt-1">{children}</div></label>;
}
// Stepper ospiti in stile widget (box con − valore +)
function Stepper({ label, sub, value, min, onChange }: { label: string; sub: string; value: number; min: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2.5">
      <div><div className="text-sm font-semibold text-txt">{label}</div><div className="text-[10px] text-faint">{sub}</div></div>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-lg leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
        <span className="w-5 text-center text-base font-bold tabular-nums text-txt">{value}</span>
        <button onClick={() => onChange(value + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-focus bg-focus text-lg leading-none text-white hover:opacity-90">+</button>
      </div>
    </div>
  );
}
const Person = () => (<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5Z" /></svg>);
