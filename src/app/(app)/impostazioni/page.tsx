"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useTheme } from "@/lib/theme";
import { useLang } from "@/lib/i18n";
import Icon from "@/components/Icon";
import StyleChooser from "@/components/StyleChooser";
import { apiPost } from "@/lib/invoicing/client";
import { useData } from "@/lib/store";
import { NOTIF_DEF, loadNotifPrefs } from "@/lib/notifPrefs";
import { AI_CONCIERGE_DEF, AI_CONCIERGE_KEY, loadAiConciergePrefs } from "@/lib/aiConcierge";

// Errore comune: incollare il link di embed/pubblico del calendario invece del semplice ID
// (es. "https://calendar.google.com/calendar/embed?src=xxx%40group.calendar.google.com&ctz=...").
// L'ID vero è nel parametro src/cid, URL-decodificato: lo estraiamo da soli così non serve
// insegnare all'utente la differenza tra i due campi sulla pagina di Google.
function extractCalendarId(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  try {
    if (/^https?:\/\//i.test(v)) {
      const u = new URL(v);
      const src = u.searchParams.get("src") || u.searchParams.get("cid");
      if (src) return src;
    }
  } catch {}
  return v;
}

export default function ImpostazioniPage() {
  const { theme, setTheme } = useTheme();
  const { t, lang, setLang } = useLang();
  const NOTIF_KEY = "spigolestay:notifs";
  const [notifs, setNotifs] = useState(NOTIF_DEF);
  useEffect(() => { setNotifs(loadNotifPrefs()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const setNotif = (k: keyof typeof NOTIF_DEF, v: boolean) => setNotifs((p) => { const n = { ...p, [k]: v }; try { localStorage.setItem(NOTIF_KEY, JSON.stringify(n)); } catch {} return n; });
  // Concierge AI (risposta automatica WhatsApp alle domande semplici) — default SPENTO, vedi src/lib/aiConcierge.ts.
  const [aiConcierge, setAiConciergeState] = useState(AI_CONCIERGE_DEF);
  useEffect(() => { setAiConciergeState(loadAiConciergePrefs()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const setAiConciergeEnabled = (v: boolean) => setAiConciergeState((p) => { const n = { ...p, enabled: v }; try { localStorage.setItem(AI_CONCIERGE_KEY, JSON.stringify(n)); } catch {} return n; });
  const setAiConciergeStructure = (v: string) => setAiConciergeState((p) => { const n = { ...p, defaultStructureId: v }; try { localStorage.setItem(AI_CONCIERGE_KEY, JSON.stringify(n)); } catch {} return n; });
  const ask = useConfirm();

  // Sync Google Calendar in TEMPO REALE: Xenora scrive/cancella direttamente gli eventi sul
  // calendario Google che l'utente condivide col service account (vedi googleCalendarSync.ts).
  const { structures, updateStructure, activeStructureId, bookings, guests, units, roomTypes } = useData();
  const [gcalInfo, setGcalInfo] = useState<{ configured: boolean; serviceAccountEmail: string | null } | null>(null);
  useEffect(() => {
    apiPost<{ ok: boolean; configured: boolean; serviceAccountEmail: string | null }>("calendar/gcal-info", {})
      .then((j) => setGcalInfo(j))
      .catch(() => setGcalInfo({ configured: false, serviceAccountEmail: null }));
  }, []);
  const [gcalStructId, setGcalStructId] = useState("");
  useEffect(() => {
    if (gcalStructId && structures.some((s) => s.id === gcalStructId)) return;
    setGcalStructId(activeStructureId !== "all" ? activeStructureId : structures[0]?.id ?? "");
  }, [structures, activeStructureId, gcalStructId]);
  // Segui la struttura attiva del selettore globale (con "Tutte" resta la scelta locale).
  useEffect(() => { if (activeStructureId !== "all") setGcalStructId(activeStructureId); }, [activeStructureId]);
  const gcalStruct = structures.find((s) => s.id === gcalStructId);
  const [gcalIdInput, setGcalIdInput] = useState("");
  useEffect(() => { setGcalIdInput(extractCalendarId(gcalStruct?.gcalId ?? "")); }, [gcalStruct?.gcalId, gcalStructId]);
  const [gcalCopied, setGcalCopied] = useState(false);
  const saveGcalId = () => { if (gcalStructId) updateStructure(gcalStructId, { gcalId: extractCalendarId(gcalIdInput) || undefined, updatedAt: Date.now() }); };
  const copyServiceEmail = () => { if (gcalInfo?.serviceAccountEmail) { navigator.clipboard?.writeText(gcalInfo.serviceAccountEmail); setGcalCopied(true); setTimeout(() => setGcalCopied(false), 1500); } };

  // Verifica SENZA scrivere nulla, appena incollato l'ID — invece di scoprire un errore solo al
  // primo "Sincronizza ora" (che oltretutto scrive davvero sul calendario). Messaggi mirati sugli
  // errori più comuni: 403 = condivisione mancante/sbagliata (si ricollega al passo 2 della guida),
  // 404 = ID calendario sbagliato (si ricollega al passo 3). L'ultimo ID che ha superato la verifica
  // viene salvato su gcalVerifiedId così il badge "✓ Collegato e verificato" resta visibile anche
  // dopo un refresh, finché l'ID salvato non cambia.
  const [gcalVerifying, setGcalVerifying] = useState(false);
  const [gcalVerifyMsg, setGcalVerifyMsg] = useState<{ text: string; err?: boolean; hint?: string } | null>(null);
  const verifyGcal = async () => {
    const calendarId = extractCalendarId(gcalIdInput);
    if (!calendarId) return;
    setGcalVerifying(true); setGcalVerifyMsg(null);
    try {
      const r = await apiPost<{ ok: boolean; summary?: string; error?: string }>("calendar/sync-event", { action: "verify", calendarId });
      if (r.ok) {
        setGcalVerifyMsg({ text: `${t("Collegato e verificato")}${r.summary ? ` — "${r.summary}"` : ""}` });
        if (gcalStructId) updateStructure(gcalStructId, { gcalVerifiedId: calendarId });
      }
      else if (r.error === "http_403") setGcalVerifyMsg({ text: t("Permesso negato: questo calendario non risulta condiviso con l'indirizzo del service account (o non col ruolo giusto)."), err: true, hint: t("Ripeti il passo 2 qui sopra: condividi di nuovo il calendario con quell'email, scegliendo il ruolo \"Apportare modifiche agli eventi\".") });
      else if (r.error === "http_404") setGcalVerifyMsg({ text: t("Calendario non trovato: l'ID inserito non è corretto."), err: true, hint: t("Ricontrolla il passo 3 qui sopra: riapri le impostazioni del calendario giusto su Google e ricopia l'ID (va bene anche l'intero link).") });
      else setGcalVerifyMsg({ text: `${t("Errore")}: ${r.error || t("sconosciuto")}`, err: true });
    } catch (e) { setGcalVerifyMsg({ text: e instanceof Error ? e.message : t("Errore di rete"), err: true }); }
    finally { setGcalVerifying(false); }
  };
  // Vero solo se l'ID attualmente scritto nel campo È quello salvato per la struttura E quello
  // che ha superato l'ultima verifica: se l'utente tocca il campo o salva un ID diverso, sparisce
  // finché non lo riverifica, così non mente mai sullo stato reale.
  const verifiedId = gcalStruct?.gcalVerifiedId;
  const isVerifiedCurrent = !!verifiedId && verifiedId === extractCalendarId(gcalIdInput) && verifiedId === extractCalendarId(gcalStruct?.gcalId ?? "");

  // La sync scrive solo le prenotazioni create/modificate/cancellate DA ORA IN POI (vedi
  // store.tsx): collegare un calendario a una struttura che ha già prenotazioni non le fa
  // comparire da sole. Questo pulsante fa una tantum il "riporto" di quelle esistenti.
  const [gcalSyncing, setGcalSyncing] = useState(false);
  const [gcalSyncMsg, setGcalSyncMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const syncExistingNow = async () => {
    const calendarId = extractCalendarId(gcalIdInput);
    if (!gcalStructId || !calendarId) return;
    const toSync = bookings.filter((b) => b.structureId === gcalStructId && b.status !== "cancelled" && b.channel !== "blocked");
    setGcalSyncing(true); setGcalSyncMsg(null);
    let ok = 0; let firstError = "";
    for (const b of toSync) {
      const g = guests.find((x) => x.id === b.guestId);
      const unit = units.find((u) => u.id === b.unitId);
      const rt = roomTypes.find((r) => r.id === (unit?.roomTypeId ?? b.roomTypeId));
      const roomLabel = [rt?.name, unit?.name].filter(Boolean).join(" · ");
      const summary = [g?.fullName || "Ospite", roomLabel].filter(Boolean).join(" — ");
      const description = [b.code && `Codice: ${b.code}`, b.channel && `Canale: ${b.channel}`].filter(Boolean).join(" · ");
      try {
        const r = await apiPost<{ ok: boolean; error?: string }>("calendar/sync-event", {
          action: "upsert", bookingId: b.id, calendarId, summary, description,
          startDate: b.checkIn, endDateExclusive: b.checkOut,
        });
        if (r.ok) ok++; else if (!firstError) firstError = r.error || "errore sconosciuto";
      } catch (e) { if (!firstError) firstError = e instanceof Error ? e.message : "errore sconosciuto"; }
    }
    setGcalSyncing(false);
    if (!toSync.length) setGcalSyncMsg({ text: t("Nessuna prenotazione da sincronizzare per questa struttura.") });
    else if (ok === toSync.length) setGcalSyncMsg({ text: `${t("Fatto")}: ${ok}/${toSync.length} ${t("prenotazioni scritte sul calendario.")}` });
    else setGcalSyncMsg({ text: `${ok}/${toSync.length} ${t("scritte")} — ${t("errore")}: ${firstError}`, err: true });
  };

  // Backup: esporta/importa tutte le chiavi "spigolestay:*".
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const keysOf = () => { const ks: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("spigolestay:")) ks.push(k); } return ks; };
  const doExport = () => {
    const dump: Record<string, string> = {};
    keysOf().forEach((k) => { dump[k] = localStorage.getItem(k)!; });
    const blob = new Blob([JSON.stringify({ app: "Xenora", exportedAt: new Date().toISOString(), data: dump }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `spigolestay-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const doImport = (file?: File) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result));
        const data = (parsed.data ?? parsed) as Record<string, unknown>;
        let n = 0;
        Object.entries(data).forEach(([k, v]) => { if (k.startsWith("spigolestay:")) { localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); n++; } });
        setMsg(`${t("Ripristinati")} ${n} ${t("blocchi di dati. Ricarico…")}`); setTimeout(() => location.reload(), 900);
      } catch { setMsg(t("File di backup non valido.")); }
    };
    r.readAsText(file);
  };

  return (
    <div>
      <PageHeader title={t("Impostazioni")} subtitle={t("Preferenze generali dell'account")} />

      {/* Tema */}
      <Card className="mt-4">
        <SectionTitle>{t("Tema")}</SectionTitle>
        <div className="mt-1 flex items-center rounded-lg border border-line p-0.5" style={{ width: "fit-content" }}>
          <ThemeBtn active={theme === "light"} onClick={() => setTheme("light")} icon="sun" label={t("Chiaro")} />
          <ThemeBtn active={theme === "dark"} onClick={() => setTheme("dark")} icon="moon" label={t("Scuro")} />
        </div>
      </Card>

      {/* Stile dell'interfaccia */}
      <Card className="mt-4">
        <SectionTitle>{t("Stile dell'interfaccia")}</SectionTitle>
        <p className="mb-3 text-xs text-dim">{t("Scegli la palette di colori e la forma dei box. Si applica subito a tutto il gestionale e resta salvata.")}</p>
        <StyleChooser />
      </Card>

      {/* Lingua */}
      <Card className="mt-4">
        <SectionTitle>{t("Lingua")}</SectionTitle>
        <Row label={t("Lingua interfaccia")}>
          <select value={lang} onChange={(e) => setLang(e.target.value as Parameters<typeof setLang>[0])} className={inp}>
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </Row>
      </Card>

      {/* Notifiche */}
      <Card className="mt-4">
        <SectionTitle>{t("Notifiche")}</SectionTitle>
        <p className="mb-3 text-xs text-dim">{t("Scegli di cosa vuoi essere avvisato.")}</p>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Toggle label={t("Nuove prenotazioni")} checked={notifs.newBooking} onChange={(v) => setNotif("newBooking", v)} />
          <Toggle label={t("Modifiche prenotazione")} checked={notifs.modified} onChange={(v) => setNotif("modified", v)} />
          <Toggle label={t("Cancellazioni")} checked={notifs.cancel} onChange={(v) => setNotif("cancel", v)} />
          <Toggle label={t("Prenotazioni dalle OTA")} checked={notifs.ota} onChange={(v) => setNotif("ota", v)} />
          <Toggle label={t("Check-in di oggi")} checked={notifs.checkin} onChange={(v) => setNotif("checkin", v)} />
          <Toggle label={t("Pagamenti ricevuti")} checked={notifs.payment} onChange={(v) => setNotif("payment", v)} />
          <Toggle label={t("Nuove recensioni")} checked={notifs.review} onChange={(v) => setNotif("review", v)} />
          <Toggle label={t("Messaggi degli ospiti")} checked={notifs.message} onChange={(v) => setNotif("message", v)} />
          <Toggle label={t("Promemoria pulizie")} checked={notifs.cleaning} onChange={(v) => setNotif("cleaning", v)} />
        </div>
      </Card>

      {/* Concierge AI — risposta automatica WhatsApp alle domande semplici, default SPENTO */}
      <Card className="mt-4">
        <SectionTitle>{t("Concierge AI 🤖")}</SectionTitle>
        <p className="mb-3 text-xs text-dim">{t("Se attivo, risponde IN AUTOMATICO su WhatsApp solo alle domande semplici (orario check-in, wifi, parcheggio, indicazioni stradali) quando è sicura della risposta: per tutto il resto — reclami, richieste economiche o qualunque dubbio — lascia il messaggio a te, come oggi.")}</p>
        <Toggle label={t("Risposta automatica alle domande semplici")} checked={aiConcierge.enabled} onChange={setAiConciergeEnabled} />
        {aiConcierge.enabled && structures.length > 1 && (
          <label className="mt-3 block text-xs font-medium text-dim">{t("Struttura di riferimento per chi scrive senza prenotazione")}
            <select value={aiConcierge.defaultStructureId ?? ""} onChange={(e) => setAiConciergeStructure(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt">
              <option value="">{t("Nessuna (non rispondere)")}</option>
              {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="mt-1 block text-[11px] text-faint">{t("Chi ha una prenotazione viene riconosciuto da solo; questa scelta serve per i numeri nuovi.")}</span>
          </label>
        )}
      </Card>

      <Card className="mt-4">
        <SectionTitle>{t("Sincronizza con Google Calendar")}</SectionTitle>
        {gcalInfo && !gcalInfo.configured ? (
          <p className="text-xs text-dim">{t("Funzione non ancora attiva lato server.")}</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-dim">{t("Xenora scrive/cancella gli eventi sul tuo calendario appena succede qualcosa — nuove prenotazioni, modifiche, cancellazioni — tutto istantaneo, senza passare da un link da ricontrollare.")}</p>
            <ol className="mb-4 space-y-3 text-xs text-dim">
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-wash text-[11px] font-bold text-txt">1</span>
                <span className="pt-0.5">{t("Vai su")} <strong className="font-semibold text-txt">calendar.google.com</strong> {t("e crea un nuovo calendario (oppure usa uno che hai già).")}</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-wash text-[11px] font-bold text-txt">2</span>
                <span className="pt-0.5">
                  {t("Clicca sui tre puntini accanto al nome del calendario → \"Impostazioni e condivisione\" → \"Aggiungi persone e gruppi\" → incolla questa email:")}
                  {gcalInfo?.serviceAccountEmail && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="truncate rounded-lg border border-line bg-wash px-2 py-1.5 text-[11px] text-txt">{gcalInfo.serviceAccountEmail}</code>
                      <button onClick={copyServiceEmail} className="shrink-0 rounded-lg bg-focus px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90">{gcalCopied ? `✓ ${t("Copiata")}` : t("Copia")}</button>
                    </div>
                  )}
                  <div className="mt-1.5">{t("→ scegli il ruolo \"Apportare modifiche agli eventi\" → Invia.")}</div>
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-wash text-[11px] font-bold text-txt">3</span>
                <span className="pt-0.5">{t("Torna su Google Calendar, riapri di nuovo le impostazioni di quel calendario, scorri fino a \"Integra calendario\" e copia l'\"ID calendario\" — va bene anche incollare l'intero link, qui sotto lo sistemiamo da soli.")}</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-wash text-[11px] font-bold text-txt">4</span>
                <span className="pt-0.5">{t("Incolla qui sotto e premi \"Verifica\": ti diciamo subito se è tutto a posto, prima di \"Salva\".")}</span>
              </li>
            </ol>
            {activeStructureId === "all" && structures.length > 1 && (
              <label className="mb-2 block text-xs font-medium text-dim">{t("Struttura")}
                <select value={gcalStructId} onChange={(e) => setGcalStructId(e.target.value)} className={`mt-1 ${inp}`}>
                  {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            <label className="block text-xs font-medium text-dim">{t("ID calendario Google")} {activeStructureId !== "all" && gcalStruct ? `· ${gcalStruct.name}` : ""}
              <div className="mt-1 flex items-center gap-2">
                <input value={gcalIdInput} onChange={(e) => { setGcalIdInput(e.target.value); setGcalVerifyMsg(null); }} placeholder="es. abc123@group.calendar.google.com" className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
                <button onClick={verifyGcal} disabled={!gcalIdInput.trim() || gcalVerifying} className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-40">{gcalVerifying ? t("Verifico…") : t("Verifica")}</button>
                <button onClick={saveGcalId} disabled={!gcalStructId} className="shrink-0 rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Salva")}</button>
              </div>
            </label>
            {gcalVerifyMsg && (
              <div className="mt-2 rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: gcalVerifyMsg.err ? "color-mix(in srgb, var(--err) 14%, transparent)" : "color-mix(in srgb, var(--ok) 14%, transparent)", color: gcalVerifyMsg.err ? "var(--err)" : "var(--ok)" }}>
                <div>{gcalVerifyMsg.err ? "⚠ " : "✓ "}{gcalVerifyMsg.text}</div>
                {gcalVerifyMsg.hint && <div className="mt-1 font-normal opacity-90">{gcalVerifyMsg.hint}</div>}
              </div>
            )}
            {gcalStruct?.gcalId && (
              <>
                {isVerifiedCurrent ? (
                  <p className="mt-2 text-xs font-semibold" style={{ color: "var(--ok)" }}>✓ {t("Collegato e verificato per")} {gcalStruct.name}</p>
                ) : (
                  <p className="mt-2 text-xs font-semibold" style={{ color: "var(--warn)" }}>{t("Salvato per")} {gcalStruct.name} — {t("premi \"Verifica\" per controllare che funzioni")}</p>
                )}
                <p className="mt-2 text-xs text-dim">{t("Attiva da ora in poi: le prenotazioni già esistenti non compaiono da sole finché non cambiano. Per scriverle subito tutte una volta sola:")}</p>
                <button onClick={syncExistingNow} disabled={gcalSyncing} className="mt-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-50">{gcalSyncing ? t("Sincronizzo…") : t("Sincronizza ora le prenotazioni esistenti")}</button>
                {gcalSyncMsg && <p className="mt-1.5 text-xs font-medium" style={{ color: gcalSyncMsg.err ? "var(--err)" : "var(--ok)" }}>{gcalSyncMsg.text}</p>}
              </>
            )}
          </>
        )}
      </Card>

      <Card className="mt-4">
        <SectionTitle>{t("Backup & dati")}</SectionTitle>
        <p className="mb-3 text-xs text-dim">{t("Esporta tutti i dati del gestionale (prenotazioni, cassa, tariffe, utenti, immagini…) in un file, o ripristinali da un backup. Utile per spostare i dati o metterli al sicuro.")}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={doExport} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">↓ {t("Esporta backup (.json)")}</button>
          <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">↑ {t("Importa backup")}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
        </div>
        {msg && <p className="mt-2 text-xs font-medium text-focus">{msg}</p>}
      </Card>

      <p className="mt-3 text-xs text-faint">{t("Dimostrativo. Le preferenze saranno salvate per utente sul backend; il backup include tutti i dati locali dell'app.")}</p>
    </div>
  );
}

const inp = "w-44 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-sm text-dim">{label}</span>{children}</div>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-dim">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-[color:var(--focus)]" />
    </label>
  );
}
function ThemeBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button onClick={onClick} className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${active ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}
