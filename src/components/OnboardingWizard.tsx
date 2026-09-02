"use client";

import { useEffect, useMemo, useState } from "react";
import { STRUCTURE_TYPES } from "@/lib/types";
import { blankUser, fullPerms, USER_LANGS } from "@/lib/users";
import { isOnboardingActive, markOnboarded } from "@/lib/onboarding";

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);
const emailOk = (s: string) => /\S+@\S+\.\S+/.test(s);

const TIERS = [
  { key: "basic", name: "Basic", price: 29, structures: 1, desc: "1 struttura · l'essenziale per iniziare", includes: ["pms", "cm", "booking", "cassa"] },
  { key: "pro", name: "Pro", price: 59, structures: 3, desc: "fino a 3 strutture · marketing e automazioni", includes: ["pms", "cm", "booking", "cassa", "concierge", "housekeeping", "messaging", "meta", "bi"] },
  { key: "ultimate", name: "Ultimate", price: 99, structures: 8, desc: "fino a 8 strutture · tutto incluso", includes: ["pms", "cm", "booking", "cassa", "concierge", "housekeeping", "messaging", "meta", "bi", "site", "rms", "ratecheck", "team"] },
];

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-txt outline-none transition focus:border-focus";
const lbl = "mb-1 block text-xs font-medium text-dim";

type Cam = { name: string; count: string };

