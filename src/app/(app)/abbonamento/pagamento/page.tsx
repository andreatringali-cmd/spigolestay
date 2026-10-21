"use client";

// Informazioni di pagamento (dimostrativo). In produzione i dati della carta sono gestiti da
// Stripe e NON passano dall'app: qui si mostra solo lo stato e i dati di fatturazione.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, SectionTitle, Button } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { validateIssuerSettings, normalizeVat, normalizeCf } from "@/lib/invoicing/validate";

interface Billing { businessName: string; vat: string; taxCode: string; address: string; streetNumber: string; city: string; cap: string; province: string; sdi: string; pec: string; email: string }
const KEY = "spigolestay:billing";
const empty: Billing = { businessName: "", vat: "", taxCode: "", address: "", streetNumber: "", city: "", cap: "", province: "", sdi: "", pec: "", email: "" };
// Stessa normalizzazione di Impostazioni fattura (questa riga è anche l'emittente delle fatture): P.IVA senza spazi né prefisso IT, CF/provincia/SDI maiuscoli, PEC minuscola.
function normalizeBilling(d: Billing, country: string): Billing {
  const it = (country || "IT").toUpperCase() === "IT";
  return { ...d, businessName: d.businessName.trim(), vat: it ? normalizeVat(d.vat) : d.vat.trim(), taxCode: it ? normalizeCf(d.taxCode) : d.taxCode.trim(), address: d.address.trim(), city: d.city.trim(), cap: d.cap.trim(), province: d.province.trim().toUpperCase(), sdi: d.sdi.trim().toUpperCase(), pec: d.pec.trim().toLowerCase() };
}

