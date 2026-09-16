"use client";

import { useEffect, useMemo, useState } from "react";
import { DataProvider, useData } from "@/lib/store";
import type { RoomType, ExtraService } from "@/lib/types";
import { DEFAULT_EXTRAS } from "@/lib/types";
import { getImages } from "@/lib/images";
import { eur } from "@/lib/format";
import { effectiveBase, effectiveClosed } from "@/lib/pricing";
import { loadPlans, planApplies, planDepositPct, cancelText, type RatePlan } from "@/lib/rate-plans";
import { amenityIcon } from "@/lib/amenities";
import { loadPromos } from "@/lib/promos";
import { loadPublicSite, lsGet, isPublicMode, publicSlug } from "@/lib/publicdata";

// ---- pricing helpers --------------------------------------------------------
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return toISO(d); };
const nightsBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
const isWeekendISO = (iso: string) => { const day = new Date(iso).getDay(); return day === 5 || day === 6 || day === 0; };

type Plan = RatePlan;
const DEFAULT_PLANS: Plan[] = [
  { id: "flex", name: "Flessibile", adjPct: 0, refundable: true, board: "Colazione", minStay: 1, cancelDays: 3, deposit: "none" },
  { id: "nonref", name: "Non rimborsabile", adjPct: -10, refundable: false, board: "Colazione", minStay: 1, deposit: "prepaid" },
  { id: "long", name: "Lunga permanenza", adjPct: -12, refundable: true, board: "Colazione", minStay: 5, cancelDays: 7, deposit: "deposit", depositPct: 30 },
];

const box = "rounded-xl border border-line bg-surface";
const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

export default function PrenotaPage() {
  // Se si arriva da un Xenosite pubblico (xenora.it/<slug> → ?site=<slug>), carica
  // i dati pubblicati dal server prima di montare lo store.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let slug: string | null = null;
    try { slug = new URLSearchParams(window.location.search).get("site"); } catch {}
    if (slug) loadPublicSite(slug).finally(() => setReady(true));
    else setReady(true);
  }, []);
  if (!ready) return null;
  return <DataProvider><Engine /></DataProvider>;
}

