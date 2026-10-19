"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DOC_TYPES } from "@/lib/types";
import { downscaleImage } from "@/lib/images";
import { eur } from "@/lib/format";
import SignaturePad from "@/components/SignaturePad";
import { supabase } from "@/lib/supabase";
import MediaImg from "@/components/MediaImg";
import { isMediaRef } from "@/lib/media";
import { mapPool, photoAsDataUri, uploadCheckinAttachment, type AttachmentKind } from "@/lib/checkin-upload-client";
import { GuestLangPicker, useGuestLang } from "@/components/GuestLang";
import { dateLocale } from "@/lib/guest-i18n";
import DateTextField from "@/components/DateTextField";
import { fmtDate } from "@/lib/dates";
import { todayRome } from "@/lib/dates-rome";
import { REQUIRE_DOC_PHOTOS, checkinStatus, docTypeFromText, needsMoreGuests, roomHeads, stepsWithMissing, type CheckinStep, type Miss } from "@/lib/checkin-flow";
import { COUNTRY_OPTIONS } from "@/lib/alloggiati/countries";

// Check-in online per l'OSPITE — pagina PUBBLICA e SERVER-backed.
// Carica e salva tutto tramite /api/checkin (service role): funziona per l'ospite
// anonimo dal link email e persiste sul server (personale o struttura condivisa),
// senza dipendere dal localStorage del browser.
//
// Flusso a passi: 1 Dati ospiti · 2 Documenti · 3 Consenso e invio · 4 Pagamento (solo se c'è un saldo da pagare online).
// Il pagamento è DOPO l'invio dei dati e non è obbligatorio: pagare porta fuori dal sito (Stripe) e, se si pagasse prima di inviare,
// al ritorno il modulo sarebbe vuoto. Il pulsante di invio non è mai "spento senza spiegazione": se manca qualcosa lo dice e porta al campo.

const box = "rounded-xl border border-line bg-surface";
const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const fieldErr = field.replace("border-line", "border-[color:var(--err)] ring-1 ring-[color:var(--err)]");
const lbl = "block text-xs font-medium text-dim";
const fmtDL = (iso: string, locale: string) => { try { return `${new Date(iso + "T00:00:00").toLocaleDateString(locale, { weekday: "short" })} ${fmtDate(iso)}`; } catch { return iso; } };
const errBox = { backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)", color: "var(--err)" } as const;
const warnBox = { backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)",  } as const;
const okBox = { backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" } as const;

type T = (s: string, vars?: Record<string, string | number>) => string;


interface DocData { firstName: string; lastName: string; sex: string; birthDate: string; birthPlace: string; citizenship: string; docType: string; docNumber: string; docPlace: string }
const emptyExtra = () => ({ firstName: "", lastName: "", sex: "", birthDate: "", birthPlace: "", citizenship: "", docType: DOC_TYPES[0], docNumber: "", docPlace: "", photoFront: "", photoBack: "", room: "" });

// Controllo di upload di UNA faccia del documento (fronte o retro), riusato per
// l'ospite principale e per ogni co-ospite. Se `onReread` è passato, mostra il
// pulsante "✨ Rileggi dal documento" (solo quando l'AI è attiva).
function DocFace({ label, photo, onPick, onRemove, onReread, extracting, aiOff, t }: {
  label: string;
  photo?: string;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
  onReread?: () => void;
  extracting: boolean;
  aiOff: boolean;
  t: T;
}) {
  if (photo) {
    return (
      <div className="flex items-center gap-2">
        <MediaImg src={photo} alt={label} className="h-14 w-24 shrink-0 rounded border border-line object-cover" />
        <div className="flex flex-col items-start gap-1">
          <span className="text-[11px] font-medium text-dim">✓ {label}</span>
          {onReread && !aiOff && <button type="button" onClick={onReread} disabled={extracting} className="text-xs font-semibold text-focus hover:underline disabled:opacity-50 max-sm:py-2">{extracting ? t("Leggo…") : t("✨ Rileggi dal documento")}</button>}
          <button type="button" onClick={onRemove} className="text-[11px] text-dim hover:text-[color:var(--err)] max-sm:py-2">{t("Rimuovi")}</button>
        </div>
      </div>
    );
  }
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>
      {extracting && onReread ? t("Leggo…") : `${aiOff || !onReread ? "📷" : "✨"} ${label}`}
      <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPick(e.target.files?.[0])} />
    </label>
  );
}

interface Info {
  aiEnabled?: boolean;
  operator?: boolean; // il server riconosce chi guarda come operatore della struttura (vede i documenti e non deve firmare)
  returning?: boolean;
  group?: { b: string; code: string; roomType: string; unit: string; adults: number; children: number; webCheckin: boolean }[];
  booking: { id: string; code: string; status: string; checkIn: string; checkOut: string; adults: number; children: number; total: number; paid: number; cleaningFee: number; cityTax: number; cityTaxGroup?: number; groupBalance?: number; cityTaxExempt: boolean; cityTaxCollected?: boolean; webCheckin: boolean; arrivalTime: string; guestRequests: string; extras: { name: string; price: number }[]; extraGuests: (DocData & { docPhotoFront?: string; docPhotoBack?: string })[]; docPhotoFront: string | null; docPhotoBack: string | null; signature: string | null; invoiceRequest: Record<string, unknown> | null };
  guest: { firstName: string; lastName: string; email: string; phone: string; sex: string; birthDate: string; birthPlace: string; citizenship: string; docType: string; docNumber: string; docPlace: string; docPhotoFront?: string | null; docPhotoBack?: string | null; lang?: string | null };
  roomType: { name: string };
  unit: { name: string; accessInfo: string } | null;
  structure: { id?: string; name: string; color: string; logo?: string; phone: string; email: string; address: string; streetNumber: string; city: string; checkInFrom: string; checkOutBy: string; accessInfo: string; currency: string; stripeAccount: string; stripeChargesEnabled: boolean; extras: { id: string; name: string; desc: string; price: number; per: string }[] };
}

export default function CheckinPage() {
  return <Suspense fallback={null}><Engine /></Suspense>;
}

