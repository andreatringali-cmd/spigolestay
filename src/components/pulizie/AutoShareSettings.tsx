"use client";

import { fmtDateTime } from "@/lib/dates";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { MailIcon } from "@/components/BrandIcons";
import { apiPost } from "@/lib/invoicing/client";
import { useLang } from "@/lib/i18n";
import { spiegaErroreWa } from "@/lib/invii-log";

const KEY_PREFIX = "spigolestay:pulizie:autoshare:";
export interface AutoShareCfg { enabled: boolean; time: string; email: boolean; emailTo: string; emailCc: string[]; whatsapp: boolean; whatsappTo: string; subject: string; intro: string; outro: string }
const DEFAULT_CFG: AutoShareCfg = { enabled: false, time: "08:00", email: true, emailTo: "", emailCc: [], whatsapp: false, whatsappTo: "", subject: "", intro: "", outro: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Una configurazione per struttura (planning, orario e destinatari propri per ciascuna, es. persone
// diverse che puliscono Spigolehouse e Spigolerooms) — non un'unica impostazione condivisa. Ogni struttura invia una sua email, al suo orario.
export function loadAutoShareCfg(structureId: string): AutoShareCfg {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + structureId);
    if (raw) { const c = { ...DEFAULT_CFG, ...JSON.parse(raw) } as AutoShareCfg; if (!Array.isArray(c.emailCc)) c.emailCc = []; return c; }
  } catch {}
  return { ...DEFAULT_CFG, emailCc: [] };
}

