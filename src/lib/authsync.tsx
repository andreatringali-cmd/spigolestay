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

interface AuthCtx {
  user: User | null;
  session: Session | null;
  enabled: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function Splash({ label }: { label: string }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "#f7f4f0", color: "#5b5148", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: 46, height: 46, borderRadius: 14, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 22, background: "linear-gradient(135deg,#D97F57,#B04A2C)", boxShadow: "0 8px 24px rgba(176,74,44,.25)" }}>X</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
        <span style={{ width: 16, height: 16, border: "2px solid #d9cfc4", borderTopColor: "#B04A2C", borderRadius: "50%", display: "inline-block", animation: "xspin 0.7s linear infinite" }} />
        {label}
      </div>
      <style>{`@keyframes xspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const pushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPushed = useRef<string>("");

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

  // 3) Al login: scarica lo stato dal server e reidrata una sola volta per questo utente/tab.
  useEffect(() => {
    if (!supabaseEnabled || !supabase) return;
    const uid = session?.user?.id;
    if (!uid) { setHydrated(false); return; }
    let cancelled = false;
    const flagKey = "spigolestay:hydrated-for";

    const startPush = (userId: string) => {
      stopPush();
      pushTimer.current = setInterval(async () => {
        try {
          const snap = snapshot();
          const s = JSON.stringify(snap);
          if (s === lastPushed.current) return;
          lastPushed.current = s;
          await supabase!.from("app_state").upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() });
        } catch {}
      }, 4000);
    };

    (async () => {
      try {
        if (sessionStorage.getItem(flagKey) === uid) {
          // Già reidratato in questa scheda: salva SUBITO lo stato corrente sul server, così ciò
          // che è stato fatto prima di un reload (es. onboarding) viene salvato anche senza logout.
          try {
            const snap = snapshot();
            await supabase!.from("app_state").upsert({ user_id: uid, data: snap, updated_at: new Date().toISOString() });
            lastPushed.current = JSON.stringify(snap);
          } catch { lastPushed.current = ""; }
          setHydrated(true);
          startPush(uid);
          return;
        }
        const { data, error } = await supabase!.from("app_state").select("data").eq("user_id", uid).maybeSingle();
        if (cancelled) return;
        if (error) {
          // Problema di rete/permessi: NON tocchiamo i dati locali, per non perderli.
          // Riprendiamo comunque il salvataggio periodico (che ritenterà a ogni ciclo).
          lastPushed.current = JSON.stringify(snapshot());
          setHydrated(true);
          startPush(uid);
          return;
        }
        const serverData = (data?.data ?? null) as Record<string, string> | null;
        if (serverData && Object.keys(serverData).length > 0) {
          // Ci sono dati sul server: portali nel browser e ricarica per far ripartire l'app pulita.
          restore(serverData);
          sessionStorage.setItem(flagKey, uid);
          location.reload();
          return;
        }
        // Nessuna riga sul server = ACCOUNT NUOVO. Deve partire da zero e vedere la procedura
        // guidata: non deve ereditare dati rimasti nel browser da usi/altri account precedenti.
        wipeLocalAccount();
        try {
          localStorage.setItem("spigolestay:forcereset:v1", "1"); // evita il wipe+reload automatico dello store
          localStorage.setItem("spigolestay:zeroprices:v1", "1");  // evita migrazioni sui dati demo
          localStorage.setItem("spigolestay:onboarded", "0");      // attiva la procedura guidata (struttura, camere…)
        } catch {}
        const snap = snapshot();
        await supabase!.from("app_state").upsert({ user_id: uid, data: snap, updated_at: new Date().toISOString() });
        lastPushed.current = JSON.stringify(snap);
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
  }, [session?.user?.id]);

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
  if (!hydrated) return <Splash label="Carico i tuoi dati…" />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return { user: null, session: null, enabled: false, signOut: async () => {} };
  return ctx;
}
