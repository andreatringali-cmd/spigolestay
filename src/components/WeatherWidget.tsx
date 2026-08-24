"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Day = { date: string; tmax: number; tmin: number; code: number };

// Codici meteo WMO → etichetta + emoji.
const WMO: Record<number, { t: string; e: string }> = {
  0: { t: "Sereno", e: "☀️" }, 1: { t: "Poco nuvoloso", e: "🌤️" }, 2: { t: "Nuvoloso", e: "⛅" }, 3: { t: "Coperto", e: "☁️" },
  45: { t: "Nebbia", e: "🌫️" }, 48: { t: "Nebbia", e: "🌫️" },
  51: { t: "Pioviggine", e: "🌦️" }, 53: { t: "Pioviggine", e: "🌦️" }, 55: { t: "Pioviggine", e: "🌦️" },
  61: { t: "Pioggia", e: "🌧️" }, 63: { t: "Pioggia", e: "🌧️" }, 65: { t: "Pioggia forte", e: "🌧️" },
  71: { t: "Neve", e: "🌨️" }, 73: { t: "Neve", e: "🌨️" }, 75: { t: "Neve", e: "🌨️" },
  80: { t: "Rovesci", e: "🌦️" }, 81: { t: "Rovesci", e: "🌧️" }, 82: { t: "Temporali", e: "⛈️" },
  95: { t: "Temporale", e: "⛈️" }, 96: { t: "Temporale", e: "⛈️" }, 99: { t: "Temporale", e: "⛈️" },
};

const DOW = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

// Previsioni per Siracusa (Open-Meteo, senza chiave). Degrada con eleganza se offline.
export default function WeatherWidget({ compact }: { compact?: boolean }) {
  const { t } = useLang();
  const [days, setDays] = useState<Day[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("https://api.open-meteo.com/v1/forecast?latitude=37.0755&longitude=15.2866&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FRome&forecast_days=5")
      .then((r) => r.json())
      .then((j) => { if (!alive) return; const d = j.daily; setDays(d.time.map((t: string, i: number) => ({ date: t, tmax: Math.round(d.temperature_2m_max[i]), tmin: Math.round(d.temperature_2m_min[i]), code: d.weather_code[i] }))); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, []);

  // Versione compatta per la testata (accanto all'aiuto "?").
  if (compact) {
    if (err || !days) return (
      <div className="hidden items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-faint sm:flex">
        <span>🌡️</span><span>{err ? t("Meteo n/d") : t("Meteo…")}</span>
      </div>
    );
    return (
      <div className="hidden items-center gap-2 rounded-lg border border-line bg-surface py-1.5 pl-2.5 pr-1 sm:flex" title={t("Previsioni Siracusa · prossimi giorni")}>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{t("Siracusa")}</span>
        {days.slice(0, 3).map((d, i) => {
          const w = WMO[d.code] ?? { t: "—", e: "🌡️" };
          const dow = DOW[new Date(d.date + "T12:00:00").getDay()];
          return (
            <div key={d.date} className={`flex items-center gap-1 pr-2 ${i > 0 ? "border-l border-line pl-2" : ""}`} title={w.t}>
              <span className="text-[10px] text-faint">{i === 0 ? t("oggi") : dow}</span>
              <span className="text-sm leading-none">{w.e}</span>
              <span className="text-xs font-bold text-txt">{d.tmax}°</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Meteo")} · {t("Siracusa")}</span>
        <span className="text-[11px] text-faint">{t("prossimi giorni")}</span>
      </div>
      {err ? (
        <div className="py-3 text-sm text-faint">{t("Previsioni non disponibili (offline).")}</div>
      ) : !days ? (
        <div className="py-3 text-sm text-faint">{t("Carico le previsioni…")}</div>
      ) : (
        <div className="flex justify-between gap-1">
          {days.map((d, i) => {
            const w = WMO[d.code] ?? { t: "—", e: "🌡️" };
            const dow = DOW[new Date(d.date + "T12:00:00").getDay()];
            return (
              <div key={d.date} className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-2 ${i === 0 ? "bg-wash" : ""}`} title={w.t}>
                <span className="text-[11px] font-medium text-dim">{i === 0 ? t("oggi") : dow}</span>
                <span className="text-xl leading-none">{w.e}</span>
                <span className="text-xs font-bold text-txt">{d.tmax}°</span>
                <span className="text-[11px] text-faint">{d.tmin}°</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
