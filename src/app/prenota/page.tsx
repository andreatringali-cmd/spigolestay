"use client";

import { useMemo, useState } from "react";
import { DataProvider, useData } from "@/lib/store";
import type { RoomType, ExtraService } from "@/lib/types";
import { DEFAULT_EXTRAS } from "@/lib/types";
import { getImages } from "@/lib/images";
import { eur } from "@/lib/format";

// ---- pricing helpers --------------------------------------------------------
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return toISO(d); };
const nightsBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
const isWeekendISO = (iso: string) => { const day = new Date(iso).getDay(); return day === 5 || day === 6 || day === 0; };

interface Plan { id: string; name: string; adjPct: number; refundable: boolean; board: string }
const DEFAULT_PLANS: Plan[] = [
  { id: "std", name: "Standard", adjPct: 0, refundable: true, board: "Solo pernottamento" },
  { id: "bb", name: "Colazione inclusa", adjPct: 8, refundable: true, board: "Colazione" },
  { id: "nonref", name: "Non rimborsabile", adjPct: -10, refundable: false, board: "Solo pernottamento" },
];

function effectiveBase(rt: RoomType, all: RoomType[], seen: Set<string> = new Set()): number {
  if (!rt.deriveFrom || seen.has(rt.id)) return rt.basePrice;
  seen.add(rt.id);
  const src = all.find((x) => x.id === rt.deriveFrom);
  if (!src) return rt.basePrice;
  const base = effectiveBase(src, all, seen);
  const v = rt.deriveValue ?? 0;
  return Math.max(0, Math.round(rt.deriveMode === "percent" ? base * (1 + v / 100) : base + v));
}

const box = "rounded-xl border border-line bg-surface";
const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

export default function PrenotaPage() {
  return <DataProvider><Engine /></DataProvider>;
}

