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
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/xenora-mark.png" alt="Xenora" width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
        <style>{`@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}`}</style>
      </div>
    );
  }

  if (state === "notfound") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3.5 bg-surface p-6 text-center text-txt">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/xenora-mark.png" alt="Xenora" width={56} height={56} style={{ width: 56, height: 56, objectFit: "contain" }} />
        <h1 className="font-display text-2xl font-bold">Sito non trovato</h1>
        <p className="max-w-md text-[15px] text-dim">
          Nessuna struttura pubblicata all&apos;indirizzo <b className="text-txt">/{slug}</b>.
        </p>
        <a href="https://xenora.it" className="mt-1.5 inline-flex min-h-11 items-center rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white hover:opacity-90">Vai su Xenora →</a>
      </div>
    );
  }

  return <DataProvider><Site /></DataProvider>;
}
