"use client";

// Sezione "Google Hotel" nella scheda struttura: NON ripete i campi (si compilano qui sopra, nella scheda), mostra solo
//  · cosa manca per comparire su Google, calcolato dai dati della scheda mentre li scrivi;
//  · le foto (l'unico dato che la scheda non aveva): anteprime, "＋ Carica", "Elimina";
//  · l'esito dell'ultimo invio. I dati partono da soli quando si salva la scheda: nessun pulsante da premere.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { apiPost } from "@/lib/invoicing/client";
import { downscaleImage } from "@/lib/images";
import type { Structure } from "@/lib/types";
import { contentChecklist } from "@/lib/channex-content";
import { contentOfStructure, googlePropertyOf, lastGoogleResult, pushStructureContent, type GoogleSyncResult } from "@/lib/google-content-client";

type Photo = { id: string; url: string };
const MAX_PHOTOS = 30;
const noop = () => () => {};
const subscribeResult = (cb: () => void) => { window.addEventListener("spigolestay:google-result", cb); return () => window.removeEventListener("spigolestay:google-result", cb); };

export default function GoogleHotelSection({ structure }: { structure: Structure }) {
  const { roomTypes } = useData();
  const { t } = useLang();
  // Collegamento della struttura (nel browser): senza, la sezione non compare.
  const propertyId = useSyncExternalStore(noop, () => googlePropertyOf(structure.id), () => "");
  // Esito dell'ultimo invio: JSON in stringa perché useSyncExternalStore confronta per valore.
  const lastRaw = useSyncExternalStore(subscribeResult, () => JSON.stringify(lastGoogleResult(structure.id)), () => "null");
  const last: GoogleSyncResult | null = JSON.parse(lastRaw);

  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [photoErr, setPhotoErr] = useState("");
  const [upload, setUpload] = useState<{ done: number; total: number; running: boolean; errors: string[] } | null>(null);
  const [resending, setResending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!propertyId) return;
    let alive = true;
    (async () => {
      try {
        const j = await apiPost<{ photos?: Photo[] }>("channex/property-content", { action: "photos", propertyId });
        if (alive) { setPhotos(j.photos ?? []); setPhotoErr(""); }
      } catch (e) { if (alive) { setPhotos([]); setPhotoErr(e instanceof Error ? e.message : "errore"); } }
    })();
    return () => { alive = false; };
  }, [propertyId]);

  if (!propertyId) return null;

  const missing = [...contentChecklist(contentOfStructure(structure, roomTypes)).filter((c) => !c.ok), ...(photos && photos.length === 0 ? [{ key: "photos", label: "Foto", hint: "Aggiungi almeno una foto qui sotto." }] : [])];
  const reload = async () => {
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
        await apiPost("channex/property-content", { action: "photo", propertyId, dataUrl, description: structure.name });
      } catch (e) { errors.push(`${f.name}: ${e instanceof Error ? e.message : "errore"}`); }
      done++;
      setUpload({ done, total: list.length, running: done < list.length, errors: [...errors] });
    }
    if (fileRef.current) fileRef.current.value = "";
    await reload();
  };
  const removePhoto = async (id: string) => {
    try { await apiPost("channex/property-content", { action: "photo-delete", propertyId, photoId: id }); await reload(); }
    catch (e) { setPhotoErr(e instanceof Error ? e.message : "errore"); }
  };
  const resend = async () => { setResending(true); await pushStructureContent(structure, roomTypes); setResending(false); };

  const okColor = "var(--ok)", warnColor = "var(--warn)";
  const when = last ? new Date(last.at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <Card className="mt-4">
      <SectionTitle>{t("Google Hotel")}</SectionTitle>
      <p className="mb-3 text-xs text-dim">{t("Per comparire su Google servono i dati di questa scheda e almeno una foto. I dati vengono inviati da soli quando salvi la scheda.")}</p>
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
        {missing.length === 0
          ? <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: okColor }}>✓ {t("Tutto pronto per Google")}</span>
          : <><span className="text-dim">{t("Mancano")}:</span>{missing.map((m) => <span key={m.key} title={t(m.hint ?? "")} className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: warnColor }}>{t(m.label)}</span>)}</>}
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Foto")} {photos ? `· ${photos.length}` : ""}</div>
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

      {last && (
        <div className="mt-4 border-t border-line pt-3 text-sm">
          {last.ok
            ? <p style={{ color: okColor }}>✓ {t("Ultimo invio a Google")}: {when}</p>
            : (
              <>
                <p className="font-semibold" style={{ color: warnColor }}>⚠ {t("Ultimo invio")}: {when}</p>
                <ul className="mt-1 space-y-1">
                  {last.problems.map((p, i) => (
                    <li key={i} className="text-txt">{t(p.label)}{p.detail ? <span className="block text-[12px] text-dim">{p.detail}</span> : null}
                      {p.debug ? <details className="mt-0.5"><summary className="cursor-pointer text-[11px] text-faint">{t("Dettagli per l'assistenza")}</summary><code className="mt-1 block break-all text-[11px] text-faint">{p.debug}</code></details> : null}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={resend} disabled={resending} className="mt-2 text-xs font-semibold text-focus underline disabled:opacity-50">{resending ? t("Invio…") : t("Riprova")}</button>
              </>
            )}
        </div>
      )}
    </Card>
  );
}
