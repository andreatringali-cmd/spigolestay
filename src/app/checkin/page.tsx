"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DOC_TYPES } from "@/lib/types";
import { downscaleImage } from "@/lib/images";
import { eur } from "@/lib/format";
import SignaturePad from "@/components/SignaturePad";

// Check-in online per l'OSPITE — pagina PUBBLICA e SERVER-backed.
// Carica e salva tutto tramite /api/checkin (service role): funziona per l'ospite
// anonimo dal link email e persiste sul server (personale o struttura condivisa),
// senza dipendere dal localStorage del browser.

const box = "rounded-xl border border-line bg-surface";
const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";
const fmtD = (iso: string) => { try { return new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; } };

interface DocData { firstName: string; lastName: string; sex: string; birthDate: string; birthPlace: string; citizenship: string; docType: string; docNumber: string; docPlace: string }
const emptyExtra = () => ({ firstName: "", lastName: "", sex: "", birthDate: "", birthPlace: "", citizenship: "", docType: DOC_TYPES[0], docNumber: "", docPlace: "", photoFront: "", photoBack: "", room: "" });

// Controllo di upload di UNA faccia del documento (fronte o retro), riusato per
// l'ospite principale e per ogni co-ospite. Se `onReread` è passato, mostra il
// pulsante "✨ Rileggi dal documento" (solo quando l'AI è attiva).
function DocFace({ label, photo, onPick, onRemove, onReread, extracting, aiOff }: {
  label: string;
  photo?: string;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
  onReread?: () => void;
  extracting: boolean;
  aiOff: boolean;
}) {
  if (photo) {
    return (
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt={label} className="h-14 w-24 shrink-0 rounded border border-line object-cover" />
        <div className="flex flex-col items-start gap-1">
          <span className="text-[11px] font-medium text-dim">{label}</span>
          {onReread && !aiOff && <button type="button" onClick={onReread} disabled={extracting} className="text-xs font-semibold text-focus hover:underline disabled:opacity-50">{extracting ? "Leggo…" : "✨ Rileggi dal documento"}</button>}
          <button type="button" onClick={onRemove} className="text-[11px] text-dim hover:text-[color:var(--err)]">Rimuovi</button>
        </div>
      </div>
    );
  }
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>
      {extracting && onReread ? "Leggo…" : `${aiOff || !onReread ? "📷" : "✨"} ${label}`}
      <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPick(e.target.files?.[0])} />
    </label>
  );
}

interface Info {
  aiEnabled?: boolean;
  returning?: boolean;
  group?: { b: string; code: string; roomType: string; unit: string; adults: number; children: number; webCheckin: boolean }[];
  booking: { id: string; code: string; status: string; checkIn: string; checkOut: string; adults: number; children: number; total: number; paid: number; cleaningFee: number; cityTax: number; cityTaxExempt: boolean; webCheckin: boolean; arrivalTime: string; guestRequests: string; extras: { name: string; price: number }[]; extraGuests: (DocData & { docPhotoFront?: string; docPhotoBack?: string })[]; docPhotoFront: string | null; docPhotoBack: string | null; signature: string | null; invoiceRequest: Record<string, unknown> | null };
  guest: { firstName: string; lastName: string; email: string; phone: string; sex: string; birthDate: string; birthPlace: string; citizenship: string; docType: string; docNumber: string; docPlace: string; docPhotoFront?: string | null; docPhotoBack?: string | null };
  roomType: { name: string };
  unit: { name: string; accessInfo: string } | null;
  structure: { name: string; color: string; phone: string; email: string; address: string; streetNumber: string; city: string; checkInFrom: string; checkOutBy: string; accessInfo: string; currency: string; stripeAccount: string; stripeChargesEnabled: boolean; extras: { id: string; name: string; desc: string; price: number; per: string }[] };
}

export default function CheckinPage() {
  return <Suspense fallback={null}><Engine /></Suspense>;
}

