"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { kvGet, kvSet, kvFlush } from "@/lib/bigstore";
import Image from "next/image";
import { STRUCTURE_TYPES, ROOM_TYPE_OPTIONS } from "@/lib/types";
import { blankUser, fullPerms, USER_LANGS } from "@/lib/users";
import { isOnboardingActive, markOnboarded, markCollaborator } from "@/lib/onboarding";
import { supabase } from "@/lib/supabase";
import { adoptProfile } from "@/lib/adopt-profile";
import { useAuth } from "@/lib/authsync";
import { TIERS as PLAN_TIERS, TRIAL_DAYS } from "@/lib/plans";
import { eur } from "@/lib/format";
import { PUB } from "@/components/PublicUi";

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);
const emailOk = (s: string) => /\S+@\S+\.\S+/.test(s);
// Posti letto suggeriti dalla tipologia (modificabili).
const guessBeds = (name: string): string => {
  const s = name.toLowerCase();
  if (s.includes("singola") || s.includes("uso singola") || s.includes("dus")) return "1";
  if (s.includes("tripla")) return "3";
  if (s.includes("quadrupla") || s.includes("familiare") || s.includes("family")) return "4";
  if (s.includes("dormitorio")) return "6";
  if (s.includes("appartamento") || s.includes("bilocale") || s.includes("trilocale") || s.includes("attico")) return "4";
  return "2"; // doppia, matrimoniale, standard, suite, ecc.
};

const MODULE_LABELS: Record<string, string> = {
  pms: "PMS · prenotazioni, calendario, ospiti",
  cm: "Channel Manager · sincro OTA",
  booking: "Booking Engine · prenotazioni dal tuo sito",
  cassa: "Cassa · prima nota",
  concierge: "Web Concierge · check-in online, upsell",
  housekeeping: "Housekeeping · planning pulizie",
  messaging: "Messaggi & automazioni ospiti",
  meta: "Meta Search · Google, Trivago…",
  bi: "Statistiche & BI",
  site: "Sito web integrato",
  rms: "Revenue · prezzi dinamici",
  ratecheck: "Rate checker · confronto tariffe",
  team: "Utenti & permessi · multi-utente",
  guide: "Guida ospiti · QR WiFi e codici d'ingresso",
  checkin: "Self check-in online · documenti e firma",
  sharing: "Gestione condivisa · co-gestisci con un socio",
  market: "Rete città · confronto con il mercato",
};

// Piani, prezzi e moduli arrivano da lib/plans.ts (fonte unica con la pagina Abbonamento): qui non si ridefiniscono.
const TIERS = PLAN_TIERS.map((t) => ({ ...t, desc: `${t.structures === 1 ? "1 struttura" : `fino a ${t.structures} strutture`} · ${t.tagline.toLowerCase()}` }));

// Campi, etichette, pulsanti e schede: gli stessi di login e pagine di accesso (PUB in components/PublicUi.tsx).

type Cam = { name: string; count: string; beds: string };

