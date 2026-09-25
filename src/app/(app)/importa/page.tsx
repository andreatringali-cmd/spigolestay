"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import ConfirmDialog from "@/components/ConfirmDialog";
import { CHANNELS } from "@/lib/types";
import { parseICS, importIcsEvents, toChannel, toISO, toNum, normName, makeUnitAssigner, type IcsEvent } from "@/lib/ics";
import { buildTemplateCsv, bookingDedupeKey } from "@/lib/import/template";

// ── Parsing CSV robusto (virgolette, delimitatore auto ; , o tab) ──
function parseCSV(text: string): string[][] {
  text = text.replace(/\r\n?/g, "\n").replace(/^﻿/, "").trim();
  if (!text) return [];
  const first = text.split("\n")[0];
  const delim = ([";", "\t", ","] as const).map((d) => [d, first.split(d).length] as [string, number]).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Campi di destinazione + parole chiave per l'auto-mappatura (IT/EN)
const FIELDS: { key: string; label: string; req?: boolean; kw: RegExp }[] = [
  { key: "guest", label: "Ospite (nome)", req: true, kw: /ospite|nome|guest|cliente|name|intestatario/i },
  { key: "checkIn", label: "Check-in", req: true, kw: /check.?in|arrivo|arrival|dal\b|from|inizio|data.?in/i },
  { key: "checkOut", label: "Check-out", req: true, kw: /check.?out|partenza|departure|al\b|to\b|fine|data.?out/i },
  { key: "room", label: "Camera / tipologia", kw: /camera|room|tipolog|unit|alloggio|appartamento|systemato/i },
  { key: "channel", label: "Canale", kw: /canale|channel|portale|source|origine|\bota\b|provenienza/i },
  { key: "adults", label: "Ospiti / adulti", kw: /adult|ospiti|pax|persone|guests?/i },
  { key: "children", label: "Bambini", kw: /bambin|child|kids|minor/i },
  { key: "total", label: "Importo totale", kw: /totale|total|importo|amount|prezzo|price|revenue|incasso|ricavo/i },
  { key: "email", label: "Email", kw: /email|mail/i },
  { key: "phone", label: "Telefono", kw: /telefono|phone|tel\b|cell|mobile/i },
  { key: "bookedOn", label: "Data prenotazione", kw: /prenotat|booked|creat|created|data.?pren/i },
  { key: "note", label: "Note", kw: /note|nota|remark|comment|richiest/i },
];

export default function ImportaPage() {
  const router = useRouter();
  const { t } = useLang();
  const { structures, roomTypes, units, bookings, guests, activeStructureId, addGuest, addBooking, updateBooking, deleteBooking, addRoomType, addUnit } = useData();
  const [rows, setRows] = useState<string[][]>([]);
  const [mode, setMode] = useState<"csv" | "ics">("csv");
  const [events, setEvents] = useState<IcsEvent[]>([]);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Record<string, number>>({});
  const [structureId, setStructureId] = useState<string>(() => (activeStructureId !== "all" ? activeStructureId : structures[0]?.id ?? ""));
  const [includeBlocked, setIncludeBlocked] = useState(false);
  const [replacePrev, setReplacePrev] = useState(true);
  const [targetUnit, setTargetUnit] = useState<string>(""); // "" = auto per tipologia; altrimenti id camera specifica
  const [roomMap, setRoomMap] = useState<Record<string, string>>({}); // nome camera ICS -> id tipologia (o "__new__")
  const [unitMap, setUnitMap] = useState<Record<string, string>>({}); // nome camera CSV (Octorate) -> id camera Xenora (o "__new__")
  const [unitMapType, setUnitMapType] = useState<Record<string, string>>({}); // nome camera CSV -> tipologia sotto cui creare la nuova camera
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);

  // Prenotazioni importate in precedenza (qualsiasi import, CSV o ICS, tagga sempre la nota
  // con "Importato da …"): permette di ANNULLARLE in un click, senza cercarle a mano.
  const importedBookings = useMemo(() => bookings.filter((b) => (b.note || "").includes("Importato da")), [bookings]);
  const undoImport = () => { importedBookings.forEach((b) => deleteBooking(b.id)); setConfirmUndo(false); };

  const icsRooms = useMemo(() => { const set = new Set<string>(); events.forEach((e) => { if (e.room) set.add(e.room.trim()); }); return [...set]; }, [events]);
  // Auto-mappatura camere ICS → tipologie esistenti (riempie solo le mancanti, così non fa loop).
  useEffect(() => {
    if (mode !== "ics" || !icsRooms.length) return;
    setRoomMap((prev) => {
      const sRooms = roomTypes.filter((rt) => rt.structureId === structureId);
      const next = { ...prev }; let changed = false;
      icsRooms.forEach((r) => {
        if (next[r] === undefined) {
          const sn = normName(r);
          const hit = sRooms.find((rt) => normName(rt.name) === sn) || sRooms.find((rt) => { const rn = normName(rt.name); return sn.includes(rn) || rn.includes(sn); });
          next[r] = hit ? hit.id : "__new__"; changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [icsRooms, structureId, mode, roomTypes]);

  // Se la struttura non è ancora impostata (store caricato dopo il mount), aggancia la prima disponibile.
  useEffect(() => {
    if ((!structureId || !structures.some((s) => s.id === structureId)) && structures[0]) setStructureId(structures[0].id);
  }, [structures, structureId]);

  const headers = rows[0] ?? [];
  const dataRows = useMemo(() => rows.slice(1).filter((r) => r.some((c) => (c || "").trim())), [rows]);

  // Carica testo iCal (da file o da URL) → anteprima eventi.
  const loadIcsText = (text: string, label: string) => {
    const ev = parseICS(text);
    setMode("ics"); setEvents(ev); setRows([]); setMap({}); setFileName(label);
    if (!ev.length) setErr(t("Nessuna prenotazione trovata nel calendario iCal."));
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(""); setDone(null); setFileName(f.name);
    const text = await f.text();
    if (/BEGIN:VCALENDAR/i.test(text) || /\.ics$/i.test(f.name)) { loadIcsText(text, f.name); return; }
    setMode("csv"); setEvents([]);
    const parsed = parseCSV(text);
    if (parsed.length < 2) { setErr(t("Il file sembra vuoto o non valido.")); setRows([]); return; }
    setRows(parsed);
    const auto: Record<string, number> = {};
    parsed[0].forEach((h, i) => { FIELDS.forEach((f2) => { if (auto[f2.key] === undefined && f2.kw.test(h)) auto[f2.key] = i; }); });
    setMap(auto);
  };

  // Scarica il template CSV da compilare (con colonne attese + 2 righe d'esempio).
  const downloadTemplate = () => {
    try {
      const blob = new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "xenora-template-prenotazioni.csv";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setErr(t("Impossibile generare il template.")); }
  };

  // Scarica un calendario da un URL .ics (via proxy /api/ical, che aggira il CORS).
  const fetchIcalUrl = async () => {
    const url = icsUrl.trim();
    if (!/^https?:\/\//i.test(url)) { setErr(t("Inserisci un URL iCal valido (https://…).")); return; }
    setErr(""); setDone(null); setFetching(true);
    try {
      const res = await fetch(`/api/ical?url=${encodeURIComponent(url)}`, { cache: "no-store" });
      if (!res.ok) { const msg = await res.text().catch(() => ""); setErr(msg || `${t("Download fallito")} (HTTP ${res.status})`); return; }
      const text = await res.text();
      loadIcsText(text, url);
    } catch {
      setErr(t("Impossibile scaricare il calendario (verifica l'URL)."));
    } finally { setFetching(false); }
  };

  const runImportICS = () => {
    const { created, updated } = importIcsEvents(events, { structureId, includeBlocked, replacePrev, targetUnit, roomMap, source: "ICS" },
      { bookings, units, roomTypes, addGuest, addBooking, updateBooking, deleteBooking, addRoomType, addUnit, t });
    setDone(created);
    if (updated) setErr(`${updated} ${t("prenotazioni già presenti aggiornate (nessun duplicato).")}`);
  };

  const val = (r: string[], key: string) => { const i = map[key]; return i === undefined || i < 0 ? "" : (r[i] ?? "").trim(); };
  const ready = structureId && map.guest !== undefined && map.checkIn !== undefined && map.checkOut !== undefined && dataRows.length > 0;

  // Camere distinte trovate nel file (colonna "Camera"), per la mappatura ESPLICITA: per ognuna
  // decidi tu a quale camera di Xenora agganciarla (o creane una nuova con lo stesso nome).
  const csvRooms = useMemo(() => {
    if (map.room === undefined) return [] as string[];
    const set = new Set<string>();
    dataRows.forEach((r) => { const v = val(r, "room"); if (v) set.add(v); });
    return [...set];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataRows, map.room]);
  const sUnitsHere = useMemo(() => units.filter((u) => u.structureId === structureId), [units, structureId]);
  const sRoomsHere = useMemo(() => roomTypes.filter((rt) => rt.structureId === structureId), [roomTypes, structureId]);

  // Auto-proposta (riempie solo le mancanti):
  //  1) il testo combacia con una CAMERA esistente (nome esatto, es. "SH_#1")   → quella camera.
  //  2) il testo combacia con una TIPOLOGIA esistente (es. "Camera ... Deluxe") → assegnazione
  //     automatica nella tipologia (bin-packing, niente sovrapposizioni): è il caso più comune,
  //     perché gli export di Octorate riportano di solito la TIPOLOGIA, non la camera specifica.
  //  3) nessuna corrispondenza                                                 → crea nuova camera.
  // Resta comunque tutto modificabile a mano.
  useEffect(() => {
    if (mode !== "csv" || !csvRooms.length) return;
    setUnitMap((prev) => {
      const next = { ...prev }; let changed = false;
      csvRooms.forEach((txt) => {
        if (next[txt] === undefined) {
          const s = txt.toLowerCase().trim();
          const unitHit = sUnitsHere.find((u) => u.name.toLowerCase().trim() === s) || sUnitsHere.find((u) => s.includes(u.name.toLowerCase().trim()) || u.name.toLowerCase().trim().includes(s));
          if (unitHit) { next[txt] = unitHit.id; changed = true; return; }
          const sn = normName(txt);
          const typeHit = sn ? (sRoomsHere.find((rt) => normName(rt.name) === sn) || sRoomsHere.find((rt) => { const rn = normName(rt.name); return !!rn && (sn.includes(rn) || rn.includes(sn)); })) : undefined;
          next[txt] = typeHit ? "__type__" : "__new__"; changed = true;
        }
      });
      return changed ? next : prev;
    });
    setUnitMapType((prev) => {
      const next = { ...prev }; let changed = false;
      csvRooms.forEach((txt) => {
        if (next[txt] === undefined) {
          const sn = normName(txt);
          const hit = sn ? (sRoomsHere.find((rt) => normName(rt.name) === sn) || sRoomsHere.find((rt) => { const rn = normName(rt.name); return !!rn && (sn.includes(rn) || rn.includes(sn)); })) : undefined;
          next[txt] = hit ? hit.id : (sRoomsHere[0]?.id ?? ""); changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [csvRooms, mode, sUnitsHere, sRoomsHere]);

  const roomResolvedLabel = (txt: string): string => {
    if (!txt) return "—";
    const target = unitMap[txt];
    if (target === "__type__") { const rt = sRoomsHere.find((x) => x.id === unitMapType[txt]); return `${t("Auto")} · ${rt?.name || "—"}`; }
    if (target && target !== "__new__") { const u = sUnitsHere.find((x) => x.id === target); return u ? u.name : "—"; }
    return `${txt} (${t("nuova")})`;
  };

  const preview = dataRows.slice(0, 5).map((r) => ({
    guest: val(r, "guest"), checkIn: toISO(val(r, "checkIn")), checkOut: toISO(val(r, "checkOut")),
    room: val(r, "room"), roomResolved: roomResolvedLabel(val(r, "room")), channel: CHANNELS[toChannel(val(r, "channel"))].label, total: toNum(val(r, "total")),
  }));

  // Quante righe (su TUTTO il file, non solo l'anteprima) hanno una data non riconosciuta:
  // se il conteggio è alto, l'import sembrerebbe "non fare nulla" (0 importate) senza questo avviso.
  const dateIssues = useMemo(() => dataRows.filter((r) => !toISO(val(r, "checkIn")) || !toISO(val(r, "checkOut")) || !val(r, "guest")).length, [dataRows, map]);

  const runImport = () => {
    if (!ready) return;
    let rtFallback = sRoomsHere[0]?.id ?? "";
    if (!rtFallback) rtFallback = addRoomType({ structureId, name: t("Camere importate"), beds: 2, basePrice: 0 });

    // Risolve la camera per una riga usando la mappatura ESPLICITA scelta dall'utente (unitMap):
    //  - id di una camera esistente  → quella, sempre (nessun bin-packing: scelta manuale precisa).
    //  - "__type__"                  → assegnazione automatica nella tipologia con bin-packing
    //    (stesso motore dell'import ICS): riusa camere libere, ne crea quante servono, MAI
    //    sovrapposizioni sulla stessa camera. È il caso giusto quando il file riporta solo la
    //    tipologia (es. export Octorate "Camera Matrimoniale | Deluxe").
    //  - "__new__"                   → crea UNA camera nuova con questo nome esatto (riusata per
    //    le righe successive con lo stesso testo, via cache locale) — per i rari file con codici
    //    camera specifici (es. "SH_#1") non ancora presenti in Xenora.
    const assignInType = makeUnitAssigner(sUnitsHere, bookings, structureId);
    const createdUnits = new Map<string, { id: string; roomTypeId: string }>();
    const resolveUnit = (roomTxt: string, ci: string, co: string): { unitId: string | null; roomTypeId: string } => {
      if (!roomTxt) return { unitId: null, roomTypeId: rtFallback };
      const target = unitMap[roomTxt];
      if (target === "__type__") {
        const rtId = unitMapType[roomTxt] || rtFallback;
        return { unitId: assignInType(rtId, ci, co, addUnit, t), roomTypeId: rtId };
      }
      if (target && target !== "__new__") {
        const rtId = sUnitsHere.find((u) => u.id === target)?.roomTypeId ?? rtFallback;
        return { unitId: target, roomTypeId: rtId };
      }
      const key = roomTxt.toLowerCase().trim();
      const cached = createdUnits.get(key);
      if (cached) return { unitId: cached.id, roomTypeId: cached.roomTypeId };
      const rtId = unitMapType[roomTxt] || rtFallback;
      const newId = addUnit({ structureId, roomTypeId: rtId, name: roomTxt });
      createdUnits.set(key, { id: newId, roomTypeId: rtId });
      return { unitId: newId, roomTypeId: rtId };
    };

    // Anti-duplicato: chiavi (struttura+ospite+date) delle prenotazioni GIÀ presenti,
    // più quelle create in questa stessa passata (evita doppioni anche interni al file).
    const guestNameOf = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "";
    const seen = new Set(bookings.filter((b) => b.structureId === structureId).map((b) => bookingDedupeKey(b.structureId, guestNameOf(b.guestId), b.checkIn, b.checkOut)));

    let n = 0, skipped = 0, dup = 0;
    dataRows.forEach((r) => {
      const ci = toISO(val(r, "checkIn")), co = toISO(val(r, "checkOut")), name = val(r, "guest");
      if (!ci || !co || !name || ci >= co) { skipped++; return; } // campi obbligatori mancanti o date incoerenti
      const key = bookingDedupeKey(structureId, name, ci, co);
      if (seen.has(key)) { dup++; return; } // già presente / doppione nel file
      seen.add(key);
      const guestId = addGuest({ fullName: name, email: val(r, "email") || undefined, phone: val(r, "phone") || undefined });
      const roomTxt = val(r, "room");
      const { unitId, roomTypeId } = resolveUnit(roomTxt, ci, co);
      const bookedOn = toISO(val(r, "bookedOn"));
      const noteTxt = val(r, "note");
      addBooking({
        structureId, roomTypeId, unitId, guestId,
        channel: toChannel(val(r, "channel")), status: "confirmed",
        checkIn: ci, checkOut: co, ...(bookedOn ? { bookedOn } : {}),
        adults: Math.max(1, Math.round(toNum(val(r, "adults")) ?? 2)),
        children: Math.max(0, Math.round(toNum(val(r, "children")) ?? 0)),
        ...(toNum(val(r, "total")) !== undefined ? { total: toNum(val(r, "total")) } : {}),
        note: (t("Importato da CSV") + (noteTxt ? " · " + noteTxt : "")).slice(0, 280),
      });
      n++;
    });
    setDone(n);
    const msgs: string[] = [];
    if (skipped) msgs.push(`${skipped} ${t("righe saltate (date o nome mancanti).")}`);
    if (dup) msgs.push(`${dup} ${t("doppioni ignorati (già presenti).")}`);
    setErr(msgs.join(" "));
  };

  const sel = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader title={t("Importa prenotazioni")} subtitle={t("Carica il file ICS o CSV esportato da Octorate (o da un altro gestionale)")} />

      {importedBookings.length > 0 && done === null && (
        <Card className="mb-4 border-[color:var(--warn)]/40 bg-[color:color-mix(in_srgb,var(--warn)_8%,transparent)]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-txt">{importedBookings.length} {t("prenotazioni importate in precedenza")}</div>
              <div className="text-xs text-dim">{t("Se qualcosa non va, puoi eliminarle tutte in un click e ripartire da capo.")}</div>
            </div>
            <button onClick={() => setConfirmUndo(true)} className="shrink-0 rounded-lg border border-[color:var(--err)] px-3 py-2 text-sm font-semibold text-[color:var(--err)] hover:bg-[color:color-mix(in_srgb,var(--err)_10%,transparent)]">{t("Elimina l'importazione")}</button>
          </div>
        </Card>
      )}

      {confirmUndo && (
        <ConfirmDialog
          title={t("Eliminare tutte le prenotazioni importate?")}
          message={`${importedBookings.length} ${t("prenotazioni verranno eliminate definitivamente (ospiti collegati restano). Le prenotazioni create a mano non vengono toccate.")}`}
          warning={t("Azione irreversibile.")}
          confirmLabel={t("Elimina")}
          tone="var(--err)"
          onConfirm={undoImport}
          onClose={() => setConfirmUndo(false)}
        />
      )}

      {done !== null ? (
        <Card>
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-[color:color-mix(in_srgb,var(--ok)_16%,transparent)] text-[color:var(--ok)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <div className="font-display text-xl font-bold text-txt">{done} {t("prenotazioni importate")}</div>
            {err && <p className="mt-2 text-sm text-[color:var(--warn)]">{err}</p>}
            <div className="mt-5 flex justify-center gap-2">
              <button onClick={() => router.push("/calendario")} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Vai al calendario")}</button>
              <button onClick={() => { setRows([]); setMap({}); setDone(null); setErr(""); setFileName(""); }} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-txt hover:bg-wash">{t("Importa un altro file")}</button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("1. Struttura e file")}</SectionTitle>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line bg-wash/50 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-txt">{t("Non sai da dove partire?")}</div>
                <div className="text-xs text-dim">{t("Scarica il modello CSV con le colonne giuste, compilalo con il tuo storico e ricaricalo qui.")}</div>
              </div>
              <button type="button" onClick={downloadTemplate} className="shrink-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">{t("Scarica il modello CSV")}</button>
            </div>
            {structures.length === 0 ? (
              <p className="text-sm text-dim">{t("Prima crea una struttura e le camere, poi torna qui a importare.")}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className="mb-1 block text-xs font-medium text-dim">{t("Struttura di destinazione")}</span>
                  <select value={structureId} onChange={(e) => setStructureId(e.target.value)} className={sel}>
                    {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label><span className="mb-1 block text-xs font-medium text-dim">{t("File CSV o ICS")}</span>
                  <input type="file" accept=".csv,.ics,text/csv,text/calendar,text/plain" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm text-dim file:mr-3 file:rounded-lg file:border-0 file:bg-focus file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:opacity-90" />
                </label>
                <label className="sm:col-span-2"><span className="mb-1 block text-xs font-medium text-dim">{t("…oppure incolla un URL iCal (.ics)")}</span>
                  <div className="flex gap-2">
                    <input value={icsUrl} onChange={(e) => setIcsUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fetchIcalUrl(); } }} placeholder="https://…/calendar.ics" className={sel} />
                    <button type="button" onClick={fetchIcalUrl} disabled={fetching || !/^https?:\/\//i.test(icsUrl.trim())} className="shrink-0 rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{fetching ? t("Scarico…") : t("Carica")}</button>
                  </div>
                  <span className="mt-1 block text-[11px] text-faint">{t("Utile per importare lo storico da un altro gestionale o da una OTA che espone un calendario iCal.")}</span>
                </label>
                <label className="sm:col-span-2"><span className="mb-1 block text-xs font-medium text-dim">{t("Assegna a")}</span>
                  <select value={targetUnit} onChange={(e) => setTargetUnit(e.target.value)} className={sel}>
                    <option value="">{t("Auto — assegna per tipologia (camere create in automatico)")}</option>
                    {units.filter((u) => u.structureId === structureId).map((u) => { const rt = roomTypes.find((x) => x.id === u.roomTypeId); return <option key={u.id} value={u.id}>{t("Camera specifica")}: {u.name}{rt ? ` (${rt.name})` : ""}</option>; })}
                  </select>
                  <span className="mt-1 block text-[11px] text-faint">{t("Per rispettare l'assegnazione di Octorate: esporta un iCal per singola camera e importalo scegliendo qui la camera corrispondente.")}</span>
                </label>
              </div>
            )}
            {fileName && <p className="mt-2 text-xs text-faint">{fileName} · {dataRows.length} {t("righe")}</p>}
            {err && done === null && <p className="mt-2 text-sm text-[color:var(--err)]">{err}</p>}
          </Card>

          {mode === "ics" && events.length > 0 && (
            <Card>
              <SectionTitle>{t("2. Anteprima (file ICS)")}</SectionTitle>
              <p className="mb-3 text-xs text-dim">{t("Dall'ICS importiamo date e occupazione. Nome ospite e importo solo se presenti nell'export di Octorate; la camera va alla prima tipologia della struttura.")}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                    <th className="px-2 py-2">{t("Ospite / stato")}</th><th className="px-2 py-2">Check-in</th><th className="px-2 py-2">Check-out</th><th className="px-2 py-2">{t("Canale")}</th>
                  </tr></thead>
                  <tbody>
                    {events.slice(0, 6).map((e, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="px-2 py-2 font-medium text-txt">{e.blocked ? t("Non disponibile") : (e.guest || t("Ospite (da ICS)"))}</td>
                        <td className="px-2 py-2 font-mono text-xs text-txt">{e.checkIn || t("data?")}</td>
                        <td className="px-2 py-2 font-mono text-xs text-txt">{e.checkOut || t("data?")}</td>
                        <td className="px-2 py-2 text-dim">{e.blocked ? t("Bloccato") : CHANNELS[toChannel(e.channelText)].label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {icsRooms.length > 0 && !targetUnit && (
                <div className="mt-4 rounded-lg border border-line bg-wash/50 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{t("Tipologie trovate nel file → le tue")}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {icsRooms.map((r) => (
                      <div key={r} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-dim" title={r}>{r}</span>
                        <span className="text-faint">→</span>
                        <select value={roomMap[r] ?? "__new__"} onChange={(e) => setRoomMap((m) => ({ ...m, [r]: e.target.value }))} className="max-w-[52%] rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt">
                          {roomTypes.filter((rt) => rt.structureId === structureId).map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                          <option value="__new__">➕ {t("Crea nuova tipologia")}</option>
                        </select>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-faint">{t("Se le camere non corrispondono, abbina o crea le tipologie: le camere fisiche necessarie vengono create in automatico e assegnate senza sovrapposizioni.")}</p>
                </div>
              )}
              {(() => {
                const resv = events.filter((e) => !e.blocked).length, blk = events.length - resv;
                const imp = includeBlocked ? events.length : resv;
                return (<>
                  <p className="mt-3 text-xs text-faint">{t("Trovati")} {events.length} {t("eventi")}: <b className="text-dim">{resv}</b> {t("prenotazioni")}, <b className="text-dim">{blk}</b> {t("blocchi (fuori servizio)")}.</p>
                  <label className="mt-3 flex items-center gap-2 text-sm text-dim"><input type="checkbox" checked={replacePrev} onChange={(e) => setReplacePrev(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> {t("Sostituisci le prenotazioni importate in precedenza (evita duplicati)")}</label>
                  <label className="mt-2 flex items-center gap-2 text-sm text-dim"><input type="checkbox" checked={includeBlocked} onChange={(e) => setIncludeBlocked(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> {t("Importa anche i periodi bloccati (fuori servizio)")}</label>
                  <button onClick={runImportICS} disabled={!structureId || imp === 0} className="mt-4 rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-40">{t("Importa")} {imp} {t("prenotazioni")}</button>
                </>);
              })()}
            </Card>
          )}

          {mode === "csv" && headers.length > 0 && (
            <Card>
              <SectionTitle>{t("2. Mappa le colonne")}</SectionTitle>
              <p className="mb-3 text-xs text-dim">{t("Abbina i campi di Xenora alle colonne del tuo file. * obbligatori.")}</p>
              <p className="mb-3 rounded-lg border border-line bg-wash/50 p-2.5 text-[11px] text-dim">{t("Mappa qui la colonna \"Camera\" (nome/codice usato su Octorate, es. SH_#1): nel passo successivo scegli TU a mano a quale camera di Xenora agganciare ognuna, o creane una nuova.")}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map((f) => (
                  <label key={f.key}><span className="mb-1 block text-xs font-medium text-dim">{t(f.label)}{f.req && <span className="text-focus"> *</span>}</span>
                    <select value={map[f.key] ?? -1} onChange={(e) => setMap((m) => ({ ...m, [f.key]: Number(e.target.value) }))} className={sel}>
                      <option value={-1}>— {t("nessuna")} —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `${t("Colonna")} ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </Card>
          )}

          {mode === "csv" && csvRooms.length > 0 && (
            <Card>
              <SectionTitle>{t("2b. Assegna le camere")}</SectionTitle>
              <p className="mb-3 text-xs text-dim">{t("Per ogni valore trovato nel file: se è una CAMERA specifica (es. SH_#1) agganciala o creala; se è solo una TIPOLOGIA (es. \"Camera Matrimoniale | Deluxe\", il caso più comune con Octorate) scegli l'assegnazione automatica — distribuisce le prenotazioni sulle camere di quella tipologia senza mai sovrapporle.")}</p>
              <div className="grid gap-2">
                {csvRooms.map((txt) => {
                  const chosen = unitMap[txt] ?? "__type__";
                  const needsType = chosen === "__new__" || chosen === "__type__";
                  return (
                    <div key={txt} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-wash/50 p-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-txt" title={txt}>{txt}</span>
                      <span className="text-faint">→</span>
                      <select value={chosen} onChange={(e) => setUnitMap((m) => ({ ...m, [txt]: e.target.value }))} className="max-w-[55%] rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt">
                        <option value="__type__">🎯 {t("Assegna automaticamente nella tipologia (niente sovrapposizioni)")}</option>
                        {sUnitsHere.map((u) => { const rt = sRoomsHere.find((x) => x.id === u.roomTypeId); return <option key={u.id} value={u.id}>{u.name}{rt ? ` (${rt.name})` : ""}</option>; })}
                        <option value="__new__">➕ {t("Crea nuova camera con questo nome")}</option>
                      </select>
                      {needsType && sRoomsHere.length > 0 && (
                        <select value={unitMapType[txt] ?? sRoomsHere[0].id} onChange={(e) => setUnitMapType((m) => ({ ...m, [txt]: e.target.value }))} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-dim">
                          {sRoomsHere.map((rt) => <option key={rt.id} value={rt.id}>{chosen === "__new__" ? t("sotto") : t("nella tipologia")} {rt.name}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {ready && (
            <Card>
              <SectionTitle>{t("3. Anteprima")}</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                    <th className="px-2 py-2">{t("Ospite")}</th><th className="px-2 py-2">Check-in</th><th className="px-2 py-2">Check-out</th><th className="px-2 py-2">{t("Camera nel file")}</th><th className="px-2 py-2">{t("→ Camera Xenora")}</th><th className="px-2 py-2">{t("Canale")}</th><th className="px-2 py-2">{t("Importo")}</th>
                  </tr></thead>
                  <tbody>
                    {preview.map((p, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="px-2 py-2 font-medium text-txt">{p.guest || "—"}</td>
                        <td className="px-2 py-2 font-mono text-xs" style={{ color: p.checkIn ? "var(--txt)" : "var(--err)" }}>{p.checkIn || t("data?")}</td>
                        <td className="px-2 py-2 font-mono text-xs" style={{ color: p.checkOut ? "var(--txt)" : "var(--err)" }}>{p.checkOut || t("data?")}</td>
                        <td className="px-2 py-2 text-dim">{p.room || "—"}</td>
                        <td className="px-2 py-2 font-medium text-txt">{p.roomResolved}</td>
                        <td className="px-2 py-2 text-dim">{p.channel}</td>
                        <td className="px-2 py-2 font-mono text-xs text-dim">{p.total !== undefined ? `€${p.total}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-faint">{t("Mostrate le prime 5 su")} {dataRows.length}. {csvRooms.length > 0 ? t("La camera va dove hai scelto sopra in \"Assegna le camere\".") : t("Nessuna colonna Camera mappata: le prenotazioni entrano senza camera fisica assegnata.")}</p>
              {dateIssues > 0 && (
                <div className="mt-3 rounded-lg border p-2.5 text-[12px] font-medium" style={{ borderColor: "var(--err)", color: "var(--err)", backgroundColor: "color-mix(in srgb, var(--err) 8%, transparent)" }}>
                  ⚠️ {dateIssues} {t("righe su")} {dataRows.length} {t("hanno una data non riconosciuta o l'ospite mancante e NON verranno importate. Controlla il formato delle colonne Check-in/Check-out nel file (atteso GG/MM/AAAA o AAAA-MM-GG).")}
                </div>
              )}
              <button onClick={runImport} className="mt-4 rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90">{t("Importa")} {dataRows.length - dateIssues} {t("prenotazioni")}</button>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
