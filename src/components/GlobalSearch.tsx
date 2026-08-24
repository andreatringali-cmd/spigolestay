"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { NAV } from "./nav";
import Icon from "./Icon";
import { useLang } from "@/lib/i18n";

export default function GlobalSearch() {
  const router = useRouter();
  const { bookings, guests, structures, units, openBooking, getStructure, getUnit } = useData();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const term = q.trim().toLowerCase();
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "";

  const pages = term ? NAV.filter((n) => n.label.toLowerCase().includes(term)) : [];
  const bookingRes = term ? bookings.filter((b) => guestName(b.guestId).toLowerCase().includes(term) || b.id.toLowerCase().includes(term)).slice(0, 6) : [];
  const guestRes = term ? guests.filter((g) => g.fullName.toLowerCase().includes(term) || (g.email ?? "").toLowerCase().includes(term)).slice(0, 5) : [];
  const placeRes = term
    ? [
        ...structures.filter((s) => s.name.toLowerCase().includes(term)).map((s) => ({ key: "s" + s.id, label: s.name, sub: t("struttura") })),
        ...units.filter((u) => u.name.toLowerCase().includes(term)).map((u) => ({ key: "u" + u.id, label: u.name, sub: getStructure(u.structureId)?.name ?? t("camera") })),
      ].slice(0, 6)
    : [];

  const close = () => { setOpen(false); setQ(""); };
  const go = (href: string) => { close(); router.push(href); };
  const openB = (id: string) => { close(); openBooking(id); };

  const nothing = term && !pages.length && !bookingRes.length && !guestRes.length && !placeRes.length;

  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-faint transition hover:border-focus">
        <Icon name="search" size={16} />
        <span>{t("Cerca qualsiasi cosa…")}</span>
        <span className="ml-auto hidden rounded border border-line px-1.5 py-0.5 text-[10px] sm:inline">Ctrl K</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[10vh]">
          <button aria-label={t("Chiudi")} onClick={close} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-txt">
              <Icon name="search" size={18} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cerca prenotazioni, ospiti, camere, pagine…")} className="w-full bg-transparent text-sm outline-none placeholder:text-faint" />
              <button onClick={close} className="text-dim hover:text-txt">Esc</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {!term && <div className="p-4 text-sm text-faint">{t("Scrivi per cercare in tutto il gestionale: prenotazioni, ospiti, camere, pagine.")}</div>}
              {nothing && <div className="p-4 text-sm text-faint">{t("Nessun risultato per")} “{q}”.</div>}

              <Group title={t("Prenotazioni")} show={bookingRes.length > 0}>
                {bookingRes.map((b) => (
                  <Row key={b.id} icon="clipboard" title={guestName(b.guestId)} sub={`${b.id.toUpperCase()} · ${getStructure(b.structureId)?.name} · ${getUnit(b.unitId)?.name ?? t("Da assegnare")}`} onClick={() => openB(b.id)} />
                ))}
              </Group>
              <Group title={t("Ospiti")} show={guestRes.length > 0}>
                {guestRes.map((g) => (<Row key={g.id} icon="users" title={g.fullName} sub={g.email ?? ""} onClick={() => go("/ospiti")} />))}
              </Group>
              <Group title={t("Strutture e camere")} show={placeRes.length > 0}>
                {placeRes.map((p) => (<Row key={p.key} icon="building" title={p.label} sub={p.sub} onClick={() => go("/strutture")} />))}
              </Group>
              <Group title={t("Pagine")} show={pages.length > 0}>
                {pages.map((n) => (<Row key={n.href} icon={n.icon} title={n.label} sub={n.group} onClick={() => go(n.href)} />))}
              </Group>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Group({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div className="mb-1">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{title}</div>
      {children}
    </div>
  );
}

function Row({ icon, title, sub, onClick }: { icon: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-wash">
      <span className="text-dim"><Icon name={icon} size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-txt">{title}</span>
        {sub && <span className="block truncate text-xs text-dim">{sub}</span>}
      </span>
    </button>
  );
}
