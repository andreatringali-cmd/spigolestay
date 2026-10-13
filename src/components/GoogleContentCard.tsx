"use client";

// Dati della struttura per Google Hotel: Xenora li invia a Channex (descrizione, servizi, politica della struttura, posizione) e carica le foto.
// Google non ha un pannello come le OTA: tutto ciò che mostra viene da Channex, e Channex lo riceve da qui. Si compila una volta in Strutture.
import { useRef, useState } from "react";
import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { apiPost } from "@/lib/invoicing/client";
import { downscaleImage } from "@/lib/images";
import { contentChecklist, type StructureContent } from "@/lib/channex-content";

interface Step { key: string; label: string; ok: boolean; detail?: string }

export default function GoogleContentCard({ structureId, propertyId }: { structureId: string; propertyId: string }) {
  const { structures, roomTypes } = useData();
  const { t } = useLang();
  const st = structures.find((s) => s.id === structureId);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [err, setErr] = useState("");
  const [photo, setPhoto] = useState<{ done: number; total: number; errors: string[]; running: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!st) return null;

  const maxGuests = Math.max(2, ...roomTypes.filter((r) => r.structureId === structureId).map((r) => r.maxOccupancy ?? r.beds ?? 2));
  const content: StructureContent = {
    name: st.name, description: st.description, type: st.type, city: st.city, address: [st.address, st.streetNumber].filter(Boolean).join(" ") || undefined, postalCode: st.postalCode,
    country: st.country, phone: st.phone, email: st.email, lat: st.lat, lng: st.lng, services: st.services, checkInFrom: st.checkInFrom, checkOutBy: st.checkOutBy,
    smoking: st.smoking, pets: st.pets, minAge: st.minAge, cancelPolicy: st.cancelPolicy, maxGuests, currency: st.currency,
  };
  const checks = contentChecklist(content);
  const missing = checks.filter((c) => !c.ok);

  const send = async () => {
    setBusy(true); setErr(""); setSteps(null);
    try {
      const j = await apiPost<{ ok: boolean; steps?: Step[] }>("channex/property-content", { action: "sync", propertyId, content });
      setSteps(j.steps ?? []);
    } catch (e) { setErr(e instanceof Error ? e.message : "errore di rete"); }
    setBusy(false);
  };

  const uploadPhotos = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/")).slice(0, 30);
    if (!list.length) return;
    setPhoto({ done: 0, total: list.length, errors: [], running: true });
    const errors: string[] = [];
    let done = 0;
    for (const f of list) {
      try {
        const dataUrl = await downscaleImage(f, 1600, 0.85); // lato lungo 1600 px: abbastanza per Google, abbastanza leggera da inviare
        await apiPost("channex/property-content", { action: "photo", propertyId, dataUrl, description: st.name });
      } catch (e) { errors.push(`${f.name}: ${e instanceof Error ? e.message : "errore"}`); }
      done++;
      setPhoto({ done, total: list.length, errors: [...errors], running: done < list.length });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const okColor = "var(--ok)", warnColor = "var(--warn)", errColor = "var(--err)";
  return (
    <Card className="mb-5">
      <SectionTitle>{t("Dati della struttura per Google")}</SectionTitle>
      <p className="mb-3 text-xs text-dim">{t("Google Hotel mostra solo ciò che riceve da Channex. Qui lo invii direttamente da Xenora, senza passare dal pannello di Channex. Servono descrizione, servizi, orari, politica di cancellazione, posizione e almeno una foto.")}</p>
      <ul className="mb-3 grid gap-1.5 sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 text-xs font-bold" style={{ color: c.ok ? okColor : warnColor }}>{c.ok ? "✓" : "⚠"}</span>
            <span className={c.ok ? "text-txt" : "text-dim"}>{t(c.label)}{!c.ok && c.hint ? <span className="block text-[11px] text-faint">{t(c.hint)}</span> : null}</span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && <p className="mb-3 text-xs"><Link href={`/strutture/${structureId}`} className="font-semibold text-focus underline">{t("Completa in Strutture")} →</Link></p>}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={send} disabled={busy} className="rounded-lg bg-focus px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{busy ? t("Invio…") : t("Invia i dati a Channex")}</button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void uploadPhotos(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={!!photo?.running} className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-40">{photo?.running ? `${t("Carico le foto")} ${photo.done}/${photo.total}…` : t("Carica foto per Google")}</button>
      </div>
      {err && <p className="mt-3 text-sm" style={{ color: errColor }}>⚠ {err}</p>}
      {steps && (
        <ul className="mt-3 space-y-1">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 text-xs font-bold" style={{ color: s.ok ? okColor : warnColor }}>{s.ok ? "✓" : "⚠"}</span>
              <span className="text-txt">{t(s.label)}{s.detail ? <span className="block text-[12px] text-dim">{s.detail}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}
      {photo && !photo.running && (
        <p className="mt-3 text-sm" style={{ color: photo.errors.length ? warnColor : okColor }}>
          {photo.errors.length ? `⚠ ${photo.done - photo.errors.length}/${photo.total} ${t("foto caricate")}` : `✓ ${photo.total} ${t("foto caricate")}`}
          {photo.errors.map((e, i) => <span key={i} className="block text-[12px] text-dim">{e}</span>)}
        </p>
      )}
      <p className="mt-3 text-[11px] text-faint">{t("Dopo l'invio, nel canale Google su Channex apri \"Controllo della disponibilità\": quando l'elenco è vuoto puoi attivarlo.")}</p>
    </Card>
  );
}
