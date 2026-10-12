"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle, StatCard } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import Icon from "@/components/Icon";
import { apiPost } from "@/lib/invoicing/client";
import { forceFullSync } from "@/components/ChannexAutoSync";
import type { MappedExtraPlan } from "@/lib/rate-model";
import { CHANNELS, type Channel } from "@/lib/types";
import ChannelLogo from "@/components/ChannelLogo";
import { usePriceCorrections } from "@/lib/usePriceCorrections";
import { correctionLabel } from "@/lib/priceCorrection";
import { loadChannelColor, saveChannelColor } from "@/lib/channelOverrides";
import { defaultCommissionInfo } from "@/lib/booking";
import { toISO } from "@/lib/dates";
import { channelStats, monthRanges, periodRange, PERIOD_LABEL, type StatsPeriod, type ChannelStatsResult } from "@/lib/channel-stats";

// Tavolozza di colori predefiniti per canale (dieci toni distinti, pensati per restare
// leggibili sia su barre calendario chiare che scure). Il picker nativo resta disponibile
// per chi vuole personalizzare oltre questi.
// Colori di marca per canale: compaiono per primi nei colori proposti (es. il blu Booking.com), così si torna al colore ufficiale con un clic.
const CHANNEL_BRAND_COLORS: Partial<Record<Channel, string>> = { booking: "#003B95" };
const CHANNEL_PRESET_COLORS = ["#FFC93C", "#2563EB", "#7C3AED", "#DB2777", "#E11D48", "#EA580C", "#D97706", "#65A30D", "#0D9488", "#0891B2", "#475569"];


