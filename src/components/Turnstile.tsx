"use client";

// Widget CAPTCHA di Cloudflare Turnstile (anti-bot/brute-force sull'accesso).
// Compare solo se è impostata la site key pubblica (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
// Il token è monouso: per rigenerarlo, il genitore cambia la `key` del componente (remount).
import { useEffect, useRef } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { turnstile?: any }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string | null) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const render = () => {
      if (cancelled || !boxRef.current || !window.turnstile || idRef.current) return;
      try {
        idRef.current = window.turnstile.render(boxRef.current, {
          sitekey: siteKey,
          callback: (t: string) => onToken(t),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
          theme: "auto",
        });
      } catch { /* già renderizzato */ }
    };

    if (window.turnstile) {
      render();
    } else {
      if (!document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile"]')) {
        const s = document.createElement("script");
        s.src = SRC; s.async = true; s.defer = true;
        document.head.appendChild(s);
      }
      poll = setInterval(() => { if (window.turnstile) { if (poll) clearInterval(poll); render(); } }, 200);
    }

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      try { if (idRef.current && window.turnstile) window.turnstile.remove(idRef.current); } catch {}
      idRef.current = null;
    };
  }, [siteKey, onToken]);

  return <div ref={boxRef} className="mt-3" />;
}
