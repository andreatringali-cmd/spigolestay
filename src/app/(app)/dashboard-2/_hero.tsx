"use client";

// Hero della Dashboard 2: l'unico punto "osato" della pagina. Pannello scuro e profondo (uguale nel tema chiaro e scuro),
// testo chiaro, numeri e pillola "di vetro", anello luminoso, filigrana Xenora molto attenuata.
// Saluto, frase-sintesi del giorno, tre numeri grandi (arrivi/partenze/in casa) e occupazione di stanotte.
import Link from "next/link";
import type { CSSProperties } from "react";
import Icon from "@/components/Icon";
import { plural, type SentencePart } from "@/lib/dashboard2";
import { CountUp, Ring } from "./_kit";

export interface HeroProps {
  greeting: string;
  dateLabel: string;
  scopeLabel: string;
  sentence: SentencePart[];
  statusText: string;
  statusTone: "ok" | "warn" | "err" | "dim";
  statusCount: number;
  arrivals: number;
  departures: number;
  stays: number;
  occupied: number;
  totalRooms: number;
  pct: number;
}

// Colori pensati per il fondo scuro (contrasto AA sul blu notte): menta, corallo, azzurro, ambra.
const MINT = "#6EE7B7", CORAL = "#FF9C94", SKY = "#8FD3FF", AMBER = "#FFC46B";
const PART_COLOR: Record<string, string> = { ok: MINT, err: CORAL, focus: SKY };
const STATUS_COLOR: Record<HeroProps["statusTone"], string> = { ok: MINT, warn: AMBER, err: CORAL, dim: "rgba(255,255,255,.72)" };
const INK = "#F4F7FF";                      // testo principale
const INK_DIM = "rgba(235,241,255,.78)";    // testo secondario (contrasto > 7:1 sul fondo)

// "Vetro": fondo bianco 12%, bordo sottile, sfocatura lieve.
const glass = (extra: CSSProperties = {}): CSSProperties => ({
  backgroundColor: "rgba(255,255,255,.12)",
  border: "1px solid rgba(255,255,255,.2)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.14)",
  ...extra,
});

