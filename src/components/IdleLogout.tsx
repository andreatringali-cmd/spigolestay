"use client";

// Logout automatico dopo un periodo di INATTIVITÀ (nessun movimento/tasto/tocco).
// Serve anche a non lasciare un account "dentro" se l'onboarding viene abbandonato.
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/authsync";

const IDLE_MS = 15 * 60 * 1000; // 15 minuti

export default function IdleLogout() {
  const { enabled, user, signOut } = useAuth();
  const uid = user?.id;
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReset = useRef(0);

  useEffect(() => {
    if (!enabled || !uid) return;

    const logout = () => { void signOutRef.current(); };
    const arm = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(logout, IDLE_MS); };
    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset.current < 2000) return; // throttle: al massimo una volta ogni 2s
      lastReset.current = now;
      arm();
    };

    const winEvents: string[] = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    winEvents.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onActivity);
    arm(); // avvia il conto alla rovescia

    return () => {
      winEvents.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onActivity);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, uid]);

  return null;
}
