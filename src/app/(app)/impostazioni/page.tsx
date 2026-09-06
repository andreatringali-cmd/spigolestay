"use client";

import { useRef, useState } from "react";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { resetAll } from "@/lib/onboarding";
import { useTheme } from "@/lib/theme";
import { useLang } from "@/lib/i18n";
import Icon from "@/components/Icon";
import StyleChooser from "@/components/StyleChooser";

export default function ImpostazioniPage() {
  const { theme, setTheme } = useTheme();
  const { t } = useLang();
  const [lang, setLang] = useState("it");
  const [notifNew, setNotifNew] = useState(true);
  const [notifCancel, setNotifCancel] = useState(true);
  const ask = useConfirm();

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
  const doReset = async () => { if (!(await ask({ title: t("Reset dati"), message: t("Cancellare tutti i dati e tornare ai dati di esempio? Operazione irreversibile."), danger: true, confirmLabel: t("Reset") }))) return; keysOf().forEach((k) => localStorage.removeItem(k)); location.reload(); };
  const doFirstAccess = async () => { if (!(await ask({ title: t("Ricomincia da zero"), message: t("Cancella tutti i dati e riparte dalla configurazione iniziale (primo accesso), con struttura e camere da impostare. Operazione irreversibile."), danger: true, confirmLabel: t("Ricomincia") }))) return; resetAll(); };

  return (
    <div>
      <PageHeader title={t("Impostazioni")} subtitle={t("Preferenze generali dell'account")} />
      <div className="grid gap-4">
        <Card>
          <SectionTitle>{t("Aspetto, lingua e notifiche")}</SectionTitle>
          <div className="flex flex-col gap-3">
            <Row label={t("Tema")}>
              <div className="flex items-center rounded-lg border border-line p-0.5">
                <ThemeBtn active={theme === "light"} onClick={() => setTheme("light")} icon="sun" label={t("Chiaro")} />
                <ThemeBtn active={theme === "dark"} onClick={() => setTheme("dark")} icon="moon" label={t("Scuro")} />
              </div>
            </Row>
            <Row label={t("Lingua interfaccia")}>
              <select value={lang} onChange={(e) => setLang(e.target.value)} className={inp}>
                <option value="it">Italiano</option>
                <option value="en">English</option>
              </select>
            </Row>
            <Toggle label={t("Notifica nuove prenotazioni")} checked={notifNew} onChange={setNotifNew} />
            <Toggle label={t("Notifica cancellazioni")} checked={notifCancel} onChange={setNotifCancel} />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <SectionTitle>{t("Stile dell'interfaccia")}</SectionTitle>
        <p className="mb-3 text-xs text-dim">{t("Scegli la palette di colori e la forma dei box. Si applica subito a tutto il gestionale e resta salvata.")}</p>
        <StyleChooser />
      </Card>

      <Card className="mt-4">
        <SectionTitle>{t("Backup & dati")}</SectionTitle>
        <p className="mb-3 text-xs text-dim">{t("Esporta tutti i dati del gestionale (prenotazioni, cassa, tariffe, utenti, immagini…) in un file, o ripristinali da un backup. Utile per spostare i dati o metterli al sicuro.")}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={doExport} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">↓ {t("Esporta backup (.json)")}</button>
          <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">↑ {t("Importa backup")}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
          <button onClick={doReset} className="ml-auto rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Reset ai dati di esempio")}</button>
        </div>
        {msg && <p className="mt-2 text-xs font-medium text-focus">{msg}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3" style={{ borderColor: "color-mix(in srgb, var(--err) 30%, var(--line))" }}>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-txt">🔄 {t("Ricomincia da zero (primo accesso)")}</div>
            <div className="text-[11px] text-faint">{t("Svuota tutto e riparte dalla configurazione guidata: profilo, struttura, camere, piano.")}</div>
          </div>
          <button onClick={doFirstAccess} className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "var(--err)" }}>{t("Ricomincia")}</button>
        </div>
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
