"use client";

// Scheda unica "Dati della struttura per Google": tutto ciò che Google Hotel richiede si compila qui e il pulsante Salva li invia da solo.
// Google mostra solo ciò che riceve dal collegamento ai portali: l'utente non deve sapere come, quindi nessun nome del fornitore in vista.
// I campi sono quelli della scheda struttura (si salvano lì); le foto si caricano subito e restano nel collegamento (qui le vedi, le aggiungi e le togli).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { apiPost } from "@/lib/invoicing/client";
import { downscaleImage } from "@/lib/images";
import { AMENITIES, CANCEL_POLICIES, type Structure } from "@/lib/types";
import { contentChecklist, type StructureContent } from "@/lib/channex-content";
import { readChannexMap } from "@/lib/channex-map-sync";

interface Step { key: string; label: string; ok: boolean; detail?: string; debug?: string }
type Policy = "" | "flessibile" | "moderata" | "rigida";
interface Draft {
  description: string; address: string; postalCode: string; city: string; phone: string; lat: string; lng: string;
  services: string[]; checkInFrom: string; checkInTo: string; checkOutBy: string; cancelPolicy: Policy; pets: boolean; smoking: boolean;
}
type Photo = { id: string; url: string };
const MAX_PHOTOS = 30;

const draftOf = (s: Structure): Draft => ({
  description: s.description ?? "", address: s.address ?? "", postalCode: s.postalCode ?? "", city: s.city ?? "", phone: s.phone ?? "",
  lat: typeof s.lat === "number" ? String(s.lat) : "", lng: typeof s.lng === "number" ? String(s.lng) : "",
  services: s.services ?? [], checkInFrom: s.checkInFrom ?? "", checkInTo: s.checkInTo ?? "", checkOutBy: s.checkOutBy ?? "",
  cancelPolicy: s.cancelPolicy ?? "", pets: !!s.pets, smoking: !!s.smoking,
});
const numOf = (v: string): number | undefined => { const n = Number(v.trim().replace(",", ".")); return v.trim() !== "" && Number.isFinite(n) ? n : undefined; };

