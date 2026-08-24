"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useData } from "@/lib/store";
import type { RoomType } from "@/lib/types";
import { ROOM_TYPE_OPTIONS, BED_CONFIGS, ROOM_AMENITIES, ROOM_SPACES } from "@/lib/types";
import { USER_LANGS, AV_COLORS } from "@/lib/users";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import ImageUploader from "@/components/ImageUploader";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";
function Toggle({ on, onClick, color = "var(--focus)" }: { on: boolean; onClick?: () => void; color?: string }) {
  return <button type="button" onClick={onClick} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? color : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>;
}

const blankType = (structureId: string): Partial<RoomType> => ({
  structureId, name: "", beds: 2, basePrice: 100, maxOccupancy: 2, maxAdults: 2, maxChildren: 0, infants: 0, extraBeds: 0, size: undefined,
  bedConfig: "1 matrimoniale", minStay: 1, minPrice: undefined, childrenAllowed: true, dormMode: false, autoPrice: false,
  color: AV_COLORS[1], amenities: ["Bagno privato", "Aria condizionata", "Wi-Fi"], composition: [{ name: "Camera da letto", shared: false }, { name: "Bagno", shared: false }],
  showBooking: true, showSite: true, showCalendar: true, countStats: true, i18n: {},
});

export default function TipologiaSchedaPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const { structures, roomTypes, units, addRoomType, updateRoomType, deleteRoomType } = useData();
  const { t } = useLang();
  const ask = useConfirm();
  const isNew = params.id === "nuovo";
  const existing = roomTypes.find((rt) => rt.id === params.id);
  const structureId = isNew ? sp.get("s") ?? structures[0]?.id ?? "" : existing?.structureId ?? "";

  const [f, setF] = useState<Partial<RoomType>>(() => (isNew ? blankType(structureId) : { ...blankType(structureId), ...existing }));
  const set = <K extends keyof RoomType>(k: K, v: RoomType[K]) => setF((p) => ({ ...p, [k]: v }));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const [lang, setLang] = useState("it");

  const structure = structures.find((s) => s.id === structureId);
  const nUnits = existing ? units.filter((u) => u.roomTypeId === existing.id).length : 0;
  const otherTypes = roomTypes.filter((rt) => rt.structureId === structureId && rt.id !== params.id);

  const toggleAmen = (a: string) => setF((p) => { const cur = p.amenities ?? []; return { ...p, amenities: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] }; });
  const setI18n = (k: "name" | "desc", v: string) => setF((p) => ({ ...p, i18n: { ...(p.i18n ?? {}), [lang]: { ...(p.i18n ?? {})[lang], [k]: v } } }));
  const addSpace = (name: string) => setF((p) => ({ ...p, composition: [...(p.composition ?? []), { name, shared: false }] }));
  const delSpace = (i: number) => setF((p) => ({ ...p, composition: (p.composition ?? []).filter((_, x) => x !== i) }));
  const toggleShared = (i: number) => setF((p) => ({ ...p, composition: (p.composition ?? []).map((c, x) => (x === i ? { ...c, shared: !c.shared } : c)) }));

  const valid = !!f.name?.trim();
  const save = () => {
    if (!valid) return;
    const patch: Partial<RoomType> = { ...f };
    delete (patch as { id?: string }).id;
    if (isNew) { const id = addRoomType({ structureId, name: f.name!.trim(), beds: f.beds ?? 1, basePrice: f.basePrice ?? 0 }); updateRoomType(id, patch); }
    else updateRoomType(params.id, patch);
    router.push("/camere");
  };
  const remove = async () => { if (existing && (await ask({ title: t("Elimina tipologia"), message: `${t("Eliminare la tipologia")} "${existing.name}" ${t("e le sue")} ${nUnits} ${t("camere?")}`, danger: true, confirmLabel: t("Elimina") }))) { deleteRoomType(existing.id); router.push("/camere"); } };

  return (
    <div>
      <PageHeader
        title={isNew ? t("Nuova tipologia") : t("Scheda tipologia")}
        subtitle={`${structure?.name ?? ""}${f.name ? ` · ${f.name}` : ""}${nUnits ? ` · ${nUnits} ${t("camere")}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {!isNew && <button onClick={remove} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button>}
            <button onClick={() => router.push("/camere")} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash">{t("Annulla")}</button>
            <button onClick={save} disabled={!valid} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{isNew ? t("Crea tipologia") : t("Salva")}</button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sinistra */}
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("Generale")}</SectionTitle>
            <div className="mb-3 flex items-center gap-3">
              <div className="h-11 w-11 shrink-0 rounded-lg" style={{ backgroundColor: f.color }} />
              <div><div className="text-[11px] text-faint">{t("Colore (calendario e camere)")}</div><div className="mt-1 flex gap-1.5">{AV_COLORS.map((c) => <button key={c} onClick={() => set("color", c)} className={`h-5 w-5 rounded-full border-2 ${f.color === c ? "border-txt" : "border-transparent"}`} style={{ backgroundColor: c }} />)}</div></div>
              {!isNew && <span className="ml-auto rounded-full bg-wash px-2.5 py-1 text-xs text-dim">{nUnits} {t("camere di questa tipologia")}</span>}
            </div>
            <label className={lbl}>{t("Nome tipologia")} *<input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} list="rto" className={`${inp} mt-1`} placeholder={t("Es. Camera Matrimoniale Deluxe")} /><datalist id="rto">{ROOM_TYPE_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist></label>
            <label className={`${lbl} mt-3`}>{t("Descrizione breve")}<textarea value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} className={`${inp} mt-1 resize-y`} placeholder={t("Sintesi mostrata nei listini interni…")} /></label>
          </Card>

          <Card>
            <SectionTitle>{t("Ospiti & capienza")}</SectionTitle>
            <div className="grid grid-cols-4 gap-2">
              <label className={lbl}>{t("Ospiti max")}<input type="number" min={1} value={f.maxOccupancy ?? ""} onChange={(e) => set("maxOccupancy", num(e.target.value))} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Adulti max")}<input type="number" min={1} value={f.maxAdults ?? ""} onChange={(e) => set("maxAdults", num(e.target.value))} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Bambini max")}<input type="number" min={0} value={f.maxChildren ?? ""} onChange={(e) => set("maxChildren", num(e.target.value))} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Neonati")}<input type="number" min={0} value={f.infants ?? ""} onChange={(e) => set("infants", num(e.target.value))} className={`${inp} mt-1`} /></label>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <label className={lbl}>{t("Posti letto")}<input type="number" min={1} value={f.beds ?? ""} onChange={(e) => set("beds", Number(e.target.value) || 0)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Letti extra")}<input type="number" min={0} value={f.extraBeds ?? ""} onChange={(e) => set("extraBeds", num(e.target.value))} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("€ letto extra")}<input type="number" min={0} value={f.extraBedPrice ?? ""} onChange={(e) => set("extraBedPrice", num(e.target.value))} className={`${inp} mt-1`} /></label>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className={lbl}>{t("Composizione letti")}<select value={f.bedConfig ?? ""} onChange={(e) => set("bedConfig", e.target.value)} className={`${inp} mt-1`}><option value="">—</option>{BED_CONFIGS.map((b) => <option key={b} value={b}>{t(b)}</option>)}</select></label>
              <label className={lbl}>{t("Superficie m²")}<input type="number" min={0} value={f.size ?? ""} onChange={(e) => set("size", num(e.target.value))} className={`${inp} mt-1`} /></label>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <div className="flex items-center justify-between py-1"><span className="text-sm text-txt">{t("Bambini ammessi")}</span><Toggle on={f.childrenAllowed !== false} onClick={() => set("childrenAllowed", !(f.childrenAllowed !== false))} /></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-txt">{t("Modalità dormitorio")} <span className="text-[11px] text-faint">{t("(vendita a posto letto)")}</span></span><Toggle on={!!f.dormMode} onClick={() => set("dormMode", !f.dormMode)} /></div>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Ambienti")}</SectionTitle>
            <div className="flex flex-col gap-1.5">
              {(f.composition ?? []).map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="flex-1 text-sm text-txt">{c.name}</span>
                  <button onClick={() => toggleShared(i)} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.shared ? "bg-[color:color-mix(in_srgb,var(--warn)_16%,transparent)] text-[color:var(--warn)]" : "bg-wash text-dim"}`}>{c.shared ? t("Condiviso") : t("Privato")}</button>
                  <button onClick={() => delSpace(i)} className="rounded p-1 text-faint hover:text-[color:var(--err)]">✕</button>
                </div>
              ))}
              {(f.composition ?? []).length === 0 && <div className="text-sm text-faint">{t("Nessun ambiente.")}</div>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ROOM_SPACES.map((sp2) => <button key={sp2} onClick={() => addSpace(sp2)} className="rounded-full border border-line px-2.5 py-1 text-xs text-dim hover:bg-wash">+ {t(sp2)}</button>)}
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Dotazioni della camera")}</SectionTitle>
            <div className="flex flex-wrap gap-1.5">{ROOM_AMENITIES.map((a) => <button key={a} onClick={() => toggleAmen(a)} className={`rounded-full border px-2.5 py-1 text-xs transition ${(f.amenities ?? []).includes(a) ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(a)}</button>)}</div>
          </Card>
        </div>

        {/* Destra */}
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("Prezzo & disponibilità")}</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              <label className={lbl}>{t("Prezzo base €")}<input type="number" min={0} value={f.basePrice ?? ""} onChange={(e) => set("basePrice", Number(e.target.value) || 0)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Prezzo minimo €")}<input type="number" min={0} value={f.minPrice ?? ""} onChange={(e) => set("minPrice", num(e.target.value))} className={`${inp} mt-1`} placeholder="—" /></label>
              <label className={lbl}>{t("Notti minime")}<input type="number" min={1} value={f.minStay ?? ""} onChange={(e) => set("minStay", num(e.target.value))} className={`${inp} mt-1`} /></label>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-line px-3 py-2">
              <span className="text-sm text-txt">{t("Aumento automatico di prezzo")} <span className="block text-[11px] text-faint">{t("Applica i suggerimenti di")} <Link href="/revenue" className="text-focus hover:underline">Revenue</Link></span></span>
              <Toggle on={!!f.autoPrice} onClick={() => set("autoPrice", !f.autoPrice)} color="var(--ok)" />
            </div>
            <p className="mt-2 text-[11px] text-faint">{t("Le tariffe derivate (es. DUS = Matrimoniale −10€) si gestiscono in")} <Link href="/tariffe" className="text-focus hover:underline">{t("Tariffe")}</Link>{otherTypes.length ? "" : ""}.</p>
          </Card>

          <Card>
            <SectionTitle>{t("Visibilità sui canali")}</SectionTitle>
            <div className="flex flex-col gap-1">
              {([["showBooking", "Mostra nel Booking Engine"], ["showSite", "Mostra sul sito web"], ["showCalendar", "Mostra nel calendario disponibilità"], ["countStats", "Conta nelle statistiche"]] as [keyof RoomType, string][]).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between py-1.5"><span className="text-sm text-txt">{t(label)}</span><Toggle on={f[k] !== false} onClick={() => set(k, !(f[k] !== false) as never)} color="var(--ok)" /></div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Descrizioni multilingua")}</SectionTitle>
            <div className="mb-3 flex flex-wrap gap-1">
              {USER_LANGS.map((l) => <button key={l.code} onClick={() => setLang(l.code)} className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${lang === l.code ? "bg-focus text-white" : "border border-line text-dim hover:bg-wash"}`}>{l.flag} {l.code.toUpperCase()}</button>)}
            </div>
            <label className={lbl}>{t("Nome commerciale")} ({lang.toUpperCase()})<input value={(f.i18n ?? {})[lang]?.name ?? ""} onChange={(e) => setI18n("name", e.target.value)} className={`${inp} mt-1`} placeholder={f.name || t("Nome mostrato agli ospiti")} /></label>
            <label className={`${lbl} mt-3`}>{t("Descrizione")} ({lang.toUpperCase()})<textarea value={(f.i18n ?? {})[lang]?.desc ?? ""} onChange={(e) => setI18n("desc", e.target.value)} rows={4} className={`${inp} mt-1 resize-y`} placeholder={t("Testo mostrato sul sito e sulle OTA…")} /></label>
            <p className="mt-2 text-[11px] text-faint">{t("Compila le lingue che ti servono: quelle vuote useranno l'italiano come fallback.")}</p>
          </Card>

          <Card>
            <SectionTitle>{t("Immagini")}</SectionTitle>
            {isNew ? (
              <p className="text-sm text-faint">{t("Salva la tipologia per poter aggiungere le foto.")}</p>
            ) : (
              <ImageUploader entityKey={`rt:${params.id}`} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
