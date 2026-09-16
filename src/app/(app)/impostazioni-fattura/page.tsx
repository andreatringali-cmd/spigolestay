"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { FORFETTARIO_NOTE } from "@/lib/invoicing/folio";

interface Settings {
  regime: string; denominazione: string; vat: string; tax_code: string;
  address: string; city: string; cap: string; province: string; country: string;
  pec: string; sdi: string; regime_note: string; footer_note: string;
  default_provider: string; default_pdf_lang: string; rounding: boolean; bollo_auto: boolean;
}
const DEF: Settings = {
  regime: "imprenditoriale_ordinario", denominazione: "", vat: "", tax_code: "",
  address: "", city: "", cap: "", province: "", country: "IT", pec: "", sdi: "",
  regime_note: "", footer_note: "", default_provider: "mock", default_pdf_lang: "it",
  rounding: false, bollo_auto: true,
};

export default function ImpostazioniFatturaPage() {
  const { user } = useAuth();
  const [s, setS] = useState<Settings>(DEF);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.from("tenant_invoice_settings").select("*").maybeSingle().then(({ data }) => {
      if (data) setS({ ...DEF, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)) as Partial<Settings> });
      setLoading(false);
    });
  }, []);

  const set = (patch: Partial<Settings>) => setS((p) => ({ ...p, ...patch }));

  const save = async () => {
    if (!supabase || !user) { setMsg("Devi essere connesso."); return; }
    setSaving(true); setMsg("");
    const regime_note = s.regime === "forfettario" && !s.regime_note.trim() ? FORFETTARIO_NOTE : s.regime_note;
    const { error } = await supabase.from("tenant_invoice_settings").upsert({ tenant_id: user.id, ...s, regime_note, updated_at: new Date().toISOString() });
    setSaving(false);
    setMsg(error ? "Errore: " + error.message : "Impostazioni salvate ✓");
  };

  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  if (loading) return <div className="p-6 text-sm text-faint">Caricamento…</div>;

  return (
    <div>
      <PageHeader title="Impostazioni fattura" subtitle="Regime, dati dell'emittente e servizio di invio"
        actions={<button onClick={save} disabled={saving} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{saving ? "Salvataggio…" : "Salva"}</button>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Regime fiscale</SectionTitle>
          <label className="mt-2 block">{lbl && <span className={lbl}>Regime</span>}
            <select value={s.regime} onChange={(e) => set({ regime: e.target.value })} className={inp}>
              <option value="imprenditoriale_ordinario">Imprenditoriale ordinario (IVA per aliquota)</option>
              <option value="forfettario">Forfettario (IVA 0% N2.2, bollo 2€ &gt; 77,47€)</option>
              <option value="non_imprenditoriale">Non imprenditoriale (solo ricevuta, no SDI)</option>
            </select>
          </label>
          <p className="mt-2 text-[12px] text-dim">
            {s.regime === "imprenditoriale_ordinario" && "Fatture con IVA (10% pernottamento/pulizia, 22% extra), tassa di soggiorno fuori campo IVA (N1)."}
            {s.regime === "forfettario" && "Fatture senza IVA (natura N2.2), dicitura di legge in calce, bollo virtuale 2€ automatico oltre 77,47€."}
            {s.regime === "non_imprenditoriale" && "Solo ricevuta non fiscale: nessun invio allo SdI."}
          </p>
          <label className="mt-3 flex items-center justify-between"><span className="text-sm text-txt">Bollo automatico (forfettario)</span>
            <input type="checkbox" checked={s.bollo_auto} onChange={(e) => set({ bollo_auto: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>
          <label className="mt-2 flex items-center justify-between"><span className="text-sm text-txt">Arrotonda il totale all'euro</span>
            <input type="checkbox" checked={s.rounding} onChange={(e) => set({ rounding: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>
          {s.regime === "forfettario" && (
            <label className="mt-3 block"><span className={lbl}>Dicitura in calce</span>
              <textarea value={s.regime_note} onChange={(e) => set({ regime_note: e.target.value })} rows={3} placeholder={FORFETTARIO_NOTE} className={inp} /></label>
          )}
        </Card>

        <Card>
          <SectionTitle>Servizio di invio (SdI)</SectionTitle>
          <label className="mt-2 block"><span className={lbl}>Provider fatturazione elettronica</span>
            <select value={s.default_provider} onChange={(e) => set({ default_provider: e.target.value })} className={inp}>
              <option value="mock">Test (mock, nessun invio reale)</option>
              <option value="fattureincloud">Fatture in Cloud (da collegare)</option>
              <option value="openapi">Openapi (da collegare)</option>
            </select>
          </label>
          <p className="mt-2 text-[12px] text-dim">
            {s.default_provider === "mock" && "Modalità di prova: i documenti vengono numerati ed 'emessi' ma non trasmessi davvero allo SdI."}
            {s.default_provider === "fattureincloud" && "Le fatture verranno spinte nel tuo conto Fatture in Cloud, che gestisce XML e SdI. Serve il collegamento OAuth (in arrivo)."}
            {s.default_provider === "openapi" && "Invio tramite intermediario Openapi. Serve la configurazione delle credenziali (in arrivo)."}
          </p>
          <label className="mt-3 block"><span className={lbl}>Lingua PDF predefinita</span>
            <select value={s.default_pdf_lang} onChange={(e) => set({ default_pdf_lang: e.target.value })} className={inp}>
              <option value="it">Italiano</option><option value="en">English</option>
            </select>
          </label>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Dati emittente (in fattura)</SectionTitle>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className={lbl}>Denominazione / ragione sociale</span><input value={s.denominazione} onChange={(e) => set({ denominazione: e.target.value })} className={inp} /></label>
            <label className="block"><span className={lbl}>Partita IVA</span><input value={s.vat} onChange={(e) => set({ vat: e.target.value })} className={inp} /></label>
            <label className="block"><span className={lbl}>Codice fiscale</span><input value={s.tax_code} onChange={(e) => set({ tax_code: e.target.value })} className={inp} /></label>
            <label className="block sm:col-span-2"><span className={lbl}>Indirizzo</span><input value={s.address} onChange={(e) => set({ address: e.target.value })} className={inp} /></label>
            <label className="block"><span className={lbl}>Città</span><input value={s.city} onChange={(e) => set({ city: e.target.value })} className={inp} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className={lbl}>CAP</span><input value={s.cap} onChange={(e) => set({ cap: e.target.value })} className={inp} /></label>
              <label className="block"><span className={lbl}>Provincia</span><input value={s.province} onChange={(e) => set({ province: e.target.value })} className={inp} /></label>
            </div>
            <label className="block"><span className={lbl}>PEC</span><input value={s.pec} onChange={(e) => set({ pec: e.target.value })} className={inp} /></label>
            <label className="block"><span className={lbl}>Codice destinatario / SDI</span><input value={s.sdi} onChange={(e) => set({ sdi: e.target.value })} className={inp} /></label>
            <label className="block sm:col-span-2"><span className={lbl}>Piè di pagina PDF</span><input value={s.footer_note} onChange={(e) => set({ footer_note: e.target.value })} className={inp} /></label>
          </div>
        </Card>
      </div>
      {msg && <p className="mt-3 text-sm font-medium text-dim">{msg}</p>}
    </div>
  );
}
