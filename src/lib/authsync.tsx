"use client";

// Autenticazione reale (Supabase) + sincronizzazione dello stato dell'account sul server.
//
// Strategia "rapida": tutto ciò che l'app salva nel browser (chiavi localStorage con prefisso
// spigolestay: / xenora:) viene rispecchiato come un unico blocco JSON nella tabella `app_state`,
// una riga per utente. Al login si scarica il blocco dal server e si reidrata il browser; ad ogni
// modifica (ogni pochi secondi, se qualcosa è cambiato) si ricarica sul server. Nessuna pagina
// esistente va riscritta: continuano a leggere/scrivere localStorage come prima.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseEnabled } from "./supabase";
import MfaChallenge from "@/components/MfaChallenge";

// Prefissi delle chiavi che rappresentano lo stato dell'account (da sincronizzare).
const SYNC_PREFIXES = ["spigolestay:", "xenora:"];
// Chiavi legate al singolo dispositivo/sessione: NON vanno sincronizzate.
const SKIP_KEYS = new Set<string>([
  "spigolestay:loginlogged",  // marcatore "accesso già loggato" per sessione tab
  "spigolestay:hydrated-for", // marcatore interno di reidratazione
]);

function isSyncKey(k: string): boolean {
  if (SKIP_KEYS.has(k)) return false;
  return SYNC_PREFIXES.some((p) => k.startsWith(p));
}

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isSyncKey(k)) out[k] = localStorage.getItem(k) ?? "";
    }
  } catch {}
  return out;
}

function restore(data: Record<string, string>) {
  try {
    // Rimuovi le chiavi di account attuali, poi scrivi quelle arrivate dal server.
    const toDel: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isSyncKey(k)) toDel.push(k);
    }
    toDel.forEach((k) => localStorage.removeItem(k));
    Object.entries(data).forEach(([k, v]) => {
      if (isSyncKey(k)) localStorage.setItem(k, v);
    });
  } catch {}
}

function wipeLocalAccount() {
  try {
    const toDel: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isSyncKey(k)) toDel.push(k);
    }
    toDel.forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem("spigolestay:loginlogged");
  } catch {}
}

