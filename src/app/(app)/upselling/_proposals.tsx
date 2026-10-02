"use client";

// Tab "Proposte": per ogni prenotazione (arrivi imminenti e ospiti in casa) mostra le proposte
// di extra generate dalle regole (stagione, soggiorno minimo, disponibilità camera, già venduti/
// rifiutati), con ricavo potenziale, testo pronto in lingua ospite e invio WhatsApp/email/copia.
// Ogni invio viene registrato sulla prenotazione (registro offerte).

import { useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { parseISO, nights as nightsBetween } from "@/lib/dates";
import { CHANNELS, type Booking, type Structure } from "@/lib/types";
import { shortenLink } from "@/lib/guestlink";
import {
  buildOfferMessage, guestLang, itemsFromPicks, KIND_LABEL, newOffer, patchAccept, patchRecordSent, PER_LABEL,
  potentialOf, proposable, type Proposal,
} from "@/lib/upselling";
import Icon from "@/components/Icon";
import EmptyState from "@/components/EmptyState";
import { useToast } from "@/components/ToastProvider";

const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

export interface Candidate { booking: Booking; proposals: Proposal[]; structure?: Structure }

// Cache dei link brevi per prenotazione (evita di creare un nuovo short link a ogni apertura).
const shortCache = new Map<string, string>();

function phaseLabel(b: Booking, today: string): { text: string; inHouse: boolean } {
  if (b.checkIn <= today) return { text: "In casa", inHouse: true };
  const d = Math.round((parseISO(b.checkIn).getTime() - parseISO(today).getTime()) / 86400000);
  return { text: d === 1 ? "Arriva domani" : `Arriva tra ${d} giorni`, inHouse: false };
}

function CandidateBody({ c, onDone }: { c: Candidate; onDone: () => void }) {
  const { guests, updateBooking, addActivity } = useData();
  const toast = useToast();
  const b = c.booking;
  const g = guests.find((x) => x.id === b.guestId);
  const st = c.structure;
  const props = c.proposals;
  const avail = proposable(props);
  const skipped = props.filter((p) => p.status === "skip");
  const nn = nightsBetween(b.checkIn, b.checkOut);
  // Il componente è montato solo quando la scheda è aperta: lo stato iniziale basta (niente reset in effect).
  const [picked, setPicked] = useState<Set<string>>(() => new Set(props.filter((p) => p.status === "ok").slice(0, 3).map((p) => p.extra.id)));
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [short, setShort] = useState<string | null>(shortCache.get(b.id) ?? null);

  // Prepara il link breve del check-in (una volta per prenotazione, poi in cache).
  useEffect(() => {
    if (shortCache.has(b.id) || typeof window === "undefined") return;
    shortenLink(`${window.location.origin}/checkin?b=${b.id}`).then((u) => { shortCache.set(b.id, u); setShort(u); }).catch(() => {});
  }, [b.id]);

  const qtyOf = (p: Proposal) => Math.min(p.maxQty, Math.max(1, qtys[p.extra.id] ?? 1));
  const picks = avail.filter((p) => picked.has(p.extra.id)).map((p) => ({ p, qty: qtyOf(p) }));
  const items = itemsFromPicks(picks);
  const total = items.reduce((a, i) => a + i.amount, 0);
  const link = typeof window !== "undefined" ? short ?? `${window.location.origin}/checkin?b=${b.id}` : "";
  const auto = items.length ? buildOfferMessage({ lang: guestLang(g), firstName: g?.firstName || g?.fullName?.split(" ")[0] || "", structureName: st?.name ?? "", checkIn: b.checkIn, items, link }) : "";
  const msg = draft ?? auto;
  const catalog = st?.extras ?? [];

  const record = (via: "whatsapp" | "email" | "copy") => {
    updateBooking(b.id, patchRecordSent(b, newOffer(via, items)));
    addActivity("message", `Proposta extra (${via === "whatsapp" ? "WhatsApp" : via === "email" ? "email" : "testo copiato"}) — ${g?.fullName ?? "ospite"}: ${items.map((i) => i.name).join(", ")}`, b.structureId);
    onDone();
  };

  const sendWa = () => {
    if (!items.length) return;
    window.open(`https://wa.me/${(g?.phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
    record("whatsapp");
    toast("WhatsApp aperto con il testo pronto: offerta registrata.", "success");
  };
  const sendCopy = async () => {
    if (!items.length) return;
    try { await navigator.clipboard.writeText(msg); toast("Testo copiato.", "success"); } catch { toast("Copia non riuscita: seleziona il testo a mano.", "error"); return; }
    record("copy");
  };
  const sendEmail = async () => {
    if (!items.length) return;
    if (!g?.email) { toast("L'ospite non ha un'email.", "error"); return; }
    setBusy(true);
    const subject = "Servizi extra per il tuo soggiorno";
    const gmail = () => window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(g.email as string)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`, "_blank");
    try {
      // kind "guest_message": messaggio libero con carta intestata della struttura (NON "quote": quello allega un PDF di preventivo).
      const r = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "guest_message", to: g.email, subject, text: msg, accent: st?.photoColor, replyTo: st?.email, brand: { name: st?.name, logo: st?.logo, address: [st?.address, st?.streetNumber, st?.city].filter(Boolean).join(" "), phone: st?.phone, email: st?.email, website: st?.website, accent: st?.photoColor, cin: st?.cin, vat: st?.vat } }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) { toast(`Email inviata a ${g.email}.`, "success"); record("email"); }
      else { gmail(); toast("Invio automatico non riuscito: aperta la bozza Gmail.", "info"); record("email"); }
    } catch { gmail(); toast("Invio automatico non riuscito: aperta la bozza Gmail.", "info"); record("email"); }
    setBusy(false);
  };
  const sellDirect = () => {
    if (!items.length) return;
    const offer = newOffer("diretto", items, "accepted");
    updateBooking(b.id, patchAccept(b, offer, catalog));
    addActivity("message", `Extra aggiunti alla prenotazione — ${g?.fullName ?? "ospite"}: ${items.map((i) => i.name).join(", ")} (${eur(total)})`, b.structureId);
    toast(`Extra aggiunti alla prenotazione: +${eur(total)} sul totale ospite.`, "success");
    onDone();
  };

  return (
        <div className="border-t border-line bg-wash/40 p-3 pt-2.5">
          {avail.length === 0 && <div className="rounded-lg border border-dashed border-line py-4 text-center text-xs text-faint">Nessun extra proponibile a questa prenotazione.</div>}
          {avail.length > 0 && (
            <>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Proposte (seleziona cosa inviare)</div>
              <div className="space-y-1.5">
                {avail.map((p) => {
                  const on = picked.has(p.extra.id);
                  const q = qtyOf(p);
                  const n = Math.max(1, nn);
                  const detail = p.extra.per === "night" ? `${eur(p.extra.price)} × ${n} ${n === 1 ? "notte" : "notti"}` : p.extra.per === "person" ? `${eur(p.extra.price)} × ${Math.max(1, b.adults ?? 1)} ${Math.max(1, b.adults ?? 1) === 1 ? "adulto" : "adulti"}` : `${eur(p.extra.price)} ${PER_LABEL[p.extra.per]}`;
                  return (
                    <div key={p.extra.id} className={`rounded-lg border p-2 transition ${on ? "border-focus bg-surface" : "border-line bg-surface/60"}`}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setPicked((s) => { const nx = new Set(s); if (nx.has(p.extra.id)) nx.delete(p.extra.id); else nx.add(p.extra.id); return nx; })} aria-pressed={on} className={`grid h-5 w-5 shrink-0 place-items-center rounded border text-[11px] font-bold ${on ? "border-focus bg-focus text-white" : "border-line text-transparent"}`}>✓</button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-txt">{p.extra.name}<span className="rounded bg-wash px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-faint">{KIND_LABEL[p.kind]}</span></div>
                          <div className={`text-[11px] ${p.status === "warn" ? "text-[color:var(--warn,#b7791f)]" : "text-faint"}`}>{p.status === "warn" ? "⚠ " : ""}{p.reason}</div>
                          <div className="text-[11px] text-dim">{detail}</div>
                        </div>
                        {p.maxQty > 1 && on && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button onClick={() => setQtys((s) => ({ ...s, [p.extra.id]: Math.max(1, q - 1) }))} className="grid h-6 w-6 place-items-center rounded border border-line text-txt hover:bg-wash">−</button>
                            <span className="w-5 text-center font-mono text-xs">{q}</span>
                            <button onClick={() => setQtys((s) => ({ ...s, [p.extra.id]: Math.min(p.maxQty, q + 1) }))} className="grid h-6 w-6 place-items-center rounded border border-line text-txt hover:bg-wash">+</button>
                          </div>
                        )}
                        <span className="shrink-0 font-mono text-sm font-bold text-txt">{eur(p.unit * q)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {items.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-faint">
                    <span>Messaggio ({guestLang(g).toUpperCase()}) · totale {eur(total)}</span>
                    {draft !== null && <button onClick={() => setDraft(null)} className="font-medium normal-case text-focus hover:underline">Ripristina testo automatico</button>}
                  </div>
                  <textarea value={msg} onChange={(e) => setDraft(e.target.value)} rows={8} className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-xs leading-relaxed text-txt outline-none focus:border-focus" />
                  <div className="mt-0.5 text-[10px] text-faint">Il link porta l&apos;ospite al suo check-in online, dove può aggiungere lui stesso gli extra (compaiono nella prenotazione e in questo registro).</div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button onClick={sendWa} disabled={!items.length || !g?.phone || busy} title={!g?.phone ? "Nessun numero per questo ospite" : undefined} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "var(--focus)" }}><Icon name="chat" size={14} /> WhatsApp</button>
                <button onClick={sendEmail} disabled={!items.length || !g?.email || busy} title={!g?.email ? "Nessuna email per questo ospite" : undefined} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-txt transition hover:bg-paper disabled:opacity-40"><Icon name="mail" size={14} /> {busy ? "Invio…" : "Email"}</button>
                <button onClick={sendCopy} disabled={!items.length || busy} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-txt transition hover:bg-paper disabled:opacity-40"><Icon name="copy" size={14} /> Copia testo</button>
                <button onClick={sellDirect} disabled={!items.length || busy} title="L'ospite ha già accettato (di persona, al telefono, in chat): aggiungili subito alla prenotazione" className="ml-auto flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-txt transition hover:bg-paper disabled:opacity-40"><Icon name="plus" size={14} /> Ospite ha accettato: aggiungi</button>
              </div>
            </>
          )}

          {skipped.length > 0 && (
            <details className="mt-3 text-[11px] text-faint">
              <summary className="cursor-pointer select-none font-medium text-dim">Non proponibili ({skipped.length})</summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {skipped.map((p) => <li key={p.extra.id} className="list-disc"><b className="font-semibold text-dim">{p.extra.name}</b> — {p.reason}</li>)}
              </ul>
            </details>
          )}
        </div>
  );
}

function CandidateCard({ c, today, open, onToggle }: { c: Candidate; today: string; open: boolean; onToggle: () => void }) {
  const { guests, getUnit, roomTypes } = useData();
  const b = c.booking;
  const g = guests.find((x) => x.id === b.guestId);
  const st = c.structure;
  const avail = proposable(c.proposals);
  const props = c.proposals;
  const unit = getUnit(b.unitId);
  const rtName = unit ? roomTypes.find((r) => r.id === unit.roomTypeId)?.name : roomTypes.find((r) => r.id === b.roomTypeId)?.name;
  const roomLabel = [rtName, unit?.name].filter(Boolean).join(" · ");
  const nn = nightsBetween(b.checkIn, b.checkOut);
  const ch = CHANNELS[b.channel];
  const initials = (g?.fullName || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  const ph = phaseLabel(b, today);
  const pot = potentialOf(props);

  return (
    <div className={`overflow-hidden rounded-xl border bg-paper shadow-sm transition ${open ? "border-focus ring-1 ring-[color:color-mix(in_srgb,var(--focus)_35%,transparent)]" : "border-line"}`}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-wash">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: ch ? `var(${ch.cssVar})` : "var(--focus)" }}>{initials || "?"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-txt">{g?.fullName || "Ospite"}</span>
            {ch && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: `color-mix(in srgb, var(${ch.cssVar}) 16%, transparent)`, color: `var(${ch.cssVar})` }}>{ch.label}</span>}
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ph.inHouse ? "bg-[color:color-mix(in_srgb,var(--ok)_16%,transparent)] text-[color:var(--ok)]" : "bg-wash text-dim"}`}>{ph.text}</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-faint">{[st?.name, roomLabel].filter(Boolean).join(" · ")}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-dim">
            <span className="inline-flex items-center gap-1"><Icon name="calendar" size={12} /> {fmt(b.checkIn)} → {fmt(b.checkOut)}</span>
            <span>· {nn} {nn === 1 ? "notte" : "notti"}</span>
            <span className="inline-flex items-center gap-1">· <Icon name="users" size={12} /> {(b.adults ?? 0) + (b.children ?? 0)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {avail.length > 0
            ? (<><div className="font-mono text-sm font-bold text-[color:var(--ok)]">+{eur(pot)}</div><div className="text-[10px] text-faint">{avail.length} {avail.length === 1 ? "proposta" : "proposte"}</div></>)
            : <div className="text-[11px] text-faint">Nessuna proposta</div>}
        </div>
        <span className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>▸</span>
      </button>

      {open && <CandidateBody c={c} onDone={onToggle} />}
    </div>
  );
}

export default function ProposalsTab({ candidates, today, windowDays, setWindowDays, showEmpty, setShowEmpty, catalogEmpty, goCatalog, estimate }: {
  candidates: Candidate[]; today: string; windowDays: number; setWindowDays: (n: number) => void;
  showEmpty: boolean; setShowEmpty: (v: boolean) => void; catalogEmpty: boolean; goCatalog: () => void;
  estimate: { rate: number; value: number } | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = candidates.filter((c) => showEmpty || proposable(c.proposals).length > 0);
  const hiddenCount = candidates.length - visible.length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <span className="text-xs text-dim">Arrivi nei prossimi</span>
        {[7, 14, 30].map((d) => (
          <button key={d} onClick={() => setWindowDays(d)} className={`rounded-full border px-2.5 py-1 text-xs transition ${windowDays === d ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] font-medium text-focus" : "border-line text-dim hover:bg-wash"}`}>{d} giorni</button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> mostra anche senza proposte</label>
      </div>
      {estimate && (
        <div className="mb-3 rounded-lg bg-wash px-3 py-2 text-xs text-dim">Stima al tuo tasso di conversione storico ({Math.round(estimate.rate * 100)}%): circa <b className="font-mono text-txt">{eur(estimate.value)}</b> sul potenziale massimo qui sotto.</div>
      )}
      {catalogEmpty ? (
        <div className="rounded-xl border border-dashed border-line bg-surface">
          <EmptyState title="Nessun extra pronto da proporre" sub="Aggiungi nel catalogo gli extra con i TUOI prezzi (e conferma quelli di esempio): le proposte compariranno qui in automatico." />
          <div className="pb-5 text-center"><button onClick={goCatalog} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--focus)" }}>Vai al catalogo</button></div>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface"><EmptyState title={candidates.length === 0 ? `Nessun arrivo o ospite in casa nei prossimi ${windowDays} giorni` : "Nessuna prenotazione con proposte"} sub={candidates.length === 0 ? "Quando ci saranno prenotazioni confermate in arrivo, le proposte appariranno qui." : `${hiddenCount} prenotazioni non hanno extra proponibili (già venduti, fuori stagione, camera non libera…). Attiva "mostra anche senza proposte" per vedere il perché.`} /></div>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => <CandidateCard key={c.booking.id} c={c} today={today} open={openId === c.booking.id} onToggle={() => setOpenId((id) => (id === c.booking.id ? null : c.booking.id))} />)}
          {hiddenCount > 0 && <div className="pt-1 text-center text-[11px] text-faint">{hiddenCount} prenotazioni senza proposte nascoste.</div>}
        </div>
      )}
    </div>
  );
}
