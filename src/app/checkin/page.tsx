"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DataProvider, useData } from "@/lib/store";
import { DOC_TYPES } from "@/lib/types";
import { downscaleImage } from "@/lib/images";
import { sendCheckinNotice } from "@/lib/mailer";
import { nights } from "@/lib/dates";
import { cityTaxOf, bookingExtrasTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import SignaturePad from "@/components/SignaturePad";

const box = "rounded-xl border border-line bg-surface";
const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtD = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "long", year: "numeric" });

interface DocData { firstName: string; lastName: string; sex: string; birthDate: string; birthPlace: string; citizenship: string; docType: string; docNumber: string; docPlace: string }
const emptyExtra = () => ({ firstName: "", lastName: "", birthDate: "", birthPlace: "", citizenship: "", docType: DOC_TYPES[0], docNumber: "" });

export default function CheckinPage() {
  return <DataProvider><Engine /></DataProvider>;
}

function Engine() {
  const { bookings, guests, getStructure, getGuest, getUnit, getRoomType, updateGuest, updateBooking } = useData();

  const initialB = useMemo(() => { try { return new URLSearchParams(window.location.search).get("b") || ""; } catch { return ""; } }, []);
  const [bookingId, setBookingId] = useState(initialB);
  const [lookupErr, setLookupErr] = useState("");
  const [q, setQ] = useState({ email: "", lastName: "" });

  const booking = bookings.find((b) => b.id === bookingId) ?? null;
  const guest = booking ? getGuest(booking.guestId) : null;
  const structure = booking ? getStructure(booking.structureId) : null;

  const lookup = () => {
    const email = q.email.trim().toLowerCase(), last = q.lastName.trim().toLowerCase();
    if (!email && !last) { setLookupErr("Inserisci email o cognome."); return; }
    const g = guests.find((x) => (email && (x.email ?? "").toLowerCase() === email) || (last && (x.lastName ?? x.fullName.split(" ").slice(-1)[0] ?? "").toLowerCase() === last));
    const b = g ? bookings.filter((x) => x.guestId === g.id && x.status !== "cancelled" && x.checkOut >= todayISO()).sort((a, b2) => (a.checkIn < b2.checkIn ? -1 : 1))[0] : null;
    if (!b) { setLookupErr("Nessuna prenotazione trovata. Controlla i dati o usa il link ricevuto."); return; }
    setLookupErr(""); setBookingId(b.id);
  };

  const [doc, setDoc] = useState<DocData | null>(null);
  const [arrival, setArrival] = useState("Non lo so");
  const [guestReq, setGuestReq] = useState("");
  const [extras, setExtras] = useState<ReturnType<typeof emptyExtra>[]>([]);
  const [photoFront, setPhotoFront] = useState<string | undefined>();
  const [photoBack, setPhotoBack] = useState<string | undefined>();
  const [signature, setSignature] = useState<string | undefined>();
  const [consent, setConsent] = useState(false);
  const [inv, setInv] = useState({ wants: false, kind: "privato", name: "", vat: "", taxCode: "", address: "", city: "", cap: "", province: "", sdiCode: "", pec: "" });
  const setI = (k: string, v: string | boolean) => setInv((p) => ({ ...p, [k]: v }));
  const [ups, setUps] = useState<Record<string, number>>({}); // upsell scelti (extra struttura) id→qty
  const [paying, setPaying] = useState(false);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);
  const onPhoto = async (file: File | undefined, set: (v: string) => void) => { if (!file || !file.type.startsWith("image/")) return; try { set(await downscaleImage(file, 900, 0.72)); } catch {} };
  const [done, setDone] = useState(false);

  // Inizializza il form quando la prenotazione è nota.
  useMemo(() => {
    if (booking && guest && !doc) {
      setDoc({ firstName: guest.firstName ?? guest.fullName.split(" ")[0] ?? "", lastName: guest.lastName ?? guest.fullName.split(" ").slice(1).join(" ") ?? "", sex: guest.sex ?? "", birthDate: guest.birthDate ?? "", birthPlace: guest.birthPlace ?? "", citizenship: guest.citizenship ?? guest.country ?? "", docType: guest.docType ?? DOC_TYPES[0], docNumber: guest.docNumber ?? "", docPlace: guest.docPlace ?? "" });
      setArrival(booking.arrivalTime ?? "Non lo so");
      setGuestReq(booking.guestRequests ?? "");
      setPhotoFront(booking.docPhotoFront); setPhotoBack(booking.docPhotoBack); setSignature(booking.signature);
      const need = Math.max(0, (booking.adults ?? 1) - 1);
      setExtras(booking.extraGuests?.length ? booking.extraGuests.map((e) => ({ ...emptyExtra(), ...e })) : Array.from({ length: need }, emptyExtra));
      if (booking.invoiceRequest) setInv((p) => ({ ...p, ...Object.fromEntries(Object.entries(booking.invoiceRequest!).filter(([, v]) => v != null)) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking, guest]);

  const setD = <K extends keyof DocData>(k: K, v: string) => setDoc((p) => (p ? { ...p, [k]: v } : p));
  const setExtra = (i: number, k: string, v: string) => setExtras((p) => p.map((e, j) => (j === i ? { ...e, [k]: v } : e)));

  const valid = !!doc && doc.firstName.trim() && doc.lastName.trim() && doc.birthDate && doc.docNumber.trim() && consent;
  const submit = () => {
    if (!booking || !guest || !doc || !valid) return;
    updateGuest(guest.id, { firstName: doc.firstName.trim(), lastName: doc.lastName.trim(), fullName: `${doc.firstName} ${doc.lastName}`.trim(), sex: (doc.sex || undefined) as "M" | "F" | undefined, birthDate: doc.birthDate, birthPlace: doc.birthPlace, citizenship: doc.citizenship, docType: doc.docType, docNumber: doc.docNumber.trim(), docPlace: doc.docPlace });
    const cleanExtras = extras.filter((e) => e.firstName.trim() && e.lastName.trim());
    const invoiceRequest = inv.wants
      ? { wants: true, kind: inv.kind as "privato" | "societa" | "estero", name: inv.name.trim() || undefined, vat: inv.vat.trim() || undefined, taxCode: inv.taxCode.trim() || undefined, address: inv.address.trim() || undefined, city: inv.city.trim() || undefined, cap: inv.cap.trim() || undefined, province: inv.province.trim() || undefined, sdiCode: inv.sdiCode.trim() || undefined, pec: inv.pec.trim() || undefined, country: "IT" }
      : { wants: false };
    // Unisci gli extra scelti a check-in (upsell) senza duplicare quelli già presenti.
    const baseList = booking.extras ?? [];
    const merged = [...baseList];
    for (const c of upsellItems) if (!merged.some((x) => x.name === c.name)) merged.push(c);
    updateBooking(booking.id, { webCheckin: true, arrivalTime: arrival, extraGuests: cleanExtras, docPhotoFront: photoFront, docPhotoBack: photoBack, signature, guestRequests: guestReq.trim() || undefined, invoiceRequest, extras: merged });
    // Avvisa il gestore via email (best-effort, non blocca la conferma all'ospite).
    void sendCheckinNotice(booking, { getStructure, getGuest, getRoomType, getUnit }, [{ ...doc }, ...cleanExtras], arrival);
    setDone(true); window.scrollTo(0, 0);
  };

  // ── Upsell + riepilogo pagamento ──
  const n = booking ? nights(booking.checkIn, booking.checkOut) : 0;
  const offer = (structure?.extras ?? []).filter((e) => e.active !== false);
  const extraUnit = (e: { price: number; per?: string }) => e.per === "night" ? e.price * n : e.per === "person" ? e.price * (booking?.adults ?? 1) : e.price;
  const upsellItems = offer.filter((e) => (ups[e.id] ?? 0) > 0).map((e) => { const q = ups[e.id] ?? 0; return { name: q > 1 ? `${e.name} ×${q}` : e.name, price: extraUnit(e) * q }; });
  const upsellTotal = upsellItems.reduce((a, x) => a + x.price, 0);
  const accommodation = booking?.total ?? 0;
  const cleaning = booking?.cleaningFee ?? 0;
  const baseExtras = booking ? bookingExtrasTotal(booking) : 0;
  const cityTax = booking ? cityTaxOf(structure ?? undefined, booking.adults ?? 0, n, accommodation, booking.cityTaxExempt) : 0;
  const grand = accommodation ? accommodation + cleaning + baseExtras + upsellTotal + cityTax : 0;
  const paid = booking?.paid ?? 0;
  const balance = Math.max(0, grand - paid);
  const canPay = !!structure?.stripeChargesEnabled && balance > 0;

  const payNow = async () => {
    if (!booking || !structure || balance <= 0) return;
    setPaying(true);
    try {
      const origin = window.location.origin;
      const r = await fetch("/api/stripe/quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: balance, label: `Soggiorno ${structure.name}`, email: guest?.email, acct: structure.stripeAccount || "", metadata: { bookingId: booking.id }, successUrl: `${origin}/checkin?b=${booking.id}&paid=1`, cancelUrl: `${origin}/checkin?b=${booking.id}` }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.url) window.location.href = j.url; else setPaying(false);
    } catch { setPaying(false); }
  };

  // Ritorno dal pagamento Stripe (?paid=1): registra l'incasso sulla prenotazione.
  const justPaid = useMemo(() => { try { return new URLSearchParams(window.location.search).get("paid") === "1"; } catch { return false; } }, []);
  const paidHandled = useRef(false);
  useEffect(() => {
    if (!justPaid || paidHandled.current || !booking) return;
    if (grand > 0 && (booking.paid ?? 0) < grand) { updateBooking(booking.id, { paid: grand }); paidHandled.current = true; }
  }, [justPaid, booking, grand, updateBooking]);

  const header = (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? "#4F46E5" }}>{(structure?.name ?? "SS").slice(0, 2).toUpperCase()}</div>
        <div className="leading-tight"><div className="text-sm font-bold text-txt">{structure?.name ?? "Xenora"}</div><div className="text-[11px] text-faint">Check-in online</div></div>
      </div>
    </div>
  );

  if (done) return (
    <div className="min-h-full bg-wash pb-16">{header}
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className={`${box} p-8 text-center`}>
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-white" style={{ backgroundColor: "var(--ok)" }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg></div>
          <h1 className="font-display text-2xl font-bold text-txt">Check-in completato!</h1>
          <p className="mt-1 text-sm text-dim">Grazie {doc?.firstName}. Abbiamo ricevuto i tuoi dati per il soggiorno a {structure?.name}. A presto!</p>
          {structure?.checkInFrom && <p className="mt-3 text-sm text-txt">Ti aspettiamo dal <b>{fmtD(booking!.checkIn)}</b>, check-in dalle <b>{structure.checkInFrom}</b>.</p>}
        </div>

        {/* Welcome: info pratiche */}
        <div className={`${box} mt-4 p-5 text-left`}>
          <h2 className="mb-3 font-display text-lg font-bold text-txt">Informazioni utili</h2>
          <div className="flex flex-col gap-2 text-sm">
            {structure?.address && <div className="flex gap-2"><span>📍</span><span className="text-txt">{[structure.address, structure.streetNumber].filter(Boolean).join(" ")}{structure.city ? `, ${structure.city}` : ""}</span></div>}
            {(getUnit(booking!.unitId)?.accessInfo || structure?.accessInfo) && <div className="flex gap-2"><span>🔑</span><span className="text-txt">{getUnit(booking!.unitId)?.accessInfo || structure?.accessInfo}</span></div>}
            {structure?.checkOutBy && <div className="flex gap-2"><span>🕙</span><span className="text-txt">Check-out entro le <b>{structure.checkOutBy}</b></span></div>}
            {structure?.phone && <div className="flex gap-2"><span>📞</span><a href={`tel:${structure.phone}`} className="text-focus hover:underline">{structure.phone}</a></div>}
          </div>
          <a href={`https://spigole-guest-guide.vercel.app${(structure?.name ?? "").toLowerCase().includes("central perk") ? "/?p=centralperk" : ""}`} target="_blank" rel="noreferrer" className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90">Apri la guida dell'ospite →</a>
        </div>
      </div>
    </div>
  );

  // Ricerca prenotazione (se non arrivi da un link diretto valido)
  if (!booking) return (
    <div className="min-h-full bg-wash pb-16">{header}
      <div className="mx-auto max-w-md px-4 py-10">
        <div className={`${box} p-6`}>
          <h1 className="font-display text-xl font-bold text-txt">Check-in online</h1>
          <p className="mt-1 mb-4 text-sm text-dim">Ritrova la tua prenotazione per completare il check-in prima dell'arrivo.</p>
          <label className={`${lbl} mb-2`}>Email della prenotazione<input value={q.email} onChange={(e) => setQ({ ...q, email: e.target.value })} className={`${field} mt-1`} placeholder="la tua email" /></label>
          <div className="my-2 text-center text-xs text-faint">oppure</div>
          <label className={`${lbl} mb-3`}>Cognome<input value={q.lastName} onChange={(e) => setQ({ ...q, lastName: e.target.value })} className={`${field} mt-1`} /></label>
          {lookupErr && <div className="mb-3 rounded-lg bg-[color:color-mix(in_srgb,var(--err)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--err)]">{lookupErr}</div>}
          <button onClick={lookup} className="w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90">Trova prenotazione</button>
        </div>
      </div>
    </div>
  );

  const unit = getUnit(booking.unitId);
  return (
    <div className="min-h-full bg-wash pb-16">{header}
      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* Riepilogo prenotazione */}
        <div className={`${box} mb-4 p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-display text-lg font-bold text-txt">Ciao {guest?.fullName?.split(" ")[0]}, benvenuto!</div>
              <div className="text-sm text-dim">{getRoomType(booking.roomTypeId)?.name}{unit ? ` · ${unit.name}` : ""} · {booking.adults} adulti{booking.children ? ` · ${booking.children} bambini` : ""}</div>
            </div>
            <div className="text-right text-sm"><div className="text-txt">{fmtD(booking.checkIn)}</div><div className="text-faint">→ {fmtD(booking.checkOut)}</div></div>
          </div>
          {booking.webCheckin && <div className="mt-2 rounded-lg bg-[color:color-mix(in_srgb,var(--ok)_12%,transparent)] px-3 py-1.5 text-xs font-medium text-[color:var(--ok)]">Check-in già inviato — puoi aggiornare i dati e reinviare.</div>}
        </div>

        {/* Dati ospite principale */}
        <div className={`${box} mb-4 p-4`}>
          <h2 className="mb-1 font-display text-lg font-bold text-txt">I tuoi dati</h2>
          <p className="mb-3 text-xs text-dim">Richiesti per legge per la comunicazione degli alloggiati alla Questura. I documenti restano riservati.</p>
          {doc && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={lbl}>Nome *<input value={doc.firstName} onChange={(e) => setD("firstName", e.target.value)} className={`${field} mt-1`} /></label>
              <label className={lbl}>Cognome *<input value={doc.lastName} onChange={(e) => setD("lastName", e.target.value)} className={`${field} mt-1`} /></label>
              <label className={lbl}>Sesso<select value={doc.sex} onChange={(e) => setD("sex", e.target.value)} className={`${field} mt-1`}><option value="">—</option><option value="M">Maschile</option><option value="F">Femminile</option></select></label>
              <label className={lbl}>Data di nascita *<input type="date" value={doc.birthDate} onChange={(e) => setD("birthDate", e.target.value)} className={`${field} mt-1`} /></label>
              <label className={lbl}>Luogo di nascita<input value={doc.birthPlace} onChange={(e) => setD("birthPlace", e.target.value)} className={`${field} mt-1`} placeholder="Comune o Stato" /></label>
              <label className={lbl}>Cittadinanza<input value={doc.citizenship} onChange={(e) => setD("citizenship", e.target.value)} className={`${field} mt-1`} /></label>
              <label className={lbl}>Tipo documento<select value={doc.docType} onChange={(e) => setD("docType", e.target.value)} className={`${field} mt-1`}>{DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
              <label className={lbl}>Numero documento *<input value={doc.docNumber} onChange={(e) => setD("docNumber", e.target.value)} className={`${field} mt-1`} /></label>
              <label className={`${lbl} sm:col-span-2`}>Luogo di rilascio<input value={doc.docPlace} onChange={(e) => setD("docPlace", e.target.value)} className={`${field} mt-1`} /></label>
            </div>
          )}
        </div>

        {/* Co-ospiti */}
        {extras.length > 0 && (
          <div className={`${box} mb-4 p-4`}>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">Altri ospiti</h2><button onClick={() => setExtras((p) => [...p, emptyExtra()])} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-focus hover:bg-wash">＋ Aggiungi</button></div>
            <div className="flex flex-col gap-3">
              {extras.map((e, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-dim">Ospite {i + 2}</span><button onClick={() => setExtras((p) => p.filter((_, j) => j !== i))} className="text-faint hover:text-[color:var(--err)]">✕</button></div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={e.firstName} onChange={(ev) => setExtra(i, "firstName", ev.target.value)} placeholder="Nome" className={field} />
                    <input value={e.lastName} onChange={(ev) => setExtra(i, "lastName", ev.target.value)} placeholder="Cognome" className={field} />
                    <input type="date" value={e.birthDate} onChange={(ev) => setExtra(i, "birthDate", ev.target.value)} className={field} />
                    <input value={e.citizenship} onChange={(ev) => setExtra(i, "citizenship", ev.target.value)} placeholder="Cittadinanza" className={field} />
                    <select value={e.docType} onChange={(ev) => setExtra(i, "docType", ev.target.value)} className={field}>{DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                    <input value={e.docNumber} onChange={(ev) => setExtra(i, "docNumber", ev.target.value)} placeholder="Numero documento" className={field} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Foto del documento */}
        <div className={`${box} mb-4 p-4`}>
          <h2 className="mb-1 font-display text-lg font-bold text-txt">Foto del documento</h2>
          <p className="mb-3 text-xs text-dim">Fotografa il documento (fronte e, se serve, retro). Serve per la registrazione; resta riservato.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["Fronte", photoFront, setPhotoFront, frontRef], ["Retro", photoBack, setPhotoBack, backRef]] as const).map(([label, val, set, ref]) => (
              <div key={label}>
                <button type="button" onClick={() => ref.current?.click()} className="relative flex aspect-[1.586] w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-line bg-paper text-faint transition hover:border-focus hover:text-focus">
                  {val
                    ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={val} alt={label} className="h-full w-full object-cover" />)
                    : <span className="text-center text-xs leading-tight">📷<br />{label} documento</span>}
                </button>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-faint">{label}</span>
                  {val && <button type="button" onClick={() => set(undefined)} className="text-dim hover:text-[color:var(--err)]">Rimuovi</button>}
                </div>
                <input ref={ref} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0], set)} />
              </div>
            ))}
          </div>
        </div>

        {/* Servizi extra (upsell) */}
        {offer.length > 0 && (
          <div className={`${box} mb-4 p-4`}>
            <h2 className="mb-1 font-display text-lg font-bold text-txt">Servizi extra</h2>
            <p className="mb-3 text-xs text-dim">Aggiungi comfort al tuo soggiorno: li troverai pronti all&apos;arrivo.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {offer.map((e) => {
                const qy = ups[e.id] ?? 0;
                return (
                  <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-txt">{e.name}</div>
                      {e.desc && <div className="text-[11px] text-faint">{e.desc}</div>}
                      <div className="text-xs text-dim">{eur(extraUnit(e))}{e.per === "night" ? ` · ${n} notti` : e.per === "person" ? " · a persona" : ""}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button type="button" onClick={() => setUps((u) => ({ ...u, [e.id]: Math.max(0, (u[e.id] ?? 0) - 1) }))} className="grid h-7 w-7 place-items-center rounded-lg border border-line text-txt hover:bg-wash">−</button>
                      <span className="w-5 text-center font-mono text-sm">{qy}</span>
                      <button type="button" onClick={() => setUps((u) => ({ ...u, [e.id]: (u[e.id] ?? 0) + 1 }))} className="grid h-7 w-7 place-items-center rounded-lg border border-line text-txt hover:bg-wash">+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Riepilogo & pagamento */}
        {grand > 0 && (
          <div className={`${box} mb-4 p-4`}>
            <h2 className="mb-2 font-display text-lg font-bold text-txt">Riepilogo & pagamento</h2>
            {justPaid && <div className="mb-3 rounded-lg px-3 py-2 text-sm font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" }}>✓ Pagamento ricevuto — grazie! L&apos;incasso è stato registrato.</div>}
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-dim">Soggiorno</span><span className="font-mono text-txt">{eur(accommodation)}</span></div>
              {cleaning > 0 && <div className="flex justify-between"><span className="text-dim">Pulizia</span><span className="font-mono text-txt">{eur(cleaning)}</span></div>}
              {baseExtras > 0 && <div className="flex justify-between"><span className="text-dim">Extra</span><span className="font-mono text-txt">{eur(baseExtras)}</span></div>}
              {upsellItems.map((x) => <div key={x.name} className="flex justify-between"><span className="text-dim">+ {x.name}</span><span className="font-mono text-txt">{eur(x.price)}</span></div>)}
              {cityTax > 0 && <div className="flex justify-between"><span className="text-dim">Tassa di soggiorno</span><span className="font-mono text-txt">{eur(cityTax)}</span></div>}
              <div className="mt-1 flex justify-between border-t border-line pt-2"><span className="font-semibold text-txt">Totale</span><span className="font-mono font-bold text-txt">{eur(grand)}</span></div>
              {paid > 0 && <div className="flex justify-between"><span className="text-dim">Già versato</span><span className="font-mono" style={{ color: "var(--ok)" }}>−{eur(paid)}</span></div>}
              <div className="flex justify-between"><span className="font-semibold text-txt">Saldo</span><span className="font-mono text-lg font-extrabold" style={{ color: balance > 0 ? "var(--err)" : "var(--ok)" }}>{eur(balance)}</span></div>
            </div>
            {canPay ? (
              <button type="button" onClick={payNow} disabled={paying} className="mt-3 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{paying ? "Apro il pagamento…" : `Paga ora ${eur(balance)}`}</button>
            ) : (
              <p className="mt-3 text-center text-xs text-faint">{balance > 0 ? "Il saldo si paga all'arrivo in struttura." : "Soggiorno già saldato."}</p>
            )}
            <p className="mt-2 text-center text-[11px] text-faint">Il pagamento online arriva direttamente alla struttura (Stripe).</p>
          </div>
        )}

        {/* Firma */}
        <div className={`${box} mb-4 p-4`}>
          <h2 className="mb-1 font-display text-lg font-bold text-txt">Firma</h2>
          <p className="mb-3 text-xs text-dim">Firma per confermare la correttezza dei dati e l'accettazione delle condizioni.</p>
          <SignaturePad value={signature} onChange={setSignature} />
        </div>

        {/* Richiedi fattura (facoltativo) */}
        <div className={`${box} p-4`}>
          <label className="flex items-center justify-between">
            <span className="text-sm font-semibold text-txt">Richiedo fattura</span>
            <input type="checkbox" checked={inv.wants} onChange={(e) => setI("wants", e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" />
          </label>
          {inv.wants && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className={`${lbl} sm:col-span-2`}>Tipo
                <select value={inv.kind} onChange={(e) => setI("kind", e.target.value)} className={`${field} mt-1`}>
                  <option value="privato">Privato</option><option value="societa">Società / P.IVA</option><option value="estero">Estero</option>
                </select>
              </label>
              <label className={`${lbl} sm:col-span-2`}>{inv.kind === "societa" ? "Ragione sociale" : "Nome e cognome"}<input value={inv.name} onChange={(e) => setI("name", e.target.value)} className={`${field} mt-1`} /></label>
              {inv.kind === "societa" && <label className={lbl}>Partita IVA<input value={inv.vat} onChange={(e) => setI("vat", e.target.value)} className={`${field} mt-1`} /></label>}
              {inv.kind !== "societa" && <label className={lbl}>Codice fiscale<input value={inv.taxCode} onChange={(e) => setI("taxCode", e.target.value)} className={`${field} mt-1`} /></label>}
              {inv.kind === "societa" && <label className={lbl}>Codice destinatario / PEC<input value={inv.sdiCode} onChange={(e) => setI("sdiCode", e.target.value)} placeholder="7 caratteri o PEC" className={`${field} mt-1`} /></label>}
              <label className={`${lbl} sm:col-span-2`}>Indirizzo<input value={inv.address} onChange={(e) => setI("address", e.target.value)} className={`${field} mt-1`} /></label>
              <label className={lbl}>Città<input value={inv.city} onChange={(e) => setI("city", e.target.value)} className={`${field} mt-1`} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className={lbl}>CAP<input value={inv.cap} onChange={(e) => setI("cap", e.target.value)} className={`${field} mt-1`} /></label>
                <label className={lbl}>Prov.<input value={inv.province} onChange={(e) => setI("province", e.target.value)} className={`${field} mt-1`} /></label>
              </div>
            </div>
          )}
        </div>

        {/* Arrivo + consenso + invio */}
        <div className={`${box} p-4`}>
          <label className={lbl}>Orario di arrivo previsto<select value={arrival} onChange={(e) => setArrival(e.target.value)} className={`${field} mt-1`}>{["Non lo so", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00", "dopo le 20:00"].map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
          <label className={lbl}>Note o richieste <span className="font-normal text-faint">(facoltative)</span><textarea value={guestReq} onChange={(e) => setGuestReq(e.target.value)} rows={3} className={`${field} mt-1 resize-y`} placeholder="Es. arriviamo in auto, culla, allergie, orari particolari…" /></label>
          <label className="mt-3 flex items-start gap-2 text-xs text-dim">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--focus)]" />
            <span>Confermo che i dati sono corretti e acconsento al trattamento dei dati personali e del documento ai fini della registrazione degli alloggiati (Questura) e degli adempimenti di legge.</span>
          </label>
          <button onClick={submit} disabled={!valid} className="mt-4 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">Invia il check-in</button>
          {!valid && <div className="mt-2 text-center text-[11px] text-faint">Compila nome, cognome, data di nascita, numero documento e spunta il consenso.</div>}
        </div>
      </div>
    </div>
  );
}
