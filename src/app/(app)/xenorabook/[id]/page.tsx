"use client";

import { useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";
import { getListing, roomsFor, StructImg, stars, type Room } from "@/lib/xenorabook/data";

const c = (n: number) => `€${n}`;

export default function StructurePage() {
  const router = useRouter();
  const params = useParams();
  const qp = useSearchParams();
  const { structures } = useData();
  const id = String((params as { id?: string }).id || "");
  const listing = useMemo(() => getListing(structures, id), [structures, id]);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(qp.get("from") || today);
  const [to, setTo] = useState(qp.get("to") || today);
  const [adults, setAdults] = useState(Number(qp.get("adults")) || 2);
  const [children, setChildren] = useState(Number(qp.get("children")) || 0);
  const [sel, setSel] = useState<Record<string, number>>({}); // roomId → qty
  const [step, setStep] = useState<"rooms" | "checkout" | "done">("rooms");
  const [guest, setGuest] = useState({ firstName: "", lastName: "", email: "", phone: "", note: "" });
  const [code, setCode] = useState("");

  const rooms = useMemo(() => (listing ? roomsFor(listing) : []), [listing]);
  const nights = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) || 1);
  const selLines = rooms.filter((r) => (sel[r.id] ?? 0) > 0).map((r) => ({ room: r, qty: sel[r.id] }));
  const roomsTotal = selLines.reduce((s, l) => s + l.room.price * l.qty * nights, 0);
  const guestsTot = adults + children;
  const cityTax = guestsTot * Math.min(nights, 7) * 2; // esempio: €2 a persona/notte, max 7 notti

  if (!listing) return (
    <div className="py-10 text-center">
      <div className="text-sm text-dim">Struttura non trovata.</div>
      <button onClick={() => router.push("/xenorabook")} className="mt-3 text-sm font-semibold text-focus">← Torna al portale</button>
    </div>
  );

  const setQty = (rid: string, q: number, max = 5) => setSel((p) => ({ ...p, [rid]: Math.max(0, Math.min(max, q)) }));
  const gallery = [listing.hue, (listing.hue + 40) % 360, (listing.hue + 80) % 360, (listing.hue + 200) % 360];

  const confirm = () => {
    setCode(`XB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`);
    setStep("done");
  };

  return (
    <>
      <button onClick={() => router.push("/xenorabook")} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-dim hover:text-txt"><Icon name="chevron" size={14} style={{ transform: "rotate(180deg)" }} /> Portale</button>

      {step === "done" ? (
        <Card className="mx-auto max-w-lg text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full text-2xl" style={{ backgroundColor: "#E3F0E7", color: "#3F7A5B" }}>✓</div>
          <h1 className="mt-3 text-2xl font-bold text-txt">Prenotazione confermata</h1>
          <p className="mt-1 text-sm text-dim">Codice <b className="font-mono text-txt">{code}</b> · {listing.name}</p>
          <div className="mt-4 rounded-xl border border-line bg-wash p-4 text-left text-sm">
            <div className="flex justify-between py-0.5"><span className="text-dim">Soggiorno</span><span className="font-semibold text-txt">{from} → {to} · {nights} notti</span></div>
            <div className="flex justify-between py-0.5"><span className="text-dim">Ospiti</span><span className="font-semibold text-txt">{adults} adulti{children ? `, ${children} bambini` : ""}</span></div>
            {selLines.map((l) => <div key={l.room.id} className="flex justify-between py-0.5"><span className="text-dim">{l.qty}× {l.room.name}</span><span className="font-semibold text-txt">{c(l.room.price * l.qty * nights)}</span></div>)}
            <div className="mt-1 flex justify-between border-t border-line pt-1 font-bold text-txt"><span>Totale</span><span>{c(roomsTotal)}</span></div>
          </div>
          <p className="mt-3 text-xs text-faint">Anteprima: nel portale pubblico la prenotazione arriverà direttamente nel gestionale della struttura. Tassa di soggiorno €{cityTax} da pagare in loco.</p>
          <button onClick={() => router.push("/xenorabook")} className="mt-4 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white">Torna al portale</button>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* colonna sinistra */}
          <div className="min-w-0">
            {/* galleria */}
            <div className="grid grid-cols-4 gap-2 overflow-hidden rounded-2xl border border-line">
              <div className="col-span-4 sm:col-span-2 sm:row-span-2"><div className="aspect-[4/3] h-full w-full sm:aspect-auto"><StructImg hue={gallery[0]} initial={listing.name[0]} /></div></div>
              {gallery.slice(1).map((h, i) => <div key={i} className="hidden aspect-[4/3] sm:block"><StructImg hue={h} initial={listing.name[0]} /></div>)}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ backgroundColor: "#3F7A5B" }}>✦ Verificata</span>
              <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-dim">{listing.type}</span>
              <span className="text-[13px] font-bold" style={{ color: "#D99A2B" }}>{"★".repeat(listing.starClass)}</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold text-txt">{listing.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-dim">
              <span>📍 {listing.area}</span>
              <span className="flex items-center gap-1 font-bold text-txt"><span style={{ color: "#D99A2B" }}>★</span>{listing.rating.toFixed(1)} <span className="font-semibold text-faint">({listing.reviews} recensioni)</span></span>
            </div>
            {listing.desc && <p className="mt-3 text-sm leading-relaxed text-dim">{listing.desc}</p>}

            <div className="mt-4">
              <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-faint">Servizi</div>
              <div className="flex flex-wrap gap-2">{listing.amen.map((a) => <span key={a} className="rounded-lg border border-line bg-wash px-2.5 py-1 text-[12.5px] text-dim">{a}</span>)}</div>
            </div>

            {step === "rooms" ? (
              <div className="mt-6">
                <SectionTitle>Scegli la camera</SectionTitle>
                <div className="mt-2 space-y-3">
                  {rooms.map((r: Room) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-bold text-txt">{r.name}</div>
                        <div className="mt-0.5 text-xs text-dim">Fino a {r.occ} ospiti · {r.refundable ? "Cancellazione gratuita" : "Tariffa non rimborsabile"}</div>
                      </div>
                      <div className="text-right"><div className="text-lg font-extrabold text-txt">{c(r.price)}</div><div className="text-[11px] text-faint">/ notte</div></div>
                      <div className="flex items-center rounded-lg border border-line">
                        <button onClick={() => setQty(r.id, (sel[r.id] ?? 0) - 1)} className="px-3 py-2 text-dim hover:text-txt">−</button>
                        <span className="w-8 text-center text-sm font-semibold">{sel[r.id] ?? 0}</span>
                        <button onClick={() => setQty(r.id, (sel[r.id] ?? 0) + 1)} className="px-3 py-2 text-dim hover:text-txt">+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-6">
                <SectionTitle>I tuoi dati</SectionTitle>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <input value={guest.firstName} onChange={(e) => setGuest({ ...guest, firstName: e.target.value })} placeholder="Nome" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt" />
                  <input value={guest.lastName} onChange={(e) => setGuest({ ...guest, lastName: e.target.value })} placeholder="Cognome" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt" />
                  <input value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} type="email" placeholder="Email" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt" />
                  <input value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} placeholder="Telefono" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt" />
                  <textarea value={guest.note} onChange={(e) => setGuest({ ...guest, note: e.target.value })} placeholder="Richieste particolari (opzionale)" className="sm:col-span-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt" rows={3} />
                </div>
                <button onClick={() => setStep("rooms")} className="mt-3 text-[13px] font-semibold text-dim hover:text-txt">← Modifica camere</button>
              </div>
            )}
          </div>

          {/* colonna destra: riepilogo prenotazione */}
          <div>
            <Card className="sticky top-4">
              <div className="grid grid-cols-2 gap-2">
                <label className="rounded-lg border border-line px-2.5 py-1.5"><div className="text-[10px] font-bold uppercase text-faint">Check-in</div><input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} className="w-full bg-transparent text-sm font-semibold text-txt outline-none" /></label>
                <label className="rounded-lg border border-line px-2.5 py-1.5"><div className="text-[10px] font-bold uppercase text-faint">Check-out</div><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-full bg-transparent text-sm font-semibold text-txt outline-none" /></label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5"><span className="text-dim">Adulti</span><span className="flex items-center gap-2"><button onClick={() => setAdults(Math.max(1, adults - 1))} className="text-dim">−</button><b>{adults}</b><button onClick={() => setAdults(adults + 1)} className="text-dim">+</button></span></div>
                <div className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5"><span className="text-dim">Bambini</span><span className="flex items-center gap-2"><button onClick={() => setChildren(Math.max(0, children - 1))} className="text-dim">−</button><b>{children}</b><button onClick={() => setChildren(children + 1)} className="text-dim">+</button></span></div>
              </div>

              <div className="mt-3 border-t border-line pt-3 text-sm">
                {selLines.length === 0 ? (
                  <div className="text-xs text-dim">Seleziona almeno una camera per continuare.</div>
                ) : selLines.map((l) => (
                  <div key={l.room.id} className="flex justify-between py-0.5"><span className="text-dim">{l.qty}× {l.room.name} · {nights}n</span><span className="font-semibold text-txt">{c(l.room.price * l.qty * nights)}</span></div>
                ))}
                {selLines.length > 0 && (
                  <>
                    <div className="mt-1 flex justify-between border-t border-line pt-1.5 text-base font-bold text-txt"><span>Totale</span><span>{c(roomsTotal)}</span></div>
                    <div className="mt-0.5 text-[11px] text-faint">+ tassa di soggiorno €{cityTax} da pagare in struttura</div>
                  </>
                )}
              </div>

              {step === "rooms" ? (
                <button disabled={selLines.length === 0} onClick={() => setStep("checkout")} className="mt-3 w-full rounded-lg bg-focus px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40">Prenota</button>
              ) : (
                <button disabled={!guest.firstName || !guest.email} onClick={confirm} className="mt-3 w-full rounded-lg bg-focus px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40">Conferma prenotazione</button>
              )}
              <div className="mt-2 text-center text-[11px] text-faint">Anteprima · nessun addebito reale</div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
