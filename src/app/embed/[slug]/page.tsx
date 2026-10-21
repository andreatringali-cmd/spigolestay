"use client";

// Widget di prenotazione incorporabile: xenora.it/embed/<slug>.
// Stessa logica del motore pubblico /prenota (via public_sites), ma in versione
// compatta pensata per stare dentro un <iframe> sul sito esterno del gestore.
// Route pubblica (fuori dal gruppo (app)): nessun login richiesto. Le
// prenotazioni passano dallo stesso flusso pubblico (/api/stripe/book +
// /api/public-booking) usato da /prenota.
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { DataProvider } from "@/lib/store";
import { Engine } from "../../prenota/page";
import { loadPublicSite, RESERVED_SLUGS } from "@/lib/publicdata";

export default function EmbedPage() {
  const params = useParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : ((params.slug as string) || "");
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  // Colore accento opzionale (?accent=#RRGGBB da /embed.js): sovrascrive il
  // colore primario del motore (--focus). Se assente resta quello di Xenora.
  const [accent, setAccent] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const a = new URLSearchParams(window.location.search).get("accent"); if (a && /^#?[0-9a-fA-F]{3,8}$/.test(a)) setAccent(a.startsWith("#") ? a : `#${a}`); } catch {}
    if (!slug || RESERVED_SLUGS.has(slug)) { setState("notfound"); return; }
    let alive = true;
    loadPublicSite(slug).then((ok) => { if (alive) setState(ok ? "ok" : "notfound"); }).catch(() => { if (alive) setState("notfound"); });
    return () => { alive = false; };
  }, [slug]);

  // Comunica l'altezza reale del contenuto al genitore (embed.js), che ridimensiona
  // l'iframe di conseguenza — il motore cambia altezza passando da elenco camere a
  // checkout, quindi serve osservare i cambiamenti, non solo misurare al mount.
  useEffect(() => {
    if (!slug || typeof ResizeObserver === "undefined") return;
    const el = rootRef.current;
    if (!el) return;
    const post = () => { try { window.parent.postMessage({ xenoraEmbedSite: slug, xenoraEmbedHeight: el.scrollHeight }, "*"); } catch {} };
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    return () => ro.disconnect();
  }, [slug, state]);

  const accentStyle = accent ? ({ ["--focus" as string]: accent } as React.CSSProperties) : undefined;

  return (
    <div ref={rootRef}>
      {/* Sfondo trasparente: nell'iframe deve trasparire lo sfondo del sito ospite. */}
      <style>{`html,body{background:transparent!important}`}</style>
      {state === "loading" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 16px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/xenora-mark.png" alt="Xenora" width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
          <style>{`@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}`}</style>
        </div>
      )}
      {state === "notfound" && (
        <div role="alert" className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center text-txt">
          <h1 className="font-display text-lg font-bold">Motore di prenotazione non disponibile</h1>
          <p className="max-w-sm text-sm text-dim">
            Nessuna struttura pubblicata all&apos;indirizzo <b className="text-txt">/{slug}</b>.
          </p>
        </div>
      )}
      {state === "ok" && (
        <div style={accentStyle}>
          <DataProvider><Engine embed /></DataProvider>
        </div>
      )}
    </div>
  );
}
