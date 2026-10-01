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

export default function ImpostazioniPage() {
  const { theme, setTheme } = useTheme();
  const { t, lang, setLang } = useLang();
  const NOTIF_KEY = "spigolestay:notifs";
  const NOTIF_DEF = { newBooking: true, cancel: true, checkin: true, payment: false, review: true, message: true, cleaning: false, ota: true };
  const [notifs, setNotifs] = useState(NOTIF_DEF);
  useEffect(() => { try { const r = localStorage.getItem(NOTIF_KEY); if (r) setNotifs({ ...NOTIF_DEF, ...JSON.parse(r) }); } catch {} /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const setNotif = (k: keyof typeof NOTIF_DEF, v: boolean) => setNotifs((p) => { const n = { ...p, [k]: v }; try { localStorage.setItem(NOTIF_KEY, JSON.stringify(n)); } catch {} return n; });
  const ask = useConfirm();

  // Sync Google Calendar: due feed iCal ("Aggiungi da URL") con prenotazioni e pulizie,
  // aggiornati da soli — niente da fare dopo il primo collegamento.
  const [calLinks, setCalLinks] = useState<{ bookingsUrl: string; pulizieUrl: string } | null>(null);
  const [calErr, setCalErr] = useState("");
  useEffect(() => {
    apiPost<{ ok: boolean; bookingsUrl: string; pulizieUrl: string }>("calendar/links", {})
      .then((j) => setCalLinks(j))
      .catch((e) => setCalErr(e instanceof Error ? e.message : "Errore"));
  }, []);

  // Sync in TEMPO REALE (alternativa al feed sopra): Xenora scrive/cancella direttamente gli
  // eventi sul calendario Google che l'utente condivide col service account — niente ritardo
  // di Google nel ricontrollare il feed (vedi googleCalendarSync.ts).
  const { structures, updateStructure, activeStructureId } = useData();
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
  const gcalStruct = structures.find((s) => s.id === gcalStructId);
  const [gcalIdInput, setGcalIdInput] = useState("");
  useEffect(() => { setGcalIdInput(gcalStruct?.gcalId ?? ""); }, [gcalStruct?.gcalId, gcalStructId]);
  const [gcalCopied, setGcalCopied] = useState(false);
  const saveGcalId = () => { if (gcalStructId) updateStructure(gcalStructId, { gcalId: gcalIdInput.trim() || undefined, updatedAt: Date.now() }); };
  const copyServiceEmail = () => { if (gcalInfo?.serviceAccountEmail) { navigator.clipboard?.writeText(gcalInfo.serviceAccountEmail); setGcalCopied(true); setTimeout(() => setGcalCopied(false), 1500); } };

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
          <Toggle label={t("Cancellazioni")} checked={notifs.cancel} onChange={(v) => setNotif("cancel", v)} />
          <Toggle label={t("Prenotazioni dalle OTA")} checked={notifs.ota} onChange={(v) => setNotif("ota", v)} />
          <Toggle label={t("Check-in di oggi")} checked={notifs.checkin} onChange={(v) => setNotif("checkin", v)} />
          <Toggle label={t("Pagamenti ricevuti")} checked={notifs.payment} onChange={(v) => setNotif("payment", v)} />
          <Toggle label={t("Nuove recensioni")} checked={notifs.review} onChange={(v) => setNotif("review", v)} />
          <Toggle label={t("Messaggi degli ospiti")} checked={notifs.message} onChange={(v) => setNotif("message", v)} />
          <Toggle label={t("Promemoria pulizie")} checked={notifs.cleaning} onChange={(v) => setNotif("cleaning", v)} />
        </div>
      </Card>

      <Card className="mt-4">
        <SectionTitle>{t("Sincronizza con Google Calendar")}</SectionTitle>
        <p className="mb-3 text-xs text-dim">{t("Due calendari sempre aggiornati, uno per le prenotazioni e uno per le pulizie (utile da condividere con la signora). Copia il link, poi in Google Calendar vai su \"Aggiungi altri calendari\" → \"Da URL\" e incollalo: da quel momento si aggiorna da solo, senza fare nulla.")}</p>
        {calErr && <p className="text-xs font-medium" style={{ color: "var(--err)" }}>{calErr}</p>}
        {calLinks ? (
          <div className="space-y-2">
            <CalendarLinkRow label={t("Prenotazioni")} url={calLinks.bookingsUrl} />
            <CalendarLinkRow label={t("Pulizie")} url={calLinks.pulizieUrl} />
          </div>
        ) : !calErr && <p className="text-xs text-dim">{t("Preparo i link…")}</p>}
      </Card>

      <Card className="mt-4">
        <SectionTitle>{t("Sync in tempo reale (anche le cancellazioni)")}</SectionTitle>
        {gcalInfo && !gcalInfo.configured ? (
          <p className="text-xs text-dim">{t("Funzione non ancora attiva lato server.")}</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-dim">{t("Il link sopra si aggiorna da solo ma con qualche ora di ritardo (lo decide Google). Con questa invece Xenora scrive/cancella gli eventi sul tuo calendario appena succede qualcosa — cancellazioni comprese, istantanee.")}</p>
            <ol className="mb-3 list-decimal space-y-1.5 pl-4 text-xs text-dim">
              <li>{t("Su Google Calendar crea (o scegli) il calendario da usare per una struttura.")}</li>
              <li>
                {t("Condividilo con questo indirizzo, permesso \"Apportare modifiche agli eventi\":")}
                {gcalInfo?.serviceAccountEmail && (
                  <div className="mt-1 flex items-center gap-2">
                    <code className="truncate rounded-lg border border-line bg-wash px-2 py-1 text-[11px] text-txt">{gcalInfo.serviceAccountEmail}</code>
                    <button onClick={copyServiceEmail} className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-txt hover:bg-wash">{gcalCopied ? "✓" : t("Copia")}</button>
                  </div>
                )}
              </li>
              <li>{t("Nelle impostazioni di quel calendario (su Google) copia l'\"ID calendario\" e incollalo qui sotto, per la struttura giusta.")}</li>
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
                <input value={gcalIdInput} onChange={(e) => setGcalIdInput(e.target.value)} placeholder="es. abc123@group.calendar.google.com" className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
                <button onClick={saveGcalId} disabled={!gcalStructId} className="shrink-0 rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Salva")}</button>
              </div>
            </label>
            {gcalStruct?.gcalId && <p className="mt-2 text-xs font-medium" style={{ color: "var(--ok)" }}>✓ {t("Attivo per")} {gcalStruct.name}</p>}
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
function CalendarLinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch {} };
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-sm font-medium text-txt">{label}</span>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-xs text-dim outline-none" />
      <button onClick={copy} className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">{copied ? "Copiato ✓" : "Copia"}</button>
    </div>
  );
}
function ThemeBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button onClick={onClick} className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${active ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}
