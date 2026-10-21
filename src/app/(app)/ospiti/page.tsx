"use client";

import { useState, useEffect, useMemo, useDeferredValue } from "react";
import { groupDuplicates, normName } from "@/lib/guest-key";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { AV_COLORS, initials } from "@/lib/users";
import { useLang } from "@/lib/i18n";
import { PageHeader, StatCard } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import FilterSheet from "@/components/FilterSheet";
import EmptyState from "@/components/EmptyState";
import { nights, fmtDate } from "@/lib/dates";
import { eur } from "@/lib/format";
import { CHANNELS, type Channel } from "@/lib/types";
import { commissionOf } from "@/lib/booking";
import ChannelLogo, { ChannelWordmark } from "@/components/ChannelLogo";
import BookingChannelLogo, { BookingChannelWordmark } from "@/components/BookingChannelLogo";
import { directOriginOf, topChannelBooking } from "@/lib/direct-origin";
import { type Promo, loadPromos, promosForStructure, promoMailto } from "@/lib/promos";
import Icon from "@/components/Icon";
import { exportExcel } from "@/lib/export";
import ContattiDaCorreggere from "./_contatti";
import { phoneShown } from "@/lib/contacts-check";
import { refineGroups, planMerges } from "./_merge";
import { promoRecipientEmail } from "@/lib/promos";
import { needsBulkGuard } from "@/lib/bulk-guard";
import { useBulkGuard } from "@/components/useBulkGuard";
import { keyActivate } from "@/lib/a11y";

// Etichetta del canale principale di un ospite: per la Diretta distingue sito ufficiale e inserita a mano ("xenora.it" come prima).
const topChLabel = (ch: Channel, b?: Parameters<typeof directOriginOf>[0]) => (ch !== "direct" ? CHANNELS[ch].label : directOriginOf(b) === "sito" ? "Sito ufficiale" : "xenora.it");

const avColor = (n: string) => AV_COLORS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
const fmtD = (iso: string) => fmtDate(iso);

// Nomi leggibili dei campi che l'unione aggiunge alla scheda che resta (nell'anteprima non si mostrano i nomi tecnici).
const PATCH_LABELS: Record<string, string> = { email: "Email", phone: "Telefono", country: "Paese", notes: "Note interne", preferences: "Preferenze", tags: "Etichette", vip: "VIP", marketingConsent: "Consenso marketing", firstName: "Nome", lastName: "Cognome", fullName: "Nome", sex: "Sesso", birthDate: "Data di nascita", birthPlace: "Luogo di nascita", citizenship: "Cittadinanza", docType: "Tipo documento", docNumber: "Numero", docPlace: "Luogo di rilascio", docExpiry: "Scadenza documento", docPhotoFront: "Foto documento", docPhotoBack: "Foto documento", address: "Residenza", streetNumber: "Numero civico", province: "Provincia", city: "Città", zip: "CAP", language: "Lingua", source: "Provenienza" };

type SortKey ="name" | "stays" | "nights" | "avg" | "spent" | "comm" | "last";