export default function OnboardingWizard() {
  const [active, setActive] = useState(false);
  useEffect(() => { setActive(isOnboardingActive()); }, []);

  const [step, setStep] = useState(0);
  // Profilo
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState("it");
  // Account
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
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
  const [camere, setCamere] = useState<Cam[]>([{ name: "Camera Standard", count: "1" }]);
  // Piano
  const [plan, setPlan] = useState("");

  const totalRooms = useMemo(() => camere.reduce((a, c) => a + (Number(c.count) || 0), 0), [camere]);
  const autoTier = TIERS[0]; // onboarding crea 1 struttura → consigliato Basic
  useEffect(() => { if (step === 5 && !plan) setPlan(autoTier.key); }, [step, plan, autoTier]);

  const setCam = (i: number, patch: Partial<Cam>) => setCamere((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addCam = () => setCamere((cs) => [...cs, { name: "", count: "1" }]);
  const delCam = (i: number) => setCamere((cs) => (cs.length > 1 ? cs.filter((_, j) => j !== i) : cs));

  const STEPS = [
    { title: "Benvenuto in Xenora", sub: "Configuriamo il tuo gestionale in pochi passi. Ci vogliono un paio di minuti." },
    { title: "Il tuo profilo", sub: "I dati dell'intestatario dell'account." },
    { title: "Il tuo accesso", sub: "Crea le credenziali con cui entrerai nel gestionale." },
    { title: "La tua struttura", sub: "La prima struttura da gestire (potrai aggiungerne altre)." },
    { title: "Le camere", sub: "Le tipologie di camera e quante ne hai per ciascuna." },
    { title: "Scegli il piano", sub: "Puoi cambiarlo quando vuoi da Abbonamento." },
    { title: "Tutto pronto!", sub: "Controlla il riepilogo e inizia. Poi potrai importare il calendario da Octorate." },
  ];

  const canNext = (() => {
    switch (step) {
      case 1: return !!(firstName.trim() && lastName.trim() && emailOk(email) && phone.trim());
      case 2: return !!(username.trim().length >= 3 && pw.length >= 6 && pw === pw2);
      case 3: return !!(sName.trim() && sType && sCity.trim());
      case 4: return camere.some((c) => c.name.trim() && Number(c.count) > 0);
      case 5: return !!plan;
      default: return true;
    }
  })();

  const finish = () => {
    // Struttura
    const sid = uid();
    const structure = { id: sid, name: sName.trim(), groupName: sName.trim(), type: sType, city: sCity.trim(), address: sAddress.trim(), streetNumber: sStreetNo.trim(), postalCode: sCap.trim(), province: sProvince.trim(), cin: sCin.trim(), active: true };
    // Tipologie + unità
    const roomTypes: object[] = []; const units: object[] = [];
    camere.forEach((c) => {
      const name = c.name.trim(); const n = Number(c.count) || 0;
      if (!name || n <= 0) return;
      const rtId = uid();
      roomTypes.push({ id: rtId, structureId: sid, name, beds: 2, basePrice: 80, maxOccupancy: 2 });
      for (let i = 1; i <= n; i++) units.push({ id: uid(), structureId: sid, roomTypeId: rtId, name: `${name} ${i}`, code: `${name.slice(0, 3).toUpperCase()}${i}` });
    });
    try {
      localStorage.setItem("spigolestay:data:v1", JSON.stringify({ structures: [structure], roomTypes, units, guests: [], bookings: [], events: [], rateOverrides: {} }));
      // Utente / profilo
      const u = blankUser();
      u.firstName = firstName.trim(); u.lastName = lastName.trim(); u.email = email.trim(); u.phone = phone.trim();
      u.language = language; u.username = username.trim(); u.status = "Attivo"; u.allStructures = true; u.perms = fullPerms();
      localStorage.setItem("spigolestay:users", JSON.stringify([u]));
      localStorage.setItem("spigolestay:currentuser", u.id);
      localStorage.setItem("spigolestay:account", JSON.stringify({ username: username.trim(), password: pw }));
      // Moduli dal piano scelto
      const tier = TIERS.find((t) => t.key === plan) ?? TIERS[0];
      const mods: Record<string, boolean> = {};
      ["pms", ...tier.includes].forEach((k) => { mods[k] = true; });
      localStorage.setItem("spigolestay:modules", JSON.stringify(mods));
      localStorage.setItem("spigolestay:plan", plan);
      localStorage.setItem("spigolestay:activestruct", sid);
      markOnboarded();
    } catch {}
    window.location.href = "/";
  };

  if (!active) return null;
  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-paper">
      {/* Progress */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-5 py-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#D97F57] to-[#B04A2C] font-display text-sm font-black text-white shadow">X</div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-faint"><span>Configurazione</span><span>{step + 1} / {STEPS.length}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full transition-all duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%`, backgroundColor: "var(--focus)" }} /></div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-xl px-5 py-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-txt">{s.title}</h1>
        <p className="mt-1 text-sm text-dim">{s.sub}</p>

        <div className="mt-6 space-y-4">
          {step === 0 && (
            <div className="rounded-xl border border-line bg-surface p-5 text-sm text-dim">
              <p>Imposteremo, uno alla volta:</p>
              <ul className="mt-3 space-y-2">
                {[["👤", "Profilo e credenziali di accesso"], ["🏠", "Struttura e camere"], ["💳", "Piano di abbonamento"], ["📅", "A breve: import prenotazioni da Octorate (CSV/iCal)"]].map(([i, tx]) => (
                  <li key={tx} className="flex items-start gap-2.5"><span className="text-base">{i}</span><span className="text-txt">{tx}</span></li>
                ))}
              </ul>
              <div className="mt-4 rounded-lg bg-wash px-3 py-2.5 text-[12px] text-dim">
                <span className="font-semibold text-txt">Ti servono:</span> nome struttura, indirizzo e numero camere.
              </div>
              <p className="mt-2 text-[11px] text-faint">Potrai modificare tutto in seguito dalle Impostazioni. I dati restano su questo dispositivo (prototipo).</p>
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              <label><span className={lbl}>Nome *</span><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inp} placeholder="Mario" /></label>
              <label><span className={lbl}>Cognome *</span><input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inp} placeholder="Rossi" /></label>
              <label className="col-span-2"><span className={lbl}>Email *</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inp} placeholder="mario@esempio.it" /></label>
              <label><span className={lbl}>Telefono *</span><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} placeholder="+39 333 …" /></label>
              <label><span className={lbl}>Lingua</span><select value={language} onChange={(e) => setLanguage(e.target.value)} className={inp}>{USER_LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}</select></label>
              <p className="col-span-2 text-[11px] text-faint">Useremo questi dati per l&apos;intestazione dell&apos;account e le comunicazioni. I dati fiscali (P.IVA/CF) li aggiungerai dopo, nell&apos;area Abbonamento.</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <label className="block"><span className={lbl}>Nome utente *</span><input value={username} onChange={(e) => setUsername(e.target.value)} className={inp} placeholder="mario.rossi" autoCapitalize="none" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><span className={lbl}>Password *</span><input value={pw} onChange={(e) => setPw(e.target.value)} type={showPw ? "text" : "password"} className={inp} placeholder="min 6 caratteri" /></label>
                <label><span className={lbl}>Conferma password *</span><input value={pw2} onChange={(e) => setPw2(e.target.value)} type={showPw ? "text" : "password"} className={inp} placeholder="ripeti" /></label>
              </div>
              <label className="flex items-center gap-2 text-xs text-dim"><input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> Mostra password</label>
              {pw && pw2 && pw !== pw2 && <p className="text-xs font-medium text-[color:var(--err)]">Le password non coincidono.</p>}
              <p className="text-[11px] text-faint">Per recuperare l&apos;accesso useremo l&apos;email inserita al passo precedente.</p>
              <p className="rounded-lg bg-wash px-3 py-2 text-[11px] text-faint">Prototipo: le credenziali restano salvate solo su questo dispositivo, non è un'autenticazione reale.</p>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2"><span className={lbl}>Nome struttura *</span><input value={sName} onChange={(e) => setSName(e.target.value)} className={inp} placeholder="Es. Spigole House" /></label>
              <label><span className={lbl}>Tipologia *</span><select value={sType} onChange={(e) => setSType(e.target.value)} className={inp}>{STRUCTURE_TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}</select></label>
              <label><span className={lbl}>Città *</span><input value={sCity} onChange={(e) => setSCity(e.target.value)} className={inp} placeholder="Siracusa" /></label>
              <label className="col-span-2"><span className={lbl}>Indirizzo</span><input value={sAddress} onChange={(e) => setSAddress(e.target.value)} className={inp} placeholder="Via / Piazza" /></label>
              <label><span className={lbl}>Civico</span><input value={sStreetNo} onChange={(e) => setSStreetNo(e.target.value)} className={inp} placeholder="12" /></label>
              <label><span className={lbl}>CAP</span><input value={sCap} onChange={(e) => setSCap(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" className={inp} placeholder="96100" /></label>
              <label><span className={lbl}>Provincia</span><input value={sProvince} onChange={(e) => setSProvince(e.target.value.toUpperCase().slice(0, 2))} className={inp} placeholder="SR" /></label>
              <label><span className={lbl}>CIN <span className="font-normal text-faint">(facolt.)</span></span><input value={sCin} onChange={(e) => setSCin(e.target.value)} className={inp} placeholder="IT…" /></label>
              <p className="col-span-2 text-[11px] text-faint">Indirizzo, CAP e provincia servono per ISTAT e tassa di soggiorno — puoi completarli anche dopo dalla scheda struttura.</p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-2">
              {camere.map((c, i) => (
                <div key={i} className="flex items-end gap-2">
                  <label className="flex-1"><span className={lbl}>Tipologia</span><input value={c.name} onChange={(e) => setCam(i, { name: e.target.value })} className={inp} placeholder="Es. Deluxe, Suite, Family…" /></label>
                  <label className="w-24"><span className={lbl}>N° camere</span><input value={c.count} onChange={(e) => setCam(i, { count: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={inp} placeholder="1" /></label>
                  <button onClick={() => delCam(i)} disabled={camere.length <= 1} className="mb-0.5 grid h-[42px] w-10 shrink-0 place-items-center rounded-lg border border-line text-faint transition hover:text-[color:var(--err)] disabled:opacity-30" title="Rimuovi">✕</button>
                </div>
              ))}
              <button onClick={addCam} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash">+ Aggiungi tipologia</button>
              <p className="pt-1 text-[11px] text-faint">Totale camere: <b className="text-dim">{totalRooms}</b>. Creeremo le singole camere numerate automaticamente (le rinomini poi da «Camere»).</p>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-2.5">
              <p className="text-xs text-faint">Per iniziare consigliamo <b className="text-focus">{autoTier.name}</b> (1 struttura, 6 camere incluse). Lo cambi quando vuoi da Abbonamento.</p>
              {TIERS.map((tps) => {
                const on = plan === tps.key;
                return (
                  <button key={tps.key} onClick={() => setPlan(tps.key)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_10%,transparent)]" : "border-line bg-surface hover:bg-wash"}`}>
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-focus" : "border-line"}`}>{on && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--focus)" }} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="text-sm font-bold text-txt">{tps.name}</span>{tps.key === autoTier.key && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-focus">consigliato</span>}</span>
                      <span className="block text-[11px] text-dim">{tps.desc}</span>
                    </span>
                    <span className="shrink-0 font-mono text-sm font-bold text-txt">€{tps.price}<span className="text-[10px] font-normal text-faint">/mese</span></span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 6 && (
            <div className="rounded-xl border border-line bg-surface p-5 text-sm">
              {[["Profilo", `${firstName} ${lastName} · ${email}`], ["Accesso", username], ["Struttura", `${sName} · ${sType} · ${sCity}`], ["Camere", `${totalRooms} camere · ${camere.filter((c) => c.name.trim()).length} tipologie`], ["Piano", TIERS.find((t) => t.key === plan)?.name ?? "—"]].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-0">
                  <span className="text-xs font-semibold uppercase tracking-wide text-faint">{k}</span>
                  <span className="min-w-0 flex-1 text-right text-txt">{v}</span>
                </div>
              ))}
              <p className="mt-3 text-[11px] text-faint">Dopo «Inizia» ti troverai la dashboard vuota: da lì importerai le prenotazioni da Octorate (CSV/iCal).</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <button onClick={() => setStep((n) => Math.max(0, n - 1))} disabled={step === 0} className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-dim transition hover:bg-wash disabled:opacity-0">← Indietro</button>
          {isLast ? (
            <button onClick={finish} className="rounded-lg bg-focus px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90">Inizia 🚀</button>
          ) : (
            <button onClick={() => canNext && setStep((n) => n + 1)} disabled={!canNext} className="rounded-lg bg-focus px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">Avanti →</button>
          )}
        </div>
        {!canNext && step > 0 && <p className="mt-2 text-right text-[11px] text-faint">Completa i campi obbligatori (*) per continuare.</p>}
      </div>
    </div>
  );
}
