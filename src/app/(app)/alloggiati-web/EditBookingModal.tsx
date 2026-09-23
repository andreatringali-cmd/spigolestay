"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { DOC_TYPES } from "@/lib/types";
import { downscaleImage } from "@/lib/images";

type Co = NonNullable<import("@/lib/types").Booking["extraGuests"]>[number];
type PG = NonNullable<import("@/lib/types").Booking["primaryGuest"]>;
const inp = "w-full rounded-md border border-line bg-paper px-2 py-1 text-sm text-txt outline-none focus:border-focus";

// Finestra di modifica/compilazione dei dati ospite di UNA prenotazione (ex pagina Alloggiati),
// con lettura del documento (AI) e aggiunta co-ospiti. Alla chiusura il chiamante rigenera le schedine.
export default function EditBookingModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { bookings, guests, getStructure, updateGuest, updateBooking } = useData();
  const b = bookings.find((x) => x.id === bookingId);
  const [group, setGroup] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extractInfo, setExtractInfo] = useState<{ id: string; text: string; err?: boolean } | null>(null);

  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);

  if (!b) return null;
  const guest = (id: string) => guests.find((g) => g.id === id);
  const cosOf = () => b.extraGuests ?? [];
  const roleLabel = (code: string) => ({ "16": "Ospite singolo", "17": "Capofamiglia", "18": "Capogruppo", "19": "Familiare", "20": "Membro gruppo" }[code] ?? code);
  const roleFor = (idx: number) => { const tot = 1 + cosOf().length; if (idx === 0) return tot > 1 ? (group ? "18" : "17") : "16"; return group ? "20" : "19"; };

  const primaryOf = (): PG & { fullName?: string } => {
    const g = guest(b.guestId);
    if (g) return { firstName: g.firstName, lastName: g.lastName, sex: g.sex, birthDate: g.birthDate, birthPlace: g.birthPlace, citizenship: g.citizenship, docType: g.docType, docNumber: g.docNumber, fullName: g.fullName };
    const pg = b.primaryGuest ?? {}; return { ...pg, fullName: `${pg.firstName ?? ""} ${pg.lastName ?? ""}`.trim() };
  };
  const setPrimary = (id: string, patch: Record<string, unknown>) => {
    const g = guest(id); const next = { ...g, ...patch } as Record<string, unknown>;
    if ("lastName" in patch || "firstName" in patch) next.fullName = `${next.firstName ?? ""} ${next.lastName ?? ""}`.toString().trim() || g?.fullName || "";
    updateGuest(id, next);
  };
  const setPrimaryOf = (patch: Record<string, unknown>) => { if (guest(b.guestId)) setPrimary(b.guestId, patch); else updateBooking(b.id, { primaryGuest: { ...(b.primaryGuest ?? {}), ...patch } }); };
  const setCo = (i: number, patch: Partial<Co>) => updateBooking(b.id, { extraGuests: cosOf().map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const addCo = () => updateBooking(b.id, { extraGuests: [...cosOf(), { firstName: "", lastName: "" } as Co] });
  const delCo = (i: number) => updateBooking(b.id, { extraGuests: cosOf().filter((_, j) => j !== i) });

  const normDoc = (d?: string): string | undefined => { if (!d) return undefined; if (DOC_TYPES.includes(d)) return d; if (/patente/i.test(d)) return "Patente di guida"; if (/passa/i.test(d)) return "Passaporto"; if (/identit|carta/i.test(d)) return "Carta d'identità"; return undefined; };
  const patchFrom = (f: Record<string, string>, withDoc: boolean): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    if (f.firstName) p.firstName = f.firstName; if (f.lastName) p.lastName = f.lastName;
    if (f.sex === "M" || f.sex === "F") p.sex = f.sex;
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate || "")) p.birthDate = f.birthDate;
    if (f.birthPlace) p.birthPlace = f.birthPlace; if (f.citizenship) p.citizenship = f.citizenship;
    if (withDoc) { const dt = normDoc(f.docType); if (dt) p.docType = dt; if (f.docNumber) p.docNumber = f.docNumber; }
    return p;
  };
  const fillFromDoc = (id: string, withDoc: boolean, apply: (patch: Record<string, unknown>) => void) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setExtractingId(id); setExtractInfo(null);
      try {
        const dl = await downscaleImage(file, 900, 0.72);
        const r = await fetch("/api/checkin/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: dl }) });
        const j = await r.json().catch(() => ({}));
        if (j?.ok && j.fields) {
          const patch = patchFrom(j.fields, withDoc);
          if (Object.keys(patch).length) { apply(patch); setExtractInfo({ id, text: "Campi compilati dal documento — controlla e correggi se serve." }); }
          else setExtractInfo({ id, text: "Documento letto ma nessun campo riconosciuto.", err: true });
        } else if (j?.error === "ai_not_configured") setExtractInfo({ id, text: "Lettura automatica non disponibile: compila i campi a mano.", err: true });
        else setExtractInfo({ id, text: "Non sono riuscito a leggere il documento. Riprova con una foto più nitida.", err: true });
      } catch { setExtractInfo({ id, text: "Errore nella lettura del documento.", err: true }); }
      finally { setExtractingId(null); }
    };
    input.click();
  };
  const DocBtn = ({ id, withDoc, apply }: { id: string; withDoc: boolean; apply: (p: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => fillFromDoc(id, withDoc, apply)} disabled={extractingId === id} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50">{extractingId === id ? "Leggo…" : "✨ Compila dal documento"}</button>
  );

  const g = primaryOf();
  const declared = ((g?.lastName || g?.fullName) ? 1 : 0) + cosOf().filter((c) => !!(c.lastName || c.firstName)).length;
  const pax = (b.adults ?? 1) + (b.children ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="relative z-10 max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-txt">{g?.fullName || "Ospite"} <span className="font-normal text-faint">· {roleLabel(roleFor(0))}</span></h2>
            <p className="text-[11px] text-faint">{getStructure(b.structureId)?.name}{b.code ? ` · ${b.code}` : ""} · {declared}/{pax} ospiti dichiarati</p>
          </div>
          <button onClick={onClose} aria-label="Chiudi" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-dim hover:bg-wash hover:text-txt">✕</button>
        </div>

        <div className="max-h-[72vh] overflow-y-auto p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {declared > 1 && <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} className="h-3.5 w-3.5 accent-[color:var(--focus)]" /> Gruppo (non famiglia)</label>}
            <div className="ml-auto"><DocBtn id={b.id} withDoc apply={setPrimaryOf} /></div>
          </div>
          {extractInfo?.id === b.id && <div className={`mb-2 text-[11px] font-medium ${extractInfo.err ? "text-[color:var(--warn)]" : "text-[color:var(--focus)]"}`}>✨ {extractInfo.text}</div>}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <F label="Cognome"><input className={inp} value={g?.lastName ?? ""} onChange={(e) => setPrimaryOf({ lastName: e.target.value })} /></F>
            <F label="Nome"><input className={inp} value={g?.firstName ?? ""} onChange={(e) => setPrimaryOf({ firstName: e.target.value })} /></F>
            <F label="Sesso"><select className={inp} value={g?.sex ?? ""} onChange={(e) => setPrimaryOf({ sex: e.target.value || undefined })}><option value="">—</option><option value="M">M</option><option value="F">F</option></select></F>
            <F label="Data di nascita"><input type="date" className={inp} value={g?.birthDate ?? ""} onChange={(e) => setPrimaryOf({ birthDate: e.target.value })} /></F>
            <F label="Luogo di nascita"><input className={inp} value={g?.birthPlace ?? ""} onChange={(e) => setPrimaryOf({ birthPlace: e.target.value })} placeholder="Comune o Stato" /></F>
            <F label="Cittadinanza"><input className={inp} value={g?.citizenship ?? ""} onChange={(e) => setPrimaryOf({ citizenship: e.target.value })} placeholder="Es. ITALIA" /></F>
            <F label="Tipo documento"><select className={inp} value={g?.docType ?? ""} onChange={(e) => setPrimaryOf({ docType: e.target.value || undefined })}><option value="">—</option>{DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select></F>
            <F label="Numero documento"><input className={inp} value={g?.docNumber ?? ""} onChange={(e) => setPrimaryOf({ docNumber: e.target.value })} /></F>
          </div>

          {cosOf().map((c, i) => (
            <div key={i} className="mt-3 rounded-lg border border-line bg-paper p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-dim">Ospite {i + 2}</span>
                <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-dim">{roleLabel(roleFor(i + 1))}</span>
                <span className="text-[10px] text-faint">(familiare/membro: documento non obbligatorio)</span>
                <div className="ml-auto flex items-center gap-2">
                  <DocBtn id={`${b.id}-${i}`} withDoc={false} apply={(p) => setCo(i, p as Partial<Co>)} />
                  <button onClick={() => delCo(i)} className="text-faint hover:text-[color:var(--err)]" title="Rimuovi">✕</button>
                </div>
              </div>
              {extractInfo?.id === `${b.id}-${i}` && <div className={`mb-2 text-[11px] font-medium ${extractInfo.err ? "text-[color:var(--warn)]" : "text-[color:var(--focus)]"}`}>✨ {extractInfo.text}</div>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <F label="Cognome"><input className={inp} value={c.lastName} onChange={(e) => setCo(i, { lastName: e.target.value })} /></F>
                <F label="Nome"><input className={inp} value={c.firstName} onChange={(e) => setCo(i, { firstName: e.target.value })} /></F>
                <F label="Sesso"><select className={inp} value={c.sex ?? ""} onChange={(e) => setCo(i, { sex: (e.target.value || undefined) as Co["sex"] })}><option value="">—</option><option value="M">M</option><option value="F">F</option></select></F>
                <F label="Data di nascita"><input type="date" className={inp} value={c.birthDate ?? ""} onChange={(e) => setCo(i, { birthDate: e.target.value })} /></F>
                <F label="Luogo di nascita"><input className={inp} value={c.birthPlace ?? ""} onChange={(e) => setCo(i, { birthPlace: e.target.value })} placeholder="Comune o Stato" /></F>
                <F label="Cittadinanza"><input className={inp} value={c.citizenship ?? ""} onChange={(e) => setCo(i, { citizenship: e.target.value })} placeholder="Es. ITALIA" /></F>
              </div>
            </div>
          ))}
          <button onClick={addCo} className="mt-3 rounded-lg border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash">+ Aggiungi ospite</button>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line p-4">
          <span className="text-[11px] text-faint">Le modifiche si salvano da sole. Chiudendo, le schedine vengono rigenerate.</span>
          <button onClick={onClose} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Fatto</button>
        </div>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-dim">{label}</span>{children}</label>;
}