function Engine() {
  const { structures, roomTypes, units, bookings, rateOverrides, addGuest, addBooking, addActivity, getStructure } = useData();

  // Config salvata (piani, weekend) — fallback ai default.
  const plans = useMemo<Plan[]>(() => { try { const p = localStorage.getItem("spigolestay:rateplans"); if (p) return JSON.parse(p).filter((x: Plan) => x.id !== "flex"); } catch {} return DEFAULT_PLANS; }, []);
  const weekendPct = useMemo(() => { try { const r = localStorage.getItem("spigolestay:pricerules"); if (r) return JSON.parse(r).weekendPct ?? 25; } catch {} return 25; }, []);

  const qp = (k: string) => { try { return new URLSearchParams(window.location.search).get(k); } catch { return null; } };
  const [structureId, setStructureId] = useState(() => qp("s") || structures[0]?.id || "");
  const structure = getStructure(structureId);
  const extras: ExtraService[] = (structure?.extras && structure.extras.length ? structure.extras : DEFAULT_EXTRAS).filter((e) => e.active !== false);

  const today = toISO(new Date());
  const [checkIn, setCheckIn] = useState(() => qp("ci") || addDays(today, 7));
  const [checkOut, setCheckOut] = useState(() => qp("co") || addDays(today, 8));
  const [adults, setAdults] = useState(() => Number(qp("ad")) || 2);
  const [children, setChildren] = useState(() => Number(qp("ch")) || 0);
  const nights = nightsBetween(checkIn, checkOut);

  const [step, setStep] = useState<"rooms" | "checkout" | "done">("rooms");
  const [sel, setSel] = useState<{ rtId: string; planId: string } | null>(null);
  const [extraQty, setExtraQty] = useState<Record<string, number>>({});
  const [guest, setGuest] = useState({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "", country: "Italia", arrival: "Non lo so", requests: "" });
  const [pay, setPay] = useState<"card" | "transfer" | "paypal">("card");
  const [privacy, setPrivacy] = useState(false);
  const [code, setCode] = useState("");

  const types = roomTypes.filter((rt) => rt.structureId === structureId);
  const availUnits = (rt: RoomType) => units.filter((u) => u.roomTypeId === rt.id && !u.outOfService && !bookings.some((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.unitId === u.id && b.checkIn < checkOut && b.checkOut > checkIn));

  const dayPrice = (rt: RoomType, iso: string, plan: Plan) => {
    const base = effectiveBase(rt, roomTypes);
    const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(base * (isWeekendISO(iso) ? 1 + weekendPct / 100 : 1));
    return Math.max(0, Math.round(raw * (1 + plan.adjPct / 100)));
  };
  const stayPrice = (rt: RoomType, plan: Plan) => { let t = 0; for (let i = 0; i < nights; i++) t += dayPrice(rt, addDays(checkIn, i), plan); return t; };

  const cityTaxAmount = structure?.cityTax ? (structure.cityTaxAmount ?? 2) : 0;
  const cityTaxNights = Math.min(nights, structure?.cityTaxMaxNights ?? 3);
  const cityTax = cityTaxAmount * adults * cityTaxNights;

  const selRt = sel ? types.find((t) => t.id === sel.rtId) : null;
  const selPlan = sel ? plans.find((p) => p.id === sel.planId) ?? plans[0] : null;
  const accommodation = selRt && selPlan ? stayPrice(selRt, selPlan) : 0;
  const extraPrice = (x: ExtraService) => x.per === "night" ? x.price * nights : x.per === "person" ? x.price * adults : x.price;
  const extrasTotal = extras.reduce((a, x) => a + (extraQty[x.id] ?? 0) * extraPrice(x), 0);
  const total = accommodation + extrasTotal + cityTax;
  const depositPct = selPlan && !selPlan.refundable ? 100 : (structure?.depositPct ?? 30);
  const deposit = Math.round(total * depositPct / 100);

  const guestValid = guest.firstName.trim() && guest.lastName.trim() && guest.email.trim() && guest.phone.trim() && privacy;

  const confirm = () => {
    if (!selRt || !guestValid) return;
    const unit = availUnits(selRt)[0];
    const gid = addGuest({ firstName: guest.firstName.trim(), lastName: guest.lastName.trim(), email: guest.email.trim(), phone: guest.phone.trim(), country: guest.country });
    const chosenExtras = extras.filter((x) => (extraQty[x.id] ?? 0) > 0).map((x) => `${extraQty[x.id]}× ${x.name}`);
    const note = [`Sito ufficiale · ${selPlan?.name}`, chosenExtras.length ? `Extra: ${chosenExtras.join(", ")}` : "", guest.arrival !== "Non lo so" ? `Arrivo ~${guest.arrival}` : "", guest.requests.trim()].filter(Boolean).join(" · ");
    addBooking({ structureId, roomTypeId: selRt.id, unitId: unit?.id ?? null, guestId: gid, channel: "direct", status: "confirmed", checkIn, checkOut, adults, children, total: accommodation, cleaningFee: 0, paid: deposit, cityTaxPaid: false, note });
    addActivity("booking", `Prenotazione dal sito — ${guest.firstName} ${guest.lastName}`);
    setCode(`SPG-${new Date().getFullYear()}-${Math.abs([...(gid + checkIn)].reduce((a, c) => a + c.charCodeAt(0), 0)) % 100000}`);
    setStep("done");
    window.scrollTo(0, 0);
  };

  // ---- Header ----
  const header = (
    <div className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? "#4F46E5" }}>{(structure?.name ?? "SS").slice(0, 2).toUpperCase()}</div>
          <div className="leading-tight"><div className="text-sm font-bold text-txt">{structure?.name ?? "Xenora"}</div><div className="text-[11px] text-faint">Sito ufficiale · Prenotazione diretta</div></div>
        </div>
        {structures.length > 1 && step === "rooms" && (
          <select value={structureId} onChange={(e) => { setStructureId(e.target.value); setSel(null); }} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2 rounded-full bg-wash px-3 py-1.5 text-sm"><span className="text-dim">Totale</span><span className="font-mono font-bold text-txt">{eur(total)}</span></div>
      </div>
    </div>
  );

  // ---- Search bar ----
  const searchBar = (
    <div className={`${box} mb-4 p-3`}>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block text-xs font-medium text-dim">Arrivo<input type="date" value={checkIn} min={today} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(addDays(e.target.value, 1)); }} className={`${field} mt-1`} /></label>
        <label className="block text-xs font-medium text-dim">Partenza<input type="date" value={checkOut} min={addDays(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} className={`${field} mt-1`} /></label>
        <label className="block text-xs font-medium text-dim">Adulti<Stepper value={adults} min={1} onChange={setAdults} /></label>
        <label className="block text-xs font-medium text-dim">Bambini<Stepper value={children} min={0} onChange={setChildren} /></label>
      </div>
      <div className="mt-2 text-xs text-dim">{nights} {nights === 1 ? "notte" : "notti"} · {adults} adulti{children ? ` · ${children} bambini` : ""}</div>
    </div>
  );

  if (step === "done") {
    return (
      <div className="min-h-full bg-wash pb-16">
        {header}
        <div className="mx-auto max-w-2xl px-4 py-10">
          <div className={`${box} p-8 text-center`}>
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-white" style={{ backgroundColor: "var(--ok)" }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg></div>
            <h1 className="font-display text-2xl font-bold text-txt">Prenotazione confermata!</h1>
            <p className="mt-1 text-sm text-dim">Grazie {guest.firstName}. Ti abbiamo inviato la conferma a <b className="text-txt">{guest.email}</b>.</p>
            <div className="mx-auto mt-5 max-w-sm rounded-xl border border-line bg-wash p-4 text-left text-sm">
              <div className="flex justify-between"><span className="text-dim">Codice</span><span className="font-mono font-bold text-txt">{code}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-dim">Struttura</span><span className="text-txt">{structure?.name}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-dim">Camera</span><span className="text-txt">{selRt?.name}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-dim">Soggiorno</span><span className="text-txt">{new Date(checkIn).toLocaleDateString("it-IT")} → {new Date(checkOut).toLocaleDateString("it-IT")}</span></div>
              <div className="mt-2 flex justify-between border-t border-line pt-2"><span className="font-semibold text-txt">Totale</span><span className="font-mono font-bold text-txt">{eur(total)}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-dim">Acconto versato</span><span className="font-mono text-txt">{eur(deposit)}</span></div>
              {total - deposit > 0 && <div className="mt-1 flex justify-between"><span className="text-dim">Saldo in struttura</span><span className="font-mono text-txt">{eur(total - deposit)}</span></div>}
            </div>
            <p className="mt-4 text-xs text-faint">La prenotazione è entrata nel gestionale della struttura (calendario, cassa e registro attività).</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-wash pb-16">
      {header}
      <div className="mx-auto max-w-5xl px-4 py-6">
        {step === "rooms" && (
          <>
            <h1 className="mb-3 font-display text-xl font-bold text-txt">Verifica disponibilità</h1>
            {searchBar}
            <div className="flex flex-col gap-3">
              {types.map((rt) => {
                const free = availUnits(rt).length;
                const cheapest = plans.reduce((min, p) => Math.min(min, stayPrice(rt, p)), Infinity);
                const tooSmall = (rt.maxOccupancy ?? rt.beds) < adults + children;
                const noRate = !Number.isFinite(cheapest) || cheapest <= 0; // tariffa non impostata → non vendibile
                return (
                  <div key={rt.id} className={`${box} overflow-hidden`}>
                    <div className="flex flex-col gap-3 p-4 sm:flex-row">
                      {(() => { const cover = getImages(`rt:${rt.id}`)[0]; return cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt={rt.name} className="h-28 w-full shrink-0 rounded-lg object-cover sm:w-40" />
                      ) : (
                        <div className="grid h-28 w-full shrink-0 place-items-center rounded-lg sm:w-40" style={{ background: `linear-gradient(135deg, ${rt.color ?? "#4F46E5"}, color-mix(in srgb, ${rt.color ?? "#4F46E5"} 55%, #000))` }}>
                          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.9"><path d="M3 8v11" /><path d="M3 13h18v6" /><path d="M21 19v-4a3 3 0 0 0-3-3h-7v4" /><circle cx="7" cy="11.5" r="1.4" /></svg>
                        </div>
                      ); })()}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-display text-lg font-bold text-txt">{rt.name}</div>
                            <div className="text-xs text-dim">{rt.beds} letti · fino a {rt.maxOccupancy ?? rt.beds} ospiti{rt.size ? ` · ${rt.size} m²` : ""}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] text-faint">da</div>
                            <div className="font-mono text-xl font-bold text-txt">{noRate ? "—" : eur(cheapest)}</div>
                            <div className="text-[11px] text-faint">{nights} {nights === 1 ? "notte" : "notti"}</div>
                          </div>
                        </div>
                        {(rt.amenities ?? []).length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{(rt.amenities ?? []).slice(0, 6).map((a) => <span key={a} className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-dim">{a}</span>)}</div>}
                        {/* Piani */}
                        {free > 0 && !tooSmall && !noRate ? (
                          <div className="mt-3 flex flex-col gap-1.5">
                            {plans.map((p) => (
                              <div key={p.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                                <div><span className="text-sm font-medium text-txt">{p.name}</span> <span className="text-[11px] text-faint">· {p.board} · {p.refundable ? "cancellazione gratuita" : "non rimborsabile"}</span></div>
                                <div className="flex items-center gap-3">
                                  <span className="font-mono text-sm font-bold text-txt">{eur(stayPrice(rt, p))}</span>
                                  <button onClick={() => { setSel({ rtId: rt.id, planId: p.id }); setStep("checkout"); window.scrollTo(0, 0); }} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Scegli</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 rounded-lg border border-line bg-wash px-3 py-2 text-sm text-dim">{tooSmall ? "Capienza insufficiente per il numero di ospiti." : noRate ? "Tariffa non ancora disponibile per queste date." : "Non disponibile per le date scelte."}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {types.length === 0 && <div className={`${box} p-6 text-center text-sm text-faint`}>Nessuna camera configurata per questa struttura.</div>}
            </div>
          </>
        )}

        {step === "checkout" && selRt && selPlan && (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-4">
              <button onClick={() => setStep("rooms")} className="w-fit text-sm font-medium text-focus hover:underline">← Cambia camera</button>

              {/* Servizi extra */}
              <div className={`${box} p-4`}>
                <h2 className="mb-1 font-display text-lg font-bold text-txt">Servizi extra</h2>
                <p className="mb-3 text-xs text-dim">Migliora il soggiorno aggiungendo i nostri servizi.</p>
                <div className="flex flex-col divide-y divide-[color:var(--line)]">
                  {extras.map((x) => (
                    <div key={x.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-txt">{x.name}</div>
                        {x.desc && <div className="text-[11px] text-faint">{x.desc}</div>}
                        <div className="mt-0.5 text-xs text-dim">{eur(x.price)} {x.per === "night" ? "a notte" : x.per === "person" ? "a persona" : "a soggiorno"}</div>
                      </div>
                      <Stepper value={extraQty[x.id] ?? 0} min={0} compact onChange={(v) => setExtraQty((q) => ({ ...q, [x.id]: v }))} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Dati ospite */}
              <div className={`${box} p-4`}>
                <h2 className="mb-3 font-display text-lg font-bold text-txt">Dettagli ospite</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-dim">Nome *<input value={guest.firstName} onChange={(e) => setGuest({ ...guest, firstName: e.target.value })} className={`${field} mt-1`} /></label>
                  <label className="block text-xs font-medium text-dim">Cognome *<input value={guest.lastName} onChange={(e) => setGuest({ ...guest, lastName: e.target.value })} className={`${field} mt-1`} /></label>
                  <label className="block text-xs font-medium text-dim">Telefono *<input value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} className={`${field} mt-1`} placeholder="+39…" /></label>
                  <label className="block text-xs font-medium text-dim">Email *<input value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} className={`${field} mt-1`} /></label>
                  <label className="block text-xs font-medium text-dim">Città<input value={guest.city} onChange={(e) => setGuest({ ...guest, city: e.target.value })} className={`${field} mt-1`} /></label>
                  <label className="block text-xs font-medium text-dim">Nazione<input value={guest.country} onChange={(e) => setGuest({ ...guest, country: e.target.value })} className={`${field} mt-1`} /></label>
                </div>
                <label className="mt-3 block text-xs font-medium text-dim">Orario di arrivo previsto<select value={guest.arrival} onChange={(e) => setGuest({ ...guest, arrival: e.target.value })} className={`${field} mt-1`}>{["Non lo so", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00", "dopo le 20:00"].map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
                <label className="mt-3 block text-xs font-medium text-dim">Richieste speciali<textarea value={guest.requests} onChange={(e) => setGuest({ ...guest, requests: e.target.value })} rows={2} className={`${field} mt-1 resize-y`} placeholder="Le richieste non sono garantite ma faremo il possibile." /></label>
              </div>

              {/* Pagamento */}
              <div className={`${box} p-4`}>
                <h2 className="mb-3 font-display text-lg font-bold text-txt">Modalità di pagamento</h2>
                <div className="grid grid-cols-3 gap-2">
                  {([["card", "Carta di credito"], ["transfer", "Bonifico"], ["paypal", "PayPal"]] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setPay(k)} className={`rounded-lg border p-3 text-center text-sm font-medium transition ${pay === k ? "border-focus ring-1 ring-[color:var(--focus)] text-txt" : "border-line text-dim hover:bg-wash"}`}>{label}</button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-dim">Per confermare è richiesto un acconto di <b className="text-txt">{eur(deposit)}</b>{selPlan.refundable ? "" : " (intero importo, tariffa non rimborsabile)"}. Il saldo si versa in struttura. Nessun dato di pagamento viene raccolto in questa demo.</p>
                <label className="mt-3 flex items-start gap-2 text-xs text-dim"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[color:var(--focus)]" /> Dichiaro di aver preso visione dell'informativa privacy e accetto i termini di prenotazione.</label>
              </div>
            </div>

            {/* Riepilogo */}
            <div className="lg:sticky lg:top-20 lg:self-start">
              <div className={`${box} p-4`}>
                <div className="mb-2 text-sm font-semibold text-txt">{new Date(checkIn).toLocaleDateString("it-IT")} → {new Date(checkOut).toLocaleDateString("it-IT")}</div>
                <div className="text-xs text-dim">{nights} {nights === 1 ? "notte" : "notti"} · {adults} adulti{children ? ` · ${children} bambini` : ""}</div>
                <div className="my-3 border-t border-line" />
                <Line label={`${selRt.name} · ${selPlan.name}`} value={eur(accommodation)} />
                {extras.filter((x) => (extraQty[x.id] ?? 0) > 0).map((x) => <Line key={x.id} label={`${extraQty[x.id]}× ${x.name}`} value={eur((extraQty[x.id] ?? 0) * extraPrice(x))} sub />)}
                {cityTax > 0 && <Line label={`Tassa di soggiorno (${adults}×${cityTaxNights})`} value={eur(cityTax)} sub />}
                <div className="my-2 border-t border-line" />
                <div className="flex items-baseline justify-between"><span className="text-sm font-semibold text-txt">Totale</span><span className="font-mono text-xl font-bold text-txt">{eur(total)}</span></div>
                <div className="mt-1 flex items-baseline justify-between text-xs"><span className="text-dim">Acconto adesso</span><span className="font-mono font-semibold text-txt">{eur(deposit)}</span></div>
                <div className="mt-1 text-[11px]" style={{ color: selPlan.refundable ? "var(--ok)" : "var(--warn)" }}>{selPlan.refundable ? "Nessun costo se cancelli" : "Tariffa non rimborsabile"}</div>
                <button onClick={confirm} disabled={!guestValid} className="mt-3 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">Conferma prenotazione</button>
                {!guestValid && <div className="mt-2 text-center text-[11px] text-faint">Compila nome, cognome, telefono, email e accetta la privacy.</div>}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="mx-auto max-w-5xl px-4 text-center text-[11px] text-faint">{structure?.name ?? "Xenora"} · Prenotazione online sicura powered by <b>Xenora</b></div>
    </div>
  );
}

function Stepper({ value, min = 0, onChange, compact }: { value: number; min?: number; onChange: (v: number) => void; compact?: boolean }) {
  return (
    <div className={`mt-1 flex items-center ${compact ? "" : "w-full"} overflow-hidden rounded-lg border border-line`}>
      <button onClick={() => onChange(Math.max(min, value - 1))} className="px-3 py-1.5 text-dim hover:bg-wash">−</button>
      <span className={`${compact ? "w-8" : "flex-1"} bg-paper py-1.5 text-center font-mono text-sm text-txt`}>{value}</span>
      <button onClick={() => onChange(value + 1)} className="px-3 py-1.5 text-dim hover:bg-wash">+</button>
    </div>
  );
}
function Line({ label, value, sub }: { label: string; value: string; sub?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-3 ${sub ? "mt-1 text-xs text-dim" : "text-sm text-txt"}`}><span className="min-w-0">{label}</span><span className={`shrink-0 font-mono ${sub ? "" : "font-semibold"}`}>{value}</span></div>;
}
