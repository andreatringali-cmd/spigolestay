"use client";

import { fmtDateTime } from "@/lib/dates";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { MailIcon } from "@/components/BrandIcons";
import { apiPost } from "@/lib/invoicing/client";
import { useLang } from "@/lib/i18n";
import { spiegaErroreWa } from "@/lib/invii-log";

const KEY_PREFIX = "spigolestay:pulizie:autoshare:";
export interface AutoShareCfg { enabled: boolean; time: string; email: boolean; emailTo: string; whatsapp: boolean; whatsappTo: string; subject: string; intro: string; outro: string }
const DEFAULT_CFG: AutoShareCfg = { enabled: false, time: "08:00", email: true, emailTo: "", whatsapp: false, whatsappTo: "", subject: "", intro: "", outro: "" };

// Una configurazione per struttura (planning e destinatari diversi per ciascuna, es. persone
// diverse che puliscono Spigolehouse e Spigolerooms) — non un'unica impostazione condivisa.
export function loadAutoShareCfg(structureId: string): AutoShareCfg {
  try { const raw = localStorage.getItem(KEY_PREFIX + structureId); if (raw) return { ...DEFAULT_CFG, ...JSON.parse(raw) }; } catch {}
  return DEFAULT_CFG;
}

export default function AutoShareSettings({ structureId, structureName, onClose }: { structureId: string; structureName: string; onClose: () => void }) {
  const { t } = useLang();
  const [cfg, setCfg] = useState<AutoShareCfg>(DEFAULT_CFG);
  const [saved, setSaved] = useState(false);
  // "Invia ora": prova subito con le impostazioni salvate, senza aspettare l'orario.
  const [nowBusy, setNowBusy] = useState(false);
  const [nowRes, setNowRes] = useState<{ ok: boolean; error?: string; results?: { channel: string; ok: boolean; detail: string }[] } | null>(null);
  // Ultimi invii di questa struttura, con l'errore se non sono arrivati.
  const [log, setLog] = useState<{ at: string; channel: string; ok: boolean; detail?: string; ref?: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/invii-log?job=pulizie").then((r) => r.json()).then((j) => { if (alive) setLog(((j?.rows ?? []) as { ref?: string; channel?: string }[]).filter((x) => x.channel !== "whatsapp" && (!x.ref || x.ref === structureId)) as never); }).catch(() => { if (alive) setLog([]); });
    return () => { alive = false; };
  }, [structureId]);

  useEffect(() => {
    setCfg(loadAutoShareCfg(structureId));
  }, [structureId]);

  const save = () => {
    try { localStorage.setItem(KEY_PREFIX + structureId, JSON.stringify({ ...cfg, whatsapp: false })); } catch {} // solo email: WhatsApp resta spento
    setSaved(true);
    window.setTimeout(() => { setSaved(false); onClose(); }, 700);
  };

  const sendNow = async () => {
    setNowBusy(true); setNowRes(null);
    try {
      // Salva le impostazioni correnti e aspetta qualche secondo che arrivino al server (l'invio legge quelle salvate lì).
      try { localStorage.setItem(KEY_PREFIX + structureId, JSON.stringify({ ...cfg, whatsapp: false })); } catch {}
      await new Promise((r) => window.setTimeout(r, 4000));
      setNowRes(await apiPost<{ ok: boolean; error?: string; results?: { channel: string; ok: boolean; detail: string }[] }>("pulizie/send-now", { structureId }));
    } catch (e) { setNowRes({ ok: false, error: e instanceof Error ? e.message : "errore di rete" }); }
    finally { setNowBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--focus)]/10 text-[color:var(--focus)]"><Icon name="clock" size={16} /></span>
          <div>
            <div className="text-sm font-bold text-txt">{t("Invio automatico")}</div>
            <div className="text-[11px] text-faint">{structureName}</div>
          </div>
        </div>

        <label className="mb-3 flex items-center justify-between rounded-xl border border-line bg-paper px-3 py-2.5">
          <span className="text-sm font-medium text-txt">{t("Attivo")}</span>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} className="h-4 w-8 shrink-0 accent-[color:var(--focus)]" />
        </label>

        <div className="mb-1 flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
          <span className="text-sm font-medium text-txt">{t("Non prima delle")}</span>
          <input
            type="time"
            value={cfg.time}
            onChange={(e) => setCfg((c) => ({ ...c, time: e.target.value || "08:00" }))}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus"
          />
        </div>
        <p className="mb-3 px-1 text-[11px] text-faint">{t("Un solo invio al giorno, verso le 8:30-9:30 del mattino (o dopo, se scegli un orario più tardi).")}</p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5">
            <input type="checkbox" checked={cfg.email} onChange={(e) => setCfg((c) => ({ ...c, email: e.target.checked }))} className="h-4 w-4 shrink-0 accent-[color:var(--focus)]" />
            <MailIcon size={16} />
            <input
              type="email"
              value={cfg.emailTo}
              onChange={(e) => setCfg((c) => ({ ...c, emailTo: e.target.value }))}
              placeholder={t("indirizzo email")}
              className="min-w-0 flex-1 bg-transparent text-sm text-txt outline-none placeholder:text-faint"
            />
          </div>

        </div>

        {/* Testo del messaggio: solo apertura e chiusura; l'elenco delle camere lo compone il programma. Vale per WhatsApp, Copia e l'email automatica. */}
        <div className="mt-3 flex flex-col gap-2">
          <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Testo del messaggio")}</div>
          <input type="text" value={cfg.subject} onChange={(e) => setCfg((c) => ({ ...c, subject: e.target.value }))} placeholder={t("Oggetto email (vuoto = Planning pulizie · struttura · data)")} maxLength={120} className="rounded-xl border border-line bg-paper px-3 py-2 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
          <textarea value={cfg.intro} onChange={(e) => setCfg((c) => ({ ...c, intro: e.target.value }))} placeholder={t("Riga iniziale (es. Buongiorno, ecco il planning di oggi)")} rows={2} maxLength={300} className="resize-none rounded-xl border border-line bg-paper px-3 py-2 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
          <textarea value={cfg.outro} onChange={(e) => setCfg((c) => ({ ...c, outro: e.target.value }))} placeholder={t("Riga finale (es. Scrivimi se c'è qualcosa che non torna. Grazie!)")} rows={2} maxLength={300} className="resize-none rounded-xl border border-line bg-paper px-3 py-2 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
        </div>

        {log && log.length > 0 && (
          <div className="mt-3 rounded-xl border border-line bg-paper px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Ultimi invii")}</div>
            <ul className="flex flex-col gap-1">
              {log.slice(0, 6).map((e, i) => {
                const why = e.ok ? "" : spiegaErroreWa(e.detail);
                return (
                  <li key={i} className="text-[11px] leading-snug">
                    <span className="font-semibold" style={{ color: e.ok ? "var(--ok)" : "var(--err)" }}>{e.ok ? "✓" : "✗"} {e.channel === "whatsapp" ? "WhatsApp" : "Email"}</span>
                    <span className="text-faint"> · {fmtDateTime(e.at)}</span>
                    {!e.ok && <div className="text-dim">{why || e.detail}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-3 rounded-xl border border-line bg-paper px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] leading-snug text-dim">{t("Prova adesso con queste impostazioni: invia il planning di oggi all'indirizzo email scelto.")}</div>
            <button type="button" onClick={sendNow} disabled={nowBusy || !(cfg.email && cfg.emailTo.trim())} className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-txt transition hover:bg-wash disabled:opacity-50">{nowBusy ? t("Invio…") : t("Invia ora")}</button>
          </div>
          {nowRes && (
            <ul className="mt-2 flex flex-col gap-1 text-[11px] leading-snug">
              {nowRes.error && <li style={{ color: "var(--err)" }}>{nowRes.error}</li>}
              {(nowRes.results ?? []).map((r, i) => (
                <li key={i}>
                  <span className="font-semibold" style={{ color: r.ok ? "var(--ok)" : "var(--err)" }}>{r.ok ? "✓" : "✗"} {r.channel === "whatsapp" ? "WhatsApp" : "Email"}</span>
                  <span className="text-dim"> · {r.ok ? t("inviato") : (spiegaErroreWa(r.detail) || r.detail)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-dim hover:bg-wash hover:text-txt">{t("Annulla")}</button>
          <button onClick={save} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>{saved ? t("Salvato ✓") : t("Salva")}</button>
        </div>
      </div>
    </div>
  );
}
