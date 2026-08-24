import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "./Logo";
import { NAV } from "./nav";

export default function Topbar({ pathname, controls }: { pathname: string; controls: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div>
            <div className="font-display text-lg font-extrabold leading-none tracking-tight text-txt">
              SpigoleStay
            </div>
            <div className="text-[11px] text-dim">Channel Manager</div>
          </div>
        </div>
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-2 text-sm lg:flex [scrollbar-width:none]">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`shrink-0 rounded-md px-2.5 py-1.5 font-medium transition ${
                  active ? "bg-wash text-txt" : "text-dim hover:text-txt"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        {controls}
      </div>
    </header>
  );
}
