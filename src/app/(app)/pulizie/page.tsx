"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { sortUnitsByName } from "@/lib/sortUnits";
import { CHANNELS, type Channel, type Booking } from "@/lib/types";
import { toISO, parseISO, addDays, nights } from "@/lib/dates";
import { playSound } from "@/lib/sound";
import { PageHeader } from "@/components/ui";
import WeatherWidget from "@/components/WeatherWidget";
import PageHelp from "@/components/PageHelp";
import Icon from "@/components/Icon";
import DateField from "@/components/DateField";
import { useLang } from "@/lib/i18n";

const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
const fmtShort = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
const fmtLong = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" });

// Colore identificativo per struttura (per distinguerle nella vista "Tutte le strutture").
const STRUCT_COLORS = ["#4F46E5", "#2F9E6F", "#C08A3A", "#B3453A", "#0891B2", "#DB2777"];

type ActionKey = "turnover" | "arrivo" | "partenza" | "riassetto" | "niente";
const ACT: Record<ActionKey, { label: string; color: string }> = {
  turnover: { label: "Partenza + Arrivo", color: "#7C3AED" },
  arrivo: { label: "Arrivo", color: "var(--ok)" },
  partenza: { label: "Partenza", color: "var(--err)" },
  riassetto: { label: "Riassetto", color: "var(--warn)" },
  niente: { label: "Niente", color: "var(--faint)" },
};

interface Issue { id: string; unitId: string; unitName: string; structureName: string; date: string; type: string; note: string; photo?: string; createdAt: string; resolved?: boolean; resolvedAt?: string }
const ISSUE_TYPES: { key: string; label: string; icon: string; color: string }[] = [
  { key: "guasto", label: "Guasto / manutenzione", icon: "settings", color: "var(--err)" },
  { key: "danno", label: "Danno / macchia", icon: "logout", color: "var(--warn)" },
  { key: "smarrito", label: "Oggetto smarrito", icon: "search", color: "var(--focus)" },
  { key: "scorte", label: "Scorte finite", icon: "clipboard", color: "var(--ok)" },
  { key: "altro", label: "Altro", icon: "chat", color: "var(--dim)" },
];
const issueMeta = (key: string) => ISSUE_TYPES.find((x) => x.key === key) ?? ISSUE_TYPES[ISSUE_TYPES.length - 1];

type StockStatus = "ok" | "low" | "out";
interface Prod { id: string; name: string; structureId: string; qty: number; min: number; supplier?: string }
interface Order { id: string; productId: string; productName: string; structureId: string; date: string; qty: number; cost?: number }
const DEFAULT_PRODUCTS = ["Carta igienica", "Prodotti cortesia (kit bagno)", "Anticalcare", "Detergente vetri", "Sgrassatore cucina", "Detersivo pavimenti", "Sapone mani", "Sacchi spazzatura", "Spugne e panni", "Shampoo / bagnoschiuma"];
const statusOf = (p: Prod): StockStatus => (p.qty <= 0 ? "out" : p.qty <= p.min ? "low" : "ok");
const STOCK_STATUS: { key: StockStatus; label: string; short: string; color: string }[] = [
  { key: "ok", label: "Disponibile", short: "Disp.", color: "var(--ok)" },
  { key: "low", label: "In esaurimento", short: "In esaur.", color: "#CA8A04" },
  { key: "out", label: "Terminato", short: "Terminato", color: "var(--err)" },
];
const stockMeta = (key: StockStatus) => STOCK_STATUS.find((s) => s.key === key) ?? STOCK_STATUS[0];