function Engine() {
  const params = useMemo(() => { try { const u = new URLSearchParams(window.location.search); return { slug: u.get("site") || "", b: u.get("b") || "", paid: u.get("paid") === "1", session: u.get("session_id") || "" }; } catch { return { slug: "", b: "", paid: false, session: "" }; } }, []);
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const [doc, setDoc] = useState<DocData | null>(null);
  const [arrival, setArrival] = useState("Non lo so");
  const [guestReq, setGuestReq] = useState("");
  const [extras, setExtras] = useState<ReturnType<typeof emptyExtra>[]>([]);
  const [primaryRoom, setPrimaryRoom] = useState(""); // camera assegnata all'ospite principale (prenotazioni di gruppo)
  const [photoFront, setPhotoFront] = useState<string | undefined>();
  const [photoBack, setPhotoBack] = useState<string | undefined>();
  const [signature, setSignature] = useState<string | undefined>();
  const [consent, setConsent] = useState(false);
  const [inv, setInv] = useState({ wants: false, kind: "privato", name: "", vat: "", taxCode: "", address: "", city: "", cap: "", province: "", sdiCode: "", pec: "" });
  const setI = (k: string, v: string | boolean) => setInv((p) => ({ ...p, [k]: v }));
  const [ups, setUps] = useState<Record<string, number>>({});
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [done, setDone] = useState(false);
  const [paidNow, setPaidNow] = useState(false);
  const onPhoto = async (file: File | undefined, set: (v: string) => void, extract = false) => {
    if (!file || !file.type.startsWith("image/")) return;
    try { const dl = await downscaleImage(file, 900, 0.72); set(dl); if (extract) void extractDoc(dl); } catch {}
  };

  // Estrazione AI dei dati dal documento (pre-riempimento; l'ospite verifica sempre).
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState("");
  const [aiOff, setAiOff] = useState(false);
  // Estrazione generica: legge il documento e passa i campi a `apply` (riempie solo i vuoti).
  const runExtract = async (img: string, apply: (f: Record<string, string>) => void) => {
    if (!img || extracting) return;
    setExtracting(true); setExtractMsg("");
    try {
      const r = await fetch("/api/checkin/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: img }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503 && j?.error === "ai_not_configured") { setAiOff(true); setExtracting(false); return; }
      if (r.ok && j?.ok && j.fields) { apply(j.fields as Record<string, string>); setExtractMsg("Dati compilati dal documento — controllali prima di inviare."); }
      else setExtractMsg("Non sono riuscito a leggere il documento: compila i campi a mano.");
    } catch { setExtractMsg("Lettura non riuscita: compila i campi a mano."); }
    setExtracting(false);
  };
  // Ospite principale.
  const extractDoc = (img: string) => runExtract(img, (f) => setDoc((p) => {
    const base = p ?? { firstName: "", lastName: "", sex: "", birthDate: "", birthPlace: "", citizenship: "", docType: DOC_TYPES[0], docNumber: "", docPlace: "" };
    const merged = { ...base } as DocData;
    (Object.keys(f) as (keyof DocData)[]).forEach((k) => { if (f[k] && !String(base[k] || "").trim()) merged[k] = String(f[k]); });
    return merged;
  }));
  // Co-ospite i-esimo: riempie solo i campi ancora vuoti di quell'ospite.
  const extractExtra = (img: string, i: number) => runExtract(img, (f) => setExtras((prev) => prev.map((e, j) => {
    if (j !== i) return e;
    const merged = { ...e } as Record<string, string>;
    Object.keys(f).forEach((k) => { if (f[k] && !String(merged[k] || "").trim()) merged[k] = String(f[k]); });
    return merged as typeof e;
  })));
  const onExtraPhoto = async (file: File | undefined, i: number) => {
    if (!file || !file.type.startsWith("image/")) return;
    try { const dl = await downscaleImage(file, 900, 0.72); setExtra(i, "photoFront", dl); void extractExtra(dl, i); } catch {}
  };
  const onExtraPhotoBack = async (file: File | undefined, i: number) => {
    if (!file || !file.type.startsWith("image/")) return;
    try { const dl = await downscaleImage(file, 900, 0.72); setExtra(i, "photoBack", dl); } catch {}
  };

  // Carica la prenotazione dal server.
  const load = async () => {
    if (!params.b) { setLoadErr("Link non valido: apri il check-in dal link ricevuto via email."); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/checkin?b=${encodeURIComponent(params.b)}${params.slug ? `&slug=${encodeURIComponent(params.slug)}` : ""}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setLoadErr(j?.error === "not_found" ? "Prenotazione non trovata." : "Impossibile caricare la prenotazione."); setInfo(null); }
      else {
        const d = j as Info;
        setInfo(d);
        const b = d.booking, g = d.guest;
        setDoc({ firstName: g.firstName || "", lastName: g.lastName || "", sex: g.sex || "", birthDate: g.birthDate || "", birthPlace: g.birthPlace || "", citizenship: g.citizenship || "", docType: g.docType || DOC_TYPES[0], docNumber: g.docNumber || "", docPlace: g.docPlace || "" });
        setArrival(b.arrivalTime || "Non lo so");
        setGuestReq(b.guestRequests || "");
        // Ospite di ritorno: se questa prenotazione non ha ancora foto, riusa quelle dell'anagrafica.
        setPhotoFront(b.docPhotoFront || g.docPhotoFront || undefined); setPhotoBack(b.docPhotoBack || g.docPhotoBack || undefined); setSignature(b.signature || undefined);
        setAiOff(d.aiEnabled === false);
        if (d.group && d.group.length > 1) {
          // Prenotazione di GRUPPO: un unico check-in per tutte le camere. Prepara un posto per
          // ogni ospite atteso e assegna le camere di default (riempiendo ogni camera per capienza).
          const slots = d.group.flatMap((r) => Array.from({ length: Math.max(1, (r.adults || 1) + (r.children || 0)) }, () => r.b));
          setPrimaryRoom(slots[0] || d.group[0].b);
          const need = Math.max(0, slots.length - 1);
          setExtras(Array.from({ length: need }, (_, i) => ({ ...emptyExtra(), room: slots[i + 1] || d.group![0].b })));
        } else {
          const need = Math.max(0, (b.adults || 1) - 1);
          setExtras(b.extraGuests?.length ? b.extraGuests.map((e) => ({ ...emptyExtra(), ...e, photoFront: e.docPhotoFront || "", photoBack: e.docPhotoBack || "" })) : Array.from({ length: need }, emptyExtra));
        }
        if (b.invoiceRequest) setInv((p) => ({ ...p, ...Object.fromEntries(Object.entries(b.invoiceRequest!).filter(([, v]) => v != null).map(([k, v]) => [k, v as string | boolean])) }));
      }
    } catch { setLoadErr("Errore di rete."); }
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Ritorno dal pagamento del saldo (?paid=1&session_id): registra l'incasso sul server.
  const paidHandled = useRef(false);
  useEffect(() => {
    if (!params.paid || paidHandled.current) return;
    paidHandled.current = true;
    setPaidNow(true);
    if (params.session) {
      fetch("/api/checkin/pay-confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: params.slug, b: params.b, session_id: params.session }) })
        .then(() => load())
        .catch(() => {})
        .finally(() => { try { window.history.replaceState({}, "", `/checkin?site=${encodeURIComponent(params.slug)}&b=${encodeURIComponent(params.b)}`); } catch {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.paid]);

  const setD = <K extends keyof DocData>(k: K, v: string) => setDoc((p) => (p ? { ...p, [k]: v } : p));
  const setExtra = (i: number, k: string, v: string) => setExtras((p) => p.map((e, j) => (j === i ? { ...e, [k]: v } : e)));

  const valid = !!doc && doc.firstName.trim() && doc.lastName.trim() && doc.birthDate && doc.docNumber.trim() && consent && !!signature;

  // ── Upsell + riepilogo pagamento ──
  const b = info?.booking;
  const st = info?.structure;
  const nightsN = b ? Math.max(1, Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86400000)) : 0;
  const offer = st?.extras ?? [];
  const extraUnit = (e: { price: number; per?: string }) => e.per === "night" ? e.price * nightsN : e.per === "person" ? e.price * (b?.adults ?? 1) : e.price;
  const upsellItems = offer.filter((e) => (ups[e.id] ?? 0) > 0).map((e) => { const q = ups[e.id] ?? 0; return { name: q > 1 ? `${e.name} ×${q}` : e.name, price: extraUnit(e) * q }; });
  const upsellTotal = upsellItems.reduce((a, x) => a + x.price, 0);
  const accommodation = b?.total ?? 0;
  const cleaning = b?.cleaningFee ?? 0;
  const baseExtras = (b?.extras ?? []).reduce((a, x) => a + (x.price || 0), 0);
  const cityTax = b?.cityTax ?? 0;
  const grand = accommodation ? accommodation + cleaning + baseExtras + upsellTotal + cityTax : 0;
  const paid = b?.paid ?? 0;
  const balance = Math.max(0, grand - paid);
  const canPay = !!st?.stripeChargesEnabled && !!st?.stripeAccount && balance > 0;

  // Prenotazione di gruppo: un unico check-in per più camere.
  const groupRooms = info?.group ?? [];
  const isGroup = groupRooms.length > 1;
  const roomLabel = (r: { roomType: string; unit: string; code: string }) => [r.roomType, r.unit].filter(Boolean).join(" · ") || r.code;
  const invoicePayload = inv.wants ? { wants: true, kind: inv.kind, name: inv.name.trim() || undefined, vat: inv.vat.trim() || undefined, taxCode: inv.taxCode.trim() || undefined, address: inv.address.trim() || undefined, city: inv.city.trim() || undefined, cap: inv.cap.trim() || undefined, province: inv.province.trim() || undefined, sdiCode: inv.sdiCode.trim() || undefined, country: "IT" } : { wants: false };

  // Invio di GRUPPO: distribuisce gli ospiti per camera e salva ogni camera.
  const submitGroup = async () => {
    const reqOk = !!doc && !!doc.firstName.trim() && !!doc.lastName.trim() && !!doc.birthDate && !!doc.docNumber.trim();
    if (!info || !doc || !reqOk || !consent || !signature || submitting) return;
    type Person = { room: string; d: DocData; pf?: string; pb?: string };
    const people: Person[] = [{ room: primaryRoom || groupRooms[0].b, d: doc, pf: photoFront, pb: photoBack }];
    extras.filter((e) => e.firstName.trim() && e.lastName.trim()).forEach((e) => people.push({ room: e.room || groupRooms[0].b, d: e as unknown as DocData, pf: e.photoFront || undefined, pb: e.photoBack || undefined }));
    const missing = groupRooms.filter((r) => !people.some((p) => p.room === r.b));
    if (missing.length) { setSubmitErr(`Assegna almeno un ospite a ogni camera: ${missing.map((m) => m.roomType || m.code).join(", ")}.`); window.scrollTo(0, 0); return; }
    setSubmitting(true); setSubmitErr("");
    try {
      for (const r of groupRooms) {
        const inRoom = people.filter((p) => p.room === r.b);
        const primary = inRoom[0];
        const others = inRoom.slice(1);
        const isMain = r.b === params.b;
        const resp = await fetch("/api/checkin", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slug: params.slug, b: r.b,
            doc: { firstName: primary.d.firstName.trim(), lastName: primary.d.lastName.trim(), sex: primary.d.sex || undefined, birthDate: primary.d.birthDate, birthPlace: primary.d.birthPlace, citizenship: primary.d.citizenship, docType: primary.d.docType, docNumber: (primary.d.docNumber || "").trim(), docPlace: primary.d.docPlace },
            arrival, guestRequests: isMain ? (guestReq.trim() || undefined) : undefined,
            extraGuests: others.map((o) => ({ firstName: o.d.firstName, lastName: o.d.lastName, sex: o.d.sex, birthDate: o.d.birthDate, birthPlace: o.d.birthPlace, citizenship: o.d.citizenship, docType: o.d.docType, docNumber: o.d.docNumber, docPlace: o.d.docPlace, docPhotoFront: o.pf, docPhotoBack: o.pb })),
            docPhotoFront: primary.pf, docPhotoBack: primary.pb, signature,
            invoiceRequest: isMain ? invoicePayload : undefined,
            chosenExtras: isMain ? upsellItems : [],
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok || !j?.ok) throw new Error(j?.error || "fail");
      }
      setDone(true); window.scrollTo(0, 0);
    } catch { setSubmitErr("Invio non riuscito. Riprova."); }
    setSubmitting(false);
  };

  const submit = async (opts?: { assumeConsent?: boolean }) => {
    const consented = opts?.assumeConsent || consent;
    const reqOk = !!doc && !!doc.firstName.trim() && !!doc.lastName.trim() && !!doc.birthDate && !!doc.docNumber.trim();
    if (!info || !doc || !reqOk || !consented || !signature || submitting) return;
    setSubmitting(true); setSubmitErr("");
    try {
      const r = await fetch("/api/checkin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: params.slug, b: params.b,
          doc: { firstName: doc.firstName.trim(), lastName: doc.lastName.trim(), sex: doc.sex || undefined, birthDate: doc.birthDate, birthPlace: doc.birthPlace, citizenship: doc.citizenship, docType: doc.docType, docNumber: doc.docNumber.trim(), docPlace: doc.docPlace },
          arrival, guestRequests: guestReq.trim() || undefined,
          extraGuests: extras.filter((e) => e.firstName.trim() && e.lastName.trim()),
          docPhotoFront: photoFront, docPhotoBack: photoBack, signature,
          invoiceRequest: invoicePayload,
          chosenExtras: upsellItems,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) { setDone(true); window.scrollTo(0, 0); }
      else setSubmitErr(j?.error === "write_conflict" ? "Riprova tra un istante." : "Invio non riuscito. Riprova.");
    } catch { setSubmitErr("Errore di rete. Riprova."); }
    setSubmitting(false);
  };

  const payNow = async () => {
    if (!info || balance <= 0 || !st) return;
    setPaying(true); setPayErr("");
    try {
      const origin = window.location.origin;
      const r = await fetch("/api/stripe/quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: balance, label: `Soggiorno ${st.name}`, email: info.guest.email, acct: st.stripeAccount || "", metadata: { bookingId: params.b }, successUrl: `${origin}/checkin?site=${encodeURIComponent(params.slug)}&b=${encodeURIComponent(params.b)}`, cancelUrl: `${origin}/checkin?site=${encodeURIComponent(params.slug)}&b=${encodeURIComponent(params.b)}` }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.url) { window.location.href = j.url; return; }
      setPaying(false);
      setPayErr(j?.message || j?.error || `Pagamento non disponibile (HTTP ${r.status}).`);
    } catch (e) { setPaying(false); setPayErr(e instanceof Error ? e.message : "Errore di rete."); }
  };

  const accent = st?.color || "#4F46E5";
  const header = (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: accent }}>{(st?.name ?? "SS").slice(0, 2).toUpperCase()}</div>
        <div className="leading-tight"><div className="text-sm font-bold text-txt">{st?.name ?? "Xenora"}</div><div className="text-[11px] text-faint">Gestisci la tua prenotazione</div></div>
      </div>
    </div>
  );

  if (loading) return <div className="min-h-full bg-wash">{header}<div className="mx-auto max-w-5xl px-4 py-16 text-center text-sm text-dim">Carico la prenotazione…</div></div>;

  if (!info) return (
    <div className="min-h-full bg-wash">{header}
      <div className="mx-auto max-w-md px-4 py-16">
        <div className={`${box} p-6 text-center`}>
          <div className="text-3xl">🔎</div>
          <h1 className="mt-2 font-display text-lg font-bold text-txt">{loadErr || "Prenotazione non trovata"}</h1>
          <p className="mt-1 text-sm text-dim">Apri il check-in dal link ricevuto nell&apos;email di conferma. Se il problema persiste, contatta la struttura.</p>
        </div>
      </div>
    </div>
  );

  if (done) return (
    <div className="min-h-full bg-wash pb-16">{header}
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className={`${box} p-8 text-center`}>
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-white" style={{ backgroundColor: "var(--ok)" }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg></div>
          <h1 className="font-display text-2xl font-bold text-txt">Check-in completato!</h1>
          <p className="mt-1 text-sm text-dim">Grazie {doc?.firstName}. Abbiamo ricevuto i tuoi dati per il soggiorno a {st?.name}. A presto!</p>
          {st?.checkInFrom && <p className="mt-3 text-sm text-txt">Ti aspettiamo dal <b>{fmtD(info.booking.checkIn)}</b>, check-in dalle <b>{st.checkInFrom}</b>.</p>}
        </div>
        <div className={`${box} mt-4 p-5 text-left`}>
          <h2 className="mb-3 font-display text-lg font-bold text-txt">Informazioni utili</h2>
          <div className="flex flex-col gap-2 text-sm">
            {st?.address && <div className="flex gap-2"><span>📍</span><span className="text-txt">{[st.address, st.streetNumber].filter(Boolean).join(" ")}{st.city ? `, ${st.city}` : ""}</span></div>}
            {(info.unit?.accessInfo || st?.accessInfo) && <div className="flex gap-2"><span>🔑</span><span className="text-txt">{info.unit?.accessInfo || st?.accessInfo}</span></div>}
            {st?.checkOutBy && <div className="flex gap-2"><span>🕙</span><span className="text-txt">Check-out entro le <b>{st.checkOutBy}</b></span></div>}
            {st?.phone && <div className="flex gap-2"><span>📞</span><a href={`tel:${st.phone}`} className="text-focus hover:underline">{st.phone}</a></div>}
          </div>
          <a href={`https://spigole-guest-guide.vercel.app${(st?.name ?? "").toLowerCase().includes("central perk") ? "/?p=centralperk" : ""}`} target="_blank" rel="noreferrer" className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90">Apri la guida dell&apos;ospite →</a>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-full bg-wash pb-16">{header}
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Riepilogo prenotazione */}
        <div className={`${box} mb-4 p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-display text-lg font-bold text-txt">Ciao {info.guest.firstName || doc?.firstName}, benvenuto!</div>
              <div className="text-sm text-dim">{info.roomType.name}{info.unit ? ` · ${info.unit.name}` : ""} · {info.booking.adults} adulti{info.booking.children ? ` · ${info.booking.children} bambini` : ""}</div>
            </div>
            <div className="text-right text-sm"><div className="text-txt">{fmtD(info.booking.checkIn)}</div><div className="text-faint">→ {fmtD(info.booking.checkOut)}</div></div>
          </div>
          {info.booking.webCheckin && <div className="mt-2 rounded-lg bg-[color:color-mix(in_srgb,var(--ok)_12%,transparent)] px-3 py-1.5 text-xs font-medium text-[color:var(--ok)]">Check-in già inviato — puoi aggiornare i dati e reinviare.</div>}
        </div>

        {/* Prenotazione di gruppo: un solo check-in per tutte le camere */}
        {isGroup && (
          <div className={`${box} mb-4 p-4`} style={{ borderColor: "var(--focus)" }}>
            <div className="flex items-center gap-2"><span className="text-lg">👥</span><h2 className="font-display text-base font-bold text-txt">Prenotazione di gruppo · {groupRooms.length} camere</h2></div>
            <p className="mt-1 text-xs text-dim">Compila qui gli ospiti di <b>tutte</b> le camere: per ogni persona scegli la <b>camera</b>. Al termine invii tutto in una volta.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{groupRooms.map((r) => <span key={r.b} className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-dim">{roomLabel(r)} · {(r.adults || 1) + (r.children || 0)} {(r.adults || 1) + (r.children || 0) === 1 ? "ospite" : "ospiti"}</span>)}</div>
          </div>
        )}

        {/* Bentornato: check-in veloce per ospiti di ritorno */}
        {info.returning && !info.booking.webCheckin && !isGroup && (
          <div className={`${box} mb-4 p-4`} style={{ borderColor: "var(--ok)" }}>
            <div className="flex items-center gap-2"><span className="text-lg">👋</span><h2 className="font-display text-base font-bold text-txt">Bentornato, {info.guest.firstName || doc?.firstName}!</h2></div>
            <p className="mt-1 text-xs text-dim">Abbiamo già i tuoi dati e il documento del soggiorno precedente. Controlla che sia tutto corretto qui sotto e conferma — oppure invia subito.</p>
            <button onClick={() => submit({ assumeConsent: true })} disabled={submitting || !signature} className="mt-3 w-full rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "var(--ok)" }}>{submitting ? "Invio…" : "Confermo: i dati sono corretti → invia check-in"}</button>
            <p className="mt-2 text-center text-[10px] text-faint">{signature ? "Confermando dichiari che i dati sono corretti e acconsenti al trattamento per la registrazione alla Questura." : "Per inviare, apponi la firma in fondo alla pagina."}</p>
          </div>
        )}

        {/* Dati ospite principale */}
        <div className={`${box} mb-4 p-4`}>
          <h2 className="mb-1 font-display text-lg font-bold text-txt">I tuoi dati</h2>
          <p className="mb-3 text-xs text-dim">Richiesti per legge per la comunicazione degli alloggiati alla Questura. I documenti restano riservati.</p>
          {doc && (
            <div className="grid gap-3 sm:grid-cols-2">
              {isGroup && <label className={`${lbl} sm:col-span-2`}>Camera *<select value={primaryRoom} onChange={(e) => setPrimaryRoom(e.target.value)} className={`${field} mt-1`}>{groupRooms.map((r) => <option key={r.b} value={r.b}>{roomLabel(r)}</option>)}</select></label>}
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
          {/* Foto documento (fronte + retro) + auto-compilazione, in fondo alla scheda */}
          <div className="mt-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-start gap-4">
              <DocFace label="Fronte documento" photo={photoFront} onPick={(f) => onPhoto(f, setPhotoFront, true)} onRemove={() => setPhotoFront(undefined)} onReread={() => { if (photoFront) extractDoc(photoFront); }} extracting={extracting} aiOff={aiOff} />
              <DocFace label="Retro documento" photo={photoBack} onPick={(f) => onPhoto(f, setPhotoBack)} onRemove={() => setPhotoBack(undefined)} extracting={extracting} aiOff={aiOff} />
            </div>
            {extractMsg && <div className="mt-2 text-[11px]" style={{ color: "var(--focus)" }}>✨ {extractMsg}</div>}
            {!aiOff && !photoFront && <p className="mt-1 text-[11px] text-faint">Fotografa il documento: i campi qui sopra si compilano da soli.</p>}
          </div>
        </div>

        {/* Co-ospiti (sezione sempre visibile: si può sempre aggiungere un ospite) */}
        <div className={`${box} mb-4 p-4`}>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">Altri ospiti</h2><button onClick={() => setExtras((p) => [...p, { ...emptyExtra(), room: isGroup ? (primaryRoom || groupRooms[0].b) : "" }])} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-focus hover:bg-wash">＋ Aggiungi</button></div>
            {extras.length === 0 ? (
              <p className="text-xs text-faint">Se con te soggiornano altre persone, aggiungile con &ldquo;＋ Aggiungi&rdquo;.</p>
            ) : (
            <div className="flex flex-col gap-3">
              {extras.map((e, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-dim">Ospite {i + 2}</span>
                    <button onClick={() => setExtras((p) => p.filter((_, j) => j !== i))} className="text-faint hover:text-[color:var(--err)]">✕</button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {isGroup && <select value={e.room} onChange={(ev) => setExtra(i, "room", ev.target.value)} className={`${field} sm:col-span-2`}>{groupRooms.map((r) => <option key={r.b} value={r.b}>Camera: {roomLabel(r)}</option>)}</select>}
                    <input value={e.firstName} onChange={(ev) => setExtra(i, "firstName", ev.target.value)} placeholder="Nome" className={field} />
                    <input value={e.lastName} onChange={(ev) => setExtra(i, "lastName", ev.target.value)} placeholder="Cognome" className={field} />
                    <select value={e.sex ?? ""} onChange={(ev) => setExtra(i, "sex", ev.target.value)} className={field}><option value="">Sesso</option><option value="M">Maschile</option><option value="F">Femminile</option></select>
                    <input type="date" value={e.birthDate} onChange={(ev) => setExtra(i, "birthDate", ev.target.value)} className={field} />
                    <input value={e.birthPlace} onChange={(ev) => setExtra(i, "birthPlace", ev.target.value)} placeholder="Luogo di nascita" className={field} />
                    <input value={e.citizenship} onChange={(ev) => setExtra(i, "citizenship", ev.target.value)} placeholder="Cittadinanza" className={field} />
                    <select value={e.docType} onChange={(ev) => setExtra(i, "docType", ev.target.value)} className={field}>{DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                    <input value={e.docNumber} onChange={(ev) => setExtra(i, "docNumber", ev.target.value)} placeholder="Numero documento" className={field} />
                    <input value={e.docPlace ?? ""} onChange={(ev) => setExtra(i, "docPlace", ev.target.value)} placeholder="Luogo di rilascio" className={`${field} sm:col-span-2`} />
                  </div>
                  {/* Foto documento (fronte + retro) + auto-compilazione, in fondo alla scheda dell'ospite */}
                  <div className="mt-2 flex flex-wrap items-start gap-3">
                    <DocFace label="Fronte documento" photo={e.photoFront || undefined} onPick={(f) => onExtraPhoto(f, i)} onRemove={() => setExtra(i, "photoFront", "")} onReread={() => { if (e.photoFront) extractExtra(e.photoFront, i); }} extracting={extracting} aiOff={aiOff} />
                    <DocFace label="Retro documento" photo={e.photoBack || undefined} onPick={(f) => onExtraPhotoBack(f, i)} onRemove={() => setExtra(i, "photoBack", "")} extracting={extracting} aiOff={aiOff} />
                  </div>
                </div>
              ))}
            </div>
            )}
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
                      <div className="text-xs text-dim">{eur(extraUnit(e))}{e.per === "night" ? ` · ${nightsN} notti` : e.per === "person" ? " · a persona" : ""}</div>
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
            {paidNow && <div className="mb-3 rounded-lg px-3 py-2 text-sm font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" }}>✓ Pagamento ricevuto — grazie! L&apos;incasso è stato registrato.</div>}
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
            {payErr && <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)", color: "var(--err)" }}>{payErr}</div>}
            <p className="mt-2 text-center text-[11px] text-faint">Il pagamento online arriva direttamente alla struttura (Stripe).</p>
          </div>
        )}

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
        <div className={`${box} mt-4 p-4`}>
          <label className={lbl}>Orario di arrivo previsto<select value={arrival} onChange={(e) => setArrival(e.target.value)} className={`${field} mt-1`}>{["Non lo so", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00", "dopo le 20:00"].map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
          <label className={lbl}>Note o richieste <span className="font-normal text-faint">(facoltative)</span><textarea value={guestReq} onChange={(e) => setGuestReq(e.target.value)} rows={3} className={`${field} mt-1 resize-y`} placeholder="Es. arriviamo in auto, culla, allergie, orari particolari…" /></label>
          <label className="mt-3 flex items-start gap-2 text-xs text-dim">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--focus)]" />
            <span>Confermo che i dati sono corretti e acconsento al trattamento dei dati personali e del documento ai fini della registrazione degli alloggiati (Questura) e degli adempimenti di legge.</span>
          </label>
          {/* Firma OBBLIGATORIA, subito prima dell'invio */}
          <div className="mt-4 border-t border-line pt-4">
            <h2 className="mb-1 font-display text-base font-bold text-txt">Firma <span style={{ color: "var(--err)" }}>*</span></h2>
            <p className="mb-3 text-xs text-dim">Firma per confermare la correttezza dei dati e l&apos;accettazione delle condizioni.</p>
            <SignaturePad value={signature} onChange={setSignature} />
          </div>
          {submitErr && <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)", color: "var(--err)" }}>{submitErr}</div>}
          <button onClick={() => (isGroup ? submitGroup() : submit())} disabled={!valid || submitting} className="mt-4 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{submitting ? "Invio…" : isGroup ? "Invia il check-in del gruppo" : "Invia il check-in"}</button>
          {!valid && <div className="mt-2 text-center text-[11px] text-faint">Per inviare: compila nome, cognome, data di nascita, numero documento, spunta il consenso e <b>firma</b>.</div>}
        </div>
      </div>
    </div>
  );
}
