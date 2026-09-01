"use client";

import { useData } from "@/lib/store";
import type { Structure } from "@/lib/types";
import { useLang } from "@/lib/i18n";

// Glifi social (path SVG, fill currentColor).
const PATHS: Record<string, string> = {
  facebook: "M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z",
  instagram: "M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 3.2A6.6 6.6 0 1 0 12 18.6 6.6 6.6 0 0 0 12 5.4zm0 10.9A4.3 4.3 0 1 1 12 7.7a4.3 4.3 0 0 1 0 8.6zm6.8-11.2a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z",
  linkedin: "M20.4 3H3.6C3 3 2.5 3.5 2.5 4.1v15.8c0 .6.5 1.1 1.1 1.1h16.8c.6 0 1.1-.5 1.1-1.1V4.1c0-.6-.5-1.1-1.1-1.1zM8.3 18.3H5.6V9.5h2.7v8.8zM6.9 8.3a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zm11.4 10H15.6v-4.3c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.4H9.9V9.5h2.6v1.2h.1c.4-.7 1.2-1.4 2.5-1.4 2.7 0 3.2 1.8 3.2 4.1v4.9z",
};
const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

export default function AppFooter() {
  const { structures, activeStructureId } = useData();
  const { t } = useLang();
  const scoped = activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId);
  // Primo valore non vuoto tra le strutture in scope, per piattaforma.
  const pick = (get: (s: Structure) => string | undefined) => {
    for (const s of scoped) { const u = get(s); if (u && u.trim()) return href(u); }
    return null;
  };
  // Sempre visibili, ordine LinkedIn · Facebook · Instagram (con fallback alla home della piattaforma).
  const socials = [
    { k: "linkedin", u: pick((s) => s.linkedin) || "https://www.linkedin.com", c: "#0A66C2" },
    { k: "facebook", u: pick((s) => s.facebook) || "https://www.facebook.com", c: "#1877F2" },
    { k: "instagram", u: pick((s) => s.instagram) || "https://www.instagram.com", c: "#E4405F" },
  ] as { k: string; u: string; c: string }[];

  return (
    <footer className="no-print flex flex-col items-center gap-2 border-t bg-surface px-4 py-3 text-center text-xs text-faint md:flex-row md:justify-between md:px-6" style={{ borderTopColor: "color-mix(in srgb, var(--txt) 14%, var(--line))" }}>
      <span>© {new Date().getFullYear()} Xenora · Channel Manager — {t("Tutti i diritti riservati")}</span>
      {socials.length > 0 && (
        <div className="flex items-center gap-2">
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
