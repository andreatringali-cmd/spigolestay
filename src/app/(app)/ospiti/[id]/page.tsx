"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import type { Guest } from "@/lib/types";
import { DOC_TYPES, GUEST_TAGS, CHANNELS } from "@/lib/types";
import { USER_LANGS, AV_COLORS, initials } from "@/lib/users";
import { eur } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { type Promo, loadPromos, promoMailto } from "@/lib/promos";
import { useEffect } from "react";

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";
function Toggle({ on, onClick, color = "var(--focus)" }: { on: boolean; onClick?: () => void; color?: string }) {
  return <button type="button" onClick={onClick} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? color : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>;
}
const nights = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

export default function OspiteSchedaPage() {
  const router = useRouter();
  const { t } = useLang();
  const params = useParams<{ id: string }>();
  const isNew = params.id === "nuovo";
  const { guests, bookings, addGuest, updateGuest, deleteGuest, getStructure, getUnit, openBooking } = useData();
  const ask = useConfirm();

  const existing = guests.find((g) => g.id === params.id);
  const [g, setG] = useState<Guest>(() => existing ?? { id: "", fullName: "", firstName: "", lastName: "", language: "it", tags: [] });
  const set = <K extends keyof Guest>(k: K, v: Guest[K]) => setG((p) => ({ ...p, [k]: v }));
  const toggleTag = (t: string) => setG((p) => { const cur = p.tags ?? []; return { ...p, tags: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] }; });

  const list = existing ? bookings.filter((b) => b.guestId === existing.id).sort((a, b) => (a.checkIn < b.checkIn ? 1 : -1)) : [];
  const stays = list.filter((b) => b.status !== "cancelled");
  const totalNights = stays.reduce((a, b) => a + nights(b.checkIn, b.checkOut), 0);
  const totalSpend = stays.reduce((a, b) => a + (b.total ?? 0), 0);
  const avgNight = totalNights > 0 ? Math.round(totalSpend / totalNights) : 0;
  const lastStay = stays[0]?.checkIn;

  // Invio promo singolo
  const [promos, setPromos] = useState<Promo[]>([]);
  const [pickPromo, setPickPromo] = useState(false);
  useEffect(() => { setPromos(loadPromos()); }, []);
  const lastSt = stays[0] ? getStructure(stays[0].structureId) : undefined;
  const sendPromo = (p: Promo) => {
    if (g.email) { const contatti = [lastSt?.phone, lastSt?.email, lastSt?.website].filter(Boolean).join(" · "); window.open(promoMailto([g.email], p, { nome: g.firstName, struttura: lastSt?.name, contatti }), "_blank"); }
    setPickPromo(false);
  };

  const color = AV_COLORS[[...(g.fullName || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
  const errs: string[] = [];
  if (!g.firstName?.trim()) errs.push(t("Nome"));
  if (!g.lastName?.trim()) errs.push(t("Cognome"));
  const valid = errs.length === 0;

  const save = () => {
    if (!valid) return;
    const fullName = `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim();
    const patch: Partial<Guest> = { ...g, fullName }; delete (patch as { id?: string }).id;
    if (isNew) { const id = addGuest({ firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone, country: g.country }); updateGuest(id, patch); }
    else updateGuest(params.id, patch);
    router.push("/ospiti");
  };

  const fullName = `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim() || g.fullName || t("Nuovo ospite");

  const remove = async () => {
    const n = list.length;
    const ok = await ask({
      title: t("Elimina ospite"),
      message: n > 0
        ? `${fullName} ${t("ha")} ${n} ${t("prenotazioni: eliminando l'anagrafica resteranno senza ospite collegato. Procedere?")}`
        : `${t("Eliminare definitivamente l'ospite")} ${fullName}?`,
      danger: true, confirmLabel: t("Elimina"),
    });
    if (!ok) return;
    deleteGuest(params.id);
    router.push("/ospiti");
  };

  return (
    <div>
      <PageHeader
        title={isNew ? t("Nuovo ospite") : t("Scheda ospite")}
        subtitle={isNew ? t("Aggiungi un'anagrafica ospite") : `${fullName}${g.country ? ` · ${g.country}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {!isNew && g.email && <button onClick={() => setPickPromo(true)} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">✉ {t("Invia promo")}</button>}
            {!isNew && <button onClick={remove} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button>}
            <button onClick={() => router.push("/ospiti")} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash">{t("Annulla")}</button>
            <button onClick={save} disabled={!valid} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{isNew ? t("Crea ospite") : t("Salva")}</button>
          </div>
        }
      />

      {!valid && <div className="mb-4 rounded-lg border border-[color:var(--warn)] bg-[color:color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-xs text-dim">{t("Per salvare completa:")} <b className="text-txt">{errs.join(", ")}</b>.</div>}

      {/* Intestazione ospite + statistiche */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-lg font-bold text-white" style={{ backgroundColor: color }}>{initials(g.firstName, g.lastName) || "?"}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2"><span className="font-display text-lg font-bold text-txt">{fullName}</span>{g.vip && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, #D4A017 22%, transparent)", color: "#B8860B" }}>VIP</span>}</div>
            <div className="text-xs text-dim">{g.email || "—"}{g.phone ? ` · ${g.phone}` : ""}</div>
          </div>
          {!isNew && (
            <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
              <div><div className="font-mono text-xl font-bold text-txt">{stays.length}</div><div className="text-[11px] text-faint">{t("soggiorni")}</div></div>
              <div><div className="font-mono text-xl font-bold text-txt">{totalNights}</div><div className="text-[11px] text-faint">{t("notti")}</div></div>
              <div><div className="font-mono text-xl font-bold text-txt">{eur(totalSpend)}</div><div className="text-[11px] text-faint">{t("spesa")}</div></div>
              <div><div className="font-mono text-sm font-bold text-txt">{lastStay ? new Date(lastStay).toLocaleDateString("it-IT", { month: "short", year: "2-digit" }) : "—"}</div><div className="text-[11px] text-faint">{t("ultimo")}</div></div>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("Anagrafica")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <label className={lbl}>{t("Nome")} *<input value={g.firstName ?? ""} onChange={(e) => set("firstName", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Cognome")} *<input value={g.lastName ?? ""} onChange={(e) => set("lastName", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Sesso")}<select value={g.sex ?? ""} onChange={(e) => set("sex", e.target.value as Guest["sex"])} className={`${inp} mt-1`}><option value="">—</option><option value="M">{t("Maschile")}</option><option value="F">{t("Femminile")}</option></select></label>
              <label className={lbl}>{t("Data di nascita")}<input type="date" value={g.birthDate ?? ""} onChange={(e) => set("birthDate", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Luogo di nascita")}<input value={g.birthPlace ?? ""} onChange={(e) => set("birthPlace", e.target.value)} className={`${inp} mt-1`} placeholder={t("Comune o Stato")} /></label>
              <label className={lbl}>{t("Cittadinanza")}<input value={g.citizenship ?? ""} onChange={(e) => set("citizenship", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={`${lbl} col-span-2`}>{t("Residenza")}<input value={g.address ?? ""} onChange={(e) => set("address", e.target.value)} className={`${inp} mt-1`} placeholder={t("Via / indirizzo")} /></label>
              <label className={lbl}>{t("Numero civico")}<input value={g.streetNumber ?? ""} onChange={(e) => set("streetNumber", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Provincia")}<input value={g.province ?? ""} onChange={(e) => set("province", e.target.value)} className={`${inp} mt-1`} placeholder={t("Es. SR")} maxLength={2} /></label>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Contatti")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <label className={`${lbl} col-span-2`}>{t("Email")}<input value={g.email ?? ""} onChange={(e) => set("email", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Telefono")}<input value={g.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className={`${inp} mt-1`} placeholder="+39…" /></label>
              <label className={lbl}>{t("Paese")}<input value={g.country ?? ""} onChange={(e) => set("country", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={`${lbl} col-span-2`}>{t("Lingua")}<select value={g.language ?? "it"} onChange={(e) => set("language", e.target.value)} className={`${inp} mt-1`}>{USER_LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}</select></label>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Documento")} <span className="font-normal normal-case text-faint">· Alloggiati Web</span></SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <label className={lbl}>{t("Tipo documento")}<select value={g.docType ?? ""} onChange={(e) => set("docType", e.target.value)} className={`${inp} mt-1`}><option value="">—</option>{DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
              <label className={lbl}>{t("Numero")}<input value={g.docNumber ?? ""} onChange={(e) => set("docNumber", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Luogo di rilascio")}<input value={g.docPlace ?? ""} onChange={(e) => set("docPlace", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className={lbl}>{t("Scadenza")}<input type="date" value={g.docExpiry ?? ""} onChange={(e) => set("docExpiry", e.target.value)} className={`${inp} mt-1`} /></label>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("CRM & preferenze")}</SectionTitle>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between py-1.5"><span className="text-sm text-txt">{t("Ospite VIP")}</span><Toggle on={!!g.vip} onClick={() => set("vip", !g.vip)} color="#D4A017" /></div>
              <div className="flex items-center justify-between py-1.5"><span className="text-sm text-txt">{t("Consenso marketing")} <span className="text-[11px] text-faint">{t("(newsletter/offerte)")}</span></span><Toggle on={!!g.marketingConsent} onClick={() => set("marketingConsent", !g.marketingConsent)} color="var(--ok)" /></div>
            </div>
            <div className="mb-1 mt-2 text-xs font-medium text-dim">{t("Etichette")}</div>
            <div className="flex flex-wrap gap-1.5">{GUEST_TAGS.map((tag) => <button key={tag} onClick={() => toggleTag(tag)} className={`rounded-full border px-2.5 py-1 text-xs transition ${(g.tags ?? []).includes(tag) ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(tag)}</button>)}</div>
            <label className={`${lbl} mt-3`}>{t("Preferenze / richieste ricorrenti")}<textarea value={g.preferences ?? ""} onChange={(e) => set("preferences", e.target.value)} rows={2} className={`${inp} mt-1 resize-y`} placeholder={t("Es. camera silenziosa, allergie, check-in tardivo…")} /></label>
            <label className={`${lbl} mt-3`}>{t("Note interne")}<textarea value={g.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={2} className={`${inp} mt-1 resize-y`} placeholder={t("Visibili solo allo staff")} /></label>
          </Card>

          <Card>
            <SectionTitle>{t("Storico soggiorni")}</SectionTitle>
            {list.length === 0 ? <p className="text-sm text-faint">{isNew ? t("Salva l'ospite per iniziare a tracciare i soggiorni.") : t("Nessun soggiorno registrato.")}</p> : (
              <div className="flex flex-col divide-y divide-[color:var(--line)]">
                {list.map((b) => {
                  const st = getStructure(b.structureId);
                  const unit = getUnit(b.unitId);
                  const ch = CHANNELS[b.channel];
                  return (
                    <button key={b.id} onClick={() => openBooking(b.id)} className="flex items-center gap-3 py-2.5 text-left hover:bg-wash">
                      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `var(${ch.cssVar})` }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-txt">{st?.name ?? ""}{unit ? ` · ${unit.name}` : ""}</div>
                        <div className="text-[11px] text-faint">{new Date(b.checkIn).toLocaleDateString("it-IT")} → {new Date(b.checkOut).toLocaleDateString("it-IT")} · {nights(b.checkIn, b.checkOut)} {t("notti")} · {ch.label}{b.status === "cancelled" ? ` · ${t("annullata")}` : ""}</div>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold text-txt">{eur(b.total ?? 0)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {pickPromo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label={t("Chiudi")} onClick={() => setPickPromo(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><span className="font-display text-lg font-bold text-txt">{t("Invia promo a")} {fullName}</span><button onClick={() => setPickPromo(false)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="mb-3 text-xs text-dim">{g.email}</div>
            {promos.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-faint">{t("Nessuna promo salvata.")} <button onClick={() => router.push("/promozioni")} className="font-semibold text-focus hover:underline">{t("Creane una")}</button></div>
            ) : (
              <div className="flex flex-col gap-2">
                {promos.map((p) => (
                  <button key={p.id} onClick={() => sendPromo(p)} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left hover:border-focus hover:bg-wash">
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-txt">{p.name}</div><div className="truncate text-[11px] text-faint">{p.subject}</div></div>
                    {p.discountPct ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>-{p.discountPct}%</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
