"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import Icon from "@/components/Icon";
import IcalSyncPanel from "@/components/IcalSyncPanel";
import { apiPost } from "@/lib/invoicing/client";
import { forceFullSync } from "@/components/ChannexAutoSync";
import { CHANNELS, type Channel } from "@/lib/types";
import ChannelLogo from "@/components/ChannelLogo";
import { loadChannelColor, saveChannelColor, loadChannelCommissionPct, saveChannelCommissionPct } from "@/lib/channelOverrides";

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
  // Collegamento reale delle OTA (Booking.com, Airbnb, Expedia, ...): si apre in un pannello DENTRO
  // Xenora l'interfaccia dedicata (autenticazioni/credenziali OTA non replicabili lato nostro),
  // tramite un token valido una sola volta e 15 minuti — niente riferimenti al fornitore in vista.
  const [channelPanel, setChannelPanel] = useState<{ open: boolean; url?: string; loading?: boolean; error?: string }>({ open: false });
  const [impSync, setImpSync] = useState<{ running: boolean; msg?: string; ok?: boolean }>({ running: false });
  // Full sync manuale: azzera il timestamp dell'ultimo full-sync e forza ChannexAutoSync a inviare
  // subito l'intera finestra (2 chiamate: availability + restrictions), invece di aspettare le 24h.
  const [fullSync, setFullSync] = useState<{ running: boolean; msg?: string }>({ running: false });
  const doFullSync = () => {
    if (effStructure === "all") return;
    forceFullSync(effStructure);
    setFullSync({ running: true, msg: t("Full sync in corso…") });
    setTimeout(() => setFullSync({ running: false, msg: t("Full sync inviato (2 chiamate: disponibilità + restrizioni) ✓") }), 5000);
  };
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
        // Struttura (ri)collegata → fai partire subito la sincronizzazione ARI iniziale.
        try { window.dispatchEvent(new Event("spigolestay:channex-dirty")); } catch {}
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

  // Stato REALE dei canali OTA (sostituisce il vecchio flag locale mai aggiornato): risponde alla
  // domanda "da dove vedo che sono collegato con Booking.com?" con i dati veri da Channex.
  const [otaByStructure, setOtaByStructure] = useState<Record<string, { id: string; channel: string; title: string; active: boolean }[]> | null>(null);
  const [otaOff, setOtaOff] = useState(false);
  const [otaErr, setOtaErr] = useState("");
  const [otaLoading, setOtaLoading] = useState(true);
  const loadOtaStatus = async () => {
    setOtaLoading(true); setOtaErr("");
    try {
      const j = await apiPost<{ ok: boolean; byStructure?: Record<string, { id: string; channel: string; title: string; active: boolean }[]> }>("channex/status", {});
      if (!j.ok) { setOtaOff(true); setOtaByStructure(null); } else { setOtaOff(false); setOtaByStructure(j.byStructure ?? {}); }
    } catch (e) { setOtaErr(e instanceof Error ? e.message : "errore di rete"); }
    setOtaLoading(false);
  };
  useEffect(() => { loadOtaStatus(); }, []);
  // "Tutte" raggruppa per struttura; una struttura specifica è un gruppo unico senza etichetta.
  const otaGroups: { sid: string; label?: string; list: { id: string; channel: string; title: string; active: boolean }[] }[] =
    effStructure === "all"
      ? structures.filter((s) => (otaByStructure?.[s.id]?.length ?? 0) > 0).map((s) => ({ sid: s.id, label: s.name, list: otaByStructure![s.id] }))
      : [{ sid: effStructure, list: otaByStructure?.[effStructure] ?? [] }];
  // Attiva/disattiva un canale OTA già collegato, senza lasciare Xenora. Aggiornamento ottimistico
  // della lista, ripristinato se la chiamata a Channex fallisce.
  const [togglingChannel, setTogglingChannel] = useState<string | null>(null);
  const toggleChannel = async (sid: string, c: { id: string; channel: string; title: string; active: boolean }) => {
    if (c.active) {
      const label = CHANNELS[c.channel as keyof typeof CHANNELS]?.label ?? c.title;
      const ok = await ask({ message: `${t("Disattivare")} ${label}? ${t("La struttura non riceverà più prenotazioni da questo canale finché non lo riattivi.")}`, danger: true, confirmLabel: t("Disattiva") });
      if (!ok) return;
    }
    setTogglingChannel(c.id);
    const prev = otaByStructure;
    setOtaByStructure((cur) => {
      const next = { ...(cur ?? {}) };
      next[sid] = (next[sid] ?? []).map((x) => (x.id === c.id ? { ...x, active: !c.active } : x));
      return next;
    });
    try {
      const j = await apiPost<{ ok: boolean; error?: string }>("channex/channel", { channelId: c.id, active: !c.active });
      if (!j.ok) setOtaByStructure(prev);
    } catch { setOtaByStructure(prev); }
    setTogglingChannel(null);
  };
  // Correzione di prezzo (derived_option) a livello di connessione canale — sostituisce l'apertura
  // manuale della dashboard Channex per lo stesso identico bisogno che ha spinto Andrea ad
  // aggiustare Booking.com a mano. Un solo step per ora (+/- percentuale); il valore letto da
  // Channex precompila il modulo, così il Salva non rischia mai di azzerare una correzione esistente.
  const CORR_SIGN: Record<string, string> = { increase_by_percent: "+", decrease_by_percent: "−" };
  const [priceCorr, setPriceCorr] = useState<Record<string, { rule: "increase_by_percent" | "decrease_by_percent"; value: string; loaded: boolean }>>({});
  // Bozza commissione predefinita per canale (colore invece si applica subito, senza bozza).
  const [commDraft, setCommDraft] = useState<Record<string, string>>({});
  const [commSaved, setCommSaved] = useState<string | null>(null);
  const [corrMsg, setCorrMsg] = useState<Record<string, { text: string; ok?: boolean }>>({});
  const [corrSaving, setCorrSaving] = useState<string | null>(null);
  const loadPriceCorr = async (channelId: string) => {
    try {
      const j = await apiPost<{ ok: boolean; rule?: string | null; value?: string | null }>("channex/price-correction", { channelId, action: "get" });
      const rule = j.rule === "increase_by_percent" || j.rule === "decrease_by_percent" ? j.rule : "increase_by_percent";
      setPriceCorr((cur) => ({ ...cur, [channelId]: { rule, value: j.value ?? "", loaded: true } }));
    } catch { setPriceCorr((cur) => ({ ...cur, [channelId]: cur[channelId] ?? { rule: "increase_by_percent", value: "", loaded: true } })); }
  };
  useEffect(() => {
    if (!otaByStructure) return;
    const ids = Object.values(otaByStructure).flat().map((c) => c.id).filter(Boolean);
    for (const id of ids) if (!priceCorr[id]) loadPriceCorr(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otaByStructure]);
  const saveCorr = async (channelId: string) => {
    const draft = priceCorr[channelId];
    if (!draft) return;
    setCorrSaving(channelId); setCorrMsg((cur) => ({ ...cur, [channelId]: { text: t("Salvo…") } }));
    try {
      const j = await apiPost<{ ok: boolean; error?: string }>("channex/price-correction", { channelId, action: "set", rule: draft.rule, value: draft.value });
      if (j.ok) setCorrMsg((cur) => ({ ...cur, [channelId]: { text: t("Salvato ✓"), ok: true } }));
      else setCorrMsg((cur) => ({ ...cur, [channelId]: { text: j.error || t("Salvataggio non riuscito"), ok: false } }));
    } catch (e) { setCorrMsg((cur) => ({ ...cur, [channelId]: { text: e instanceof Error ? e.message : "errore di rete", ok: false } })); }
    setCorrSaving(null);
  };
  // Card "essenziali" (logo + nome + stato) nella lista canali: il dettaglio (attiva/disattiva,
  // correzione prezzo) si apre al click, invece di stare tutto incollato nella card.
  const [channelDetail, setChannelDetail] = useState<{ sid: string; c: { id: string; channel: string; title: string; active: boolean } } | null>(null);
  const [channelSearch, setChannelSearch] = useState("");

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
      // Struttura appena creata su Channex → invia subito la finestra ARI iniziale (500 giorni).
      try { window.dispatchEvent(new Event("spigolestay:channex-dirty")); } catch {}
      setChxSync({ running: false, ok: true, msg: `Struttura creata su Channex ✓ · ${okRooms}/${rooms.length} camere` });
      saveLog([{ id: uid(), ts: Date.now(), text: `${t("Struttura sincronizzata su Channex")} — ${st.name}`, color: "var(--ok)" }, ...log]);
    } catch (e) {
      setChxSync({ running: false, ok: false, msg: e instanceof Error ? e.message : "errore di rete" });
    }
  };

  const openChannelManager = async (redirectTo = "/channels") => {
    setChannelPanel({ open: true, loading: true });
    try {
      const j = await apiPost<{ ok: boolean; token?: string; propertyId?: string; base?: string; error?: string }>("channex/channel-token", { structureId: effStructure });
      if (!j.ok || !j.token || !j.base) { setChannelPanel({ open: true, error: j.error || "Impossibile aprire il collegamento canali." }); return; }
      const url = `${j.base}/auth/exchange?oauth_session_key=${encodeURIComponent(j.token)}&app_mode=headless&redirect_to=${encodeURIComponent(redirectTo)}&property_id=${encodeURIComponent(j.propertyId || "")}`;
      setChannelPanel({ open: true, url });
    } catch (e) {
      setChannelPanel({ open: true, error: e instanceof Error ? e.message : "Errore di rete" });
    }
  };
  // Mappatura camere: non replicata dentro Xenora (resta configurazione di Channex) — un click
  // porta dritti alla pagina di QUEL canale su Channex, dentro lo stesso pannello SSO già usato
  // per "Collega un canale", invece di rimandare genericamente all'elenco.
  // NB: non conosciamo ancora il percorso reale della pagina di mappatura di UN canale
  // nell'app Channex (il tentativo /channels/{id} non ci è arrivato) — finché non lo
  // confermiamo, meglio l'elenco canali generico (che funziona) che un link rotto.
  const openChannelMapping = () => openChannelManager("/channels");

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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
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
              {fullSync.msg && <div className="mt-0.5 text-[11px] font-semibold" style={{ color: "var(--dim)" }}>{fullSync.msg}</div>}
              {relink.msg && <div className="mt-0.5 text-[11px] font-semibold" style={{ color: relink.ok === false ? "var(--err)" : relink.ok ? "var(--ok)" : "var(--dim)" }}>{relink.msg}</div>}
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:w-auto lg:shrink-0 lg:flex-row lg:flex-wrap lg:items-center">
            {chxMap[effStructure] ? (
              <button onClick={() => { importOta(); doFullSync(); }} disabled={impSync.running || fullSync.running} className="w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-40 lg:w-auto" title={t("Controlla le nuove prenotazioni dalle OTA e rimanda a Channex l'intera finestra di disponibilità/prezzi, in un colpo solo. Normalmente entrambe avvengono già da sole.")}>{impSync.running || fullSync.running ? t("Sincronizzo…") : "⟳ " + t("Sincronizza ora")}</button>
            ) : (
              <>
                <button onClick={() => doRelink(true)} disabled={relink.running} className="w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-40 lg:w-auto">{relink.running ? t("Ripristino…") : "⟳ " + t("Ripristina")}</button>
                <button onClick={syncToChannex} disabled={chxSync.running || effStructure === "all"} className="w-full rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 lg:w-auto">{chxSync.running ? t("Attivo…") : t("Attiva distribuzione")}</button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Risponde direttamente a "da dove vedo che sono collegato con Booking.com?": stato REALE
         da Channex per canale, non il vecchio flag locale mai aggiornato. Nascosta se Channex non
         è configurato (nessun errore da mostrare a chi non usa affatto questa integrazione). */}
      {!otaOff && (
        <>
          <SectionTitle>{t("Canali OTA collegati")}</SectionTitle>
          <div className="mb-3 mt-1 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"><Icon name="search" size={14} /></span>
              <input value={channelSearch} onChange={(e) => setChannelSearch(e.target.value)} placeholder={t("Cerca canale…")} className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-3 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
            </div>
            <button onClick={() => openChannelManager()} disabled={channelPanel.loading} className="shrink-0 rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{channelPanel.loading ? t("Apro…") : "+ " + t("Aggiungi")}</button>
            <button onClick={loadOtaStatus} disabled={otaLoading} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-40">{otaLoading ? t("Verifico…") : "⟳ " + t("Aggiorna")}</button>
          </div>
          <Card className="mb-5">
          {otaErr ? (
            <p className="text-sm" style={{ color: "var(--err)" }}>⚠ {otaErr}</p>
          ) : otaLoading && !otaByStructure ? (
            <p className="text-sm text-faint">{t("Verifico…")}</p>
          ) : otaGroups.every((g) => g.list.length === 0) ? (
            <p className="text-sm text-faint">{t("Nessun canale OTA collegato.")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {otaGroups.filter((g) => g.list.length > 0).map((g, gi) => (
                <div key={g.label ?? gi}>
                  {g.label && <div className="mb-2 text-xs font-semibold text-dim">{g.label}</div>}
                  <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b border-line bg-wash text-left text-[10px] font-bold uppercase tracking-wide text-faint">
                          <th className="px-3 py-2 font-bold">{t("Canale")}</th>
                          <th className="px-3 py-2 font-bold">{t("Colore")}</th>
                          <th className="px-3 py-2 font-bold">{t("Stato")}</th>
                          <th className="px-3 py-2 font-bold">{t("Correzione prezzo")}</th>
                          <th className="px-3 py-2 font-bold">{t("Commissione")}</th>
                          <th className="px-3 py-2 font-bold text-right">{t("Azioni")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.list.filter((c) => {
                          const q = channelSearch.trim().toLowerCase();
                          if (!q) return true;
                          const label = CHANNELS[c.channel as keyof typeof CHANNELS]?.label ?? c.title;
                          return label.toLowerCase().includes(q);
                        }).map((c, i) => {
                          const chKey = c.channel as Channel;
                          const label = CHANNELS[chKey]?.label ?? c.title;
                          const draft = c.id ? priceCorr[c.id] : undefined;
                          const corr = draft?.loaded && draft.value ? `${CORR_SIGN[draft.rule]}${draft.value}%` : t("nessuna");
                          const commPct = loadChannelCommissionPct(chKey) ?? (CHANNELS[chKey]?.commission ?? 0) * 100;
                          const color = loadChannelColor(chKey) || `var(${CHANNELS[chKey]?.cssVar ?? ""})`;
                          return (
                            <tr key={c.id || c.channel + i} className="border-b border-line last:border-0 hover:bg-wash">
                              <td className="px-3 py-2.5">
                                <span className="flex items-center gap-2">
                                  <ChannelLogo channel={chKey} size={22} title={label} />
                                  <span className="font-semibold text-txt">{label}</span>
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <button onClick={() => setChannelDetail({ sid: g.sid, c })} title={t("Colore su calendario")} className="h-5 w-5 rounded-full border border-line" style={{ backgroundColor: color }} />
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: c.active ? "color-mix(in srgb, var(--ok) 16%, transparent)" : "color-mix(in srgb, var(--err) 12%, transparent)", color: c.active ? "var(--ok)" : "var(--err)" }}>{c.active ? t("Attivo") : t("Non attivo")}</span>
                              </td>
                              <td className="px-3 py-2.5 text-dim">{corr}</td>
                              <td className="px-3 py-2.5 text-dim">{commPct}%</td>
                              <td className="px-3 py-2.5 text-right">
                                <button onClick={() => setChannelDetail({ sid: g.sid, c })} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-surface">{t("Modifica")}</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
          </Card>
        </>
      )}

      {/* Dettaglio canale: attiva/disattiva + correzione prezzo — Xenora scrive direttamente su
         Channex (nessun passaggio manuale sul pannello Channex). */}
      {channelDetail && (() => {
        const { sid, c } = channelDetail;
        const draft = c.id ? priceCorr[c.id] : undefined;
        const current = draft?.loaded && draft.value ? `${CORR_SIGN[draft.rule]}${draft.value}%` : t("nessuna");
        const msg = c.id ? corrMsg[c.id] : undefined;
        const label = CHANNELS[c.channel as keyof typeof CHANNELS]?.label ?? c.title;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setChannelDetail(null); }}>
            <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
              <div className="mb-4 flex items-center gap-3">
                <ChannelLogo channel={c.channel as keyof typeof CHANNELS} size={32} title={label} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-txt">{label}</div>
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: c.active ? "color-mix(in srgb, var(--ok) 16%, transparent)" : "color-mix(in srgb, var(--err) 12%, transparent)", color: c.active ? "var(--ok)" : "var(--err)" }}>{c.active ? t("Attivo") : t("Non attivo")}</span>
                </div>
                <button onClick={() => setChannelDetail(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg text-dim hover:bg-wash hover:text-txt">✕</button>
              </div>

              {c.id && (
                <button onClick={() => toggleChannel(sid, c)} disabled={togglingChannel === c.id} className="mb-4 w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-40">
                  {togglingChannel === c.id ? "…" : c.active ? t("Disattiva canale") : t("Attiva canale")}
                </button>
              )}

              {c.id && (
                <div className="rounded-xl border border-line bg-paper p-3">
                  <div className="mb-1.5 text-xs font-semibold text-txt">{t("Correzione prezzo")}</div>
                  <p className="mb-2.5 text-[11px] text-faint">{t("Rispetto al prezzo Xenora: si somma sopra eventuali promozioni attive sul canale stesso (Genius, offerte a tempo, ecc.) — non le sostituisce.")}</p>
                  <div className="mb-2 text-[11px] text-dim">{t("Attuale")}: <b className="text-txt">{current}</b></div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select value={draft?.rule ?? "increase_by_percent"} onChange={(e) => setPriceCorr((cur) => ({ ...cur, [c.id]: { rule: e.target.value as "increase_by_percent" | "decrease_by_percent", value: cur[c.id]?.value ?? "", loaded: true } }))} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">
                      <option value="increase_by_percent">+</option>
                      <option value="decrease_by_percent">−</option>
                    </select>
                    <input type="number" min={0} step="0.01" value={draft?.value ?? ""} onChange={(e) => setPriceCorr((cur) => ({ ...cur, [c.id]: { rule: cur[c.id]?.rule ?? "increase_by_percent", value: e.target.value, loaded: true } }))} placeholder="0" className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />
                    <span className="text-sm text-dim">%</span>
                    <button onClick={() => saveCorr(c.id)} disabled={corrSaving === c.id} className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>{corrSaving === c.id ? "…" : t("Salva")}</button>
                  </div>
                  {msg && <div className="mt-2 text-xs font-semibold" style={{ color: msg.ok === false ? "var(--err)" : msg.ok ? "var(--ok)" : "var(--dim)" }}>{msg.text}</div>}
                </div>
              )}

              {(() => {
                const chKey = c.channel as Channel;
                const savedColor = loadChannelColor(chKey);
                const computedColor = typeof window !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue(CHANNELS[chKey]?.cssVar ?? "").trim() : "";
                const pickerColor = savedColor || (/^#/.test(computedColor) ? computedColor : "#888888");
                const commVal = commDraft[c.id] ?? String(loadChannelCommissionPct(chKey) ?? Math.round((CHANNELS[chKey]?.commission ?? 0) * 1000) / 10);
                return (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-line bg-paper p-3">
                      <div className="mb-1.5 text-xs font-semibold text-txt">{t("Colore su calendario")}</div>
                      <div className="flex items-center gap-2">
                        <input type="color" value={pickerColor} onChange={(e) => saveChannelColor(chKey, e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0.5" />
                        <span className="text-[11px] text-faint">{t("Colora le prenotazioni di questo canale nel Calendario")}</span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-line bg-paper p-3">
                      <div className="mb-1.5 text-xs font-semibold text-txt">{t("Commissione predefinita")}</div>
                      <div className="flex items-center gap-1.5">
                        <input type="number" min={0} step="0.1" value={commVal} onChange={(e) => setCommDraft((cur) => ({ ...cur, [c.id]: e.target.value }))} className="w-16 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />
                        <span className="text-sm text-dim">%</span>
                        <button onClick={() => { const v = Number(commVal.replace(",", ".")); if (Number.isFinite(v) && v >= 0) { saveChannelCommissionPct(chKey, v); setCommSaved(c.id); window.setTimeout(() => setCommSaved(null), 1200); } }} className="ml-auto rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{commSaved === c.id ? t("Salvato ✓") : t("Salva")}</button>
                      </div>
                      <p className="mt-1.5 text-[11px] text-faint">{t("Usata quando una prenotazione non ha una commissione esatta comunicata dal canale.")}</p>
                    </div>
                  </div>
                );
              })()}

              {c.id && (
                <button onClick={() => openChannelMapping()} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">
                  {t("Mappatura camere su Channex")} ↗
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Pannello "Collega un canale": incorpora l'interfaccia di collegamento OTA (Booking.com,
         Airbnb, Expedia, ...) DENTRO Xenora, dentro la nostra intestazione — niente rimando a un
         sito esterno. Le credenziali/l'autorizzazione con ogni OTA restano gestite dal motore
         dietro le quinte (non replicabili lato nostro), il resto è nostro. */}
      {channelPanel.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label={t("Chiudi")} onClick={() => setChannelPanel({ open: false })} className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <div className="relative flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
              <div>
                <h2 className="font-display text-base font-bold text-txt">{t("Collega i tuoi canali")}</h2>
                <p className="text-[11px] text-dim">{t("Autorizza Booking.com, Airbnb, Expedia e gli altri portali che usi")}</p>
              </div>
              <button onClick={() => setChannelPanel({ open: false })} className="grid h-8 w-8 place-items-center rounded-lg text-lg text-dim hover:bg-wash hover:text-txt">✕</button>
            </div>
            <div className="relative flex-1 bg-wash">
              {channelPanel.loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-dim">{t("Preparo il collegamento…")}</div>}
              {channelPanel.error && <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm" style={{ color: "var(--err)" }}>⚠ {channelPanel.error}</div>}
              {channelPanel.url && <iframe src={channelPanel.url} className="h-full w-full border-0" title={t("Collega i tuoi canali")} />}
            </div>
          </div>
        </div>
      )}

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
