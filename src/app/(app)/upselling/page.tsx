"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { toISO, parseISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { DEFAULT_EXTRAS } from "@/lib/types";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";

interface Extra { id: string; name: string; desc: string; price: number; per: "stay" | "night" | "person"; active: boolean }
const PER_LABEL: Record<string, string> = { stay: "a soggiorno", night: "a notte", person: "a persona" };
const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

export default function UpsellingPage() {
  const { bookings, guests, structures, activeStructureId } = useData();
  const today = toISO(new Date());
  const guest = (id: string) => guests.find((g) => g.id === id);

  const [extras, setExtras] = useState<Extra[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [offerFor, setOfferFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:upsell"); setExtras(r ? JSON.parse(r) : DEFAULT_EXTRAS.map((e) => ({ id: e.id, name: e.name, desc: e.desc ?? "", price: e.price, per: e.per, active: true }))); } catch { setExtras(DEFAULT_EXTRAS.map((e) => ({ id: e.id, name: e.name, desc: e.desc ?? "", price: e.price, per: e.per, active: true }))); } }, []);
  const persist = (n: Extra[]) => { setExtras(n); try { localStorage.setItem("spigolestay:upsell", JSON.stringify(n)); } catch {} };
  const upd = (id: string, patch: Partial<Extra>) => persist(extras.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const add = () => { const e: Extra = { id: String(Date.now()), name: "Nuovo extra", desc: "", price: 20, per: "stay", active: true }; persist([...extras, e]); setEditId(e.id); };
  const del = (id: string) => persist(extras.filter((e) => e.id !== id));

  const activeExtras = extras.filter((e) => e.active);
  const arrivals = useMemo(() => bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.checkIn >= today && (activeStructureId === "all" || b.structureId === activeStructureId)).sort((a, b) => a.checkIn.localeCompare(b.checkIn)).slice(0, 30), [bookings, today, activeStructureId]);

  // Ricavo potenziale: media prezzo extra × arrivi (stima prudente con take-rate 30%).
  const avgExtra = activeExtras.length ? activeExtras.reduce((a, e) => a + e.price, 0) / activeExtras.length : 0;
  const potential = Math.round(avgExtra * arrivals.length * 0.3);

  const offerMsg = (bookingId: string) => {
    const b = bookings.find((x) => x.id === bookingId); if (!b) return "";
    const g = guest(b.guestId); const first = g?.firstName || g?.fullName?.split(" ")[0] || "";
    const st = structures.find((s) => s.id === b.structureId);
    const list = activeExtras.filter((e) => picked.has(e.id)).map((e) => `• ${e.name} — ${eur(e.price)} ${PER_LABEL[e.per]}${e.desc ? ` (${e.desc})` : ""}`).join("\n");
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
        {([["Extra attivi", String(activeExtras.length)], ["Arrivi in arrivo", String(arrivals.length)], ["Prezzo medio", eur(Math.round(avgExtra))], ["Ricavo potenziale", `+${eur(potential)}`]] as [string, string][]).map(([lab, val]) => (
          <div key={lab} className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm"><div className="text-[10px] font-medium uppercase tracking-wide text-faint">{lab}</div><div className="font-mono text-lg font-bold leading-tight text-txt">{val}</div></div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Catalogo */}
        <Card className="flex flex-col">
          <div className="mb-2 flex items-center justify-between"><SectionTitle>Catalogo extra ({extras.length})</SectionTitle><button onClick={add} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash">+ Extra</button></div>
          <div className="flex-1 space-y-2 overflow-y-auto" style={{ maxHeight: 480 }}>
            {extras.map((e) => (
              <div key={e.id} className={`rounded-lg border p-2.5 ${e.active ? "border-line bg-paper" : "border-line bg-wash opacity-60"}`}>
                {editId === e.id ? (
                  <div className="space-y-1.5">
                    <input value={e.name} onChange={(ev) => upd(e.id, { name: ev.target.value })} placeholder="Nome" className={`${inp} font-semibold`} />
                    <input value={e.desc} onChange={(ev) => upd(e.id, { desc: ev.target.value })} placeholder="Descrizione" className={inp} />
                    <div className="flex gap-2">
                      <label className="flex-1 text-[11px] text-dim">Prezzo €<input type="number" min={0} value={e.price} onChange={(ev) => upd(e.id, { price: Math.max(0, Number(ev.target.value)) })} className={`${inp} mt-0.5`} /></label>
                      <label className="flex-1 text-[11px] text-dim">Modalità<select value={e.per} onChange={(ev) => upd(e.id, { per: ev.target.value as Extra["per"] })} className={`${inp} mt-0.5`}><option value="stay">a soggiorno</option><option value="night">a notte</option><option value="person">a persona</option></select></label>
                    </div>
                    <div className="flex justify-end gap-2"><button onClick={() => del(e.id)} className="text-xs text-faint hover:text-[color:var(--err)]">Elimina</button><button onClick={() => setEditId(null)} className="rounded bg-focus px-2.5 py-1 text-xs font-semibold text-white">Fatto</button></div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => upd(e.id, { active: !e.active })} title={e.active ? "Disattiva" : "Attiva"} className={`relative h-5 w-9 shrink-0 rounded-full transition ${e.active ? "bg-focus" : "bg-line"}`}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: e.active ? "18px" : "2px" }} /></button>
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
              return (
                <div key={b.id} className="rounded-lg border border-line bg-paper p-2.5">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-txt">{g?.fullName || "Ospite"}</div><div className="text-[11px] text-faint">{structures.find((s) => s.id === b.structureId)?.name} · arrivo {fmt(b.checkIn)}</div></div>
                    <button onClick={() => { setOfferFor(offerFor === b.id ? null : b.id); setPicked(new Set(activeExtras.slice(0, 3).map((e) => e.id))); }} className="shrink-0 rounded-lg bg-focus px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90">Proponi extra</button>
                  </div>
                  {offerFor === b.id && (
                    <div className="mt-2 border-t border-line pt-2">
                      <div className="mb-1.5 text-[11px] font-medium text-dim">Scegli gli extra da proporre:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {activeExtras.map((e) => { const on = picked.has(e.id); return (<button key={e.id} onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{e.name} · {eur(e.price)}</button>); })}
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
