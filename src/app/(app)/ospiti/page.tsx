"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { AV_COLORS, initials } from "@/lib/users";
import { useLang } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { nights, parseISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { CHANNELS, type Channel } from "@/lib/types";
import { type Promo, loadPromos, promoMailto } from "@/lib/promos";

const avColor = (n: string) => AV_COLORS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
const fmtD = (iso: string) => { try { return parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" }); } catch { return iso; } };

type SortKey = "name" | "stays" | "nights" | "avg" | "spent" | "comm" | "last";

export default function OspitiPage() {
  const router = useRouter();
  const { t } = useLang();
  const { guests, bookings, structures, activeStructureId, mergeGuests, updateGuest } = useData();
  // Rileva doppioni SOLO su un contatto forte (stessa email o stesso telefono): due omonimi
  // senza contatto NON vengono mai uniti (rischio di fondere persone diverse).
  const dupGroups = useMemo(() => {
    const nrm = (s?: string) => (s ?? "").trim().toLowerCase();
    const nrmPhone = (s?: string) => (s ?? "").replace(/[\s+()./-]/g, "");
    const byKey = new Map<string, typeof guests>();
    guests.forEach((g) => { const key = nrm(g.email) || (nrmPhone(g.phone).length >= 6 ? "tel:" + nrmPhone(g.phone) : ""); if (!key) return; const arr = byKey.get(key) ?? []; arr.push(g); byKey.set(key, arr); });
    return [...byKey.values()].filter((a) => a.length > 1);
  }, [guests]);
  const dupCount = dupGroups.reduce((a, g) => a + g.length - 1, 0);
  // Unisce i doppioni in automatico: all'apertura e ogni volta che ne compaiono di nuovi
  // (es. dopo un import). Tiene la voce con più prenotazioni e completa i campi mancanti.
  useEffect(() => {
    if (dupCount === 0) return;
    const fields = ["email", "phone", "country", "firstName", "lastName", "birthDate", "birthPlace", "citizenship", "docType", "docNumber", "docPlace", "address"] as const;
    dupGroups.forEach((group) => {
      const bookCount = (id: string) => bookings.filter((b) => b.guestId === id).length;
      const keeper = [...group].sort((a, b) => bookCount(b.id) - bookCount(a.id))[0];
      const merged: Record<string, unknown> = { ...keeper };
      group.forEach((g) => fields.forEach((k) => { if (!merged[k] && g[k]) merged[k] = g[k]; }));
      updateGuest(keeper.id, merged);
      mergeGuests(keeper.id, group.filter((g) => g.id !== keeper.id).map((g) => g.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupCount]);
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState<string>("all"); // segmento CRM: all|repeat|vip|new|ch:<canale>
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "stays", dir: "desc" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [promos, setPromos] = useState<Promo[]>([]);
  const [pickPromo, setPickPromo] = useState(false);
  useEffect(() => { setPromos(loadPromos()); }, []);

  const term = q.trim().toLowerCase();
  const rows = guests
    .map((g) => {
      const list = bookings.filter((b) => b.guestId === g.id && (activeStructureId === "all" || b.structureId === activeStructureId) && b.status !== "cancelled" && b.channel !== "blocked");
      const nightsTot = list.reduce((a, b) => a + Math.max(0, nights(b.checkIn, b.checkOut)), 0);
      const spent = list.reduce((a, b) => a + (b.total ?? 0), 0);
      const avg = nightsTot > 0 ? Math.round(spent / nightsTot) : 0;
      const comm = Math.round(list.reduce((a, b) => a + (b.total ?? 0) * ((b.commissionPct ?? Math.round((CHANNELS[b.channel]?.commission ?? 0) * 100)) / 100), 0));
      const last = list.reduce((m, b) => (b.checkIn > m ? b.checkIn : m), "");
      const chCount: Record<string, number> = {};
      list.forEach((b) => { chCount[b.channel] = (chCount[b.channel] ?? 0) + 1; });
      const topCh = Object.entries(chCount).sort((a, b) => b[1] - a[1])[0]?.[0] as Channel | undefined;
      // Ha prenotazioni reali in QUALSIASI struttura? Se sì è un ospite; se no è un contatto/lead (newsletter).
      const anyBookings = bookings.some((b) => b.guestId === g.id && b.status !== "cancelled" && b.channel !== "blocked");
      return { guest: g, list, stays: list.length, nightsTot, spent, avg, comm, last, topCh, anyBookings };
    })
    // Mostra: chi ha prenotazioni in questa struttura; con "Tutte" tutti; e SEMPRE
    // i contatti senza prenotazioni (es. iscritti newsletter/lead), che non sono legati a una struttura.
    .filter((r) => activeStructureId === "all" || r.list.length > 0 || !bookings.some((b) => b.guestId === r.guest.id && b.status !== "cancelled" && b.channel !== "blocked"))
    .filter((r) => !term || r.guest.fullName.toLowerCase().includes(term) || (r.guest.email ?? "").toLowerCase().includes(term) || (r.guest.country ?? "").toLowerCase().includes(term));

  const sorted = [...rows].sort((a, b) => {
    const d = sort.dir === "asc" ? 1 : -1;
    switch (sort.key) {
      case "name": return a.guest.fullName.localeCompare(b.guest.fullName) * d;
      case "nights": return (a.nightsTot - b.nightsTot) * d;
      case "avg": return (a.avg - b.avg) * d;
      case "spent": return (a.spent - b.spent) * d;
      case "comm": return (a.comm - b.comm) * d;
      case "last": return a.last.localeCompare(b.last) * d;
      default: return (a.stays - b.stays) * d;
    }
  });

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`whitespace-nowrap px-3 py-2 font-semibold ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-txt ${sort.key === k ? "text-txt" : ""}`}>{children}{sort.key === k && <span className="text-[9px]">{sort.dir === "asc" ? "▲" : "▼"}</span>}</button>
    </th>
  );

  // Statistiche riepilogo (in cima)
  const totGuests = rows.length;
  const totRevenue = rows.reduce((a, r) => a + r.spent, 0);
  const avgAll = (() => { const nt = rows.reduce((a, r) => a + r.nightsTot, 0); return nt > 0 ? Math.round(totRevenue / nt) : 0; })();
  const repeat = rows.filter((r) => r.stays > 1).length;

  // Ospiti abituali (più di un soggiorno): per badge e segmento CRM.
  const repeatIds = useMemo(() => new Set(rows.filter((r) => r.stays > 1).map((r) => r.guest.id)), [rows]);
  // Segmento CRM selezionato.
  const segMatch = (r: typeof sorted[number]) =>
    seg === "all" ? true
    : seg === "repeat" ? r.stays > 1
    : seg === "vip" ? !!r.guest.vip
    : seg === "new" ? r.stays === 1
    : seg.startsWith("ch:") ? r.topCh === seg.slice(3)
    : true;

  // Due registri: OSPITI (con prenotazioni) e NEWSLETTER (contatti senza prenotazioni).
  // Se un iscritto newsletter prenota, ha "anyBookings" → passa automaticamente agli ospiti.
  const guestSorted = sorted.filter((r) => r.anyBookings && segMatch(r));
  const nlSorted = sorted.filter((r) => !r.anyBookings);
  const SEGMENTS: [string, string][] = [["all", t("Tutti")], ["repeat", t("Abituali")], ["vip", "VIP"], ["new", t("Nuovi")], ["ch:booking", "Booking"], ["ch:airbnb", "Airbnb"], ["ch:direct", t("Diretta")]];
  const selectSegment = () => setSel((prev) => { const n = new Set(prev); guestSorted.forEach((r) => n.add(r.guest.id)); return n; });
  // Esporta il segmento corrente in CSV (per mailing/analisi esterne).
  const exportSegment = () => {
    const head = [t("Nome"), t("Email"), t("Telefono"), t("Paese"), t("Prenotazioni"), t("Notti"), t("Speso"), t("Ultimo soggiorno"), t("Canale"), "Tag"];
    const lines = guestSorted.map((r) => [r.guest.fullName, r.guest.email ?? "", r.guest.phone ?? "", r.guest.country ?? "", r.stays, r.nightsTot, r.spent, r.last ? fmtD(r.last) : "", r.topCh ? CHANNELS[r.topCh].label : "", (r.guest.tags ?? []).join("|")].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([["﻿" + head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ospiti-${seg}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  // Selezione multipla → invio promo
  const selEmails = sorted.filter((r) => sel.has(r.guest.id)).map((r) => r.guest.email).filter(Boolean) as string[];
  const sendPromoTo = (p: Promo) => {
    if (selEmails.length) {
      const st = activeStructureId !== "all" ? structures.find((s) => s.id === activeStructureId) : structures[0];
      const contatti = [st?.phone, st?.email, st?.website].filter(Boolean).join(" · ");
      window.open(promoMailto(selEmails, p, { struttura: st?.name, contatti }), "_blank");
    }
    setPickPromo(false);
  };

  // Registro riutilizzabile: variante "lead" (newsletter) con colonne ridotte.
  const Register = ({ title, list, empty, lead }: { title: string; list: typeof sorted; empty: string; lead?: boolean }) => {
    const ids = list.map((r) => r.guest.id);
    const allR = ids.length > 0 && ids.every((id) => sel.has(id));
    const toggleAllR = () => setSel((prev) => { const n = new Set(prev); if (allR) ids.forEach((id) => n.delete(id)); else ids.forEach((id) => n.add(id)); return n; });
    const nameCell = (guest: typeof list[number]["guest"]) => (
      <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-txt">{guest.fullName}
        {guest.vip && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, #D4A017 22%, transparent)", color: "#B8860B" }}>VIP</span>}
        {repeatIds.has(guest.id) && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 18%, transparent)", color: "var(--ok)" }}>{t("Abituale")}</span>}
        {guest.tags?.includes("newsletter") && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 16%, transparent)", color: "var(--focus)" }}>Newsletter</span>}
      </span>
    );
    return (
      <div className="mb-6">
        {/* Telefono: schede */}
        <div className="md:hidden">
          <div className="mb-2 px-1 text-sm font-bold uppercase tracking-wide text-txt">{title} <span className="font-normal text-faint">· {list.length}</span></div>
          <div className="flex flex-col gap-2">
            {list.map(({ guest, stays, nightsTot, spent, last, topCh }) => (
              <div key={guest.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-sm">
                <input type="checkbox" checked={sel.has(guest.id)} onChange={() => toggleSel(guest.id)} onClick={(e) => e.stopPropagation()} style={{ accentColor: "var(--focus)" }} className="shrink-0" />
                <button onClick={() => router.push(`/ospiti/${guest.id}`)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center justify-between gap-2">
                    {nameCell(guest)}
                    {!lead && <span className="shrink-0 font-mono font-semibold text-txt">{eur(spent)}</span>}
                  </div>
                  {lead ? (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-dim">{guest.email || guest.phone || "—"}{guest.email && guest.phone ? ` · ${guest.phone}` : ""}{guest.country ? ` · ${guest.country}` : ""}</div>
                  ) : (
                    <>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-dim">
                        {topCh && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `var(${CHANNELS[topCh].cssVar})`, color: CHANNELS[topCh].text }}>{CHANNELS[topCh].label}</span>}
                        <span>{stays} {t("pren.")} · {nightsTot} {t("notti")}</span>
                        {guest.country && <><span className="text-faint">·</span><span>{guest.country}</span></>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-faint">{t("Ultimo")}: {last ? fmtD(last) : "—"}{guest.phone ? ` · ${guest.phone}` : ""}</div>
                    </>
                  )}
                </button>
              </div>
            ))}
            {list.length === 0 && <div className="rounded-xl border border-line bg-surface"><EmptyState title={empty} /></div>}
          </div>
        </div>

        {/* Tablet/desktop: tabella */}
        <div className="hidden rounded-xl border border-line bg-surface shadow-sm md:block">
          <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-txt">{title} <span className="font-normal text-faint">· {list.length}</span></div>
          <div className="max-h-[62vh] overflow-auto">
          <table className={`w-full ${lead ? "min-w-[560px]" : "min-w-[980px]"} text-sm`}>
            <thead className="sticky top-0 z-10 bg-wash">
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-faint">
                <th className="w-8 px-3 py-2"><input type="checkbox" checked={allR} onChange={toggleAllR} style={{ accentColor: "var(--focus)" }} /></th>
                <Th k="name">{t("Ospite")}</Th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{t("Telefono")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{t("Email")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{t("Paese")}</th>
                {!lead && <>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{t("Canale")}</th>
                  <Th k="stays" right>{t("Prenotazioni")}</Th>
                  <Th k="nights" right>{t("Notti")}</Th>
                  <Th k="avg" right>{t("Notte medio")}</Th>
                  <Th k="spent" right>{t("Speso")}</Th>
                  <Th k="comm" right>{t("Commissioni")}</Th>
                  <Th k="last" right>{t("Ultimo soggiorno")}</Th>
                </>}
                <th className="whitespace-nowrap px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ guest, stays, nightsTot, avg, spent, comm, last, topCh }) => (
                <tr key={guest.id} onClick={() => router.push(`/ospiti/${guest.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-[color:color-mix(in_srgb,var(--focus)_6%,transparent)]">
                  <td onClick={(e) => e.stopPropagation()} className="px-3 py-2"><input type="checkbox" checked={sel.has(guest.id)} onChange={() => toggleSel(guest.id)} style={{ accentColor: "var(--focus)" }} /></td>
                  <td className="whitespace-nowrap px-3 py-2">{nameCell(guest)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-txt">{guest.phone ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-txt">{guest.email ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-txt">{guest.country ?? "—"}</td>
                  {!lead && <>
                    <td className="whitespace-nowrap px-3 py-2">{topCh ? <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `var(${CHANNELS[topCh].cssVar})`, color: CHANNELS[topCh].text }}>{CHANNELS[topCh].label}</span> : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{stays}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{nightsTot}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{avg > 0 ? eur(avg) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-txt">{eur(spent)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{comm > 0 ? eur(comm) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{last ? fmtD(last) : "—"}</td>
                  </>}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-faint">›</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={lead ? 6 : 13}><EmptyState title={empty} /></td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader title={t("Ospiti")} subtitle={`${guests.length} ${t("anagrafiche")}`} />

      {/* Card statistiche */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([[t("Ospiti"), String(totGuests)], [t("Ricavi totali"), eur(totRevenue)], [t("Prezzo medio/notte"), eur(avgAll)], [t("Ospiti abituali"), `${repeat}`]] as [string, string][]).map(([lab, val]) => (
          <div key={lab} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{lab}</div>
            <div className="mt-1 font-mono text-2xl font-bold text-txt">{val}</div>
          </div>
        ))}
      </div>

      {/* Stessa griglia dei riepiloghi sopra: ricerca larga quanto una card e allineata. */}
      <div className="mb-4 grid grid-cols-2 items-center gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-sm sm:grid-cols-4">
        <SearchInput value={q} onChange={setQ} placeholder={t("Cerca per nome, email o paese…")} className="col-span-2 w-full sm:col-span-1" />
        <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 sm:col-span-3">
          <button onClick={() => router.push("/promozioni")} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">✉ {t("Promozioni")}</button>
          <button onClick={() => router.push("/ospiti/nuovo")} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">+ {t("Nuovo ospite")}</button>
        </div>
      </div>

      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "color-mix(in srgb, var(--focus) 40%, var(--line))", backgroundColor: "color-mix(in srgb, var(--focus) 6%, transparent)" }}>
          <span className="text-sm font-semibold text-txt">{sel.size} {t("selezionati")}</span>
          <span className="text-xs text-faint">· {selEmails.length} {t("con email")}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setSel(new Set())} className="rounded-lg border border-line px-3 py-1.5 text-sm text-dim hover:bg-wash">{t("Deseleziona")}</button>
            <button onClick={() => setPickPromo(true)} disabled={selEmails.length === 0} className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">✉ {t("Invia promo")} ({selEmails.length})</button>
          </div>
        </div>
      )}

      {/* Segmenti CRM: filtra il registro ospiti e permette invii mirati */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {SEGMENTS.map(([k, lab]) => (
          <button key={k} onClick={() => setSeg(k)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${seg === k ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{lab}</button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          {guestSorted.length > 0 && <button onClick={exportSegment} className="rounded-lg border border-line px-3 py-1 text-xs font-semibold text-txt hover:bg-wash">⬇ CSV ({guestSorted.length})</button>}
          {seg !== "all" && guestSorted.length > 0 && (
            <button onClick={selectSegment} className="rounded-lg border border-line px-3 py-1 text-xs font-semibold text-txt hover:bg-wash">{t("Seleziona segmento")} ({guestSorted.length})</button>
          )}
        </div>
      </div>

      <Register title={t("Registro ospiti")} list={guestSorted} empty={t("Nessun ospite in questo segmento.")} />
      <Register title={t("Registro newsletter")} list={nlSorted} empty={t("Nessun iscritto alla newsletter.")} lead />

      {pickPromo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setPickPromo(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><span className="font-display text-lg font-bold text-txt">{t("Scegli la promo da inviare")}</span><button onClick={() => setPickPromo(false)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="mb-3 text-xs text-dim">{selEmails.length} {t("destinatari con email")}</div>
            {promos.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-faint">{t("Nessuna promo salvata.")} <button onClick={() => router.push("/promozioni")} className="font-semibold text-focus hover:underline">{t("Creane una")}</button></div>
            ) : (
              <div className="flex flex-col gap-2">
                {promos.map((p) => (
                  <button key={p.id} onClick={() => sendPromoTo(p)} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left hover:border-focus hover:bg-wash">
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
