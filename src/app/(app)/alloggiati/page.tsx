"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { nights, parseISO, toISO } from "@/lib/dates";
import { DOC_TYPES } from "@/lib/types";
import { useLang } from "@/lib/i18n";
import { PageHeader, Card } from "@/components/ui";
import EmptyState from "@/components/EmptyState";

type Co = NonNullable<import("@/lib/types").Booking["extraGuests"]>[number];

const fmt = (iso: string) => (iso ? parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const inp = "w-full rounded-md border border-line bg-paper px-2 py-1 text-sm text-txt outline-none focus:border-focus";
const pad = (s: string | number | undefined, n: number) => (s ?? "").toString().toUpperCase().slice(0, n).padEnd(n, " ");
const ggmmaaaa = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "".padEnd(10, " "));
const DOC_CODE: Record<string, string> = { "Carta d'identità": "IDENT", Passaporto: "PASOR", "Patente di guida": "PATEN" };
const isItaly = (s?: string) => /ital/i.test(s ?? "");

export default function AlloggiatiPage() {
  const { t } = useLang();
  const { bookings, guests, getStructure, updateGuest, updateBooking, activeStructureId } = useData();

  const todayISO = toISO(new Date());
  const [from, setFrom] = useState(todayISO);
  const [to, setTo] = useState(todayISO);
  const [groupMode, setGroupMode] = useState<Record<string, boolean>>({}); // true = gruppo (non famiglia)

  const guest = (id: string) => guests.find((g) => g.id === id);
  const arrivals = useMemo(
    () => bookings
      .filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (activeStructureId === "all" || b.structureId === activeStructureId))
      .filter((b) => b.checkIn >= from && b.checkIn <= to)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn)),
    [bookings, from, to, activeStructureId]
  );

  const cosOf = (b: { extraGuests?: Co[] }) => b.extraGuests ?? [];
  // Ruolo per posizione: 0 = capo (o singolo); altri = familiare/membro.
  const roleFor = (b: { id: string; extraGuests?: Co[] }, idx: number) => {
    const tot = 1 + cosOf(b).length;
    const grp = !!groupMode[b.id];
    if (idx === 0) return tot > 1 ? (grp ? "18" : "17") : "16";
    return grp ? "20" : "19";
  };
  // Ospite principale: dall'anagrafica se collegata, altrimenti dai dati conservati sulla prenotazione.
  type PG = NonNullable<import("@/lib/types").Booking["primaryGuest"]>;
  const primaryOf = (b: { guestId: string; primaryGuest?: PG }): PG & { fullName?: string } => {
    const g = guest(b.guestId);
    if (g) return { firstName: g.firstName, lastName: g.lastName, sex: g.sex, birthDate: g.birthDate, birthPlace: g.birthPlace, citizenship: g.citizenship, docType: g.docType, docNumber: g.docNumber, fullName: g.fullName };
    const pg = b.primaryGuest ?? {};
    return { ...pg, fullName: `${pg.firstName ?? ""} ${pg.lastName ?? ""}`.trim() };
  };
  const primaryOk = (b: { guestId: string; primaryGuest?: PG }) => { const p = primaryOf(b); return !!((p.lastName || p.fullName) && p.sex && p.birthDate && p.birthPlace && p.citizenship && p.docType && p.docNumber); };
  const coOk = (c: Co) => !!(c.lastName && c.firstName && c.sex && c.birthDate && c.birthPlace && c.citizenship);
  const bookingOk = (b: { id: string; guestId: string; primaryGuest?: PG; extraGuests?: Co[] }) => primaryOk(b) && cosOf(b).every(coOk);
  const readyCount = arrivals.filter(bookingOk).length;
  const totalPeople = (b: { extraGuests?: Co[] }) => 1 + cosOf(b).length;

  const setPrimary = (id: string, patch: Record<string, unknown>) => {
    const g = guest(id); const next = { ...g, ...patch } as Record<string, unknown>;
    if ("lastName" in patch || "firstName" in patch) next.fullName = `${next.firstName ?? ""} ${next.lastName ?? ""}`.toString().trim() || g?.fullName || "";
    updateGuest(id, next);
  };
  // Scrive sull'anagrafica se collegata, altrimenti sui dati conservati nella prenotazione.
  const setPrimaryOf = (b: { id: string; guestId: string; primaryGuest?: PG }, patch: Record<string, unknown>) => {
    if (guest(b.guestId)) setPrimary(b.guestId, patch);
    else updateBooking(b.id, { primaryGuest: { ...(b.primaryGuest ?? {}), ...patch } });
  };
  const setCo = (b: { id: string; extraGuests?: Co[] }, i: number, patch: Partial<Co>) => updateBooking(b.id, { extraGuests: cosOf(b).map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const addCo = (b: { id: string; extraGuests?: Co[] }) => updateBooking(b.id, { extraGuests: [...cosOf(b), { firstName: "", lastName: "" } as Co] });
  const delCo = (b: { id: string; extraGuests?: Co[] }, i: number) => updateBooking(b.id, { extraGuests: cosOf(b).filter((_, j) => j !== i) });

  const record = (role: string, checkIn: string, nn: number, p: { lastName?: string; firstName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docType?: string; docNumber?: string }) => {
    const hasDoc = ["16", "17", "18"].includes(role);
    const italy = isItaly(p.citizenship) || isItaly(p.birthPlace);
    const rec =
      pad(role, 2) + ggmmaaaa(checkIn) + String(Math.min(nn, 30)).padStart(2, "0").slice(0, 2) +
      pad(p.lastName, 50) + pad(p.firstName, 30) + (p.sex === "F" ? "2" : "1") + ggmmaaaa(p.birthDate) +
      "".padEnd(9, " ") + pad(italy ? "" : "EE", 2) + "".padEnd(9, " ") + "".padEnd(9, " ") +
      (hasDoc ? pad(DOC_CODE[p.docType ?? ""] ?? "", 5) + pad(p.docNumber, 20) + "".padEnd(9, " ") : "".padEnd(34, " "));
    return rec.slice(0, 168).padEnd(168, " ");
  };

  const genera = () => {
    const lines: string[] = [];
    for (const b of arrivals.filter(bookingOk)) {
      const nn = nights(b.checkIn, b.checkOut);
      const g = primaryOf(b);
      lines.push(record(roleFor(b, 0), b.checkIn, nn, g));
      cosOf(b).forEach((c, i) => lines.push(record(roleFor(b, i + 1), b.checkIn, nn, c)));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `alloggiati_${from}_${to}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const roleLabel = (code: string) => ({ "16": "Ospite singolo", "17": "Capofamiglia", "18": "Capogruppo", "19": "Familiare", "20": "Membro gruppo" }[code] ?? code);

  return (
    <div>
      <PageHeader
        title={t("Alloggiati · Tracciato Questura")}
        subtitle={t("Comunicazione ospiti alla Questura (entro 24h dal check-in) · un record per persona")}
        actions={<button onClick={genera} disabled={readyCount === 0} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{t("Genera tracciato")} ({readyCount})</button>}
      />

      {/* Come inviare */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
          <div className="text-sm font-bold text-txt">{t("Come inviare al Portale Alloggiati")}</div>
          <ol className="flex flex-1 flex-wrap gap-x-6 gap-y-1 text-xs text-dim">
            <li><b className="text-txt">1.</b> {t("Genera il tracciato (.txt)")}</li>
            <li><b className="text-txt">2.</b> {t("Entra su alloggiatiweb.poliziadistato.it")}</li>
            <li><b className="text-txt">3.</b> {t("Invio → Invio da file → carica il .txt")}</li>
            <li className="text-faint">{t("(o via web service con certificato, in automatico)")}</li>
          </ol>
        </div>
      </Card>

      {/* Filtro periodo */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-dim">{t("Dal")}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
          <label className="text-xs text-dim">{t("Al")}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
          <button onClick={() => { setFrom(todayISO); setTo(todayISO); }} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Oggi")}</button>
          <div className="ml-auto text-right text-sm">
            <div className="text-xs text-dim">{t("Arrivi nel periodo")}</div>
            <div><span className="font-mono text-lg font-bold text-txt">{arrivals.length}</span> <span className="text-xs text-dim">· {t("pronti")} </span><span className="font-mono font-bold text-[color:var(--ok)]">{readyCount}</span></div>
          </div>
        </div>
      </Card>

      {arrivals.length === 0 ? (
        <Card><EmptyState title={t("Nessun arrivo nel periodo selezionato.")} /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {arrivals.map((b) => {
            const g = primaryOf(b);
            const complete = bookingOk(b);
            const declared = totalPeople(b);
            const pax = b.adults + b.children;
            return (
              <Card key={b.id} className={complete ? "" : "border-[color:color-mix(in_srgb,var(--warn)_45%,var(--line))]"}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${complete ? "bg-[color:var(--ok)]" : "bg-[color:var(--warn)]"}`} />
                  <span className="font-display text-base font-bold text-txt">{g?.fullName || t("Ospite")}</span>
                  <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-dim">{roleLabel(roleFor(b, 0))}</span>
                  <span className="text-xs text-dim">{getStructure(b.structureId)?.name} · {t("arrivo")} {fmt(b.checkIn)} · {nights(b.checkIn, b.checkOut)} {t("notti")}</span>
                  <span className={`text-xs ${declared < pax ? "text-[color:var(--warn)]" : "text-faint"}`}>· {declared}/{pax} {t("ospiti dichiarati")}</span>
                  {declared > 1 && (
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={!!groupMode[b.id]} onChange={(e) => setGroupMode((m) => ({ ...m, [b.id]: e.target.checked }))} className="h-3.5 w-3.5 accent-[color:var(--focus)]" /> {t("Gruppo (non famiglia)")}</label>
                  )}
                </div>

                {/* Ospite principale */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  <F label={t("Cognome")}><input className={inp} value={g?.lastName ?? ""} onChange={(e) => setPrimaryOf(b, { lastName: e.target.value })} /></F>
                  <F label={t("Nome")}><input className={inp} value={g?.firstName ?? ""} onChange={(e) => setPrimaryOf(b, { firstName: e.target.value })} /></F>
                  <F label={t("Sesso")}><select className={inp} value={g?.sex ?? ""} onChange={(e) => setPrimaryOf(b, { sex: e.target.value || undefined })}><option value="">—</option><option value="M">M</option><option value="F">F</option></select></F>
                  <F label={t("Data di nascita")}><input type="date" className={inp} value={g?.birthDate ?? ""} onChange={(e) => setPrimaryOf(b, { birthDate: e.target.value })} /></F>
                  <F label={t("Luogo di nascita")}><input className={inp} value={g?.birthPlace ?? ""} onChange={(e) => setPrimaryOf(b, { birthPlace: e.target.value })} placeholder={t("Comune o Stato")} /></F>
                  <F label={t("Cittadinanza")}><input className={inp} value={g?.citizenship ?? ""} onChange={(e) => setPrimaryOf(b, { citizenship: e.target.value })} placeholder={t("Es. ITALIA")} /></F>
                  <F label={t("Tipo documento")}><select className={inp} value={g?.docType ?? ""} onChange={(e) => setPrimaryOf(b, { docType: e.target.value || undefined })}><option value="">—</option>{DOC_TYPES.map((d) => (<option key={d} value={d}>{d}</option>))}</select></F>
                  <F label={t("Numero documento")}><input className={inp} value={g?.docNumber ?? ""} onChange={(e) => setPrimaryOf(b, { docNumber: e.target.value })} /></F>
                </div>

                {/* Co-ospiti */}
                {cosOf(b).map((c, i) => (
                  <div key={i} className="mt-3 rounded-lg border border-line bg-paper p-2.5">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-xs font-semibold text-dim">{t("Ospite")} {i + 2}</span>
                      <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-dim">{roleLabel(roleFor(b, i + 1))}</span>
                      <span className="text-[10px] text-faint">{t("(familiare/membro: documento non obbligatorio)")}</span>
                      <button onClick={() => delCo(b, i)} className="ml-auto text-faint hover:text-[color:var(--err)]" title={t("Rimuovi")}>✕</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      <F label={t("Cognome")}><input className={inp} value={c.lastName} onChange={(e) => setCo(b, i, { lastName: e.target.value })} /></F>
                      <F label={t("Nome")}><input className={inp} value={c.firstName} onChange={(e) => setCo(b, i, { firstName: e.target.value })} /></F>
                      <F label={t("Sesso")}><select className={inp} value={c.sex ?? ""} onChange={(e) => setCo(b, i, { sex: (e.target.value || undefined) as Co["sex"] })}><option value="">—</option><option value="M">M</option><option value="F">F</option></select></F>
                      <F label={t("Data di nascita")}><input type="date" className={inp} value={c.birthDate ?? ""} onChange={(e) => setCo(b, i, { birthDate: e.target.value })} /></F>
                      <F label={t("Luogo di nascita")}><input className={inp} value={c.birthPlace ?? ""} onChange={(e) => setCo(b, i, { birthPlace: e.target.value })} placeholder={t("Comune o Stato")} /></F>
                      <F label={t("Cittadinanza")}><input className={inp} value={c.citizenship ?? ""} onChange={(e) => setCo(b, i, { citizenship: e.target.value })} placeholder={t("Es. ITALIA")} /></F>
                    </div>
                  </div>
                ))}

                <button onClick={() => addCo(b)} className="mt-3 rounded-lg border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash">+ {t("Aggiungi ospite")}</button>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-xs text-faint">
        {t("Un record per ogni persona (168 caratteri). Ruoli assegnati automaticamente: capofamiglia/capogruppo + familiari/membri. I co-ospiti arrivano dal")} <b className="text-dim">{t("check-in online")}</b> {t("o si aggiungono qui. I codici catastali (comune/stato) usano le tabelle ufficiali in produzione.")}
      </p>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-dim">{label}</span>{children}</label>;
}
