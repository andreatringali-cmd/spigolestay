"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import type { Structure, ExtraService } from "@/lib/types";
import { STRUCTURE_TYPES, AMENITIES, PAY_METHODS, CANCEL_POLICIES, DEFAULT_EXTRAS } from "@/lib/types";
import { USER_LANGS, AV_COLORS } from "@/lib/users";
import { eur } from "@/lib/format";
import { downscaleImage } from "@/lib/images";
import { useLang } from "@/lib/i18n";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useAccess } from "@/lib/access";

function Toggle({ on, onClick, color = "var(--focus)" }: { on: boolean; onClick?: () => void; color?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? color : "var(--line)" }}>
      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} />
    </button>
  );
}
function Info({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] leading-snug" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 9%, transparent)", color: "var(--dim)" }}>
      <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: "var(--focus)" }}>i</span>
      <span>{children}</span>
    </div>
  );
}
const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";

const blankStructure = (): Structure => ({ id: "", name: "", groupName: "", city: "Siracusa", province: "SR", region: "Sicilia", country: "Italia", active: true, type: "B&B", photoColor: AV_COLORS[1], services: [], payMethods: ["Contanti", "Carta / POS"], currency: "EUR", language: "it", cancelPolicy: "moderata", checkInFrom: "15:00", checkInTo: "20:00", checkOutBy: "10:30", cityTax: true, cityTaxAmount: 2, cityTaxMaxNights: 4, cityTaxComune: "Siracusa" });

