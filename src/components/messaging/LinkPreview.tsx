"use client";

import { useEffect, useState } from "react";

interface Preview { title?: string; description?: string; image?: string; host?: string }

// Stessi host accettati dalla route /api/link-preview.
const LINK_RE = /https:\/\/(?:www\.)?(?:xenora\.it|spigole-guest-guide\.vercel\.app)\/[^\s<>"')]+/i;
const cache = new Map<string, Preview | null>();

// Anteprima (foto + titolo + descrizione) del primo link di un messaggio, come in WhatsApp.
export default function LinkPreview({ text }: { text: string }) {
  const url = text.match(LINK_RE)?.[0].replace(/[.,;:!?]+$/, "");
  const [data, setData] = useState<Preview | null | undefined>(url ? cache.get(url) : null);

  useEffect(() => {
    if (!url || cache.has(url)) { if (url) setData(cache.get(url)); return; }
    let alive = true;
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((j: Preview & { ok?: boolean }) => { const v = j.ok ? j : null; cache.set(url, v); if (alive) setData(v); })
      .catch(() => { cache.set(url, null); if (alive) setData(null); });
    return () => { alive = false; };
  }, [url]);

  if (!url || !data) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block overflow-hidden rounded-xl border border-line bg-surface text-left text-txt no-underline shadow-sm">
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.image} alt="" referrerPolicy="no-referrer" className="aspect-[1.91/1] w-full object-cover" />
      )}
      <div className="px-3 py-2">
        {data.title && <div className="truncate text-xs font-semibold">{data.title}</div>}
        {data.description && <div className="mt-0.5 line-clamp-2 text-[11px] text-dim">{data.description}</div>}
        <div className="mt-0.5 text-[10px] text-faint">{data.host}</div>
      </div>
    </a>
  );
}