export default function PuliziePage() {
  const { bookings, units, roomTypes, structures, guests, activeStructureId } = useData();
  const { t } = useLang();
  const todayISO = toISO(new Date());
  const [date, setDate] = useState(todayISO);
  const [view, setView] = useState<"rows" | "cards">("rows");
  const [structFilter, setStructFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState<"tutte" | "dafare" | "riassetto" | "partenze" | "arrivi">("tutte");
  const matchAction = (action: ActionKey) => {
    if (actionFilter === "tutte") return true; // all'apertura: tutte le camere
    if (actionFilter === "dafare") return action !== "niente"; // "Da fare": nascondi le camere senza nulla
    if (actionFilter === "riassetto") return action === "riassetto";
    if (actionFilter === "partenze") return action === "partenza" || action === "turnover";
    if (actionFilter === "arrivi") return action === "arrivo" || action === "turnover";
    return true;
  };
  const [done, setDone] = useState<Record<string, string>>({}); // key → ISO datetime del "fatto"
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Issue[]>([]);
  useEffect(() => { try { const d = localStorage.getItem("spigolestay:pulizie:done"); if (d) setDone(JSON.parse(d)); const n = localStorage.getItem("spigolestay:pulizie:notes"); if (n) setNotes(JSON.parse(n)); const s = localStorage.getItem("spigolestay:pulizie:issues"); if (s) setIssues(JSON.parse(s)); } catch {} }, []);
  const persistIssues = (next: Issue[]) => { setIssues(next); try { localStorage.setItem("spigolestay:pulizie:issues", JSON.stringify(next)); } catch {} };
  const [issueDraft, setIssueDraft] = useState<null | { unitId: string; unitName: string; structureName: string; type: string; note: string; photo?: string }>(null);
  const [showResolved, setShowResolved] = useState(false);
  const saveIssue = () => { if (!issueDraft || !issueDraft.note.trim()) return; const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()); persistIssues([{ id, unitId: issueDraft.unitId, unitName: issueDraft.unitName, structureName: issueDraft.structureName, date, type: issueDraft.type, note: issueDraft.note.trim(), photo: issueDraft.photo, createdAt: new Date().toISOString(), resolved: false }, ...issues]); playSound("done"); notify(`⚠ Segnalazione · ${issueDraft.unitName}`, `${issueMeta(issueDraft.type).label}: ${issueDraft.note.trim()}`); setIssueDraft(null); };
  const resolveIssue = (id: string) => persistIssues(issues.map((i) => (i.id === id ? { ...i, resolved: true, resolvedAt: new Date().toISOString() } : i)));
  const reopenIssue = (id: string) => persistIssues(issues.map((i) => (i.id === id ? { ...i, resolved: false, resolvedAt: undefined } : i)));
  const deleteIssue = (id: string) => persistIssues(issues.filter((i) => i.id !== id));
  const onIssuePhoto = (file: File | undefined) => { if (!file) return; const reader = new FileReader(); reader.onload = () => setIssueDraft((d) => (d ? { ...d, photo: reader.result as string } : d)); reader.readAsDataURL(file); };
  const openIssues = issues.filter((i) => !i.resolved);
  const resolvedIssues = issues.filter((i) => i.resolved).sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt));
  const roomHasIssue = (unitId: string) => openIssues.some((i) => i.unitId === unitId && i.date === date);

  // Scorte / lista della spesa (prodotti ricorrenti).
  const [tab, setTab] = useState<"planning" | "scorte">("planning");
  const [stock, setStock] = useState<Prod[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [prodDraft, setProdDraft] = useState<null | { id?: string; name: string; structureId: string; supplier: string; qty: number; min: number; applyAll?: boolean }>(null);
  const [prodSearch, setProdSearch] = useState("");
  const [prodFilter, setProdFilter] = useState<"all" | StockStatus>("all");
  const [shopSearch, setShopSearch] = useState("");
  const [shopFilter, setShopFilter] = useState<"all" | "low" | "out">("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const stockSeeded = useRef(false);
  useEffect(() => {
    if (stockSeeded.current) return;
    try {
      const rawO = localStorage.getItem("spigolestay:pulizie:orders"); if (rawO) setOrders(JSON.parse(rawO));
      const raw = localStorage.getItem("spigolestay:pulizie:stock");
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p) && p.length && p[0].structureId && p[0].qty !== undefined) { setStock(p); stockSeeded.current = true; return; }
        if (Array.isArray(p) && p.length && p[0].structureId) { setStock(p.map((o: { id?: string; name: string; structureId: string; supplier?: string; status?: string }, i: number) => ({ id: o.id ?? `m${i}`, name: o.name, structureId: o.structureId, supplier: o.supplier ?? "", min: 1, qty: o.status === "out" ? 0 : o.status === "low" ? 1 : 3 }))); stockSeeded.current = true; return; }
      }
    } catch {}
    if (structures.length) { setStock(structures.flatMap((s) => DEFAULT_PRODUCTS.map((name, i) => ({ id: `${s.id}-p${i}`, name, structureId: s.id, supplier: "", min: 1, qty: 3 })))); stockSeeded.current = true; }
  }, [structures]);
  const persistStock = (next: Prod[]) => { setStock(next); try { localStorage.setItem("spigolestay:pulizie:stock", JSON.stringify(next)); } catch {} };
  const persistOrders = (next: Order[]) => { setOrders(next); try { localStorage.setItem("spigolestay:pulizie:orders", JSON.stringify(next)); } catch {} };
  const setQty = (id: string, qty: number) => persistStock(stock.map((p) => (p.id === id ? { ...p, qty: Math.max(0, qty) } : p)));
  // Pulsanti rapidi (per la signora): impostano la giacenza in base allo stato scelto.
  const setStatusQuick = (p: Prod, s: StockStatus) => setQty(p.id, s === "out" ? 0 : s === "low" ? Math.max(1, p.min) : p.qty > p.min ? p.qty : p.min + 1);
  const newProdId = () => ((typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  const saveProd = () => {
    const d = prodDraft; if (!d || !d.name.trim()) return;
    const name = d.name.trim(); const supplier = d.supplier.trim() || undefined; const qty = Math.max(0, d.qty); const min = Math.max(0, d.min);
    if (d.id) persistStock(stock.map((p) => (p.id === d.id ? { ...p, name, structureId: d.structureId || p.structureId, supplier, qty, min } : p)));
    else if (d.applyAll && activeStructureId === "all") persistStock([...stock, ...structures.map((s) => ({ id: newProdId(), name, structureId: s.id, supplier, qty, min }))]);
    else { const sid = d.structureId || (activeStructureId !== "all" ? activeStructureId : structures[0]?.id) || ""; if (!sid) return; persistStock([...stock, { id: newProdId(), name, structureId: sid, supplier, qty, min }]); }
    setProdDraft(null);
  };
  const delProd = (id: string) => persistStock(stock.filter((p) => p.id !== id));
  const [confirmDelProd, setConfirmDelProd] = useState<Prod | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [restock, setRestock] = useState<null | { product: Prod; qty: number; cost: string }>(null);
  const doRestock = () => { const r = restock; if (!r || r.qty <= 0) return; setQty(r.product.id, r.product.qty + r.qty); const c = r.cost.trim() ? Number(r.cost.replace(",", ".")) : undefined; const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()); persistOrders([{ id, productId: r.product.id, productName: r.product.name, structureId: r.product.structureId, date: new Date().toISOString(), qty: r.qty, cost: Number.isFinite(c as number) ? c : undefined }, ...orders]); setRestock(null); };
  // Ambito: se una struttura è attiva mostro solo le sue scorte; con "tutte" le mostro raggruppate.
  const scopeStructures = activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId);
  const scopeIds = scopeStructures.map((s) => s.id);
  const stockScoped = stock.filter((p) => scopeIds.includes(p.structureId));
  const structNameOf = (id: string) => structures.find((s) => s.id === id)?.name ?? "";
  // Colore della struttura: quello scelto nella scheda struttura (photoColor); in mancanza, palette di riserva.
  const structColorOf = (id: string) => structures.find((s) => s.id === id)?.photoColor || STRUCT_COLORS[Math.max(0, structures.findIndex((s) => s.id === id)) % STRUCT_COLORS.length];
  const structInitials = (id: string) => structNameOf(id).split(/\s+/).map((w) => w[0] || "").join("").slice(0, 3).toUpperCase();
  const structOrder = (id: string) => structures.findIndex((s) => s.id === id);
  const eur = (n: number) => "€ " + (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
  const shopList = stockScoped.filter((p) => statusOf(p) !== "ok");
  const suppliers = [...new Set(shopList.map((p) => p.supplier || "").filter(Boolean))];
  const byName = (a: Prod, b: Prod) => a.name.localeCompare(b.name, "it", { sensitivity: "base" });
  const shopFiltered = shopList.filter((p) => (shopFilter === "all" || statusOf(p) === shopFilter) && (supplierFilter === "all" || (p.supplier || "") === supplierFilter) && (!shopSearch.trim() || p.name.toLowerCase().includes(shopSearch.trim().toLowerCase()))).sort(byName);
  const stockFiltered = stockScoped.filter((p) => (prodFilter === "all" || statusOf(p) === prodFilter) && (!prodSearch.trim() || p.name.toLowerCase().includes(prodSearch.trim().toLowerCase()))).sort(byName);
  const stockCounts = { all: stockScoped.length, ok: stockScoped.filter((p) => statusOf(p) === "ok").length, low: stockScoped.filter((p) => statusOf(p) === "low").length, out: stockScoped.filter((p) => statusOf(p) === "out").length };
  const shopLine = (p: Prod) => `• ${p.name}${statusOf(p) === "low" ? ` (${t("in esaurimento")})` : ""}${p.supplier ? ` — ${p.supplier}` : ""}`;
  const buildShopText = () => {
    const struct = activeStructureId === "all" ? "" : (scopeStructures[0]?.name ?? "");
    const lines = [`🛒 ${t("Lista della spesa")}`, `📅 ${fmtLong(date)}${struct ? ` · ${struct}` : ""}`];
    if (shopList.length === 0) { lines.push("", t("Tutto a posto.")); return lines.join("\n"); }
    if (activeStructureId === "all") { for (const s of scopeStructures) { const its = shopList.filter((p) => p.structureId === s.id); if (its.length) lines.push("", `*${s.name}*`, ...its.map(shopLine)); } }
    else lines.push("", ...shopList.map(shopLine));
    return lines.join("\n");
  };
  const shareShop = () => window.open(`https://wa.me/?text=${encodeURIComponent(buildShopText())}`, "_blank", "noopener,noreferrer");
  const copyShop = async () => { try { await navigator.clipboard.writeText(buildShopText()); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch {} };
  const emailShop = () => { window.open(`mailto:?subject=${encodeURIComponent(t("Lista della spesa"))}&body=${encodeURIComponent(buildShopText())}`); };
  const [shareOpen, setShareOpen] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const toggleDone = (k: string) => {
    const next = { ...done };
    const wasDone = !!next[k];
    if (wasDone) delete next[k]; else { next[k] = new Date().toISOString(); playSound("done"); }
    setDone(next);
    try { localStorage.setItem("spigolestay:pulizie:done", JSON.stringify(next)); } catch {}
    if (!wasDone) { const left = toClean.filter((r) => !next[keyOf(r.unit.id)]).length; if (left === 0 && toClean.length > 0) notify("Pulizie completate ✓", `Tutte le ${toClean.length} camere sono pronte.`); }
  };
  const setNote = (k: string, v: string) => setNotes((n) => { const next = { ...n, [k]: v }; try { localStorage.setItem("spigolestay:pulizie:notes", JSON.stringify(next)); } catch {} return next; });
  const doneTime = (k: string) => { const iso = done[k]; if (!iso) return ""; try { return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
  const [copied, setCopied] = useState(false);
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "";
  const hasDog = (id: string) => (guests.find((g) => g.id === id)?.tags ?? []).includes("Animali");
  const keyOf = (unitId: string) => `${unitId}:${date}`;

  const active = bookings.filter((b) => b.status !== "cancelled" && (activeStructureId === "all" || b.structureId === activeStructureId));
  const scopedStructures = structures.filter((s) =>
    activeStructureId === "all" ? structFilter === "all" || s.id === structFilter : s.id === activeStructureId
  );

  const planFor = (unitId: string) => {
    const dep = active.find((b) => b.unitId === unitId && b.checkOut === date);
    const arr = active.find((b) => b.unitId === unitId && b.checkIn === date);
    const stay = active.find((b) => b.unitId === unitId && b.checkIn < date && date < b.checkOut);
    let action: ActionKey = "niente";
    if (dep && arr) action = "turnover";
    else if (dep) action = "partenza";
    else if (arr) action = "arrivo";
    else if (stay) action = "riassetto";
    return { action, dep, arr, stay };
  };

  const rooms = scopedStructures.flatMap((s) => {
    // Stesso ordine di Camere: prima raggruppate per tipologia (nell'ordine delle tipologie),
    // poi dentro ogni tipologia per ordine manuale / numero.
    const su = units.filter((u) => u.structureId === s.id);
    const tps = roomTypes.filter((rt) => rt.structureId === s.id);
    // Colore della tipologia: quello assegnato alla tipologia; in mancanza, una palette di riserva per posizione.
    const colorOfType = (rtId: string) => { const idx = tps.findIndex((rt) => rt.id === rtId); return tps[idx]?.color || STRUCT_COLORS[(idx < 0 ? 0 : idx) % STRUCT_COLORS.length]; };
    const ordered = [
      ...tps.flatMap((rt) => sortUnitsByName(su.filter((u) => u.roomTypeId === rt.id))),
      ...sortUnitsByName(su.filter((u) => !tps.some((rt) => rt.id === u.roomTypeId))),
    ];
    return ordered.map((u) => ({ unit: u, structure: s, typeName: roomTypes.find((x) => x.id === u.roomTypeId)?.name ?? "", typeColor: colorOfType(u.roomTypeId), oos: !!u.outOfService, ...planFor(u.id) }));
  });
  type Room = (typeof rooms)[number];

  const toClean = rooms.filter((r) => !r.oos && r.action !== "niente");
  const remaining = toClean.filter((r) => !done[keyOf(r.unit.id)]).length;
  const counts = {
    turnover: rooms.filter((r) => r.action === "turnover").length,
    arrivo: rooms.filter((r) => r.action === "arrivo").length,
    partenza: rooms.filter((r) => r.action === "partenza").length,
    riassetto: rooms.filter((r) => r.action === "riassetto").length,
  };

  // Carico biancheria del giorno: cambi completi (partenza/arrivo/turnover) + asciugamani per ospite presente + tappetino bagno per ogni arrivo.
  const linen = (() => {
    let matr = 0, sing = 0, guests = 0, changeRooms = 0, mats = 0;
    for (const r of toClean) {
      const beds = roomTypes.find((x) => x.id === r.unit.roomTypeId)?.beds ?? 1;
      if (r.action !== "riassetto") { changeRooms++; matr += beds >= 2 ? 1 : 0; sing += beds >= 2 ? beds - 2 : beds; }
      if (r.arr) mats++; // un tappetino bagno pulito per ogni arrivo
      const p = r.arr ?? r.stay ?? r.dep;
      guests += p ? p.adults + p.children : 0;
    }
    return { changeRooms, matr, sing, federe: matr * 2 + sing, towels: guests, mats };
  })();

  // Notifiche: avvisa quando la signora segnala un problema o completa tutte le pulizie.
  // Notifiche sempre attive: chiedo il permesso una volta all'avvio (nessun interruttore da gestire).
  useEffect(() => { try { if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {}); } catch {} }, []);
  const notify = (title: string, body: string) => { try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body }); } catch {} };

  // Testo del programma da condividere con la signora delle pulizie.
  const buildPlanText = () => {
    const lines: string[] = [`🧹 ${t("Pulizie")} · ${fmtLong(date)}`];
    for (const s of scopedStructures) {
      const list = rooms.filter((r) => r.structure.id === s.id && !r.oos && r.action !== "niente" && matchAction(r.action));
      if (!list.length) continue;
      lines.push("", `*${s.name}*`);
      for (const r of list) {
        const note = notes[keyOf(r.unit.id)]?.trim();
        const suffix = note ? ` [${note}]` : "";
        if (r.action === "turnover" && r.dep && r.arr) {
          lines.push(`• ${r.unit.name}: ${t("PARTENZA + ARRIVO — parte")} ${guestName(r.dep.guestId)} (${r.dep.adults + r.dep.children} ${t("persone")}), ${t("poi arriva")} ${guestName(r.arr.guestId)} (${r.arr.adults + r.arr.children} ${t("persone")}, ${fmt(r.arr.checkIn)}→${fmt(r.arr.checkOut)})${suffix}`);
        } else {
          const p = r.arr ?? r.dep ?? r.stay;
          const io = p ? ` (${fmt(p.checkIn)}→${fmt(p.checkOut)}, ${p.adults + p.children} ${t("persone")})` : "";
          const who = p ? ` — ${guestName(p.guestId)}` : "";
          lines.push(`• ${r.unit.name}: ${t(ACT[r.action].label)}${who}${io}${suffix}`);
        }
      }
    }
    if (lines.length === 1) lines.push("", t("Nessuna pulizia in programma."));
    return lines.join("\n");
  };
  const shareWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(buildPlanText())}`, "_blank", "noopener,noreferrer");
  const emailPlan = () => window.open(`mailto:?subject=${encodeURIComponent(t("Planning pulizie"))}&body=${encodeURIComponent(buildPlanText())}`);
  const copyPlan = async () => { try { await navigator.clipboard.writeText(buildPlanText()); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch {} };
  const [planShare, setPlanShare] = useState(false);

  const noteInput = (k: string) => (
    <input
      value={notes[k] ?? ""}
      onChange={(e) => setNote(k, e.target.value)}
      placeholder={t("Nota: culla, asciugamani, richieste…")}
      className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-txt outline-none placeholder:text-faint focus:border-focus"
    />
  );
  const Seg = ({ v, icon, title }: { v: "rows" | "cards"; icon: string; title: string }) => (
    <button onClick={() => setView(v)} title={title} className={`rounded-md p-1.5 transition ${view === v ? "bg-focus text-white" : "text-dim hover:text-txt"}`}><Icon name={icon} size={16} /></button>
  );

  // Blocco icone (persone + cane) e date, come sulle card — niente parola "persone".
  const pax = (b: Booking, mode: "in" | "out" | "both") => (
    <span className="flex shrink-0 items-center gap-2 text-[11px] text-dim">
      {mode !== "out" && <span className="flex items-center gap-0.5"><span style={{ color: "var(--focus)" }}><Icon name="login" size={12} /></span><span className="font-mono">{fmtShort(b.checkIn)}</span></span>}
      {mode !== "in" && <span className="flex items-center gap-0.5"><span style={{ color: "var(--warn)" }}><Icon name="logout" size={12} /></span><span className="font-mono">{fmtShort(b.checkOut)}</span></span>}
      <span className="flex items-center gap-0.5"><Icon name="users" size={12} />{b.adults + b.children}</span>
      {hasDog(b.guestId) && <span className="flex items-center gap-0.5" title={t("Ospite con animale")} style={{ color: "var(--warn)" }}><Icon name="paw" size={13} /></span>}
    </span>
  );

  // Riga descrittiva per la vista "Righe" — struttura uniforme: sempre "Arriva" (o "nessun arrivo") e "Parte".
  const details = (r: Room) => (
    <div className="flex flex-col gap-1 text-dim">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="flex items-center gap-0.5 font-semibold" style={{ color: r.arr ? "var(--focus)" : "var(--faint)" }}><Icon name="login" size={12} /> {t("Arriva:")}</span>
        {r.arr
          ? <><span className="font-medium text-txt">{guestName(r.arr.guestId)}</span><span className="text-faint">· {CHANNELS[r.arr.channel].label}</span>{pax(r.arr, "both")}</>
          : <span className="text-faint">{t("nessun arrivo")}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="flex items-center gap-0.5 font-semibold" style={{ color: r.dep ? "var(--warn)" : "var(--faint)" }}><Icon name="logout" size={12} /> {t("Parte:")}</span>
        {r.dep
          ? <><span className="font-medium text-txt">{guestName(r.dep.guestId)}</span>{pax(r.dep, "out")}</>
          : <span className="text-faint">{t("nessuna partenza")}</span>}
      </div>
      {!r.arr && !r.dep && r.stay && <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="font-semibold text-dim">{t("In soggiorno:")}</span><span className="font-medium text-txt">{guestName(r.stay.guestId)}</span>{pax(r.stay, "both")}</div>}
      {(r.arr ?? r.stay)?.note && <div className="flex items-start gap-1.5 rounded-lg px-2 py-1 text-[11px]" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 10%, transparent)", color: "var(--txt)" }}><span>🗒</span><span><b className="text-focus">{t("Nota ospite:")}</b> {(r.arr ?? r.stay)!.note}</span></div>}
    </div>
  );

  const prodRow = (p: Prod) => { const st = statusOf(p); const sm = stockMeta(st); const low = st !== "ok"; return (
    <div key={p.id} className="flex flex-wrap items-center gap-2 py-2 pl-2.5" style={{ borderLeft: `3px solid ${low ? sm.color : "transparent"}` }}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-txt">{p.name}</div>
        {p.supplier && <div className="truncate text-[10px] leading-tight text-faint">{p.supplier}</div>}
      </div>
      {/* Pulsanti stato — semplici per la signora */}
      <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-line">
        {STOCK_STATUS.map((s, i) => (
          <button key={s.key} onClick={() => setStatusQuick(p, s.key)} title={t(s.label)} className={`px-2.5 py-1 text-xs font-semibold transition ${i > 0 ? "border-l border-line" : ""} ${st === s.key ? "text-white" : "text-dim hover:bg-wash"}`} style={st === s.key ? { backgroundColor: s.color } : undefined}>{t(s.short)}</button>
        ))}
      </div>
      <div className="relative shrink-0" data-prodmenu>
        <button onClick={() => setRowMenu(rowMenu === p.id ? null : p.id)} title={t("Altre azioni")} className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-wash hover:text-txt">⋯</button>
        {rowMenu === p.id && (<>
          <button className="fixed inset-0 z-30 cursor-default" aria-label="Chiudi" onClick={() => setRowMenu(null)} />
          <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl">
            <button onClick={() => { setStatusQuick(p, "ok"); setRowMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-txt hover:bg-wash"><span className="text-[color:var(--ok)]"><Icon name="plus" size={15} /></span> {t("Riassortisci")}</button>
            <button onClick={() => { setProdDraft({ id: p.id, name: p.name, structureId: p.structureId, supplier: p.supplier ?? "", qty: p.qty, min: p.min }); setRowMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-txt hover:bg-wash"><span className="text-dim"><Icon name="settings" size={15} /></span> {t("Modifica")}</button>
            <button onClick={() => { setConfirmDelProd(p); setRowMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-[color:var(--err)] hover:bg-wash"><Icon name="trash" size={15} /> {t("Elimina")}</button>
          </div>
        </>)}
      </div>
    </div>
  ); };

  const shopItem = (p: Prod) => { const st = statusOf(p); return (
    <div key={p.id} className="flex items-center gap-1.5 rounded-md border border-line bg-paper px-2 py-1">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: st === "out" ? "var(--err)" : "#CA8A04" }} title={st === "out" ? t("Terminato") : t("In esaurimento")} />
      <span className="min-w-0 flex-1 truncate text-xs text-txt">{p.name}</span>
      {p.supplier && <span className="shrink-0 truncate text-[9px] text-faint" title={t("Fornitore")}>{p.supplier}</span>}
      <button onClick={() => setStatusQuick(p, "ok")} title={t("Riassortisci")} className="shrink-0 text-[color:var(--ok)] hover:opacity-70">✓</button>
    </div>
  ); };

  return (
    <div>
      <PageHeader title={t("Planning pulizie")} subtitle={t("Cosa fare in ogni camera oggi, da condividere con chi pulisce")} hideHelp />

      {/* Selettore: Pulizie / Scorte · meteo e "?" in linea, a destra */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-line bg-surface p-0.5 shadow-sm">
          {([["planning", "Pulizie"], ["scorte", "Scorte & spesa"]] as ["planning" | "scorte", string][]).map(([v, lab]) => (
            <button key={v} onClick={() => setTab(v)} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === v ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>
              <Icon name={v === "planning" ? "sparkles" : "clipboard"} size={15} /> {t(lab)}
              {v === "scorte" && shopList.length > 0 && <span className="rounded-full bg-[color:var(--err)] px-1.5 text-[10px] font-bold text-white">{shopList.length}</span>}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3"><WeatherWidget compact /><PageHelp /></div>
      </div>

      {tab === "scorte" ? (
        <div className="flex flex-col gap-4">
          {/* Split: Prodotti (sinistra) · Lista della spesa (destra). Impilato su mobile. */}
          <div className="grid gap-4 lg:grid-cols-2">
          {/* Riga filtri Lista spesa — riga 1 col destra (order 3 mobile / 2 desktop) */}
          {(() => { const empty = shopList.length === 0; return (
            <div className="order-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm lg:order-2">
              <div className="ml-auto flex items-center gap-2">
                <button disabled={empty} onClick={() => persistStock(stock.map((p) => (scopeIds.includes(p.structureId) && statusOf(p) !== "ok" ? { ...p, qty: p.min + 2 } : p)))} className="whitespace-nowrap rounded-lg border border-line px-3 py-2 text-sm font-semibold text-[color:var(--ok)] hover:bg-wash disabled:opacity-40 disabled:hover:bg-transparent">{t("Tutto riassortito")}</button>
                <button disabled={empty} onClick={copyShop} className="whitespace-nowrap rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash disabled:opacity-40">{t("Copia")}</button>
                <button disabled={empty} onClick={shareShop} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "#25D366" }}>{t("Condividi")}</button>
              </div>
            </div>
          ); })()}

          {/* Lista della spesa (da ordinare) — riga 2 col destra */}
          <div className="order-4 rounded-xl border bg-surface p-3 shadow-sm lg:flex lg:h-[34rem] lg:flex-col" style={{ borderColor: shopList.length ? "color-mix(in srgb, var(--err) 40%, var(--line))" : "var(--line)" }}>
            <div className={`flex flex-wrap items-center gap-2 ${shopList.length ? "mb-2" : ""}`}>
              <span className="flex items-center gap-1.5 text-sm font-bold text-txt"><Icon name="clipboard" size={16} /> {t("Lista della spesa")} <span className="text-faint">· {shopList.length}</span></span>
              {shopList.length === 0 && <span className="flex items-center gap-1.5 text-xs text-dim"><span className="font-bold text-[color:var(--ok)]">✓</span> {t("Tutto a posto, niente da ordinare.")}</span>}
              {copied && <span className="ml-auto text-xs font-medium text-[color:var(--ok)]">{t("Copiato ✓")}</span>}
            </div>
            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {shopList.length > 0 && (shopFiltered.length === 0 ? (
              <div className="py-3 text-center text-xs text-faint">{t("Nessun prodotto trovato.")}</div>
            ) : activeStructureId === "all" ? (
              <div>
                {scopeStructures.map((s) => { const items = shopFiltered.filter((p) => p.structureId === s.id); if (!items.length) return null; const sc = structColorOf(s.id); return (
                  <div key={s.id} className="mb-2 overflow-hidden rounded-lg border" style={{ borderColor: `color-mix(in srgb, ${sc} 35%, var(--line))` }}>
                    <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ backgroundColor: `color-mix(in srgb, ${sc} 14%, var(--surface))`, color: sc, borderBottom: `1px solid color-mix(in srgb, ${sc} 30%, var(--line))` }}>
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: sc }} /> {s.name} <span className="opacity-70">· {items.length}</span>
                    </div>
                    <div className="grid gap-1 p-2 sm:grid-cols-2">{items.map(shopItem)}</div>
                  </div>
                ); })}
              </div>
            ) : (
              <div className="grid gap-1 sm:grid-cols-3">
                {shopFiltered.map(shopItem)}
              </div>
            ))}
            </div>
          </div>
          {/* Riga filtri Prodotti — riga 1 col sinistra (order 1) */}
          <div className="order-1 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"><Icon name="search" size={14} /></span>
              <input value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} placeholder={t("Cerca prodotto…")} className="w-full rounded-lg border border-line bg-paper py-1.5 pl-8 pr-7 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
              {prodSearch && <button onClick={() => setProdSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-txt">✕</button>}
            </div>
            <div className="flex items-center overflow-hidden rounded-lg border border-line">
              {([["all", "Tutti", stockCounts.all], ["ok", "Disponibili", stockCounts.ok], ["low", "In esaurimento", stockCounts.low], ["out", "Esauriti", stockCounts.out]] as ["all" | StockStatus, string, number][]).map(([k, lab, n], i) => (
                <button key={k} onClick={() => setProdFilter(k)} className={`px-3 py-1.5 text-xs font-semibold transition ${i > 0 ? "border-l border-line" : ""} ${prodFilter === k ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>{t(lab)} <span className={prodFilter === k ? "opacity-90" : "text-faint"}>{n}</span></button>
              ))}
            </div>
            <button onClick={() => setProdDraft({ name: "", structureId: activeStructureId !== "all" ? activeStructureId : (structures[0]?.id ?? ""), supplier: "", qty: 3, min: 1 })} className="ml-auto flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90"><Icon name="plus" size={14} /> {t("Aggiungi")}</button>
          </div>

          {/* Inventario prodotti — riga 2 col sinistra (order 2 mobile / 3 desktop) */}
          <div className="order-2 rounded-xl border border-line bg-surface p-3 shadow-sm lg:order-3 lg:flex lg:h-[34rem] lg:flex-col">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-txt"><Icon name="grid" size={16} /> {t("Prodotti")} <span className="text-faint">· {stockFiltered.length}/{stock.length}</span></div>
            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              {stockFiltered.length === 0 && <div className="py-4 text-center text-xs text-faint">{t("Nessun prodotto trovato.")}</div>}
              {activeStructureId === "all" ? (
                scopeStructures.map((s) => { const items = stockFiltered.filter((p) => p.structureId === s.id); if (!items.length) return null; const sc = structColorOf(s.id); return (
                  <div key={s.id} className="mb-2 overflow-hidden rounded-lg border" style={{ borderColor: `color-mix(in srgb, ${sc} 35%, var(--line))` }}>
                    <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ backgroundColor: `color-mix(in srgb, ${sc} 14%, var(--surface))`, color: sc, borderBottom: `1px solid color-mix(in srgb, ${sc} 30%, var(--line))` }}>
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: sc }} /> {s.name} <span className="opacity-70">· {items.length}</span>
                    </div>
                    <div className="flex flex-col divide-y divide-[color:var(--line)] px-2.5">{items.map(prodRow)}</div>
                  </div>
                ); })
              ) : (
                <div className="flex flex-col divide-y divide-[color:var(--line)]">{stockFiltered.map(prodRow)}</div>
              )}
            </div>
            <p className="mt-2 text-[11px] text-faint">{t("Segna lo stato del prodotto: gli esauriti e in esaurimento entrano da soli nella lista della spesa. Menu ⋯ per riassortire, modificare o eliminare.")}</p>
          </div>
          </div>
        </div>
      ) : (<>

      {/* Card riepilogo — cliccabili per filtrare (stessa grafica delle altre pagine) */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          { key: "dafare", label: "Da fare", count: toClean.length, color: "var(--txt)" },
          { key: "riassetto", label: "Riassetti", count: counts.riassetto, color: ACT.riassetto.color },
          { key: "partenze", label: "Partenze", count: counts.partenza + counts.turnover, color: ACT.partenza.color },
          { key: "arrivi", label: "Arrivi", count: counts.arrivo + counts.turnover, color: ACT.arrivo.color },
        ] as const).map((c) => {
          const on = actionFilter === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setActionFilter((f) => (f === c.key ? "tutte" : c.key))}
              className={`anim-in w-full rounded-xl border bg-surface p-4 text-left shadow-sm transition-transform hover:-translate-y-0.5 ${on ? "border-focus ring-2 ring-[color:var(--focus)]" : "border-line"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-dim">{t(c.label)}</span>
                <Icon name={on ? "eye" : "chevron"} size={13} />
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color: c.color }}>{c.count}</div>
            </button>
          );
        })}
      </div>

      {/* Carico biancheria del giorno + data e riepilogo a destra */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        {toClean.length > 0 && (
          <>
            <span className="flex items-center gap-1.5 text-sm font-bold text-txt"><Icon name="bed" size={16} /> {t("Carico biancheria")}</span>
            {/* Totale cambi completi */}
            <span className="flex items-baseline gap-1.5"><span className="font-mono text-lg font-bold tabular-nums text-txt">{linen.changeRooms}</span><span className="text-xs text-dim">{t("Cambi completi")}</span></span>
            {/* Separatore: a destra il dettaglio di cosa serve per i cambi */}
            <span className="hidden self-stretch border-l border-line sm:block" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{t("di cui")}</span>
            {([["Matrimoniali", linen.matr], ["Singole", linen.sing], ["Federe", linen.federe], ["Asciugamani · set", linen.towels], ["Tappetini bagno", linen.mats]] as [string, number][]).map(([lab, v]) => (
              <span key={lab} className="flex items-baseline gap-1.5"><span className="font-mono text-lg font-bold tabular-nums text-txt">{v}</span><span className="text-xs text-dim">{t(lab)}</span></span>
            ))}
          </>
        )}
        {/* Data del giorno + contatore pulizie (spostati qui dalla riga filtri) */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold capitalize text-txt">{fmtLong(date)}</span>
          <span className="rounded-full bg-wash px-3 py-1 text-xs font-semibold text-txt">{toClean.length} {t("da fare")} · {remaining} {t("rimaste")}</span>
        </div>
      </div>

      {/* Riga filtri — sinistra: struttura, calendario (frecce ±1g), Oggi, vista · destra: Copia/Condividi */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
        {activeStructureId === "all" && (
          <select value={structFilter} onChange={(e) => setStructFilter(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt outline-none focus:border-focus">
            <option value="all">{t("Tutte le strutture")}</option>
            {structures.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button onClick={() => setDate(toISO(addDays(parseISO(date), -1)))} title={t("Giorno precedente")} aria-label={t("Giorno precedente")} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-base leading-none text-dim transition hover:bg-wash hover:text-txt">‹</button>
          <DateField value={date} onChange={setDate} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm transition hover:border-focus" />
          <button onClick={() => setDate(toISO(addDays(parseISO(date), 1)))} title={t("Giorno successivo")} aria-label={t("Giorno successivo")} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-base leading-none text-dim transition hover:bg-wash hover:text-txt">›</button>
        </div>
        <button onClick={() => setDate(todayISO)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-dim hover:bg-wash hover:text-txt">{t("Oggi")}</button>
        <div className="flex items-center rounded-lg border border-line p-0.5">
          <Seg v="rows" icon="menu" title={t("Vista lista")} />
          <Seg v="cards" icon="grid" title={t("Vista card")} />
        </div>
        <div className="relative ml-auto">
          {copied && <span className="mr-2 text-xs font-medium text-[color:var(--ok)]">{t("Copiato ✓")}</span>}
          <button onClick={() => setPlanShare((v) => !v)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>{t("Condividi")}</button>
          {planShare && (<>
            <button aria-label={t("Chiudi")} onClick={() => setPlanShare(false)} className="fixed inset-0 z-20 cursor-default" />
            <div className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl">
              <button onClick={() => { shareWhatsApp(); setPlanShare(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-txt hover:bg-wash"><Icon name="chat" size={15} /> WhatsApp</button>
              <button onClick={() => { emailPlan(); setPlanShare(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-txt hover:bg-wash"><Icon name="mail" size={15} /> Email</button>
              <button onClick={() => { copyPlan(); setPlanShare(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-txt hover:bg-wash"><Icon name="copy" size={15} /> {t("Copia")}</button>
            </div>
          </>)}
        </div>
      </div>

      {/* Segnalazioni aperte dalla signora */}
      {openIssues.length > 0 && (
        <div className="mb-4 rounded-xl border bg-surface p-3 shadow-sm" style={{ borderColor: "color-mix(in srgb, var(--err) 40%, var(--line))" }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[color:var(--err)]"><Icon name="alertTriangle" size={16} /> {t("Segnalazioni aperte")} · {openIssues.length}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {openIssues.map((iss) => { const m = issueMeta(iss.type); return (
              <div key={iss.id} className="flex items-start gap-2 rounded-lg border border-line bg-paper p-2">
                {iss.photo ? <img src={iss.photo} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${m.color} 14%, transparent)`, color: m.color }}><Icon name={m.icon} size={18} /></span>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="font-bold text-txt">{iss.unitName}</span><span className="text-faint">· {iss.structureName}</span></div>
                  <div className="text-[11px] font-semibold" style={{ color: m.color }}>{t(m.label)}</div>
                  <div className="break-words text-xs text-dim">{iss.note}</div>
                  <div className="mt-0.5 text-[10px] text-faint">{fmtShort(iss.date)} · {(() => { try { return new Date(iss.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } })()}</div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button onClick={() => resolveIssue(iss.id)} title={t("Segna risolto")} className="grid h-7 w-7 place-items-center rounded-md border border-line text-[color:var(--ok)] hover:bg-wash">✓</button>
                  <button onClick={() => deleteIssue(iss.id)} title={t("Elimina")} className="grid h-7 w-7 place-items-center rounded-md border border-line text-faint hover:text-[color:var(--err)]">✕</button>
                </div>
              </div>
            ); })}
          </div>
        </div>
      )}

      {/* Storico segnalazioni risolte */}
      {resolvedIssues.length > 0 && (
        <div className="mb-4 rounded-xl border border-line bg-surface p-3 shadow-sm">
          <button onClick={() => setShowResolved((s) => !s)} className="flex w-full items-center gap-2 text-sm font-bold text-txt">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-[color:var(--ok)] text-[10px] font-bold text-white">✓</span>
            <span>{t("Storico segnalazioni risolte")} · {resolvedIssues.length}</span>
            <span className="ml-auto text-xs font-medium text-dim">{showResolved ? t("nascondi") : t("mostra")} {showResolved ? "▲" : "▼"}</span>
          </button>
          {showResolved && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {resolvedIssues.map((iss) => { const m = issueMeta(iss.type); return (
                <div key={iss.id} className="flex items-start gap-2 rounded-lg border border-line bg-paper p-2">
                  {iss.photo ? <img src={iss.photo} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${m.color} 12%, transparent)`, color: m.color }}><Icon name={m.icon} size={18} /></span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="font-bold text-txt">{iss.unitName}</span><span className="text-faint">· {iss.structureName}</span><span className="rounded-full px-1.5 text-[10px] font-bold text-[color:var(--ok)]" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)" }}>✓ {t("risolta")}</span></div>
                    <div className="text-[11px] font-semibold" style={{ color: m.color }}>{t(m.label)}</div>
                    <div className="break-words text-xs text-dim">{iss.note}</div>
                    <div className="mt-0.5 text-[10px] text-faint">{t("segnalata")} {fmtShort(iss.date)}{iss.resolvedAt ? ` · ${t("risolta")} ${(() => { try { const d = new Date(iss.resolvedAt); return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } })()}` : ""}</div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button onClick={() => reopenIssue(iss.id)} title={t("Riapri")} className="grid h-7 w-7 place-items-center rounded-md border border-line text-dim hover:bg-wash hover:text-txt">↺</button>
                    <button onClick={() => deleteIssue(iss.id)} title={t("Elimina dallo storico")} className="grid h-7 w-7 place-items-center rounded-md border border-line text-faint hover:text-[color:var(--err)]">✕</button>
                  </div>
                </div>
              ); })}
            </div>
          )}
        </div>
      )}

      {/* Planning */}
      <div className="flex flex-col gap-5">
        {scopedStructures.map((s) => {
          const list = rooms.filter((r) => r.structure.id === s.id && (r.oos ? actionFilter === "tutte" : matchAction(r.action)));
          if (actionFilter !== "tutte" && list.length === 0) return null;
          const sToClean = list.filter((r) => !r.oos && r.action !== "niente").length;
          return (
            <div key={s.id} className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
              <div className="flex items-center gap-2 border-b border-line bg-wash px-3 py-2">
                <span className="text-sm font-bold uppercase tracking-wide text-txt">{s.name}</span>
                <span className="text-xs text-faint">· {sToClean} {t("da fare")}</span>
              </div>
              <div className="p-3">
              {view === "cards" ? (
                <div className="grid w-full gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {list.flatMap((r, idx) => {
                    const showHeader = idx === 0 || (list[idx - 1].typeName || "") !== (r.typeName || "");
                    const card = <RoomCard key={r.unit.id} r={r} k={keyOf(r.unit.id)} done={!!done[keyOf(r.unit.id)]} doneAt={doneTime(keyOf(r.unit.id))} hasIssue={roomHasIssue(r.unit.id)} guestName={guestName} hasDog={hasDog} note={noteInput(keyOf(r.unit.id))} onToggle={() => toggleDone(keyOf(r.unit.id))} onIssue={() => setIssueDraft({ unitId: r.unit.id, unitName: r.unit.name, structureName: r.structure.name, type: "guasto", note: "", photo: undefined })} />;
                    return showHeader
                      ? [<div key={`h-${idx}`} className="col-span-full mt-1 flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ backgroundColor: `color-mix(in srgb, ${r.typeColor} 12%, transparent)`, color: r.typeColor }}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.typeColor }} />{r.typeName || t("Senza tipologia")}</div>, card]
                      : [card];
                  })}
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                  {(() => {
                    const rows = list.filter((r) => !r.oos);
                    let lastType: string | null = null;
                    return rows.map((r) => {
                      const a = ACT[r.action];
                      const k = keyOf(r.unit.id);
                      const isDone = !!done[k];
                      const clickable = r.action !== "niente";
                      const showHeader = (r.typeName || "") !== (lastType || "");
                      lastType = r.typeName || "";
                      return (
                        <div key={r.unit.id}>
                          {showHeader && <div className="flex items-center gap-1.5 border-t border-line px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ backgroundColor: `color-mix(in srgb, ${r.typeColor} 12%, transparent)`, color: r.typeColor }}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.typeColor }} />{r.typeName || t("Senza tipologia")}</div>}
                          <div className={`flex flex-wrap items-start gap-3 border-t border-line p-3 ${isDone ? "opacity-60" : ""}`}>
                            <div className="w-24 shrink-0"><div className={`font-display text-base font-bold ${isDone ? "text-dim line-through" : "text-txt"}`}>{r.unit.name}</div></div>
                            <div className="w-32 shrink-0"><span className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: a.color }}>{t(a.label)}</span></div>
                            <div className="min-w-0 flex-1 basis-64 text-sm">{details(r)}<div className="mt-2">{noteInput(k)}</div></div>
                            {clickable && (
                              <button onClick={() => toggleDone(k)} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs ${isDone ? "border-[color:var(--ok)] bg-[color:var(--ok)] text-white" : "border-line text-faint hover:border-[color:var(--ok)]"}`}>{isDone ? "✓" : ""}</button>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
              </div>
            </div>
          );
        })}
      </div>
      </>)}

      {/* Aggiungi / modifica prodotto */}
      {prodDraft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
          <button aria-label="Chiudi" onClick={() => setProdDraft(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-txt">{prodDraft.id ? t("Modifica prodotto") : t("Aggiungi prodotto")}</span>
              <button onClick={() => setProdDraft(null)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
            </div>
            <label className="block text-xs font-medium text-dim">{t("Nome prodotto")}
              <input autoFocus value={prodDraft.name} onChange={(e) => setProdDraft({ ...prodDraft, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveProd(); }} placeholder={t("Es. Detergente vetri")} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
            </label>
            {activeStructureId === "all" && structures.length > 1 && !prodDraft.id && (
              <label className="mt-3 flex items-center gap-2 text-xs font-medium text-dim">
                <input type="checkbox" checked={!!prodDraft.applyAll} onChange={(e) => setProdDraft({ ...prodDraft, applyAll: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" />
                {t("Aggiungi a tutte le strutture")}
              </label>
            )}
            {activeStructureId === "all" && structures.length > 1 && !prodDraft.applyAll && (
              <label className="mt-3 block text-xs font-medium text-dim">{t("Struttura")}
                <select value={prodDraft.structureId} onChange={(e) => setProdDraft({ ...prodDraft, structureId: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus">
                  {structures.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </label>
            )}
            <label className="mt-3 block text-xs font-medium text-dim">{t("Fornitore")} <span className="font-normal text-faint">({t("facoltativo")})</span>
              <input value={prodDraft.supplier} onChange={(e) => setProdDraft({ ...prodDraft, supplier: e.target.value })} placeholder={t("Es. Metro, Amazon, cartoleria…")} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none placeholder:text-faint focus:border-focus" />
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setProdDraft(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
              <button onClick={saveProd} disabled={!prodDraft.name.trim()} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{prodDraft.id ? t("Salva") : t("Aggiungi")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Conferma eliminazione prodotto */}
      {confirmDelProd && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
          <button aria-label="Chiudi" onClick={() => setConfirmDelProd(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-2 font-display text-lg font-bold text-txt">{t("Eliminare il prodotto?")}</div>
            <p className="text-sm text-dim">{t("Vuoi rimuovere")} <b className="text-txt">{confirmDelProd.name}</b> {t("dalla lista prodotti?")}</p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmDelProd(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
              <button onClick={() => { delProd(confirmDelProd.id); setConfirmDelProd(null); }} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "var(--err)" }}>{t("Elimina")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modale: segnala un problema */}
      {issueDraft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
          <button aria-label="Chiudi" onClick={() => setIssueDraft(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-txt">{t("Segnala un problema")}</span>
              <button onClick={() => setIssueDraft(null)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
            </div>
            <div className="mb-3 text-xs text-dim">{issueDraft.unitName} · {issueDraft.structureName} · {fmtShort(date)}</div>
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {ISSUE_TYPES.map((it) => (
                <button key={it.key} onClick={() => setIssueDraft({ ...issueDraft, type: it.key })} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${issueDraft.type === it.key ? "text-white" : "border-line text-dim hover:bg-wash"}`} style={issueDraft.type === it.key ? { backgroundColor: it.color, borderColor: it.color } : undefined}><Icon name={it.icon} size={14} /> {t(it.label)}</button>
              ))}
            </div>
            <textarea value={issueDraft.note} onChange={(e) => setIssueDraft({ ...issueDraft, note: e.target.value })} placeholder={t("Descrivi il problema…")} rows={3} className="w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-sm text-txt outline-none focus:border-focus" />
            <div className="mt-2 flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-dim hover:bg-wash">
                <Icon name="eye" size={14} /> {issueDraft.photo ? t("Cambia foto") : t("Aggiungi foto")}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onIssuePhoto(e.target.files?.[0])} />
              </label>
              {issueDraft.photo && <img src={issueDraft.photo} alt="" className="h-10 w-10 rounded-md object-cover" />}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setIssueDraft(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
              <button onClick={saveIssue} disabled={!issueDraft.note.trim()} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "var(--err)" }}>{t("Invia segnalazione")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function GuestLine({ dir, label, name, b, dog }: { dir: "in" | "out" | "stay"; label: string; name: string; b: Booking; dog: boolean }) {
  const { t } = useLang();
  const col = dir === "in" ? "var(--focus)" : dir === "out" ? "var(--warn)" : "var(--ok)";
  const icon = dir === "in" ? "login" : dir === "out" ? "logout" : "bed";
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex shrink-0 items-center gap-0.5 font-semibold" style={{ color: col }}><Icon name={icon} size={12} /> {label}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-txt">{name}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-dim">
        <span className="inline-flex items-center gap-0.5"><Icon name="users" size={11} />{b.adults + b.children}</span>
        <span className="font-mono">{fmt(b.checkIn)}–{fmt(b.checkOut)}</span>
        {dog && <span title={t("Ospite con animale")} style={{ color: "var(--warn)" }}><Icon name="paw" size={12} /></span>}
      </span>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function RoomCard({ r, done, doneAt, hasIssue, guestName, hasDog, note, onToggle, onIssue }: { r: any; k: string; done: boolean; doneAt?: string; hasIssue?: boolean; guestName: (id: string) => string; hasDog: (id: string) => boolean; note: React.ReactNode; onToggle: () => void; onIssue: () => void }) {
  const { t } = useLang();
  const a = ACT[r.action as ActionKey];
  // Camera fuori servizio → card tratteggiata.
  if (r.oos) {
    return (
      <div className="flex h-full min-h-[148px] flex-col rounded-lg border border-dashed border-line bg-[color:color-mix(in_srgb,var(--faint)_7%,var(--surface))] p-2.5">
        <div className="text-[13px] font-bold text-txt">{r.unit.name}</div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-dim">
          <span className="grid h-9 w-9 place-items-center rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--faint) 18%, transparent)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a2 2 0 1 0 2.8 2.8l6-6a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.1-2.1z" /></svg>
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide">{t("Fuori servizio")}</span>
        </div>
      </div>
    );
  }

  const accent = a.color;

  return (
    <div className={`flex h-full min-h-[160px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition ${done ? "opacity-70" : ""}`}>
      {/* Intestazione: camera + cosa fare */}
      <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, var(--surface))`, borderBottom: `1px solid color-mix(in srgb, ${accent} 28%, var(--line))` }}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`truncate font-display text-[15px] font-bold ${done ? "text-dim line-through" : "text-txt"}`}>{r.unit.name}</span>
          {r.typeName && <span className="shrink-0 text-[10px] font-medium text-faint">· {r.typeName}</span>}
          {hasIssue && <span title={t("Segnalazione aperta")} className="shrink-0 text-[color:var(--err)]"><Icon name="alertTriangle" size={13} /></span>}
        </span>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: accent }}>{t(a.label)}</span>
      </div>

      {/* Chi parte / arriva / alloggia */}
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5 text-[12px]">
        {r.dep && <GuestLine dir="out" label={t("Parte")} name={guestName(r.dep.guestId)} b={r.dep} dog={hasDog(r.dep.guestId)} />}
        {r.arr && <GuestLine dir="in" label={t("Arriva")} name={guestName(r.arr.guestId)} b={r.arr} dog={hasDog(r.arr.guestId)} />}
        {!r.dep && !r.arr && r.stay && <GuestLine dir="stay" label={t("In casa")} name={guestName(r.stay.guestId)} b={r.stay} dog={hasDog(r.stay.guestId)} />}
        {(r.arr ?? r.stay)?.note && <div className="flex items-start gap-1 rounded-lg px-1.5 py-1 text-[11px] leading-snug" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 10%, transparent)", color: "var(--txt)" }}><span>🗒</span><span><b className="text-focus">{t("Nota ospite:")}</b> {(r.arr ?? r.stay)!.note}</span></div>}
      </div>

      {/* Note + azioni */}
      <div className="px-3 pb-2.5">
        {note}
        <div className="mt-1.5 flex items-center gap-1.5">
          <button onClick={onToggle} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition ${done ? "bg-[color:var(--ok)] text-white" : "border border-line text-dim hover:border-[color:var(--ok)] hover:text-[color:var(--ok)]"}`}>{done ? <><span>✓</span> {t("Fatta")}{doneAt ? ` · ${doneAt}` : ""}</> : t("Segna come fatta")}</button>
          <button onClick={onIssue} title={t("Segnala un problema")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-dim transition hover:border-[color:var(--err)] hover:text-[color:var(--err)]"><Icon name="alertTriangle" size={15} /></button>
        </div>
      </div>
    </div>
  );
}