export default function OnboardingWizard() {
  const [active, setActive] = useState(false);
  const [hasData, setHasData] = useState(false); // utente di ritorno con dati già presenti
  useEffect(() => {
    // Xenora è ad invito: la guida "registra la tua struttura" è solo per i titolari. Un collaboratore (invitato da un titolare a co-gestire
    // la sua struttura) deve solo entrare e vedere le strutture condivise, quindi per lui la guida non compare mai.
    const wants = isOnboardingActive();
    let sharedStructure = false;
    try {
      const d = JSON.parse(kvGet("spigolestay:data:v1") || "{}");
      const sts = Array.isArray(d.structures) ? (d.structures as { orgId?: string }[]) : [];
      setHasData(sts.length > 0);
      sharedStructure = sts.some((x) => !!x?.orgId);
    } catch {}
    if (wants && sharedStructure) { markCollaborator(); setActive(false); } // ha già le strutture condivise: niente guida (ma sotto si scarica comunque il profilo)
    let cancelled = false;
    (async () => {
      let collaborator = false;
      let member = false;
      for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const token = supabase ? (await supabase.auth.getSession())?.data.session?.access_token : undefined;
        if (token) {
          // a ogni accesso: accetta gli inviti di condivisione in attesa sulla sua email e dice se è un collaboratore
          const r = await fetch("/api/org/role", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
          const j = (await r.json().catch(() => ({}))) as { collaborator?: boolean; member?: boolean; accepted?: number; profile?: Record<string, unknown> | null; email?: string | null };
          collaborator = !!j.collaborator;
          member = !!(j.member || j.collaborator);
          // ricordato nel browser (non sincronizzato) per il cancello dei permessi e per non inviare prezzi/disponibilità da qui
          try { if (collaborator) localStorage.setItem("xn-collab", "1"); else localStorage.removeItem("xn-collab"); window.dispatchEvent(new Event("xn-collab")); } catch { /* niente */ }
          // la scheda utente compilata dal titolare diventa la sua (dati, permessi, strutture)
          if (collaborator && j.profile && j.email) adoptProfile(j.profile, j.email);
          if (j.accepted && j.accepted > 0) { markCollaborator(); window.location.reload(); return; } // appena entrata in una struttura: ricarica per scaricarla
          break; // risposta ricevuta
        } else break;
      } catch { /* rete o server: un secondo tentativo dopo qualche secondo */ }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 4000));
      }
      if (cancelled) return;
      if (!wants) { setActive(false); return; }
      if (collaborator || member) { markCollaborator(); setActive(false); return; } // chi lavora su strutture altrui non registra una struttura propria
      setActive(true);
    })();
    return () => { cancelled = true; };
  }, []);
  const skipOnboarding = () => { markOnboarded(); setActive(false); };
  const { enabled: authEnabled, signOut, user: authUser } = useAuth();

  // Username scelto nel primo passo (pagina di login, arrivo dall'email di benvenuto) e email
  // dell'account appena autenticato: precompilano i passi "Il tuo profilo" e "Il tuo accesso"
  // così non si richiedono due volte le stesse informazioni.
  useEffect(() => {
    if (authUser?.email) setEmail((e) => e || authUser.email!);
    try {
      const pre = localStorage.getItem("xn-prefill-username");
      if (pre) { setUsername(pre); localStorage.removeItem("xn-prefill-username"); }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.email]);

  const [step, setStep] = useState(0);
  // A ogni passo il titolo prende il focus: chi usa la tastiera o un lettore di schermo sa dove si trova.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (step > 0) titleRef.current?.focus(); }, [step]);
  // Profilo
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState("it");
  // Account
  const [username, setUsername] = useState("");
  // Struttura
  const [sName, setSName] = useState("");
  const [sType, setSType] = useState(STRUCTURE_TYPES[0]);
  const [sCity, setSCity] = useState("");
  const [sAddress, setSAddress] = useState("");
  const [sStreetNo, setSStreetNo] = useState("");
  const [sCap, setSCap] = useState("");
  const [sProvince, setSProvince] = useState("");
  const [sCin, setSCin] = useState("");
  // Camere
  const [camere, setCamere] = useState<Cam[]>([{ name: "Standard", count: "1", beds: "2" }]);
  // Piano
  const [plan, setPlan] = useState("");

  const totalRooms = useMemo(() => camere.reduce((a, c) => a + (Number(c.count) || 0), 0), [camere]);
  const autoTier = TIERS[0]; // onboarding crea 1 struttura → consigliato Basic
  useEffect(() => { if (step === 5 && !plan) setPlan(autoTier.key); }, [step, plan, autoTier]);

  const setCam = (i: number, patch: Partial<Cam>) => setCamere((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addCam = () => setCamere((cs) => [...cs, { name: "", count: "1", beds: "2" }]);
  const delCam = (i: number) => setCamere((cs) => (cs.length > 1 ? cs.filter((_, j) => j !== i) : cs));

  const STEPS = [
    { title: "Benvenuto in Xenora", sub: "Configuriamo il tuo gestionale in pochi passi: ci vogliono un paio di minuti." },
    { title: "Il tuo profilo", sub: "I dati dell'intestatario dell'account." },
    { title: "Il tuo accesso", sub: "Crea le credenziali con cui entrerai nel gestionale." },
    { title: "La tua struttura", sub: "La prima struttura da gestire (potrai aggiungerne altre)." },
    { title: "Le camere", sub: "Le tipologie di camera e quante ne hai per ciascuna." },
    { title: "Scegli il piano", sub: `${TRIAL_DAYS} giorni di prova gratuita. Il piano si attiva e si paga dall'area Abbonamento, e lo cambi quando vuoi.` },
    { title: "Tutto pronto", sub: "Controlla il riepilogo e inizia: potrai importare le prenotazioni esistenti subito dopo." },
  ];

  const canNext = (() => {
    switch (step) {
      case 1: return !!(firstName.trim() && lastName.trim() && emailOk(email) && phone.trim());
      case 2: return !!(username.trim().length >= 3);
      case 3: return !!(sName.trim() && sType && sCity.trim());
      case 4: return camere.some((c) => c.name.trim() && Number(c.count) > 0);
      case 5: return !!plan;
      default: return true;
    }
  })();

  const finish = () => {
    // Struttura
    const sid = uid();
    const structure = { id: sid, name: sName.trim(), groupName: sName.trim(), type: sType, city: sCity.trim(), address: sAddress.trim(), streetNumber: sStreetNo.trim(), postalCode: sCap.trim(), province: sProvince.trim(), cin: sCin.trim(), active: true, checkOutBy: "10:30" };
    // Tipologie + unità
    const roomTypes: object[] = []; const units: object[] = [];
    camere.forEach((c) => {
      const name = c.name.trim(); const n = Number(c.count) || 0;
      if (!name || n <= 0) return;
      const rtId = uid(); const beds = Number(c.beds) || 2;
      roomTypes.push({ id: rtId, structureId: sid, name, beds, basePrice: 0, maxOccupancy: beds });
      for (let i = 1; i <= n; i++) units.push({ id: uid(), structureId: sid, roomTypeId: rtId, name: String(i), code: `${name.replace(/\s+/g, "").slice(0, 3).toUpperCase()}${i}` });
    });
    try {
      kvSet("spigolestay:data:v1", JSON.stringify({ structures: [structure], roomTypes, units, guests: [], bookings: [], events: [], rateOverrides: {} }));
      // Utente / profilo
      const u = blankUser();
      u.firstName = firstName.trim(); u.lastName = lastName.trim(); u.email = email.trim(); u.phone = phone.trim();
      u.language = language; u.username = username.trim(); u.status = "Attivo"; u.allStructures = true; u.perms = fullPerms();
      localStorage.setItem("spigolestay:users", JSON.stringify([u]));
      localStorage.setItem("spigolestay:currentuser", u.id);
      // Moduli dal piano scelto
      const tier = TIERS.find((t) => t.key === plan) ?? TIERS[0];
      const mods: Record<string, boolean> = {};
      ["pms", ...tier.includes].forEach((k) => { mods[k] = true; });
      localStorage.setItem("spigolestay:modules", JSON.stringify(mods));
      localStorage.setItem("spigolestay:plan", plan);
      localStorage.setItem("spigolestay:activestruct", sid);
      markOnboarded();
    } catch {}
    void kvFlush().then(() => { window.location.href = "/"; });
  };

  if (!active) return null;
  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const req = <span aria-hidden="true" className="text-dim"> *</span>;
  const selectedTier = TIERS.find((t) => t.key === plan);
  const nTypes = camere.filter((c) => c.name.trim()).length;

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-paper" role="dialog" aria-modal="true" aria-labelledby="wiz-title">
      {/* Intestazione: marchio, avanzamento (una sola numerazione) e uscita */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3 sm:px-5">
          <Image src="/xenora-mark.png" alt="Xenora" width={34} height={34} priority className="shrink-0 object-contain" style={{ width: 34, height: 34 }} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-dim"><span>Configurazione</span><span>Passaggio {step + 1} di {STEPS.length}</span></div>
            <div role="progressbar" aria-label="Avanzamento della configurazione" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} className="h-1.5 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full bg-focus transition-all duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
          </div>
          {hasData && (
            <button onClick={skipOnboarding} aria-label="Ho già configurato: salta la configurazione" title="Salta la configurazione: hai già i tuoi dati" className={`${PUB.btnSecondary} shrink-0 h-9! px-3! font-medium!`}>
              <span className="sm:hidden">Salta</span><span className="hidden sm:inline">Ho già configurato</span>
            </button>
          )}
          {authEnabled && (
            <button onClick={() => void signOut()} aria-label="Esci" title="Esci e torna all'accesso" className={`${PUB.btnSecondary} shrink-0 h-9! px-3! font-medium!`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              <span className="hidden sm:inline">Esci</span>
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4 py-8 sm:px-5">
        <h1 id="wiz-title" ref={titleRef} tabIndex={-1} className={`${PUB.h1} outline-none`}>{s.title}</h1>
        <p className={PUB.lead}>{s.sub}</p>

        <div className={`mt-6 ${step === 5 ? "" : PUB.card}`}>
          {step === 0 && (
            <div className="text-sm">
              <p className="font-medium text-txt">Imposteremo, un passo alla volta:</p>
              <ol className="mt-4 space-y-3">
                {[["Profilo e accesso", "I tuoi dati e le credenziali con cui entrerai."], ["Struttura e camere", "Nome, indirizzo e tipologie di camera."], ["Piano di abbonamento", `${TRIAL_DAYS} giorni di prova gratuita, poi scegli tu.`]].map(([t, d], i) => (
                  <li key={t} className="flex items-start gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-focus" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)" }}>{i + 1}</span>
                    <span><span className="block font-medium text-txt">{t}</span><span className="block text-xs text-dim">{d}</span></span>
                  </li>
                ))}
              </ol>
              <div className="mt-5 rounded-lg bg-wash px-3 py-2.5 text-xs text-txt">
                <span className="font-semibold">Ti servono:</span> nome della struttura, indirizzo e numero di camere. Dopo la configurazione potrai importare le prenotazioni esistenti.
              </div>
              <p className="mt-3 text-xs text-dim">Potrai modificare tutto in seguito dalle Impostazioni. I tuoi dati sono salvati in modo sicuro sul tuo account Xenora.</p>
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-2 gap-4">
              <label><span className={PUB.label}>Nome{req}</span><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={PUB.field} placeholder="Mario" required autoComplete="given-name" /></label>
              <label><span className={PUB.label}>Cognome{req}</span><input value={lastName} onChange={(e) => setLastName(e.target.value)} className={PUB.field} placeholder="Rossi" required autoComplete="family-name" /></label>
              <label className="col-span-2"><span className={PUB.label}>Email{req}</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={PUB.field} placeholder="mario@esempio.it" required autoComplete="email" /></label>
              <label><span className={PUB.label}>Telefono{req}</span><input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className={PUB.field} placeholder="+39 333 1234567" required autoComplete="tel" /></label>
              <label><span className={PUB.label}>Lingua</span><select value={language} onChange={(e) => setLanguage(e.target.value)} className={PUB.field}>{USER_LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}</select></label>
              <p className="col-span-2 text-xs text-dim">Useremo questi dati per l&apos;intestazione dell&apos;account e le comunicazioni. I dati fiscali (P.IVA/CF) li aggiungerai dopo, nell&apos;area Abbonamento.</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <label className="block"><span className={PUB.label}>Nome utente{req}</span><input value={username} onChange={(e) => setUsername(e.target.value)} className={PUB.field} placeholder="mario.rossi" autoCapitalize="none" autoComplete="username" required aria-describedby="wiz-username-hint" /></label>
              <p id="wiz-username-hint" className="text-xs text-dim">È il nome con cui compari nel registro attività (almeno 3 caratteri). Per accedere usi sempre la tua email e la password dell&apos;account; per recuperarla useremo l&apos;email del passo precedente.</p>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-2 gap-4">
              <label className="col-span-2"><span className={PUB.label}>Nome struttura{req}</span><input value={sName} onChange={(e) => setSName(e.target.value)} className={PUB.field} placeholder="Es. Spigole House" required /></label>
              <label><span className={PUB.label}>Tipologia{req}</span><select value={sType} onChange={(e) => setSType(e.target.value)} className={PUB.field}>{STRUCTURE_TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}</select></label>
              <label><span className={PUB.label}>Città{req}</span><input value={sCity} onChange={(e) => setSCity(e.target.value)} className={PUB.field} placeholder="Siracusa" required /></label>
              <label className="col-span-2"><span className={PUB.label}>Indirizzo</span><input value={sAddress} onChange={(e) => setSAddress(e.target.value)} className={PUB.field} placeholder="Via / Piazza" /></label>
              <label><span className={PUB.label}>Civico</span><input value={sStreetNo} onChange={(e) => setSStreetNo(e.target.value)} className={PUB.field} placeholder="12" /></label>
              <label><span className={PUB.label}>CAP</span><input value={sCap} onChange={(e) => setSCap(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" className={PUB.field} placeholder="96100" /></label>
              <label><span className={PUB.label}>Provincia</span><input value={sProvince} onChange={(e) => setSProvince(e.target.value.toUpperCase().slice(0, 2))} className={PUB.field} placeholder="SR" /></label>
              <label><span className={PUB.label}>CIN <span className="font-normal text-dim">(facoltativo)</span></span><input value={sCin} onChange={(e) => setSCin(e.target.value)} className={PUB.field} placeholder="IT…" /></label>
              <p className="col-span-2 text-xs text-dim">Indirizzo, CAP e provincia servono per ISTAT e tassa di soggiorno: puoi completarli anche dopo dalla scheda struttura.</p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              {camere.map((c, i) => {
                const isCustom = !!c.name && !ROOM_TYPE_OPTIONS.includes(c.name);
                const selVal = isCustom ? "__other__" : c.name;
                return (
                  <div key={i} className="space-y-3 rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="w-full sm:flex-1"><span className={PUB.label}>Tipologia</span>
                        <select value={selVal} onChange={(e) => { const v = e.target.value; setCam(i, v === "__other__" ? { name: " " } : { name: v, ...(v ? { beds: guessBeds(v) } : {}) }); }} className={PUB.field}>
                          <option value="">Seleziona…</option>
                          {ROOM_TYPE_OPTIONS.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
                          <option value="__other__">Altro (personalizzata)…</option>
                        </select>
                      </label>
                      <label className="w-24"><span className={PUB.label}>N° camere</span><Stepper value={c.count} onChange={(v) => setCam(i, { count: v })} min={1} /></label>
                      <label className="w-24"><span className={PUB.label}>Posti letto</span><Stepper value={c.beds} onChange={(v) => setCam(i, { beds: v })} min={1} /></label>
                      <button type="button" onClick={() => delCam(i)} disabled={camere.length <= 1} className={`${PUB.btnSecondary} w-10! px-0! hover:text-[color:var(--err)] sm:w-9!`} aria-label={`Rimuovi la tipologia ${i + 1}`} title="Rimuovi">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                    {selVal === "__other__" && (
                      <input value={c.name.trimStart()} onChange={(e) => setCam(i, { name: e.target.value })} className={PUB.field} placeholder="Nome della tipologia (es. Camera con jacuzzi)" aria-label="Nome della tipologia personalizzata" autoFocus />
                    )}
                  </div>
                );
              })}
              <button type="button" onClick={addCam} className={`${PUB.btnSecondary} text-focus`}>Aggiungi tipologia</button>
              <p className="pt-1 text-xs text-dim">Totale camere: <b className="text-txt">{totalRooms}</b>. Creeremo le singole camere numerate automaticamente (le rinomini poi da «Camere»).</p>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <p className="text-sm text-dim">Per iniziare consigliamo <b className="text-txt">{autoTier.name}</b> (1 struttura, 6 camere incluse). Lo cambi quando vuoi da Abbonamento.</p>
              <div role="radiogroup" aria-label="Piano di abbonamento" className="space-y-3">
                {TIERS.map((tps, idx) => {
                  const on = plan === tps.key;
                  const prev = idx > 0 ? TIERS[idx - 1] : null;
                  const feats = tps.includes.filter((k) => k !== "pms" && (!prev || !prev.includes.includes(k)));
                  return (
                    <button type="button" role="radio" aria-checked={on} key={tps.key} onClick={() => setPlan(tps.key)} className={`block w-full rounded-xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_10%,transparent)]" : "border-line bg-surface hover:bg-wash"}`}>
                      <div className="flex items-center gap-3">
                        <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-focus" : "border-line"}`}>{on && <span className="h-2.5 w-2.5 rounded-full bg-focus" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2"><span className="font-display text-base font-bold text-txt">{tps.name}</span>{tps.key === autoTier.key && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-focus" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)" }}>Consigliato</span>}</span>
                          <span className="block text-xs text-dim">{tps.structures === 1 ? "1 struttura" : `fino a ${tps.structures} strutture`} · 6 camere incluse per struttura</span>
                        </span>
                        <span className="shrink-0 text-right font-mono text-sm font-bold text-txt">{eur(tps.price)}<span className="text-xs font-normal text-dim">/mese</span></span>
                      </div>
                      <ul className="mt-3 space-y-1 pl-8 text-xs text-dim">
                        {prev && <li className="font-semibold text-txt">Tutto {prev.name}, più:</li>}
                        {feats.map((k) => <li key={k} className="flex items-start gap-1.5"><span aria-hidden className="text-[color:var(--ok)]">✓</span>{MODULE_LABELS[k] ?? k}</li>)}
                      </ul>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-dim">Ogni piano include il <b className="text-txt">PMS</b> (prenotazioni, calendario, ospiti). Potrai aggiungere singoli moduli extra in qualsiasi momento dall&apos;area Abbonamento.</p>
            </div>
          )}

          {step === 6 && (
            <div className="text-sm">
              <dl>
                {[["Profilo", `${firstName} ${lastName} · ${email}`], ["Nome utente", username], ["Struttura", `${sName} · ${sType} · ${sCity}`], ["Camere", `${totalRooms} ${totalRooms === 1 ? "camera" : "camere"} · ${nTypes} ${nTypes === 1 ? "tipologia" : "tipologie"}`], ["Piano", `${selectedTier?.name ?? "—"} · prova gratuita di ${TRIAL_DAYS} giorni`]].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 first:pt-0 last:border-0">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-dim">{k}</dt>
                    <dd className="min-w-0 flex-1 text-right text-txt">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-dim">Dopo «Inizia» entri nel gestionale: da lì potrai importare le prenotazioni esistenti e collegare i tuoi canali.</p>
            </div>
          )}
        </div>

        {/* Navigazione: sempre Indietro a sinistra, Avanti a destra */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setStep((n) => Math.max(0, n - 1))} className={`${PUB.btnSecondary} ${step === 0 ? "invisible" : ""}`} aria-hidden={step === 0} tabIndex={step === 0 ? -1 : 0}>Indietro</button>
          {isLast ? (
            <button type="button" onClick={finish} className={`${PUB.btnPrimary} min-w-28`}>Inizia</button>
          ) : (
            <button type="button" onClick={() => canNext && setStep((n) => n + 1)} disabled={!canNext} className={`${PUB.btnPrimary} min-w-28`}>Avanti</button>
          )}
        </div>
        {!canNext && step > 0 && <p role="status" className="mt-3 text-right text-xs text-dim">Compila i campi contrassegnati con * per continuare.</p>}
      </div>
    </div>
  );
}

// Campo numerico con freccette +/− a destra.
function Stepper({ value, onChange, min = 0, max = 99 }: { value: string; onChange: (v: string) => void; min?: number; max?: number }) {
  const n = Number(value) || 0;
  const set = (x: number) => onChange(String(Math.max(min, Math.min(max, x))));
  return (
    <div className="relative">
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" className={`${PUB.field} pr-7 text-center`} />
      <div className="absolute inset-y-1 right-1 flex w-5 flex-col">
        <button type="button" tabIndex={-1} onClick={() => set(n + 1)} className="flex h-1/2 items-center justify-center rounded-sm text-[8px] leading-none text-dim transition hover:bg-wash hover:text-txt" aria-label="Aumenta">▲</button>
        <button type="button" tabIndex={-1} onClick={() => set(n - 1)} className="flex h-1/2 items-center justify-center rounded-sm text-[8px] leading-none text-dim transition hover:bg-wash hover:text-txt" aria-label="Diminuisci">▼</button>
      </div>
    </div>
  );
}
