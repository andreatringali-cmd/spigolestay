"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";

interface Msg { from: "user" | "bot"; text: string }

export default function SupportWidget() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { from: "bot", text: t("Ciao! Scrivici la tua richiesta: la inviamo al nostro team di assistenza.") },
  ]);
  const [text, setText] = useState("");

  const send = () => {
    const val = text.trim();
    if (!val) return;
    setMsgs((m) => [...m, { from: "user", text: val }]);
    try { window.open(`mailto:amministrazione@xenoradigitalsolutions.com?subject=${encodeURIComponent("Assistenza Xenora")}&body=${encodeURIComponent(val)}`); } catch {}
    setMsgs((m) => [...m, { from: "bot", text: t("Ho aperto la tua email per inviarci il messaggio. Ti rispondiamo al più presto!") }]);
    setText("");
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[420px] w-[340px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between bg-focus px-4 py-3 text-white">
            <span className="font-semibold">{t("Assistenza")}</span>
            <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white">✕</button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {msgs.map((m, i) => (
              <div key={i} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === "user" ? "ml-auto bg-focus text-white" : "bg-wash text-txt"}`}>
                {m.text}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-line p-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={t("Scrivi un messaggio…")}
              className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus"
            />
            <button onClick={send} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white">{t("Invia")}</button>
          </div>
        </div>
      )}
      {/* Pulsante assistente: linguetta laterale colorata sul bordo destro (in basso), icona chat */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("Assistenza")}
        title={t("Assistenza")}
        className="no-print fixed bottom-24 right-0 z-50 flex h-14 w-9 items-center justify-center rounded-l-xl bg-focus text-white shadow-lg transition hover:w-11"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    </>
  );
}
