"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { PageHeader, Card, SectionTitle, Button, Input, Select, Textarea, Alert } from "@/components/ui";
import Toggle from "@/components/Toggle";
import { FORFETTARIO_NOTE } from "@/lib/invoicing/folio";
import { apiPost } from "@/lib/invoicing/client";
import { validateIssuerSettings, hasErrors, normalizeVat, normalizeCf } from "@/lib/invoicing/validate";
import { useTenantId } from "@/lib/tenant";
import { friendlyError } from "@/lib/friendly-error";

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
  const tenantId = useTenantId(); // account di lavoro: per un collaboratore è quello di chi lo ha invitato
  const [s, setS] = useState<Settings>(DEF);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // Credenziali intermediario (token cifrato lato server, mai pre-caricato).
  const [cred, setCred] = useState({ hasToken: false, sandbox: true, signature: false, legalStorage: false });
  const [token, setToken] = useState("");
  const [credBusy, setCredBusy] = useState("");
  const [credMsg, setCredMsg] = useState("");
  // Collegamento Fatture in Cloud (OAuth).
  const [fic, setFic] = useState({ connected: false, configured: true, companyName: "", dryRun: true });
  const [ficBusy, setFicBusy] = useState("");
  const [ficMsg, setFicMsg] = useState("");

  // Si legge la riga dell'account di LAVORO (filtro tenant_id): senza filtro un collaboratore che vede due righe (la propria e quella del titolare) otteneva un errore ignorato e un form vuoto, poi sovrascritto dal Salva.
  const [loadErr, setLoadErr] = useState("");
  // Dipende da "c'è un utente" (booleano), non dall'oggetto user: a ogni ritorno sulla scheda Supabase emette una sessione nuova e l'effetto rileggeva la riga azzerando il form non salvato.
  const hasUser = !!user;
  const loadedFor = useRef("");
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    if (!tenantId) { if (!hasUser) setLoading(false); return; } // un collaboratore aspetta di conoscere l'account di lavoro
    if (loadedFor.current === tenantId) return; // già caricato per questo account: non sovrascrivere il form
    let off = false;
    void Promise.resolve(supabase.from("tenant_invoice_settings").select("*").eq("tenant_id", tenantId).maybeSingle()).then(({ data, error }) => {
      if (off) return;
      if (error) setLoadErr("Impossibile leggere le impostazioni: " + friendlyError(error) + " Il salvataggio è disattivato per non sovrascriverle.");
      else { loadedFor.current = tenantId; if (data) setS({ ...DEF, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)) as Partial<Settings> }); }
      setLoading(false);
    });
    return () => { off = true; };
  }, [tenantId, hasUser]);

  const set = (patch: Partial<Settings>) => { setDirty(true); setS((p) => ({ ...p, ...patch })); };
  const [dirty, setDirty] = useState(false);
  // Controlli sui dati emittente: gli ERRORI (formato) bloccano il salvataggio, gli AVVISI (campi mancanti) no.
  const issues = useMemo(() => validateIssuerSettings(s), [s]);
  const errOf = (field: string) => issues.find((i) => i.field === field && i.level === "error")?.msg;
  const warnOf = (field: string) => issues.find((i) => i.field === field && i.level === "warn")?.msg;
  const canIssue = !!s.denominazione.trim() && !!(s.vat.trim() || s.tax_code.trim());

  // Carica lo stato credenziali quando il provider selezionato le richiede.
  const provNeedsCreds = s.default_provider === "openapi";
  useEffect(() => {
    if (!provNeedsCreds) return;
    apiPost<{ hasToken: boolean; sandbox: boolean; signature: boolean; legalStorage: boolean }>("invoicing/provider", { provider: s.default_provider, action: "status" })
      .then((r) => { setCred({ hasToken: r.hasToken, sandbox: r.sandbox, signature: r.signature, legalStorage: r.legalStorage }); setToken(""); })
      .catch(() => {});
  }, [s.default_provider, provNeedsCreds]);

  // Stato collegamento Fatture in Cloud + messaggi dal callback OAuth (?fic=...).
  const loadFic = () => apiPost<{ connected: boolean; configured: boolean; companyName: string; dryRun: boolean }>("invoicing/provider", { provider: "fattureincloud", action: "status" })
    .then((r) => setFic({ connected: r.connected, configured: r.configured, companyName: r.companyName, dryRun: r.dryRun })).catch(() => {});
  useEffect(() => { if (s.default_provider === "fattureincloud") loadFic(); }, [s.default_provider]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const f = q.get("fic");
    if (!f) return;
    if (f === "connected") setFicMsg(`Fatture in Cloud collegato ✓${q.get("company") ? ` — ${q.get("company")}` : ""}. Modalità prova attiva: verifica un documento su Fatture in Cloud, poi disattiva la prova.`);
    else if (f === "nocompany") setFicMsg("Collegato, ma nessuna azienda trovata sull'account Fatture in Cloud.");
    else if (f === "error") setFicMsg(`Collegamento non riuscito: ${q.get("msg") || "errore"}`);
    setS((p) => ({ ...p, default_provider: "fattureincloud" }));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const connectFic = async () => {
    setFicBusy("connect"); setFicMsg("");
    try { const r = await apiPost<{ url?: string }>("invoicing/fic/start", {}); if (r.url) window.location.href = r.url; }
    catch (e) { setFicMsg(friendlyError(e)); setFicBusy(""); }
  };
  const ficAction = async (action: string, extra: Record<string, unknown> = {}) => {
    setFicBusy(action); setFicMsg("");
    try { const r = await apiPost<{ message?: string }>("invoicing/provider", { provider: "fattureincloud", action, ...extra }); setFicMsg(r.message || "OK"); await loadFic(); }
    catch (e) { setFicMsg(friendlyError(e)); } finally { setFicBusy(""); }
  };

  const saveCred = async () => {
    setCredBusy("save"); setCredMsg("");
    try {
      const r = await apiPost<{ ok: boolean; message?: string }>("invoicing/provider", { provider: s.default_provider, action: "save", token, sandbox: cred.sandbox, signature: cred.signature, legalStorage: cred.legalStorage });
      setCredMsg(r.message || "Salvato ✓"); setToken("");
      const st = await apiPost<{ hasToken: boolean; sandbox: boolean; signature: boolean; legalStorage: boolean }>("invoicing/provider", { provider: s.default_provider, action: "status" });
      setCred({ hasToken: st.hasToken, sandbox: st.sandbox, signature: st.signature, legalStorage: st.legalStorage });
    } catch (e) { setCredMsg(friendlyError(e)); } finally { setCredBusy(""); }
  };
  const testCred = async () => {
    setCredBusy("test"); setCredMsg("");
    try { const r = await apiPost<{ ok: boolean; message?: string }>("invoicing/provider", { provider: s.default_provider, action: "test" }); setCredMsg(r.message || (r.ok ? "OK" : "Errore")); }
    catch (e) { setCredMsg(friendlyError(e)); } finally { setCredBusy(""); }
  };

  const save = async () => {
    if (!supabase || !user) { setMsg("Devi essere connesso."); return; }
    if (!tenantId) { setMsg("Account di lavoro non ancora caricato: riprova tra qualche secondo."); return; }
    if (loadErr) { setMsg(loadErr); return; }
    if (hasErrors(issues)) { setMsg("Correggi i campi segnati in rosso prima di salvare."); return; }
    setSaving(true); setMsg("");
    const regime_note = s.regime === "forfettario" && !s.regime_note.trim() ? FORFETTARIO_NOTE : s.regime_note;
    // Normalizzazione: spazi tolti, P.IVA senza prefisso IT, CF/provincia/codice SDI maiuscoli, PEC minuscola.
    const it = (s.country || "IT").toUpperCase() === "IT";
    const clean: Settings = {
      ...s, denominazione: s.denominazione.trim(), vat: it ? normalizeVat(s.vat) : s.vat.trim(), tax_code: it ? normalizeCf(s.tax_code) : s.tax_code.trim(),
      address: s.address.trim(), city: s.city.trim(), cap: s.cap.trim(), province: s.province.trim().toUpperCase(),
      pec: s.pec.trim().toLowerCase(), sdi: s.sdi.trim().toUpperCase(), regime_note,
    };
    const { error } = await supabase.from("tenant_invoice_settings").upsert({ tenant_id: tenantId, ...clean, updated_at: new Date().toISOString() });
    setSaving(false);
    if (!error) { setS(clean); setDirty(false); }
    setMsg(error ? "Errore: " + friendlyError(error) : "Impostazioni salvate ✓");
  };


  if (loading) return <div className="p-6 text-sm text-faint">Caricamento…</div>;
  // (il messaggio di errore di lettura è sotto, accanto al messaggio di salvataggio)

  return (
    <div>
      <PageHeader title="Impostazioni fattura" subtitle="Regime, dati dell'emittente e servizio di invio"
        actions={<div className="flex flex-wrap items-center gap-2">{dirty && <span className="text-[11px] font-semibold text-[color:var(--warn)]">modifiche non salvate</span>}<Button onClick={save} disabled={!tenantId || !!loadErr} loading={saving}>Salva</Button></div>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Regime fiscale</SectionTitle>
          <Select label="Regime" fieldClassName="mt-2" value={s.regime} onChange={(e) => set({ regime: e.target.value })}>
            <option value="imprenditoriale_ordinario">Imprenditoriale ordinario (IVA per aliquota)</option>
            <option value="forfettario">Forfettario (IVA 0% N2.2, bollo 2€ &gt; 77,47€)</option>
            <option value="non_imprenditoriale">Non imprenditoriale (solo ricevuta, no SDI)</option>
          </Select>
          <p className="mt-2 text-[12px] text-dim">
            {s.regime === "imprenditoriale_ordinario" && "Fatture con IVA (10% pernottamento/pulizia, 22% extra), tassa di soggiorno fuori campo IVA (N1)."}
            {s.regime === "forfettario" && "Fatture senza IVA (natura N2.2), dicitura di legge in calce, bollo virtuale 2€ automatico oltre 77,47€."}
            {s.regime === "non_imprenditoriale" && "Solo ricevuta non fiscale: nessun invio allo SdI."}
          </p>
          <label className="mt-3 flex items-center justify-between"><span className="text-sm text-txt">Bollo automatico (forfettario)</span>
            <Toggle on={s.bollo_auto} onClick={() => set({ bollo_auto: !s.bollo_auto })} /></label>
          <label className="mt-2 flex items-center justify-between"><span className="text-sm text-txt">Arrotonda il totale all'euro</span>
            <Toggle on={s.rounding} onClick={() => set({ rounding: !s.rounding })} /></label>
          {s.regime === "forfettario" && (
            <Textarea label="Dicitura in calce" fieldClassName="mt-3" value={s.regime_note} onChange={(e) => set({ regime_note: e.target.value })} rows={3} placeholder={FORFETTARIO_NOTE} />
          )}
        </Card>

        <Card>
          <SectionTitle>Servizio di invio (SdI)</SectionTitle>
          <Select label="Provider fatturazione elettronica" fieldClassName="mt-2" value={s.default_provider} onChange={(e) => set({ default_provider: e.target.value })}>
            <option value="mock">Test (mock, nessun invio reale)</option>
            <option value="fattureincloud">Fatture in Cloud (consigliato)</option>
            <option value="openapi">Openapi.it (SdI)</option>
          </Select>
          <p className="mt-2 text-[12px] text-dim">
            {s.default_provider === "mock" && "Modalità di prova: i documenti vengono numerati ed 'emessi' ma non trasmessi davvero allo SdI."}
            {s.default_provider === "fattureincloud" && "Le fatture vengono create nel tuo conto Fatture in Cloud, che genera l'XML e le trasmette allo SdI. Collega il tuo account qui sotto."}
            {s.default_provider === "openapi" && "Invio tramite intermediario Openapi.it: Xenora costruisce l'XML FatturaPA e lo trasmette allo SdI. Incolla il token del tuo account Openapi."}
          </p>

          {provNeedsCreds && (
            <div className="mt-3 space-y-2 rounded-lg border border-line bg-wash/50 p-3">
              <Input label="Token API Openapi" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cred.hasToken ? "•••••••• (salvato — lascia vuoto per non cambiarlo)" : "Bearer token del tuo account Openapi"} />
              <label className="flex items-center justify-between"><span className="text-sm text-txt">Ambiente di test (sandbox)</span>
                <Toggle on={cred.sandbox} onClick={() => setCred((c) => ({ ...c, sandbox: !c.sandbox }))} /></label>
              <label className="flex items-center justify-between"><span className="text-sm text-txt">Firma digitale automatica</span>
                <Toggle on={cred.signature} onClick={() => setCred((c) => ({ ...c, signature: !c.signature }))} /></label>
              <label className="flex items-center justify-between"><span className="text-sm text-txt">Conservazione a norma</span>
                <Toggle on={cred.legalStorage} onClick={() => setCred((c) => ({ ...c, legalStorage: !c.legalStorage }))} /></label>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button onClick={saveCred} disabled={!!credBusy && credBusy !== "save"} loading={credBusy === "save"}>Salva credenziali</Button>
                <Button variant="secondary" onClick={testCred} disabled={!!credBusy && credBusy !== "test" || !cred.hasToken} loading={credBusy === "test"}>Test connessione</Button>
                <span className="text-[11px] font-medium" style={{ color: cred.hasToken ? "var(--ok)" : "var(--faint)" }}>{cred.hasToken ? "● token configurato" : "○ token mancante"}</span>
              </div>
              {credMsg && <Alert tone="info">{credMsg}</Alert>}
              <p className="text-[11px] text-faint">Il token è cifrato sul server (AES-256-GCM) e non viene mai ri-mostrato. Usa prima la sandbox per un invio di prova.</p>
            </div>
          )}
          {s.default_provider === "fattureincloud" && (
            <div className="mt-3 space-y-3 rounded-lg border border-line bg-wash/50 p-3">
              {!fic.configured && <Alert tone="warn">Fatture in Cloud non è ancora abilitato sul server (mancano le chiavi FIC_CLIENT_ID/SECRET). Contatta Xenora.</Alert>}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-txt">Collegamento</span>
                <span className="text-[11px] font-medium" style={{ color: fic.connected ? "var(--ok)" : "var(--faint)" }}>{fic.connected ? `● collegato${fic.companyName ? ` — ${fic.companyName}` : ""}` : "○ non collegato"}</span>
              </div>
              {!fic.connected ? (
                <Button onClick={connectFic} disabled={!fic.configured} loading={ficBusy === "connect"}>Collega Fatture in Cloud</Button>
              ) : (
                <>
                  <label className="flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-2">
                    <span className="text-sm text-txt">Modalità prova <span className="text-[11px] text-dim">(crea su Fatture in Cloud senza inviare allo SdI)</span></span>
                    <Toggle on={fic.dryRun} onClick={() => ficAction("dryrun", { dryRun: !fic.dryRun })} />
                  </label>
                  {!fic.dryRun && <Alert tone="warn">Invio reale attivo: le fatture emesse saranno trasmesse allo SdI.</Alert>}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" onClick={() => ficAction("test")} disabled={!!ficBusy && ficBusy !== "test"} loading={ficBusy === "test"}>Verifica collegamento</Button>
                    <Button variant="secondary" className="text-err" onClick={() => ficAction("disconnect")} disabled={!!ficBusy && ficBusy !== "disconnect"} loading={ficBusy === "disconnect"}>Scollega</Button>
                  </div>
                </>
              )}
              {ficMsg && <Alert tone="info">{ficMsg}</Alert>}
              <p className="text-[11px] text-faint">Le fatture vengono create e inviate allo SdI dal tuo conto Fatture in Cloud. I token sono cifrati sul server. Alla prima connessione la modalità prova è attiva per sicurezza.</p>
            </div>
          )}
          <Select label="Lingua PDF predefinita" fieldClassName="mt-3" value={s.default_pdf_lang} onChange={(e) => set({ default_pdf_lang: e.target.value })}>
            <option value="it">Italiano</option><option value="en">English</option>
          </Select>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Dati emittente (in fattura)</SectionTitle>
          <p className="mt-1 text-[11px] text-faint">I dati dell&apos;emittente valgono per tutto l&apos;account (tutte le strutture).</p>
          {!canIssue && <Alert tone="warn" className="mt-2">Per poter emettere documenti servono almeno la denominazione e la Partita IVA (o il codice fiscale).</Alert>}
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Input label="Denominazione / ragione sociale" fieldClassName="sm:col-span-2" value={s.denominazione} onChange={(e) => set({ denominazione: e.target.value })} />
            <Input label="Partita IVA" value={s.vat} onChange={(e) => set({ vat: e.target.value })} error={errOf("vat")} inputMode="numeric" />
            <Input label="Codice fiscale" value={s.tax_code} onChange={(e) => set({ tax_code: e.target.value })} error={errOf("tax_code")} hint={warnOf("tax_code")} />
            <Input label="Indirizzo" fieldClassName="sm:col-span-2" value={s.address} onChange={(e) => set({ address: e.target.value })} />
            <Input label="Città" value={s.city} onChange={(e) => set({ city: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="CAP" value={s.cap} onChange={(e) => set({ cap: e.target.value })} error={errOf("cap")} inputMode="numeric" />
              <Input label="Provincia" value={s.province} onChange={(e) => set({ province: e.target.value })} maxLength={2} placeholder="SR" error={errOf("province")} />
            </div>
            <Input label="PEC" value={s.pec} onChange={(e) => set({ pec: e.target.value })} error={errOf("pec")} />
            <Input label="Codice destinatario / SDI" value={s.sdi} onChange={(e) => set({ sdi: e.target.value })} error={errOf("sdi")} />
            <Input label="Piè di pagina PDF" fieldClassName="sm:col-span-2" value={s.footer_note} onChange={(e) => set({ footer_note: e.target.value })} />
          </div>
          {issues.some((i) => i.level === "warn" && i.field === "address") && <Alert tone="warn" className="mt-2">{issues.find((i) => i.field === "address")?.msg}</Alert>}
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Anteprima intestazione in fattura</SectionTitle>
          <div className="rounded-lg border border-line bg-paper px-4 py-3 text-sm leading-relaxed text-txt">
            <div className="font-semibold">{s.denominazione || <span className="text-faint">Denominazione non impostata</span>}</div>
            {s.vat && <div className="text-dim">P.IVA {s.vat}</div>}
            {s.tax_code && <div className="text-dim">CF {s.tax_code}</div>}
            <div className="text-dim">{[s.address, [s.cap, s.city].filter(Boolean).join(" "), s.province].filter(Boolean).join(", ") || <span className="text-faint">Indirizzo non impostato</span>}</div>
            {s.pec && <div className="text-dim">PEC {s.pec}</div>}
            {s.regime === "forfettario" && <div className="mt-2 border-t border-line pt-2 text-[12px] text-dim">{s.regime_note.trim() || FORFETTARIO_NOTE}</div>}
            {s.footer_note && <div className="mt-1 text-[12px] text-faint">{s.footer_note}</div>}
          </div>
        </Card>
      </div>
      {loadErr && <Alert tone="err" className="mt-3">{loadErr}</Alert>}
      {msg && <Alert tone={msg.startsWith("Impostazioni salvate") ? "ok" : "err"} className="mt-3">{msg}</Alert>}
    </div>
  );
}
