"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { toISO, parseISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { DEFAULT_EXTRAS, type ExtraService } from "@/lib/types";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";

const PER_LABEL: Record<string, string> = { stay: "a soggiorno", night: "a notte", person: "a persona" };
const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
const isActive = (e: ExtraService) => e.active !== false;

export default function UpsellingPage() {
  const { bookings, guests, structures, activeStructureId, updateStructure } = useData();
  const today = toISO(new Date());
  const guest = (id: string) => guests.find((g) => g.id === id);

  const [editId, setEditId] = useState<string | null>(null);
  const [offerFor, setOfferFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [localCat, setLocalCat] = useState<string>(structures[0]?.id ?? "");

  // ── Catalogo extra della struttura selezionata (fonte unica, condivisa col motore prenotazioni) ──
  const catId = activeStructureId !== "all" ? activeStructureId : (structures.some((s) => s.id === localCat) ? localCat : structures[0]?.id ?? "");
  const catStruct = structures.find((s) => s.id === catId);
  const catExtras = catStruct?.extras ?? [];
  const saveCat = (next: ExtraService[]) => { if (catId) updateStructure(catId, { extras: next }); };
  const addExtra = () => { const e: ExtraService = { id: String(Date.now()), name: "Nuovo extra", desc: "", price: 20, per: "stay" }; saveCat([...catExtras, e]); setEditId(e.id); };
  const updExtra = (id: string, patch: Partial<ExtraService>) => saveCat(catExtras.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const delExtra = (id: string) => saveCat(catExtras.filter((e) => e.id !== id));

  const extrasOf = (structId: string) => (structures.find((s) => s.id === structId)?.extras ?? []).filter(isActive);
  const activeCat = catExtras.filter(isActive);

  const arrivals = useMemo(() => bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.checkIn >= today && (activeStructureId === "all" || b.structureId === activeStructureId)).sort((a, b) => a.checkIn.localeCompare(b.checkIn)).slice(0, 30), [bookings, today, activeStructureId]);

  // Ricavo potenziale: media prezzo extra (della struttura del catalogo) × arrivi × take-rate 30%.
  const avgExtra = activeCat.length ? activeCat.reduce((a, e) => a + e.price, 0) / activeCat.length : 0;
  const potential = Math.round(avgExtra * arrivals.length * 0.3);

  const offerMsg = (bookingId: string) => {
    const b = bookings.find((x) => x.id === bookingId); if (!b) return "";
    const g = guest(b.guestId); const first = g?.firstName || g?.fullName?.split(" ")[0] || "";
    const st = structures.find((s) => s.id === b.structureId);
    const list = extrasOf(b.structureId).filter((e) => picked.has(e.id)).map((e) => `• ${e.name} — ${eur(e.price)} ${PER_LABEL[e.per]}${e.desc ? ` (${e.desc})` : ""}`).join("\n");
    return `Ciao ${first},\nper rendere ancora più speciale il tuo soggiorno dal ${fmt(b.checkIn)}, possiamo aggiungere:\n\n${list}\n\nRispondi a questo messaggio per prenotarli, ci pensiamo noi!\n\nA presto,\n${st?.name ?? ""}`;
  };
  const sendOffer = (bookingId: string, via: "email" | "wa") => {
    const b = bookings.find((x) => x.id === bookingId); if (!b) return;
    const g = guest(b.guestId); const msg = offerMsg(bookingId);
    if (via === "wa" && g?.phone) window.open(`https://wa.me/${g.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
    else if (g?.email) window.open(`mailto:${g.email}?subject=${encodeURIComponent("Servizi extra per il tuo soggiorno")}&body=${encodeURIComponent(msg)}`, "_blank");
    setOfferFor(null); setPicked(new Set());
  };

  const inp = "w-full rounded border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader title="Upselling & extra" subtitle="Servizi ed esperienze da proporre prima dell'arrivo per aumentare il ricavo per prenotazione" />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {([["Extra attivi", String(activeCat.length)], ["Arrivi in arrivo", String(arrivals.length)], ["Prezzo medio", eur(Math.round(avgExtra))], ["Ricavo potenziale", `+${eur(potential)}`]] as [string, string][]).map(([lab, val]) => (
          <div key={lab} className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">{lab}</div><div className="font-mono text-lg font-bold leading-tight text-txt">{val}</div></div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Catalogo (unico, dalla scheda struttura) */}
        <Card className="flex flex-col">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>Catalogo extra ({catExtras.length})</SectionTitle>
            <button onClick={addExtra} disabled={!catId} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-40">+ Extra</button>
          </div>
          {activeStructureId === "all" ? (
            <label className="mb-2 flex items-center gap-2 text-xs text-dim">Struttura
              <select value={catId} onChange={(e) => setLocalCat(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus">
                {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          ) : (
            <p className="mb-2 text-[11px] text-faint">Extra di <b className="text-dim">{catStruct?.name}</b> · stesso elenco usato dal motore prenotazioni.</p>
          )}
          <div className="flex-1 space-y-2 overflow-y-auto" style={{ maxHeight: 460 }}>
            {catExtras.length === 0 && (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-faint">
                Nessun extra per questa struttura.
                <div className="mt-2"><button onClick={() => saveCat(DEFAULT_EXTRAS)} disabled={!catId} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-focus hover:bg-wash disabled:opacity-40">Carica esempi</button></div>
              </div>
            )}
            {catExtras.map((e) => (
              <div key={e.id} className={`rounded-lg border p-2.5 ${isActive(e) ? "border-line bg-paper" : "border-line bg-wash opacity-60"}`}>
                {editId === e.id ? (
                  <div className="space-y-1.5">
                    <input value={e.name} onChange={(ev) => updExtra(e.id, { name: ev.target.value })} placeholder="Nome" className={`${inp} font-semibold`} />
                    <input value={e.desc ?? ""} onChange={(ev) => updExtra(e.id, { desc: ev.target.value })} placeholder="Descrizione" className={inp} />
                    <div className="flex gap-2">
                      <label className="flex-1 text-[11px] text-dim">Prezzo €<input type="number" min={0} value={e.price} onChange={(ev) => updExtra(e.id, { price: Math.max(0, Number(ev.target.value)) })} className={`${inp} mt-0.5`} /></label>
                      <label className="flex-1 text-[11px] text-dim">Modalità<select value={e.per} onChange={(ev) => updExtra(e.id, { per: ev.target.value as ExtraService["per"] })} className={`${inp} mt-0.5`}><option value="stay">a soggiorno</option><option value="night">a notte</option><option value="person">a persona</option></select></label>
                    </div>
                    <div className="flex justify-end gap-2"><button onClick={() => delExtra(e.id)} className="text-xs text-faint hover:text-[color:var(--err)]">Elimina</button><button onClick={() => setEditId(null)} className="rounded bg-focus px-2.5 py-1 text-xs font-semibold text-white">Fatto</button></div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => updExtra(e.id, { active: !isActive(e) })} title={isActive(e) ? "Disattiva" : "Attiva"} className={`relative h-5 w-9 shrink-0 rounded-full transition ${isActive(e) ? "bg-focus" : "bg-line"}`}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: isActive(e) ? "18px" : "2px" }} /></button>
                    <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-txt">{e.name}</div>{e.desc && <div className="truncate text-[11px] text-faint">{e.desc}</div>}</div>
                    <span className="shrink-0 font-mono text-sm font-bold text-txt">{eur(e.price)} <span className="text-[10px] font-normal text-faint">{PER_LABEL[e.per]}</span></span>
                    <button onClick={() => setEditId(e.id)} className="shrink-0 text-xs font-medium text-focus hover:underline">Modifica</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Proponi agli arrivi */}
        <Card className="flex flex-col">
          <SectionTitle>Proponi agli arrivi ({arrivals.length})</SectionTitle>
          <div className="flex-1 space-y-2 overflow-y-auto" style={{ maxHeight: 480 }}>
            {arrivals.map((b) => {
              const g = guest(b.guestId);
              const bExtras = extrasOf(b.structureId);
              return (
                <div key={b.id} className="rounded-lg border border-line bg-paper p-2.5">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-txt">{g?.fullName || "Ospite"}</div><div className="text-[11px] text-faint">{structures.find((s) => s.id === b.structureId)?.name} · arrivo {fmt(b.checkIn)}</div></div>
                    <button onClick={() => { setOfferFor(offerFor === b.id ? null : b.id); setPicked(new Set(bExtras.slice(0, 3).map((e) => e.id))); }} disabled={bExtras.length === 0} title={bExtras.length === 0 ? "Nessun extra attivo per questa struttura" : undefined} className="shrink-0 rounded-lg bg-focus px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">Proponi extra</button>
                  </div>
                  {offerFor === b.id && (
                    <div className="mt-2 border-t border-line pt-2">
                      <div className="mb-1.5 text-[11px] font-medium text-dim">Scegli gli extra da proporre:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {bExtras.map((e) => { const on = picked.has(e.id); return (<button key={e.id} onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{e.name} · {eur(e.price)}</button>); })}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => sendOffer(b.id, "wa")} disabled={!g?.phone || picked.size === 0} className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "#25D366" }}><Icon name="chat" size={13} /> WhatsApp</button>
                        <button onClick={() => sendOffer(b.id, "email")} disabled={!g?.email || picked.size === 0} className="flex items-center gap-1 rounded-lg bg-focus px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"><Icon name="mail" size={13} /> Email</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {arrivals.length === 0 && <div className="py-8 text-center text-sm text-faint">Nessun arrivo in programma.</div>}
          </div>
          <p className="mt-2 text-[11px] text-faint">Proponi 2–3 extra pochi giorni prima dell'arrivo: è il momento in cui gli ospiti dicono sì più spesso.</p>
        </Card>
      </div>
    </div>
  );
}
