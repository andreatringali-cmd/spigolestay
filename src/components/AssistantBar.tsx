"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { answer, SUGGESTIONS, type SavedQuote } from "@/lib/assistant";
import { useLang } from "@/lib/i18n";
import Icon from "./Icon";

export default function AssistantBar() {
  const { bookings, guests, structures, units, roomTypes, activeStructureId, openBooking } = useData();
  const { t } = useLang();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Scorciatoie: "/" o Ctrl/Cmd+K aprono; Esc chiude.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); setOpen(true); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { if (open) { const t = setTimeout(() => inputRef.current?.focus(), 30); return () => clearTimeout(t); } }, [open]);

  const quotes = useMemo<SavedQuote[]>(() => { if (!open) return []; try { return JSON.parse(localStorage.getItem("spigolestay:preventivi") || "[]"); } catch { return []; } }, [open]);
  const res = useMemo(() => answer(q, { bookings, guests, structures, units, roomTypes, quotes, activeStructureId, today: new Date() }), [q, bookings, guests, structures, units, roomTypes, quotes, activeStructureId]);

  const go = (href: string) => { setOpen(false); setQ(""); router.push(href); };
  const openBk = (id: string) => { setOpen(false); setQ(""); openBooking(id); };

  return (
    <>
      {/* Trigger nel header (campo tipo ricerca) */}
      <button
        onClick={() => setOpen(true)}
        className="group flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-paper px-3 py-1.5 text-left text-sm text-faint transition hover:border-focus hover:bg-surface sm:max-w-sm"
        title="Assistente · premi /"
      >
        <span className="text-focus"><Icon name="chat" size={16} /></span>
        <span className="truncate">{t("Chiedimi qualsiasi cosa…")}</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-dim sm:block">/</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[10vh]">
          <button aria-label="Chiudi" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <div className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
            {/* Input */}
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="text-focus"><Icon name="chat" size={18} /></span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Es. quanto ho incassato a luglio? chi arriva domani?"
                className="w-full bg-transparent text-[15px] text-txt outline-none placeholder:text-faint"
              />
              {q && <button onClick={() => setQ("")} className="rounded px-1.5 text-dim hover:text-txt">✕</button>}
            </div>

            {/* Risposta */}
            <div className="max-h-[62vh] overflow-y-auto p-3">
              {(res.kind === "help" || (res.kind === "empty" && res.suggestions)) && (
                <div className="p-1">
                  {res.detail && <p className="mb-3 px-1 text-sm text-dim">{res.detail}</p>}
                  <div className="flex flex-wrap gap-2">
                    {(res.suggestions ?? SUGGESTIONS).map((s) => (
                      <button key={s} onClick={() => setQ(s)} className="rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-dim transition hover:border-focus hover:text-focus">{s}</button>
                    ))}
                  </div>
                </div>
              )}

              {res.kind === "empty" && !res.suggestions && (
                <div className="flex items-center gap-3 rounded-xl bg-wash px-4 py-4">
                  <span className="grid h-9 w-9 place-items-center rounded-lg text-faint" style={{ backgroundColor: "color-mix(in srgb, var(--faint) 16%, transparent)" }}><Icon name={res.icon} size={18} /></span>
                  <div><div className="text-sm font-semibold text-txt">{res.title}</div>{res.detail && <div className="text-xs text-dim">{res.detail}</div>}</div>
                </div>
              )}

              {res.kind === "answer" && (
                <div>
                  <div className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 8%, transparent)" }}>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: "var(--focus)" }}><Icon name={res.icon} size={20} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-txt">{res.title}</div>
                      {res.detail && <div className="text-xs text-dim">{res.detail}</div>}
                    </div>
                    {res.metric && <div className="shrink-0 font-mono text-2xl font-bold text-focus">{res.metric}</div>}
                  </div>

                  {res.items && res.items.length > 0 && (
                    <div className="mt-2 flex flex-col divide-y divide-[color:var(--line)] overflow-hidden rounded-xl border border-line">
                      {res.items.map((it, i) => {
                        const clickable = !!(it.bookingId || it.href);
                        const onClick = it.bookingId ? () => openBk(it.bookingId!) : it.href ? () => go(it.href!) : undefined;
                        return (
                          <button key={i} onClick={onClick} disabled={!clickable} className={`flex items-center gap-3 px-3 py-2.5 text-left ${clickable ? "hover:bg-wash" : ""}`}>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-txt">{it.label}</div>
                              {it.sub && <div className="truncate text-xs text-dim">{it.sub}</div>}
                            </div>
                            {it.badge && <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 font-mono text-[11px] font-semibold text-dim">{it.badge}</span>}
                            {clickable && <span className="shrink-0 text-faint">›</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {res.href && (
                    <button onClick={() => go(res.href!)} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-sm font-semibold text-focus transition hover:bg-wash">
                      {res.hrefLabel ?? "Vedi tutto"} →
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-line bg-wash px-4 py-2 text-[11px] text-faint">
              <span>Assistente Xenora · risponde sui tuoi dati</span>
              <span className="flex items-center gap-1"><kbd className="rounded border border-line bg-surface px-1 py-0.5 font-semibold text-dim">Esc</kbd> chiudi</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
