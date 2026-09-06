"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { CHANNELS, type Channel } from "@/lib/types";

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

function toISO(s: string): string {
  s = (s || "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = "20" + y; return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  const dt = new Date(s); return isNaN(+dt) ? "" : dt.toISOString().slice(0, 10);
}
function toNum(s: string): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(String(s).replace(/[^0-9,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return isNaN(n) ? undefined : n;
}
function toChannel(s: string): Channel {
  s = (s || "").toLowerCase();
  if (s.includes("booking")) return "booking";
  if (s.includes("airbnb")) return "airbnb";
  if (s.includes("expedia") || s.includes("vrbo") || s.includes("homeaway")) return "expedia";
  return "direct";
}

// ── Parsing ICS / iCal (export prenotazioni da Octorate) ──
type IcsEvent = { guest: string; checkIn: string; checkOut: string; blocked: boolean; channelText: string; note: string; room: string; total?: number; adults?: number };
function icsUnescape(s: string) { return (s || "").replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim(); }
function icsDate(v: string) { const m = v.match(/(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; }
function addDay(iso: string) { if (!iso) return ""; const d = new Date(iso + "T00:00:00Z"); if (isNaN(+d)) return iso; d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function parseICS(text: string): IcsEvent[] {
  text = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, ""); // unfold righe continuate
  const out: IcsEvent[] = [];
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1);
  for (const b of blocks) {
    const body = "\n" + b.split(/END:VEVENT/i)[0];
    const get = (re: RegExp) => { const m = body.match(re); return m ? icsUnescape(m[1]) : ""; };
    const dts = body.match(/\nDTSTART[^:\n]*:([0-9TZ]+)/i), dte = body.match(/\nDTEND[^:\n]*:([0-9TZ]+)/i);
    const summary = get(/\nSUMMARY:(.*)/i), desc = get(/\nDESCRIPTION:(.*)/i), loc = get(/\nLOCATION:(.*)/i);
    const orgCn = get(/\nORGANIZER[^:\n]*?CN=([^:\n]*):/i);
    // Date: preferisci il "Period : gg/mm/aaaa - gg/mm/aaaa" della DESCRIPTION (check-out reale);
    // altrimenti DTSTART e DTEND+1 (in Octorate DTEND è l'ultima notte, non la partenza).
    const per = desc.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    let ci = per ? toISO(per[1]) : (dts ? icsDate(dts[1]) : "");
    let co = per ? toISO(per[2]) : (dte ? addDay(icsDate(dte[1])) : "");
    if (!ci && !co) continue;
    const blob = (summary + " " + desc + " " + loc).toLowerCase();
    const blocked = /closed|not available|non disponibil|bloccat|blocked|unavailable|outoforder|out.?of.?order|fuori.?servizio|maintenance|manutenzione/.test(blob);
    // Nome ospite: ORGANIZER CN (migliore); altrimenti la parte di SUMMARY prima della camera.
    let guest = orgCn;
    if (!guest && !blocked) { guest = summary.split(/\s*\|\s*|\s+Camera\b/i)[0].trim(); }
    const totm = desc.match(/Total\s*:?\s*€?\s*([0-9]+(?:[.,][0-9]+)?)/i) || (desc + " " + summary).match(/€\s?([0-9.,]+)/);
    const pax = summary.match(/(\d+)\s*pax/i);
    out.push({ guest: blocked ? "" : guest, checkIn: ci, checkOut: co, blocked, channelText: summary, note: desc || summary, room: loc, total: totm ? toNum(totm[1]) : undefined, adults: pax ? +pax[1] : undefined });
  }
  return out;
}

// Campi di destinazione + parole chiave per l'auto-mappatura (IT/EN)
const FIELDS: { key: string; label: string; req?: boolean; kw: RegExp }[] = [
  { key: "guest", label: "Ospite (nome)", req: true, kw: /ospite|nome|guest|cliente|name|intestatario/i },
  { key: "checkIn", label: "Check-in", req: true, kw: /check.?in|arrivo|arrival|dal\b|from|inizio|data.?in/i },
  { key: "checkOut", label: "Check-out", req: true, kw: /check.?out|partenza|departure|al\b|to\b|fine|data.?out/i },
  { key: "room", label: "Camera / tipologia", kw: /camera|room|tipolog|unit|alloggio|appartamento|systemato/i },
  { key: "channel", label: "Canale", kw: /canale|channel|portale|source|origine|\bota\b|provenienza/i },
  { key: "adults", label: "Ospiti / adulti", kw: /adult|ospiti|pax|persone|guests?/i },
  { key: "total", label: "Importo totale", kw: /totale|total|importo|amount|prezzo|price|revenue|incasso|ricavo/i },
  { key: "email", label: "Email", kw: /email|mail/i },
  { key: "phone", label: "Telefono", kw: /telefono|phone|tel\b|cell|mobile/i },
  { key: "bookedOn", label: "Data prenotazione", kw: /prenotat|booked|creat|created|data.?pren/i },
];

export default function ImportaPage() {
  const router = useRouter();
  const { t } = useLang();
  const { structures, roomTypes, activeStructureId, addGuest, addBooking, addRoomType } = useData();
  const [rows, setRows] = useState<string[][]>([]);
  const [mode, setMode] = useState<"csv" | "ics">("csv");
  const [events, setEvents] = useState<IcsEvent[]>([]);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Record<string, number>>({});
  const [structureId, setStructureId] = useState<string>(() => (activeStructureId !== "all" ? activeStructureId : structures[0]?.id ?? ""));
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const headers = rows[0] ?? [];
  const dataRows = useMemo(() => rows.slice(1).filter((r) => r.some((c) => (c || "").trim())), [rows]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(""); setDone(null); setFileName(f.name);
    const text = await f.text();
    if (/BEGIN:VCALENDAR/i.test(text) || /\.ics$/i.test(f.name)) {
      const ev = parseICS(text);
      setMode("ics"); setEvents(ev); setRows([]); setMap({});
      if (!ev.length) setErr(t("Nessuna prenotazione trovata nel file ICS."));
      return;
    }
    setMode("csv"); setEvents([]);
    const parsed = parseCSV(text);
    if (parsed.length < 2) { setErr(t("Il file sembra vuoto o non valido.")); setRows([]); return; }
    setRows(parsed);
    const auto: Record<string, number> = {};
    parsed[0].forEach((h, i) => { FIELDS.forEach((f2) => { if (auto[f2.key] === undefined && f2.kw.test(h)) auto[f2.key] = i; }); });
    setMap(auto);
  };

  const runImportICS = () => {
    const sRooms = roomTypes.filter((rt) => rt.structureId === structureId);
    let rtFallback = sRooms[0]?.id ?? "";
    if (!rtFallback) rtFallback = addRoomType({ structureId, name: t("Camere importate"), beds: 2, basePrice: 0 });
    const findRoom = (txt: string) => { const s = (txt || "").toLowerCase().trim(); const hit = s ? (sRooms.find((rt) => rt.name.toLowerCase() === s) || sRooms.find((rt) => s.includes(rt.name.toLowerCase()))) : null; return hit ? hit.id : rtFallback; };
    let n = 0, skipped = 0;
    events.forEach((e) => {
      if (!e.checkIn || !e.checkOut) { skipped++; return; }
      const guestId = addGuest({ fullName: e.guest || (e.blocked ? t("Non disponibile") : t("Ospite (da ICS)")) });
      addBooking({
        structureId, roomTypeId: findRoom(e.room), unitId: null, guestId,
        channel: e.blocked ? "blocked" : toChannel(e.channelText), status: "confirmed",
        checkIn: e.checkIn, checkOut: e.checkOut, adults: Math.max(1, Math.round(e.adults ?? 2)), children: 0,
        ...(e.total !== undefined ? { total: e.total } : {}),
        note: (t("Importato da ICS") + (e.note ? " · " + e.note : "")).slice(0, 280),
      });
      n++;
    });
    setDone(n); if (skipped) setErr(`${skipped} ${t("eventi saltati (date mancanti).")}`);
  };

  const val = (r: string[], key: string) => { const i = map[key]; return i === undefined || i < 0 ? "" : (r[i] ?? "").trim(); };
  const ready = structureId && map.guest !== undefined && map.checkIn !== undefined && map.checkOut !== undefined && dataRows.length > 0;

  const preview = dataRows.slice(0, 5).map((r) => ({
    guest: val(r, "guest"), checkIn: toISO(val(r, "checkIn")), checkOut: toISO(val(r, "checkOut")),
    room: val(r, "room"), channel: CHANNELS[toChannel(val(r, "channel"))].label, total: toNum(val(r, "total")),
  }));

  const runImport = () => {
    if (!ready) return;
    const sRooms = roomTypes.filter((rt) => rt.structureId === structureId);
    const findRoom = (txt: string) => {
      const s = (txt || "").toLowerCase().trim();
      if (s) { const hit = sRooms.find((rt) => rt.name.toLowerCase() === s) || sRooms.find((rt) => s.includes(rt.name.toLowerCase()) || rt.name.toLowerCase().includes(s)); if (hit) return hit.id; }
      return sRooms[0]?.id ?? "";
    };
    let rtFallback = sRooms[0]?.id ?? "";
    if (!rtFallback) rtFallback = addRoomType({ structureId, name: t("Camere importate"), beds: 2, basePrice: 0 });

    let n = 0, skipped = 0;
    dataRows.forEach((r) => {
      const ci = toISO(val(r, "checkIn")), co = toISO(val(r, "checkOut")), name = val(r, "guest");
      if (!ci || !co || !name) { skipped++; return; }
      const guestId = addGuest({ fullName: name, email: val(r, "email") || undefined, phone: val(r, "phone") || undefined });
      const roomTxt = val(r, "room");
      const roomTypeId = (roomTxt && findRoom(roomTxt)) || rtFallback;
      const bookedOn = toISO(val(r, "bookedOn"));
      addBooking({
        structureId, roomTypeId, unitId: null, guestId,
        channel: toChannel(val(r, "channel")), status: "confirmed",
        checkIn: ci, checkOut: co, ...(bookedOn ? { bookedOn } : {}),
        adults: Math.max(1, Math.round(toNum(val(r, "adults")) ?? 2)), children: 0,
        ...(toNum(val(r, "total")) !== undefined ? { total: toNum(val(r, "total")) } : {}),
        note: t("Importato da CSV"),
      });
      n++;
    });
    setDone(n);
    if (skipped) setErr(`${skipped} ${t("righe saltate (date o nome mancanti).")}`);
  };

  const sel = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader title={t("Importa prenotazioni")} subtitle={t("Carica il CSV esportato da Octorate (o da un altro gestionale) e mappa le colonne")} />

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
            {structures.length === 0 ? (
              <p className="text-sm text-dim">{t("Prima crea una struttura e le camere, poi torna qui a importare.")}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className="mb-1 block text-xs font-medium text-dim">{t("Struttura di destinazione")}</span>
                  <select value={structureId} onChange={(e) => setStructureId(e.target.value)} className={sel}>
                    {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label><span className="mb-1 block text-xs font-medium text-dim">{t("File CSV")}</span>
                  <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm text-dim file:mr-3 file:rounded-lg file:border-0 file:bg-focus file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:opacity-90" />
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
              <p className="mt-3 text-xs text-faint">{t("Trovati")} {events.length} {t("eventi. Mostrati i primi 6.")}</p>
              <button onClick={runImportICS} disabled={!structureId} className="mt-4 rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-40">{t("Importa")} {events.length} {t("prenotazioni")}</button>
            </Card>
          )}

          {mode === "csv" && headers.length > 0 && (
            <Card>
              <SectionTitle>{t("2. Mappa le colonne")}</SectionTitle>
              <p className="mb-3 text-xs text-dim">{t("Abbina i campi di Xenora alle colonne del tuo file. * obbligatori.")}</p>
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

          {ready && (
            <Card>
              <SectionTitle>{t("3. Anteprima")}</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                    <th className="px-2 py-2">{t("Ospite")}</th><th className="px-2 py-2">Check-in</th><th className="px-2 py-2">Check-out</th><th className="px-2 py-2">{t("Camera")}</th><th className="px-2 py-2">{t("Canale")}</th><th className="px-2 py-2">{t("Importo")}</th>
                  </tr></thead>
                  <tbody>
                    {preview.map((p, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="px-2 py-2 font-medium text-txt">{p.guest || "—"}</td>
                        <td className="px-2 py-2 font-mono text-xs" style={{ color: p.checkIn ? "var(--txt)" : "var(--err)" }}>{p.checkIn || t("data?")}</td>
                        <td className="px-2 py-2 font-mono text-xs" style={{ color: p.checkOut ? "var(--txt)" : "var(--err)" }}>{p.checkOut || t("data?")}</td>
                        <td className="px-2 py-2 text-dim">{p.room || "—"}</td>
                        <td className="px-2 py-2 text-dim">{p.channel}</td>
                        <td className="px-2 py-2 font-mono text-xs text-dim">{p.total !== undefined ? `€${p.total}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-faint">{t("Mostrate le prime 5 su")} {dataRows.length}. {t("La camera viene abbinata alla tipologia col nome più simile; se non trovata, alla prima tipologia della struttura.")}</p>
              <button onClick={runImport} className="mt-4 rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90">{t("Importa")} {dataRows.length} {t("prenotazioni")}</button>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