// Uno stato contiene DATI REALI se ha almeno una struttura/prenotazione/ospite.
function hasRealData(obj: Record<string, string> | null | undefined): boolean {
  try {
    const raw = obj?.["spigolestay:data:v1"];
    if (!raw) return false;
    const d = JSON.parse(raw);
    return (Array.isArray(d.structures) && d.structures.length > 0)
      || (Array.isArray(d.bookings) && d.bookings.length > 0)
      || (Array.isArray(d.guests) && d.guests.length > 0);
  } catch { return false; }
}
// Firma del contenuto sincronizzato (indipendente dall'ordine delle chiavi jsonb):
// confronta i blocchi che contano per la sincronizzazione tra dispositivi.
function syncSignature(obj: Record<string, string> | null | undefined): string {
  if (!obj) return "";
  const keys = ["spigolestay:data:v1", "spigolestay:users", "spigolestay:plan", "spigolestay:modules", "spigolestay:daynotes"];
  return keys.map((k) => obj[k] ?? "").join("");
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  enabled: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function Splash({ label }: { label: string }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
      {/* Solo la farfalla Xenora che pulsa durante il caricamento */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/xenora-mark.png" alt={label || "Xenora"} width={72} height={72} style={{ width: 72, height: 72, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
      <style>{`@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [mfaChecked, setMfaChecked] = useState(false); // AAL verificato per la sessione corrente
  const [mfaNeeded, setMfaNeeded] = useState(false);    // il 2FA è attivo ma la sessione è a un fattore
  const pushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSynced = useRef<Record<string, string>>({}); // ultimo stato sincronizzato col server

  const stopPush = () => { if (pushTimer.current) { clearInterval(pushTimer.current); pushTimer.current = null; } };

  // 1) Sessione corrente + ascolto dei cambiamenti (login/logout/refresh token).
  useEffect(() => {
    if (!supabaseEnabled || !supabase) { setLoading(false); setHydrated(true); return; }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setLoading(false); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { setSession(s); setLoading(false); });
    return () => { mounted = false; sub.subscription.unsubscribe(); stopPush(); };
  }, []);

  // 2) Reindirizza al login se non autenticato.
  useEffect(() => {
    if (!supabaseEnabled) return;
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // 2b) Livello di sicurezza (2FA): se l'account ha il 2FA attivo e la sessione è ancora a un fattore,
  // va richiesto il secondo fattore. In caso di errore non blocchiamo (fail-open, evita lockout).
  useEffect(() => {
    if (!supabaseEnabled || !supabase) { setMfaChecked(true); setMfaNeeded(false); return; }
    if (!session) { setMfaChecked(true); setMfaNeeded(false); return; }
    let cancelled = false;
    setMfaChecked(false);
    (async () => {
      try {
        const { data, error } = await supabase!.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        setMfaNeeded(!error && !!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2");
      } catch { if (!cancelled) setMfaNeeded(false); }
      finally { if (!cancelled) setMfaChecked(true); }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // 3) Al login: scarica lo stato dal server e reidrata una sola volta per questo utente/tab.
  useEffect(() => {
    if (!supabaseEnabled || !supabase) return;
    const uid = session?.user?.id;
    if (!uid) { setHydrated(false); return; }
    if (!mfaChecked || mfaNeeded) return; // attendi la verifica 2FA prima di reidratare
    let cancelled = false;
    const flagKey = "spigolestay:hydrated-for";
    const authUser = session?.user;

    // Registro clienti: aggiorna la scheda del cliente (email, telefono, struttura/e, piano…)
    // sulla tabella `profiles`. Riempimento automatico a ogni accesso/aggiornamento.
    const syncProfile = async (userId: string) => {
      if (!supabase) return;
      try {
        let plan = "", structNames = "", stripeCustomer = "";
        let structCount = 0, roomsCount = 0;
        try { plan = localStorage.getItem("spigolestay:plan") || localStorage.getItem("spigolestay:tier") || ""; } catch {}
        try { stripeCustomer = localStorage.getItem("spigolestay:stripecustomer") || ""; } catch {}
        try {
          const raw = localStorage.getItem("spigolestay:data:v1");
          if (raw) {
            const d = JSON.parse(raw);
            if (Array.isArray(d.structures)) {
              structCount = d.structures.length;
              structNames = d.structures.map((s: { name?: string }) => s.name).filter(Boolean).join(", ");
            }
            if (Array.isArray(d.units)) roomsCount = d.units.filter((u: { outOfService?: boolean }) => !u.outOfService).length;
          }
        } catch {}
        const md = (authUser?.user_metadata ?? {}) as Record<string, unknown>;
        await supabase.from("profiles").upsert({
          user_id: userId,
          email: authUser?.email ?? null,
          full_name: (md.full_name as string) ?? null,
          phone: (md.phone as string) ?? null,
          plan: plan || null,
          structures_count: structCount,
          rooms_count: roomsCount,
          structure_names: structNames || null,
          stripe_customer_id: stripeCustomer || null,
          last_active: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch {}
    };

    const startPush = (userId: string) => {
      stopPush();
      pushTimer.current = setInterval(async () => {
        try {
          const snap = snapshot();
          // Sicurezza: non inviare MAI uno stato "rotto" (senza il blocco dati) che sovrascriverebbe
          // il server. Se manca la chiave dati, l'app non è ancora idratata: salta questo ciclo.
          if (!("spigolestay:data:v1" in snap)) return;
          const localChanged = syncSignature(snap) !== syncSignature(lastSynced.current);
          if (localChanged) {
            // PROTEZIONE ANTI-PERDITA: se il locale è vuoto ma il server ha dati reali, NON sovrascrivere.
            // Recupera invece i dati dal server (evita di cancellare tutto dopo un logout/onboarding).
            if (!hasRealData(snap)) {
              const { data: sd } = await supabase!.from("app_state").select("data").eq("user_id", userId).maybeSingle();
              const serverData = (sd?.data ?? null) as Record<string, string> | null;
              if (serverData && hasRealData(serverData)) { restore(serverData); lastSynced.current = serverData; location.reload(); return; }
            }
            // Ho modifiche locali (valide) → le invio al server.
            lastSynced.current = { ...snap };
            await supabase!.from("app_state").upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() });
            void syncProfile(userId);
            return;
          }
          // Nessuna modifica locale: controllo se un ALTRO dispositivo ha aggiornato il server.
          const { data } = await supabase!.from("app_state").select("data").eq("user_id", userId).maybeSingle();
          const serverData = (data?.data ?? null) as Record<string, string> | null;
          if (serverData && hasRealData(serverData) && syncSignature(serverData) !== syncSignature(snap)) {
            // Il server è cambiato altrove (es. dal telefono) → porto le modifiche su questo dispositivo.
            restore(serverData);
            lastSynced.current = serverData;
            location.reload();
          }
        } catch {}
      }, 4000);
    };

    (async () => {
      try {
        if (sessionStorage.getItem(flagKey) === uid) {
          // Già reidratato in questa scheda: salva lo stato corrente sul server SOLO se ha dati reali.
          // PROTEZIONE ANTI-PERDITA: se il locale è vuoto (es. dopo un reload/onboarding sul vuoto), non
          // sovrascrivere il server; anzi, se il server ha dati reali li recuperiamo qui.
          try {
            const snap = snapshot();
            if (hasRealData(snap)) {
              await supabase!.from("app_state").upsert({ user_id: uid, data: snap, updated_at: new Date().toISOString() });
              lastSynced.current = snap;
            } else {
              const { data: sd } = await supabase!.from("app_state").select("data").eq("user_id", uid).maybeSingle();
              const serverData = (sd?.data ?? null) as Record<string, string> | null;
              if (serverData && hasRealData(serverData)) {
                restore(serverData);
                lastSynced.current = serverData;
                location.reload();
                return;
              }
              lastSynced.current = snap;
            }
          } catch { lastSynced.current = {}; }
          void syncProfile(uid);
          setHydrated(true);
          startPush(uid);
          return;
        }
        const { data, error } = await supabase!.from("app_state").select("data").eq("user_id", uid).maybeSingle();
        if (cancelled) return;
        if (error) {
          // Problema di rete/permessi: NON tocchiamo i dati locali, per non perderli.
          // Riprendiamo comunque il salvataggio periodico (che ritenterà a ogni ciclo).
          lastSynced.current = snapshot();
          void syncProfile(uid);
          setHydrated(true);
          startPush(uid);
          return;
        }
        const serverData = (data?.data ?? null) as Record<string, string> | null;
        const serverReal = hasRealData(serverData);
        let localReal = false;
        try { localReal = hasRealData({ "spigolestay:data:v1": localStorage.getItem("spigolestay:data:v1") ?? "" }); } catch {}

        if (serverReal) {
          // Il server ha DATI REALI: portali nel browser e ricarica per far ripartire l'app pulita.
          restore(serverData!);
          sessionStorage.setItem(flagKey, uid);
          location.reload();
          return;
        }
        // Il server NON ha dati reali. Se il browser ne ha, il LOCALE vince (mai sovrascriverlo con
        // uno stato vuoto arrivato dal server): salviamo il locale sul server e proseguiamo.
        const localHasData = localReal;
        if (!localHasData && serverData && Object.keys(serverData).length > 0) {
          // Né server né browser hanno dati reali, ma il server ha impostazioni/onboarding salvati:
          // ripristinali così com'è (comportamento normale per un account senza prenotazioni).
          restore(serverData);
          sessionStorage.setItem(flagKey, uid);
          location.reload();
          return;
        }
        if (localHasData) {
          // Recupero: dati presenti nel browser ma non sul server → salvali sul server e prosegui.
          const snap = snapshot();
          await supabase!.from("app_state").upsert({ user_id: uid, data: snap, updated_at: new Date().toISOString() });
          lastSynced.current = snap;
          void syncProfile(uid);
          sessionStorage.setItem(flagKey, uid);
          setHydrated(true);
          startPush(uid);
          return;
        }
        // Account realmente nuovo (nessun dato né sul server né nel browser): procedura guidata.
        wipeLocalAccount();
        try {
          localStorage.setItem("spigolestay:forcereset:v1", "1"); // evita il wipe+reload automatico dello store
          localStorage.setItem("spigolestay:zeroprices:v1", "1");  // evita migrazioni sui dati demo
          localStorage.setItem("spigolestay:onboarded", "0");      // attiva la procedura guidata (struttura, camere…)
        } catch {}
        const snap = snapshot();
        await supabase!.from("app_state").upsert({ user_id: uid, data: snap, updated_at: new Date().toISOString() });
        lastSynced.current = snap;
        await syncProfile(uid);
        sessionStorage.setItem(flagKey, uid);
        location.reload(); // riparte pulito → compare l'onboarding
        return;
      } catch {
        // In caso di problemi di rete non blocchiamo l'uso dell'app (resta il salvataggio locale).
        setHydrated(true);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, mfaChecked, mfaNeeded]);

  const signOut = async () => {
    stopPush();
    let saved = false;
    const uid = session?.user?.id;
    try {
      if (supabase && uid) {
        // Salvataggio finale prima di uscire.
        const { error } = await supabase.from("app_state").upsert({ user_id: uid, data: snapshot(), updated_at: new Date().toISOString() });
        saved = !error;
      }
      if (supabase) await supabase.auth.signOut();
    } catch {}
    try { sessionStorage.removeItem("spigolestay:hydrated-for"); } catch {}
    // Svuota i dati locali SOLO se sono stati salvati sul server, altrimenti li perderei
    // (es. tabella app_state non ancora creata / rete assente).
    if (saved) wipeLocalAccount();
    router.replace("/login");
  };

  const value: AuthCtx = { user: session?.user ?? null, session, enabled: supabaseEnabled, signOut };

  // Modalità solo-locale (variabili non configurate): nessun gate.
  if (!supabaseEnabled) return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  if (loading) return <Splash label="Avvio…" />;
  if (!session) return <Splash label="Reindirizzamento all'accesso…" />;
  if (!mfaChecked) return <Splash label="Verifica sicurezza…" />;
  if (mfaNeeded) return <MfaChallenge onVerified={() => setMfaNeeded(false)} onSignOut={signOut} />;
  if (!hydrated) return <Splash label="Carico i tuoi dati…" />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return { user: null, session: null, enabled: false, signOut: async () => {} };
  return ctx;
}
