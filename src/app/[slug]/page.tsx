"use client";

// Xenosite pubblico: xenora.it/<nome-struttura>.
// Carica dal server (public_sites) i dati pubblicati per lo slug e mostra il
// mini-sito con lo stesso rendering della preview del proprietario.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DataProvider } from "@/lib/store";
import { Site } from "../sito-web/page";
import { loadPublicSite, RESERVED_SLUGS } from "@/lib/publicdata";

export default function PublicSitePage() {
  const params = useParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : ((params.slug as string) || "");
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");

  useEffect(() => {
    if (!slug || RESERVED_SLUGS.has(slug)) { setState("notfound"); return; }
    let alive = true;
    loadPublicSite(slug).then((ok) => { if (alive) setState(ok ? "ok" : "notfound"); }).catch(() => { if (alive) setState("notfound"); });
    return () => { alive = false; };
  }, [slug]);

  if (state === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/xenora-mark.png" alt="Xenora" width={64} height={64} style={{ width: 64, height: 64, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
        <style>{`@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}`}</style>
      </div>
    );
  }

  if (state === "notfound") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#fff", color: "#1c1917", padding: 24, textAlign: "center", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/xenora-mark.png" alt="Xenora" width={56} height={56} style={{ width: 56, height: 56, objectFit: "contain" }} />
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Sito non trovato</h1>
        <p style={{ fontSize: 15, color: "#78716c", margin: 0, maxWidth: 420 }}>
          Nessuna struttura pubblicata all&apos;indirizzo <b style={{ color: "#1c1917" }}>/{slug}</b>.
        </p>
        <a href="https://xenora.it" style={{ marginTop: 6, borderRadius: 10, background: "#4F46E5", color: "#fff", padding: "10px 18px", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>Vai su Xenora →</a>
      </div>
    );
  }

  return <DataProvider><Site /></DataProvider>;
}
