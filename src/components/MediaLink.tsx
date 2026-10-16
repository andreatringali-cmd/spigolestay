"use client";

import { useEffect, useState, type AnchorHTMLAttributes } from "react";
import { resolveMediaUrlSync, signedUrlFor } from "@/lib/media-client";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** Qualunque valore salvato: data URI (vecchio), URL http(s), riferimento "media:…". */
  src?: string | null;
};

/**
 * <a> che apre l'immagine/PDF in una nuova scheda anche quando il valore è un riferimento PRIVATO: l'URL firmato (valido pochi
 * minuti) si chiede in anticipo, come fa <MediaImg> (stessa cache), così il link è già pronto al clic. Finché non è pronto il clic non fa nulla.
 */
export default function MediaLink({ src, children, onClick, ...rest }: Props) {
  const sync = resolveMediaUrlSync(src);
  const [signed, setSigned] = useState<{ for: string; url: string } | null>(null);
  useEffect(() => {
    if (sync !== null || !src) return;
    let alive = true;
    signedUrlFor(src).then((url) => { if (alive) setSigned({ for: src, url }); }).catch(() => {});
    return () => { alive = false; };
  }, [sync, src]);
  const url = sync !== null ? sync : signed && signed.for === src ? signed.url : "";
  return (
    <a {...rest} href={url || undefined} target="_blank" rel="noreferrer" onClick={(e) => { if (!url) e.preventDefault(); onClick?.(e); }}>{children}</a>
  );
}