export default function GoogleContentCard({ structureId, propertyId }: { structureId: string; propertyId: string }) {
  const { structures, roomTypes, updateStructure } = useData();
  const { t } = useLang();
  const st = structures.find((s) => s.id === structureId);
  const [d, setD] = useState<Draft | null>(() => (st ? draftOf(st) : null));
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [photoErr, setPhotoErr] = useState("");
  const [upload, setUpload] = useState<{ done: number; total: number; running: boolean; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Foto già presenti.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const j = await apiPost<{ photos?: Photo[] }>("channex/property-content", { action: "photos", propertyId });
        if (alive) { setPhotos(j.photos ?? []); setPhotoErr(""); }
      } catch (e) { if (alive) { setPhotos([]); setPhotoErr(e instanceof Error ? e.message : "errore"); } }
    })();
    return () => { alive = false; };
  }, [propertyId]);

  if (!st || !d) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((cur) => (cur ? { ...cur, [k]: v } : cur)); setSteps(null); setSaved(false); };
  const maxGuests = Math.max(2, ...roomTypes.filter((r) => r.structureId === structureId).map((r) => r.maxOccupancy ?? r.beds ?? 2));
  const contentOf = (x: Draft): StructureContent => ({
    name: st.name, description: x.description, type: st.type, city: x.city, address: [x.address, st.streetNumber].filter(Boolean).join(" ") || undefined, postalCode: x.postalCode,
    country: st.country, phone: x.phone, email: st.email, lat: numOf(x.lat), lng: numOf(x.lng), services: x.services, checkInFrom: x.checkInFrom || undefined,
    checkInTo: x.checkInTo || undefined, checkOutBy: x.checkOutBy || undefined, smoking: x.smoking, pets: x.pets, minAge: st.minAge,
    cancelPolicy: x.cancelPolicy || undefined, maxGuests, currency: st.currency,
  });
  const checks = contentChecklist(contentOf(d));
  const missing = [...checks.filter((c) => !c.ok).map((c) => c.label), ...(photos && photos.length === 0 ? ["Foto"] : [])];

  // Salva nella scheda struttura e invia: un solo gesto. Se manca ancora qualcosa si salva comunque e si dice cosa.
  const save = async () => {
    setBusy(true); setErr(""); setSteps(null); setSaved(false);
    updateStructure(structureId, {
      description: d.description.trim() || undefined, address: d.address.trim() || undefined, postalCode: d.postalCode.trim() || undefined, city: d.city.trim() || undefined,
      phone: d.phone.trim() || undefined, lat: numOf(d.lat), lng: numOf(d.lng), services: d.services, checkInFrom: d.checkInFrom || undefined, checkInTo: d.checkInTo || undefined,
      checkOutBy: d.checkOutBy || undefined, cancelPolicy: d.cancelPolicy || undefined, pets: d.pets, smoking: d.smoking, updatedAt: Date.now(),
    });
    try {
      const j = await apiPost<{ ok: boolean; steps?: Step[] }>("channex/property-content", { action: "sync", propertyId, content: contentOf(d) });
      setSteps((j.steps ?? []).filter((s) => !s.ok));
      setSaved(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "errore di rete"); }
    setBusy(false);
  };

  const reloadPhotos = async () => {
    try { const j = await apiPost<{ photos?: Photo[] }>("channex/property-content", { action: "photos", propertyId }); setPhotos(j.photos ?? []); setPhotoErr(""); }
    catch (e) { setPhotoErr(e instanceof Error ? e.message : "errore"); }
  };
  const uploadPhotos = async (files: FileList | null) => {
    const room = MAX_PHOTOS - (photos?.length ?? 0);
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (!list.length) { if (files?.length && room <= 0) setPhotoErr(`Massimo ${MAX_PHOTOS} foto.`); return; }
    setUpload({ done: 0, total: list.length, running: true, errors: [] });
    const errors: string[] = [];
    let done = 0;
    for (const f of list) {
      try {
        const dataUrl = await downscaleImage(f, 1600, 0.85); // lato lungo 1600 px: abbastanza per Google, abbastanza leggera da inviare
        await apiPost("channex/property-content", { action: "photo", propertyId, dataUrl, description: st.name });
      } catch (e) { errors.push(`${f.name}: ${e instanceof Error ? e.message : "errore"}`); }
      done++;
      setUpload({ done, total: list.length, running: done < list.length, errors: [...errors] });
    }
    if (fileRef.current) fileRef.current.value = "";
    await reloadPhotos();
  };
  const removePhoto = async (id: string) => {
    try { await apiPost("channex/property-content", { action: "photo-delete", propertyId, photoId: id }); await reloadPhotos(); }
    catch (e) { setPhotoErr(e instanceof Error ? e.message : "errore"); }
  };

  const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";
  const sec = "text-[11px] font-semibold uppercase tracking-wide text-faint";
  const okColor = "var(--ok)", warnColor = "var(--warn)", errColor = "var(--err)";

  return (
    <Card className="mb-5">
      <SectionTitle>{t("Dati della struttura per Google")}</SectionTitle>
      <p className="mb-3 text-xs text-dim">{t("Qui c'è tutto quello che Google Hotel richiede. Compila i campi e carica le foto: con Salva i dati vengono inviati da soli.")}</p>
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
        {missing.length === 0
          ? <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: okColor }}>✓ {t("Tutto pronto")}</span>
          : <><span className="text-dim">{t("Mancano")}:</span>{missing.map((m) => <span key={m} className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: warnColor }}>{t(m)}</span>)}</>}
      </div>

      <div className="space-y-5">
        <div>
          <div className={sec}>{t("Descrizione")}</div>
          <textarea value={d.description} onChange={(e) => set("description", e.target.value)} rows={4} placeholder={t("Racconta la struttura: dove si trova, che camere ha, cosa la rende speciale.")} className={`mt-1 ${inp}`} />
          <div className="mt-0.5 text-[11px] text-faint">{d.description.trim().length} {t("caratteri")} · {t("consigliati almeno 40")}</div>
        </div>

        <div>
          <div className={sec}>{t("Indirizzo e contatti (uguali alla scheda Google Maps)")}</div>
          <div className="mt-1 grid gap-3 sm:grid-cols-3">
            <label className={`${lbl} sm:col-span-2`}>{t("Indirizzo")}<input value={d.address} onChange={(e) => set("address", e.target.value)} className={`mt-1 ${inp}`} /></label>
            <label className={lbl}>{t("CAP")}<input value={d.postalCode} onChange={(e) => set("postalCode", e.target.value)} className={`mt-1 ${inp}`} /></label>
            <label className={lbl}>{t("Città")}<input value={d.city} onChange={(e) => set("city", e.target.value)} className={`mt-1 ${inp}`} /></label>
            <label className={lbl}>{t("Telefono")}<input value={d.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+39…" className={`mt-1 ${inp}`} /></label>
            <span className="hidden sm:block" />
            <label className={lbl}>{t("Latitudine")}<input value={d.lat} onChange={(e) => set("lat", e.target.value)} placeholder="37.0755" inputMode="decimal" className={`mt-1 ${inp} font-mono`} /></label>
            <label className={lbl}>{t("Longitudine")}<input value={d.lng} onChange={(e) => set("lng", e.target.value)} placeholder="15.2866" inputMode="decimal" className={`mt-1 ${inp} font-mono`} /></label>
          </div>
        </div>

        <div>
          <div className={sec}>{t("Servizi")}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {AMENITIES.map((a) => {
              const on = d.services.includes(a);
              return <button key={a} type="button" aria-pressed={on} onClick={() => set("services", on ? d.services.filter((x) => x !== a) : [...d.services, a])} className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${on ? "border-focus bg-focus text-white" : "border-line text-dim hover:bg-wash"}`}>{a}</button>;
            })}
          </div>
        </div>

        <div>
          <div className={sec}>{t("Orari e regole")}</div>
          <div className="mt-1 grid gap-3 sm:grid-cols-3">
            <label className={lbl}>{t("Check-in dalle")}<input type="time" value={d.checkInFrom} onChange={(e) => set("checkInFrom", e.target.value)} className={`mt-1 ${inp}`} /></label>
            <label className={lbl}>{t("Check-in fino alle")}<input type="time" value={d.checkInTo} onChange={(e) => set("checkInTo", e.target.value)} className={`mt-1 ${inp}`} /></label>
            <label className={lbl}>{t("Check-out entro le")}<input type="time" value={d.checkOutBy} onChange={(e) => set("checkOutBy", e.target.value)} className={`mt-1 ${inp}`} /></label>
            <label className={`${lbl} sm:col-span-3`}>{t("Politica di cancellazione")}
              <select value={d.cancelPolicy} onChange={(e) => set("cancelPolicy", e.target.value as Policy)} className={`mt-1 ${inp}`}>
                <option value="">{t("Scegli…")}</option>
                {CANCEL_POLICIES.map((p) => <option key={p.key} value={p.key}>{p.label} — {p.desc}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-txt">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={d.pets} onChange={(e) => set("pets", e.target.checked)} />{t("Animali ammessi")}</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={d.smoking} onChange={(e) => set("smoking", e.target.checked)} />{t("Si può fumare")}</label>
          </div>
        </div>

        <div>
          <div className={sec}>{t("Foto")} {photos ? `· ${photos.length}` : ""}</div>
          <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
            {(photos ?? []).map((p, i) => (
              <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-wash">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">{t("Copertina")}</span>}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" onClick={() => removePhoto(p.id)} className="rounded bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--err)]">{t("Elimina")}</button>
                </div>
              </div>
            ))}
            {(photos?.length ?? 0) < MAX_PHOTOS && (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={!!upload?.running} className="grid aspect-square place-items-center rounded-lg border border-dashed border-line text-faint transition hover:bg-wash hover:text-focus disabled:opacity-50">
                {upload?.running ? <span className="text-xs">{upload.done}/{upload.total}…</span> : <span className="text-center text-xs leading-tight">＋<br />{t("Carica")}</span>}
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void uploadPhotos(e.target.files)} />
          <p className="mt-1 text-[11px] text-faint">{t("Scegli i file originali (almeno 1, meglio 5-10, fino a 30). La prima è la copertina. Si caricano subito.")}</p>
          {photoErr && <p className="mt-1 text-xs" style={{ color: warnColor }}>⚠ {photoErr}</p>}
          {upload && !upload.running && upload.errors.length > 0 && <p className="mt-1 text-xs" style={{ color: warnColor }}>{upload.errors.map((e, i) => <span key={i} className="block">{e}</span>)}</p>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button onClick={save} disabled={busy} className="rounded-lg bg-focus px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{busy ? t("Salvo…") : t("Salva")}</button>
        {saved && !err && (steps?.length ?? 0) === 0 && <span className="text-sm font-semibold" style={{ color: okColor }}>✓ {t("Salvato e inviato a Google")}</span>}
      </div>
      {err && <p className="mt-3 text-sm" style={{ color: errColor }}>⚠ {err}</p>}
      {saved && steps && steps.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold" style={{ color: okColor }}>✓ {t("Salvato")}</p>
          <ul className="mt-1 space-y-1">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 text-xs font-bold" style={{ color: warnColor }}>⚠</span>
                <span className="text-txt">{t(s.label)}{s.detail ? <span className="block text-[12px] text-dim">{s.detail}</span> : null}{s.debug ? <details className="mt-0.5"><summary className="cursor-pointer text-[11px] text-faint">{t("Dettagli per l'assistenza")}</summary><code className="mt-1 block break-all text-[11px] text-faint">{s.debug}</code></details> : null}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// Versione per la scheda di una struttura (Strutture → scheda): legge dal browser il collegamento di quella struttura.
// Se la struttura non è collegata, non mostra nulla.
const subscribe = (cb: () => void) => { window.addEventListener("storage", cb); window.addEventListener("spigolestay:channex-dirty", cb); return () => { window.removeEventListener("storage", cb); window.removeEventListener("spigolestay:channex-dirty", cb); }; };

export function GoogleContentForStructure({ structureId }: { structureId: string }) {
  const propertyId = useSyncExternalStore(subscribe, () => readChannexMap()[structureId]?.propertyId ?? "", () => "");
  if (!propertyId) return null;
  return <GoogleContentCard key={structureId} structureId={structureId} propertyId={propertyId} />;
}