export default function StrutturaSchedaPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = params.id === "nuovo";
  const { structures, roomTypes, units, addStructure, updateStructure, setActiveStructure } = useData();
  const { t } = useLang();
  const { moduleOn, user } = useAccess();
  const hasGuide = moduleOn("concierge"); // Guida ospiti personalizzata = modulo Web Concierge
  const openGuide = () => { if (!existing) return; setActiveStructure(existing.id); router.push("/guida-ospiti"); };

  const existing = structures.find((s) => s.id === params.id);
  const [f, setF] = useState<Structure>(() => (isNew ? blankStructure() : { ...blankStructure(), ...existing }));
  const set = <K extends keyof Structure>(k: K, v: Structure[K]) => setF((p) => ({ ...p, [k]: v }));
  const num = (v: string) => (v === "" ? undefined : Number(v.replace(",", ".")));

  // Precompila i contatti dall'account (dati della registrazione) quando la struttura non li ha ancora.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (isNew || prefilledRef.current || !user) return;
    prefilledRef.current = true;
    setF((p) => {
      const next = { ...p };
      if (!next.email && user.email) next.email = user.email;
      if (!next.phone && user.phone) next.phone = user.phone;
      return next;
    });
  }, [isNew, user]);

  const groups = Array.from(new Set(structures.map((s) => s.groupName)));
  const toggleArr = (k: "services" | "payMethods", x: string) => setF((p) => { const cur = p[k] ?? []; return { ...p, [k]: cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x] }; });

  const exUid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : `e${Math.floor(performance.now())}`);
  const addExtra = () => setF((p) => ({ ...p, extras: [...(p.extras ?? []), { id: exUid(), name: "", price: 0, per: "stay" as ExtraService["per"] }] }));
  const updExtra = (i: number, patch: Partial<ExtraService>) => setF((p) => ({ ...p, extras: (p.extras ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const delExtra = (i: number) => setF((p) => ({ ...p, extras: (p.extras ?? []).filter((_, j) => j !== i) }));

  const nCamere = units.filter((u) => u.structureId === params.id).length;
  const nTipologie = roomTypes.filter((rt) => rt.structureId === params.id).length;

  const errs: string[] = [];
  if (!f.name.trim()) errs.push(t("Nome"));
  const valid = errs.length === 0;

  const save = () => {
    if (!valid) return;
    const patch: Partial<Structure> = { ...f };
    delete (patch as { id?: string }).id;
    if (isNew) { const sid = addStructure({ name: f.name.trim(), groupName: (f.groupName || f.name).trim(), city: f.city, address: f.address }); updateStructure(sid, patch); }
    else updateStructure(params.id, patch);
    router.push("/strutture");
  };

  // Salvataggio automatico ogni 10s (solo su struttura esistente): non si perde nulla di quanto digitato.
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);
  const fRef = useRef(f); fRef.current = f;
  const updRef = useRef(updateStructure); updRef.current = updateStructure;
  const savedJson = useRef<string | null>(null);
  useEffect(() => { savedJson.current = JSON.stringify(f); /* baseline al montaggio */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (isNew) return;
    const id = window.setInterval(() => {
      const cur = JSON.stringify(fRef.current);
      if (savedJson.current !== null && cur !== savedJson.current && fRef.current.name?.trim()) {
        const patch: Partial<Structure> = { ...fRef.current };
        delete (patch as { id?: string }).id;
        updRef.current(params.id, patch);
        savedJson.current = cur;
        setAutoSavedAt(Date.now());
      }
    }, 10000);
    return () => window.clearInterval(id);
  }, [isNew, params.id]);

  const mapsUrl = f.lat && f.lng ? `https://www.google.com/maps?q=${f.lat},${f.lng}` : f.address ? `https://www.google.com/maps/search/${encodeURIComponent(`${f.address} ${f.city ?? ""}`)}` : null;
  // Anteprima mappa (embed Google Maps, senza API key).
  const mapEmbed = f.lat && f.lng
    ? `https://maps.google.com/maps?q=${f.lat},${f.lng}&z=15&output=embed`
    : (f.address ? `https://maps.google.com/maps?q=${encodeURIComponent(`${f.address} ${f.city ?? ""} ${f.province ?? ""}`)}&z=14&output=embed` : null);
  // Geocoding gratuito via OpenStreetMap/Nominatim (CORS abilitato, nessuna API key).
  const [geoBusy, setGeoBusy] = useState(false);
  // Indirizzo inserito → latitudine/longitudine (+ link Maps automatico dai coordinati).
  const geocode = async () => {
    const query = [f.address, f.streetNumber, f.postalCode, f.city, f.province, f.country || "Italia"].filter(Boolean).join(", ");
    if (!query.trim()) { alert(t("Inserisci prima l'indirizzo.")); return; }
    setGeoBusy(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
      const data = await res.json();
      if (Array.isArray(data) && data[0]) setF((p) => ({ ...p, lat: Number(Number(data[0].lat).toFixed(6)), lng: Number(Number(data[0].lon).toFixed(6)) }));
      else alert(t("Indirizzo non trovato. Controlla i campi o incolla un link di Maps."));
    } catch { alert(t("Ricerca posizione non riuscita. Riprova tra poco.")); }
    setGeoBusy(false);
  };
  // Coordinate → indirizzo (compila i campi mancanti dal punto sulla mappa).
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { Accept: "application/json" } });
      const d = await res.json(); const a = d?.address; if (!a) return;
      setF((p) => ({
        ...p,
        address: [a.road, a.pedestrian, a.suburb].find(Boolean) ?? p.address,
        streetNumber: a.house_number ?? p.streetNumber,
        postalCode: a.postcode ?? p.postalCode,
        city: [a.city, a.town, a.village, a.municipality].find(Boolean) ?? p.city,
        region: a.state ?? p.region,
        country: a.country ?? p.country,
      }));
    } catch { /* i coordinati restano comunque impostati */ }
  };
  // Incolla un link di Google Maps (o coppia di coordinate) → estrae lat/lng e compila l'indirizzo.
  const parseMapsLink = (url: string) => {
    const m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
    if (m) { const lat = Number(m[1]), lng = Number(m[2]); setF((p) => ({ ...p, lat, lng })); reverseGeocode(lat, lng); }
  };

  // Servizi personalizzati: si aggiungono alla lista e restano selezionati.
  const [newSvc, setNewSvc] = useState("");
  const addSvc = () => { const v = newSvc.trim(); if (!v) return; if (!(f.services ?? []).includes(v)) set("services", [...(f.services ?? []), v]); setNewSvc(""); };

  // Logo struttura (ridimensionato a dataURL, salvato sulla struttura).
  const logoRef = useRef<HTMLInputElement>(null);
  const onLogoFile = async (file?: File) => { if (!file || !file.type.startsWith("image/")) return; try { set("logo", await downscaleImage(file, 260, 0.82)); } catch {} };

  return (
    <div>
      <PageHeader
        title={isNew ? t("Nuova struttura") : t("Scheda struttura")}
        subtitle={isNew ? t("Crea una nuova struttura") : `${f.name} · ${f.city ?? ""}${nCamere ? ` · ${nCamere} ${t("camere")}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {!isNew && <Link href="/camere" className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">{t("Camere")} ({nCamere})</Link>}
            {!isNew && autoSavedAt && <span className="flex items-center gap-1 text-xs font-medium text-[color:var(--ok)]" title={t("Le modifiche vengono salvate da sole")}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>{t("Salvato in automatico")}</span>}
            <button onClick={() => router.push("/strutture")} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash">{t("Annulla")}</button>
            <button onClick={save} disabled={!valid} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{isNew ? t("Crea struttura") : t("Salva")}</button>
          </div>
        }
      />

      {!valid && <div className="mb-4 rounded-lg border border-[color:var(--warn)] bg-[color:color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-xs text-dim">{t("Per salvare completa:")} <b className="text-txt">{errs.join(", ")}</b>.</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- Colonna sinistra ---- */}
        <div className="flex flex-col gap-4">
          {/* Dati generali */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle>{t("Dati generali")}</SectionTitle>
              <div className="flex items-center gap-2"><span className="text-xs text-dim">{t("Attiva")}</span><Toggle on={f.active !== false} onClick={() => set("active", f.active === false)} color="var(--ok)" /></div>
            </div>
            {/* Logo cliccabile (fallback: iniziali sul colore identità) — usato su preventivi e PDF */}
            <div className="mb-3 flex items-center gap-3.5">
              <button
                type="button"
                onClick={() => logoRef.current?.click()}
                title={f.logo ? t("Cambia logo") : t("Carica il logo")}
                className="group relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line shadow-sm transition hover:shadow-md"
                style={f.logo ? { background: "#fff" } : { backgroundColor: f.photoColor ?? AV_COLORS[1] }}
              >
                {f.logo
                  ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={f.logo} alt="Logo" className="h-full w-full object-contain p-1.5" />)
                  : <span className="text-xl font-bold text-white">{(f.name || "?").slice(0, 2).toUpperCase()}</span>}
                <span className="absolute inset-0 hidden place-items-center bg-black/45 text-[10px] font-semibold uppercase tracking-wide text-white group-hover:grid">{f.logo ? t("Cambia") : t("＋ Logo")}</span>
              </button>
              <div className="min-w-0">
                <div className="text-xs font-medium text-txt">{t("Logo della struttura")}</div>
                <div className="text-[11px] text-faint">{t("Clicca il riquadro per caricarlo. Compare sui preventivi e sul PDF.")}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-faint">{t("Colore identità:")}</span>
                  <div className="flex gap-1.5">{AV_COLORS.map((c) => <button key={c} type="button" onClick={() => set("photoColor", c)} className={`h-4 w-4 rounded-full border-2 ${f.photoColor === c ? "border-txt" : "border-transparent"}`} style={{ backgroundColor: c }} />)}</div>
                  <label className="flex cursor-pointer items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-dim hover:bg-wash" title={t("Scegli un colore personalizzato")}>
                    <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ backgroundColor: f.photoColor ?? AV_COLORS[1] }} />
                    {t("Personalizzato")}
                    <input type="color" value={f.photoColor ?? AV_COLORS[1]} onChange={(e) => set("photoColor", e.target.value)} className="h-0 w-0 opacity-0" />
                  </label>
                  {f.logo && <button type="button" onClick={() => set("logo", undefined)} className="ml-1 text-[11px] text-[color:var(--err)] hover:underline">{t("Rimuovi logo")}</button>}
                </div>
                <div className="mt-0.5 text-[11px] text-faint">{t("Usato per distinguere la struttura in Dashboard e liste.")}</div>
              </div>
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => onLogoFile(e.target.files?.[0])} />
            </div>
            <label className={lbl}>{t("Nome struttura")} *<input value={f.name} onChange={(e) => set("name", e.target.value)} className={`${inp} mt-1`} placeholder={t("Es. Spigole House")} /></label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className={lbl}>{t("Tipo")}<select value={f.type ?? ""} onChange={(e) => set("type", e.target.value)} className={`${inp} mt-1`}>{STRUCTURE_TYPES.map((st) => <option key={st} value={st}>{t(st)}</option>)}</select></label>
              <label className={lbl}>{t("Gruppo / Network")}<input value={f.groupName} onChange={(e) => set("groupName", e.target.value)} list="grp" className={`${inp} mt-1`} placeholder={t("Es. Spigole")} /><datalist id="grp">{groups.map((g) => <option key={g} value={g} />)}</datalist></label>
            </div>
            <label className={`${lbl} mt-3`}>{t("Descrizione")}<textarea value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={3} className={`${inp} mt-1 resize-y`} placeholder={t("Breve descrizione per il sito e il motore di prenotazione…")} /></label>
          </Card>

          {/* Contatti */}
          <Card>
            <SectionTitle>{t("Contatti")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <label className={lbl}>{t("Email")}<input value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} className={`${inp} mt-1`} placeholder="info@…" /><span className="mt-1 block text-[11px] text-faint">{t("Email di contatto della struttura (precompilata dall'account, modificabile).")}</span></label>
              <label className={lbl}>{t("Telefono")}<input value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className={`${inp} mt-1`} placeholder="+39…" /></label>
              <label className={lbl}>WhatsApp<input value={f.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)} className={`${inp} mt-1`} placeholder="+39…" /></label>
              <label className={lbl}>{t("Telefono 2")}<input value={f.phone2 ?? ""} onChange={(e) => set("phone2", e.target.value)} className={`${inp} mt-1`} placeholder="+39…" /></label>
              <label className={lbl}>{t("Sito web")}<input value={f.website ?? ""} onChange={(e) => set("website", e.target.value)} className={`${inp} mt-1`} placeholder="www.…" /></label>
              <label className={lbl}>{t("Referente")}<input value={f.contactName ?? ""} onChange={(e) => set("contactName", e.target.value)} className={`${inp} mt-1`} placeholder={t("Nome e cognome")} /></label>
            </div>
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Social")} <span className="font-normal normal-case text-faint">{t("(compaiono sul piè di pagina del preventivo)")}</span></div>
            <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className={lbl}>Facebook<input value={f.facebook ?? ""} onChange={(e) => set("facebook", e.target.value)} className={`${inp} mt-1`} placeholder="facebook.com/…" /></label>
              <label className={lbl}>Instagram<input value={f.instagram ?? ""} onChange={(e) => set("instagram", e.target.value)} className={`${inp} mt-1`} placeholder="instagram.com/…" /></label>
              <label className={lbl}>LinkedIn<input value={f.linkedin ?? ""} onChange={(e) => set("linkedin", e.target.value)} className={`${inp} mt-1`} placeholder="linkedin.com/…" /></label>
            </div>
          </Card>

          {/* Indirizzo */}
          <Card>
            <div className="mb-3">
              <SectionTitle>{t("Indirizzo & posizione")}</SectionTitle>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className={`${lbl} col-span-2`}>{t("Indirizzo")}<input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} className={`${inp} mt-1`} placeholder={t("Via / Piazza")} /></label>
              <label className={lbl}>{t("Civico")}<input value={f.streetNumber ?? ""} onChange={(e) => set("streetNumber", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("CAP")}<input value={f.postalCode ?? ""} onChange={(e) => set("postalCode", e.target.value)} className={`${inp} mt-1`} placeholder="96100" /></label>
              <label className={lbl}>{t("Città")}<input value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Provincia")}<input value={f.province ?? ""} onChange={(e) => set("province", e.target.value)} className={`${inp} mt-1`} placeholder="SR" /></label>
              <label className={lbl}>{t("Regione")}<input value={f.region ?? ""} onChange={(e) => set("region", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Nazione")}<input value={f.country ?? ""} onChange={(e) => set("country", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Zona")}<input value={f.zone ?? ""} onChange={(e) => set("zone", e.target.value)} className={`${inp} mt-1`} placeholder={t("Es. Ortigia")} /></label>
              <label className={lbl}>{t("Latitudine")}<input value={f.lat ?? ""} onChange={(e) => set("lat", num(e.target.value))} className={`${inp} mt-1`} placeholder="37.06" /></label>
              <label className={lbl}>{t("Longitudine")}<input value={f.lng ?? ""} onChange={(e) => set("lng", num(e.target.value))} className={`${inp} mt-1`} placeholder="15.29" /></label>
              <div className="flex items-end">
                <button type="button" onClick={geocode} disabled={geoBusy} title={t("Ricava latitudine e longitudine dall'indirizzo")} className="w-full rounded-lg border border-line px-2 py-2 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50">{geoBusy ? `📍 ${t("Cerco…")}` : `📍 ${t("Ricava coordinate")}`}</button>
              </div>
            </div>
            <label className={`${lbl} mt-3`}>{t("Incolla un link di Google Maps")} <span className="font-normal text-faint">{t("(imposta posizione e indirizzo automaticamente)")}</span>
              <input onChange={(e) => parseMapsLink(e.target.value)} className={`${inp} mt-1`} placeholder={`https://maps.google.com/…  ${t("oppure")}  37.0601, 15.2934`} />
            </label>
            {mapsUrl && (
              <label className={`${lbl} mt-3`}>{t("Link Google Maps")} <span className="font-normal text-faint">{t("(generato automaticamente)")}</span>
                <div className="mt-1 flex gap-2">
                  <input value={mapsUrl} readOnly className={`${inp} font-mono text-xs`} />
                  <button type="button" onClick={() => navigator.clipboard?.writeText(mapsUrl)} className="shrink-0 rounded-lg border border-line px-3 text-xs font-medium text-dim hover:bg-wash">{t("Copia")}</button>
                </div>
              </label>
            )}
            {/* Anteprima mappa */}
            <div className="mt-3 overflow-hidden rounded-lg border border-line" style={{ height: 220 }}>
              {mapEmbed
                ? <iframe title={t("Mappa struttura")} src={mapEmbed} width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                : <div className="grid h-full place-items-center text-center text-xs text-faint">{t("Inserisci indirizzo o coordinate")}<br />{t("per vedere la posizione sulla mappa")}</div>}
            </div>
          </Card>

          {/* Servizi */}
          <Card>
            <SectionTitle>{t("Servizi & dotazioni")}</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(new Set([...AMENITIES, ...(f.services ?? [])])).map((a) => { const on = (f.services ?? []).includes(a); const custom = !AMENITIES.includes(a); return (
                <button key={a} onClick={() => toggleArr("services", a)} title={custom ? t("Servizio personalizzato · clicca per rimuoverlo") : undefined} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(a)}{custom && on ? " ✕" : ""}</button>
              ); })}
            </div>
            <div className="mt-3 flex gap-2">
              <input value={newSvc} onChange={(e) => setNewSvc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSvc(); } }} placeholder={t("Aggiungi un servizio…")} className={inp} />
              <button type="button" onClick={addSvc} disabled={!newSvc.trim()} className="shrink-0 rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Aggiungi")}</button>
            </div>
          </Card>
        </div>

        {/* ---- Colonna destra ---- */}
        <div className="flex flex-col gap-4">
          {/* Autorizzazioni & fisco */}
          <Card>
            <SectionTitle>{t("Autorizzazioni & dati fiscali")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <label className={lbl}>CIN <span className="text-faint">{t("(nazionale)")}</span><input value={f.cin ?? ""} onChange={(e) => set("cin", e.target.value)} className={`${inp} mt-1`} placeholder="IT0891…" /></label>
              <label className={lbl}>CIR <span className="text-faint">{t("(regionale)")}</span><input value={f.cir ?? ""} onChange={(e) => set("cir", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Codice ISTAT")}<input value={f.istat ?? ""} onChange={(e) => set("istat", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Utente Alloggiati Web")}<input value={f.alloggiatiUser ?? ""} onChange={(e) => set("alloggiatiUser", e.target.value)} className={`${inp} mt-1`} placeholder={t("ID portale Questura")} /></label>
            </div>
            {!f.cin && <Info>{t("Il")} <b>CIN</b> {t("(Codice Identificativo Nazionale) è obbligatorio per pubblicare gli annunci: inseriscilo appena disponibile.")}</Info>}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className={`${lbl} col-span-2`}>{t("Ragione sociale")}<input value={f.businessName ?? ""} onChange={(e) => set("businessName", e.target.value)} className={`${inp} mt-1`} placeholder={t("Intestazione per fatture")} /></label>
              <label className={lbl}>{t("Partita IVA")}<input value={f.vat ?? ""} onChange={(e) => set("vat", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Codice fiscale")}<input value={f.taxCode ?? ""} onChange={(e) => set("taxCode", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Codice SDI")}<input value={f.sdi ?? ""} onChange={(e) => set("sdi", e.target.value)} className={`${inp} mt-1`} placeholder={t("Fatt. elettronica")} /></label>
              <label className={lbl}>PEC<input value={f.pec ?? ""} onChange={(e) => set("pec", e.target.value)} className={`${inp} mt-1`} /></label>
            </div>
          </Card>

          {/* Check-in / out */}
          <Card>
            <SectionTitle>{t("Check-in & check-out")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className={lbl}>{t("Check-in dalle")}<input type="time" value={f.checkInFrom ?? ""} onChange={(e) => set("checkInFrom", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("alle")}<input type="time" value={f.checkInTo ?? ""} onChange={(e) => set("checkInTo", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Check-out entro")}<input type="time" value={f.checkOutBy ?? ""} onChange={(e) => set("checkOutBy", e.target.value)} className={`${inp} mt-1`} /></label>
            </div>
            <div className="mt-3 flex items-center justify-between py-1"><span className="text-sm text-txt">{t("Self check-in (accesso autonomo)")}</span><Toggle on={!!f.selfCheckin} onClick={() => set("selfCheckin", !f.selfCheckin)} /></div>
            <label className={`${lbl} mt-2`}>{t("Istruzioni / codici di accesso")}<textarea value={f.accessInfo ?? ""} onChange={(e) => set("accessInfo", e.target.value)} rows={2} className={`${inp} mt-1 resize-y`} placeholder={t("Es. keybox codice, citofono, piano…")} /></label>

            {/* Guida ospiti personalizzata (servizio a piano) */}
            {hasGuide ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-txt">{t("Guida ospiti personalizzata")}</div>
                  <div className="text-[11px] text-dim">{t("Pagina web con Wi-Fi, codici, istruzioni e consigli, pronta da inviare all'ospite.")}</div>
                </div>
                <button type="button" onClick={openGuide} disabled={!existing} title={!existing ? t("Salva prima la struttura") : undefined} className="shrink-0 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Apri la guida")} →</button>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "color-mix(in srgb, var(--focus) 35%, var(--line))", backgroundColor: "color-mix(in srgb, var(--focus) 6%, transparent)" }}>
                <div className="flex items-center gap-2 text-sm font-semibold text-txt">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-focus text-white"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg></span>
                  {t("Guida ospiti personalizzata")}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-dim">{t("Crea una pagina web elegante con Wi-Fi, codici di accesso, istruzioni e consigli, da inviare a ogni ospite. È un servizio incluso nei piani Pro e Ultimate, oppure aggiungibile al tuo piano.")}</p>
                <button type="button" onClick={() => router.push("/abbonamento")} className="mt-2.5 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Aggiungi il servizio")} →</button>
              </div>
            )}
          </Card>

          {/* Tassa di soggiorno */}
          <Card>
            <div className="mb-2 flex items-center justify-between"><SectionTitle>{t("Tassa di soggiorno")}</SectionTitle><Toggle on={!!f.cityTax} onClick={() => set("cityTax", !f.cityTax)} /></div>
            {f.cityTax && (() => {
              const mode = f.cityTaxMode ?? "fixed";
              return (
                <>
                  <div className="mb-3 inline-flex rounded-lg border border-line bg-paper p-0.5 text-xs font-semibold">
                    <button type="button" onClick={() => set("cityTaxMode", "fixed")} className={`rounded-md px-3 py-1.5 transition ${mode === "fixed" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{t("Fisso (€ persona/notte)")}</button>
                    <button type="button" onClick={() => set("cityTaxMode", "percent")} className={`rounded-md px-3 py-1.5 transition ${mode === "percent" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{t("% del totale")}</button>
                  </div>
                  {mode === "percent" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <label className={lbl}>{t("% sul totale soggiorno")}<div className="relative mt-1"><input type="number" min={0} step={0.5} value={f.cityTaxPercent ?? ""} onChange={(e) => set("cityTaxPercent", num(e.target.value))} className={`${inp} pr-7`} placeholder="10" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-faint">%</span></div></label>
                      <label className={lbl}>{t("Comune")}<input value={f.cityTaxComune ?? ""} onChange={(e) => set("cityTaxComune", e.target.value)} className={`${inp} mt-1`} /></label>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <label className={lbl}>{t("€ persona/notte")}<input value={f.cityTaxAmount ?? ""} onChange={(e) => set("cityTaxAmount", num(e.target.value))} className={`${inp} mt-1`} placeholder="2,00" /></label>
                      <label className={lbl}>{t("Max notti")}<input type="number" min={0} value={f.cityTaxMaxNights ?? ""} onChange={(e) => set("cityTaxMaxNights", num(e.target.value))} className={`${inp} mt-1`} /></label>
                      <label className={lbl}>{t("Comune")}<input value={f.cityTaxComune ?? ""} onChange={(e) => set("cityTaxComune", e.target.value)} className={`${inp} mt-1`} /></label>
                    </div>
                  )}
                </>
              );
            })()}
          </Card>

          {/* Policy & regole */}
          <Card>
            <SectionTitle>{t("Policy & regole")}</SectionTitle>
            <div className="mb-1 text-xs text-dim">{t("Politica di cancellazione")}</div>
            <div className="flex flex-col gap-1.5">
              {CANCEL_POLICIES.map((p) => (
                <button key={p.key} onClick={() => set("cancelPolicy", p.key)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${f.cancelPolicy === p.key ? "border-focus ring-1 ring-[color:var(--focus)]" : "border-line hover:bg-wash"}`}>
                  <span className={`grid h-4 w-4 place-items-center rounded-full border ${f.cancelPolicy === p.key ? "border-focus" : "border-line"}`}>{f.cancelPolicy === p.key && <span className="h-2 w-2 rounded-full bg-focus" />}</span>
                  <span><span className="text-sm font-medium text-txt">{t(p.label)}</span> <span className="text-[11px] text-faint">— {t(p.desc)}</span></span>
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className={lbl}>{t("Cauzione €")}<input value={f.deposit ?? ""} onChange={(e) => set("deposit", num(e.target.value))} className={`${inp} mt-1`} placeholder="0" /></label>
              <label className={lbl}>{t("Età minima check-in")}<input type="number" min={0} value={f.minAge ?? ""} onChange={(e) => set("minAge", num(e.target.value))} className={`${inp} mt-1`} placeholder="18" /></label>
              <label className={lbl}>{t("Silenzio dalle")}<input type="time" value={f.quietFrom ?? ""} onChange={(e) => set("quietFrom", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("alle")}<input type="time" value={f.quietTo ?? ""} onChange={(e) => set("quietTo", e.target.value)} className={`${inp} mt-1`} /></label>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <div className="flex items-center justify-between py-1"><span className="text-sm text-txt">{t("Animali ammessi")}</span><Toggle on={!!f.pets} onClick={() => set("pets", !f.pets)} /></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-txt">{t("Fumatori")}</span><Toggle on={!!f.smoking} onClick={() => set("smoking", !f.smoking)} /></div>
            </div>
          </Card>

          {/* Pagamenti */}
          <Card>
            <SectionTitle>{t("Pagamenti & incassi")}</SectionTitle>
            <div className="mb-1 text-xs text-dim">{t("Metodi accettati")}</div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {PAY_METHODS.map((m) => <button key={m} onClick={() => toggleArr("payMethods", m)} className={`rounded-full border px-2.5 py-1 text-xs transition ${(f.payMethods ?? []).includes(m) ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(m)}</button>)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className={`${lbl} col-span-2`}>IBAN<input value={f.iban ?? ""} onChange={(e) => set("iban", e.target.value)} className={`${inp} mt-1 font-mono`} placeholder="IT00 X000 0000 0000 0000 0000 000" /></label>
              <label className={lbl}>{t("Intestatario")}<input value={f.ibanHolder ?? ""} onChange={(e) => set("ibanHolder", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Valuta")}<select value={f.currency ?? "EUR"} onChange={(e) => set("currency", e.target.value)} className={`${inp} mt-1`}><option value="EUR">{t("€ Euro")}</option><option value="USD">{t("$ Dollaro")}</option><option value="GBP">{t("£ Sterlina")}</option></select></label>
              <label className={`${lbl} col-span-2`}>{t("Lingua predefinita")}<select value={f.language ?? "it"} onChange={(e) => set("language", e.target.value)} className={`${inp} mt-1`}>{USER_LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}</select></label>
            </div>
          </Card>

          {/* Booking Engine & servizi extra */}
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle>{t("Motore prenotazioni & servizi extra")}</SectionTitle>
              {!isNew && <a href={`/prenota?s=${params.id}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-focus hover:underline">{t("Apri motore")} ↗</a>}
            </div>
            <div className="mb-2 flex items-center justify-between">
              <label className={lbl}>{t("Acconto richiesto alla prenotazione diretta")}</label>
              <span className="flex items-center gap-1"><input type="number" min={0} max={100} value={f.depositPct ?? 30} onChange={(e) => set("depositPct", num(e.target.value))} className={`${inp} w-20`} /><span className="text-dim">%</span></span>
            </div>
            <div className="mb-2 mt-3 flex items-center justify-between">
              <div className="text-xs font-medium text-dim">{t("Servizi extra (upsell)")}</div>
              <div className="flex gap-2">
                {(f.extras ?? []).length === 0 && <button onClick={() => set("extras", DEFAULT_EXTRAS)} className="rounded-md border border-line px-2 py-1 text-xs text-dim hover:bg-wash">{t("Carica esempi")}</button>}
                <button onClick={addExtra} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-focus hover:bg-wash">＋ {t("Servizio")}</button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {(f.extras ?? []).map((x, i) => (
                <div key={x.id} className="rounded-lg border border-line p-2">
                  <div className="flex items-center gap-2">
                    <input value={x.name} onChange={(e) => updExtra(i, { name: e.target.value })} placeholder={t("Nome servizio")} className={`${inp} min-w-0 flex-1`} />
                    <input type="number" min={0} value={x.price} onChange={(e) => updExtra(i, { price: Number(e.target.value) })} className={`${inp} w-20`} />
                    <select value={x.per} onChange={(e) => updExtra(i, { per: e.target.value as ExtraService["per"] })} className={inp}><option value="stay">{t("/soggiorno")}</option><option value="night">{t("/notte")}</option><option value="person">{t("/persona")}</option></select>
                    <button onClick={() => delExtra(i)} className="rounded p-1 text-faint hover:text-[color:var(--err)]">✕</button>
                  </div>
                  <input value={x.desc ?? ""} onChange={(e) => updExtra(i, { desc: e.target.value })} placeholder={t("Descrizione (facoltativa)")} className={`${inp} mt-2 w-full text-xs`} />
                </div>
              ))}
              {(f.extras ?? []).length === 0 && <p className="text-xs text-faint">{t("Nessun servizio extra. Verranno usati quelli predefiniti nel motore di prenotazione.")}</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