export default function CanaliPage() {
  const { structures, roomTypes, units, bookings, activeStructureId } = useData();
  const { t } = useLang();
  const [localStructure, setLocalStructure] = useState("all");
  const effStructure = activeStructureId !== "all" ? activeStructureId : localStructure;


  // Sincronizzazione reale verso Channex (staging): crea property + camere + tariffe da Xenora.
  const [chxMap, setChxMap] = useState<Record<string, { propertyId: string; rooms?: Record<string, { roomTypeId: string; ratePlanId?: string; ratePlans?: MappedExtraPlan[] }>; at: string }>>({});
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
    setFullSync({ running: true, msg: t("Full sync in corso…") });
    // Esito reale: la Promise si risolve quando l'invio a Channex termina (o dopo un minuto senza conferma).
    void forceFullSync(effStructure).then((e) => setFullSync({ running: false, msg: e.ok ? "✓ " + t(e.message) : "⚠ " + t(e.message) }));
  };
  // Importa le prenotazioni OTA in entrata dal feed Channex (2-way).
  const importOta = async () => {
    setImpSync({ running: true, msg: "Controllo nuove prenotazioni dalle OTA…" });
    try {
      const j = await apiPost<{ ok: boolean; imported?: number; cancelled?: number; feed?: number; skipped?: number; acked?: number; errors?: string[]; error?: string }>("channex/import", effStructure !== "all" ? { structureId: effStructure } : {});
      if (!j.ok) { setImpSync({ running: false, ok: false, msg: j.error || "Import non riuscito" }); return; }
      const n = (j.imported ?? 0) + (j.cancelled ?? 0);
      // Diagnostica: se il feed ha righe ma nulla è stato importato, spiega il perché (di solito
      // tipologia non mappata o property non collegata) invece del generico "nessuna prenotazione".
      let msg: string;
      if (n > 0) msg = `Importate ${j.imported ?? 0} prenotazioni${j.cancelled ? `, ${j.cancelled} cancellazioni` : ""} ✓`;
      else if ((j.feed ?? 0) === 0) msg = "Nessuna prenotazione nel feed Channex (nessuna in attesa di conferma).";
      else msg = `${j.feed} nel feed ma 0 importate · ${j.skipped ?? 0} saltate${j.errors?.length ? ` · ${j.errors[0]}` : " (probabile tipologia non mappata o soggiorno già concluso)"}`;
      setImpSync({ running: false, ok: n > 0, msg });
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
          for (const [chxRt, xid] of Object.entries(l.roomsMap || {})) {
            rooms[xid] = { roomTypeId: chxRt, ratePlanId: l.ratePlans?.[chxRt] };
            // Piani tariffari extra già mappati (modello tariffe, default spento): il relink non li conosce, si conservano com'erano.
            const prev = chxMap[l.structureId]?.rooms?.[xid];
            if (prev?.ratePlans?.length && prev.roomTypeId === chxRt) rooms[xid] = { ...prev };
          }
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
  // Chiudendo il pannello dei canali (dove si aggiungono/modificano) l'elenco si rilegge da solo.
  const closeChannelPanel = () => { setChannelPanel({ open: false }); void loadOtaStatus(); };
  // "Tutte" raggruppa per struttura; una struttura specifica è un gruppo unico senza etichetta.
  const otaGroups: { sid: string; label?: string; list: { id: string; channel: string; title: string; active: boolean }[] }[] =
    effStructure === "all"
      ? structures.filter((s) => (otaByStructure?.[s.id]?.length ?? 0) > 0).map((s) => ({ sid: s.id, label: s.name, list: otaByStructure![s.id] }))
      : [{ sid: effStructure, list: otaByStructure?.[effStructure] ?? [] }];
  // Correzione di prezzo (derived_option) a livello di connessione canale: valore REALE letto/scritto su
  // Channex (hook usePriceCorrections), con anteprima, verifica per rilettura e storico. Vedi
  // components/PriceCorrectionPanel.tsx. Il valore letto precompila il modulo e, se la lettura
  // fallisce, il salvataggio resta bloccato (niente sovrascritture alla cieca).
  const corrApi = usePriceCorrections();
  useEffect(() => {
    if (!otaByStructure) return;
    for (const [sid, list] of Object.entries(otaByStructure)) for (const ch of list) if (ch.id && !corrApi.current[ch.id]) corrApi.load(ch.id, sid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otaByStructure]);
  const corrText = (id: string) => { const cs = corrApi.current[id]; return !cs ? "…" : cs.loaded ? correctionLabel(cs.correction) : cs.loading ? "…" : "?"; };
  // Card "essenziali" (logo + nome + stato) nella lista canali: il dettaglio (attiva/disattiva,
  // correzione prezzo) si apre al click, invece di stare tutto incollato nella card.
  const [, setColorTick] = useState(0); // il colore sta nel browser: dopo ogni scelta si ridisegna la pagina (evidenziazione e pallino in tabella)
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

  // NB: l'invio di disponibilità e prezzi a Channex è ora AUTOMATICO (vedi ChannexAutoSync,
  // montato nell'AppShell): parte da solo a ogni modifica di prenotazioni, camere (anche fuori
  // servizio) o prezzi. Niente più pulsante manuale.

  // Statistiche per canale (arrivi nel periodo scelto): perimetro = struttura in vista o tutte; e una per ogni struttura per la tabella.
  const [period, setPeriod] = useState<StatsPeriod>("last30");
  const range = useMemo(() => periodRange(period, toISO(new Date())), [period]);
  const scope = useMemo(() => channelStats(bookings, { ...range, structureId: effStructure === "all" ? undefined : effStructure }), [bookings, range, effStructure]);
  const statsBySid = useMemo(() => { const m: Record<string, ChannelStatsResult> = {}; for (const s of structures) m[s.id] = channelStats(bookings, { ...range, structureId: s.id }); return m; }, [bookings, range, structures]);
  const otaShare = Math.round(scope.rows.filter((r) => r.channel !== "direct").reduce((a, r) => a + r.shareGross, 0));
  const eur = (n: number) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const chColor = (ch: Channel) => loadChannelColor(ch) || `var(${CHANNELS[ch]?.cssVar ?? ""})`;
  // Quando abbiamo mandato per l'ultima volta l'intera finestra di prezzi e disponibilità (dato del browser in uso).
  const lastFullTs = (sid: string): number | null => { try { const v = JSON.parse(localStorage.getItem("spigolestay:channex-lastfullsync") || "{}")[sid]; return typeof v === "number" ? v : null; } catch { return null; } };
  const [nowMs] = useState(() => Date.now());
  const agoText = (ts: number) => {
    const d = Math.max(0, Math.floor((nowMs - ts) / 1000));
    if (d < 60) return t("adesso");
    if (d < 3600) return `${Math.floor(d / 60)} ${t("min fa")}`;
    if (d < 86400) return `${Math.floor(d / 3600)} ${t("h fa")}`;
    return `${Math.floor(d / 86400)} ${t("g fa")}`;
  };
  const activeChannels = effStructure !== "all" ? (otaByStructure?.[effStructure] ?? []).filter((c) => c.active).length : 0;
  const lastFull = effStructure !== "all" ? lastFullTs(effStructure) : null;

  // Grafico mensile: 5 mesi indietro, il corrente e 2 avanti, per canale (perimetro = struttura in vista o tutte).
  const months = useMemo(() => monthRanges(toISO(new Date()), 5, 2), []);
  const monthly = useMemo(() => months.map((m) => ({ m, res: channelStats(bookings, { from: m.from, to: m.to, structureId: effStructure === "all" ? undefined : effStructure }) })), [bookings, months, effStructure]);
  const monthMax = Math.max(1, ...monthly.map((x) => x.res.totals.gross));
  const monthlyChannels = Array.from(new Set(monthly.flatMap((x) => x.res.rows.filter((r) => r.gross > 0).map((r) => r.channel))));
  // Canali non ancora collegati nel perimetro in vista (Airbnb è tra i canali di Xenora; Agoda e Trip.com sono altri portali collegabili da "Gestisci canali").
  const connectedText = (effStructure === "all" ? Object.values(otaByStructure ?? {}).flat() : otaByStructure?.[effStructure] ?? []).map((c) => `${c.channel} ${c.title}`.toLowerCase()).join(" | ");
  const airbnbShare = Math.round(scope.rows.find((r) => r.channel === "airbnb")?.shareGross ?? 0);
  const suggestions: { key: string; name: string; channel?: Channel; why: string }[] = [
    { key: "airbnb", name: "Airbnb", channel: "airbnb" as Channel, why: airbnbShare > 0 ? `Oggi vale il ${airbnbShare}% dei tuoi ricavi.` : "Porta ospiti che cercano appartamenti e camere in stile locale, un pubblico diverso da quello di Booking.com." },
    { key: "agoda", name: "Agoda", why: "Forte sul pubblico asiatico: utile se vuoi più ospiti da fuori Europa." },
    { key: "trip", name: "Trip.com", why: "Porta ospiti dalla Cina e dall'Asia, che prenotano in anticipo." },
  ].filter((s) => !connectedText.includes(s.key));

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
              {effStructure !== "all" && chxMap[effStructure] && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
                  <span className="rounded-full bg-wash px-2 py-0.5 font-semibold">{activeChannels} {t("canali attivi")}</span>
                  {lastFull && <span className="rounded-full bg-wash px-2 py-0.5">{t("Ultimo invio completo")}: {agoText(lastFull)}</span>}
                </div>
              )}
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

      {/* Andamento per canale: numeri reali dalle prenotazioni (arrivi nel periodo scelto), stesse formule dell'elenco Prenotazioni. */}
      <section className="mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Andamento per canale")}{effStructure !== "all" && structures.find((s) => s.id === effStructure) ? ` · ${structures.find((s) => s.id === effStructure)?.name}` : ""}</div>
          <div role="group" aria-label={t("Periodo")} className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-xs font-semibold">
            {(Object.keys(PERIOD_LABEL) as StatsPeriod[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p} className={`rounded-md px-3 py-1.5 transition ${period === p ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>{t(PERIOD_LABEL[p])}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("Prenotazioni")} value={scope.totals.bookings} hint={`${scope.totals.nights} ${t("notti")}${scope.totals.cancelled ? ` · ${scope.totals.cancelled} ${t("annullate")}` : ""}`} />
          <StatCard label={t("Ricavo lordo")} value={eur(scope.totals.gross)} hint={scope.totals.avgNight ? `${eur(scope.totals.avgNight)} ${t("a notte")}` : undefined} />
          <StatCard label={t("Commissioni")} value={eur(scope.totals.commission)} color={scope.totals.commission > 0 ? "var(--err)" : undefined} hint={scope.totals.commissionPct != null ? `${scope.totals.commissionPct}% ${t("del lordo")}` : undefined} />
          <StatCard label={t("Netto")} value={eur(scope.totals.net)} color={scope.totals.net > 0 ? "var(--ok)" : undefined} hint={scope.totals.gross > 0 ? `${Math.round((scope.totals.net / scope.totals.gross) * 100)}% ${t("del lordo")}` : undefined} />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-txt">{t("Da dove arrivano le prenotazioni")}</div>
            {scope.rows.length > 0 && <div className="text-[11px] text-faint">{t("Vendite tramite OTA")}: <b className="text-txt">{otaShare}%</b> · {t("dirette")}: <b className="text-txt">{100 - otaShare}%</b></div>}
          </div>
          {scope.rows.length === 0 ? (
            <p className="text-sm text-faint">{t("Nessuna prenotazione nel periodo scelto.")}</p>
          ) : (
            <>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-wash">
                {scope.rows.filter((r) => r.shareGross > 0).map((r) => (
                  <div key={r.channel} title={`${CHANNELS[r.channel]?.label ?? r.channel}: ${Math.round(r.shareGross)}%`} style={{ width: `${r.shareGross}%`, backgroundColor: chColor(r.channel) }} />
                ))}
              </div>
              <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-6 gap-y-4">
                {scope.rows.map((r) => (
                  <div key={r.channel} className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs text-dim"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chColor(r.channel) }} /><span className="truncate">{CHANNELS[r.channel]?.label ?? r.channel}</span></div>
                    <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-txt">{Math.round(r.shareGross)}%</div>
                    <div className="text-[11px] text-faint">{r.bookings} {t("pren.")} · {eur(r.gross)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
          <Card>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-txt">{t("Ricavi lordi per mese")}</div>
              <div className="text-[11px] text-faint">{t("per mese di arrivo · i mesi futuri mostrano il già prenotato")}</div>
            </div>
            <div className="flex h-44 items-end gap-2 border-b border-line pb-px" role="img" aria-label={t("Ricavi lordi per mese e per canale")}>
              {monthly.map(({ m, res }) => {
                const h = (res.totals.gross / monthMax) * 100;
                return (
                  <div key={m.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${m.label}: ${eur(res.totals.gross)}${res.rows.map((r) => `\n${CHANNELS[r.channel]?.label ?? r.channel}: ${eur(r.gross)}`).join("")}`}>
                    <span className={`font-mono text-[10px] tabular-nums ${m.current ? "font-bold text-txt" : "text-faint"}`}>{res.totals.gross > 0 ? (res.totals.gross >= 1000 ? `${(res.totals.gross / 1000).toFixed(1).replace(".0", "")}k` : Math.round(res.totals.gross)) : ""}</span>
                    <div className="flex w-full max-w-[44px] flex-col-reverse overflow-hidden rounded-t-md" style={{ height: `${h}%`, minHeight: res.totals.gross > 0 ? 3 : 0, opacity: m.future ? 0.55 : 1 }}>
                      {res.rows.filter((r) => r.gross > 0).map((r) => (
                        <div key={r.channel} style={{ height: `${(r.gross / res.totals.gross) * 100}%`, backgroundColor: chColor(r.channel) }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-2">
              {monthly.map(({ m }) => (
                <div key={m.key} className={`min-w-0 flex-1 text-center text-[11px] capitalize ${m.current ? "font-bold text-txt" : "text-faint"}`}>{m.label}</div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {monthlyChannels.map((ch) => (
                <span key={ch} className="inline-flex items-center gap-1.5 text-[11px] text-dim"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: chColor(ch) }} />{CHANNELS[ch]?.label ?? ch}</span>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* Risponde direttamente a "da dove vedo che sono collegato con Booking.com?": stato REALE
         da Channex per canale, non il vecchio flag locale mai aggiornato. Nascosta se Channex non
         è configurato (nessun errore da mostrare a chi non usa affatto questa integrazione). */}
      {!otaOff && (
        <>
          <SectionTitle>{t("Canali OTA collegati")}</SectionTitle>
          <div className="mb-3 mt-1 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"><Icon name="search" size={14} /></span>
              <input value={channelSearch} onChange={(e) => setChannelSearch(e.target.value)} placeholder={t("Cerca canale…")} className="w-full rounded-lg border border-line bg-paper py-1.5 pl-8 pr-3 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
            </div>
            <button onClick={() => openChannelManager()} disabled={channelPanel.loading} className="shrink-0 rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{channelPanel.loading ? t("Apro…") : t("Gestisci canali") + " ↗"}</button>
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
                  {g.label && <div className="mb-2 font-display text-sm font-bold text-txt">{g.label}</div>}
                  {(() => {
                    const list = g.list.filter((c) => {
                      const q = channelSearch.trim().toLowerCase();
                      if (!q) return true;
                      const label = CHANNELS[c.channel as keyof typeof CHANNELS]?.label ?? c.title;
                      return label.toLowerCase().includes(q);
                    });
                    const gs = statsBySid[g.sid];
                    const shown = list.map((c) => gs?.rows.find((r) => r.channel === (c.channel as Channel))).filter((x): x is NonNullable<typeof x> => !!x);
                    const tot = shown.reduce((a, r) => ({ n: a.n + r.bookings, nights: a.nights + r.nights, gross: a.gross + r.gross, comm: a.comm + r.commission, net: a.net + r.net }), { n: 0, nights: 0, gross: 0, comm: 0, net: 0 });
                    const th = "px-3 py-2.5 font-bold";
                    return (
                  <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full min-w-[1000px] text-sm">
                      <thead>
                        <tr className="border-b border-line bg-wash text-left text-[10px] font-bold uppercase tracking-wide text-faint">
                          <th className={th}>{t("Canale")}</th>
                          <th className={th}>{t("Stato")}</th>
                          <th className={`${th} text-right`}>{t("Prenotazioni")}</th>
                          <th className={th}>{t("Quota ricavi")}</th>
                          <th className={`${th} text-right`}>{t("Lordo")}</th>
                          <th className={`${th} text-right`}>{t("Commissioni")}</th>
                          <th className={`${th} text-right`}>{t("Netto")}</th>
                          <th className={`${th} text-right`}>{t("€ / notte")}</th>
                          <th className={th}>{t("Correzione prezzo")}</th>
                          <th className={th}>{t("Colore")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((c, i) => {
                          const chKey = c.channel as Channel;
                          const label = CHANNELS[chKey]?.label ?? c.title;
                          const corr = c.id ? corrText(c.id) : "—";
                          const commInfo = defaultCommissionInfo(chKey, g.sid);
                          const commPct = Math.round(commInfo.pct * 10) / 10;
                          const color = loadChannelColor(chKey) || `var(${CHANNELS[chKey]?.cssVar ?? ""})`;
                          const st = gs?.rows.find((r) => r.channel === chKey);
                          const dash = <span className="text-faint">—</span>;
                          return (
                            <tr key={c.id || c.channel + i} className="border-b border-line last:border-0 hover:bg-wash">
                              <td className="px-3 py-3">
                                <span className="flex items-center gap-2.5">
                                  <ChannelLogo channel={chKey} size={26} title={label} />
                                  <span className="font-semibold text-txt">{label}</span>
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: c.active ? "color-mix(in srgb, var(--ok) 16%, transparent)" : "color-mix(in srgb, var(--err) 12%, transparent)", color: c.active ? "var(--ok)" : "var(--err)" }}>{c.active ? t("Attivo") : t("Non attivo")}</span>
                              </td>
                              <td className="px-3 py-3 text-right">
                                {st ? (<><div className="font-mono font-semibold tabular-nums text-txt">{st.bookings}</div><div className="text-[11px] text-faint">{st.nights} {t("notti")}{st.cancelled ? ` · ${st.cancelled} ${t("annullate")}` : ""}</div></>) : dash}
                              </td>
                              <td className="px-3 py-3">
                                {st ? (
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round(st.shareGross))}%`, backgroundColor: color }} /></div>
                                    <span className="font-mono text-xs tabular-nums text-dim">{Math.round(st.shareGross)}%</span>
                                  </div>
                                ) : dash}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-txt">{st && st.gross > 0 ? eur(st.gross) : dash}</td>
                              <td className="px-3 py-3 text-right" title={commInfo.source === "stima" ? "Percentuale stimata dalle commissioni reali dell'ultimo anno (per le prenotazioni senza cifra)" : commInfo.source === "manuale" ? "Percentuale impostata da te" : "Percentuale standard: non ci sono abbastanza dati reali per stimarla"}>
                                <div className="font-mono tabular-nums text-txt">{st && st.commission > 0 ? eur(st.commission) : dash}</div>
                                <div className="text-[11px] text-faint">{commInfo.source === "stima" ? "~" : ""}{commPct}%{commInfo.source === "standard" ? <span className="ml-1 text-[10px]">standard</span> : null}</div>
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums" style={{ color: st && st.net > 0 ? "var(--ok)" : undefined }}>{st && st.net > 0 ? eur(st.net) : dash}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-dim">{st?.avgNight ? eur(st.avgNight) : dash}</td>
                              <td className="px-3 py-3 text-dim">{corr}</td>
                              <td className="px-3 py-3">
                                <button onClick={() => setChannelDetail({ sid: g.sid, c })} title={t("Cambia il colore su calendario")} aria-label={t("Cambia il colore su calendario")} className="h-6 w-6 rounded-full border border-line transition hover:scale-110" style={{ backgroundColor: color }} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {shown.length > 1 && (
                        <tfoot>
                          <tr className="border-t border-line bg-wash text-xs font-semibold text-txt">
                            <td className="px-3 py-2.5" colSpan={2}>{t("Totale canali")}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{tot.n}<span className="ml-1 font-sans text-[11px] font-normal text-faint">{tot.nights} {t("notti")}</span></td>
                            <td />
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{eur(tot.gross)}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{eur(tot.comm)}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums" style={{ color: "var(--ok)" }}>{eur(tot.net)}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-dim">{tot.nights > 0 && tot.gross > 0 ? eur(Math.round(tot.gross / tot.nights)) : "—"}</td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
          </Card>
        </>
      )}

      {/* Altri canali da valutare: quelli non ancora collegati nel perimetro in vista. Il collegamento si fa da "Gestisci canali". */}
      {!otaOff && suggestions.length > 0 && (
        <section className="mb-5">
          <SectionTitle>{t("Altri canali da valutare")}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            {suggestions.map((s) => (
              <div key={s.key} className="flex flex-col rounded-xl border border-dashed border-line bg-surface p-4">
                <div className="flex items-center gap-2.5">
                  {s.channel ? <ChannelLogo channel={s.channel} size={26} title={s.name} /> : <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-wash text-xs font-bold text-dim">{s.name[0]}</span>}
                  <span className="font-semibold text-txt">{s.name}</span>
                  <span className="ml-auto rounded-full bg-wash px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">{t("Non collegato")}</span>
                </div>
                <p className="mt-2 flex-1 text-[13px] leading-snug text-dim">{s.why}</p>
                <button onClick={() => openChannelManager()} disabled={channelPanel.loading} className="mt-3 self-start rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-40">{t("Collega")} ↗</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Collegamento al Channel Manager non attivo su questo ambiente */}
      {otaOff && (
        <Card className="mb-5">
          <p className="text-sm text-dim">{t("Il collegamento al Channel Manager non è attivo su questo ambiente: non posso leggere i canali collegati.")}</p>
        </Card>
      )}

      {/* Colore del canale (sul Calendario): si cambia cliccando il pallino nella tabella. Il resto si gestisce su Channex. */}
      {channelDetail && (() => {
        const { c } = channelDetail;
        const chKey = c.channel as Channel;
        const label = CHANNELS[chKey]?.label ?? c.title;
        const savedColor = loadChannelColor(chKey);
        const computedColor = typeof window !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue(CHANNELS[chKey]?.cssVar ?? "").trim() : "";
        const pickerColor = savedColor || (/^#/.test(computedColor) ? computedColor : "#888888");
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setChannelDetail(null); }}>
            <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
              <div className="mb-3 flex items-center gap-3">
                <ChannelLogo channel={chKey} size={28} title={label} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-txt">{label}</div>
                  <div className="text-[11px] text-dim">{t("Colore su calendario")}</div>
                </div>
                <button onClick={() => setChannelDetail(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg text-dim hover:bg-wash hover:text-txt" aria-label={t("Chiudi")}>✕</button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                        {[...(CHANNEL_BRAND_COLORS[chKey] ? [CHANNEL_BRAND_COLORS[chKey] as string] : []), ...CHANNEL_PRESET_COLORS].map((hex) => (
                          <button key={hex} onClick={() => { saveChannelColor(chKey, hex); setColorTick((n) => n + 1); }} title={hex} aria-pressed={pickerColor.toLowerCase() === hex.toLowerCase()} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold leading-none text-white" style={{ backgroundColor: hex, textShadow: "0 0 2px rgba(0,0,0,.6)", boxShadow: pickerColor.toLowerCase() === hex.toLowerCase() ? "0 0 0 2px var(--surface), 0 0 0 4px var(--txt)" : "0 0 0 1px rgba(0,0,0,.12)" }}>{pickerColor.toLowerCase() === hex.toLowerCase() ? "✓" : ""}</button>
                        ))}
                        <label className="relative grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full border border-dashed border-line text-[10px] text-faint" title={t("Colore personalizzato")}>
                          +
                          <input type="color" value={pickerColor} onChange={(e) => { saveChannelColor(chKey, e.target.value); setColorTick((n) => n + 1); }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                        </label>
                      </div>
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
          <button aria-label={t("Chiudi")} onClick={closeChannelPanel} className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <div className="relative flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
              <div>
                <h2 className="font-display text-base font-bold text-txt">{t("Collega i tuoi canali")}</h2>
                <p className="text-[11px] text-dim">{t("Autorizza Booking.com, Airbnb, Expedia e gli altri portali che usi")}</p>
              </div>
              <button onClick={closeChannelPanel} className="grid h-8 w-8 place-items-center rounded-lg text-lg text-dim hover:bg-wash hover:text-txt">✕</button>
            </div>
            <div className="relative flex-1 bg-wash">
              {channelPanel.loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-dim">{t("Preparo il collegamento…")}</div>}
              {channelPanel.error && <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm" style={{ color: "var(--err)" }}>⚠ {channelPanel.error}</div>}
              {channelPanel.url && <iframe src={channelPanel.url} className="h-full w-full border-0" title={t("Collega i tuoi canali")} />}
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
