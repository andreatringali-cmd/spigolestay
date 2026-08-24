"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel, type RoomType } from "@/lib/types";
import { shiftISO, toISO, nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader, Card } from "@/components/ui";
import Icon from "@/components/Icon";

const CHANNEL_OPTS: Channel[] = ["direct", "booking", "airbnb", "expedia"];
const isWeekend = (iso: string) => { const d = new Date(iso).getDay(); return d === 5 || d === 6 || d === 0; };
const fmtDay = (iso: string) => { try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; } };

function effBase(rt: RoomType, all: RoomType[], seen: Set<string> = new Set()): number {
  if (!rt.deriveFrom || seen.has(rt.id)) return rt.basePrice;
  seen.add(rt.id);
  const src = all.find((x) => x.id === rt.deriveFrom);
  if (!src) return rt.basePrice;
  const base = effBase(src, all, seen);
  const v = rt.deriveValue ?? 0;
  return Math.max(0, Math.round(rt.deriveMode === "percent" ? base * (1 + v / 100) : base + v));
}

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
  const [err, setErr] = useState("");

  const nightsN = Math.max(1, nights(checkIn, checkOut));
  const party = adults + children;

  const availUnits = (rt: RoomType) => units.filter((u) => u.roomTypeId === rt.id && !u.outOfService && !bookings.some((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.unitId === u.id && b.checkIn < checkOut && b.checkOut > checkIn));
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
    flat.forEach((r, i) => addBooking({ groupId, structureId: r.rt.structureId, roomTypeId: r.rt.id, unitId: r.unitId, guestId, channel, status: "confirmed", checkIn, checkOut, adults: nR > 1 ? dist(adults, i) : adults, children: nR > 1 ? dist(children, i) : children, total: linePrice(r.rt) || undefined, note: isGroup && groupName.trim() ? groupName.trim() : undefined }));
    router.push("/prenotazioni");
  };

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick} className={`relative h-6 w-11 rounded-full transition ${on ? "bg-focus" : "bg-line"}`}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Aggiungi prenotazione" subtitle="Cerca la disponibilità e componi la prenotazione, anche di gruppo" actions={<Link href="/prenotazioni" className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash">← Prenotazioni</Link>} />

      {/* ─────────── Criteri di ricerca ─────────── */}
      <Card className="mb-5">
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-[1fr_1fr]">
          {/* Soggiorno */}
          <Row label="Soggiorno">
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={dateInp} />
              <span className="text-faint">→</span>
              <input type="date" value={checkOut} min={shiftISO(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} className={dateInp} />
              <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] px-2.5 py-1 text-xs font-bold text-[color:var(--focus)]">{nightsN} {nightsN === 1 ? "notte" : "notti"}</span>
            </div>
          </Row>
          {/* Ospiti */}
          <Row label="Ospiti">
            <div className="flex items-center gap-4">
              <NumBox label="Adulti" value={adults} min={1} onChange={setAdults} />
              <NumBox label="Bambini" value={children} min={0} onChange={setChildren} />
            </div>
          </Row>
          {/* Toggle: solo disponibili */}
          <Row label="Mostra solo le camere disponibili"><Toggle on={onlyAvail} onClick={() => setOnlyAvail((v) => !v)} /></Row>
          {/* Toggle: gruppo */}
          <Row label="Prenotazione di gruppo"><Toggle on={group} onClick={() => setGroup((v) => !v)} /></Row>
          {/* Struttura */}
          {!locked && (
            <Row label="Struttura">
              <div className="flex flex-wrap gap-1.5">
                {[{ id: "all", name: "Tutte" }, ...structures].map((s) => (
                  <button key={s.id} onClick={() => setStructFilter(s.id)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${structFilter === s.id ? "border-focus bg-focus text-white" : "border-line text-dim hover:bg-wash"}`}>
                    {s.id !== "all" && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: structColor(s.id) }} />}{s.name}
                  </button>
                ))}
              </div>
            </Row>
          )}
          {group && (
            <Row label="Nome gruppo *"><input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Es. Famiglia Rossi, Gruppo Tour…" className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></Row>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-3 border-t border-line pt-4">
          {err && !searched && <span className="mr-auto text-sm font-medium text-[color:var(--err)]">{err}</span>}
          <button onClick={doSearch} className="flex items-center gap-2 rounded-lg bg-focus px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"><Icon name="search" size={15} /> Cerca disponibilità</button>
        </div>
      </Card>

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
                              <td className="px-3 py-3 text-center"><span className="font-semibold text-txt">{av}</span></td>
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

const dateInp = "rounded-lg border border-line bg-paper px-3 py-2 text-sm font-semibold text-txt outline-none focus:border-focus";
const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="w-full text-xs font-semibold uppercase tracking-wide text-faint sm:w-56">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
function FieldL({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-dim">{label}<div className="mt-1">{children}</div></label>;
}
function NumBox({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-dim">{label}</span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-lg leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
        <span className="w-6 text-center text-base font-bold tabular-nums text-txt">{value}</span>
        <button onClick={() => onChange(value + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-focus bg-focus text-lg leading-none text-white hover:opacity-90">+</button>
      </div>
    </div>
  );
}
const Person = () => (<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5Z" /></svg>);
