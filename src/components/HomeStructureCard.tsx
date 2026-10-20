"use client";

// Impostazioni → «Struttura di apertura». Su questo dispositivo l'app si apre su UNA struttura: di norma la principale (la prima dell'elenco che riordini da Strutture),
// ma si può scegliere un'altra struttura, «l'ultima usata» oppure «Tutte». Dopo l'apertura si può cambiare struttura come sempre. Con la modalità veloce, aprire su una
// sola struttura vuol dire scaricare solo i suoi dati: l'avvio è molto più rapido (le altre si caricano quando le scegli).
import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useData } from "@/lib/store";
import { HOME_PREF_KEY } from "@/lib/home-struct";

export default function HomeStructureCard() {
  const { allStructures } = useData();
  const [pref, setPref] = useState(() => { if (typeof window === "undefined") return ""; try { return localStorage.getItem(HOME_PREF_KEY) || ""; } catch { return ""; } });
  if (allStructures.length < 2) return null; // con una struttura sola non c'è nulla da scegliere
  const change = (v: string) => {
    setPref(v);
    try { if (v) localStorage.setItem(HOME_PREF_KEY, v); else localStorage.removeItem(HOME_PREF_KEY); window.dispatchEvent(new Event("spigolestay:homepref")); } catch { /* niente */ }
  };
  const valid = pref === "" || pref === "last" || pref === "all" || allStructures.some((s) => s.id === pref);
  return (
    <Card className="mt-4">
      <SectionTitle>Struttura di apertura</SectionTitle>
      <p className="mb-3 text-xs text-dim">
        Quando apri l&apos;app, la vista parte da questa struttura. Poi puoi cambiare struttura o scegliere «Tutte» dal menu in alto, come sempre.
        Aprire su una sola struttura rende l&apos;avvio più veloce, soprattutto da telefono.
      </p>
      <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-line bg-paper px-3 py-2">
        <span className="text-sm font-medium text-txt">Apri su</span>
        <select value={valid ? pref : ""} onChange={(e) => change(e.target.value)} className="min-w-0 max-w-[60%] rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-txt">
          <option value="">Struttura principale{allStructures[0] ? ` (${allStructures[0].name})` : ""}</option>
          {allStructures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="last">L&apos;ultima che ho usato</option>
          <option value="all">Tutte le strutture</option>
        </select>
      </label>
    </Card>
  );
}
