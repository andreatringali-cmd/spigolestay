"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/xenora-mark.png" alt="Xenora" width={72} height={72} style={{ width: 72, height: 72, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
      <style>{`@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}
