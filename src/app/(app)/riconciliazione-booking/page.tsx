"use client";

// Riconciliazione Booking: si incolla l'elenco copiato dall'extranet di Booking.com (pagina Prenotazioni) e Xenora lo confronta con le sue prenotazioni
// del canale Booking.com. Le differenze negli importi si allineano con un pulsante; tutto il resto (mancanti, doppioni, cancellate, altra struttura) è solo segnalazione.
// Nulla lascia il browser: il testo incollato si legge qui e le modifiche passano da updateBooking come ogni altra modifica.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { useAccess } from "@/lib/access";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useToast } from "@/components/ToastProvider";
import { eur } from "@/lib/format";
import { fmtDMY } from "@/lib/dates";
import { parseExtranetText, compareWithBookings, proposeAlign, summarizeAlign, commissionStats, type RowMatch, type Diff } from "@/lib/booking-extranet";

type Filter = "all" | "align" | "flag" | "ok";

const pct1 = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;
const pct2 = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${eur(Math.abs(n))}`;
const FIELD_LABEL: Record<Diff["field"], string> = { totale: "Totale", incassato: "Incassato", commissione: "Commissione", checkIn: "Arrivo", checkOut: "Partenza", stato: "Stato", ospite: "Ospite", canale: "Canale" };

const PILL: Record<string, { label: string; color: string }> = {
  ok: { label: "Ok", color: "var(--ok)" },
  align: { label: "Da allineare", color: "var(--warn)" },
  check: { label: "Da controllare", color: "var(--warn)" },
  mancante_in_xenora: { label: "Manca in Xenora", color: "var(--err)" },
  doppione: { label: "Doppione", color: "var(--err)" },
  altra_struttura: { label: "Altra struttura", color: "var(--warn)" },
  solo: { label: "Solo in Xenora", color: "var(--err)" },
};
function Pill({ k }: { k: keyof typeof PILL }) {
  const p = PILL[k];
  return <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: p.color, backgroundColor: `color-mix(in srgb, ${p.color} 14%, transparent)` }}>{p.label}</span>;
}

export default function RiconciliazioneBookingPage() {
  const { raw, guests, allStructures, updateBooking } = useData();
  const { level } = useAccess();
  const ask = useConfirm();
  const toast = useToast();
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [lastAligned, setLastAligned] = useState(0);
  const canEdit = level("cassa") === "edit" && level("prenotazioni") === "edit";

  const parsed = useMemo(() => (submitted.trim() ? parseExtranetText(submitted) : null), [submitted]);
  // Si ricalcola da solo ogni volta che cambiano le prenotazioni (quindi anche subito dopo «Allinea»).
  const cmp = useMemo(() => (parsed ? compareWithBookings(parsed.rows, raw.bookings, guests) : null), [parsed, raw.bookings, guests]);
  const structName = (id: string) => allStructures.find((s) => s.id === id)?.name ?? "—";

  const view = useMemo(() => {
    if (!cmp) return null;
    const items = cmp.matches.map((m) => ({ m, patches: proposeAlign(m) }));
    const align = items.filter((i) => i.patches.length > 0);
    const okItems = items.filter((i) => i.m.outcome === "ok" && !i.m.diffs.length);
    const flagCount = items.filter((i) => i.patches.length === 0 && (i.m.outcome !== "ok" || i.m.diffs.length > 0)).length + cmp.onlyInXenora.length;
    const exPrice = parsed!.rows.reduce((a, r) => a + (r.status === "cancelled" ? 0 : r.price), 0);
    const exComm = parsed!.rows.reduce((a, r) => a + (r.status === "cancelled" ? 0 : r.commission), 0);
    const xeTot = cmp.matches.reduce((a, m) => a + m.xenora.total, 0);
    const xeComm = cmp.matches.reduce((a, m) => a + m.xenora.commission, 0);
    return { items, align, okItems, flagCount, exPrice, exComm, xeTot, xeComm, nPatch: align.reduce((a, i) => a + i.patches.length, 0) };
  }, [cmp, parsed]);

  const shown = useMemo(() => {
    if (!view) return [];
    if (filter === "align") return view.align;
    if (filter === "ok") return view.okItems;
    if (filter === "flag") return view.items.filter((i) => i.patches.length === 0 && (i.m.outcome !== "ok" || i.m.diffs.length > 0));
    return view.items;
  }, [view, filter]);

  // Statistica: righe già allineate (ok) di ciascuna prenotazione.
  const stats = useMemo(() => (view ? commissionStats(view.okItems.map((i) => i.m.row)) : null), [view]);

  const run = () => { setSubmitted(text); setLastAligned(0); setFilter("all"); };

  const align = async () => {
    if (!view || !view.nPatch) return;
    const all = view.align.flatMap((i) => i.patches);
    const sum = summarizeAlign(all, raw.bookings);
    const ok = await ask({
      title: "Allineo gli importi a Booking.com?",
      message: `Aggiorno ${sum.bookings} ${sum.bookings === 1 ? "prenotazione" : "prenotazioni"} (${view.align.length} ${view.align.length === 1 ? "numero" :"numeri"} Booking): totale ${signed(sum.dTotal)}, commissioni ${signed(sum.dCommission)}, incassato ${signed(sum.dPaid)}. Lo stato delle prenotazioni non viene toccato e l'incassato a zero resta com'è.`,
      confirmLabel: `Allinea (${sum.bookings})`,
    });
    if (!ok) return;
    let done = 0;
    for (const p of all) { try { updateBooking(p.id, p.patch); done++; } catch { /* una che fallisce non ferma le altre */ } }
    setLastAligned(done);
    toast(done === all.length ? `Allineate ${done} prenotazioni a Booking.com` : `Allineate ${done} prenotazioni su ${all.length}: le altre non sono andate a buon fine`, done === all.length ? "success" : "error");
  };

  const inputCls = "w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs text-txt outline-none focus:border-focus";
  const chip = (k: Filter, label: string, n: number) => (
    <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${filter === k ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>{label} <span className="opacity-70">{n}</span></button>
  );

  const amountsCell = (m: RowMatch) => {
    const has = (f: Diff["field"]) => m.diffs.some((d) => d.field === f);
    const warn = { color: "var(--warn)" };
    if (!m.active.length) return <span className="text-faint">{m.bookings.length ? "Annullata" : "—"}</span>;
    const x = m.xenora;
    return (
      <span className="tabular-nums">
        <span style={has("totale") ? warn : undefined}>{eur(x.total)}</span>
        <span className="text-faint"> · inc. </span><span style={has("incassato") ? warn : undefined}>{eur(x.paid)}</span>
        <span className="text-faint"> · comm. </span><span style={has("commissione") ? warn : undefined}>{eur(x.commission)}</span>
        {x.total > 0 && <span className="text-faint"> ({pct1((x.commission / x.total) * 100)})</span>}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Riconciliazione Booking" subtitle="Incolla l'elenco prenotazioni dell'extranet di Booking.com: Xenora lo confronta con le sue prenotazioni e allinea gli importi." actions={<Link href="/cassa" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-dim hover:bg-wash">← Cassa</Link>} />

      <Card className="mb-4">
        <SectionTitle>Elenco dall&apos;extranet</SectionTitle>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} spellCheck={false} aria-label="Incolla qui l'elenco dall'extranet di Booking" placeholder={"Incolla qui l'elenco dall'extranet di Booking\n(Extranet › Prenotazioni › seleziona la tabella con le righe e copia, compreso il numero prenotazione in fondo a ogni riga)"} className={inputCls} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={run} disabled={!text.trim()} className="rounded-lg bg-focus px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">Confronta</button>
          {text && <button type="button" onClick={() => { setText(""); setSubmitted(""); setLastAligned(0); }} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-dim hover:bg-wash">Svuota</button>}
          <span className="text-xs text-faint">Puoi incollare un&apos;altra settimana di seguito e premere di nuovo «Confronta». I dati restano nel tuo browser.</span>
        </div>
        {parsed && parsed.warnings.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in srgb, var(--warn) 45%, var(--line))", backgroundColor: "color-mix(in srgb, var(--warn) 8%, transparent)", color: "var(--txt)" }}>
            {parsed.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
          </ul>
        )}
      </Card>

      {parsed && view && cmp && parsed.rows.length === 0 && <Card><p className="text-sm text-dim">Nessuna riga riconosciuta. Controlla di aver copiato la tabella con le colonne Arrivo, Partenza, Prezzo, Commissione e il numero prenotazione.</p></Card>}

      {parsed && view && cmp && parsed.rows.length > 0 && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label="Righe incollate" value={String(parsed.rows.length)} hint={cmp.structureIds.length ? cmp.structureIds.map(structName).join(" · ") : "nessuna struttura trovata"} />
            <Tile label="Già uguali" value={String(view.okItems.length)} color="var(--ok)" />
            <Tile label="Da allineare" value={String(view.align.length)} color={view.align.length ? "var(--warn)" : undefined} hint={view.nPatch ? `${view.nPatch} prenotazioni Xenora` : undefined} />
            <Tile label="Segnalazioni" value={String(view.flagCount)} color={view.flagCount ? "var(--err)" : undefined} hint="da guardare a mano" />
          </div>

          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Prezzo (non cancellate)</div><div className="tabular-nums"><b>Booking</b> {eur(view.exPrice)} <span className="text-faint">·</span> <b>Xenora</b> {eur(view.xeTot)} {Math.abs(view.exPrice - view.xeTot) > 0.02 && <span style={{ color: "var(--warn)" }}>({signed(view.xeTot - view.exPrice)})</span>}</div></div>
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Commissioni e costi</div><div className="tabular-nums"><b>Booking</b> {eur(view.exComm)} <span className="text-faint">·</span> <b>Xenora</b> {eur(view.xeComm)} {Math.abs(view.exComm - view.xeComm) > 0.02 && <span style={{ color: "var(--warn)" }}>({signed(view.xeComm - view.exComm)})</span>}</div></div>
              {parsed.totals && <div className="text-xs text-faint">Totali in fondo all&apos;extranet: prezzo {eur(parsed.totals.price)}, commissioni {eur(parsed.totals.commission)}</div>}
              <div className="ml-auto flex items-center gap-2">
                {lastAligned > 0 && view.nPatch === 0 && <span className="text-xs font-semibold" style={{ color: "var(--ok)" }}>✓ Allineate {lastAligned}: ora gli importi coincidono</span>}
                <button type="button" onClick={align} disabled={!view.nPatch || !canEdit} title={canEdit ? undefined : "Serve il permesso di modifica su Cassa e Prenotazioni"} className="rounded-lg bg-focus px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">Allinea ({view.nPatch} {view.nPatch === 1 ? "prenotazione" : "prenotazioni"})</button>
              </div>
            </div>
          </Card>

          <Card className="mb-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>Confronto riga per riga</SectionTitle>
              <div role="group" aria-label="Filtro" className="flex items-center rounded-lg border border-line p-0.5">
                {chip("all", "Tutte", view.items.length)}
                {chip("align", "Da allineare", view.align.length)}
                {chip("flag", "Segnalazioni", view.items.filter((i) => i.patches.length === 0 && (i.m.outcome !== "ok" || i.m.diffs.length > 0)).length)}
                {chip("ok", "Ok", view.okItems.length)}
              </div>
            </div>
            <div className="-mx-1 overflow-x-auto px-1">
              <div className="min-w-[760px] md:min-w-0">
                <div className="sticky top-0 hidden grid-cols-[minmax(0,1.25fr)_minmax(0,1.35fr)_minmax(0,1fr)_112px] gap-x-3 border-b border-line bg-surface pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint md:grid">
                  <span>Ospite · numero · date</span><span>Xenora (totale · incassato · comm.)</span><span>Booking (prezzo · comm.)</span><span className="text-right">Stato</span>
                </div>
                <div className="flex flex-col divide-y divide-[color:var(--line)]">
                  {shown.map(({ m, patches }) => {
                    const pill: keyof typeof PILL = m.outcome === "differenze" ? (patches.length ? "align" : "check") : m.outcome === "ok" && m.diffs.length === 0 ? "ok" : m.outcome === "ok" ? "check" : m.outcome;
                    const r = m.row;
                    return (
                      <div key={r.code} className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1.35fr)_minmax(0,1fr)_112px] items-start gap-x-3 gap-y-0.5 py-2 text-xs md:text-[13px]">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-txt">{r.guest || "—"}{r.status === "cancelled" && <span className="ml-1 font-normal text-faint">(cancellata)</span>}{r.status === "other" && r.statusText && <span className="ml-1 font-normal text-faint">({r.statusText})</span>}</div>
                          <div className="font-mono text-[11px] text-dim">{r.code}</div>
                          <div className="text-[11px] text-dim">{fmtDMY(r.checkIn)} → {fmtDMY(r.checkOut)}{m.active.length > 1 && <span className="text-faint"> · {m.active.length} camere</span>}</div>
                        </div>
                        <div className="min-w-0 text-txt">{amountsCell(m)}</div>
                        <div className="min-w-0 tabular-nums text-txt">
                          {r.status === "cancelled" ? <span className="text-faint">—</span> : <>
                            {eur(r.price)} <span className="text-faint">· comm.</span> {eur(r.commission)}{r.price > 0 && <span className="text-faint"> ({pct1((r.commission / r.price) * 100)})</span>}
                          </>}
                        </div>
                        <div className="text-right"><Pill k={pill} /></div>
                        {(m.diffs.length > 0 || m.note) && (
                          <div className="col-span-4 mt-0.5 flex flex-col gap-0.5 rounded-md bg-paper px-2 py-1 text-[11px] text-dim">
                            {m.diffs.map((d, i) => (
                              <div key={i}><b className="text-txt">{FIELD_LABEL[d.field]}</b>: Xenora {d.xenora} ≠ Booking {d.booking}{" "}
                                <span style={{ color: d.fixable && patches.length ? "var(--ok)" : "var(--warn)" }}>{d.fixable && patches.length ? "· si allinea" : `· ${d.note ?? "da controllare a mano"}`}</span></div>
                            ))}
                            {m.note && <div>{m.note}{m.structureIds.length > 0 && m.outcome === "altra_struttura" && <> <b className="text-txt">Struttura: {m.structureIds.map(structName).join(", ")}</b> (le altre righe: {structName(cmp.dominantStructureId ?? "")}).</>}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {shown.length === 0 && <div className="py-6 text-center text-sm text-faint">Nessuna riga in questo filtro.</div>}
                </div>
              </div>
            </div>
          </Card>

          {cmp.onlyInXenora.length > 0 && (
            <Card className="mb-4">
              <SectionTitle>Solo in Xenora ({cmp.onlyInXenora.length})</SectionTitle>
              <p className="mb-2 text-xs text-dim">Prenotazioni Booking.com di Xenora con partenza tra il {fmtDMY(parsed.rows.map((r) => r.checkOut).sort()[0])} e il {fmtDMY(parsed.rows.map((r) => r.checkOut).sort().slice(-1)[0])} che non compaiono nell&apos;elenco incollato. Se l&apos;elenco è completo per quel periodo potrebbero essere cancellate o con un altro numero: controlla dal Calendario, qui non cambio nulla. Se hai copiato solo una parte delle pagine dell&apos;extranet, ignora questo elenco.</p>
              <div className="flex flex-col divide-y divide-[color:var(--line)] text-xs md:text-[13px]">
                {cmp.onlyInXenora.map((o) => (
                  <div key={o.code || o.bookings[0].id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                    <Pill k="solo" />
                    <span className="font-semibold text-txt">{o.guest}</span>
                    <span className="font-mono text-[11px] text-dim">{o.code || "senza numero"}</span>
                    <span className="text-dim">{fmtDMY(o.checkIn)} → {fmtDMY(o.checkOut)}</span>
                    <span className="tabular-nums text-dim">{eur(o.bookings.reduce((a, b) => a + (b.total ?? 0), 0))}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <SectionTitle>Percentuale reale di commissione</SectionTitle>
            {!stats ? (
              <p className="text-xs text-dim">Nessuna riga ancora allineata con importo: la percentuale si calcola sulle righe «ok» (commissione ÷ prezzo).</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                  <span>Media <b className="tabular-nums">{pct2(stats.avg)}</b></span>
                  <span>Minima <b className="tabular-nums">{pct2(stats.min)}</b></span>
                  <span>Massima <b className="tabular-nums">{pct2(stats.max)}</b></span>
                  <span>Pesata sugli importi <b className="tabular-nums">{pct2(stats.weighted)}</b></span>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: stats.allEqual ? "var(--ok)" : "var(--warn)", backgroundColor: `color-mix(in srgb, ${stats.allEqual ? "var(--ok)" : "var(--warn)"} 14%, transparent)` }}>
                    {stats.allEqual ? `Tutte uguali: circa ${pct1(stats.weighted)}` : "Percentuali diverse tra le righe"}
                  </span>
                </div>
                <div className="grid gap-x-6 gap-y-0.5 text-xs text-dim sm:grid-cols-2 md:grid-cols-3">
                  {stats.items.map((i) => (
                    <div key={i.code} className="flex items-baseline justify-between gap-2 border-b border-line py-0.5"><span className="min-w-0 truncate">{i.guest || i.code}</span><span className="tabular-nums text-txt">{pct2(i.pct)}</span></div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-faint">Calcolata sulle {stats.items.length} righe già uguali tra Booking e Xenora (cancellate e a prezzo zero escluse). Piccole differenze sono arrotondamenti dei centesimi.</p>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className="font-mono text-xl font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {hint && <div className="truncate text-[11px] text-faint" title={hint}>{hint}</div>}
    </div>
  );
}
