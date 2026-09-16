"use client";

import { Fragment } from "react";
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

  const owned = structures.filter((x) => !x.orgId);
  const shared = structures.filter((x) => !!x.orgId);
  const groups = [
    { key: "own", title: t("Di mia proprietà"), desc: "", list: owned, empty: t("Nessuna struttura di tua proprietà.") },
    { key: "shared", title: t("Condivise"), desc: "", list: shared, empty: t("Nessuna struttura condivisa. Per condividerne una, apri la scheda della struttura e invita il socio.") },
  ];

  const renderRow = (s: typeof structures[number]) => {
    const sUnits = units.filter((u) => u.structureId === s.id);
    const nCamere = sUnits.length;
    const nTipologie = roomTypes.filter((rt) => rt.structureId === s.id && !rt.deriveFrom).length;
    const posti = sUnits.reduce((a, u) => a + (roomTypes.find((rt) => rt.id === u.roomTypeId)?.beds ?? 0), 0);
    const color = s.photoColor ?? AV_COLORS[1];
    return (
      <tr key={s.id} onClick={() => router.push(`/strutture/${s.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg text-xs font-bold text-white" style={{ backgroundColor: color }}>{s.logo ? <img src={s.logo} alt="" className="h-full w-full object-cover" /> : s.name.slice(0, 2).toUpperCase()}</div>
            <div className="min-w-0"><div className="truncate font-medium text-txt">{s.name}</div></div>
          </div>
        </td>
        <td className="truncate px-3 py-2.5 text-dim">{s.city || <span className="text-faint">—</span>}</td>
        <td className="truncate px-3 py-2.5 text-xs text-dim">{[s.address, s.streetNumber].filter(Boolean).join(" ") || <span className="text-faint">—</span>}</td>
        <td className="px-3 py-2.5"><span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-dim">{s.type ?? "—"}</span></td>
        <td className="truncate px-3 py-2.5 text-dim">{s.groupName}</td>
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
  };

  return (
    <div>
      <PageHeader
        title={t("Strutture")}
        subtitle={t("Anagrafica completa delle tue strutture · le singole camere si gestiscono in “Camere”")}
        actions={overLimit
          ? <button onClick={() => router.push("/abbonamento")} title={`${t("Il tuo piano")} ${planName()} ${t("include")} ${limit === 1 ? t("1 struttura") : `${limit} ${t("strutture")}`}`} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-dim hover:bg-wash"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg> {t("Aggiungi struttura (piano superiore)")}</button>
          : <button onClick={() => router.push("/strutture/nuovo")} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">+ {t("Nuova struttura")}</button>}
      />

      {/* Unica tabella: i due registri (proprietà / condivise) sono separati da righe-intestazione,
          così TUTTE le colonne restano perfettamente allineate tra i due gruppi. */}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[820px] table-fixed text-sm">
          <colgroup>
            <col style={{ width: "19%" }} />{/* Struttura */}
            <col style={{ width: "10%" }} />{/* Città */}
            <col style={{ width: "15%" }} />{/* Indirizzo */}
            <col style={{ width: "9%" }} />{/* Tipo */}
            <col style={{ width: "11%" }} />{/* Gruppo */}
            <col style={{ width: "9%" }} />{/* Camere */}
            <col style={{ width: "8%" }} />{/* Posti letto */}
            <col style={{ width: "9%" }} />{/* CIN */}
            <col style={{ width: "7%" }} />{/* Stato */}
            <col style={{ width: "3%" }} />{/* freccia */}
          </colgroup>
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
            {groups.map((g) => (
              <Fragment key={g.key}>
                <tr className="bg-wash">
                  <td colSpan={10} className="px-3 py-2 text-[13px] font-bold tracking-tight text-txt">{g.title} <span className="font-normal text-faint">· {g.list.length}</span></td>
                </tr>
                {g.list.length === 0
                  ? <tr className="border-b border-line last:border-0"><td colSpan={10} className="px-3 py-4 text-sm text-dim">{g.empty}</td></tr>
                  : g.list.map((s) => renderRow(s))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
