"use client";

// Hero della Dashboard 2: saluto, frase-sintesi del giorno, tre numeri grandi e l'anello dell'occupazione di stanotte.
import Link from "next/link";
import Icon from "@/components/Icon";
import { plural, type SentencePart } from "@/lib/dashboard2";
import { tint } from "../_ui";
import { CountUp, Ring, SOFT_SHADOW, toneColor } from "./_kit";

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

const PART_COLOR: Record<string, string> = { ok: "var(--ok)", err: "var(--err)", focus: "var(--focus)" };

export default function Hero(p: HeroProps) {
  const sc = toneColor(p.statusTone);
  const free = Math.max(0, p.totalRooms - p.occupied);
  const figures = [
    { label: "Arrivi", value: p.arrivals, color: "var(--ok)" },
    { label: "Partenze", value: p.departures, color: "var(--err)" },
    { label: "In casa", value: p.stays, color: "var(--focus)" },
  ];
  return (
    <section
      aria-label="Sintesi della giornata"
      className="anim-in relative overflow-hidden rounded-3xl border border-line p-5 sm:p-7"
      style={{
        boxShadow: SOFT_SHADOW,
        background: `radial-gradient(110% 130% at 0% 0%, ${tint("var(--focus)", 11)} 0%, transparent 58%), radial-gradient(80% 110% at 100% 100%, ${tint("var(--ok)", 10)} 0%, transparent 62%), var(--surface)`,
      }}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-10">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">{p.dateLabel}<span className="text-faint"> · {p.scopeLabel}</span></p>
            <Link href="/" className="rounded-md text-[11px] font-medium text-faint underline-offset-2 transition hover:text-focus hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">Torna alla classica</Link>
          </div>
          <h1 className="mt-2 font-display text-[2rem] font-bold leading-[1.05] tracking-tight text-txt sm:text-5xl">{p.greeting}<span style={{ color: "var(--focus)" }}>.</span></h1>
          <p className="mt-2.5 max-w-xl text-[15px] leading-snug text-dim sm:text-lg">
            {p.sentence.map((s, i) => s.tone ? <strong key={i} className="font-bold" style={{ color: PART_COLOR[s.tone] }}>{s.text}</strong> : <span key={i}>{s.text}</span>)}
          </p>
          <a
            href="#adempimenti"
            className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
            style={{ backgroundColor: tint(sc, 13), color: sc }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sc, boxShadow: `0 0 0 3px ${tint(sc, 22)}` }} />
            {p.statusText}
            <Icon name="chevron" size={12} />
          </a>

          <div className="mt-5 grid max-w-md grid-cols-3 gap-2.5 sm:gap-3">
            {figures.map((f, i) => (
              <div key={f.label} className="anim-in rounded-2xl border px-3 pb-2.5 pt-2.5" style={{ animationDelay: `${160 + i * 70}ms`, borderColor: `color-mix(in srgb, ${f.color} 20%, var(--line))`, backgroundColor: tint(f.color, 8) }}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: f.color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: f.color }} />{f.label}
                </div>
                <div className="mt-0.5 font-display text-4xl font-bold leading-none tabular-nums text-txt sm:text-[2.6rem]"><CountUp value={f.value} delay={200 + i * 80} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className="anim-in flex items-center gap-4 md:flex-col md:gap-3" style={{ animationDelay: "120ms" }}>
          <Ring pct={p.pct} color="var(--focus)" size="clamp(112px, 34vw, 176px)" stroke={8} label={`Occupazione di stanotte: ${p.pct}% (${p.occupied} camere su ${p.totalRooms})`}>
            <div className="text-center">
              <div className="font-display text-[2.1rem] font-bold leading-none tabular-nums text-txt sm:text-5xl"><CountUp value={p.pct} delay={250} duration={1100} />
                <span className="text-lg font-semibold text-faint sm:text-2xl">%</span>
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-faint">stanotte</div>
            </div>
          </Ring>
          <div className="min-w-0 md:text-center">
            <div className="text-sm font-semibold text-txt">{p.occupied} {plural(p.occupied, "camera occupata", "camere occupate")}</div>
            <div className="text-xs text-dim">{p.totalRooms ? `${free} ${plural(free, "libera", "libere")} su ${p.totalRooms}` : "Nessuna camera configurata"}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
