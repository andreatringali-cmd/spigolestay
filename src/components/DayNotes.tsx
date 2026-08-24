"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useLang } from "@/lib/i18n";

type Note = { id: string; text: string; done: boolean };
const KEY = "spigolestay:daynotes";

// Promemoria manuali del giorno, persistiti in locale.
export default function DayNotes() {
  const { t } = useLang();
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const ready = useRef(false);
  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setNotes(JSON.parse(r)); } catch {} ready.current = true; }, []);
  useEffect(() => { if (!ready.current) return; try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch {} }, [notes]);

  const add = () => { const t = text.trim(); if (!t) return; setNotes((n) => [...n, { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), text: t, done: false }]); setText(""); };
  const toggle = (id: string) => setNotes((n) => n.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
  const remove = (id: string) => setNotes((n) => n.filter((x) => x.id !== id));

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Promemoria")}</span>
        {notes.length > 0 && <span className="text-[11px] text-faint">{notes.filter((n) => !n.done).length} {t("da fare")}</span>}
      </div>
      <div className="mb-2 flex gap-1.5">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={t("Aggiungi un promemoria…")} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
        <button onClick={add} className="shrink-0 rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">+</button>
      </div>
      {notes.length === 0 ? (
        <div className="py-2 text-sm text-faint">{t("Nessun promemoria.")}</div>
      ) : (
        <div className="flex flex-col gap-1">
          {notes.map((n) => (
            <div key={n.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-wash">
              <input type="checkbox" checked={n.done} onChange={() => toggle(n.id)} className="h-4 w-4 accent-[color:var(--ok)]" />
              <span className={`min-w-0 flex-1 truncate text-sm ${n.done ? "text-faint line-through" : "text-txt"}`}>{n.text}</span>
              <button onClick={() => remove(n.id)} className="shrink-0 text-faint opacity-0 transition group-hover:opacity-100 hover:text-[color:var(--err)]" title={t("Elimina")}><Icon name="eyeOff" size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
