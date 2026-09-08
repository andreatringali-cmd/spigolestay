"use client";

import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { AV_COLORS } from "@/lib/users";
import { useLang } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
import { planStructureLimit, planName } from "@/lib/plan";

export default function StrutturePage() {
  const router = useRouter();
  const { structures, roomTypes, units } = useData();
  const { t } = useLang();

  const limit = planStructureLimit();
  const overLimit = structures.length >= limit; // piano al completo di strutture

  return (
    <div>
      <PageHeader
        title={t("Strutture")}
        subtitle={t("Anagrafica completa delle tue strutture · le singole camere si gestiscono in “Camere”")}
        actions={overLimit
          ? <button onClick={() => router.push("/abbonamento")} title={`${t("Il tuo piano")} ${planName()} ${t("include")} ${limit === 1 ? t("1 struttura") : `${limit} ${t("strutture")}`}`} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-dim hover:bg-wash"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg> {t("Aggiungi struttura (piano superiore)")}</button>
          : <button onClick={() => router.push("/strutture/nuovo")} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">+ {t("Nuova struttura")}</button>}
      />

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-3 py-2 font-semibold">{t("Struttura")}</th>
              <th className="px-3 py-2 font-semibold">{t("Città")}</th>
              <th className="px-3 py-2 font-semibold">{t("Indirizzo")}</th>
              <th className="px-3 py-2 font-semibold">{t("Tipo")}</th>
              <th className="px-3 py-2 font-semibold">{t("Gruppo")}</th>
              <th className="px-3 py-2 font-semibold">{t("Camere")}</th>
              <th className="px-3 py-2 font-semibold">{t("Posti letto")}</th>
              <th className="px-3 py-2 font-semibold">CIN</th>
              <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {structures.map((s) => {
              const sUnits = units.filter((u) => u.structureId === s.id);
              const nCamere = sUnits.length;
              const nTipologie = roomTypes.filter((rt) => rt.structureId === s.id).length;
              const posti = sUnits.reduce((a, u) => a + (roomTypes.find((rt) => rt.id === u.roomTypeId)?.beds ?? 0), 0);
              const color = s.photoColor ?? AV_COLORS[1];
              return (
                <tr key={s.id} onClick={() => router.push(`/strutture/${s.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg text-xs font-bold text-white" style={{ backgroundColor: color }}>{s.logo ? <img src={s.logo} alt="" className="h-full w-full object-cover" /> : s.name.slice(0, 2).toUpperCase()}</div>
                      <div>
                        <div className="font-medium text-txt">{s.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-dim">{s.city || <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs text-dim">{[s.address, s.streetNumber].filter(Boolean).join(" ") || <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-2.5"><span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-dim">{s.type ?? "—"}</span></td>
                  <td className="px-3 py-2.5 text-dim">{s.groupName}</td>
                  <td className="px-3 py-2.5 text-dim"><span className="text-txt">{nCamere}</span> <span className="text-faint">· {nTipologie} {t("tipol.")}</span></td>
                  <td className="px-3 py-2.5 text-dim">{posti}</td>
                  <td className="px-3 py-2.5">
                    {s.cin ? <span className="font-mono text-xs text-dim">{s.cin}</span> : <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("mancante")}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${s.active === false ? "var(--faint)" : "var(--ok)"} 18%, transparent)`, color: s.active === false ? "var(--dim)" : "var(--ok)" }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.active === false ? "var(--faint)" : "var(--ok)" }} />{s.active === false ? t("Disattiva") : t("Attiva")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-faint">›</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-faint">{t("Clicca una riga per aprire la scheda completa (anagrafica, contatti, indirizzo/GPS, fisco, check-in, tassa di soggiorno, servizi, policy, pagamenti).")}</p>
    </div>
  );
}
