"use client";

// Informazioni di pagamento (dimostrativo). In produzione i dati della carta sono gestiti da
// Stripe e NON passano dall'app: qui si mostra solo lo stato e i dati di fatturazione.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/authsync";

interface Billing { businessName: string; vat: string; taxCode: string; address: string; streetNumber: string; city: string; province: string; sdi: string; pec: string; email: string }
const KEY = "spigolestay:billing";
const empty: Billing = { businessName: "", vat: "", taxCode: "", address: "", streetNumber: "", city: "", province: "", sdi: "", pec: "", email: "" };

export default function PagamentoPage() {
  const { t } = useLang();
  const router = useRouter();
  const { user } = useAuth();
  const [b, setB] = useState<Billing>(empty);
  const [saved, setSaved] = useState(false);
  const [customer, setCustomer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setB({ ...empty, ...JSON.parse(r) }); } catch {} }, []);
  useEffect(() => { try { const c = localStorage.getItem("spigolestay:stripecustomer"); if (c) setCustomer(c); } catch {} }, []);
  // Recupera il cliente Stripe dall'email se non memorizzato (riconosce la carta già salvata).
  useEffect(() => {
    if (customer || !user?.email) return;
    let cancel = false;
    fetch(`/api/stripe/customer?email=${encodeURIComponent(user.email)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancel && d?.customerId) { setCustomer(d.customerId); try { localStorage.setItem("spigolestay:stripecustomer", d.customerId); } catch {} } })
      .catch(() => {});
    return () => { cancel = true; };
  }, [user?.email, customer]);
  const set = (k: keyof Billing, v: string) => setB((p) => ({ ...p, [k]: v }));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch {} setSaved(true); window.setTimeout(() => setSaved(false), 2000); };

  // Aggiungi/gestisci carta: la carta è gestita da Stripe (non passa dall'app).
  const openPortal = async (cid: string) => {
    const res = await fetch("/api/stripe/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: cid }) });
    return res.json().catch(() => ({} as { url?: string; message?: string; error?: string }));
  };
  const addCard = async () => {
    setNotice("");
    if (!customer) { setNotice(t("Per aggiungere la carta scegli prima un piano: la carta si inserisce al pagamento (gestito da Stripe).")); setTimeout(() => router.push("/abbonamento"), 1400); return; }
    setBusy(true);
    try {
      let d = await openPortal(customer);
      // ID cliente obsoleto (creato in un'altra modalità/account Stripe): azzera, ri-cerca per email, riprova.
      if (!d?.url && /no such customer/i.test(String(d?.message || ""))) {
        try { localStorage.removeItem("spigolestay:stripecustomer"); } catch {}
        setCustomer(null);
        let found: string | null = null;
        if (user?.email) {
          const look = await fetch(`/api/stripe/customer?email=${encodeURIComponent(user.email)}`).then((r) => r.json()).catch(() => ({}));
          if (look?.customerId && look.customerId !== customer) found = look.customerId as string;
        }
        if (found) {
          setCustomer(found); try { localStorage.setItem("spigolestay:stripecustomer", found); } catch {}
          d = await openPortal(found);
        } else {
          setNotice(t("Non risulta ancora un cliente Stripe per questo account: attiva un piano per creare il metodo di pagamento."));
          setTimeout(() => router.push("/abbonamento"), 1600);
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
              <div className="text-[11px] text-faint">{customer ? t("Apri il portale per vedere o cambiare la carta.") : t("Aggiungi una carta per attivare il pagamento automatico dell'abbonamento.")}</div>
            </div>
          </div>
          <button onClick={addCard} disabled={busy} className="mt-3 w-full rounded-lg bg-focus py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">{busy ? t("Attendi…") : (customer ? t("Gestisci carta su Stripe") : `＋ ${t("Aggiungi metodo di pagamento")}`)}</button>
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Metodi accettati")}</div>
            <div className="flex flex-wrap gap-1.5">
              {[t("Carta"), "Apple Pay", "Google Pay", t("Addebito SEPA")].map((m) => (
                <span key={m} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-dim">{m}</span>
              ))}
            </div>
            <div className="mt-1.5 text-[11px] text-faint">{t("Bonifico bancario disponibile solo per il piano annuale, su fattura.")}</div>
          </div>
          {notice && <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 12%, transparent)", color: "var(--dim)" }}>{notice}</div>}
          <div className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] leading-snug" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 9%, transparent)", color: "var(--dim)" }}>
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: "var(--focus)" }}>i</span>
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
            <label className={lbl}>{t("Codice SDI")}<input value={b.sdi} onChange={(e) => set("sdi", e.target.value)} className={`${inp} mt-1`} placeholder={t("Fatt. elettronica")} /></label>
            <label className={lbl}>PEC<input value={b.pec} onChange={(e) => set("pec", e.target.value)} className={`${inp} mt-1`} /></label>
            <label className={lbl}>{t("Email per le fatture")}<input value={b.email} onChange={(e) => set("email", e.target.value)} className={`${inp} mt-1`} placeholder="nome@email.it" /></label>
            <div className="flex items-end">
              <button onClick={save} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{saved ? <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> {t("Salvato")}</> : t("Salva")}</button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
