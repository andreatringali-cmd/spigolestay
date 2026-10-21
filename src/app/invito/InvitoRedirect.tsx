"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PublicTheme from "@/components/PublicTheme";

// Pagina "ponte" dell'invito: memorizza il codice e porta l'amico all'abbonamento
// (dove viene registrato il collegamento invitante ↔ invitato).
export default function InvitoRedirect({ refCode }: { refCode: string }) {
  const router = useRouter();
  useEffect(() => {
    try { if (refCode) localStorage.setItem("spigolestay:pendingref", refCode); } catch {}
    const q = refCode ? `?ref=${encodeURIComponent(refCode)}` : "";
    const to = setTimeout(() => router.replace(`/abbonamento${q}`), 50);
    return () => clearTimeout(to);
  }, [refCode, router]);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper" role="status" aria-busy="true" aria-label="Caricamento in corso">
      <PublicTheme />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/xenora-mark.png" alt="" width={40} height={40} className="xn-pulse" style={{ width: 40, height: 40, objectFit: "contain" }} />
      <style>{`.xn-pulse{animation:xpulse 1.4s ease-in-out infinite}@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion:reduce){.xn-pulse{animation:none}}`}</style>
    </div>
  );
}