function Engine() {
  const params = useMemo(() => { try { const u = new URLSearchParams(window.location.search); return { slug: u.get("site") || "", b: u.get("b") || "", paid: u.get("paid") === "1", session: u.get("session_id") || "" }; } catch { return { slug: "", b: "", paid: false, session: "" }; } }, []);
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [inactive, setInactive] = useState(false); // prenotazione annullata/non più attiva: l'API risponde inactive:true
  // Lingua: scelta a mano > ?lang= > ricavata dalla prenotazione (scheda → Paese → prefisso del telefono) > browser > italiano.
  const { lang, setLang, t } = useGuestLang(info?.guest?.lang);
  const fmtD = (iso: string) => fmtDL(iso, dateLocale(lang));

  const [doc, setDoc] = useState<DocData | null>(null);
  const [arrival, setArrival] = useState("Non lo so");
  const [guestReq, setGuestReq] = useState("");
  const [extras, setExtras] = useState<ReturnType<typeof emptyExtra>[]>([]);
  const [primaryRoom, setPrimaryRoom] = useState(""); // camera assegnata all'ospite principale (prenotazioni di gruppo)
  const [photoFront, setPhotoFront] = useState<string | undefined>();
  const [photoBack, setPhotoBack] = useState<string | undefined>();
  const [signature, setSignature] = useState<string | undefined>();
  // L'operatore (loggato in Xenora) può compilare per conto dell'ospite: in quel caso la firma
  // NON è obbligatoria. L'ospite anonimo (dal link) invece deve firmare.
  const [isOperator, setIsOperator] = useState(false);
  const [opChecked, setOpChecked] = useState(false);
  // L'operatore lo stabilisce il SERVER (GET → `operator`): una sessione Supabase di un altro account non basta, il POST richiede l'appartenenza alla struttura.
  const [consent, setConsent] = useState(false);
  const [inv, setInv] = useState({ wants: false, kind: "privato", name: "", vat: "", taxCode: "", address: "", city: "", cap: "", province: "", sdiCode: "", pec: "" });
  const setI = (k: string, v: string | boolean) => setInv((p) => ({ ...p, [k]: v }));
  const [ups, setUps] = useState<Record<string, number>>({});
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<{ k: string; v?: Record<string, string | number> } | null>(null);
  const [ackMissing, setAckMissing] = useState(false); // ha già visto l'avviso "mancano ospiti" e vuole proseguire
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false); // ha scelto di rimodificare un check-in già inviato
  const [paidNow, setPaidNow] = useState(false);
  const [step, setStep] = useState<CheckinStep>(1);
  const [showErr, setShowErr] = useState(false); // dopo il primo tocco su "Avanti"/"Invia" con campi mancanti, i campi mancanti si evidenziano
  // "Aggiungi a Google Wallet": pulsante pubblico dopo il check-in, gated lato server
  // (GOOGLE_WALLET_* su Vercel). Se non configurato mostra un messaggio, mai un errore.
  const [walletState, setWalletState] = useState<"idle" | "loading" | "unavailable">("idle");
  const addToWallet = async () => {
    setWalletState("loading");
    try {
      const r = await fetch(`/api/wallet/pass?slug=${encodeURIComponent(params.slug)}&b=${encodeURIComponent(params.b)}`);
      const j = await r.json().catch(() => ({}));
      if (j?.ok && j.url) { window.open(j.url, "_blank"); setWalletState("idle"); return; }
    } catch {}
    setWalletState("unavailable");
  };
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
      const r = await fetch("/api/ai/checkin-extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: img }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503 && j?.error === "ai_not_configured") { setAiOff(true); setExtracting(false); return; }
      if (r.ok && j?.ok && j.fields) { apply(j.fields as Record<string, string>); setExtractMsg("Dati compilati dal documento — controllali al passo 1 prima di inviare."); }
      else setExtractMsg("Non sono riuscito a leggere il documento: compila i campi a mano.");
    } catch { setExtractMsg("Lettura non riuscita: compila i campi a mano."); }
    setExtracting(false);
  };
  // Ospite principale.
  const extractDoc = (img: string) => runExtract(img, (f) => setDoc((p) => {
    const base = p ?? { firstName: "", lastName: "", sex: "", birthDate: "", birthPlace: "", citizenship: "", docType: DOC_TYPES[0], docNumber: "", docPlace: "" };
    const merged = { ...base } as DocData;
    (Object.keys(f) as (keyof DocData)[]).forEach((k) => { if (k !== "docType" && f[k] && !String(base[k] || "").trim()) merged[k] = String(f[k]); });
    // Il tipo documento ha sempre un valore di partenza (il primo del menu): quello riconosciuto dall'AI lo sostituisce (un passaporto non resta "Carta d'identità").
    const dt = docTypeFromText(f.docType); if (dt && DOC_TYPES.includes(dt)) merged.docType = dt;
    return merged;
  }));
  // Co-ospite i-esimo: riempie solo i campi ancora vuoti di quell'ospite.
  const extractExtra = (img: string, i: number) => runExtract(img, (f) => setExtras((prev) => prev.map((e, j) => {
    if (j !== i) return e;
    const merged = { ...e } as Record<string, string>;
    Object.keys(f).forEach((k) => { if (k !== "docType" && f[k] && !String(merged[k] || "").trim()) merged[k] = String(f[k]); });
    const dt = docTypeFromText(f.docType); if (dt && DOC_TYPES.includes(dt)) merged.docType = dt;
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

  // Foto documento e firma già salvate le riceve solo l'operatore loggato (l'ospite anonimo compila sempre da capo): il bearer serve a questo.
  const operatorAuthHeader = async (): Promise<Record<string, string>> => {
    try { const tk = (await (supabase?.auth.getSession() ?? Promise.resolve({ data: { session: null } }))).data.session?.access_token; return tk ? { Authorization: `Bearer ${tk}` } : {}; } catch { return {}; }
  };
  // Carica su Storage (privato) le foto/la firma appena fatte, una per volta, e restituisce i riferimenti + i token da mandare al salvataggio.
  const uploadAll = async (bid: string, list: { src?: string; kind: AttachmentKind }[]) => {
    const res = await mapPool(list, 4, (x) => uploadCheckinAttachment(x.src, x.kind, { slug: params.slug, b: bid }));
    const uploads: Record<string, string> = {};
    for (const r of res) if (r?.token) uploads[r.ref] = r.token;
    return { refs: res.map((r) => r?.ref), uploads };
  };

  // Carica la prenotazione dal server.
  const load = async () => {
    if (!params.b) { setLoadErr("Link non valido: apri il check-in dal link ricevuto via email."); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/checkin?b=${encodeURIComponent(params.b)}${params.slug ? `&slug=${encodeURIComponent(params.slug)}` : ""}`, { headers: await operatorAuthHeader() });
      const j = await r.json().catch(() => ({}));
      if (j?.inactive) { setInactive(true); setInfo(null); }
      else if (!r.ok || !j?.ok) { setLoadErr(j?.error === "not_found" ? "Prenotazione non trovata." : "Impossibile caricare la prenotazione."); setInfo(null); }
      else {
        const d = j as Info;
        setInfo(d);
        const b = d.booking, g = d.guest;
        // Chi apre il link da ospite compila SEMPRE da capo (niente dati precompilati dal soggiorno precedente o dal check-in già inviato).
        // Solo l'operatore di Xenora, che compila per conto dell'ospite, vede i dati già salvati.
        const operator = d.operator === true;
        setIsOperator(operator); setOpChecked(true);
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
          const need = Math.max(0, (b.adults || 1) + (b.children || 0) - 1); // anche i bambini: la schedina Questura vuole tutti
          setExtras(b.extraGuests?.length ? b.extraGuests.map((e) => ({ ...emptyExtra(), ...e, photoFront: e.docPhotoFront || "", photoBack: e.docPhotoBack || "" })) : Array.from({ length: need }, emptyExtra));
        }
        if (b.invoiceRequest && operator) setInv((p) => ({ ...p, ...Object.fromEntries(Object.entries(b.invoiceRequest!).filter(([, v]) => v != null).map(([k, v]) => [k, v as string | boolean])) }));
        if (!operator) {
          setDoc({ firstName: "", lastName: "", sex: "", birthDate: "", birthPlace: "", citizenship: "", docType: DOC_TYPES[0], docNumber: "", docPlace: "" });
          setArrival("Non lo so"); setGuestReq(""); setPhotoFront(undefined); setPhotoBack(undefined); setSignature(undefined);
          const total = d.group && d.group.length > 1
            ? d.group.reduce((a, r) => a + Math.max(1, (r.adults || 1) + (r.children || 0)), 0)
            : Math.max(1, (b.adults || 1) + (b.children || 0));
          if (d.group && d.group.length > 1) {
            const slots = d.group.flatMap((r) => Array.from({ length: Math.max(1, (r.adults || 1) + (r.children || 0)) }, () => r.b));
            setExtras(Array.from({ length: Math.max(0, total - 1) }, (_, i) => ({ ...emptyExtra(), room: slots[i + 1] || d.group![0].b })));
          } else setExtras(Array.from({ length: Math.max(0, total - 1) }, emptyExtra));
        }
      }
    } catch { setLoadErr("Errore di rete."); }
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Dopo l'invio: rilegge la prenotazione SENZA toccare il modulo (saldo aggiornato con i servizi extra scelti). I servizi scelti ora sono già
  // nella prenotazione sul server, quindi si azzera la scelta locale per non contarli due volte.
  const refreshInfo = async () => {
    try {
      const r = await fetch(`/api/checkin?b=${encodeURIComponent(params.b)}${params.slug ? `&slug=${encodeURIComponent(params.slug)}` : ""}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) { setInfo(j as Info); setUps({}); }
    } catch {}
  };

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

  // Spegne il completamento automatico del browser su tutti i campi (l'ospite scrive i propri dati da zero).
  useEffect(() => { document.querySelectorAll("input, textarea, select").forEach((el) => { el.setAttribute("autocomplete", "off"); if (el instanceof HTMLInputElement && (el.type === "text" || el.type === "email" || el.type === "tel")) el.setAttribute("data-lpignore", "true"); }); });

  const setD = <K extends keyof DocData>(k: K, v: string) => setDoc((p) => (p ? { ...p, [k]: v } : p));
  const setExtra = (i: number, k: string, v: string) => setExtras((p) => p.map((e, j) => (j === i ? { ...e, [k]: v } : e)));

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
  const cityTax = b?.cityTaxCollected ? 0 : (b?.cityTax ?? 0); // tassa già incassata a parte dall'host: non si chiede di nuovo online
  const grand = accommodation ? accommodation + cleaning + baseExtras + upsellTotal + cityTax : 0;
  const paid = b?.paid ?? 0;
  // Gruppo di più camere: si paga UNA volta per tutte (residuo di ogni camera con la sua quota di tassa), non solo per questa camera.
  const groupPay = (info?.group?.length ?? 0) > 1 && typeof b?.groupBalance === "number";
  const balance = groupPay ? Math.round((b!.groupBalance! + upsellTotal) * 100) / 100 : Math.max(0, grand - paid);
  const canPay = !!st?.stripeChargesEnabled && !!st?.stripeAccount && balance > 0;
  // Testo mostrato nel Checkout Stripe (colonna sinistra): titolo + descrizione professionale.
  const dLong = (iso?: string) => fmtDate(iso);
  const payLabel = `Soggiorno · ${st?.name ?? "Struttura"}`;
  const payDesc = [
    [info?.roomType?.name, info?.unit ? `(${info.unit.name})` : ""].filter(Boolean).join(" "),
    b ? `${dLong(b.checkIn)} → ${dLong(b.checkOut)}` : "",
    nightsN ? `${nightsN} ${nightsN === 1 ? "notte" : "notti"}` : "",
    b?.code ? `Rif. ${b.code}` : "",
  ].filter(Boolean).join(" · ");

  // Prenotazione di gruppo: un unico check-in per più camere.
  const groupRooms = info?.group ?? [];
  const isGroup = groupRooms.length > 1;
  const roomLabel = (r: { roomType: string; unit: string; code: string }) => [r.roomType, r.unit].filter(Boolean).join(" · ") || r.code;
  const invoicePayload = inv.wants ? { wants: true, kind: inv.kind, name: inv.name.trim() || undefined, vat: inv.vat.trim() || undefined, taxCode: inv.taxCode.trim() || undefined, address: inv.address.trim() || undefined, city: inv.city.trim() || undefined, cap: inv.cap.trim() || undefined, province: inv.province.trim() || undefined, sdiCode: inv.sdiCode.trim() || undefined, country: "IT" } : { wants: false };

  // ── Cosa manca per inviare (logica pura in lib/checkin-flow.ts) ──
  const named = (e: { firstName?: string; lastName?: string }) => !!(e.firstName ?? "").trim() && !!(e.lastName ?? "").trim();
  const expectedGuests = isGroup ? groupRooms.reduce((a, r) => a + Math.max(1, (r.adults || 1) + (r.children || 0)), 0) : Math.max(1, (b?.adults || 1) + (b?.children || 0));
  const roomsWithGuest = new Set<string>([primaryRoom || groupRooms[0]?.b || "", ...extras.filter(named).map((e) => e.room || groupRooms[0]?.b || "")]);
  const missingRooms = isGroup ? groupRooms.filter((r) => !roomsWithGuest.has(r.b)).map((r) => r.roomType || r.code) : [];
  const status = checkinStatus({ doc, extras, photoFront, consent, signature, isOperator, expectedGuests, isGroup, missingRooms, primaryRoom: primaryRoom || groupRooms[0]?.b, requireDocPhotos: REQUIRE_DOC_PHOTOS });
  // Gruppi: indice (tra i co-ospiti) di chi fa da capocamera nelle camere diverse da quella di chi prenota: per lui/lei il documento è obbligatorio.
  const headExtraIdx = (() => {
    if (!isGroup) return new Set<number>();
    const pr = primaryRoom || groupRooms[0]?.b || "";
    const named2 = extras.map((e, i) => ({ e, i })).filter(({ e }) => named(e));
    const heads = roomHeads([{ room: pr, birthDate: doc?.birthDate }, ...named2.map(({ e }) => ({ room: e.room || pr, birthDate: e.birthDate }))], pr);
    const out = new Set<number>();
    for (const [room, idx] of heads) if (room !== pr && idx > 0) out.add(named2[idx - 1].i);
    return out;
  })();
  const valid = status.valid;
  // Campi dei dati ospiti obbligatori (tutti quelli della checklist tranne consenso, firma, foto e camere del gruppo, controllati a parte).
  const DATA_CODES = ["firstName", "lastName", "sex", "birthDate", "birthPlace", "citizenship", "docNumber", "docPlace"];
  const dataFieldsOk = status.blocking.every((m) => !DATA_CODES.includes(m.code));
  const maxBirth = todayRome(); // nessuna data di nascita nel futuro
  const missIds = new Set(status.blocking.map((m) => m.id));
  const fcls = (id: string) => (showErr && missIds.has(id) ? fieldErr : field);
  const stepWarn = stepsWithMissing(status.blocking);
  const personName = (n: number) => {
    const p = n === 1 ? doc : extras[n - 2];
    const nm = [p?.firstName, p?.lastName].filter((x) => (x ?? "").trim()).join(" ");
    return nm || (n === 1 ? t("Ospite principale") : `${t("Ospite")} ${n}`);
  };
  const who = (m: Miss) => ((m.guest ?? 1) > 1 ? ` · ${personName(m.guest!)}` : ""); // per i co-ospiti: di chi è il campo mancante
  const missText = (m: Miss): string => {
    switch (m.code) {
      case "firstName": return t("Compila il nome");
      case "lastName": return t("Compila il cognome");
      case "sex": return t("Sesso") + who(m);
      case "birthDate": return t("Inserisci la data di nascita") + who(m);
      case "birthPlace": return t("Luogo di nascita") + who(m);
      case "citizenship": return t("Cittadinanza") + who(m);
      case "docNumber": return t("Inserisci il numero del documento") + who(m);
      case "docPlace": return t("Luogo di rilascio") + who(m);
      case "group": return t("Assegna almeno un ospite a ogni camera: {rooms}", { rooms: (m.rooms ?? []).join(", ") });
      case "docPhoto": return t("Carica la foto del documento di {name}", { name: personName(m.guest ?? 1) });
      case "consent": return t("Spunta il consenso al trattamento dei dati personali");
      default: return t("Firma nel riquadro");
    }
  };
  // Porta l'ospite sul campo mancante: cambia passo se serve, scorre fino al campo e lo mette a fuoco.
  const flashTo = (id: string) => { setTimeout(() => { const el = document.getElementById(id); if (!el) return; el.scrollIntoView({ behavior: "smooth", block: "center" }); try { (el as HTMLElement).focus({ preventScroll: true }); } catch {} }, 90); };
  const goTo = (m: { step: CheckinStep; id: string }) => { setStep(m.step); flashTo(m.id); };
  const topScroll = () => { try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); } };
  const nextFrom1 = () => {
    const m = status.blocking.filter((x) => x.step === 1);
    if (m.length) { setShowErr(true); flashTo(m[0].id); return; }
    setStep(2); topScroll();
  };
  const goStep = (n: CheckinStep) => { setStep(n); topScroll(); };
  // Invio con dati ospite incompleti (anche dal pulsante rapido): non resta muto, evidenzia e porta al primo campo mancante.
  const missingToFirst = () => { setShowErr(true); const m = status.blocking.find((x) => DATA_CODES.includes(x.code)); if (m) goTo(m); };

  // Messaggio per l'errore restituito dal server (codici di POST /api/checkin).
  const submitErrOf = (code: string): { k: string } => {
    if (code === "write_conflict") return { k: "Riprova tra un istante." };
    if (code === "booking_inactive") return { k: "Questa prenotazione non è più attiva: contatta la struttura." };
    if (code === "invalid_birth_date") return { k: "Una data di nascita non è valida: controllala e riprova." };
    if (code === "signature_required" || code === "consent_required") return { k: "Firma e consenso sono obbligatori per inviare." };
    return { k: "Invio non riuscito. Riprova." };
  };

  // Invio di GRUPPO: distribuisce gli ospiti per camera e salva ogni camera.
  const submitGroup = async () => {
    const reqOk = !!doc && dataFieldsOk;
    if (doc && !reqOk) { missingToFirst(); return; }
    if (!info || !doc || !reqOk || !consent || (!isOperator && !signature) || submitting) return;
    type Person = { room: string; d: DocData; pf?: string; pb?: string };
    const people: Person[] = [{ room: primaryRoom || groupRooms[0].b, d: doc, pf: photoFront, pb: photoBack }];
    extras.filter((e) => e.firstName.trim() && e.lastName.trim()).forEach((e) => people.push({ room: e.room || groupRooms[0].b, d: e as unknown as DocData, pf: e.photoFront || undefined, pb: e.photoBack || undefined }));
    const missing = groupRooms.filter((r) => !people.some((p) => p.room === r.b));
    if (missing.length) { setSubmitErr({ k: "Assegna almeno un ospite a ogni camera: {rooms}", v: { rooms: missing.map((m) => m.roomType || m.code).join(", ") } }); return; }
    setSubmitting(true); setSubmitErr(null);
    try {
      const authH = await operatorAuthHeader();
      // Capocamera di ogni camera: chi prenota guida la sua camera, nelle altre la persona più grande (il suo documento finisce nella schedina come capofamiglia).
      const heads = roomHeads(people.map((p) => ({ room: p.room, birthDate: p.d.birthDate })), people[0].room);
      for (const r of groupRooms) {
        const inRoom = people.filter((p) => p.room === r.b);
        const primary = people[heads.get(r.b) ?? -1] ?? inRoom[0];
        const others = inRoom.filter((p) => p !== primary);
        const isMain = r.b === params.b;
        // Foto e firma su Storage privato (uno per volta); il salvataggio riceve solo i riferimenti.
        const att = await uploadAll(r.b, [{ src: primary.pf, kind: "photo" }, { src: primary.pb, kind: "photo" }, { src: signature, kind: "signature" }, ...others.flatMap((o) => [{ src: o.pf, kind: "photo" as const }, { src: o.pb, kind: "photo" as const }])]);
        const resp = await fetch("/api/checkin", {
          method: "POST", headers: { "content-type": "application/json", ...authH },
          body: JSON.stringify({
            slug: params.slug, b: r.b, consent: true,
            doc: { firstName: primary.d.firstName.trim(), lastName: primary.d.lastName.trim(), sex: primary.d.sex || undefined, birthDate: primary.d.birthDate, birthPlace: primary.d.birthPlace, citizenship: primary.d.citizenship, docType: primary.d.docType, docNumber: (primary.d.docNumber || "").trim(), docPlace: primary.d.docPlace },
            arrival, guestRequests: isMain ? (guestReq.trim() || undefined) : undefined,
            extraGuests: others.map((o, oi) => ({ firstName: o.d.firstName, lastName: o.d.lastName, sex: o.d.sex, birthDate: o.d.birthDate, birthPlace: o.d.birthPlace, citizenship: o.d.citizenship, docType: o.d.docType, docNumber: o.d.docNumber, docPlace: o.d.docPlace, docPhotoFront: att.refs[3 + 2 * oi], docPhotoBack: att.refs[4 + 2 * oi] })),
            docPhotoFront: att.refs[0], docPhotoBack: att.refs[1], signature: att.refs[2], uploads: att.uploads,
            invoiceRequest: isMain ? invoicePayload : undefined,
            chosenExtras: isMain ? upsellItems : [],
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok || !j?.ok) throw new Error(j?.error || "fail");
      }
      setDone(true); setEditing(false); window.scrollTo(0, 0); void refreshInfo();
    } catch (e) { setSubmitErr(submitErrOf(e instanceof Error ? e.message : "")); }
    setSubmitting(false);
  };

  const submit = async (opts?: { assumeConsent?: boolean }) => {
    const consented = opts?.assumeConsent || consent;
    const reqOk = !!doc && dataFieldsOk;
    if (doc && !reqOk) { missingToFirst(); return; }
    if (!info || !doc || !reqOk || !consented || (!isOperator && !signature) || submitting) return;
    // Se con la prenotazione soggiornano più persone di quelle inserite, avvisa prima di inviare (un secondo clic prosegue comunque).
    // L'avviso resta VICINO al pulsante (prima compariva in cima alla pagina, fuori vista).
    const total = Math.max(1, (info.booking.adults || 1) + (info.booking.children || 0));
    const entered = 1 + extras.filter((e) => e.firstName.trim() && e.lastName.trim()).length;
    if (!opts?.assumeConsent && entered < total && !ackMissing) {
      setAckMissing(true);
      return;
    }
    setSubmitting(true); setSubmitErr(null);
    try {
      const sendExtras = extras.filter((e) => e.firstName.trim() && e.lastName.trim());
      const att = await uploadAll(params.b, [{ src: photoFront, kind: "photo" }, { src: photoBack, kind: "photo" }, { src: signature, kind: "signature" }, ...sendExtras.flatMap((e) => [{ src: e.photoFront || undefined, kind: "photo" as const }, { src: e.photoBack || undefined, kind: "photo" as const }])]);
      const r = await fetch("/api/checkin", {
        method: "POST", headers: { "content-type": "application/json", ...(await operatorAuthHeader()) },
        body: JSON.stringify({
          slug: params.slug, b: params.b, consent: true,
          doc: { firstName: doc.firstName.trim(), lastName: doc.lastName.trim(), sex: doc.sex || undefined, birthDate: doc.birthDate, birthPlace: doc.birthPlace, citizenship: doc.citizenship, docType: doc.docType, docNumber: doc.docNumber.trim(), docPlace: doc.docPlace },
          arrival, guestRequests: guestReq.trim() || undefined,
          extraGuests: sendExtras.map((e, i) => ({ ...e, photoFront: undefined, photoBack: undefined, docPhotoFront: att.refs[3 + 2 * i], docPhotoBack: att.refs[4 + 2 * i] })),
          docPhotoFront: att.refs[0], docPhotoBack: att.refs[1], signature: att.refs[2], uploads: att.uploads,
          invoiceRequest: invoicePayload,
          chosenExtras: upsellItems,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) { setDone(true); setEditing(false); window.scrollTo(0, 0); void refreshInfo(); }
      else setSubmitErr(submitErrOf(j?.error));
    } catch { setSubmitErr({ k: "Errore di rete. Riprova." }); }
    setSubmitting(false);
  };

  // Tocco sul pulsante di invio: se manca qualcosa NON resta muto, porta al primo campo mancante e lo evidenzia.
  const onSubmitClick = () => {
    if (!valid) { setShowErr(true); goTo(status.blocking[0]); return; }
    void (isGroup ? submitGroup() : submit());
  };

  const payNow = async () => {
    if (!info || balance <= 0 || !st) return;
    setPaying(true); setPayErr("");
    try {
      const origin = window.location.origin;
      const back = `${origin}/checkin?site=${encodeURIComponent(params.slug)}&b=${encodeURIComponent(params.b)}&lang=${lang}`;
      const r = await fetch("/api/stripe/quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: balance, label: payLabel, desc: payDesc, email: info.guest.email, acct: st.stripeAccount || "", locale: lang, metadata: { bookingId: params.b, ...(groupPay ? { group: "1" } : {}) }, successUrl: back, cancelUrl: back }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.url) { window.location.href = j.url; return; }
      setPaying(false);
      // Mai codici grezzi (stripe_error, invalid_return_url, HTTP 500…) né messaggi inglesi di Stripe all'ospite: testo nella sua lingua.
      const code = String(j?.error || "");
      setPayErr(
        r.status === 503 || ["stripe_not_connected", "stripe_not_active", "stripe_not_configured", "no_stripe_account"].includes(code)
          ? t("Il pagamento online non è disponibile per questa prenotazione. Contatta la struttura per saldare.")
          : r.status === 429 || code === "troppe_richieste"
            ? t("Troppi tentativi ravvicinati. Attendi un minuto e riprova.")
            : t("Non è stato possibile avviare il pagamento. Nessun addebito è stato effettuato: riprova tra poco o contatta la struttura."),
      );
    } catch { setPaying(false); setPayErr(t("Errore di rete. Riprova.")); }
  };

  const accent = st?.color || "#4F46E5";
  const header = (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto max-w-5xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {st?.logo
            ? <img src={st.logo} alt={st?.name ?? "Logo"} className="h-9 w-auto max-w-[150px] object-contain" />
            : <div className="grid h-9 w-9 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: accent }}>{(st?.name ?? "SS").slice(0, 2).toUpperCase()}</div>}
          <div className="leading-tight"><div className="text-sm font-bold text-txt">{st?.name ?? "Xenora"}</div><div className="text-[11px] text-faint">{t("Gestisci la tua prenotazione")}</div></div>
          <div className="ml-auto"><GuestLangPicker lang={lang} setLang={setLang} label={t("Lingua")} /></div>
        </div>
      </div>
    </div>
  );

  if (loading) return <div className="min-h-full bg-wash">{header}<div className="mx-auto max-w-5xl px-4 py-16 text-center text-sm text-dim">{t("Carico la prenotazione…")}</div></div>;

  if (!info) return (
    <div className="min-h-full bg-wash">{header}
      <div className="mx-auto max-w-md px-4 py-16">
        <div className={`${box} p-6 text-center`}>
          <div className="text-3xl">🔎</div>
          <h1 className="mt-2 font-display text-lg font-bold text-txt">{inactive ? t("Prenotazione non attiva") : loadErr ? t(loadErr) : t("Prenotazione non trovata")}</h1>
          <p className="mt-1 text-sm text-dim">{inactive ? t("Questa prenotazione non è più attiva (annullata o scaduta), quindi il check-in online non è disponibile. Per informazioni contatta la struttura.") : t("Apri il check-in dal link ricevuto nell'email di conferma. Se il problema persiste, contatta la struttura.")}</p>
        </div>
      </div>
    </div>
  );

  // ── Indicatore di avanzamento ──
  // Il passo "Pagamento" compare solo se c'è un saldo da pagare online. Dopo l'invio i passi 1-3 sono completati.
  const alreadySent = !!info.booking.webCheckin && opChecked && !isOperator && !editing && (isGroup ? groupRooms.every((r) => r.webCheckin) : !needsMoreGuests(expectedGuests, info.booking.extraGuests?.length ?? 0));
  const showDone = done || alreadySent;
  const showPayStep = false; // il pagamento non fa più parte del check-in online: si salda in struttura o col link che manda il gestore
  const stepsList: { n: 1 | 2 | 3 | 4; label: string }[] = [
    { n: 1, label: t("Dati ospiti") }, { n: 2, label: t("Documenti") }, { n: 3, label: t("Consenso e invio") },
    ...(showPayStep ? [{ n: 4 as const, label: t("Pagamento") }] : []),
  ];
  const cur: number = showDone ? (showPayStep ? 4 : 99) : step; // a check-in inviato i passi 1-3 sono tutti ✓; resta "in corso" solo il pagamento
  const stepper = (
    <div className="sticky top-0 z-20 border-b border-line bg-surface">
      <ol className="mx-auto flex max-w-5xl items-start gap-1 px-4 py-2" aria-label={t("Avanzamento")}>
        {stepsList.map((s, i) => {
          const isDone = showDone ? s.n <= 3 : s.n < cur && !stepWarn.has(s.n as CheckinStep);
          const warn = !showDone && s.n < 4 && s.n !== cur && stepWarn.has(s.n as CheckinStep) && s.n < cur;
          const isCur = s.n === cur;
          const circle = isCur ? { backgroundColor: "var(--focus)", color: "#fff", borderColor: "var(--focus)" } : isDone ? { backgroundColor: "var(--ok)", color: "#fff", borderColor: "var(--ok)" } : warn ? { backgroundColor: "var(--warn)", color: "#fff", borderColor: "var(--warn)" } : undefined;
          const content = (
            <>
              <span className="grid h-7 w-7 place-items-center rounded-full border border-line text-xs font-bold text-dim" style={circle}>{isDone && !isCur ? "✓" : warn ? "!" : s.n}</span>
              <span className={`text-[10px] leading-tight [overflow-wrap:anywhere] ${isCur ? "font-bold text-txt" : "text-dim"}`}>{s.label}</span>
            </>
          );
          return (
            <li key={s.n} className="flex min-w-0 flex-1 items-start gap-1" aria-current={isCur ? "step" : undefined}>
              {showDone || s.n === 4
                ? <div className="flex min-w-0 flex-col items-center gap-1 text-center">{content}</div>
                : <button type="button" onClick={() => goStep(s.n as CheckinStep)} className="flex min-w-0 flex-col items-center gap-1 text-center">{content}</button>}
              {i < stepsList.length - 1 && <span className="mt-3.5 h-px min-w-2 flex-1 bg-line" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </div>
  );

  // ── Riepilogo importi (usato nel passo Pagamento) ──
  const paySummary = (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between"><span className="text-dim">{t("Soggiorno")}</span><span className="font-mono text-txt">{eur(accommodation)}</span></div>
      {cleaning > 0 && <div className="flex justify-between"><span className="text-dim">{t("Pulizia")}</span><span className="font-mono text-txt">{eur(cleaning)}</span></div>}
      {baseExtras > 0 && <div className="flex justify-between"><span className="text-dim">{t("Extra")}</span><span className="font-mono text-txt">{eur(baseExtras)}</span></div>}
      {upsellItems.map((x) => <div key={x.name} className="flex justify-between"><span className="text-dim">+ {x.name}</span><span className="font-mono text-txt">{eur(x.price)}</span></div>)}
      {cityTax > 0 && <div className="flex justify-between"><span className="text-dim">{t("Tassa di soggiorno")}{isGroup && b?.cityTaxGroup ? ` · ${t("quota di questa camera")}` : ""}</span><span className="font-mono text-txt">{eur(cityTax)}</span></div>}
      {cityTax > 0 && isGroup && b?.cityTaxGroup ? <div className="text-right text-[11px] text-faint">{t("Tassa del gruppo (tutte le camere)")}: {eur(b.cityTaxGroup)}</div> : null}
      <div className="mt-1 flex justify-between border-t border-line pt-2"><span className="font-semibold text-txt">{t("Totale")}</span><span className="font-mono font-bold text-txt">{eur(grand)}</span></div>
      {paid > 0 && <div className="flex justify-between"><span className="text-dim">{t("Già versato")}</span><span className="font-mono" style={{ color: "var(--ok)" }}>−{eur(paid)}</span></div>}
      <div className="flex justify-between"><span className="font-semibold text-txt">{groupPay ? t("Saldo del gruppo (tutte le camere)") : t("Saldo")}</span><span className="font-mono text-lg font-extrabold" style={{ color: balance > 0 ? "var(--err)" : "var(--ok)" }}>{eur(balance)}</span></div>
    </div>
  );

  // ── Check-in già inviato (appena inviato, oppure link riaperto): niente modulo vuoto ──
  if (showDone) return (
    <div className="min-h-full bg-wash pb-16">{header}{stepper}
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className={`${box} p-6 text-center`}>
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full text-white" style={{ backgroundColor: "var(--ok)" }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg></div>
          <h1 className="font-display text-2xl font-bold text-txt">{t("Check-in completato!")}</h1>
          <p className="mt-1 text-sm text-dim">{t("Grazie {name}. Abbiamo ricevuto i tuoi dati per il soggiorno a {structure}. A presto!", { name: doc?.firstName || info.guest.firstName, structure: st?.name ?? "" })}</p>
          {st?.checkInFrom && <p className="mt-3 text-sm text-txt">{t("Ti aspettiamo dal {date}, check-in dalle {time}.", { date: fmtD(info.booking.checkIn), time: st.checkInFrom })}</p>}
          <button type="button" onClick={() => { setDone(false); setEditing(true); setStep(1); setShowErr(false); setAckMissing(false); topScroll(); }} className="mt-3 text-xs font-medium text-focus hover:underline max-sm:py-2">{t("Devi correggere qualcosa o aggiungere un ospite? Modifica i dati")}</button>
          <div className="mx-auto mt-4 max-w-sm">
            {walletState === "unavailable"
              ? <p className="mt-2 text-center text-xs text-faint">{t("Aggiungi a Google Wallet: disponibile a breve.")}</p>
              : <button type="button" onClick={addToWallet} disabled={walletState === "loading"} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface py-2.5 text-sm font-semibold text-txt hover:opacity-90 disabled:opacity-50">{walletState === "loading" ? t("Preparo il pass…") : t("🔖 Aggiungi a Google Wallet")}</button>}
          </div>
        </div>

        <div className={`${box} mt-4 p-5 text-left`}>
          <h2 className="mb-3 font-display text-lg font-bold text-txt">{t("Informazioni utili")}</h2>
          <div className="flex flex-col gap-2 text-sm">
            {st?.address && <div className="flex gap-2"><span>📍</span><span className="text-txt">{[st.address, st.streetNumber].filter(Boolean).join(" ")}{st.city ? `, ${st.city}` : ""}</span></div>}
            {(info.unit?.accessInfo || st?.accessInfo) && <div className="flex gap-2"><span>🔑</span><span className="text-txt">{info.unit?.accessInfo || st?.accessInfo}</span></div>}
            {st?.checkOutBy && <div className="flex gap-2"><span>🕙</span><span className="text-txt">{t("Check-out entro le {time}", { time: st.checkOutBy })}</span></div>}
            {st?.phone && <div className="flex gap-2"><span>📞</span><a href={`tel:${st.phone}`} className="text-focus hover:underline">{st.phone}</a></div>}
          </div>
          {st?.address && (() => {
            const q = encodeURIComponent([st.address, st.streetNumber, st.city].filter(Boolean).join(" "));
            return (
              <div className="mt-4">
                <iframe title={t("Mappa per arrivare")} src={`https://www.google.com/maps?q=${q}&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="h-52 w-full rounded-lg border border-line" />
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );

  // ── Elenco "ti manca ancora" (toccabile: porta al campo) ──
  const missList = (items: Miss[]) => (
    <ul className="mt-2 flex flex-col gap-1">
      {items.map((m, i) => (
        <li key={`${m.code}-${m.guest ?? 0}-${i}`}>
          <button type="button" onClick={() => { setShowErr(true); goTo(m); }} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:opacity-80" style={errBox}>
            <span aria-hidden>→</span><span><span className="font-bold">{t("Passo")} {m.step}</span> · {missText(m)}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  const navBtns = (back: CheckinStep | null, next?: { label: string; onClick: () => void }) => (
    <div className="mt-4 flex gap-2">
      {back && <button type="button" onClick={() => goStep(back)} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm font-semibold text-txt hover:bg-wash">← {t("Indietro")}</button>}
      {next && <button type="button" onClick={next.onClick} className="flex-1 rounded-lg bg-focus py-3 text-sm font-semibold text-white hover:opacity-90">{next.label}</button>}
    </div>
  );

  const step1Missing = status.blocking.filter((m) => m.step === 1);
  const filledExtras = extras.map((e, i) => ({ e, i })).filter(({ e }) => (e.firstName ?? "").trim() || (e.lastName ?? "").trim());
  const isFilled = (p?: { firstName?: string; lastName?: string; birthDate?: string; docNumber?: string } | null, strict = false) => !!p && !!(p.firstName ?? "").trim() && !!(p.lastName ?? "").trim() && (!strict || (!!p.birthDate && !!(p.docNumber ?? "").trim()));

  return (
    <div className="min-h-full bg-wash pb-16">{header}{stepper}
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Elenco degli Stati per l'autocompletamento della cittadinanza (il testo resta libero: il server riconosce anche i nomi inglesi) */}
        <datalist id="checkin-countries">{COUNTRY_OPTIONS.map((c) => <option key={c.it} value={c.it} label={c.en} />)}</datalist>
        {/* Riepilogo prenotazione */}
        <div className={`${box} mb-4 p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-display text-lg font-bold text-txt">{t("Ciao {name}, benvenuto!", { name: info.guest.firstName || doc?.firstName || "" })}</div>
              <div className="text-sm text-dim">{info.roomType.name}{info.unit ? ` · ${info.unit.name}` : ""} · {info.booking.adults} {info.booking.adults === 1 ? t("adulto") : t("adulti")}{info.booking.children ? ` · ${info.booking.children} ${info.booking.children === 1 ? t("bambino") : t("bambini")}` : ""}</div>
            </div>
            <div className="text-right text-sm"><div className="text-txt">{fmtD(info.booking.checkIn)}</div><div className="text-faint">→ {fmtD(info.booking.checkOut)}</div></div>
          </div>
          {info.booking.webCheckin && <div className="mt-2 rounded-lg px-3 py-1.5 text-xs font-medium" style={okBox}>{needsMoreGuests(expectedGuests, info.booking.extraGuests?.length ?? 0) && !isGroup ? t("Check-in già inviato, ma mancano i dati di altri ospiti: aggiungili e reinvia.") : t("Check-in già inviato — se devi aggiornare i dati, compila di nuovo tutti i campi e reinvia.")}</div>}
          {paidNow && <div className="mt-2 rounded-lg px-3 py-1.5 text-xs font-medium" style={okBox}>{t("✓ Pagamento ricevuto — grazie! L'incasso è stato registrato.")}</div>}
          {grand > 0 && !paidNow && (balance <= 0
            ? <div className="mt-2 text-xs font-medium" style={{ color: "var(--ok)" }}>{t("✓ Pagamento già ricevuto")}</div>
            : canPay ? <div className="mt-2 text-xs text-dim">{t("Saldo da pagare: {amount}. Lo potrai pagare online dopo aver inviato il check-in (facoltativo, oppure all'arrivo).", { amount: eur(balance) })}</div> : null)}
        </div>

        {/* ── PASSO 1 · Dati ospiti ── */}
        {step === 1 && (<>
          {/* Prenotazione di gruppo: un solo check-in per tutte le camere */}
          {isGroup && (
            <div className={`${box} mb-4 p-4`} style={{ borderColor: "var(--focus)" }}>
              <div className="flex items-center gap-2"><span className="text-lg">👥</span><h2 className="font-display text-base font-bold text-txt">{t("Prenotazione di gruppo")} · {groupRooms.length} {t("camere")}</h2></div>
              <p className="mt-1 text-xs text-dim">{t("Compila qui gli ospiti di tutte le camere: per ogni persona scegli la camera. Al termine invii tutto in una volta.")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{groupRooms.map((r) => { const n = (r.adults || 1) + (r.children || 0); return <span key={r.b} className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-dim">{roomLabel(r)} · {n} {n === 1 ? t("ospite") : t("ospiti")}</span>; })}</div>
            </div>
          )}

          {/* Bentornato: check-in veloce per ospiti di ritorno */}
          {info.returning && !info.booking.webCheckin && !isGroup && isOperator && (
            <div className={`${box} mb-4 p-4`} style={{ borderColor: "var(--ok)" }}>
              <div className="flex items-center gap-2"><span className="text-lg">👋</span><h2 className="font-display text-base font-bold text-txt">{t("Bentornato, {name}!", { name: info.guest.firstName || doc?.firstName || "" })}</h2></div>
              <p className="mt-1 text-xs text-dim">{t("Abbiamo già i tuoi dati e il documento del soggiorno precedente. Controlla che sia tutto corretto qui sotto e conferma — oppure invia subito.")}</p>
              <button onClick={() => submit({ assumeConsent: true })} disabled={submitting || (!isOperator && !signature)} className="mt-3 w-full rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "var(--ok)" }}>{submitting ? t("Invio…") : t("Confermo: i dati sono corretti → invia check-in")}</button>
              <p className="mt-2 text-center text-[10px] text-faint">{(isOperator || signature) ? t("Confermando dichiari che i dati sono corretti e acconsenti al trattamento per la registrazione alla Questura.") : t("Per inviare, apponi la firma in fondo alla pagina.")}</p>
            </div>
          )}

          {/* Dati ospite principale */}
          <div className={`${box} mb-4 p-4`}>
            <h2 className="mb-1 font-display text-lg font-bold text-txt">{t("I tuoi dati")}</h2>
            <p className="mb-3 text-xs text-dim">{t("Richiesti per legge per la comunicazione degli alloggiati alla Questura. I documenti restano riservati.")}</p>
            {!aiOff && !photoFront && <button type="button" onClick={() => goStep(2)} className="mb-3 w-full rounded-lg border border-dashed border-line px-3 py-2 text-left text-xs text-dim hover:border-focus">✨ {t("Hai il documento a portata di mano? Fotografalo al passo 2: i campi si compilano da soli.")}</button>}
            {doc && (
              <div className="grid gap-3 sm:grid-cols-2">
                {isGroup && <label className={`${lbl} sm:col-span-2`}>{t("Camera")} *<select value={primaryRoom} onChange={(e) => setPrimaryRoom(e.target.value)} className={`${field} mt-1`}>{groupRooms.map((r) => <option key={r.b} value={r.b}>{roomLabel(r)}</option>)}</select></label>}
                {isGroup && <div id="f-group" tabIndex={-1} className="sm:col-span-2" />}
                <label className={lbl}>{t("Nome")} *<input id="f-firstName" value={doc.firstName} onChange={(e) => setD("firstName", e.target.value)} className={`${fcls("f-firstName")} mt-1`} /></label>
                <label className={lbl}>{t("Cognome")} *<input id="f-lastName" value={doc.lastName} onChange={(e) => setD("lastName", e.target.value)} className={`${fcls("f-lastName")} mt-1`} /></label>
                <label className={lbl}>{t("Sesso")} *<select id="f-sex" value={doc.sex} onChange={(e) => setD("sex", e.target.value)} className={`${fcls("f-sex")} mt-1`}><option value="">—</option><option value="M">{t("Maschile")}</option><option value="F">{t("Femminile")}</option></select></label>
                <label className={lbl}>{t("Data di nascita")} *<DateTextField id="f-birthDate" value={doc.birthDate} onChange={(v) => setD("birthDate", v)} max={maxBirth} className={`${fcls("f-birthDate")} mt-1`} /></label>
                <label className={lbl}>{t("Luogo di nascita")} *<input id="f-birthPlace" value={doc.birthPlace} onChange={(e) => setD("birthPlace", e.target.value)} className={`${fcls("f-birthPlace")} mt-1`} placeholder={t("Comune o Stato")} /></label>
                <label className={lbl}>{t("Cittadinanza")} *<input id="f-citizenship" list="checkin-countries" value={doc.citizenship} onChange={(e) => setD("citizenship", e.target.value)} className={`${fcls("f-citizenship")} mt-1`} /></label>
                <label className={lbl}>{t("Tipo documento")}<select value={doc.docType} onChange={(e) => setD("docType", e.target.value)} className={`${field} mt-1`}>{DOC_TYPES.map((d) => <option key={d} value={d}>{t(d)}</option>)}</select></label>
                <label className={lbl}>{t("Numero documento")} *<input id="f-docNumber" value={doc.docNumber} onChange={(e) => setD("docNumber", e.target.value)} className={`${fcls("f-docNumber")} mt-1`} /></label>
                <label className={`${lbl} sm:col-span-2`}>{t("Luogo di rilascio")} *<input id="f-docPlace" value={doc.docPlace} onChange={(e) => setD("docPlace", e.target.value)} className={`${fcls("f-docPlace")} mt-1`} /></label>
              </div>
            )}
          </div>

          {/* Co-ospiti (sezione sempre visibile: si può sempre aggiungere un ospite) */}
          <div className={`${box} mb-4 p-4`}>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{t("Altri ospiti")}</h2><button onClick={() => setExtras((p) => [...p, { ...emptyExtra(), room: isGroup ? (primaryRoom || groupRooms[0].b) : "" }])} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-focus hover:bg-wash max-sm:min-h-10 max-sm:px-3">＋ {t("Aggiungi")}</button></div>
            {extras.length === 0 ? (
              <p className="text-xs text-faint">{t("Se con te soggiornano altre persone, aggiungile con «＋ Aggiungi».")}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {extras.map((e, i) => (
                  <div key={i} className="rounded-lg border border-line p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-dim">{t("Ospite")} {i + 2}</span>
                      <button onClick={() => setExtras((p) => p.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center text-faint hover:text-[color:var(--err)] max-sm:h-10 max-sm:w-10" aria-label={t("Rimuovi")}>✕</button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {isGroup && <select value={e.room} onChange={(ev) => setExtra(i, "room", ev.target.value)} className={`${field} sm:col-span-2`}>{groupRooms.map((r) => <option key={r.b} value={r.b}>{t("Camera")}: {roomLabel(r)}</option>)}</select>}
                      <input value={e.firstName} onChange={(ev) => setExtra(i, "firstName", ev.target.value)} placeholder={t("Nome")} className={field} />
                      <input value={e.lastName} onChange={(ev) => setExtra(i, "lastName", ev.target.value)} placeholder={t("Cognome")} className={field} />
                      <select id={`f-sex-${i + 2}`} value={e.sex ?? ""} onChange={(ev) => setExtra(i, "sex", ev.target.value)} className={fcls(`f-sex-${i + 2}`)}><option value="">{t("Sesso")}{named(e) ? " *" : ""}</option><option value="M">{t("Maschile")}</option><option value="F">{t("Femminile")}</option></select>
                      <DateTextField id={`f-birthDate-${i + 2}`} value={e.birthDate} onChange={(v) => setExtra(i, "birthDate", v)} max={maxBirth} className={fcls(`f-birthDate-${i + 2}`)} aria-label={t("Data di nascita")} />
                      <input id={`f-birthPlace-${i + 2}`} value={e.birthPlace} onChange={(ev) => setExtra(i, "birthPlace", ev.target.value)} placeholder={t("Luogo di nascita") + (named(e) ? " *" : "")} className={fcls(`f-birthPlace-${i + 2}`)} />
                      <input id={`f-citizenship-${i + 2}`} list="checkin-countries" value={e.citizenship} onChange={(ev) => setExtra(i, "citizenship", ev.target.value)} placeholder={t("Cittadinanza") + (named(e) ? " *" : "")} className={fcls(`f-citizenship-${i + 2}`)} />
                      <select value={e.docType} onChange={(ev) => setExtra(i, "docType", ev.target.value)} className={field}>{DOC_TYPES.map((d) => <option key={d} value={d}>{t(d)}</option>)}</select>
                      <input id={`f-docNumber-${i + 2}`} value={e.docNumber} onChange={(ev) => setExtra(i, "docNumber", ev.target.value)} placeholder={t("Numero documento") + (headExtraIdx.has(i) ? " *" : "")} className={headExtraIdx.has(i) ? fcls(`f-docNumber-${i + 2}`) : field} />
                      <input id={`f-docPlace-${i + 2}`} value={e.docPlace ?? ""} onChange={(ev) => setExtra(i, "docPlace", ev.target.value)} placeholder={t("Luogo di rilascio") + (headExtraIdx.has(i) ? " *" : "")} className={`${headExtraIdx.has(i) ? fcls(`f-docPlace-${i + 2}`) : field} sm:col-span-2`} />
                      {headExtraIdx.has(i) && <p className="text-[11px] text-dim sm:col-span-2">{t("Capocamera: servono i dati del documento (la schedina della camera è a suo nome).")}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {showErr && step1Missing.length > 0 && (
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--err)" }}>
              <div className="text-xs font-bold" style={{ color: "var(--err)" }}>{t("Per proseguire ti manca ancora:")}</div>
              {missList(step1Missing)}
            </div>
          )}
          {navBtns(null, { label: t("Avanti: documenti →"), onClick: nextFrom1 })}
        </>)}

        {/* ── PASSO 2 · Documenti ── */}
        {step === 2 && (<>
          <div className={`${box} mb-4 p-4`}>
            <h2 className="mb-1 font-display text-lg font-bold text-txt">{t("Documenti")}</h2>
            <p className="mb-3 text-xs text-dim">{t("Fotografa il documento di ogni ospite (fronte e retro). Non è obbligatorio, ma velocizza l'arrivo.")}{!aiOff ? ` ${t("I campi vuoti dei dati si compilano da soli.")}` : ""}</p>
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-line p-3">
                <div className="mb-2 text-xs font-semibold text-dim">{personName(1)}</div>
                <div id="f-docPhoto-1" tabIndex={-1} className="flex flex-wrap items-start gap-4">
                  <DocFace t={t} label={t("Fronte documento")} photo={photoFront} onPick={(f) => onPhoto(f, setPhotoFront, true)} onRemove={() => setPhotoFront(undefined)} onReread={() => { if (photoFront) void photoAsDataUri(photoFront).then(extractDoc).catch(() => setExtractMsg("Lettura non riuscita: compila i campi a mano.")); }} extracting={extracting} aiOff={aiOff} />
                  <DocFace t={t} label={t("Retro documento")} photo={photoBack} onPick={(f) => onPhoto(f, setPhotoBack)} onRemove={() => setPhotoBack(undefined)} extracting={extracting} aiOff={aiOff} />
                </div>
              </div>
              {extras.map((e, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="mb-2 text-xs font-semibold text-dim">{personName(i + 2)}</div>
                  <div id={`f-docPhoto-${i + 2}`} tabIndex={-1} className="flex flex-wrap items-start gap-3">
                    <DocFace t={t} label={t("Fronte documento")} photo={e.photoFront || undefined} onPick={(f) => onExtraPhoto(f, i)} onRemove={() => setExtra(i, "photoFront", "")} onReread={() => { if (e.photoFront) void photoAsDataUri(e.photoFront).then((d) => extractExtra(d, i)).catch(() => setExtractMsg("Lettura non riuscita: compila i campi a mano.")); }} extracting={extracting} aiOff={aiOff} />
                    <DocFace t={t} label={t("Retro documento")} photo={e.photoBack || undefined} onPick={(f) => onExtraPhotoBack(f, i)} onRemove={() => setExtra(i, "photoBack", "")} extracting={extracting} aiOff={aiOff} />
                  </div>
                </div>
              ))}
            </div>
            {extractMsg && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--focus)" }}>
                <span>✨ {t(extractMsg)}</span>
                <button type="button" onClick={() => goStep(1)} className="rounded-md border border-line bg-surface px-2 py-1 font-semibold text-txt hover:bg-wash max-sm:min-h-10 max-sm:px-3">{t("Controlla i dati")}</button>
              </div>
            )}
            {!aiOff && !photoFront && !extractMsg && <p className="mt-3 text-[11px] text-faint">{t("Fotografa il documento: i campi del passo 1 si compilano da soli.")}</p>}
          </div>
          {navBtns(1, { label: t("Avanti: consenso e invio →"), onClick: () => goStep(3) })}
        </>)}

        {/* ── PASSO 3 · Consenso e invio ── */}
        {step === 3 && (<>
          {/* Ricapitolo: cosa è stato inserito, con scorciatoie per correggere */}
          <div className={`${box} mb-4 p-4`}>
            <h2 className="mb-2 font-display text-lg font-bold text-txt">{t("Riepilogo")}</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {[{ n: 1, p: doc as { firstName?: string; lastName?: string; birthDate?: string; docNumber?: string } | null, photo: !!photoFront }, ...filledExtras.map(({ e, i }) => ({ n: i + 2, p: e, photo: !!e.photoFront }))].map(({ n, p, photo }) => {
                const dataOk = isFilled(p, n === 1);
                return (
                  <li key={n} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2">
                    <span className="font-medium text-txt">{personName(n)}</span>
                    <span className="flex items-center gap-3 text-xs">
                      <button type="button" onClick={() => goStep(1)} className="font-semibold" style={{ color: dataOk ? "var(--ok)" : "var(--err)" }}>{dataOk ? "✓" : "!"} {t("Dati")}</button>
                      <button type="button" onClick={() => goStep(2)} className="font-semibold" style={{ color: photo ? "var(--ok)" : "var(--warn)" }}>{photo ? "✓" : "–"} {t("Documento")}</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Servizi extra (upsell) */}
          {offer.length > 0 && (
            <div className={`${box} mb-4 p-4`}>
              <h2 className="mb-1 font-display text-lg font-bold text-txt">{t("Servizi extra")} <span className="text-xs font-normal text-faint">({t("facoltativi")})</span></h2>
              <p className="mb-3 text-xs text-dim">{t("Aggiungi comfort al tuo soggiorno: li troverai pronti all'arrivo.")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {offer.map((e) => {
                  const qy = ups[e.id] ?? 0;
                  return (
                    <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-txt">{e.name}</div>
                        {e.desc && <div className="text-[11px] text-faint">{e.desc}</div>}
                        <div className="text-xs text-dim">{eur(extraUnit(e))}{e.per === "night" ? ` · ${nightsN} ${nightsN === 1 ? t("notte") : t("notti")}` : e.per === "person" ? ` · ${t("a persona")}` : ""}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button type="button" onClick={() => setUps((u) => ({ ...u, [e.id]: Math.max(0, (u[e.id] ?? 0) - 1) }))} className="grid h-7 w-7 place-items-center rounded-lg border border-line text-txt hover:bg-wash max-sm:h-10 max-sm:w-10">−</button>
                        <span className="w-5 text-center font-mono text-sm">{qy}</span>
                        <button type="button" onClick={() => setUps((u) => ({ ...u, [e.id]: (u[e.id] ?? 0) + 1 }))} className="grid h-7 w-7 place-items-center rounded-lg border border-line text-txt hover:bg-wash max-sm:h-10 max-sm:w-10">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Richiedi fattura (facoltativo) */}
          <div className={`${box} mb-4 p-4`}>
            <label className="flex items-center justify-between">
              <span className="text-sm font-semibold text-txt">{t("Richiedo fattura")} <span className="text-xs font-normal text-faint">({t("facoltativo")})</span></span>
              <input type="checkbox" checked={inv.wants} onChange={(e) => setI("wants", e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" />
            </label>
            {inv.wants && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className={`${lbl} sm:col-span-2`}>{t("Tipo")}
                  <select value={inv.kind} onChange={(e) => setI("kind", e.target.value)} className={`${field} mt-1`}>
                    <option value="privato">{t("Privato")}</option><option value="societa">{t("Società / P.IVA")}</option><option value="estero">{t("Estero")}</option>
                  </select>
                </label>
                <label className={`${lbl} sm:col-span-2`}>{inv.kind === "societa" ? t("Ragione sociale") : t("Nome e cognome")}<input value={inv.name} onChange={(e) => setI("name", e.target.value)} className={`${field} mt-1`} /></label>
                {inv.kind === "societa" && <label className={lbl}>{t("Partita IVA")}<input value={inv.vat} onChange={(e) => setI("vat", e.target.value)} className={`${field} mt-1`} /></label>}
                {inv.kind !== "societa" && <label className={lbl}>{t("Codice fiscale")}<input value={inv.taxCode} onChange={(e) => setI("taxCode", e.target.value)} className={`${field} mt-1`} /></label>}
                {inv.kind === "societa" && <label className={lbl}>{t("Codice destinatario / PEC")}<input value={inv.sdiCode} onChange={(e) => setI("sdiCode", e.target.value)} placeholder={t("7 caratteri o PEC")} className={`${field} mt-1`} /></label>}
                <label className={`${lbl} sm:col-span-2`}>{t("Indirizzo")}<input value={inv.address} onChange={(e) => setI("address", e.target.value)} className={`${field} mt-1`} /></label>
                <label className={lbl}>{t("Città")}<input value={inv.city} onChange={(e) => setI("city", e.target.value)} className={`${field} mt-1`} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className={lbl}>{t("CAP")}<input value={inv.cap} onChange={(e) => setI("cap", e.target.value)} className={`${field} mt-1`} /></label>
                  <label className={lbl}>{t("Prov.")}<input value={inv.province} onChange={(e) => setI("province", e.target.value)} className={`${field} mt-1`} /></label>
                </div>
              </div>
            )}
          </div>

          {/* Arrivo + note */}
          <div className={`${box} mb-4 p-4`}>
            <label className={lbl}>{t("Orario di arrivo previsto")}<select value={arrival} onChange={(e) => setArrival(e.target.value)} className={`${field} mt-1`}>{["Non lo so", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00", "dopo le 20:00"].map((o) => <option key={o} value={o}>{t(o)}</option>)}</select></label>
            <label className={`${lbl} mt-3`}>{t("Note o richieste")} <span className="font-normal text-faint">({t("facoltative")})</span><textarea value={guestReq} onChange={(e) => setGuestReq(e.target.value)} rows={3} className={`${field} mt-1 resize-y`} placeholder={t("Es. arriviamo in auto, culla, allergie, orari particolari…")} /></label>
          </div>

          {/* Firma: obbligatoria per l'OSPITE; se compila l'operatore (loggato) NON serve. */}
          {!isOperator && (
            <div id="f-signature" tabIndex={-1} className={`${box} mb-4 p-4`} style={showErr && missIds.has("f-signature") ? { borderColor: "var(--err)", boxShadow: "0 0 0 1px var(--err)" } : undefined}>
              <h2 className="mb-1 font-display text-base font-bold text-txt">{t("Firma")} <span style={{ color: "var(--err)" }}>*</span></h2>
              <p className="mb-3 text-xs text-dim">{t("Firma per confermare la correttezza dei dati e l'accettazione delle condizioni.")}</p>
              {signature && isMediaRef(signature)
                ? <div className="flex items-end gap-3"><MediaImg src={signature} alt={t("Firma")} className="h-24 rounded-lg border border-line bg-white p-1" /><button type="button" onClick={() => setSignature(undefined)} className="text-[11px] font-medium text-dim hover:text-[color:var(--err)] max-sm:py-2">{t("Cancella firma")}</button></div>
                : <SignaturePad value={signature} onChange={setSignature} placeholder={t("Firma qui col dito o col mouse")} clearLabel={t("Cancella firma")} />}
              {showErr && missIds.has("f-signature") && <p className="mt-1 text-xs font-medium" style={{ color: "var(--err)" }}>{t("Firma nel riquadro")}</p>}
            </div>
          )}

          {/* Consenso privacy: ben visibile, subito sopra il pulsante di invio */}
          <div id="f-consent" tabIndex={-1} className="rounded-xl border-2 p-3" style={{ borderColor: showErr && missIds.has("f-consent") ? "var(--err)" : consent ? "var(--ok)" : "var(--focus)", backgroundColor: showErr && missIds.has("f-consent") ? "color-mix(in srgb, var(--err) 7%, transparent)" : "var(--surface)" }}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-[color:var(--focus)]" />
              <span className="text-sm text-txt">
                <b>{t("Consenso al trattamento dei dati personali")}</b> <span style={{ color: "var(--err)" }}>*</span>
                <span className="mt-1 block text-xs text-dim">{t("Confermo che i dati sono corretti e acconsento al trattamento dei dati personali e del documento ai fini della registrazione degli alloggiati (Questura) e degli adempimenti di legge.")}</span>
              </span>
            </label>
            <a href="/privacy" target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-focus hover:underline">{t("Leggi l'informativa privacy")}</a>
          </div>

          {/* Avvisi che non bloccano */}
          {status.advice.length > 0 && (
            <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={warnBox}>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {status.advice.map((a, i) => (
                  <li key={`${a.code}-${a.guest ?? 0}-${i}`}>
                    {a.code === "fewGuests" ? t(a.entered === 1 ? "Hai inserito {entered} persona su {total}. Per legge servono i dati di tutti gli ospiti (anche dei bambini): torna al passo 1 e usa «＋ Aggiungi»." : "Hai inserito {entered} persone su {total}. Per legge servono i dati di tutti gli ospiti (anche dei bambini): torna al passo 1 e usa «＋ Aggiungi».", { entered: a.entered ?? 0, total: a.total ?? 0 })
                      : a.code === "partialGuest" ? t("Ospite {n}: manca il nome o il cognome, quei dati non verranno inviati.", { n: a.guest ?? 0 })
                        : t("Foto del documento di {name}: consigliata (non obbligatoria).", { name: personName(a.guest ?? 1) })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {submitErr && <div className="mt-3 rounded-lg px-3 py-2 text-sm" style={errBox}>{t(submitErr.k, submitErr.v)}</div>}
          {ackMissing && valid && status.advice.some((a) => a.code === "fewGuests") && (
            <div className="mt-3 rounded-lg border-2 px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--warn)" }}>{t("Mancano i dati di alcuni ospiti. Se vuoi inviare comunque, tocca di nuovo «Invia il check-in»: potremo chiederti il resto più tardi.")}</div>
          )}

          {/* Pulsante di invio: mai muto. Bloccato = grigio ma leggibile, e al tocco porta al campo mancante. */}
          <button type="button" onClick={onSubmitClick} disabled={submitting} aria-disabled={!valid}
            className={`mt-4 w-full rounded-lg py-3.5 text-sm font-bold transition ${valid ? "bg-focus text-white hover:opacity-90" : "border border-line bg-wash text-dim"} disabled:opacity-50`}>
            {submitting ? t("Invio…") : `${valid ? "" : "🔒 "}${isGroup ? t("Invia il check-in del gruppo") : t("Invia il check-in")}`}
          </button>
          {valid
            ? <p className="mt-2 text-center text-xs font-medium" style={{ color: "var(--ok)" }}>{t("✓ Tutto pronto: tocca per inviare.")}</p>
            : (
              <div className="mt-2 rounded-xl border p-3" style={{ borderColor: "var(--err)" }}>
                <div className="text-xs font-bold" style={{ color: "var(--err)" }}>{t("Per inviare ti manca ancora:")}</div>
                {missList(status.blocking)}
              </div>
            )}
          {showPayStep && <p className="mt-3 text-center text-[11px] text-faint">{t("Dopo l'invio potrai pagare online il saldo (facoltativo, oppure all'arrivo).")}</p>}
          {navBtns(2)}
        </>)}
      </div>
    </div>
  );
}
