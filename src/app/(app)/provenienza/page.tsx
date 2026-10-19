"use client";

// Provenienza viaggiatori: arrivi e presenze per provenienza (nazione/provincia).
import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle, StatCard } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { nights } from "@/lib/dates";


export default function ProvenienzaPage() {
  const { bookings, getGuest, activeStructureId } = useData();
  const [year, setYear] = useState(new Date().getFullYear());
  // Anni selezionabili: ultimi tre + ogni anno in cui c'è almeno una prenotazione (anche futura, es. gennaio dell'anno prossimo).
  const years = useMemo(() => { const y = new Date().getFullYear(); const set = new Set<number>([y, y - 1, y - 2]); for (const b of bookings) { const n = Number((b.checkIn ?? "").slice(0, 4)); if (n >= 2000 && n <= y + 2) set.add(n); } return [...set].sort((a, b) => b - a); }, [bookings]);

  const { byCountry, byProvince, totals } = useMemo(() => {
    const bc = new Map<string, { arrivi: number; presenze: number }>();
    const bp = new Map<string, { arrivi: number; presenze: number }>();
    let arrivi = 0, presenze = 0;
    for (const b of bookings) {
      if (b.status === "cancelled" || b.channel === "blocked") continue;
      if (activeStructureId !== "all" && b.structureId !== activeStructureId) continue;
      if ((b.checkIn ?? "").slice(0, 4) !== String(year)) continue;
      const g = getGuest(b.guestId);
      const people = (b.adults ?? 1) + (b.children ?? 0);
      const pres = nights(b.checkIn, b.checkOut) * people;
      arrivi += people; presenze += pres;
      const country = (g?.country || g?.citizenship || "Non indicato").trim() || "Non indicato";
      const prov = (g?.province || "").trim().toUpperCase() || "—";
      const cc = bc.get(country) ?? { arrivi: 0, presenze: 0 }; cc.arrivi += people; cc.presenze += pres; bc.set(country, cc);
      if (prov !== "—") { const pp = bp.get(prov) ?? { arrivi: 0, presenze: 0 }; pp.arrivi += people; pp.presenze += pres; bp.set(prov, pp); }
    }
    const sort = (m: Map<string, { arrivi: number; presenze: number }>) => [...m.entries()].sort((a, b) => b[1].presenze - a[1].presenze);
    return { byCountry: sort(bc), byProvince: sort(bp), totals: { arrivi, presenze } };
  }, [bookings, getGuest, year, activeStructureId]);

  const Bars = ({ data, max }: { data: [string, { arrivi: number; presenze: number }][]; max: number }) => (
    <div className="flex flex-col gap-2">
      {data.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-sm max-sm:flex-wrap max-sm:gap-y-1">
          <span className="w-28 shrink-0 truncate text-dim max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">{k}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-wash max-sm:order-last max-sm:basis-full"><div className="h-full rounded-full bg-focus" style={{ width: `${max ? (v.presenze / max) * 100 : 0}%` }} /></div>
          <span className="w-24 shrink-0 whitespace-nowrap text-right max-sm:w-auto font-mono text-xs text-dim">{v.arrivi} arr · {v.presenze} pres</span>
        </div>
      ))}
    </div>
  );
  const maxC = Math.max(1, ...byCountry.map(([, v]) => v.presenze));
  const maxP = Math.max(1, ...byProvince.map(([, v]) => v.presenze));
  const sel = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader title="Provenienza viaggiatori" subtitle="Arrivi e presenze per provenienza (movimento turistico)"
        actions={<select value={year} onChange={(e) => setYear(Number(e.target.value))} className={sel}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>} />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label={`Arrivi ${year}`} value={totals.arrivi} />
        <StatCard label={`Presenze ${year}`} value={totals.presenze} />
      </div>

      {totals.arrivi === 0 ? <Card><EmptyState title={`Nessun arrivo nel ${year}`} sub="Registra le prenotazioni per vedere la provenienza." /></Card> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><SectionTitle>Per nazione / provenienza</SectionTitle><div className="mt-3">{byCountry.length ? <Bars data={byCountry} max={maxC} /> : <p className="text-sm text-faint">—</p>}</div></Card>
          <Card><SectionTitle>Per provincia (Italia)</SectionTitle><div className="mt-3">{byProvince.length ? <Bars data={byProvince} max={maxP} /> : <p className="text-sm text-faint">Dati provincia non disponibili sugli ospiti.</p>}</div></Card>
        </div>
      )}
      <p className="mt-3 text-xs text-faint">Presenze = notti × ospiti. La provincia si popola dai dati anagrafici degli ospiti (residenza).</p>
    </div>
  );
}
