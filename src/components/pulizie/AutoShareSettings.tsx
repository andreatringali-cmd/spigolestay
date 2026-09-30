"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { WhatsAppIcon, MailIcon } from "@/components/BrandIcons";
import { apiPost } from "@/lib/invoicing/client";
import { useLang } from "@/lib/i18n";

const KEY_PREFIX = "spigolestay:pulizie:autoshare:";
export interface AutoShareCfg { enabled: boolean; time: string; email: boolean; emailTo: string; whatsapp: boolean; whatsappTo: string }
const DEFAULT_CFG: AutoShareCfg = { enabled: false, time: "08:00", email: true, emailTo: "", whatsapp: false, whatsappTo: "" };

// Una configurazione per struttura (planning e destinatari diversi per ciascuna, es. persone
// diverse che puliscono Spigolehouse e Spigolerooms) — non un'unica impostazione condivisa.
export function loadAutoShareCfg(structureId: string): AutoShareCfg {
  try { const raw = localStorage.getItem(KEY_PREFIX + structureId); if (raw) return { ...DEFAULT_CFG, ...JSON.parse(raw) }; } catch {}
  return DEFAULT_CFG;
}

export default function AutoShareSettings({ structureId, structureName, onClose }: { structureId: string; structureName: string; onClose: () => void }) {
  const { t } = useLang();
  const [cfg, setCfg] = useState<AutoShareCfg>(DEFAULT_CFG);
  const [waStatus, setWaStatus] = useState<"checking" | "connected" | "off">("checking");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCfg(loadAutoShareCfg(structureId));
    apiPost<{ connected: boolean }>("whatsapp/settings", { action: "status" })
      .then((r) => setWaStatus(r.connected ? "connected" : "off"))
      .catch(() => setWaStatus("off"));
  }, [structureId]);

  const save = () => {
    try { localStorage.setItem(KEY_PREFIX + structureId, JSON.stringify(cfg)); } catch {}
    setSaved(true);
    window.setTimeout(() => { setSaved(false); onClose(); }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
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

          <div className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5">
            <input type="checkbox" checked={cfg.whatsapp} disabled={waStatus !== "connected"} onChange={(e) => setCfg((c) => ({ ...c, whatsapp: e.target.checked }))} className="h-4 w-4 shrink-0 accent-[color:var(--focus)] disabled:opacity-40" />
            <WhatsAppIcon size={16} />
            <input
              type="tel"
              value={cfg.whatsappTo}
              disabled={waStatus !== "connected"}
              onChange={(e) => setCfg((c) => ({ ...c, whatsappTo: e.target.value }))}
              placeholder={t("numero, es. 393331234567")}
              className="min-w-0 flex-1 bg-transparent text-sm text-txt outline-none placeholder:text-faint disabled:opacity-40"
            />
          </div>
          {waStatus === "off" && <p className="px-1 text-[11px] text-faint">{t("WhatsApp Business non è ancora collegato (Conversazioni → Impostazioni) — per ora solo email.")}</p>}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-dim hover:bg-wash hover:text-txt">{t("Annulla")}</button>
          <button onClick={save} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>{saved ? t("Salvato ✓") : t("Salva")}</button>
        </div>
      </div>
    </div>
  );
}
