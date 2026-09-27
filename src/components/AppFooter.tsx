"use client";

import { useData } from "@/lib/store";
import type { Structure } from "@/lib/types";

// Glifi social (path SVG, fill currentColor).
const PATHS: Record<string, string> = {
  facebook: "M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z",
  instagram: "M12 2c2.7 0 3 0 4.1.1 1 .1 1.7.2 2.3.5.6.2 1.1.5 1.6 1 .5.5.8 1 1 1.6.2.6.4 1.3.5 2.3.1 1.1.1 1.4.1 4.1s0 3-.1 4.1c-.1 1-.2 1.7-.5 2.3-.2.6-.5 1.1-1 1.6-.5.5-1 .8-1.6 1-.6.2-1.3.4-2.3.5-1.1.1-1.4.1-4.1.1s-3 0-4.1-.1c-1-.1-1.7-.2-2.3-.5-.6-.2-1.1-.5-1.6-1-.5-.5-.8-1-1-1.6-.2-.6-.4-1.3-.5-2.3C2 15 2 14.7 2 12s0-3 .1-4.1c.1-1 .2-1.7.5-2.3.2-.6.5-1.1 1-1.6.5-.5 1-.8 1.6-1 .6-.2 1.3-.4 2.3-.5C9 2 9.3 2 12 2zm0 1.8c-2.7 0-3 0-4 .1-.8 0-1.2.2-1.5.3-.4.1-.7.3-1 .6-.3.3-.5.6-.6 1-.1.3-.3.7-.3 1.5-.1 1-.1 1.3-.1 4s0 3 .1 4c0 .8.2 1.2.3 1.5.1.4.3.7.6 1 .3.3.6.5 1 .6.3.1.7.3 1.5.3 1 .1 1.3.1 4 .1s3 0 4-.1c.8 0 1.2-.2 1.5-.3.4-.1.7-.3 1-.6.3-.3.5-.6.6-1 .1-.3.3-.7.3-1.5.1-1 .1-1.3.1-4s0-3-.1-4c0-.8-.2-1.2-.3-1.5-.1-.4-.3-.7-.6-1-.3-.3-.6-.5-1-.6-.3-.1-.7-.3-1.5-.3-1-.1-1.3-.1-4-.1zm0 3.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2zm0 1.8a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6zm5.3-3.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z",
  linkedin: "M20.4 3H3.6C3 3 2.5 3.5 2.5 4.1v15.8c0 .6.5 1.1 1.1 1.1h16.8c.6 0 1.1-.5 1.1-1.1V4.1c0-.6-.5-1.1-1.1-1.1zM8.3 18.3H5.6V9.5h2.7v8.8zM6.9 8.3a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zm11.4 10H15.6v-4.3c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.4H9.9V9.5h2.6v1.2h.1c.4-.7 1.2-1.4 2.5-1.4 2.7 0 3.2 1.8 3.2 4.1v4.9z",
  tiktok: "M16.5 3c.3 2.1 1.5 3.4 3.5 3.5v2.4c-1.2.1-2.3-.3-3.5-1v5.9c0 3.5-2.6 5.9-5.9 5.9-2.8 0-5.1-2-5.1-4.9 0-3 2.4-5 5.6-4.7v2.5c-.5-.1-1-.2-1.4-.1-1.2.2-2 1-1.9 2.3.1 1.2 1 2 2.2 1.9 1.3-.1 2.1-1 2.1-2.5V3h2.9z",
};
const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

export default function AppFooter() {
  const { structures, activeStructureId } = useData();
  const scoped = activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId);
  // Primo valore non vuoto tra le strutture in scope, per piattaforma.
  const pick = (get: (s: Structure) => string | undefined) => {
    for (const s of scoped) { const u = get(s); if (u && u.trim()) return href(u); }
    return null;
  };
  // Sempre visibili (con fallback alla home della piattaforma).
  const socials = [
    { k: "linkedin", u: pick((s) => s.linkedin) || "https://www.linkedin.com", c: "#0A66C2" },
    { k: "facebook", u: pick((s) => s.facebook) || "https://www.facebook.com", c: "#1877F2" },
    { k: "instagram", u: pick((s) => s.instagram) || "https://www.instagram.com", c: "#E4405F" },
    { k: "tiktok", u: pick((s) => s.tiktok) || "https://www.tiktok.com", c: "#010101" },
  ] as { k: string; u: string; c: string }[];

  return (
    <footer className="no-print sticky bottom-0 z-30 flex flex-row items-center justify-between gap-3 border-t bg-surface px-4 py-3 text-left text-xs text-faint md:px-6" style={{ borderTopColor: "color-mix(in srgb, var(--txt) 14%, var(--line))" }}>
      <span className="min-w-0">© {new Date().getFullYear()} Xenora · Channel Manager — All rights reserved</span>
      {socials.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          {socials.map((s) => (
            <a key={s.k} href={s.u} target="_blank" rel="noreferrer" title={s.k} aria-label={s.k} style={{ color: s.c }} className="grid h-9 w-9 place-items-center rounded-full transition hover:bg-wash hover:opacity-80">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d={PATHS[s.k]} /></svg>
            </a>
          ))}
        </div>
      )}
    </footer>
  );
}