function Engine() {
  const { structures, roomTypes, units, bookings, guests, rateOverrides, addGuest, updateGuest, addBooking, addActivity, getStructure } = useData();

  // Config salvata (piani, weekend) — fallback ai default.
  const plans = useMemo<Plan[]>(() => { const p = loadPlans(); return p.length ? p : DEFAULT_PLANS; }, []);
  const weekendPct = useMemo(() => { try { const r = lsGet("spigolestay:pricerules"); if (r) return JSON.parse(r).weekendPct ?? 25; } catch {} return 25; }, []);
  const promos = useMemo(() => { try { return loadPromos(); } catch { return []; } }, []);

  const qp = (k: string) => { try { return new URLSearchParams(window.location.search).get(k); } catch { return null; } };
  const [structureId, setStructureId] = useState(() => qp("s") || structures[0]?.id || "");
  const structure = getStructure(structureId);
  const extras: ExtraService[] = (structure?.extras && structure.extras.length ? structure.extras : DEFAULT_EXTRAS).filter((e) => e.active !== false);

  const today = toISO(new Date());
  const [checkIn, setCheckIn] = useState(() => qp("ci") || addDays(today, 7));
  const [checkOut, setCheckOut] = useState(() => qp("co") || addDays(today, 8));
  const [adults, setAdults] = useState(() => Number(qp("ad")) || 2);
  const [children, setChildren] = useState(() => Number(qp("ch")) || 0);
  const [childAges, setChildAges] = useState<number[]>(() => {
    const n = Number(qp("ch")) || 0;
    const raw = (qp("ages") || "").split(",").map((x) => Number(x)).filter((x) => !isNaN(x));
    return Array.from({ length: n }, (_, i) => (raw[i] ?? 8));
  });
  const [wantsCot, setWantsCot] = useState(() => qp("cot") === "1");
  const setChildrenN = (n: number) => { setChildren(n); if (n === 0) setWantsCot(false); setChildAges((prev) => { const next = prev.slice(0, n); while (next.length < n) next.push(8); return next; }); };
  const nights = nightsBetween(checkIn, checkOut);

  const [step, setStep] = useState<"rooms" | "checkout" | "done">("rooms");
  const [sel, setSel] = useState<{ rtId: string; planId: string } | null>(null);
  const [extraQty, setExtraQty] = useState<Record<string, number>>({});
  const [guest, setGuest] = useState({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "", country: "Italia", arrival: "Non lo so", requests: "" });
  const [pay, setPay] = useState<"card" | "transfer" | "paypal">("card");
  const [privacy, setPrivacy] = useState(false);
  const [code, setCode] = useState("");
  // Codice sconto / promo
  const [promoInput, setPromoInput] = useState(() => (qp("promo") || "").toUpperCase());
  const [appliedPromo, setAppliedPromo] = useState<{ name?: string; code: string; pct: number } | null>(null);
  const [promoErr, setPromoErr] = useState("");
  const applyPromoCode = (raw?: string) => {
    const c = (raw ?? promoInput).trim().toUpperCase();
    setPromoErr("");
    if (!c) { setAppliedPromo(null); return; }
    const p = promos.find((x) => (x.code || "").toUpperCase() === c && !!x.discountPct);
    if (!p) { setAppliedPromo(null); setPromoErr("Codice non valido."); return; }
    if (p.validUntil && today > p.validUntil) { setAppliedPromo(null); setPromoErr("Offerta scaduta."); return; }
    if (p.validFrom && checkIn < p.validFrom) { setAppliedPromo(null); setPromoErr(`Valida per soggiorni dal ${new Date(p.validFrom).toLocaleDateString("it-IT")}.`); return; }
    if (p.validTo && checkIn > p.validTo) { setAppliedPromo(null); setPromoErr(`Valida per soggiorni fino al ${new Date(p.validTo).toLocaleDateString("it-IT")}.`); return; }
    setAppliedPromo({ name: p.name, code: (p.code || "").toUpperCase(), pct: p.discountPct! });
  };
  // Applica automaticamente il codice arrivato dall'offerta (?promo=).
  useEffect(() => { const c = (qp("promo") || "").trim(); if (c && promos.length) applyPromoCode(c); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [promos.length]);

  const types = roomTypes.filter((rt) => rt.structureId === structureId && !effectiveClosed(rt, roomTypes));
  const availUnits = (rt: RoomType) => units.filter((u) => u.roomTypeId === rt.id && !u.outOfService && !bookings.some((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.unitId === u.id && b.checkIn < checkOut && b.checkOut > checkIn));
  // Le tariffe derivate condividono le camere fisiche della tipologia madre: risalgo alla radice per la disponibilità.
  const rootType = (rt: RoomType): RoomType => { let cur = rt; const seen = new Set<string>(); while (cur.deriveFrom && !seen.has(cur.id)) { seen.add(cur.id); const p = roomTypes.find((x) => x.id === cur.deriveFrom); if (!p) break; cur = p; } return cur; };
  const availUnitsFor = (rt: RoomType) => availUnits(rootType(rt));
  const descendantsOf = (id: string): RoomType[] => { const out: RoomType[] = []; const walk = (pid: string) => types.filter((x) => x.deriveFrom === pid).forEach((c) => { out.push(c); walk(c.id); }); walk(id); return out; };
  // Solo le tipologie "madre" fanno da camera nel mini-sito; le derivate compaiono come opzioni sotto la madre.
  const masters = types.filter((rt) => !rt.deriveFrom || !types.some((x) => x.id === rt.deriveFrom));

  const dayPrice = (rt: RoomType, iso: string, plan: Plan) => {
    const base = effectiveBase(rt, roomTypes);
    const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(base * (isWeekendISO(iso) ? 1 + weekendPct / 100 : 1));
    return Math.max(0, Math.round(raw * (1 + plan.adjPct / 100)));
  };
  const stayPrice = (rt: RoomType, plan: Plan) => { let t = 0; for (let i = 0; i < nights; i++) t += dayPrice(rt, addDays(checkIn, i), plan); return t; };

  const selRt = sel ? types.find((t) => t.id === sel.rtId) : null;
  const selPlan = sel ? plans.find((p) => p.id === sel.planId) ?? plans[0] : null;
  const accommodation = selRt && selPlan ? stayPrice(selRt, selPlan) : 0;
  const extraPrice = (x: ExtraService) => x.per === "night" ? x.price * nights : x.per === "person" ? x.price * adults : x.price;
  const extrasTotal = extras.reduce((a, x) => a + (extraQty[x.id] ?? 0) * extraPrice(x), 0);
  // Tassa di soggiorno: 0 finché non è selezionata una camera; poi fissa (€/persona/notte) o % del soggiorno.
  const cityTaxNights = Math.min(nights, structure?.cityTaxMaxNights ?? 3);
  const cityTax = (selRt && structure?.cityTax)
    ? (structure.cityTaxMode === "percent"
        ? Math.round(accommodation * (structure.cityTaxPercent ?? 0) / 100)
        : (structure.cityTaxAmount ?? 2) * adults * cityTaxNights)
    : 0;
  const discount = appliedPromo ? Math.round(accommodation * appliedPromo.pct / 100) : 0;
  const total = accommodation + extrasTotal + cityTax - discount;
  const depositPct = selPlan ? planDepositPct(selPlan) : 0; // acconto secondo la politica di incasso del piano
  const deposit = Math.round(total * depositPct / 100);

  const guestValid = guest.firstName.trim() && guest.lastName.trim() && guest.email.trim() && guest.phone.trim() && privacy;

  const confirm = () => {
    if (!selRt || !guestValid) return;
    const unit = availUnitsFor(selRt)[0]; // le derivate usano le camere della tipologia madre
    // Evita doppioni in anagrafica: riusa l'ospite esistente (stessa email, o stesso nome con telefono compatibile).
    const norm = (s?: string) => (s ?? "").trim().toLowerCase();
    const full = `${guest.firstName.trim()} ${guest.lastName.trim()}`.trim();
    const found = guests.find((g) => {
      if (norm(guest.email) && norm(g.email) === norm(guest.email)) return true;
      if (norm(full) && norm(g.fullName) === norm(full) && (!norm(g.phone) || !norm(guest.phone) || norm(g.phone) === norm(guest.phone))) return true;
      return false;
    });
    let gid: string;
    if (found) {
      gid = found.id;
      updateGuest(found.id, { firstName: found.firstName || guest.firstName.trim(), lastName: found.lastName || guest.lastName.trim(), fullName: found.fullName || full, email: found.email || guest.email.trim() || undefined, phone: found.phone || guest.phone.trim() || undefined, country: found.country || guest.country });
    } else {
      gid = addGuest({ firstName: guest.firstName.trim(), lastName: guest.lastName.trim(), email: guest.email.trim(), phone: guest.phone.trim(), country: guest.country });
    }
    const chosenExtras = extras.filter((x) => (extraQty[x.id] ?? 0) > 0).map((x) => `${extraQty[x.id]}× ${x.name}`);
    const note = [`Sito diretto · ${selPlan?.name}`, appliedPromo ? `Promo ${appliedPromo.code} (−${appliedPromo.pct}%)` : "", chosenExtras.length ? `Extra: ${chosenExtras.join(", ")}` : "", wantsCot ? "🍼 Culla richiesta" : "", guest.arrival !== "Non lo so" ? `Arrivo ~${guest.arrival}` : "", guest.requests.trim()].filter(Boolean).join(" · ");
    // Sito PUBBLICO: la prenotazione non sta nel browser del visitatore ma va
    // inviata al server, che la scrive nel calendario del proprietario.
    if (isPublicMode() && publicSlug()) {
      const token = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
      fetch("/api/public-booking", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: publicSlug(), token, rt: selRt.id, ci: checkIn, co: checkOut,
          adults, children, childAges, total: accommodation, deposit, note,
          guest: { firstName: guest.firstName.trim(), lastName: guest.lastName.trim(), email: guest.email.trim(), phone: guest.phone.trim(), country: guest.country },
        }),
      }).catch(() => {});
    } else {
      addBooking({ structureId, roomTypeId: selRt.id, unitId: unit?.id ?? null, guestId: gid, channel: "direct", status: "confirmed", checkIn, checkOut, adults, children, childAges: childAges.length ? childAges : undefined, total: accommodation, cleaningFee: 0, paid: deposit, cityTaxPaid: false, note });
      addActivity("booking", `Prenotazione dal sito — ${guest.firstName} ${guest.lastName}`);
    }
    setCode(`SPG-${new Date().getFullYear()}-${Math.abs([...(gid + checkIn)].reduce((a, c) => a + c.charCodeAt(0), 0)) % 100000}`);
    setStep("done");
    window.scrollTo(0, 0);
  };

  // Riepilogo prenotazione (per email e PDF).
  const bookingLines = () => ([
    ["Codice prenotazione", code],
    ["Struttura", structure?.name ?? ""],
    ["Camera", `${selRt?.name ?? ""}${selPlan ? " · " + selPlan.name : ""}`],
    ["Ospite", `${guest.firstName} ${guest.lastName}`.trim()],
    ["Check-in", new Date(checkIn).toLocaleDateString("it-IT")],
    ["Check-out", new Date(checkOut).toLocaleDateString("it-IT")],
    ["Ospiti", `${adults} adulti${children ? ` · ${children} bambini` : ""}`],
    ["Totale", eur(total)],
    ["Acconto versato", eur(deposit)],
    ["Saldo in struttura", eur(Math.max(0, total - deposit))],
  ] as [string, string][]);

  const emailConfirm = () => {
    const body = [`Ciao ${guest.firstName},`, "", "grazie per la tua prenotazione. Ecco il riepilogo:", "", ...bookingLines().map(([k, v]) => `${k}: ${v}`), "", `A presto,`, structure?.name ?? "Xenora"].join("\n");
    window.open(`mailto:${encodeURIComponent(guest.email)}?subject=${encodeURIComponent(`Conferma prenotazione ${code} · ${structure?.name ?? ""}`)}&body=${encodeURIComponent(body)}`);
  };
  const printPdf = () => {
    const w = window.open("", "_blank", "width=820,height=940");
    if (!w) return;
    const rows = bookingLines().map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`).join("");
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Prenotazione ${code}</title>
      <style>*{box-sizing:border-box}body{font-family:Georgia,'Times New Roman',serif;color:#1a2131;margin:0;padding:48px 54px;font-size:14px;line-height:1.55}
      .brand{font-size:24px;font-weight:700;color:#4f46e5;border-bottom:3px solid #4f46e5;padding-bottom:14px;margin-bottom:24px}
      h1{font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#5c6479;margin:0 0 16px}
      table{width:100%;border-collapse:collapse}td{padding:10px 4px;border-bottom:1px solid #e3e6ef}td.k{color:#5c6479}td.v{text-align:right;font-weight:600}
      .note{margin-top:28px;font-size:11px;color:#9aa2b6;border-top:1px solid #e3e6ef;padding-top:14px}
      @media print{body{padding:24px 30px}}</style></head><body>
      <div class="brand">${structure?.name ?? "Xenora"}</div>
      <h1>Conferma di prenotazione</h1>
      <table>${rows}</table>
      <div class="note">Documento di riepilogo prenotazione. Prenotazione diretta · Xenora.</div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  };

  // ---- Header ----
  const header = (
    <div className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
        <a href={`/sito-web?s=${structureId}`} className="flex items-center gap-2 rounded-lg transition hover:opacity-80" title="Torna alla home">
          <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg text-sm font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? "#4F46E5" }}>{structure?.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={structure.logo} alt="" className="h-full w-full object-cover" /> : (structure?.name ?? "SS").slice(0, 2).toUpperCase()}</div>
          <div className="leading-tight"><div className="text-sm font-bold text-txt">{structure?.name ?? "Xenora"}</div><div className="text-[11px] text-faint">← Torna alla home</div></div>
        </a>
        {structures.length > 1 && step === "rooms" && (
          <select value={structureId} onChange={(e) => { setStructureId(e.target.value); setSel(null); }} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2 rounded-full bg-wash px-3 py-1.5 text-sm"><span className="text-dim">Totale</span><span className="font-mono font-bold text-txt">{eur(total)}</span></div>
      </div>
    </div>
  );

  // ---- Footer ----
  const footer = (
    <footer className="mt-12 border-t border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a href={`/sito-web?s=${structureId}`} className="flex items-center gap-2 text-sm font-bold text-txt hover:opacity-80">
            <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md text-xs font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? "#4F46E5" }}>{structure?.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={structure.logo} alt="" className="h-full w-full object-cover" /> : (structure?.name ?? "SS").slice(0, 2).toUpperCase()}</span>
            {structure?.name ?? "Xenora"}
          </a>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-faint">
            {structure?.email && <a href={`mailto:${structure.email}`} className="hover:text-dim">{structure.email}</a>}
            {structure?.phone && <a href={`tel:${structure.phone}`} className="hover:text-dim">{structure.phone}</a>}
            {structure?.cin && <span>CIN {structure.cin}</span>}
            <div className="flex items-center gap-2">
              {structure?.phone && <a href={`https://wa.me/${structure.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" title="WhatsApp" className="grid h-7 w-7 place-items-center rounded-full bg-wash" style={{ color: "#25D366" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-2 .9-2.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.6-.3.3c-.2.2-.3.3-.1.6.2.3.9 1.4 1.9 2.3 1.3 1.1 2.3 1.5 2.6 1.6.3.1.5.1.7-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.1.1.5-.1 1Z" /></svg></a>}
              {structure?.instagram && <a href={structure.instagram.startsWith("http") ? structure.instagram : `https://instagram.com/${structure.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer" title="Instagram" className="grid h-7 w-7 place-items-center rounded-full bg-wash" style={{ color: "#C13584" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg></a>}
              {structure?.facebook && <a href={structure.facebook.startsWith("http") ? structure.facebook : `https://facebook.com/${structure.facebook}`} target="_blank" rel="noreferrer" title="Facebook" className="grid h-7 w-7 place-items-center rounded-full bg-wash" style={{ color: "#1877F2" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" /></svg></a>}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[11px] text-faint">
          <span>© {new Date().getFullYear()} {structure?.name ?? "Xenora"}. Tutti i diritti riservati.</span>
          <span>Sito creato dal gruppo <b className="text-dim">Xenora</b> · Prenotazione online sicura</span>
        </div>
      </div>
    </footer>
  );

  // ---- Search bar ----
  const searchBar = (
    <div className={`${box} mb-4 p-3`}>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block text-xs font-medium text-dim">Arrivo<input type="date" value={checkIn} min={today} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(addDays(e.target.value, 1)); }} className={`${field} mt-1`} /></label>
        <label className="block text-xs font-medium text-dim">Partenza<input type="date" value={checkOut} min={addDays(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} className={`${field} mt-1`} /></label>
        <label className="block text-xs font-medium text-dim">Adulti<Stepper value={adults} min={1} onChange={setAdults} /></label>
        <label className="block text-xs font-medium text-dim">Bambini<Stepper value={children} min={0} onChange={setChildrenN} /></label>
      </div>
      {children > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] font-medium text-dim">Età dei bambini <span className="text-faint">(per la tassa di soggiorno e la sistemazione)</span></div>
          <div className="flex flex-wrap gap-2">
            {childAges.map((age, i) => (
              <label key={i} className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-dim">Bimbo {i + 1}
                <input type="number" min={0} max={17} value={age} onChange={(e) => setChildAges((prev) => prev.map((a, j) => (j === i ? Math.max(0, Math.min(17, Number(e.target.value))) : a)))} className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-sm text-txt outline-none focus:border-focus" />
              </label>
            ))}
          </div>
          <label className="mt-2 flex w-fit items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs font-medium text-txt">
            <input type="checkbox" checked={wantsCot} onChange={(e) => setWantsCot(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> Culla per il bimbo <span className="font-normal text-faint">(gratuita, su richiesta)</span>
          </label>
        </div>
      )}
      <div className="mt-2 text-xs text-dim">{nights} {nights === 1 ? "notte" : "notti"} · {adults} adulti{children ? ` · ${children} bambini` : ""}</div>
    </div>
  );

  if (step === "done") {
    return (
      <div className="flex min-h-full flex-col bg-wash">
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
              {deposit > 0 && <div className="mt-1 flex justify-between"><span className="text-dim">Acconto versato</span><span className="font-mono text-txt">{eur(deposit)}</span></div>}
              {total - deposit > 0 && <div className="mt-1 flex justify-between"><span className="text-dim">Saldo in struttura</span><span className="font-mono text-txt">{eur(total - deposit)}</span></div>}
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button onClick={printPdf} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: structure?.photoColor ?? "#4F46E5" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg> Scarica PDF</button>
              <button onClick={emailConfirm} className="flex items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg> Ricevi via email</button>
            </div>
            <p className="mt-4 text-xs text-faint">Ti abbiamo inviato la conferma via email. Puoi anche scaricare il PDF con tutti i dettagli. La prenotazione è entrata nel gestionale della struttura (calendario, cassa e registro attività).</p>
          </div>
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-wash">
      {header}
      <div className="mx-auto max-w-7xl px-4 py-6">
        {step === "rooms" && (
          <>
            <h1 className="mb-3 font-display text-xl font-bold text-txt">Verifica disponibilità</h1>
            {searchBar}
            <div className={`${box} mb-3 flex flex-wrap items-center gap-2 p-3`}>
              <span className="text-sm font-medium text-dim">Hai un codice sconto?</span>
              <input value={promoInput} onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoErr(""); }} placeholder="CODICE" className="w-40 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm uppercase text-txt outline-none focus:border-focus" />
              <button onClick={() => applyPromoCode()} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-focus hover:bg-wash">Applica</button>
              {appliedPromo && <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--ok)" }}>✓ {appliedPromo.name || appliedPromo.code} · −{appliedPromo.pct}%<button onClick={() => { setAppliedPromo(null); setPromoInput(""); }} className="text-xs font-normal text-faint hover:text-[color:var(--err)]">rimuovi</button></span>}
              {promoErr && <span className="text-sm text-[color:var(--err)]">{promoErr}</span>}
            </div>
            <div className="flex flex-col gap-3">
              {masters.map((rt) => {
                const free = availUnitsFor(rt).length;
                const pax = adults + children;
                // Varianti = madre + tariffe derivate; ognuna con i suoi piani applicabili.
                const variants = [rt, ...descendantsOf(rt.id)].map((v) => ({
                  v,
                  fits: (v.maxOccupancy ?? v.beds) >= pax,
                  offers: plans.filter((p) => planApplies(p, { roomTypeId: v.id, checkIn, nights })).map((p) => ({ p, price: stayPrice(v, p) })).filter((x) => x.price > 0),
                })).filter((x) => x.offers.length > 0);
                const sellable = variants.filter((x) => x.fits);
                const hasDeriv = variants.length > 1;
                const cheapest = sellable.reduce((min, x) => Math.min(min, ...x.offers.map((o) => o.price)), Infinity);
                const tooSmall = variants.length > 0 && sellable.length === 0; // esistono tariffe ma nessuna adatta agli ospiti
                const noRate = variants.length === 0;
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
                            {(rt.amenities ?? []).length > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-2 text-dim">{(rt.amenities ?? []).slice(0, 8).map((a) => <span key={a} title={a} aria-label={a}>{amenityIcon(a)}</span>)}</div>}
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] text-faint">da</div>
                            <div className="font-mono text-xl font-bold text-txt">{Number.isFinite(cheapest) ? eur(cheapest) : "—"}</div>
                            <div className="text-[11px] text-faint">{nights} {nights === 1 ? "notte" : "notti"}</div>
                          </div>
                        </div>
                        {/* Opzioni: varianti (madre + derivate) × piani */}
                        {free > 0 && !tooSmall && !noRate ? (
                          <div className="mt-3 flex flex-col gap-2.5">
                            {sellable.map(({ v, offers }) => (
                              <div key={v.id} className="overflow-hidden rounded-lg border border-line">
                                {hasDeriv && (
                                  <div className="flex items-center justify-between gap-2 bg-wash px-3 py-1.5">
                                    <span className="text-xs font-semibold text-txt">{v.deriveFrom ? v.name : "Standard"} <span className="font-normal text-faint">· fino a {v.maxOccupancy ?? v.beds} ospiti</span></span>
                                    {v.deriveFrom && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>variante</span>}
                                  </div>
                                )}
                                <div className="flex flex-col divide-y divide-[color:var(--line)]">
                                  {offers.map(({ p, price }) => (
                                    <div key={p.id} className="flex items-center justify-between px-3 py-2">
                                      <div><span className="text-sm font-medium text-txt">{p.name}</span> <span className="text-[11px] text-faint">· {p.board} · {cancelText(p)}{planDepositPct(p) === 0 ? " · nessun anticipo" : planDepositPct(p) === 100 ? " · prepagato" : ` · acconto ${planDepositPct(p)}%`}</span></div>
                                      <div className="flex items-center gap-3">
                                        <span className="font-mono text-sm font-bold text-txt">{eur(price)}</span>
                                        <button onClick={() => { setSel({ rtId: v.id, planId: p.id }); setStep("checkout"); window.scrollTo(0, 0); }} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Scegli</button>
                                      </div>
                                    </div>
                                  ))}
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
          <div>
            <button onClick={() => setStep("rooms")} className="mb-3 text-sm font-medium text-focus hover:underline">← Cambia camera</button>
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-4">

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
                        <div className="mt-0.5 text-xs text-dim">{eur(x.price)} {x.per === "night" ? "a notte" : x.per === "person" ? "a persona" : x.per === "day" ? "a giornata" : "a soggiorno"}</div>
                      </div>
                      <Stepper value={extraQty[x.id] ?? 0} min={0} compact onChange={(v) => setExtraQty((q) => ({ ...q, [x.id]: v }))} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Pagamento */}
              <div className={`${box} p-4`}>
                <h2 className="mb-3 font-display text-lg font-bold text-txt">Modalità di pagamento</h2>
                <div className="grid grid-cols-3 gap-2">
                  {([["card", "Carta di credito"], ["transfer", "Bonifico"], ["paypal", "PayPal"]] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setPay(k)} className={`rounded-lg border p-3 text-center text-sm font-medium transition ${pay === k ? "border-focus ring-1 ring-[color:var(--focus)] text-txt" : "border-line text-dim hover:bg-wash"}`}>{label}</button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-dim">{deposit > 0 ? <>Per confermare è richiesto un acconto di <b className="text-txt">{eur(deposit)}</b>{selPlan.refundable ? "" : " (intero importo, tariffa non rimborsabile)"}. Il saldo si versa in struttura.</> : <>Nessun acconto richiesto: l&apos;intero importo si salda in struttura.</>} Nessun dato di pagamento viene raccolto in questa demo.</p>
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
                {cityTax > 0 && <Line label={structure?.cityTaxMode === "percent" ? `Tassa di soggiorno (${structure.cityTaxPercent ?? 0}%)` : `Tassa di soggiorno (${adults}×${cityTaxNights})`} value={eur(cityTax)} sub />}
                {discount > 0 && <div className="mt-1 flex items-baseline justify-between gap-3 text-xs" style={{ color: "var(--ok)" }}><span className="min-w-0">Sconto{appliedPromo?.code ? ` ${appliedPromo.code}` : ""} (−{appliedPromo?.pct}%)</span><span className="shrink-0 font-mono">−{eur(discount)}</span></div>}
                <div className="my-2 border-t border-line" />
                <div className="flex items-baseline justify-between"><span className="text-sm font-semibold text-txt">Totale</span><span className="font-mono text-xl font-bold text-txt">{eur(total)}</span></div>
                {deposit > 0 && <div className="mt-1 flex items-baseline justify-between text-xs"><span className="text-dim">Acconto adesso</span><span className="font-mono font-semibold text-txt">{eur(deposit)}</span></div>}
                <div className="mt-1 text-[11px]" style={{ color: selPlan.refundable ? "var(--ok)" : "var(--warn)" }}>{cancelText(selPlan)}</div>
                <button onClick={confirm} disabled={!guestValid} className="mt-3 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">Conferma prenotazione</button>
                {!guestValid && <div className="mt-2 text-center text-[11px] text-faint">Compila nome, cognome, telefono, email e accetta la privacy.</div>}
              </div>
            </div>
          </div>
          </div>
        )}
      </div>
      {footer}
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
