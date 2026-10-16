"use client";

import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { resolveMediaUrlSync, signedUrlFor } from "@/lib/media-client";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** Qualunque valore salvato: data URI (vecchio), URL http(s), riferimento "media:xenora-public:…" o "media:xenora-private:…". */
  src?: string | null;
  /** Cosa mostrare se l'immagine non si carica (default: piccolo messaggio discreto). */
  fallback?: ReactNode;
};

/**
 * <img> che accetta qualunque formato di immagine salvata. Pubblici/data URI/URL: immediato. Privati: segnaposto mentre chiede
 * l'URL firmato a /api/media, messaggio discreto se fallisce. Stessa API di <img> (className, style, onClick…).
 */
export default function MediaImg({ src, alt = "", className, style, fallback, onError, ...rest }: Props) {
  const sync = resolveMediaUrlSync(src);
  const [signed, setSigned] = useState<{ for: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null); // il valore `src` che ha fallito
  const needsAsync = sync === null && !!src;

  useEffect(() => {
    if (!needsAsync || !src) return;
    let alive = true;
    signedUrlFor(src).then((url) => { if (alive) setSigned({ for: src, url }); }).catch(() => { if (alive) setFailed(src); });
    return () => { alive = false; };
  }, [needsAsync, src]);

  if (!src) return null;
  const url = sync !== null ? sync : signed?.for === src ? signed.url : null;
  if (failed === src || (url !== null && url === "")) {
    return <>{fallback ?? <span className={className} style={{ ...style, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--faint)", background: "var(--wash)" }}>Immagine non disponibile</span>}</>;
  }
  if (url === null) {
    return <span aria-busy="true" className={className} style={{ ...style, display: "inline-block", background: "var(--wash)" }} />; // segnaposto mentre carica
  }
  /* eslint-disable-next-line @next/next/no-img-element */
  return <img {...rest} src={url} alt={alt} className={className} style={style} onError={(e) => { setFailed(src); onError?.(e); }} />;
}
