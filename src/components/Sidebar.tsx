"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import Icon from "./Icon";
import { NAV } from "./nav";
import { useAccess } from "@/lib/access";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/authsync";
import UserSwitcher from "./UserSwitcher";

// Email del titolare Xenora che vede il link al back-office (l'accesso vero è comunque
// verificato lato server dalla variabile ADMIN_EMAILS).
const OWNER_EMAILS = ["spigolehouse@gmail.com", "andreatringali.spi@gmail.com"];

const isActive = (href: string, pathname: string) => (href === "/" ? pathname === "/" : (pathname === href || pathname.startsWith(href + "/")));

export default function Sidebar({
  pathname,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: {
  pathname: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { can, moduleOn } = useAccess();
  const { t } = useLang();
  const { user } = useAuth();
  const isOwner = !!user?.email && OWNER_EMAILS.includes(user.email.toLowerCase());
  // Mostra TUTTE le voci per cui hai i permessi (anche dei piani superiori): quelle non incluse
  // nel piano appaiono col lucchetto e, cliccandole, portano all'attivazione dall'Abbonamento.
  const visible = NAV.filter((n) => can(n.perm));
  const locked = (n: (typeof NAV)[number]) => !moduleOn(n.module);
  const TOP = visible.filter((n) => !n.group);
  const GROUPS = Array.from(new Set(visible.filter((n) => n.group).map((n) => n.group)));
  // Attiva SOLO la voce col percorso più specifico (evita che "/abbonamento" resti attiva sulle sotto-pagine).
  const activeHref = visible.reduce((best, n) => (isActive(n.href, pathname) && n.href.length > best.length ? n.href : best), "");
  const activeGroup = visible.find((n) => n.href === activeHref)?.group ?? GROUPS[0];
  const [open, setOpen] = useState<Record<string, boolean>>({ [activeGroup]: true });
  // Accordion: aprendo un gruppo si chiude quello precedente (uno solo aperto per volta).
  const toggleGroup = (g: string) => setOpen((o) => (o[g] ? {} : { [g]: true }));
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onCloseMobile} />}
      <aside
        className={`${mobileOpen ? "fixed inset-y-0 left-0 z-50 flex w-64" : "hidden"} flex-col border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-screen ${collapsed ? "md:w-[70px]" : "md:w-64"}`}
      >
        {/* Header */}
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-3">
          {!collapsed && (
            <Image src="/xenora-logo.png" alt="Xenora" width={132} height={38} priority className="object-contain" style={{ height: 26, width: "auto" }} />
          )}
          <button
            onClick={onToggleCollapse}
            title={collapsed ? "Espandi" : "Comprimi"}
            className={`hidden rounded-lg p-1.5 text-dim hover:bg-wash hover:text-txt md:block ${collapsed ? "mx-auto" : "ml-auto"}`}
          >
            <span className={`block transition-transform ${collapsed ? "" : "rotate-180"}`}><Icon name="chevron" size={18} /></span>
          </button>
        </div>

        {/* Navigazione */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {collapsed ? (
            // Modalità compatta: solo icone
            visible.map((n) => {
              const active = n.href === activeHref;
              const isLk = locked(n);
              const color = "var(--focus)";
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={onCloseMobile}
                  title={isLk ? `${t(n.label)} · ${t("attiva nel piano")}` : t(n.label)}
                  className={`relative flex items-center justify-center rounded-lg p-2.5 transition ${active ? "" : "text-dim hover:bg-wash hover:text-[color:var(--hovc)]"} ${isLk && !active ? "opacity-55" : ""}`}
                  style={active ? { backgroundColor: mix(color, 16), color } : ({ "--hovc": color } as CSSProperties)}
                >
                  <Icon name={n.icon} size={20} />
                  {isLk && <span className="absolute right-0 top-0" style={{ color: "var(--txt)" }}><Icon name="lock" size={10} /></span>}
                </Link>
              );
            })
          ) : (
            <>
              {/* Voci principali (sempre visibili, senza tendina) */}
              <div className="flex flex-col gap-0.5">
                {TOP.map((n) => {
                  const active = n.href === activeHref;
                  const color = "var(--focus)";
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={onCloseMobile}
                      className={`flex items-center gap-2.5 rounded-lg py-2 pl-3 pr-2.5 text-sm transition ${active ? "" : "hover:bg-wash"}`}
                      style={active ? { backgroundColor: mix(color, 14), color, borderLeft: `3px solid ${color}`, paddingLeft: 9 } : { color: "var(--txt)" }}
                    >
                      <span style={{ color: active ? color : "var(--dim)" }}><Icon name={n.icon} size={18} /></span>
                      <span className={active ? "font-semibold" : "font-medium"}>{t(n.label)}</span>
                    </Link>
                  );
                })}
              </div>
              <div className="my-1.5 border-t border-line" />
              {GROUPS.map((group) => {
              const color = "var(--focus)";
              const isOpen = open[group];
              return (
                <div key={group}>
                  <button
                    onClick={() => toggleGroup(group)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider hover:bg-wash"
                    style={{ color: isOpen ? "var(--focus)" : "var(--dim)", backgroundColor: isOpen ? mix(color, 12) : undefined }}
                  >
                    <span className="flex-1 text-left">{t(group)}</span>
                    <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}><Icon name="chevron" size={14} /></span>
                  </button>
                  {isOpen && (
                    <div className="mb-1.5 mt-1 flex flex-col gap-0.5 rounded-lg py-1.5 pl-1.5 pr-1" style={{ backgroundColor: mix(color, 7), boxShadow: `inset 2px 0 0 ${mix(color, 45)}` }}>
                      {visible.filter((n) => n.group === group).map((n) => {
                        const active = n.href === activeHref;
                        const isLk = locked(n);
                        return (
                          <Link
                            key={n.href}
                            href={n.href}
                            onClick={onCloseMobile}
                            className={`flex items-center gap-2.5 rounded-lg py-2 pl-3 pr-2.5 text-sm transition ${active ? "" : "hover:bg-wash"} ${isLk && !active ? "opacity-60 hover:opacity-100" : ""}`}
                            style={
                              active
                                ? { backgroundColor: mix(color, 14), color, borderLeft: `3px solid ${color}`, paddingLeft: 9 }
                                : { color: "var(--dim)" }
                            }
                          >
                            <span style={active ? { color } : { color: "var(--faint)" }}><Icon name={n.icon} size={18} /></span>
                            <span className={active ? "font-semibold" : ""}>{t(n.label)}</span>
                            {isLk && <span className="ml-auto" style={{ color: "var(--txt)" }} title={t("Non incluso nel piano — attiva dall'Abbonamento")}><Icon name="lock" size={12} /></span>}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
              })}
            </>
          )}
        </nav>

        {/* Footer: utente collegato */}
        <div className="border-t p-2" style={{ borderTopColor: "color-mix(in srgb, var(--txt) 14%, var(--line))" }}>
          {isOwner && (
            <Link
              href="/admin"
              onClick={onCloseMobile}
              title="Back-office (solo titolare)"
              className={`mb-2 flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition hover:bg-wash ${collapsed ? "justify-center px-0" : "px-3"} ${pathname.startsWith("/admin") ? "font-semibold" : ""}`}
              style={pathname.startsWith("/admin") ? { backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" } : { color: "var(--dim)" }}
            >
              <Icon name="grid" size={18} />
              {!collapsed && <span>Back-office</span>}
            </Link>
          )}
          <UserSwitcher sidebar collapsed={collapsed} />
        </div>
      </aside>

    </>
  );
}

// color-mix con trasparenza.
const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