export default function Hero(p: HeroProps) {
  const sc = STATUS_COLOR[p.statusTone];
  const free = Math.max(0, p.totalRooms - p.occupied);
  const figures = [
    { label: "Arrivi", value: p.arrivals, color: MINT },
    { label: "Partenze", value: p.departures, color: CORAL },
    { label: "In casa", value: p.stays, color: SKY },
  ];
  return (
    <section
      aria-label="Sintesi della giornata"
      className="anim-in relative isolate overflow-hidden rounded-3xl p-4 sm:px-7 sm:py-6"
      style={{
        color: INK,
        boxShadow: "0 1px 2px rgba(8,18,50,.25), 0 24px 48px -24px rgba(14,60,140,.55)",
        background: "linear-gradient(125deg, #0A1636 0%, #12307A 46%, #1456B8 72%, #0D8FA6 100%)",
      }}
    >
      {/* Luci morbide e forme decorative (solo sfondo) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 -top-28 h-80 w-80 rounded-full opacity-60 blur-3xl" style={{ background: "radial-gradient(circle, #3B6BFF 0%, transparent 70%)" }} />
        <div className="absolute -bottom-32 right-[-60px] h-96 w-96 rounded-full opacity-50 blur-3xl" style={{ background: "radial-gradient(circle, #19C3C9 0%, transparent 68%)" }} />
        <div className="absolute left-1/3 top-1/2 h-56 w-56 -translate-y-1/2 rounded-full opacity-25 blur-3xl" style={{ background: "radial-gradient(circle, #8B7BFF 0%, transparent 70%)" }} />
        {/* Onde sottili */}
        <svg className="absolute inset-x-0 bottom-0 h-16 w-full opacity-[.16]" viewBox="0 0 800 100" preserveAspectRatio="none">
          <path d="M0 62 C 120 20, 240 100, 400 56 S 680 8, 800 52 L800 100 L0 100 Z" fill="none" stroke="#fff" strokeWidth="1.2" />
          <path d="M0 78 C 140 40, 260 108, 420 74 S 700 30, 800 70" fill="none" stroke="#fff" strokeWidth="1" />
        </svg>
        {/* Filigrana: la farfalla Xenora, bianca e quasi invisibile */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/xenora-mark.png" alt="" className="absolute -right-10 -top-10 h-56 w-56 select-none object-contain sm:-right-4 sm:-top-16 sm:h-80 sm:w-80" style={{ filter: "brightness(0) invert(1)", opacity: 0.07 }} />
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide sm:text-xs" style={{ color: INK_DIM }}>{p.dateLabel}{p.scopeLabel && <span style={{ color: "rgba(235,241,255,.62)" }}> · {p.scopeLabel}</span>}</p>
            <Link href="/" className="rounded-md text-[11px] font-medium underline-offset-2 transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white md:hidden" style={{ color: "rgba(235,241,255,.7)" }}>Torna alla classica</Link>
          </div>
          <h1 className="mt-1.5 font-display text-[1.75rem] font-bold leading-[1.05] tracking-tight sm:text-4xl" style={{ color: "#fff" }}>{p.greeting}<span style={{ color: SKY }}>.</span></h1>
          <p className="mt-1.5 max-w-xl text-sm leading-snug sm:text-base" style={{ color: INK_DIM }}>
            {p.sentence.map((s, i) => s.tone ? <strong key={i} className="font-bold" style={{ color: PART_COLOR[s.tone] }}>{s.text}</strong> : <span key={i}>{s.text}</span>)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <a
              href="#adempimenti"
              className="inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              style={glass({ color: INK })}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: sc, boxShadow: `0 0 0 3px ${sc}33, 0 0 8px ${sc}` }} />
              <span className="min-w-0 truncate">{p.statusText}</span>
              <Icon name="chevron" size={11} />
            </a>
            <Link href="/" className="hidden rounded-md text-[11px] font-medium underline-offset-2 transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white md:inline" style={{ color: "rgba(235,241,255,.7)" }}>Torna alla classica</Link>
          </div>
        </div>

        {/* Tre numeri e anello affiancati su una sola riga */}
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-center gap-2 md:gap-3">
          {figures.map((f, i) => (
            <div key={f.label} className="anim-in min-w-0 rounded-2xl px-2 pb-2 pt-2 sm:px-3 md:w-[92px]" style={glass({ animationDelay: `${160 + i * 70}ms` })}>
              <div className="flex items-center gap-1 truncate text-[10px] font-semibold uppercase leading-none tracking-wide sm:text-[11px]" style={{ color: f.color }}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: f.color, boxShadow: `0 0 8px ${f.color}` }} /><span className="truncate">{f.label}</span>
              </div>
              <div className="mt-1.5 font-display text-[1.9rem] font-bold leading-none tabular-nums sm:text-4xl" style={{ color: "#fff" }}><CountUp value={f.value} delay={200 + i * 80} /></div>
            </div>
          ))}
          <div className="anim-in ml-1 md:ml-2" style={{ animationDelay: "120ms" }} title={`${p.occupied} ${plural(p.occupied, "camera occupata", "camere occupate")}${p.totalRooms ? ` · ${free} ${plural(free, "libera", "libere")} su ${p.totalRooms}` : ""}`}>
            <Ring
              pct={p.pct} color={SKY} colorTo={MINT} track="rgba(255,255,255,.14)" glow="rgba(110,231,183,.5)"
              size="clamp(76px, 22vw, 124px)" stroke={8} label={`Occupazione di stanotte: ${p.pct}% (${p.occupied} camere su ${p.totalRooms})`}
            >
              <div className="text-center">
                <div className="font-display text-[1.35rem] font-bold leading-none tabular-nums sm:text-[2rem]" style={{ color: "#fff" }}><CountUp value={p.pct} delay={250} duration={1100} />
                  <span className="text-xs font-semibold sm:text-base" style={{ color: "rgba(235,241,255,.7)" }}>%</span>
                </div>
                <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide sm:text-[10px]" style={{ color: "rgba(235,241,255,.72)" }}>{p.totalRooms ? `${p.occupied}/${p.totalRooms} camere` : "stanotte"}</div>
              </div>
            </Ring>
          </div>
        </div>
      </div>
    </section>
  );
}