export default function OspitiPage() {
  const router = useRouter();
  const { t } = useLang();
  const { guests, bookings, structures, activeStructureId, mergeGuestGroups, updateGuest, deleteGuest } = useData();
  // Doppioni = stessa persona con più schede: stessa email reale, stesso nome (se il paese o l'email reale non dicono il contrario) oppure stesso telefono
  // CON nome compatibile (stesso numero ma nomi diversi = persone diverse: agenzia, genitore). Le email anonime di Booking/Airbnb non contano.
  // NON si uniscono più da sole all'apertura: la pagina propone, mostra l'anteprima e unisce solo dopo conferma.
  const dupGroups = useMemo(() => refineGroups(groupDuplicates(guests)), [guests]);
  const dupCount = dupGroups.reduce((a, g) => a + g.length - 1, 0);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSkip, setMergeSkip] = useState<Set<string>>(new Set()); // gruppi (id della scheda che resta) esclusi dall'unione
  const bookingCount = useMemo(() => { const m = new Map<string, number>(); bookings.forEach((b) => m.set(b.guestId, (m.get(b.guestId) ?? 0) + 1)); return m; }, [bookings]);
  const mergePlans = useMemo(() => (mergeOpen ? planMerges(dupGroups, bookingCount) : []), [mergeOpen, dupGroups, bookingCount]);
  const doMerge = () => {
    const chosen = mergePlans.filter((p) => !mergeSkip.has(p.keepId));
    if (chosen.length) mergeGuestGroups(chosen.map((p) => ({ keepId: p.keepId, dropIds: p.dropIds, patch: p.patch })));
    setMergeOpen(false); setMergeSkip(new Set());
  };
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState<string>("all"); // segmento CRM: all|repeat|vip|new|ch:<canale>
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Cambiando struttura attiva la selezione multipla non ha più senso (potrebbe includere ospiti non visibili).
  useEffect(() => { setSel(new Set()); }, [activeStructureId, q, seg]);
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [promos, setPromos] = useState<Promo[]>([]);
  const [pickPromo, setPickPromo] = useState(false);
  useEffect(() => { setPromos(promosForStructure(loadPromos(), activeStructureId)); }, [activeStructureId]);
  const [confirmClearNl, setConfirmClearNl] = useState(false);
  const [exportPick, setExportPick] = useState(false);
  // Esc chiude i pannelli aperti (unione doppioni, esportazione, scelta promo).
  useEffect(() => {
    if (!mergeOpen && !exportPick && !pickPromo) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { setMergeOpen(false); setExportPick(false); setPickPromo(false); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [mergeOpen, exportPick, pickPromo]);
  const [openReg, setOpenReg] = useState({ ospiti: true, nl: true });
  const PAGE = 100;
  const [regLim, setRegLim] = useState({ ospiti: PAGE, nl: PAGE });

  // La digitazione resta fluida: l'elenco si aggiorna un attimo dopo.
  const dq = useDeferredValue(q);
  // Prenotazioni valide raggruppate per ospite, UNA volta sola (prima era un giro completo su tutte le prenotazioni per ogni ospite).
  const bookingsByGuest = useMemo(() => {
    const m = new Map<string, typeof bookings>();
    for (const b of bookings) {
      if (b.status === "cancelled" || b.channel === "blocked") continue;
      const arr = m.get(b.guestId);
      if (arr) arr.push(b); else m.set(b.guestId, [b]);
    }
    return m;
  }, [bookings]);
  const rowsAll = useMemo(() => guests.map((g) => {
    const allB = bookingsByGuest.get(g.id) ?? [];
    const list = activeStructureId === "all" ? allB : allB.filter((b) => b.structureId === activeStructureId);
    const nightsTot = list.reduce((a, b) => a + Math.max(0, nights(b.checkIn, b.checkOut)), 0);
    const spent = list.reduce((a, b) => a + (b.total ?? 0), 0);
    const avg = nightsTot > 0 ? Math.round(spent / nightsTot) : 0;
    const comm = list.reduce((a, b) => a + commissionOf(b), 0);
    const last = list.reduce((m, b) => (b.checkIn > m ? b.checkIn : m), "");
    const chCount: Record<string, number> = {};
    list.forEach((b) => { chCount[b.channel] = (chCount[b.channel] ?? 0) + 1; });
    const topCh = Object.entries(chCount).sort((x, y) => y[1] - x[1])[0]?.[0] as Channel | undefined;
    // Prenotazione "rappresentativa" del canale principale: serve al logo (per la Diretta distingue sito ufficiale / inserita a mano).
    const topB = topCh ? topChannelBooking(list, topCh) : undefined;
    // Ha prenotazioni reali in QUALSIASI struttura? Se sì è un ospite; se no è un contatto/lead (newsletter).
    const anyBookings = allB.length > 0;
    // Testo di ricerca: nome, cognome, email, paese — senza accenti né maiuscole, così l'ordine delle parole non conta.
    const hay = normName([g.fullName, g.firstName, g.lastName, g.email, g.country].filter(Boolean).join(" "));
    return { guest: g, list, stays: list.length, nightsTot, spent, avg, comm, last, topCh, topB, anyBookings, hay };
  }), [guests, bookingsByGuest, activeStructureId]);
  // Mostra: chi ha prenotazioni in questa struttura; con "Tutte" tutti; e SEMPRE i contatti senza prenotazioni
  // (es. iscritti newsletter/lead), che non sono legati a una struttura.
  const rowsScope = useMemo(() => rowsAll.filter((r) => activeStructureId === "all" || r.list.length > 0 || !r.anyBookings), [rowsAll, activeStructureId]);
  // "luigi rotondo" e "rotondo luigi" trovano la stessa persona: ogni parola scritta deve comparire, in qualsiasi ordine.
  const rows = useMemo(() => {
    const tokens = normName(dq).split(" ").filter(Boolean);
    return tokens.length ? rowsScope.filter((r) => tokens.every((tk) => r.hay.includes(tk))) : rowsScope;
  }, [rowsScope, dq]);
  // Anagrafiche visibili nella struttura attiva (ospiti con prenotazioni lì + contatti senza prenotazioni), senza ricerca.
  // Conta solo quelle che compaiono davvero nei registri (ospiti, inseriti a mano, iscritti newsletter): i contatti orfani restano nascosti.
  const totalVisible = rowsScope.filter((r) => r.anyBookings || r.guest.source === "manuale" || (Array.isArray(r.guest.tags) && r.guest.tags.includes("newsletter"))).length;


  const sorted = [...rows].sort((a, b) => {
    const d = sort.dir === "asc" ? 1 : -1;
    switch (sort.key) {
      case "name": return (a.guest.fullName ?? "").localeCompare(b.guest.fullName ?? "", "it", { sensitivity: "base" }) * d;
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
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-txt ${sort.key === k ? "text-txt" : ""}`}>{children}{sort.key === k && <span className="text-[10px]">{sort.dir === "asc" ? "▲" : "▼"}</span>}</button>
    </th>
  );

  // Statistiche riepilogo (in cima)
  const totGuests = rows.filter((r) => r.anyBookings || r.guest.source === "manuale").length; // solo ospiti con prenotazioni: gli iscritti newsletter sono contatti, non ospiti
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

  // Due registri: OSPITI (con prenotazioni) e NEWSLETTER.
  // NEWSLETTER = SOLO chi si è iscritto dal sito pubblico (tag "newsletter", vedi /api/public-lead):
  // non tutti i contatti senza prenotazioni. Così non finiscono nel registro contatti orfani
  // (es. da import o da prenotazioni cancellate) che poi "ricomparivano" dopo lo svuotamento.
  // Se un iscritto newsletter prenota, ha "anyBookings" → passa automaticamente agli ospiti.
  const isNewsletterLead = (g: { tags?: string[] }) => Array.isArray(g.tags) && g.tags.includes("newsletter");
  // Un ospite inserito a mano ("Nuovo ospite") non ha ancora prenotazioni ma deve restare visibile tra gli ospiti.
  const isManual = (g: { source?: string }) => g.source === "manuale";
  const guestSorted = sorted.filter((r) => (r.anyBookings || isManual(r.guest)) && segMatch(r));
  const nlSorted = sorted.filter((r) => !r.anyBookings && !isManual(r.guest) && isNewsletterLead(r.guest));
  // Svuota il registro newsletter: elimina gli iscritti dal sito (conferma in due passi).
  // Con 20 o più iscritti: conferma forte (si scrive ELIMINA) e copia JSON scaricata prima di cancellare.
  const bulkGuard = useBulkGuard();
  const clearNewsletter = async () => {
    if (needsBulkGuard(nlSorted.length)) {
      const list = nlSorted.map((r) => r.guest);
      if (!(await bulkGuard({ kind: "ospiti-newsletter", items: list, noun: "iscritti alla newsletter", title: "Svuotare il registro newsletter?" }))) { setConfirmClearNl(false); return; }
      list.forEach((g) => deleteGuest(g.id));
      setConfirmClearNl(false);
      return;
    }
    if (!confirmClearNl) { setConfirmClearNl(true); return; }
    nlSorted.forEach((r) => deleteGuest(r.guest.id));
    setConfirmClearNl(false);
  };
  const SEGMENTS: [string, string][] = [["all", t("Tutti")], ["repeat", t("Abituali")], ["vip", "VIP"], ["new", t("Nuovi")], ["ch:booking", "Booking"], ["ch:airbnb", "Airbnb"], ["ch:direct", t("Diretta")]];
  const selectSegment = () => setSel((prev) => { const n = new Set(prev); guestSorted.forEach((r) => n.add(r.guest.id)); return n; });
  // Chip dei segmenti e «Seleziona segmento»: scritti una volta, mostrati inline da sm in su e nella tendina «Filtri» su telefono.
  const segChips = SEGMENTS.map(([k, lab]) => (
    <button key={k} onClick={() => setSeg(k)} className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition max-sm:h-9 max-sm:py-0 ${seg === k ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{lab}</button>
  ));
  const segSelectBtn = seg !== "all" && guestSorted.length > 0 && (
    <button onClick={selectSegment} className="whitespace-nowrap rounded-lg border border-line px-3 py-1 text-xs font-semibold text-txt hover:bg-wash max-sm:h-9 max-sm:py-0">{t("Seleziona segmento")} ({guestSorted.length})</button>
  );

  // Esportazione Excel del registro ospiti con colonne a scelta (stesso segmento visibile).
  const EXPORT_COLUMNS: { key: string; label: string; get: (r: (typeof guestSorted)[number]) => string | number }[] = [
    { key: "nome", label: t("Nome"), get: (r) => r.guest.fullName ?? "" },
    { key: "email", label: t("Email"), get: (r) => r.guest.email ?? "" },
    { key: "telefono", label: t("Telefono"), get: (r) => (r.guest.phone ? phoneShown(r.guest) : "") },
    { key: "paese", label: t("Paese"), get: (r) => r.guest.country ?? "" },
    { key: "prenotazioni", label: t("Prenotazioni"), get: (r) => r.stays },
    { key: "notti", label: t("Notti"), get: (r) => r.nightsTot },
    { key: "speso", label: t("Speso"), get: (r) => r.spent },
    { key: "ultimo", label: t("Ultimo soggiorno"), get: (r) => (r.last ? fmtD(r.last) : "") },
    { key: "canale", label: t("Canale"), get: (r) => (r.topCh ? CHANNELS[r.topCh].label : "") },
    { key: "tag", label: "Tag", get: (r) => (r.guest.tags ?? []).join(", ") },
  ];
  const [exportCols, setExportCols] = useState<Set<string>>(new Set(EXPORT_COLUMNS.map((c) => c.key)));
  const toggleExportCol = (k: string) => setExportCols((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const doExportExcel = () => {
    const cols = EXPORT_COLUMNS.filter((c) => exportCols.has(c.key));
    exportExcel(`ospiti-${seg}`, cols.map((c) => c.label), guestSorted.map((r) => cols.map((c) => c.get(r))));
    setExportPick(false);
  };

  useEffect(() => { setRegLim({ ospiti: PAGE, nl: PAGE }); }, [dq, seg, activeStructureId, sort.key, sort.dir]); // cambia filtro o ordine: si riparte dalla prima pagina

  // Selezione multipla → invio promo
  // Solo gli ospiti che si vedono nei registri, con un'email vera (no indirizzi di inoltro OTA) e il consenso marketing / iscrizione newsletter.
  const visibleIds = new Set([...guestSorted, ...nlSorted].map((r) => r.guest.id));
  const selRows = [...guestSorted, ...nlSorted].filter((r) => sel.has(r.guest.id) && visibleIds.has(r.guest.id));
  const selEmails = [...new Set(selRows.map((r) => promoRecipientEmail(r.guest)).filter(Boolean))];
  const selExcluded = selRows.length - selRows.filter((r) => promoRecipientEmail(r.guest)).length;
  const sendPromoTo = (p: Promo) => {
    if (selEmails.length) {
      // Brand e contatti: la struttura attiva; con "Tutte" quella dei destinatari se è una sola (ultima prenotazione di ciascuno), altrimenti nessun brand.
      const lastStructOf = (list: { checkIn: string; structureId: string }[]) => [...list].sort((x, y) => (x.checkIn < y.checkIn ? 1 : -1))[0]?.structureId;
      const stIds = new Set(selRows.filter((r) => promoRecipientEmail(r.guest)).map((r) => lastStructOf(r.list)).filter(Boolean));
      const st = activeStructureId !== "all" ? structures.find((s) => s.id === activeStructureId)
        : structures.length === 1 ? structures[0]
        : stIds.size === 1 ? structures.find((s) => s.id === [...stIds][0]) : undefined;
      const contatti = [st?.phone, st?.email, st?.website].filter(Boolean).join(" · ");
      window.open(promoMailto(selEmails, p, { struttura: st?.name, contatti }), "_blank");
    }
    setPickPromo(false);
  };

  // Registro riutilizzabile: variante "lead" (newsletter) con colonne ridotte.
  const Register = ({ title, list, empty, lead, onClear, open, onToggle }: { title: string; list: typeof sorted; empty: string; lead?: boolean; onClear?: () => void; open: boolean; onToggle: () => void }) => {
    const ids = list.map((r) => r.guest.id);
    const lim = regLim[lead ? "nl" : "ospiti"];
    const shown = list.slice(0, lim);
    const clearBtn = onClear && list.length > 0 && (
      <button onClick={onClear} className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition ${confirmClearNl ? "border-[color:var(--err)] bg-[color:var(--err)] text-on-err" : "border-line text-dim hover:border-[color:var(--err)] hover:text-[color:var(--err)]"}`}>
        {confirmClearNl ? t("Conferma svuota") : `🗑 ${t("Svuota")}`}
      </button>
    );
    const allR = ids.length > 0 && ids.every((id) => sel.has(id));
    const toggleAllR = () => setSel((prev) => { const n = new Set(prev); if (allR) ids.forEach((id) => n.delete(id)); else ids.forEach((id) => n.add(id)); return n; });
    const nameCell = (guest: typeof list[number]["guest"]) => (
      <span className="flex min-w-0 items-center gap-1.5 font-medium text-txt"><span className="min-w-0 truncate">{guest.fullName ?? ""}</span>
        {guest.vip && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, #D4A017 22%, transparent)", color: "#B8860B" }}>VIP</span>}
        {repeatIds.has(guest.id) && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 18%, transparent)", color: "var(--ok)" }}>{t("Abituale")}</span>}
        {guest.tags?.includes("newsletter") && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 16%, transparent)", color: "var(--focus)" }}>Newsletter</span>}
      </span>
    );
    return (
      <div className="mb-6">
        {/* Telefono: schede */}
        <div className="md:hidden">
          <div className="mb-2 flex items-center px-1 text-sm font-bold uppercase tracking-wide text-txt">
            <button onClick={onToggle} className="flex items-center gap-1.5 py-2.5 hover:text-focus">
              <span className="text-[11px] text-faint">{open ? "▾" : "▸"}</span>{title} <span className="font-normal text-faint">· {list.length}</span>
            </button>
            {clearBtn}{confirmClearNl && onClear && <button onClick={() => setConfirmClearNl(false)} className="ml-1.5 text-[11px] font-normal normal-case text-faint hover:text-txt">{t("annulla")}</button>}
          </div>
          {open && <div className="flex flex-col gap-2">
            {shown.map(({ guest, stays, nightsTot, spent, last, topCh, topB }) => (
              <div key={guest.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-sm">
                <input type="checkbox" checked={sel.has(guest.id)} onChange={() => toggleSel(guest.id)} onClick={(e) => e.stopPropagation()} style={{ accentColor: "var(--focus)" }} className="h-5 w-5 shrink-0" />
                <button onClick={() => router.push(`/ospiti/${guest.id}`)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center justify-between gap-2">
                    {nameCell(guest)}
                    {!lead && <span className="shrink-0 font-mono font-semibold text-txt">{eur(spent)}</span>}
                  </div>
                  {lead ? (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-dim">{guest.email || phoneShown(guest) || "—"}{guest.email && guest.phone ? ` · ${phoneShown(guest)}` : ""}{guest.country ? ` · ${guest.country}` : ""}</div>
                  ) : (
                    <>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-dim">
                        {topCh && <span className="inline-flex items-center gap-1">{topB ? <BookingChannelLogo booking={topB} size={14} title={CHANNELS[topCh].label} /> : <ChannelLogo channel={topCh} size={14} title={CHANNELS[topCh].label} />}<span>{topChLabel(topCh, topB)}</span></span>}
                        <span>{stays} {t("pren.")} · {nightsTot} {t("notti")}</span>
                        {guest.country && <><span className="text-faint">·</span><span>{guest.country}</span></>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-faint">{t("Ultimo")}: {last ? fmtD(last) : "—"}{guest.phone ? ` · ${phoneShown(guest)}` : ""}</div>
                    </>
                  )}
                </button>
              </div>
            ))}
            {list.length === 0 && <div className="rounded-xl border border-line bg-surface"><EmptyState title={empty} /></div>}
          </div>}
        </div>

        {/* Tablet/desktop: tabella */}
        <div className="hidden rounded-xl border border-line bg-surface shadow-sm md:block">
          <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-txt">
            <button onClick={onToggle} className="flex items-center gap-1.5 hover:text-focus">
              <span className="text-[11px] text-faint">{open ? "▾" : "▸"}</span>{title} <span className="font-normal text-faint">· {list.length}</span>
            </button>
            {clearBtn}{confirmClearNl && onClear && <button onClick={() => setConfirmClearNl(false)} className="text-[11px] font-normal normal-case text-faint hover:text-txt">{t("annulla")}</button>}
          </div>
          {open && <div className="max-h-[62dvh] overflow-auto">
          <table className={`w-full ${lead ? "min-w-[560px]" : "min-w-[980px]"} text-sm`}>
            <thead className="sticky top-0 z-10 bg-wash">
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-dim">
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
              {shown.map(({ guest, stays, nightsTot, avg, spent, comm, last, topCh, topB }) => (
                <tr key={guest.id} onClick={() => router.push(`/ospiti/${guest.id}`)} {...keyActivate(() => router.push(`/ospiti/${guest.id}`))} className="cursor-pointer border-b border-line last:border-0 hover:bg-[color:color-mix(in_srgb,var(--focus)_6%,transparent)]">
                  <td onClick={(e) => e.stopPropagation()} className="px-3 py-2"><input type="checkbox" checked={sel.has(guest.id)} onChange={() => toggleSel(guest.id)} style={{ accentColor: "var(--focus)" }} /></td>
                  <td className="whitespace-nowrap px-3 py-2">{nameCell(guest)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-txt">{guest.phone ? phoneShown(guest) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-txt">{guest.email ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-txt">{guest.country ?? "—"}</td>
                  {!lead && <>
                    <td className="whitespace-nowrap px-3 py-2">{topCh ? (topB ? <BookingChannelWordmark booking={topB} height={16} title={CHANNELS[topCh].label} /> : <ChannelWordmark channel={topCh} height={16} title={CHANNELS[topCh].label} />) : "—"}</td>
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
          </div>}
        </div>
        {open && list.length > lim && (
          <div className="no-print mt-3 flex items-center justify-center gap-3 text-xs text-dim">
            <span>{t("Mostrati")} {lim} {t("di")} {list.length}</span>
            <button onClick={() => setRegLim((v) => ({ ...v, [lead ? "nl" : "ospiti"]: lim + PAGE }))} className="rounded-lg border border-line px-3 py-1.5 font-semibold text-txt hover:bg-wash">{t("Mostra altri")} {Math.min(PAGE, list.length - lim)}</button>
            <button onClick={() => setRegLim((v) => ({ ...v, [lead ? "nl" : "ospiti"]: list.length }))} className="rounded-lg px-2 py-1.5 font-semibold text-focus hover:underline">{t("Mostra tutti")}</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader title={t("Ospiti")} subtitle={`${totalVisible} ${t("anagrafiche")}`} />

      {/* Card statistiche */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([[t("Ospiti"), String(totGuests)], [t("Ricavi totali"), eur(totRevenue)], [t("Prezzo medio/notte"), eur(avgAll)], [t("Ospiti abituali"), `${repeat}`]] as [string, string][]).map(([lab, val]) => (
          <StatCard key={lab} label={lab} value={val} />
        ))}
      </div>

      <ContattiDaCorreggere />

      {dupCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "color-mix(in srgb, var(--warn) 40%, var(--line))", backgroundColor: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
          <span className="text-sm font-semibold text-txt">{dupCount} {t("possibili doppioni")}</span>
          <span className="text-xs text-dim">{t("Stessa persona con più schede: controlla l'anteprima e conferma, nulla viene unito da solo.")}</span>
          <button onClick={() => { setMergeSkip(new Set()); setMergeOpen(true); }} className="ml-auto rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-on-focus hover:opacity-90">{t("Rivedi e unisci")}</button>
        </div>
      )}

      {/* Ricerca + segmenti CRM + azioni, tutto in un'unica riga. Stessa griglia dei riepiloghi
          sopra: la ricerca è larga quanto una card e allineata con essa.
          Telefono: UNA riga [ricerca][Filtri][+ Nuovo ospite]; segmenti, «Seleziona segmento», Promozioni ed Excel stanno nella tendina «Filtri». */}
      <div className="mb-4 grid grid-cols-2 items-center gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-sm max-sm:mb-3 max-sm:flex max-sm:gap-2 sm:grid-cols-4">
        <SearchInput value={q} onChange={setQ} placeholder={t("Cerca per nome, email o paese…")} className="col-span-2 w-full max-sm:min-w-0 max-sm:flex-1 sm:col-span-1" />
        <FilterSheet count={seg !== "all" ? 1 : 0} onReset={() => setSeg("all")}>
          {(close) => (<>
            <div className="flex flex-wrap gap-1.5">{segChips}</div>
            {segSelectBtn}
            <div className="flex gap-2">
              <button onClick={() => router.push("/promozioni")} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-txt hover:bg-wash"><Icon name="tag" size={14} /> <span>{t("Promozioni")}</span></button>
              <button onClick={() => { close(); setExportPick(true); }} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-txt hover:bg-wash"><Icon name="fileText" size={14} /> <span>Excel</span></button>
            </div>
          </>)}
        </FilterSheet>
        <div className="col-span-2 flex flex-wrap items-center gap-1.5 max-sm:contents sm:col-span-3">
          <div className="contents max-sm:hidden">{segChips}{segSelectBtn}</div>
          <div className="ml-auto flex items-center gap-2 max-sm:contents">
            <button onClick={() => router.push("/ospiti/nuovo")} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-on-focus hover:opacity-90 max-sm:h-9 max-sm:shrink-0 max-sm:whitespace-nowrap max-sm:px-2.5 max-sm:py-0 max-sm:text-[13px]">+ {t("Nuovo ospite")}</button>
            <button onClick={() => router.push("/promozioni")} aria-label={t("Promozioni")} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash max-sm:hidden"><Icon name="tag" size={14} /> <span>{t("Promozioni")}</span></button>
            <button onClick={() => setExportPick(true)} aria-label="Excel" className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash max-sm:hidden"><Icon name="fileText" size={14} /> <span>Excel</span></button>
          </div>
        </div>
      </div>

      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "color-mix(in srgb, var(--focus) 40%, var(--line))", backgroundColor: "color-mix(in srgb, var(--focus) 6%, transparent)" }}>
          <span className="text-sm font-semibold text-txt">{sel.size} {t("selezionati")}</span>
          <span className="text-xs text-faint">· {selEmails.length} {t("contattabili via email")}{selExcluded > 0 ? ` · ${selExcluded} ${t("esclusi (senza consenso marketing o con email di inoltro)")}` : ""}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setSel(new Set())} className="rounded-lg border border-line px-3 py-1.5 text-sm text-dim hover:bg-wash">{t("Deseleziona")}</button>
            <button onClick={() => setPickPromo(true)} disabled={selEmails.length === 0} className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-on-focus hover:opacity-90 disabled:opacity-40">✉ {t("Invia promo")} ({selEmails.length})</button>
          </div>
        </div>
      )}

      <Register title={t("Registro ospiti")} list={guestSorted} empty={t("Nessun ospite in questo segmento.")} open={openReg.ospiti} onToggle={() => setOpenReg((v) => ({ ...v, ospiti: !v.ospiti }))} />
      <Register title={t("Registro newsletter")} list={nlSorted} empty={t("Nessun iscritto alla newsletter.")} lead onClear={clearNewsletter} open={openReg.nl} onToggle={() => setOpenReg((v) => ({ ...v, nl: !v.nl }))} />

      {mergeOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[6dvh]">
          <button aria-label="Chiudi" onClick={() => setMergeOpen(false)} className="fixed inset-0 bg-black/40" />
          <div className="relative w-full max-w-2xl rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><span className="font-display text-lg font-bold text-txt">{t("Unisci i doppioni")}</span><button onClick={() => setMergeOpen(false)} aria-label="Chiudi" className="rounded px-2 py-1 text-dim hover:bg-wash max-sm:px-3 max-sm:py-2.5">✕</button></div>
            <div className="mb-3 text-xs text-dim">{t("Per ogni gruppo resta la scheda con più prenotazioni: le prenotazioni delle altre le passano e i campi mancanti vengono completati (tag in unione, VIP e consenso marketing se presenti in una delle schede, note accodate). L'unione non si può annullare: togli la spunta ai gruppi che non sono la stessa persona.")}</div>
            <div className="flex flex-col gap-3">
              {mergePlans.map((p) => {
                const off = mergeSkip.has(p.keepId);
                return (
                  <div key={p.keepId} className={`rounded-xl border border-line p-3 ${off ? "opacity-50" : ""}`}>
                    <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-txt">
                      <input type="checkbox" checked={!off} onChange={() => setMergeSkip((s) => { const n = new Set(s); if (n.has(p.keepId)) n.delete(p.keepId); else n.add(p.keepId); return n; })} className="h-4 w-4 accent-[color:var(--focus)]" />
                      {t("Unisci")} {p.dropped.length + 1} {t("schede")}
                    </label>
                    <div className="flex flex-col gap-1">
                      {[p.keeper, ...p.dropped].map((g) => (
                        <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                          <span className={`w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-bold uppercase ${g.id === p.keepId ? "bg-[color:color-mix(in_srgb,var(--ok)_18%,transparent)] text-[color:var(--ok)]" : "bg-wash text-dim"}`}>{g.id === p.keepId ? t("resta") : t("si unisce")}</span>
                          <b className="text-txt">{g.fullName || [g.firstName, g.lastName].filter(Boolean).join(" ") || "—"}</b>
                          <span className="text-dim">{g.email || "—"}</span>
                          <span className="text-dim">{g.phone ? phoneShown(g) : "—"}</span>
                          <span className="text-faint">{g.country || ""}</span>
                          <span className="ml-auto text-faint">{bookingCount.get(g.id) ?? 0} {t("prenotazioni")}</span>
                        </div>
                      ))}
                    </div>
                    {Object.keys(p.patch).length > 0 && <div className="mt-2 text-[11px] text-faint">{t("Si aggiunge alla scheda che resta")}: {[...new Set(Object.keys(p.patch).map((k) => t(PATCH_LABELS[k] ?? k)))].join(", ")}</div>}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-4">
              <button onClick={() => setMergeOpen(false)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
              <button onClick={doMerge} disabled={mergePlans.every((p) => mergeSkip.has(p.keepId))} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-on-focus hover:opacity-90 disabled:opacity-40">{t("Unisci")} ({mergePlans.filter((p) => !mergeSkip.has(p.keepId)).length})</button>
            </div>
          </div>
        </div>
      )}

      {exportPick && (
        <div className="fixed inset-0 z-50 flex overflow-y-auto p-4">
          <button aria-label="Chiudi" onClick={() => setExportPick(false)} className="fixed inset-0 bg-black/40" />
          <div className="relative m-auto w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><span className="font-display text-lg font-bold text-txt">{t("Esporta ospiti in Excel")}</span><button onClick={() => setExportPick(false)} aria-label="Chiudi" className="rounded px-2 py-1 text-dim hover:bg-wash max-sm:px-3 max-sm:py-2.5">✕</button></div>
            <div className="mb-3 text-xs text-dim">{guestSorted.length} {t("ospiti nel segmento corrente")} · {t("scegli le colonne")}</div>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {EXPORT_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm text-txt hover:bg-wash">
                  <input type="checkbox" checked={exportCols.has(c.key)} onChange={() => toggleExportCol(c.key)} className="h-4 w-4 accent-[color:var(--focus)]" />
                  {c.label}
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2 text-xs">
                <button onClick={() => setExportCols(new Set(EXPORT_COLUMNS.map((c) => c.key)))} className="font-semibold text-focus hover:underline">{t("Tutte")}</button>
                <button onClick={() => setExportCols(new Set())} className="font-semibold text-dim hover:underline">{t("Nessuna")}</button>
              </div>
              <button onClick={doExportExcel} disabled={exportCols.size === 0} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-on-focus hover:opacity-90 disabled:opacity-40">⬇ {t("Esporta")}</button>
            </div>
          </div>
        </div>
      )}

      {pickPromo && (
        <div className="fixed inset-0 z-50 flex overflow-y-auto p-4">
          <button aria-label="Chiudi" onClick={() => setPickPromo(false)} className="fixed inset-0 bg-black/40" />
          <div className="relative m-auto w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><span className="font-display text-lg font-bold text-txt">{t("Scegli la promo da inviare")}</span><button onClick={() => setPickPromo(false)} aria-label="Chiudi" className="rounded px-2 py-1 text-dim max-sm:px-3 max-sm:py-2.5 hover:bg-wash">✕</button></div>
            <div className="mb-3 text-xs text-dim">{selEmails.length} {t("destinatari con email")}</div>
            {promos.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-faint">{t("Nessuna promo salvata.")} <button onClick={() => router.push("/promozioni")} className="font-semibold text-focus hover:underline">{t("Creane una")}</button></div>
            ) : (
              <div className="flex flex-col gap-2">
                {promos.map((p) => (
                  <button key={p.id} onClick={() => sendPromoTo(p)} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left hover:border-focus hover:bg-wash">
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-txt">{p.name}</div><div className="truncate text-[11px] text-faint">{p.subject}</div></div>
                    {p.discountPct ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>-{p.discountPct}%</span> : null}
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
