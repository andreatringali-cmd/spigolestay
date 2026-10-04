"use client";

// Liste di Dashboard 2: movimenti del giorno (In struttura / Partenze / Arrivi) e checklist "Da fare oggi".
// Stessi dati e stessa logica della dashboard attuale; cambia solo la grafica (righe alte con anteprima camera).
import { useMemo } from "react";
import { useData } from "@/lib/store";
import { groupSizes } from "@/lib/groups";
import { CHANNELS } from "@/lib/types";
import { parseISO, nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { bookingCode } from "@/lib/bookingCode";
import type { JourneyStep } from "@/lib/booking-journey";
import { useLang } from "@/lib/i18n";
import { ChannelWordmark } from "@/components/ChannelLogo";
import Icon from "@/components/Icon";
import { Bar, DotPill, EmptyLine, Panel, PanelHead, Pill, RoomThumb, StructureLabel, daysFrom, tint } from "./_ui";

const dayLabel = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });

export type RowJourney = { done: number; total: number; next?: JourneyStep; chips: { key: string; label: string; tone: "info" | "warn" | "err" }[]; steps: JourneyStep[] } | null;
export type MoveKind = "arr" | "dep" | "stay";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function MoveList({ items, empty, kind, date, today, groupByStructure, structures, guestName, getStructure, openBooking, alloggiatiOk, payStatus, journeyFor, onStep }: any) {
  const { t } = useLang();
  const { bookings: allBk } = useData();
  const gSizes = useMemo(() => groupSizes(allBk), [allBk]);
  if (!items.length) return <EmptyLine icon={kind === "arr" ? "login" : kind === "dep" ? "logout" : "bed"}>{empty}</EmptyLine>;

  const PAY: Record<string, [string, string, string]> = {
    paid: ["var(--ok)", t("Pagato"), t("Pagato")],
    partial: ["var(--warn)", t("Acconto"), t("Acconto ricevuto · saldo da incassare")],
    unpaid: ["var(--err)", t("Da pagare"), t("Da pagare")],
  };

  // Etichetta relativa della data che interessa alla lista (arrivo / partenza / notte di permanenza).
  const rel = (b: any): { text: string; tone: string } => {
    if (kind === "stay") {
      const k = Math.round((Date.parse(date) - Date.parse(b.checkIn)) / 86400000) + 1;
      return { text: `${t("Notte")} ${k} ${t("di")} ${nights(b.checkIn, b.checkOut)}`, tone: "var(--dim)" };
    }
    const iso = kind === "arr" ? b.checkIn : b.checkOut;
    const d = daysFrom(iso, today);
    const verb = kind === "arr" ? (d >= 0 ? t("Arriva") : t("Arrivato")) : (d >= 0 ? t("Parte") : t("Partito"));
    const when = d === 0 ? t("oggi") : d === 1 ? t("domani") : d === -1 ? t("ieri") : d > 0 ? `${t("tra")} ${d} ${t("giorni")}` : `${-d} ${t("giorni fa")}`;
    return { text: `${verb} ${when}`, tone: d === 0 ? "var(--focus)" : d < 0 ? "var(--faint)" : "var(--dim)" };
  };

  const rows = (list: any[]) => (
    <div className="flex flex-col gap-2.5">
      {list.map((b: any) => {
        const ch = CHANNELS[b.channel as keyof typeof CHANNELS];
        const alOk = alloggiatiOk?.(b) ?? false;
        const pay = (payStatus?.(b) ?? "unpaid") as "paid" | "partial" | "unpaid";
        const j: RowJourney = journeyFor?.(b) ?? null;
        const n = nights(b.checkIn, b.checkOut);
        const people = b.adults + b.children;
        const r = rel(b);
        const due = (b.total ?? 0) + (b.cleaningFee ?? 0);
        const resid = Math.max(0, due - (b.paid ?? 0));
        const pct = j && j.total ? Math.round((j.done / j.total) * 100) : 0;
        const late = !!j?.steps.some((s) => s.state === "late");
        return (
          <article key={b.id} role="button" tabIndex={0} onClick={() => openBooking(b.id)} onKeyDown={(e) => { if (e.key === "Enter") openBooking(b.id); }} className="group flex cursor-pointer gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-sm transition hover:border-focus hover:shadow-md">
            <RoomThumb unitId={b.unitId} roomTypeId={b.roomTypeId} structureId={b.structureId} className="min-h-[104px] w-20 self-stretch sm:w-24" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="min-w-0 flex-1 truncate text-sm font-medium text-txt">{guestName(b.guestId)}</h4>
                {b.channel !== "blocked" && <ChannelWordmark channel={b.channel} height={18} title={ch.label} />}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-dim">
                <span className="font-mono text-[11px] text-faint">{bookingCode(b)}</span>
                <span className="text-faint">·</span>
                <span className="inline-flex items-center gap-0.5"><Icon name="users" size={12} />{people}</span>
                <span className="text-faint">·</span>
                <span>{n} {n === 1 ? t("notte") : t("notti")}</span>
                {b.groupId && (gSizes.get(b.groupId) ?? 0) > 1 && <Pill color="var(--focus)">{t("Gruppo")}</Pill>}
                {b.status === "tentative" && <Pill color="var(--warn)">{t("Opzione")}</Pill>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium capitalize text-txt">{dayLabel(b.checkIn)}</span><span className="text-faint">→</span><span className="font-medium capitalize text-txt">{dayLabel(b.checkOut)}</span>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: r.tone, backgroundColor: tint(r.tone, 12) }}>{r.text}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <DotPill color={alOk ? "var(--ok)" : "var(--err)"} title={alOk ? t("Schedina alloggiati pronta") : t("Schedina alloggiati da completare")}>{alOk ? t("Schedina pronta") : t("Schedina da fare")}</DotPill>
                <DotPill color={PAY[pay][0]} title={PAY[pay][2]}>{PAY[pay][1]}</DotPill>
                {j?.chips.slice(0, 3).map((c) => (
                  <span key={c.key} className="max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: c.tone === "err" ? "var(--err)" : c.tone === "warn" ? "var(--warn)" : "var(--dim)", backgroundColor: tint(c.tone === "err" ? "var(--err)" : c.tone === "warn" ? "var(--warn)" : "var(--faint)", 14) }}>{c.label}</span>
                ))}
              </div>
              <div className="mt-2.5 flex items-end justify-between gap-3 border-t border-line pt-2">
                <div className="shrink-0">
                  <div className="font-mono text-sm font-semibold leading-tight text-txt">{b.total ? eur(b.total) : "—"}</div>
                  {b.total ? <div className="text-[11px] text-faint">{resid <= 0.005 ? t("Saldato") : `${t("Mancano")} ${eur(resid)}`}</div> : null}
                </div>
                {j && j.total > 0 && (
                  <div className="min-w-0 flex-1 sm:max-w-[190px]">
                    <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-dim"><span>{j.done} {t("di")} {j.total}</span><span>{pct}%</span></div>
                    <Bar pct={pct} color={late ? "var(--err)" : pct === 100 ? "var(--ok)" : "var(--focus)"} />
                    {j.next
                      ? <button onClick={(e) => { e.stopPropagation(); onStep?.(b, j.next!); }} className="mt-1 block w-full truncate text-left text-[11px] font-semibold hover:underline" style={{ color: j.next.state === "late" ? "var(--err)" : "var(--focus)" }}>{t("Prossimo passo")}: {j.next.label} →</button>
                      : <div className="mt-1 text-[11px] font-semibold" style={{ color: "var(--ok)" }}>{t("Tutto in ordine")} ✓</div>}
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );

  if (groupByStructure) {
    const groups = structures.map((s: any) => ({ s, list: items.filter((i: any) => i.structureId === s.id) })).filter((g: any) => g.list.length);
    return (
      <div className="flex flex-col gap-3">
        {groups.map((g: any) => {
          const col = g.s.photoColor ?? "var(--faint)";
          return (
            <div key={g.s.id} className="rounded-xl p-1.5" style={{ backgroundColor: `color-mix(in srgb, ${col} 6%, transparent)` }}>
              <StructureLabel name={g.s.name} color={g.s.photoColor} count={g.list.length} />
              {rows(g.list)}
            </div>
          );
        })}
      </div>
    );
  }
  return rows(items);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function TodoGroup({ title, icon, color, items, tasks, done, onToggle, autoOf, guestName, getUnit, getStructure, openBooking, multi }: any) {
  const { t } = useLang();
  const renderItem = (b: any, showStruct: boolean) => {
    const st = getStructure?.(b.structureId);
    const stColor = st?.photoColor ?? "var(--faint)";
    const doneN = tasks.filter((task: any) => done.has(`${b.id}:${task.id}`) || !!autoOf?.(task.id)).length;
    const pct = tasks.length ? (doneN / tasks.length) * 100 : 0;
    return (
      <div key={b.id} className="rounded-2xl border border-line bg-surface p-2.5 transition hover:border-focus hover:shadow-md">
        <div className="mb-2 flex items-center gap-2.5">
          <RoomThumb unitId={b.unitId} roomTypeId={b.roomTypeId} structureId={b.structureId} compact className="h-11 w-11 rounded-lg" />
          <div className="min-w-0 flex-1">
            <button onClick={() => openBooking(b.id)} className="block max-w-full truncate text-left text-sm font-medium text-txt hover:text-focus hover:underline">{guestName(b.guestId)}</button>
            <span className="flex min-w-0 items-center gap-1 text-xs text-dim">
              {showStruct && <span className="max-w-[90px] truncate font-semibold" style={{ color: stColor }}>{st?.name}</span>}
              {showStruct && <span className="text-faint">·</span>}
              <span className="truncate">{getUnit(b.unitId)?.name ?? t("Da assegnare")}</span>
            </span>
          </div>
          <div className="w-16 shrink-0 text-right">
            <div className="mb-1 text-[11px] font-semibold text-dim">{doneN} {t("di")} {tasks.length}</div>
            <Bar pct={pct} color={doneN === tasks.length ? "var(--ok)" : "var(--focus)"} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {tasks.map((task: any) => {
            const key = `${b.id}:${task.id}`;
            const auto = autoOf?.(task.id) as string | null;
            if (auto) return (
              <div key={task.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm" style={{ backgroundColor: tint("var(--ok)", 8) }}>
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] text-white" style={{ backgroundColor: "var(--ok)" }}>✓</span>
                <span className="min-w-0 truncate text-txt">{t(task.label)}</span>
                <span className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: tint("var(--ok)", 16), color: "var(--ok)" }}>{t("auto")} · {auto}</span>
              </div>
            );
            const isDone = done.has(key);
            return (
              <label key={task.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition hover:bg-wash">
                <input type="checkbox" checked={isDone} onChange={() => onToggle(key)} className="h-4 w-4 shrink-0 accent-[color:var(--ok)]" />
                <span className={`min-w-0 ${isDone ? "text-faint line-through" : "text-txt"}`}>{t(task.label)}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  // Raggruppa per struttura (stesso stile delle liste movimenti) quando ci sono più strutture.
  const groups = multi ? (() => {
    const map = new Map<string, { s: any; list: any[] }>();
    for (const b of items) { if (!map.has(b.structureId)) map.set(b.structureId, { s: getStructure?.(b.structureId), list: [] }); map.get(b.structureId)!.list.push(b); }
    return [...map.values()].sort((a, b) => (a.s?.name ?? "").localeCompare(b.s?.name ?? "", "it"));
  })() : null;

  return (
    <Panel hover={false}>
      <PanelHead icon={icon} color={color} title={title} count={items.length} />
      {items.length === 0 ? (
        <EmptyLine icon={icon}>{t("Niente in programma.")}</EmptyLine>
      ) : groups && groups.length > 1 ? (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const col = g.s?.photoColor ?? "var(--faint)";
            return (
              <div key={g.s?.id ?? "x"} className="rounded-xl p-1.5" style={{ backgroundColor: `color-mix(in srgb, ${col} 6%, transparent)` }}>
                <StructureLabel name={g.s?.name} color={g.s?.photoColor} count={g.list.length} />
                <div className="flex flex-col gap-2">{g.list.map((b) => renderItem(b, false))}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">{items.map((b: any) => renderItem(b, multi))}</div>
      )}
    </Panel>
  );
}
