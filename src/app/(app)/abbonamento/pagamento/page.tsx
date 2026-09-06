"use client";

// Informazioni di pagamento (dimostrativo). In produzione i dati della carta sono gestiti da
// Stripe e NON passano dall'app: qui si mostra solo lo stato e i dati di fatturazione.

import { useEffect, useState } from "react";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";

interface Billing { businessName: string; vat: string; taxCode: string; address: string; sdi: string; pec: string; email: string }
const KEY = "spigolestay:billing";
const empty: Billing = { businessName: "", vat: "", taxCode: "", address: "", sdi: "", pec: "", email: "" };

export default function PagamentoPage() {
  const { t } = useLang();
  const [b, setB] = useState<Billing>(empty);
  const [saved, setSaved] = useState(false);
  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setB({ ...empty, ...JSON.parse(r) }); } catch {} }, []);
  const set = (k: keyof Billing, v: string) => setB((p) => ({ ...p, [k]: v }));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch {} setSaved(true); window.setTimeout(() => setSaved(false), 2000); };

  const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  return (
    <div>
      <PageHeader title={t("Informazioni pagamento")} subtitle={t("Metodo di pagamento e dati di fatturazione del tuo abbonamento")}
        actions={<button onClick={save} className="flex items-center gap-1.5 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{saved ? <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> {t("Salvato")}</> : <>💾 {t("Salva")}</>}</button>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Metodo di pagamento */}
        <Card>
          <SectionTitle>{t("Metodo di pagamento")}</SectionTitle>
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-line bg-paper p-3">
            <div className="grid h-10 w-14 place-items-center rounded-md bg-wash text-dim"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg></div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-txt">{t("Nessuna carta salvata")}</div>
              <div className="text-[11px] text-faint">{t("Aggiungi una carta per attivare il pagamento automatico dell'abbonamento.")}</div>
            </div>
          </div>
          <button disabled className="mt-3 w-full cursor-not-allowed rounded-lg border border-line py-2 text-sm font-semibold text-dim opacity-70" title={t("Disponibile alla messa in produzione")}>＋ {t("Aggiungi metodo di pagamento")}</button>
          <div className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] leading-snug" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 9%, transparent)", color: "var(--dim)" }}>
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: "var(--focus)" }}>i</span>
            <span>{t("In produzione il pagamento è gestito in modo sicuro da Stripe: i dati della carta non passano né vengono salvati dall'app.")}</span>
          </div>
        </Card>

        {/* Dati di fatturazione */}
        <Card>
          <SectionTitle>{t("Dati di fatturazione")}</SectionTitle>
          <p className="mb-3 text-xs text-dim">{t("Usati per intestare le fatture dell'abbonamento.")}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className={`${lbl} col-span-2`}>{t("Ragione sociale / Nome")}<input value={b.businessName} onChange={(e) => set("businessName", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Partita IVA")}<input value={b.vat} onChange={(e) => set("vat", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Codice fiscale")}<input value={b.taxCode} onChange={(e) => set("taxCode", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={`${lbl} col-span-2`}>{t("Indirizzo di fatturazione")}<input value={b.address} onChange={(e) => set("address", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Codice SDI")}<input value={b.sdi} onChange={(e) => set("sdi", e.target.value)} className={`${inp} mt-1`} placeholder={t("Fatt. elettronica")} /></label>
            <label className={lbl}>PEC<input value={b.pec} onChange={(e) => set("pec", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={`${lbl} col-span-2`}>{t("Email per le fatture")}<input value={b.email} onChange={(e) => set("email", e.target.value)} className={`${inp} mt-1`} placeholder="nome@email.it" /></label>
          </div>
        </Card>
      </div>
    </div>
  );
}
