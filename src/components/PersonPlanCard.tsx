"use client";

// Tariffe derivate → "Prezzo per 1 ospite sui portali". Crea su Channex un piano "Per persona" per la camera e ne invia i prezzi
// (1 e 2 persone). Riguarda SOLO i canali che l'owner collega a quel piano nella mappatura Channex: gli altri portali non cambiano.
import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { apiPost } from "@/lib/invoicing/client";
import { effectiveBase } from "@/lib/pricing";
import { readChannexMap } from "@/lib/channex-map-sync";
import { hasPersonPlan, registerPersonPlan, singleDiscountFromDerived } from "@/lib/person-plan";
import { forceFullSync } from "@/components/ChannexAutoSync";
import { eur } from "@/lib/format";
import type { RoomType, Structure } from "@/lib/types";

const inp = "rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus";

export default function PersonPlanCard({ structures, roomTypes }: { structures: Structure[]; roomTypes: RoomType[] }) {
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<Record<string, { mode: "pct" | "eur"; value: string }>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  void tick;

  const map = typeof window === "undefined" ? {} : readChannexMap();
  const rows = structures.flatMap((s) => {
    const m = map[s.id];
    if (!m?.propertyId || !m.rooms) return [];
    return roomTypes.filter((rt) => rt.structureId === s.id && !rt.deriveFrom && m.rooms![rt.id]).map((rt) => ({ s, rt }));
  });
  if (rows.length === 0) return null;

  const defaultOf = (rt: RoomType): { mode: "pct" | "eur"; value: string } => {
    const kid = roomTypes.find((x) => x.deriveFrom === rt.id && (x.maxOccupancy === 1 || x.beds === 1 || /dus|singol/i.test(x.name)));
    const d = kid ? singleDiscountFromDerived(kid) : null;
    return d ? { mode: d.mode, value: String(d.value) } : { mode: "eur", value: "10" };
  };

  const run = async (s: Structure, rt: RoomType) => {
    const f = form[rt.id] ?? defaultOf(rt);
    const value = Number(String(f.value).replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) { setMsg((m) => ({ ...m, [rt.id]: { ok: false, text: "Scrivi lo sconto per 1 ospite (maggiore di zero)." } })); return; }
    setBusy(rt.id); setMsg((m) => ({ ...m, [rt.id]: { ok: true, text: "Creo il piano su Channex…" } }));
    try {
      const r = await apiPost<{ ok: boolean; ratePlanId?: string; created?: boolean; error?: string }>("channex/person-plan", { structureId: s.id, roomTypeId: rt.id, baseRate: effectiveBase(rt, roomTypes), mode: f.mode, value });
      if (!r.ok || !r.ratePlanId) { setMsg((m) => ({ ...m, [rt.id]: { ok: false, text: r.error || "Channex non ha creato il piano." } })); return; }
      const ok = registerPersonPlan(s.id, rt.id, r.ratePlanId, { mode: f.mode, value });
      if (!ok) { setMsg((m) => ({ ...m, [rt.id]: { ok: false, text: "Piano creato su Channex, ma non trovo la camera nella mappa: riapri Canali e riprova." } })); return; }
      setMsg((m) => ({ ...m, [rt.id]: { ok: true, text: "Piano creato. Invio i prezzi…" } }));
      await forceFullSync(s.id);
      setMsg((m) => ({ ...m, [rt.id]: { ok: true, text: `Fatto. Ora su Channex, nella mappatura di bed-and-breakfast.it, scegli per le righe 👤1 e 👤2 il piano «Per persona».` } }));
      setTick((n) => n + 1);
    } catch (e) {
      setMsg((m) => ({ ...m, [rt.id]: { ok: false, text: e instanceof Error ? e.message : "Errore" } }));
    } finally { setBusy(""); }
  };

  return (
    <Card className="mt-6">
      <SectionTitle>Prezzo per 1 ospite sui portali</SectionTitle>
      <p className="mb-3 text-xs text-dim">
        Alcuni portali (come bed-and-breakfast.it) mostrano lo stesso prezzo per 1 e per 2 adulti. Qui crei su Channex un piano <b className="text-txt">«Per persona»</b> con due prezzi, per 1 e per 2 ospiti.
        Vale <b className="text-txt">solo per i canali che colleghi tu a quel piano</b> nella mappatura Channex: Booking, Expedia e gli altri restano come ora.
      </p>
      <div className="flex flex-col divide-y divide-[color:var(--line)]">
        {rows.map(({ s, rt }) => {
          const f = form[rt.id] ?? defaultOf(rt);
          const done = hasPersonPlan(s.id, rt.id);
          const base = effectiveBase(rt, roomTypes);
          const single = f.mode === "eur" ? base - Number(f.value || 0) : base * (1 - Number(f.value || 0) / 100);
          const m = msg[rt.id];
          return (
            <div key={rt.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
              <div className="min-w-[150px] flex-1">
                <div className="text-sm font-medium text-txt">{rt.name}</div>
                <div className="text-[11px] text-faint">{s.name} · {eur(base)} {"→"} 1 ospite {eur(Math.max(0, Math.round(single)))}</div>
              </div>
              <span className="text-xs text-dim">sconto per 1 ospite</span>
              <select aria-label="Tipo di sconto" value={f.mode} onChange={(e) => setForm((p) => ({ ...p, [rt.id]: { ...f, mode: e.target.value as "pct" | "eur" } }))} className={inp}>
                <option value="eur">€</option><option value="pct">%</option>
              </select>
              <input aria-label="Sconto per 1 ospite" inputMode="decimal" value={f.value} onChange={(e) => setForm((p) => ({ ...p, [rt.id]: { ...f, value: e.target.value } }))} className={`${inp} w-20 text-right font-mono`} />
              <button onClick={() => void run(s, rt)} disabled={!!busy} className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === rt.id ? "Attendi…" : done ? "Aggiorna e reinvia" : "Crea piano per persona"}</button>
              {done && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" }}>creato</span>}
              {m && <div className="w-full text-[11px]" style={{ color: m.ok ? "var(--dim)" : "var(--err)" }}>{m.text}</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