export default function AutoShareSettings({ structureId, structureName, onClose }: {
  structureId: string; structureName: string; // è la struttura scelta dal selettore globale: nessuna scelta dentro la finestra
  onClose: () => void;
}) {
  const { t } = useLang();
  const list = [{ id: structureId, name: structureName }];
  const [activeId, setActiveId] = useState(structureId);
  const [cfgs, setCfgs] = useState<Record<string, AutoShareCfg>>({});
  const [dirty, setDirty] = useState<string[]>([]);
  const cfg = cfgs[activeId] ?? DEFAULT_CFG;
  const activeName = list.find((s) => s.id === activeId)?.name ?? structureName;
  const [ccInput, setCcInput] = useState("");
  const [saved, setSaved] = useState(false);
  // "Invia ora": prova subito con le impostazioni salvate, senza aspettare l'orario.
  const [nowBusy, setNowBusy] = useState(false);
  const [nowRes, setNowRes] = useState<{ ok: boolean; error?: string; results?: { channel: string; ok: boolean; detail: string }[] } | null>(null);
  // Ultimi invii (tutte le strutture), filtrati poi su quella aperta, con l'errore se non sono arrivati.
  const [log, setLog] = useState<{ at: string; channel: string; ok: boolean; detail?: string; ref?: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/invii-log?job=pulizie").then((r) => r.json()).then((j) => { if (alive) setLog(((j?.rows ?? []) as { at: string; channel: string; ok: boolean; detail?: string; ref?: string }[]).filter((x) => x.channel !== "whatsapp")); }).catch(() => { if (alive) setLog([]); });
    return () => { alive = false; };
  }, []);
  const logHere = (log ?? []).filter((x) => !x.ref || x.ref === activeId);

  // Esc chiude il pannello.
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);

  // Le impostazioni di ogni struttura si leggono una volta (e si modificano in memoria finché non si preme Salva).
  useEffect(() => {
    const next: Record<string, AutoShareCfg> = {};
    for (const s of list) next[s.id] = loadAutoShareCfg(s.id);
    setCfgs(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCfg = (fn: (c: AutoShareCfg) => AutoShareCfg) => {
    setCfgs((all) => ({ ...all, [activeId]: fn(all[activeId] ?? DEFAULT_CFG) }));
    setDirty((d) => (d.includes(activeId) ? d : [...d, activeId]));
  };

  // «In copia»: si aggiungono più indirizzi (Invio, virgola, spazio o uscita dal campo); ognuno si toglie col suo ✕.
  const addCc = (raw: string): boolean => {
    const parts = raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 0) return true;
    if (parts.some((x) => !EMAIL_RE.test(x))) return false;
    setCfg((c) => ({ ...c, emailCc: Array.from(new Set([...(c.emailCc ?? []), ...parts.map((x) => x.toLowerCase())])).slice(0, 10) }));
    return true;
  };
  const commitCc = () => { if (!ccInput.trim()) return; if (addCc(ccInput)) { setCcInput(""); setCcErr(""); } else setCcErr(t("Indirizzo in copia non valido.")); };
  const [ccErr, setCcErr] = useState("");

  const [saveErr, setSaveErr] = useState("");
  const save = async () => {
    setSaveErr("");
    // L'eventuale indirizzo in copia scritto ma non ancora aggiunto si aggiunge ora.
    let all = cfgs;
    if (ccInput.trim()) {
      const parts = ccInput.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      if (parts.some((x) => !EMAIL_RE.test(x))) { setCcErr(t("Indirizzo in copia non valido.")); return; }
      const cur = all[activeId] ?? DEFAULT_CFG;
      all = { ...all, [activeId]: { ...cur, emailCc: Array.from(new Set([...(cur.emailCc ?? []), ...parts.map((x) => x.toLowerCase())])).slice(0, 10) } };
      setCfgs(all); setCcInput(""); if (!dirty.includes(activeId)) setDirty((d) => [...d, activeId]);
    }
    const toSave = Array.from(new Set([...dirty, ...(ccInput.trim() ? [activeId] : [])]));
    // Invio attivo ma senza un indirizzo valido: non partirebbe mai, meglio dirlo subito (con il nome della struttura).
    for (const id of toSave) {
      const c = all[id] ?? DEFAULT_CFG; const n = list.find((s) => s.id === id)?.name ?? id;
      if (c.enabled && !(c.email && EMAIL_RE.test(c.emailTo.trim()))) { setActiveId(id); setSaveErr(`${n}: ${t("per attivare l'invio inserisci un indirizzo email valido (e lascia la spunta sull'email).")}`); return; }
    }
    for (const id of toSave) {
      const c = all[id] ?? DEFAULT_CFG; const n = list.find((s) => s.id === id)?.name ?? id;
      try { localStorage.setItem(KEY_PREFIX + id, JSON.stringify({ ...c, whatsapp: false })); } catch {} // solo email: WhatsApp resta spento
      // L'orario va anche nella tabella letta dal cron ogni 10 minuti: senza questo l'invio non parte all'ora scelta.
      try { await apiPost("pulizie/schedule", { structureId: id, enabled: c.enabled, time: c.time, email: c.email, emailTo: c.emailTo }); }
      catch (e) { setSaveErr(`${n}: ${e instanceof Error ? e.message : "Non sono riuscito a salvare l'orario. Riprova."}`); return; }
    }
    setDirty([]);
    setSaved(true);
    window.setTimeout(() => { setSaved(false); onClose(); }, 700);
  };

  const sendNow = async () => {
    setNowBusy(true); setNowRes(null);
    try {
      // Salva le impostazioni correnti e aspetta qualche secondo che arrivino al server (l'invio legge quelle salvate lì).
      try { localStorage.setItem(KEY_PREFIX + activeId, JSON.stringify({ ...cfg, whatsapp: false })); } catch {}
      await new Promise((r) => window.setTimeout(r, 4000));
      setNowRes(await apiPost<{ ok: boolean; error?: string; results?: { channel: string; ok: boolean; detail: string }[] }>("pulizie/send-now", { structureId: activeId }));
    } catch (e) { setNowRes({ ok: false, error: e instanceof Error ? e.message : "errore di rete" }); }
    finally { setNowBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--focus)]/10 text-[color:var(--focus)]"><Icon name="clock" size={16} /></span>
          <div>
            <div className="text-sm font-bold text-txt">{t("Invio automatico")}</div>
            <div className="text-[11px] text-faint">{activeName}</div>
          </div>
        </div>

        <label className="mb-3 flex items-center justify-between rounded-xl border border-line bg-paper px-3 py-2.5">
          <span className="text-sm font-medium text-txt">{t("Attivo")}</span>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} className="h-4 w-8 shrink-0 accent-[color:var(--focus)]" />
        </label>

        <div className="mb-1 flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
          <span className="text-sm font-medium text-txt">{t("Non prima delle")}</span>
          <input
            type="time" aria-label={t("Non prima delle")}
            value={cfg.time}
            onChange={(e) => setCfg((c) => ({ ...c, time: e.target.value || "08:00" }))}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus"
          />
        </div>
        <p className="mb-3 px-1 text-[11px] text-faint">{t("Un solo invio al giorno, all'orario scelto (entro 10 minuti).")}</p>

        <div className="flex flex-col gap-2">
          <div className="rounded-xl border border-line bg-paper px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-txt">
              <input type="checkbox" checked={cfg.email} onChange={(e) => setCfg((c) => ({ ...c, email: e.target.checked }))} className="h-4 w-4 shrink-0 accent-[color:var(--focus)]" />
              <MailIcon size={16} />
              {t("Invia il planning per email")}
            </label>
            <label htmlFor="autoshare-email-to" className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-dim">{t("Indirizzo email a cui inviare")}</label>
            <input
              id="autoshare-email-to"
              type="email" inputMode="email" autoComplete="email"
              value={cfg.emailTo}
              onChange={(e) => setCfg((c) => ({ ...c, emailTo: e.target.value }))}
              placeholder="nome@esempio.it"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none placeholder:text-faint focus:border-focus"
            />
            <p className="mt-1 text-[11px] text-faint">{t("Di solito chi si occupa delle pulizie: riceve il planning di oggi all'orario scelto.")}</p>
          </div>

          {/* In copia: altri indirizzi che ricevono la stessa email */}
          <div className="rounded-xl border border-line bg-paper px-3 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-dim">{t("In copia")}</div>
            <p className="mb-1.5 text-[11px] text-faint">{t("Facoltativo: altre persone che ricevono la stessa email.")}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {(cfg.emailCc ?? []).map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2.5 pr-1 text-xs text-txt">
                  {a}
                  <button type="button" aria-label={t("Togli") + " " + a} onClick={() => setCfg((c) => ({ ...c, emailCc: (c.emailCc ?? []).filter((x) => x !== a) }))} className="grid h-5 w-5 place-items-center rounded-full text-dim hover:bg-wash hover:text-txt">✕</button>
                </span>
              ))}
              <input
                type="email" inputMode="email" autoComplete="off" value={ccInput}
                onChange={(e) => { setCcInput(e.target.value); setCcErr(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === ";") { e.preventDefault(); commitCc(); } }}
                onBlur={commitCc}
                placeholder={(cfg.emailCc ?? []).length ? t("aggiungi un altro indirizzo") : t("aggiungi un indirizzo in copia")}
                className="min-w-[10rem] flex-1 bg-transparent py-1 text-sm text-txt placeholder:text-faint"
              />
            </div>
            {ccErr && <p className="mt-1 text-[11px] font-medium" style={{ color: "var(--err)" }}>{ccErr}</p>}
          </div>
        </div>

        {logHere.length > 0 && (
          <details className="group mt-3 rounded-xl border border-line bg-paper px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-dim">{t("Ultimi invii")} <span className="text-xs transition group-open:rotate-180">▾</span></summary>
            <ul className="mt-1 flex flex-col gap-1">
              {logHere.slice(0, 4).map((e, i) => {
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
          </details>
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

        {saveErr && <p className="mt-3 text-[11px] font-medium" style={{ color: "var(--err)" }}>{saveErr}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-dim hover:bg-wash hover:text-txt">{t("Annulla")}</button>
          <button onClick={save} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-on-focus shadow-sm transition hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>{saved ? t("Salvato ✓") : t("Salva")}</button>
        </div>
      </div>
    </div>
  );
}
