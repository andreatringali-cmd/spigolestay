"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [mode, setMode] = useState<"prenotazione" | "preventivo">("prenotazione");
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
  const [parkingPrice, setParkingPrice] = useState("");
  const [deposit, setDeposit] = useState("");
  const [note, setNote] = useState("");
  const [sendConfirm, setSendConfirm] = useState(true);
  const [err, setErr] = useState("");

  const nightsN = Math.max(1, nights(checkIn, checkOut));
  const party = adults + children;

  // Le tariffe derivate (es. "Matrimoniale uso singola") non hanno camere proprie: condividono
  // il pool della tipologia madre. Risalgo alla tipologia che possiede le camere fisiche.
  const poolRootId = (rt: RoomType): string => {
    let cur: RoomType | undefined = rt; const seen = new Set<string>();
    while (cur?.deriveFrom && cur?.deriveInherit && !seen.has(cur.id)) { seen.add(cur.id); const p = roomTypes.find((x) => x.id === cur!.deriveFrom); if (!p) break; cur = p; }
    return cur?.id ?? rt.id;
  };
  // Camere fisiche libere del pool per le date scelte (stessa logica del calendario):
  // esclude fuori servizio permanenti e camere con prenotazione/blocco sovrapposto. Le cancellate non contano.
  const availUnits = (rt: RoomType) => { const root = poolRootId(rt); return units.filter((u) => u.roomTypeId === root && !u.outOfService && !bookings.some((b) => b.status !== "cancelled" && b.unitId === u.id && b.checkIn < checkOut && b.checkOut > checkIn)); };
  // Totale camere reali del pool (fuori servizio permanenti escluse): serve a mostrare "libere su totale".
  const unitsOfType = (rt: RoomType) => { const root = poolRootId(rt); return units.filter((u) => u.roomTypeId === root && !u.outOfService).length; };
  const dayPrice = (rt: RoomType, iso: string) => { const base = effBase(rt, roomTypes); const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(base * (isWeekend(iso) ? 1 + weekendPct / 100 : 1)); return Math.max(0, Math.round(raw)); };
  const stayPrice = (rt: RoomType) => { let s = 0; for (let i = 0; i < nightsN; i++) s += dayPrice(rt, shiftISO(checkIn, i)); return s; };
  const cap = (rt: RoomType) => rt.maxOccupancy ?? rt.beds ?? 2;
  const linePrice = (rt: RoomType) => priceOv[rt.id] ?? stayPrice(rt);
  const setQ = (rtId: string, n: number) => setQty((q) => ({ ...q, [rtId]: Math.max(0, n) }));

  // Se in alto è selezionata una struttura (locked), i risultati la rispettano sempre, a prescindere dal filtro interno.
  const effFilter = locked ? activeStructureId : structFilter;
  const orderedStructs = effFilter === "all" ? structures : structures.filter((s) => s.id === effFilter);
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
  // Parcheggio: 0 = incluso, >0 = voce a pagamento che entra nel voucher.
  const parkingPriceN = parking ? Math.max(0, Number(parkingPrice) || 0) : 0;
  // Extra salvati sulla prenotazione: servizi scelti + parcheggio se a pagamento.
  const bookingExtras = [...chosenExtras, ...(parkingPriceN > 0 ? [{ name: "Parcheggio", price: parkingPriceN }] : [])];
  // Tassa di soggiorno e totale finale del voucher (camere + extra + parcheggio + tassa).
  const taxStruct = getStructure(selected[0]?.structureId);
  const cityTax = cityTaxOf(taxStruct, adults, nightsN, grandTotal);
  const grandFinal = grandWithExtras + parkingPriceN + cityTax;

  const doSearch = () => {
    if (checkOut <= checkIn) { setErr("Il check-out deve essere dopo il check-in"); return; }
    setErr("");
    // In modalità Preventivo la disponibilità verificata porta alla pagina Preventivi (con i dati precompilati).
    if (mode === "preventivo") {
      const p = new URLSearchParams({ ci: checkIn, co: checkOut, ad: String(adults), ch: String(children) });
      if (effFilter !== "all") p.set("s", effFilter);
      router.push(`/preventivi?${p.toString()}`);
      return;
    }
    setPhase("rooms");
  };

  const confirm = () => {
    if (totalRooms < 1) { setErr("Seleziona almeno una camera"); return; }
    if (!lastName.trim() && !firstName.trim()) { setErr("Inserisci nome o cognome dell'ospite"); return; }
    const guestId = addGuest({ lastName: lastName.trim() || undefined, firstName: firstName.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined });
    const groupId = isGroup ? ((typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())) : undefined;
    const flat: { rt: RoomType; unitId: string | null }[] = [];
    const usedUnitIds = new Set<string>(); // evita di assegnare la stessa camera fisica a madre e derivata
    selected.forEach((rt) => { const free = availUnits(rt).filter((u) => !usedUnitIds.has(u.id)); const q = Math.min(qty[rt.id] ?? 0, free.length); for (let k = 0; k < q; k++) { const u = free[k]; if (u) usedUnitIds.add(u.id); flat.push({ rt, unitId: u?.id ?? null }); } });
    const nR = Math.max(1, flat.length);
    const dist = (tot: number, i: number) => Math.floor(tot / nR) + (i < tot % nR ? 1 : 0);
    let ci = 0; // cursore per distribuire le età dei bambini tra le camere del gruppo
    let primary: Booking | undefined;
    flat.forEach((r, i) => {
      const kids = nR > 1 ? dist(children, i) : children;
      const ages = childAges.slice(ci, ci + kids); ci += kids;
      const roomCribs = nR > 1 ? Math.min(dist(cribs, i), kids) : cribs;
      const depositN = Math.max(0, Number(deposit) || 0);
      const created = addBooking({ groupId, structureId: r.rt.structureId, roomTypeId: r.rt.id, unitId: r.unitId, guestId, channel, status: "confirmed", checkIn, checkOut, adults: nR > 1 ? dist(adults, i) : adults, children: kids, childAges: ages.length ? ages : undefined, cribs: roomCribs || undefined, parking: parking || undefined, paid: i === 0 && depositN > 0 ? depositN : undefined, total: linePrice(r.rt) || undefined, extras: i === 0 && bookingExtras.length ? bookingExtras : undefined, note: [isGroup && groupName.trim() ? groupName.trim() : "", note.trim()].filter(Boolean).join(" · ") || undefined });
      if (i === 0) primary = created;
    });
    // Conferma all'ospite (voucher via email). Uso i dati appena inseriti per evitare i ritardi dello stato.
    if (sendConfirm && email.trim() && primary) {
      const guestObj = { id: guestId, fullName: `${firstName} ${lastName}`.trim(), firstName, lastName, email: email.trim(), phone: phone.trim() } as Guest;
      sendVoucher(primary, { getStructure, getGuest: () => guestObj, getRoomType, getUnit });
    }
    router.push("/prenotazioni");
  };

  // Stampa / salva PDF del voucher con i dati correnti (senza creare la prenotazione).
  const printVoucher = () => {
    const st = taxStruct;
    const depositN = Math.max(0, Number(deposit) || 0);
    const saldo = Math.max(0, grandFinal - depositN);
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
    const rows: string[] = [];
    selected.forEach((rt) => rows.push(`<tr><td>${qty[rt.id]}× ${esc(rt.name)}</td><td class="r">${eur(linePrice(rt) * (qty[rt.id] ?? 0))}</td></tr>`));
    chosenExtras.forEach((e) => rows.push(`<tr><td>${esc(e.name)}</td><td class="r">${eur(e.price)}</td></tr>`));
    rows.push(`<tr><td>Colazione</td><td class="r">inclusa</td></tr>`);
    rows.push(`<tr><td>Parcheggio</td><td class="r">${parking ? (parkingPriceN > 0 ? eur(parkingPriceN) : "incluso") : "non richiesto"}</td></tr>`);
    if (cityTax > 0) rows.push(`<tr><td>Tassa di soggiorno</td><td class="r">${eur(cityTax)}</td></tr>`);
    const guestName = `${firstName} ${lastName}`.trim() || "Ospite";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Voucher ${esc(guestName)}</title><style>
      body{font-family:system-ui,Arial,sans-serif;color:#1a1a1a;max-width:640px;margin:32px auto;padding:0 20px}
      h1{font-size:20px;margin:0 0 2px} .mut{color:#777;font-size:13px}
      .box{border:1px solid #ddd;border-radius:12px;padding:16px;margin-top:16px}
      table{width:100%;border-collapse:collapse;font-size:14px} td{padding:6px 0;border-bottom:1px solid #eee}
      .r{text-align:right} .tot{font-size:18px;font-weight:800} .head{background:${st?.photoColor || "#1f6f78"};color:#fff;padding:16px;border-radius:12px}
    </style></head><body>
      <div class="head"><h1>${esc(st?.name || "Struttura")}</h1><div>Voucher di prenotazione · ${esc(guestName)}</div></div>
      <div class="box"><div class="mut">${fmtDay(checkIn)} → ${fmtDay(checkOut)} · ${nightsN} ${nightsN === 1 ? "notte" : "notti"} · ${adults} ${adults === 1 ? "adulto" : "adulti"}${children > 0 ? `, ${children} bambini` : ""}</div>
      <table>${rows.join("")}
      <tr><td class="tot">Totale</td><td class="r tot">${eur(grandFinal)}</td></tr>
      ${depositN > 0 ? `<tr><td>Acconto versato</td><td class="r">${eur(depositN)}</td></tr><tr><td>Saldo in struttura</td><td class="r">${eur(saldo)}</td></tr>` : ""}
      </table></div>
      <p class="mut">${[st?.address, st?.phone, st?.email].filter((x): x is string => !!x).map(esc).join(" · ")}</p>
      <script>window.onload=function(){window.print()}</script>
    </body></html>`;
    const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); }
  };

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick} className={`relative h-6 w-11 rounded-full transition ${on ? "bg-focus" : "bg-line"}`}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>
  );

  return (
    <div>
      {/* Titolo compatto */}
      <div className="mb-3">
        <h1 className="font-display text-xl font-bold text-txt">Aggiungi prenotazione</h1>
        <p className="text-xs text-dim">Cerca la disponibilità e componi la prenotazione, anche di gruppo</p>
      </div>

      {/* Indicatore di step 1-2-3 */}
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold">
        {([["search", "1", "Disponibilità"], ["rooms", "2", "Camera"], ["details", "3", "Personalizza"]] as const).map(([ph, n, lab], i) => {
          const order = { search: 0, rooms: 1, details: 2 } as const;
          const state = order[phase] === i ? "current" : order[phase] > i ? "done" : "todo";
          return (
            <div key={ph} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-5" style={{ backgroundColor: order[phase] >= i ? "var(--ok)" : "var(--line)" }} />}
              <button type="button" disabled={order[phase] < i} onClick={() => setPhase(ph)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 transition hover:bg-wash" style={state === "current" ? { backgroundColor: "var(--ok)", color: "#fff" } : state === "done" ? { color: "var(--ok)" } : { color: "var(--faint)" }}>
                <span className="grid h-5 w-5 place-items-center rounded-full text-[10px]" style={state === "current" ? { backgroundColor: "rgba(255,255,255,.25)" } : state === "done" ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)" } : { backgroundColor: "var(--wash)" }}>{state === "done" ? "✓" : n}</span>
                <span className="hidden sm:inline">{lab}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ─────────── Step 1 · Disponibilità ─────────── */}
      {phase === "search" && (
      <>
        {/* Barra controlli · separata dal corpo sottostante */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-sm">
          {!locked && (
            <select value={structFilter} onChange={(e) => setStructFilter(e.target.value)} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus">
              <option value="all">Tutte le strutture</option>
              {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <select value={mode} onChange={(e) => setMode(e.target.value as "prenotazione" | "preventivo")} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus">
            <option value="prenotazione">Prenotazione</option>
            <option value="preventivo">Preventivo</option>
          </select>
          <label className="flex items-center gap-2 text-dim"><Toggle on={onlyAvail} onClick={() => setOnlyAvail((v) => !v)} /> Solo disponibili</label>
          <label className="flex items-center gap-2 text-dim"><Toggle on={group} onClick={() => setGroup((v) => !v)} /> Gruppo</label>
          {group && <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Nome gruppo" className={`${inp} basis-full sm:max-w-xs`} />}
        </div>

        <Card className="mb-5">
          {/* Date, ospiti e azione (in linea) */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[140px] flex-1 flex-col gap-1.5 text-xs font-medium text-dim">Arrivo<input type="date" value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(shiftISO(e.target.value, 1)); }} className={inp} /></label>
            <label className="flex min-w-[140px] flex-1 flex-col gap-1.5 text-xs font-medium text-dim">Partenza<input type="date" value={checkOut} min={shiftISO(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} className={inp} /></label>
            <label className="flex w-[88px] flex-col gap-1.5 text-xs font-medium text-dim">Adulti<input type="number" min={1} value={adults} onChange={(e) => setAdults(Math.max(1, +e.target.value))} className={inp} /></label>
            <label className="flex w-[88px] flex-col gap-1.5 text-xs font-medium text-dim">Bambini<input type="number" min={0} value={children} onChange={(e) => setChildrenN(Math.max(0, +e.target.value))} className={inp} /></label>
            <button onClick={doSearch} className="rounded-lg bg-focus px-6 py-2 text-sm font-semibold text-white transition hover:opacity-90" style={{ height: 38 }}>Verifica disponibilità</button>
          </div>

          {/* Età dei bambini */}
          {children > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-2 text-xs font-medium text-dim">Età dei bambini <span className="font-normal text-faint">(per la tassa di soggiorno e la sistemazione)</span></div>
              <div className="flex flex-wrap items-center gap-2">
                {childAges.map((age, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5">
                    <span className="text-xs text-faint">Bimbo {i + 1}</span>
                    <input type="number" min={0} max={17} value={age} onChange={(e) => setChildAges((prev) => prev.map((a, j) => (j === i ? Math.max(0, Math.min(17, Number(e.target.value))) : a)))} className="w-12 rounded border border-line bg-surface px-1 py-0.5 text-sm text-txt outline-none focus:border-focus" />
                  </div>
                ))}
                <span className="ml-2 flex items-center gap-2 text-sm text-dim">Culle
                  <button onClick={() => setCribs((v) => Math.max(0, v - 1))} disabled={cribs <= 0} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-base leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
                  <span className="w-4 text-center text-sm font-semibold tabular-nums text-txt">{cribs}</span>
                  <button onClick={() => setCribs((v) => Math.min(children, v + 1))} disabled={cribs >= children} className="flex h-7 w-7 items-center justify-center rounded-lg border border-focus bg-focus text-base leading-none text-white hover:opacity-90 disabled:opacity-30">+</button>
                </span>
              </div>
            </div>
          )}

          {err && phase === "search" && <div className="mt-3 text-sm font-medium text-[color:var(--err)]">{err}</div>}
        </Card>
      </>
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
                          const isDerived = !!rt.deriveFrom && !!rt.deriveInherit;
                          const rootId = poolRootId(rt);
                          const poolSel = selected.filter((x) => poolRootId(x) === rootId).reduce((a, x) => a + (qty[x.id] ?? 0), 0);
                          const canAdd = poolSel < av;
                          return (
                            <tr key={rt.id} className={q > 0 ? "bg-[color:color-mix(in_srgb,var(--focus)_5%,transparent)]" : ""}>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5 font-semibold text-txt">{rt.name}{isDerived && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>↳ derivata</span>}</div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-dim"><Icon name="cup" size={12} /> BB · Flessibile 7 gg{isDerived && <span className="text-faint">· stesse camere della madre</span>}{!fits && <span className="text-[color:var(--warn)]">· capienza {cap(rt)} &lt; {party} ospiti</span>}</div>
                              </td>
                              <td className="px-3 py-3 text-center"><span className="inline-flex items-center gap-[1px] text-dim">{Array.from({ length: Math.min(cap(rt), 5) }).map((_, i) => <Person key={i} />)}</span></td>
                              <td className="px-3 py-3 text-center"><span className="inline-grid h-6 w-6 place-items-center rounded-full text-[color:var(--ok)]" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)" }}><Icon name="check" size={13} /></span></td>
                              <td className="px-3 py-3 text-center">{(() => { const tot = unitsOfType(rt); const occ = tot - av; return (<><span className={`font-semibold ${av > 0 ? "text-txt" : "text-[color:var(--err)]"}`}>{av}</span><span className="text-faint"> / {tot}</span>{occ > 0 && <div className="text-[10px] text-faint">{occ} {occ === 1 ? "occupata" : "occupate"}</div>}</>); })()}</td>
                              <td className="px-3 py-3 text-right"><span className="text-base font-extrabold text-txt">{eur(stayPrice(rt))}</span><div className="text-[10px] text-faint">{nightsN} {nightsN === 1 ? "notte" : "notti"}</div></td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button disabled={q <= 0} onClick={() => setQ(rt.id, q - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-lg leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
                                  <span className={`w-6 text-center text-sm font-bold ${q > 0 ? "text-[color:var(--focus)]" : "text-dim"}`}>{q}</span>
                                  <button disabled={!canAdd} onClick={() => setQ(rt.id, q + 1)} className={`flex h-8 w-8 items-center justify-center rounded-lg border text-lg leading-none disabled:opacity-30 ${q > 0 ? "border-focus bg-focus text-white hover:opacity-90" : "border-line text-dim hover:bg-wash"}`}>+</button>
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

      {/* ─────────── Step 3 · Personalizza (layout mini-sito: dati a sx, riepilogo/voucher a dx) ─────────── */}
      {phase === "details" && totalRooms > 0 && (() => {
        const depositN = Math.max(0, Number(deposit) || 0);
        const saldo = Math.max(0, grandFinal - depositN);
        return (
        <div className="mb-10">
          <button onClick={() => setPhase("rooms")} className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-focus hover:underline">← Torna alle camere</button>
          <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
            {/* Colonna sinistra · inserimento dati */}
            <div className="space-y-4">
              {/* Dettagli ospite */}
              <Card>
                <h3 className="mb-3 font-display text-base font-bold text-txt">Dettagli ospite</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <FieldL label="Cognome *"><input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inp} placeholder="Cognome" /></FieldL>
                  <FieldL label="Nome"><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inp} placeholder="Nome" /></FieldL>
                  <FieldL label="Canale"><select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={inp}>{CHANNEL_OPTS.map((c) => (<option key={c} value={c}>{CHANNELS[c].label}</option>))}</select></FieldL>
                  <FieldL label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} className={inp} placeholder="per il voucher" /></FieldL>
                  <FieldL label="Telefono"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} placeholder="opzionale" /></FieldL>
                  <label className="col-span-2 block text-xs font-medium text-dim sm:col-span-3">Note<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${inp} mt-1 resize-y`} placeholder="Richieste, orari, preferenze… (le ritrovi nella scheda)" /></label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-3">
                  <label className="flex items-center gap-2 text-sm text-txt"><Toggle on={parking} onClick={() => setParking((v) => !v)} /> Parcheggio</label>
                  {parking && <label className="flex items-center gap-2 text-sm text-txt">Prezzo parcheggio <span className="flex items-center gap-1">€ <input type="number" min={0} value={parkingPrice} onChange={(e) => setParkingPrice(e.target.value)} placeholder="0 = incluso" className="w-28 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></span></label>}
                  <label className="flex items-center gap-2 text-sm text-txt">Acconto <span className="flex items-center gap-1">€ <input type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" className="w-24 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></span></label>
                  <label className={`flex items-center gap-2 text-sm ${email.trim() ? "text-txt" : "text-faint"}`} title={email.trim() ? undefined : "Inserisci l'email dell'ospite per inviare il voucher"}><Toggle on={sendConfirm && !!email.trim()} onClick={() => setSendConfirm((v) => !v)} /> Invia il voucher di conferma via email</label>
                </div>
              </Card>

              {/* Prezzo camere (modificabile per sconti/tariffe) */}
              <Card>
                <div className="mb-2 flex items-center gap-2"><h3 className="font-display text-base font-bold text-txt">Camere e prezzo</h3><span className="text-xs text-faint">· modificabile per sconti</span>{party > totalCap && <span className="ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>Posti insufficienti: {totalCap}/{party}</span>}</div>
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full min-w-[520px] text-sm">
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
                  </table>
                </div>
              </Card>

              {/* Servizi extra */}
              {availExtras.length > 0 && (
                <Card>
                  <h3 className="mb-1 font-display text-base font-bold text-txt">Servizi extra</h3>
                  <p className="mb-2 text-xs text-dim">Migliora il soggiorno aggiungendo i servizi.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {availExtras.map((e) => { const q = extraQty[e.id] ?? 0; return (
                      <div key={e.id} className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${q > 0 ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_6%,transparent)]" : "border-line"}`}>
                        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-txt">{e.name}{e.structName ? <span className="font-normal text-faint"> · {e.structName}</span> : ""}</div>{e.desc && <div className="truncate text-[11px] text-faint">{e.desc}</div>}<div className="text-[11px] text-faint">{eur(e.price)}</div></div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button disabled={q <= 0} onClick={() => setExtraQ(e.id, q - 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-base leading-none text-dim hover:bg-wash disabled:opacity-30">−</button>
                          <span className={`w-5 text-center text-sm font-bold ${q > 0 ? "text-[color:var(--focus)]" : "text-dim"}`}>{q}</span>
                          <button onClick={() => setExtraQ(e.id, q + 1)} className={`flex h-7 w-7 items-center justify-center rounded-lg border text-base leading-none ${q > 0 ? "border-focus bg-focus text-white hover:opacity-90" : "border-line text-dim hover:bg-wash"}`}>+</button>
                        </div>
                      </div>
                    ); })}
                  </div>
                </Card>
              )}
            </div>

            {/* Colonna destra · riepilogo/voucher sticky */}
            <div className="lg:sticky lg:top-20">
              <Card>
                <div className="mb-2 text-[11px] text-faint">{fmtDay(checkIn)} → {fmtDay(checkOut)}</div>
                <div className="mb-2 text-xs text-dim">{nightsN} {nightsN === 1 ? "notte" : "notti"} · {adults} {adults === 1 ? "adulto" : "adulti"}{children > 0 ? `, ${children} ${children === 1 ? "bambino" : "bambini"}` : ""}{isGroup ? " · gruppo ⛓" : ""}</div>
                <div className="space-y-1 border-t border-line pt-2 text-sm">
                  {selected.map((rt) => (
                    <div key={rt.id} className="flex items-baseline justify-between gap-3"><span className="text-txt">{qty[rt.id]}× {rt.name}</span><span className="shrink-0 font-mono text-txt">{eur(linePrice(rt) * (qty[rt.id] ?? 0))}</span></div>
                  ))}
                  {chosenExtras.map((e, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3"><span className="text-dim">{e.name}</span><span className="shrink-0 font-mono text-dim">{eur(e.price)}</span></div>
                  ))}
                  <div className="flex items-baseline justify-between gap-3"><span className="text-dim">Colazione</span><span className="shrink-0 text-[color:var(--ok)]">inclusa</span></div>
                  <div className="flex items-baseline justify-between gap-3"><span className="text-dim">Parcheggio</span>{parking ? (parkingPriceN > 0 ? <span className="shrink-0 font-mono text-dim">{eur(parkingPriceN)}</span> : <span className="shrink-0 text-[color:var(--ok)]">incluso</span>) : <span className="shrink-0 text-faint">non richiesto</span>}</div>
                  {cityTax > 0 && <div className="flex items-baseline justify-between gap-3"><span className="text-dim">Tassa di soggiorno{taxStruct?.cityTaxMode !== "percent" ? ` (${adults}×${Math.min(nightsN, taxStruct?.cityTaxMaxNights ?? 3)})` : ""}</span><span className="shrink-0 font-mono text-dim">{eur(cityTax)}</span></div>}
                </div>
                <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2"><span className="font-semibold text-txt">Totale</span><span className="font-mono text-xl font-extrabold text-txt">{eur(grandFinal)}</span></div>
                {depositN > 0 && <div className="mt-1 flex items-baseline justify-between text-xs"><span className="text-dim">Acconto adesso</span><span className="font-mono font-semibold text-txt">{eur(depositN)}</span></div>}
                {depositN > 0 && saldo > 0 && <div className="mt-0.5 flex items-baseline justify-between text-xs"><span className="text-dim">Saldo in struttura</span><span className="font-mono font-semibold text-txt">{eur(saldo)}</span></div>}
                <button onClick={confirm} className="mt-3 w-full rounded-lg bg-focus px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90">{isGroup ? "Crea gruppo" : "Crea prenotazione"}</button>
                <button onClick={printVoucher} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-txt transition hover:bg-wash"><Icon name="fileText" size={15} /> Stampa voucher / PDF</button>
                {err && <div className="mt-2 text-center text-sm font-medium text-[color:var(--err)]">{err}</div>}
                <p className="mt-2 text-center text-[11px] text-faint">{sendConfirm && email.trim() ? "Alla conferma parte il voucher via email all'ospite." : "Tassa di soggiorno, commissioni e fattura si gestiscono dalla scheda."}</p>
              </Card>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";


// Tassa di soggiorno secondo le impostazioni struttura (fissa €/persona/notte con tetto notti, o % del soggiorno).
function cityTaxOf(structure: { cityTax?: boolean; cityTaxMode?: "fixed" | "percent"; cityTaxAmount?: number; cityTaxMaxNights?: number; cityTaxPercent?: number } | undefined, adults: number, n: number, accommodation: number) {
  if (!structure?.cityTax) return 0;
  if (structure.cityTaxMode === "percent") return Math.round((accommodation || 0) * (structure.cityTaxPercent ?? 0) / 100);
  const rate = structure.cityTaxAmount ?? 2;
  const maxN = structure.cityTaxMaxNights ?? 3;
  return Math.round(adults * Math.min(n, maxN) * rate);
}

function FieldL({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-dim">{label}<div className="mt-1">{children}</div></label>;
}
const Person = () => (<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5Z" /></svg>);
