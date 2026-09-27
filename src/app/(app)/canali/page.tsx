"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import Icon from "@/components/Icon";
import IcalSyncPanel from "@/components/IcalSyncPanel";
import { apiPost } from "@/lib/invoicing/client";

interface LogEntry { id: string; ts: number; text: string; color: string }

const LOG_KEY = "spigolestay:canali:log";
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `x-${Math.floor(performance.now() * 1000)}`);

export default function CanaliPage() {
  const { structures, roomTypes, units, activeStructureId } = useData();
  const ask = useConfirm();
  const { t } = useLang();
  const relTime = (ts: number) => {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return t("adesso");
    if (d < 3600) return `${Math.floor(d / 60)} ${t("min fa")}`;
    if (d < 86400) return `${Math.floor(d / 3600)} ${t("h fa")}`;
    return `${Math.floor(d / 86400)} ${t("g fa")}`;
  };
  const [localStructure, setLocalStructure] = useState("all");
  const effStructure = activeStructureId !== "all" ? activeStructureId : localStructure;

  const [log, setLog] = useState<LogEntry[]>([]);
  useEffect(() => {
    try {
      const l = localStorage.getItem(LOG_KEY); if (l) setLog(JSON.parse(l));
    } catch {}
  }, []);
  const saveLog = (next: LogEntry[]) => { setLog(next); try { localStorage.setItem(LOG_KEY, JSON.stringify(next.slice(0, 40))); } catch {} };

  // Sincronizzazione reale verso Channex (staging): crea property + camere + tariffe da Xenora.
  const [chxMap, setChxMap] = useState<Record<string, { propertyId: string; rooms?: Record<string, { roomTypeId: string; ratePlanId?: string }>; at: string }>>({});
  const [chxSync, setChxSync] = useState<{ running: boolean; msg?: string; ok?: boolean }>({ running: false });
  const [impSync, setImpSync] = useState<{ running: boolean; msg?: string; ok?: boolean }>({ running: false });
  // Importa le prenotazioni OTA in entrata dal feed Channex (2-way).
  const importOta = async () => {
    setImpSync({ running: true, msg: "Controllo nuove prenotazioni dalle OTA…" });
    try {
      const j = await apiPost<{ ok: boolean; imported?: number; cancelled?: number; feed?: number; skipped?: number; acked?: number; errors?: string[]; error?: string }>("channex/import", {});
      if (!j.ok) { setImpSync({ running: false, ok: false, msg: j.error || "Import non riuscito" }); return; }
      const n = (j.imported ?? 0) + (j.cancelled ?? 0);
      // Diagnostica: se il feed ha righe ma nulla è stato importato, spiega il perché (di solito
      // tipologia non mappata o property non collegata) invece del generico "nessuna prenotazione".
      let msg: string;
      if (n > 0) msg = `Importate ${j.imported ?? 0} prenotazioni${j.cancelled ? `, ${j.cancelled} cancellazioni` : ""} ✓`;
      else if ((j.feed ?? 0) === 0) msg = "Nessuna prenotazione nel feed Channex (nessuna in attesa di conferma).";
      else msg = `${j.feed} nel feed ma 0 importate · ${j.skipped ?? 0} saltate${j.errors?.length ? ` · ${j.errors[0]}` : " (probabile tipologia non mappata o soggiorno già concluso)"}`;
      setImpSync({ running: false, ok: n > 0, msg });
      if (n > 0) saveLog([{ id: uid(), ts: Date.now(), text: `${t("Prenotazioni OTA importate da Channex")} — ${j.imported ?? 0}`, color: "var(--ok)" }, ...log]);
    } catch (e) { setImpSync({ running: false, ok: false, msg: e instanceof Error ? e.message : "errore di rete" }); }
  };
  useEffect(() => { try { const m = localStorage.getItem("spigolestay:channexmap"); if (m) setChxMap(JSON.parse(m)); } catch {} }, []);
  // Ricostruisce sul server la mappatura Channex↔Xenora (abbinando per nome le
  // property già su Channex) così webhook/import sanno a chi assegnare le prenotazioni.
  // Robusto: non dipende dal localStorage. Gira una volta all'apertura.
  const relinkDone = useRef(false);
  const webhookDone = useRef(false);
  const [relink, setRelink] = useState<{ running: boolean; msg?: string; ok?: boolean }>({ running: false });
  const doRelink = async (manual = false) => {
    setRelink({ running: true, msg: manual ? "Ricollego la mappatura…" : undefined });
    try {
      type Linked = { property: string; structure: string; structureId: string; propertyId: string; orgId?: string | null; rooms: number; roomsMap?: Record<string, string>; ratePlans?: Record<string, string> };
      const j = await apiPost<{ ok: boolean; linked?: Linked[]; unmatched?: string[]; error?: string }>("channex/relink", {});
      if (!j.ok) { setRelink({ running: false, ok: false, msg: manual ? (j.error || "Ricollegamento non riuscito") : undefined }); return; }
      const linked = j.linked ?? [];
      // Riflette la mappatura del server nello stato locale: la struttura risulta
      // "collegata" e il pulsante «Sincronizza» sparisce (niente doppioni).
      if (linked.length) {
        const next = { ...chxMap };
        for (const l of linked) {
          const rooms: Record<string, { roomTypeId: string; ratePlanId?: string }> = {};
          // ratePlanId (dal server) è indispensabile per inviare i PREZZI in ARI, non solo la disponibilità.
          for (const [chxRt, xid] of Object.entries(l.roomsMap || {})) rooms[xid] = { roomTypeId: chxRt, ratePlanId: l.ratePlans?.[chxRt] };
          next[l.structureId] = { propertyId: l.propertyId, rooms, at: new Date().toISOString() };
        }
        setChxMap(next); try { localStorage.setItem("spigolestay:channexmap", JSON.stringify(next)); } catch {}
        // Registra automaticamente il webhook Channex (ricezione prenotazioni in tempo reale),
        // una sola volta per sessione. Idempotente lato server: non crea doppioni.
        if (!webhookDone.current) {
          webhookDone.current = true;
          apiPost("channex/webhook-setup", {}).catch(() => { webhookDone.current = false; });
        }
      }
      const n = linked.length;
      setRelink({ running: false, ok: true, msg: manual ? (n ? `Mappatura allineata ✓ · ${n} strutture` : "Nessuna struttura Channex abbinata per nome.") : undefined });
    } catch (e) { setRelink({ running: false, ok: false, msg: manual ? (e instanceof Error ? e.message : "errore") : undefined }); }
  };
  useEffect(() => { if (relinkDone.current) return; relinkDone.current = true; doRelink(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const syncToChannex = async () => {
    const sid = effStructure;
    const st = structures.find((s) => s.id === sid);
    if (!st) { setChxSync({ running: false, ok: false, msg: "Seleziona una struttura specifica (non 'Tutte')." }); return; }
    // Idempotente: se già collegata, NON creare un doppione. Per aggiornare si usa "Prezzi & disponibilità".
    if (chxMap[sid]) { setChxSync({ running: false, ok: false, msg: "Struttura già collegata a Channex: per aggiornare usa «Prezzi & disponibilità». Per ricrearla, prima «Scollega»." }); return; }
    // Le tariffe derivate (Dus, Quadrupla, Matrimoniale...) non sono camere fisiche proprie:
    // condividono le camere della tipologia madre (vedi RoomType.deriveFrom in lib/types.ts).
    // Vanno escluse dal push: altrimenti Channex le vede come tipologie/camere fantasma in più.
    const rts = roomTypes.filter((rt) => rt.structureId === sid && !rt.deriveFrom);
    if (rts.length === 0) { setChxSync({ running: false, ok: false, msg: "Nessuna tipologia in questa struttura." }); return; }
    const rooms = rts.map((rt) => ({
      xid: rt.id,
      title: rt.name,
      count: Math.max(1, units.filter((u) => u.roomTypeId === rt.id && !u.outOfService).length),
      occAdults: rt.maxOccupancy ?? rt.beds ?? 2,
      defaultOccupancy: rt.beds ?? 2,
      rate: rt.basePrice ?? 0,
    }));
    const structure = {
      title: st.name, currency: "EUR", country: "IT",
      city: st.city || undefined, address: [st.address, st.streetNumber].filter(Boolean).join(" ") || undefined,
      email: st.email || undefined, phone: st.phone || undefined,
      latitude: st.lat ? String(st.lat) : undefined, longitude: st.lng ? String(st.lng) : undefined,
      logo_url: st.logo || undefined, website: st.website || undefined,
    };
    setChxSync({ running: true, msg: "Creazione su Channex in corso…" });
    try {
      const j = await apiPost<{ ok: boolean; propertyId: string; rooms?: { xid?: string; roomTypeId?: string; ratePlanId?: string; ok: boolean }[]; error?: string; step?: string }>("channex/sync", { structureId: sid, structure, rooms });
      if (!j.ok) { setChxSync({ running: false, ok: false, msg: `Errore: ${j.error || j.step || "sync fallita"}` }); return; }
      const okRooms = (j.rooms || []).filter((r: { ok: boolean }) => r.ok).length;
      const roomMap: Record<string, { roomTypeId: string; ratePlanId?: string }> = {};
      (j.rooms || []).forEach((r: { xid?: string; roomTypeId?: string; ratePlanId?: string; ok: boolean }) => { if (r.ok && r.xid && r.roomTypeId) roomMap[r.xid] = { roomTypeId: r.roomTypeId, ratePlanId: r.ratePlanId }; });
      const next = { ...chxMap, [sid]: { propertyId: j.propertyId, rooms: roomMap, at: new Date().toISOString() } };
      setChxMap(next); try { localStorage.setItem("spigolestay:channexmap", JSON.stringify(next)); } catch {}
      setChxSync({ running: false, ok: true, msg: `Struttura creata su Channex ✓ · ${okRooms}/${rooms.length} camere` });
      saveLog([{ id: uid(), ts: Date.now(), text: `${t("Struttura sincronizzata su Channex")} — ${st.name}`, color: "var(--ok)" }, ...log]);
    } catch (e) {
      setChxSync({ running: false, ok: false, msg: e instanceof Error ? e.message : "errore di rete" });
    }
  };

  // NB: l'invio di disponibilità e prezzi a Channex è ora AUTOMATICO (vedi ChannexAutoSync,
  // montato nell'AppShell): parte da solo a ogni modifica di prenotazioni, camere (anche fuori
  // servizio) o prezzi. Niente più pulsante manuale.

  return (
    <div>
      <PageHeader
        title="Channel Manager"
        subtitle={t("Connessioni ai portali, mappatura camere e sincronizzazione prezzi/disponibilità")}
        actions={
          activeStructureId === "all" ? (
            <select value={localStructure} onChange={(e) => setLocalStructure(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus">
              <option value="all">{t("Tutte le strutture")}</option>
              {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : null
        }
      />

      {/* Stato distribuzione canali. Channex è il motore dietro le quinte e resta INVISIBILE
         all'utente: niente nome fornitore, "staging" o ID tecnici — solo lo stato. */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: chxMap[effStructure] ? "var(--ok)" : "var(--focus)" }}><Icon name="share" size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-txt">{t("Distribuzione sui canali")}{chxMap[effStructure] && <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-[color:color-mix(in_srgb,var(--ok)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[color:var(--ok)]">● {t("Attiva")}</span>}</div>
            <div className="text-xs text-dim">
              {effStructure === "all"
                ? t("Seleziona una struttura in alto per attivare la distribuzione sui canali.")
                : chxMap[effStructure]
                  ? t("Prezzi, disponibilità e fuori servizio vengono pubblicati sui canali collegati in automatico a ogni modifica. Le prenotazioni dalle OTA arrivano da sole.")
                  : t("Attiva la distribuzione: le tue camere e tariffe verranno pubblicate sui canali collegati.")}
            </div>
            {chxSync.msg && <div className="mt-1 text-[11px] font-semibold" style={{ color: chxSync.ok === false ? "var(--err)" : chxSync.ok ? "var(--ok)" : "var(--dim)" }}>{chxSync.msg}</div>}
            {impSync.msg && <div className="mt-0.5 text-[11px] font-semibold" style={{ color: impSync.ok === false ? "var(--err)" : impSync.ok ? "var(--ok)" : "var(--dim)" }}>{impSync.msg}</div>}
            {relink.msg && <div className="mt-0.5 text-[11px] font-semibold" style={{ color: relink.ok === false ? "var(--err)" : relink.ok ? "var(--ok)" : "var(--dim)" }}>{relink.msg}</div>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {chxMap[effStructure] ? (
              <>
                <button onClick={importOta} disabled={impSync.running} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-40" title={t("Le prenotazioni arrivano da sole; usa questo solo per forzare un controllo immediato.")}>{impSync.running ? t("Controllo…") : "↓ " + t("Controlla prenotazioni ora")}</button>
              </>
            ) : (
              <>
                <button onClick={() => doRelink(true)} disabled={relink.running} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-40">{relink.running ? t("Ripristino…") : "⟳ " + t("Ripristina")}</button>
                <button onClick={syncToChannex} disabled={chxSync.running || effStructure === "all"} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{chxSync.running ? t("Attivo…") : t("Attiva distribuzione")}</button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Sincronizzazione iCal reale (sola lettura) — prima del registro sincronizzazioni */}
      <div className="mt-6">
        <IcalSyncPanel />
      </div>

      {/* Registro sincronizzazioni */}
      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>{t("Registro sincronizzazioni")}</SectionTitle>
          {log.length > 0 && <button onClick={async () => { if (await ask({ message: t("Svuotare il registro sincronizzazioni?"), danger: true, confirmLabel: t("Svuota") })) saveLog([]); }} className="text-xs font-medium text-dim hover:text-txt">{t("Pulisci")}</button>}
        </div>
        {log.length === 0 ? <p className="text-sm text-faint">{t("Nessuna sincronizzazione ancora.")}</p> : (
          <div className="flex flex-col divide-y divide-[color:var(--line)]">
            {log.slice(0, 15).map((l) => (
              <div key={l.id} className="flex items-center gap-2.5 py-2 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                <span className="flex-1 text-txt">{l.text}</span>
                <span className="text-[11px] text-faint">{relTime(l.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
