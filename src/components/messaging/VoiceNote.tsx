"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Vocale ricevuto su WhatsApp: si scarica da Meta solo quando lo si vuole ascoltare.
export default function VoiceNote({ mediaId, transcribed }: { mediaId: string; transcribed: boolean }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState("");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const load = async () => {
    setState("loading"); setErr("");
    try {
      const token = (await supabase?.auth.getSession())?.data.session?.access_token;
      if (!token) throw new Error("Devi essere connesso");
      const r = await fetch("/api/whatsapp/media", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ id: mediaId }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || "Vocale non disponibile"); }
      setUrl(URL.createObjectURL(await r.blob())); setState("idle");
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore"); setState("error"); }
  };

  return (
    <div className="mb-1">
      {url
        ? <audio src={url} controls autoPlay className="h-9 w-full max-w-[240px]" />
        : <button type="button" onClick={load} disabled={state === "loading"} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-focus hover:border-focus disabled:opacity-60">
            🎙️ {state === "loading" ? "Carico…" : "Ascolta vocale"}
          </button>}
      {err && <div className="mt-1 text-[11px] text-err">{err}</div>}
      {transcribed && <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Trascrizione</div>}
    </div>
  );
}
