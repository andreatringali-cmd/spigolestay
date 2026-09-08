"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { useConfirm } from "@/components/ConfirmProvider";
import { AV_COLORS, initials } from "@/lib/users";
import { useLang } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
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
  const ask = useConfirm();
  // Rileva doppioni: stessa email, oppure stesso nome completo.
  const dupGroups = useMemo(() => {
    const nrm = (s?: string) => (s ?? "").trim().toLowerCase();
    const byKey = new Map<string, typeof guests>();
    guests.forEach((g) => { const key = nrm(g.email) || nrm(g.fullName); if (!key) return; const arr = byKey.get(key) ?? []; arr.push(g); byKey.set(key, arr); });
    return [...byKey.values()].filter((a) => a.length > 1);
  }, [guests]);
  const dupCount = dupGroups.reduce((a, g) => a + g.length - 1, 0);
  const mergeDuplicates = async () => {
    if (!dupCount) return;
    if (!(await ask({ title: t("Unisci duplicati"), message: `${t("Trovati")} ${dupCount} ${t("ospiti duplicati. Li unisco in un'unica voce spostando tutte le prenotazioni nello storico?")}`, confirmLabel: t("Unisci") }))) return;
    const fields = ["email", "phone", "country", "firstName", "lastName", "birthDate", "birthPlace", "citizenship", "docType", "docNumber", "docPlace", "address"] as const;
    dupGroups.forEach((group) => {
      const bookCount = (id: string) => bookings.filter((b) => b.guestId === id).length;
      const keeper = [...group].sort((a, b) => bookCount(b.id) - bookCount(a.id))[0];
      const merged: Record<string, unknown> = { ...keeper };
      group.forEach((g) => fields.forEach((k) => { if (!merged[k] && g[k]) merged[k] = g[k]; }));
      updateGuest(keeper.id, merged);
      mergeGuests(keeper.id, group.filter((g) => g.id !== keeper.id).map((g) => g.id));
    });
  };
  const [q, setQ] = useState("");
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
      return { guest: g, list, stays: list.length, nightsTot, spent, avg, comm, last, topCh };
    })
    .filter((r) => activeStructureId === "all" || r.list.length > 0)
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

  // Selezione multipla → invio promo
  const selEmails = sorted.filter((r) => sel.has(r.guest.id)).map((r) => r.guest.email).filter(Boolean) as string[];
  const allSel = sorted.length > 0 && sorted.every((r) => sel.has(r.guest.id));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(sorted.map((r) => r.guest.id)));
  const sendPromoTo = (p: Promo) => {
    if (selEmails.length) {
      const st = activeStructureId !== "all" ? structures.find((s) => s.id === activeStructureId) : structures[0];
      const contatti = [st?.phone, st?.email, st?.website].filter(Boolean).join(" · ");
      window.open(promoMailto(selEmails, p, { struttura: st?.name, contatti }), "_blank");
    }
    setPickPromo(false);
  };

  return (
    <div>
      <PageHeader title={t("Ospiti")} subtitle={`${guests.length} ${t("anagrafiche")}`} />

      {/* Card statistiche */}
      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {([[t("Ospiti"), String(totGuests)], [t("Ricavi totali"), eur(totRevenue)], [t("Prezzo medio/notte"), eur(avgAll)], [t("Ospiti abituali"), `${repeat}`]] as [string, string][]).map(([lab, val]) => (
          <div key={lab} className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm">
            <div className="text-[10px] font-medium uppercase tracking-wide text-faint">{lab}</div>
            <div className="font-mono text-lg font-bold leading-tight text-txt">{val}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cerca per nome, email o paese…")} className="w-full max-w-sm rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dupCount > 0 && <button onClick={mergeDuplicates} className="rounded-lg border px-3 py-2 text-sm font-semibold text-txt hover:opacity-90" style={{ borderColor: "color-mix(in srgb, var(--warn) 50%, var(--line))", backgroundColor: "color-mix(in srgb, var(--warn) 10%, transparent)" }}>⤳ {t("Unisci duplicati")} ({dupCount})</button>}
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

      {/* Telefono: registro ospiti a schede */}
      <div className="md:hidden">
        <div className="mb-2 px-1 text-sm font-bold text-txt">{t("Registro ospiti")} <span className="text-faint">· {sorted.length}</span></div>
        <div className="flex flex-col gap-2">
          {sorted.map(({ guest, stays, nightsTot, spent, last, topCh }) => (
            <div key={guest.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-sm">
              <input type="checkbox" checked={sel.has(guest.id)} onChange={() => toggleSel(guest.id)} onClick={(e) => e.stopPropagation()} style={{ accentColor: "var(--focus)" }} className="shrink-0" />
              <button onClick={() => router.push(`/ospiti/${guest.id}`)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 truncate font-semibold text-txt">{guest.fullName}{guest.vip && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, #D4A017 22%, transparent)", color: "#B8860B" }}>VIP</span>}</span>
                  <span className="shrink-0 font-mono font-semibold text-txt">{eur(spent)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-dim">
                  {topCh && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `var(${CHANNELS[topCh].cssVar})`, color: CHANNELS[topCh].text }}>{CHANNELS[topCh].label}</span>}
                  <span>{stays} {t("pren.")} · {nightsTot} {t("notti")}</span>
                  {guest.country && <><span className="text-faint">·</span><span>{guest.country}</span></>}
                </div>
                <div className="mt-0.5 text-[11px] text-faint">{t("Ultimo")}: {last ? fmtD(last) : "—"}{guest.phone ? ` · ${guest.phone}` : ""}</div>
              </button>
            </div>
          ))}
          {sorted.length === 0 && <div className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-faint">{t("Nessun ospite trovato.")}</div>}
        </div>
      </div>

      {/* Tablet/desktop: tabella */}
      <div className="hidden rounded-xl border border-line bg-surface shadow-sm md:block">
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 text-sm font-bold text-txt">{t("Registro ospiti")} <span className="text-faint">· {sorted.length}</span></div>
        <div className="max-h-[62vh] overflow-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="sticky top-0 z-10 bg-wash">
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-faint">
              <th className="w-8 px-3 py-2"><input type="checkbox" checked={allSel} onChange={toggleAll} style={{ accentColor: "var(--focus)" }} /></th>
              <Th k="name">{t("Ospite")}</Th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{t("Telefono")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{t("Email")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{t("Paese")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{t("Canale")}</th>
              <Th k="stays" right>{t("Prenotazioni")}</Th>
              <Th k="nights" right>{t("Notti")}</Th>
              <Th k="avg" right>{t("Notte medio")}</Th>
              <Th k="spent" right>{t("Speso")}</Th>
              <Th k="comm" right>{t("Commissioni")}</Th>
              <Th k="last" right>{t("Ultimo soggiorno")}</Th>
              <th className="whitespace-nowrap px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ guest, stays, nightsTot, avg, spent, comm, last, topCh }) => (
              <tr key={guest.id} onClick={() => router.push(`/ospiti/${guest.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-[color:color-mix(in_srgb,var(--focus)_6%,transparent)]">
                <td onClick={(e) => e.stopPropagation()} className="px-3 py-2"><input type="checkbox" checked={sel.has(guest.id)} onChange={() => toggleSel(guest.id)} style={{ accentColor: "var(--focus)" }} /></td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="flex items-center gap-1.5 font-medium text-txt">{guest.fullName}{guest.vip && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, #D4A017 22%, transparent)", color: "#B8860B" }}>VIP</span>}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-txt">{guest.phone ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-txt">{guest.email ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-txt">{guest.country ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{topCh ? <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `var(${CHANNELS[topCh].cssVar})`, color: CHANNELS[topCh].text }}>{CHANNELS[topCh].label}</span> : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{stays}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{nightsTot}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{avg > 0 ? eur(avg) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-txt">{eur(spent)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{comm > 0 ? eur(comm) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-txt">{last ? fmtD(last) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-faint">›</td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={13} className="px-3 py-8 text-center text-sm text-faint">{t("Nessun ospite trovato.")}</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

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