export default function PagamentoPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const tenantId = useTenantId(); // account di lavoro: per un collaboratore è quello di chi lo ha invitato
  const [b, setB] = useState<Billing>(empty);
  const [saved, setSaved] = useState(false);
  const [customer, setCustomer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const loadedRef = useRef(false);
  const countryRef = useRef("IT"); // paese dell'emittente (dalla riga del server): decide se si normalizzano P.IVA e codice fiscale all'italiana
  const [srvErr, setSrvErr] = useState(""); // errori di validazione / salvataggio sul server, visibili sotto il modulo
  // Cache locale immediata (per non mostrare vuoto).
  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setB({ ...empty, ...JSON.parse(r) }); } catch {} }, []);
  useEffect(() => {
    // Il SERVER è autorevole per i dati fiscali. Si legge la riga dell'account di LAVORO (un collaboratore aspetta di conoscerlo).
    if (!supabase || !user || !tenantId) return;
    supabase.from("tenant_invoice_settings").select("denominazione, vat, tax_code, pec, sdi, address, city, cap, province, country").eq("tenant_id", tenantId).maybeSingle().then(({ data }) => {
      if (!data) return;
      if (data.country) countryRef.current = String(data.country);
      // Preferisco il valore presente (server o locale) per non azzerare mai un campo compilato.
      setB((p) => ({ ...p,
        businessName: data.denominazione || p.businessName, vat: data.vat || p.vat, taxCode: data.tax_code || p.taxCode,
        pec: data.pec || p.pec, sdi: data.sdi || p.sdi, address: data.address || p.address, city: data.city || p.city, cap: data.cap || p.cap, province: data.province || p.province,
      }));
    });
  }, [user, tenantId]);
  // Cliente Stripe dell'ABBONAMENTO XENORA, autorevole dal server: evita di aprire per errore
  // un tuo cliente omonimo (stessa email ma non Xenora). Se non c'è abbonamento, customer = null.
  useEffect(() => {
    if (!user?.email) return;
    let cancel = false;
    fetch(`/api/stripe/customer?email=${encodeURIComponent(user.email)}${user.id ? `&userId=${encodeURIComponent(user.id)}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancel) return;
        if (d?.customerId) { setCustomer(d.customerId); try { localStorage.setItem("spigolestay:stripecustomer", d.customerId); } catch {} }
        else { setCustomer(null); try { localStorage.removeItem("spigolestay:stripecustomer"); } catch {} }
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, [user?.email, user?.id]);
  const set = (k: keyof Billing, v: string) => { loadedRef.current = true; setB((p) => ({ ...p, [k]: v })); };
  // Salvataggio: localStorage (cache) + SERVER (tenant_invoice_settings) → i dati fiscali NON si perdono più.
  // Salva SOLO dati normalizzati e validi: la stessa riga è l'emittente delle fatture, una P.IVA "IT 0123…" o un CAP errato farebbe scartare i documenti dallo SdI.
  const persist = async (data: Billing): Promise<{ ok: boolean; clean: Billing }> => {
    const clean = normalizeBilling(data, countryRef.current);
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
    if (!supabase || !user) return { ok: true, clean };
    if (!tenantId) { setSrvErr(t("Account di lavoro non ancora caricato: i dati si salvano appena è pronto.")); return { ok: false, clean }; }
    const errors = validateIssuerSettings({ denominazione: clean.businessName, vat: clean.vat, tax_code: clean.taxCode, address: clean.address, city: clean.city, cap: clean.cap, province: clean.province, country: countryRef.current, pec: clean.pec, sdi: clean.sdi, regime: "" }).filter((i) => i.level === "error");
    if (errors.length) { setSrvErr(errors.map((i) => t(i.msg)).join(" ")); return { ok: false, clean }; }
    const { error } = await supabase.from("tenant_invoice_settings").upsert({
      tenant_id: tenantId, denominazione: clean.businessName, vat: clean.vat, tax_code: clean.taxCode,
      pec: clean.pec, sdi: clean.sdi, address: clean.address, city: clean.city, cap: clean.cap, province: clean.province,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });
    if (error) { setSrvErr(`${t("Salvataggio non riuscito")}: ${error.message}`); return { ok: false, clean }; }
    setSrvErr("");
    return { ok: true, clean };
  };
  const save = async () => {
    const r = await persist(b);
    if (!r.ok) return;
    setB((p) => ({ ...p, ...r.clean })); // il modulo mostra i valori normalizzati
    setSaved(true); window.setTimeout(() => setSaved(false), 2000);
  };
  // Auto-salvataggio dopo una modifica (niente più "ho dimenticato di premere Salva").
  useEffect(() => { if (!loadedRef.current) return; const id = setTimeout(() => { void persist(b); }, 1000); return () => clearTimeout(id); }, [b]);

  // Aggiungi/gestisci carta: la carta è gestita da Stripe (non passa dall'app).
  const openPortal = async (cid: string) => {
    const res = await fetch("/api/stripe/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: cid }) });
    return res.json().catch(() => ({} as { url?: string; message?: string; error?: string }));
  };
  const addCard = async () => {
    setNotice("");
    if (!customer) { setNotice(t("Non hai ancora un abbonamento Xenora attivo: la carta si imposta al momento dell'attivazione di un piano. Vai su «Abbonamento» per scegliere il piano.")); return; }
    setBusy(true);
    try {
      let d = await openPortal(customer);
      // ID cliente obsoleto (creato in un'altra modalità/account Stripe): azzera, ri-cerca per email, riprova.
      if (!d?.url && /no such customer/i.test(String(d?.message || ""))) {
        try { localStorage.removeItem("spigolestay:stripecustomer"); } catch {}
        setCustomer(null);
        let found: string | null = null;
        if (user?.email) {
          const look = await fetch(`/api/stripe/customer?email=${encodeURIComponent(user.email)}${user.id ? `&userId=${encodeURIComponent(user.id)}` : ""}`).then((r) => r.json()).catch(() => ({}));
          if (look?.customerId && look.customerId !== customer) found = look.customerId as string;
        }
        if (found) {
          setCustomer(found); try { localStorage.setItem("spigolestay:stripecustomer", found); } catch {}
          d = await openPortal(found);
        } else {
          setNotice(t("Non risulta ancora un cliente Stripe per l'abbonamento Xenora: attiva un piano da «Abbonamento» per creare il metodo di pagamento."));
          setBusy(false); return;
        }
      }
      if (d?.url) { window.location.href = d.url; return; }
      setNotice(d?.message ? `${t("Non è stato possibile aprire il portale pagamenti.")} (${d.message})` : t("Non è stato possibile aprire il portale pagamenti. Riprova."));
    } catch { setNotice(t("Errore di rete. Riprova.")); }
    setBusy(false);
  };

  const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  return (
    <div>
      <PageHeader title={t("Informazioni pagamento")} subtitle={t("Metodo di pagamento e dati di fatturazione del tuo abbonamento")} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Metodo di pagamento */}
        <Card className="order-2">
          <SectionTitle>{t("Metodo di pagamento")}</SectionTitle>
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-line bg-paper p-3">
            <div className="grid h-10 w-14 place-items-center rounded-md bg-wash text-dim"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg></div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-txt">{customer ? t("Carta gestita su Stripe") : t("Nessuna carta salvata")}</div>
              <div className="text-[11px] text-faint">{customer ? t("Apri il portale per vedere o cambiare la carta.") : t("La carta si aggiunge quando attivi un piano (il pagamento è gestito da Stripe).")}</div>
            </div>
          </div>
          {customer
            ? <Button size="sm" onClick={addCard} disabled={busy} className="mt-3 w-full">{busy ? t("Attendi…") : t("Gestisci carta su Stripe")}</Button>
            : <Link href="/abbonamento" className="mt-3 block w-full rounded-lg bg-focus py-2 text-center text-sm font-semibold text-on-focus transition hover:opacity-90">{t("Scegli un piano")} →</Link>}
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">{t("Metodi accettati")}</div>
            <div className="flex flex-wrap gap-1.5">
              {[t("Carta"), "Apple Pay", "Google Pay", t("Addebito SEPA")].map((m) => (
                <span key={m} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-dim">{m}</span>
              ))}
            </div>
            <div className="mt-1.5 text-[11px] text-faint">{t("Bonifico bancario disponibile solo per il piano annuale, su fattura.")}</div>
          </div>
          {notice && <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 12%, transparent)", color: "var(--dim)" }}>{notice}</div>}
          <div className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] leading-snug" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 9%, transparent)", color: "var(--dim)" }}>
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-on-focus" style={{ backgroundColor: "var(--focus)" }}>i</span>
            <span>{t("In produzione il pagamento è gestito in modo sicuro da Stripe: i dati della carta non passano né vengono salvati dall'app.")}</span>
          </div>
        </Card>

        {/* Dati di fatturazione */}
        <Card className="order-1">
          <SectionTitle>{t("Dati di fatturazione")}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <label className={`${lbl} col-span-2`}>{t("Ragione sociale / Nome")}<input value={b.businessName} onChange={(e) => set("businessName", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Partita IVA")}<input value={b.vat} onChange={(e) => set("vat", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Codice fiscale")}<input value={b.taxCode} onChange={(e) => set("taxCode", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Città")}<input value={b.city} onChange={(e) => set("city", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Provincia")}<input value={b.province} onChange={(e) => set("province", e.target.value.toUpperCase())} className={`${inp} mt-1`} placeholder={t("Es. SR")} maxLength={2} /></label>
            <label className={lbl}>{t("Indirizzo di fatturazione")}<input value={b.address} onChange={(e) => set("address", e.target.value)} className={`${inp} mt-1`} placeholder={t("Via/Piazza")} /></label>
            <label className={lbl}>{t("Numero civico")}<input value={b.streetNumber} onChange={(e) => set("streetNumber", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("CAP")}<input value={b.cap} onChange={(e) => set("cap", e.target.value)} className={`${inp} mt-1`} inputMode="numeric" maxLength={5} placeholder="96100" /></label>
            <label className={lbl}>{t("Codice SDI")}<input value={b.sdi} onChange={(e) => set("sdi", e.target.value)} className={`${inp} mt-1`} placeholder={t("Fatt. elettronica")} /></label>
            <label className={lbl}>PEC<input value={b.pec} onChange={(e) => set("pec", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Email per le fatture")}<input value={b.email} onChange={(e) => set("email", e.target.value)} className={`${inp} mt-1`} placeholder="nome@email.it" /></label>
            {srvErr && <p className="col-span-2 text-xs font-medium text-[color:var(--err)]">{srvErr}</p>}
            <div className="flex items-end">
              <Button size="sm" onClick={save} className="flex w-full">{saved ? <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> {t("Salvato")}</> : t("Salva")}</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
