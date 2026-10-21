"use client";

import DateField from "@/components/DateField";
import { useState } from "react";
import { Button, Modal } from "@/components/ui/index";
import { useConfirm } from "@/components/ConfirmProvider";
import { useData } from "@/lib/store";
import { DOC_TYPES } from "@/lib/types";
import { downscaleImage } from "@/lib/images";
import { docTypeFromText } from "@/lib/checkin-flow";

type Co = NonNullable<import("@/lib/types").Booking["extraGuests"]>[number];
type PG = NonNullable<import("@/lib/types").Booking["primaryGuest"]>;
const inp = "w-full rounded-md border border-line bg-paper px-2 py-1 text-sm text-txt outline-none focus:border-focus";

// Finestra di modifica/compilazione dei dati ospite di UNA prenotazione (ex pagina Alloggiati),
// con lettura del documento (AI) e aggiunta co-ospiti. Alla chiusura il chiamante rigenera le schedine.
export default function EditBookingModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { bookings, guests, getStructure, updateGuest, updateBooking } = useData();
  const ask = useConfirm();
  const b = bookings.find((x) => x.id === bookingId);
  const [group, setGroup] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extractInfo, setExtractInfo] = useState<{ id: string; text: string; err?: boolean } | null>(null);

  if (!b) return null;
  const guest = (id: string) => guests.find((g) => g.id === id);
  const cosOf = () => b.extraGuests ?? [];
  const roleLabel = (code: string) => ({ "16": "Ospite singolo", "17": "Capofamiglia", "18": "Capogruppo", "19": "Familiare", "20": "Membro gruppo" }[code] ?? code);
  const roleFor = (idx: number) => { const tot = 1 + cosOf().length; if (idx === 0) return tot > 1 ? (group ? "18" : "17") : "16"; return group ? "20" : "19"; };

  const primaryOf = (): PG & { fullName?: string } => {
    // I dati di chi ha fatto il check-in stanno sulla PRENOTAZIONE (primaryGuest): l'anagrafica è condivisa fra le camere di un gruppo e fra soggiorni diversi, quindi vale solo dove la prenotazione non ha dati propri.
    const pg = b.primaryGuest ?? {};
    if (pg.lastName) return { ...pg, fullName: `${pg.firstName ?? ""} ${pg.lastName ?? ""}`.trim() };
    const g = guest(b.guestId);
    if (g) return { firstName: g.firstName, lastName: g.lastName, sex: g.sex, birthDate: g.birthDate, birthPlace: g.birthPlace, citizenship: g.citizenship, docType: g.docType, docNumber: g.docNumber, docPlace: g.docPlace, fullName: g.fullName };
    return { ...pg, fullName: `${pg.firstName ?? ""} ${pg.lastName ?? ""}`.trim() };
  };
  const setPrimary = (id: string, patch: Record<string, unknown>) => {
    const g = guest(id); const next = { ...g, ...patch } as Record<string, unknown>;
    if ("lastName" in patch || "firstName" in patch) next.fullName = `${next.firstName ?? ""} ${next.lastName ?? ""}`.toString().trim() || g?.fullName || "";
    updateGuest(id, next);
  };
  // Se la prenotazione ha già primaryGuest (es. dal check-in online) la sync Alloggiati lo preferisce alla scheda ospite: la correzione va applicata a entrambi.
  // La correzione si scrive SEMPRE sulla prenotazione (così conta come check-in compilato e la schedina nasce dai dati giusti); sull'anagrafica solo per prenotazioni singole:
  // nei gruppi l'anagrafica è quella del prenotante, non di chi guida questa camera.
  const setPrimaryOf = async (patch: Record<string, unknown>) => {
    const cur = primaryOf();
    // Prenotazione SENZA check-in: i dati mostrati vengono dalla scheda ospite (anche di un soggiorno precedente). Copiarli sulla prenotazione la fa contare come "check-in fatto":
    // l'operatore deve confermare di voler usare quei dati per questo soggiorno (si chiede una volta sola: dopo, la prenotazione ha il suo primaryGuest).
    if (!b.primaryGuest && (cur.lastName || cur.docNumber)) {
      const ok = await ask({ title: "Usare i dati della scheda ospite?", message: "Questa prenotazione non ha ancora un check-in. I dati mostrati vengono dalla scheda ospite (potrebbero essere di un soggiorno precedente): se prosegui verranno copiati su questa prenotazione, che risulterà con check-in fatto e la schedina per la Questura sarà generata con questi dati. Verifica che siano quelli di questo soggiorno. Continuare?", confirmLabel: "Continua" });
      if (!ok) return;
    }
    const base: Record<string, unknown> = b.primaryGuest ?? { firstName: cur.firstName, lastName: cur.lastName, sex: cur.sex, birthDate: cur.birthDate, birthPlace: cur.birthPlace, citizenship: cur.citizenship, docType: cur.docType, docNumber: cur.docNumber, docPlace: cur.docPlace };
    updateBooking(b.id, { primaryGuest: { ...base, ...patch } as PG });
    if (guest(b.guestId) && !b.groupId) setPrimary(b.guestId, patch);
  };
  const setCo = (i: number, patch: Partial<Co>) => updateBooking(b.id, { extraGuests: cosOf().map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const addCo = () => updateBooking(b.id, { extraGuests: [...cosOf(), { firstName: "", lastName: "" } as Co] });
  const delCo = (i: number) => updateBooking(b.id, { extraGuests: cosOf().filter((_, j) => j !== i) });

  const normDoc = (d?: string): string | undefined => { if (!d) return undefined; if (DOC_TYPES.includes(d)) return d; const t = docTypeFromText(d); return t && DOC_TYPES.includes(t) ? t : undefined; };
  const patchFrom = (f: Record<string, string>, withDoc: boolean): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    if (f.firstName) p.firstName = f.firstName; if (f.lastName) p.lastName = f.lastName;
    if (f.sex === "M" || f.sex === "F") p.sex = f.sex;
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate || "")) p.birthDate = f.birthDate;
    if (f.birthPlace) p.birthPlace = f.birthPlace; if (f.citizenship) p.citizenship = f.citizenship;
    if (withDoc) { const dt = normDoc(f.docType); if (dt) p.docType = dt; if (f.docNumber) p.docNumber = f.docNumber; if (f.docPlace) p.docPlace = f.docPlace; }
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
  const declared = ((b.webCheckin || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber)) ? 1 : 0) + cosOf().filter((c) => !!(c.lastName || c.firstName)).length;
  const pax = (b.adults ?? 1) + (b.children ?? 0);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={<span className="block truncate">{g?.fullName || "Ospite"} <span className="font-normal text-dim">· {roleLabel(roleFor(0))}</span></span>}
      description={`${getStructure(b.structureId)?.name ?? ""}${b.code ? ` · ${b.code}` : ""} · ${declared}/${pax} ospiti dichiarati`}
      footer={<>
        <span className="mr-auto text-[11px] text-dim">Le modifiche si salvano da sole. Chiudendo, le schedine vengono rigenerate.</span>
        <Button onClick={onClose}>Fatto</Button>
      </>}
    >
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {declared > 1 && <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} className="h-3.5 w-3.5 accent-[color:var(--focus)]" /> Gruppo (non famiglia)</label>}
            <div className="ml-auto"><DocBtn id={b.id} withDoc apply={setPrimaryOf} /></div>
          </div>
          {extractInfo?.id === b.id && <div className={`mb-2 text-[11px] font-medium ${extractInfo.err ? "text-[color:var(--warn)]" : "text-[color:var(--focus)]"}`}>✨ {extractInfo.text}</div>}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <F label="Cognome"><input className={inp} value={g?.lastName ?? ""} onChange={(e) => setPrimaryOf({ lastName: e.target.value })} /></F>
            <F label="Nome"><input className={inp} value={g?.firstName ?? ""} onChange={(e) => setPrimaryOf({ firstName: e.target.value })} /></F>
            <F label="Sesso"><select className={inp} value={g?.sex ?? ""} onChange={(e) => setPrimaryOf({ sex: e.target.value || undefined })}><option value="">—</option><option value="M">M</option><option value="F">F</option></select></F>
            <F label="Data di nascita"><DateField className={inp} value={g?.birthDate ?? ""} onChange={(v) => setPrimaryOf({ birthDate: v })} /></F>
            <F label="Luogo di nascita"><input className={inp} value={g?.birthPlace ?? ""} onChange={(e) => setPrimaryOf({ birthPlace: e.target.value })} placeholder="Comune o Stato" /></F>
            <F label="Cittadinanza"><input className={inp} value={g?.citizenship ?? ""} onChange={(e) => setPrimaryOf({ citizenship: e.target.value })} placeholder="Es. ITALIA" /></F>
            <F label="Tipo documento"><select className={inp} value={g?.docType ?? ""} onChange={(e) => setPrimaryOf({ docType: e.target.value || undefined })}><option value="">—</option>{DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select></F>
            <F label="Numero documento"><input className={inp} value={g?.docNumber ?? ""} onChange={(e) => setPrimaryOf({ docNumber: e.target.value })} /></F>
            <F label="Luogo di rilascio"><input className={inp} value={g?.docPlace ?? ""} onChange={(e) => setPrimaryOf({ docPlace: e.target.value })} placeholder="Es. Comune di Siracusa" /></F>
          </div>

          {cosOf().map((c, i) => (
            <div key={i} className="mt-3 rounded-lg border border-line bg-paper p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-dim">Ospite {i + 2}</span>
                <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-dim">{roleLabel(roleFor(i + 1))}</span>
                <span className="text-[11px] text-faint">(familiare/membro: documento non obbligatorio)</span>
                <div className="ml-auto flex items-center gap-2">
                  <DocBtn id={`${b.id}-${i}`} withDoc={false} apply={(p) => setCo(i, p as Partial<Co>)} />
                  <button aria-label="Rimuovi" onClick={() => delCo(i)} className="text-faint hover:text-[color:var(--err)]" title="Rimuovi">✕</button>
                </div>
              </div>
              {extractInfo?.id === `${b.id}-${i}` && <div className={`mb-2 text-[11px] font-medium ${extractInfo.err ? "text-[color:var(--warn)]" : "text-[color:var(--focus)]"}`}>✨ {extractInfo.text}</div>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <F label="Cognome"><input className={inp} value={c.lastName} onChange={(e) => setCo(i, { lastName: e.target.value })} /></F>
                <F label="Nome"><input className={inp} value={c.firstName} onChange={(e) => setCo(i, { firstName: e.target.value })} /></F>
                <F label="Sesso"><select className={inp} value={c.sex ?? ""} onChange={(e) => setCo(i, { sex: (e.target.value || undefined) as Co["sex"] })}><option value="">—</option><option value="M">M</option><option value="F">F</option></select></F>
                <F label="Data di nascita"><DateField className={inp} value={c.birthDate ?? ""} onChange={(v) => setCo(i, { birthDate: v })} /></F>
                <F label="Luogo di nascita"><input className={inp} value={c.birthPlace ?? ""} onChange={(e) => setCo(i, { birthPlace: e.target.value })} placeholder="Comune o Stato" /></F>
                <F label="Cittadinanza"><input className={inp} value={c.citizenship ?? ""} onChange={(e) => setCo(i, { citizenship: e.target.value })} placeholder="Es. ITALIA" /></F>
              </div>
            </div>
          ))}
          <button onClick={addCo} className="mt-3 rounded-lg border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash">+ Aggiungi ospite</button>
        </div>
    </Modal>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-dim">{label}</span>{children}</label>;
}
