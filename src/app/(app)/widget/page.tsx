"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { nights, toISO, shiftISO } from "@/lib/dates";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const ACCENTS = ["#4F46E5", "#0E7C66", "#B4531F", "#B3453A", "#0891B2", "#DB2777"];

interface Cfg {
  name: string; showHeader: boolean; theme: "rounded" | "square"; accent: string; lang: string;
  askChildren: boolean; showPrices: boolean;
  leadDays: number; stayLen: number; defGuests: number;
  checkInFrom: string; checkOutBy: string; showUnavailable: boolean; requirePhone: boolean; minStay: number;
  payCard: boolean; payPaypal: boolean; payTransfer: boolean; payOnsite: boolean;
  deposit: "none" | "firstNight" | "percent"; depositPct: number;
  adjMode: "none" | "fixed" | "percent"; adjValue: number;
}
const DEFAULT: Cfg = {
  name: "", showHeader: true, theme: "rounded", accent: ACCENTS[0], lang: "it",
  askChildren: false, showPrices: true,
  leadDays: 0, stayLen: 2, defGuests: 2,
  checkInFrom: "15:00", checkOutBy: "10:00", showUnavailable: false, requirePhone: true, minStay: 1,
  payCard: true, payPaypal: true, payTransfer: true, payOnsite: false,
  deposit: "percent", depositPct: 30,
  adjMode: "none", adjValue: 0,
};

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-focus" : "bg-[color:var(--line)]"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
function Rowt({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div><div className="text-sm text-txt">{label}</div>{hint && <div className="text-[11px] text-faint">{hint}</div>}</div>
      {children}
    </div>
  );
}

export default function WidgetPage() {
  const { t } = useLang();
  const { structures, roomTypes, units, addGuest, addBooking } = useData();
  const [structureId, setStructureId] = useState(structures[0]?.id ?? "");
  const [c, setC] = useState<Cfg>(DEFAULT);
  const set = <K extends keyof Cfg>(k: K, v: Cfg[K]) => setC((p) => ({ ...p, [k]: v }));
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:widget"); if (r) setC({ ...DEFAULT, ...JSON.parse(r) }); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem("spigolestay:widget", JSON.stringify(c)); } catch {} }, [c]);

  const typesOf = roomTypes.filter((rt) => rt.structureId === structureId);
  const [ci, setCi] = useState(toISO(new Date()));
  const [co, setCo] = useState(shiftISO(toISO(new Date()), 2));
  const [guests, setGuests] = useState(2);
  const [children, setChildren] = useState(0);
  const [rtId, setRtId] = useState(typesOf[0]?.id ?? "");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [doneMsg, setDoneMsg] = useState(false);
  const [copied, setCopied] = useState("");

  const structure = structures.find((s) => s.id === structureId);
  const rt = roomTypes.find((r) => r.id === rtId);
  const n = Math.max(1, nights(ci, co));
  const raw = (rt?.basePrice ?? 100) * n;
  const price = c.adjMode === "fixed" ? Math.max(0, raw + c.adjValue) : c.adjMode === "percent" ? Math.max(0, Math.round(raw * (1 + c.adjValue / 100))) : raw;
  const depositAmt = c.deposit === "firstNight" ? (rt?.basePrice ?? 100) : c.deposit === "percent" ? Math.round(price * c.depositPct / 100) : 0;

  const prenota = () => {
    if (!lastName.trim() && !firstName.trim()) return;
    const gid = addGuest({ lastName: lastName.trim() || undefined, firstName: firstName.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined });
    const anyUnit = units.find((u) => u.roomTypeId === rtId && !u.outOfService);
    addBooking({ structureId, roomTypeId: rtId, unitId: anyUnit?.id ?? null, guestId: gid, channel: "direct", status: "confirmed", checkIn: ci, checkOut: co, adults: guests, children, total: price, paid: depositAmt });
    setDoneMsg(true);
    window.setTimeout(() => { setDoneMsg(false); setLastName(""); setFirstName(""); setEmail(""); setPhone(""); }, 3500);
  };

  const sitekey = `${structureId}-${c.accent.replace("#", "")}`;
  const script = `<div id="spigole-book" data-sitekey="${sitekey}"></div>\n<script type="text/javascript" src="https://book.xenora.com/widget/js/form.js" data-sitekey="${sitekey}" async></script>`;
  const iframe = `<iframe src="https://book.xenora.com/w/${sitekey}?lang=${c.lang}" width="100%" height="560" style="border:0;max-width:440px" title="Prenota — ${structure?.name ?? ""}"></iframe>`;
  const copy = (k: string, t: string) => { navigator.clipboard?.writeText(t); setCopied(k); window.setTimeout(() => setCopied(""), 1500); };
  const radius = c.theme === "rounded" ? 16 : 4;

  return (
    <div>
      <PageHeader title={t("Widget sito")} subtitle={t("Il motore prenotazioni per il tuo sito: le prenotazioni entrano dirette nel calendario")} actions={<a href="/prenota" target="_blank" rel="noreferrer" className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Apri il motore")} ↗</a>} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Colonna configurazione */}
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("Aspetto")}</SectionTitle>
            <label className="block text-xs font-medium text-dim">{t("Struttura")}
              <select value={structureId} onChange={(e) => { setStructureId(e.target.value); const t = roomTypes.find((r) => r.structureId === e.target.value); setRtId(t?.id ?? ""); }} className={`mt-1 ${inp}`}>
                {structures.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Tema")}
                <select value={c.theme} onChange={(e) => set("theme", e.target.value as Cfg["theme"])} className={`mt-1 ${inp}`}><option value="rounded">{t("Arrotondato")}</option><option value="square">{t("Squadrato")}</option></select>
              </label>
              <label className="block text-xs font-medium text-dim">{t("Lingua")}
                <select value={c.lang} onChange={(e) => set("lang", e.target.value)} className={`mt-1 ${inp}`}><option value="it">Italiano</option><option value="en">English</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="es">Español</option></select>
              </label>
            </div>
            <div className="mt-2">
              <div className="mb-1 text-xs font-medium text-dim">{t("Colore")}</div>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((col) => (<button key={col} onClick={() => set("accent", col)} className="h-7 w-7 rounded-full transition" style={{ backgroundColor: col, outline: c.accent === col ? "2px solid var(--txt)" : "none", outlineOffset: 2 }} />))}
              </div>
            </div>
            <div className="mt-2 divide-y divide-[color:var(--line)]">
              <Rowt label={t("Mostra intestazione")}><Toggle on={c.showHeader} onChange={(v) => set("showHeader", v)} /></Rowt>
              <Rowt label={t("Mostra i prezzi")}><Toggle on={c.showPrices} onChange={(v) => set("showPrices", v)} /></Rowt>
              <Rowt label={t("Chiedi il numero di bambini")}><Toggle on={c.askChildren} onChange={(v) => set("askChildren", v)} /></Rowt>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Valori predefiniti")}</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Anticipo (gg)")}<input type="number" min={0} value={c.leadDays} onChange={(e) => set("leadDays", +e.target.value)} className={`mt-1 ${inp}`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Durata (notti)")}<input type="number" min={1} value={c.stayLen} onChange={(e) => set("stayLen", Math.max(1, +e.target.value))} className={`mt-1 ${inp}`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Ospiti")}<input type="number" min={1} value={c.defGuests} onChange={(e) => set("defGuests", Math.max(1, +e.target.value))} className={`mt-1 ${inp}`} /></label>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Regole prenotazione")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Check-in dalle")}<input value={c.checkInFrom} onChange={(e) => set("checkInFrom", e.target.value)} className={`mt-1 ${inp}`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Check-out entro")}<input value={c.checkOutBy} onChange={(e) => set("checkOutBy", e.target.value)} className={`mt-1 ${inp}`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Soggiorno minimo (notti)")}<input type="number" min={1} value={c.minStay} onChange={(e) => set("minStay", Math.max(1, +e.target.value))} className={`mt-1 ${inp}`} /></label>
            </div>
            <div className="mt-2 divide-y divide-[color:var(--line)]">
              <Rowt label={t("Mostra anche le camere non disponibili")}><Toggle on={c.showUnavailable} onChange={(v) => set("showUnavailable", v)} /></Rowt>
              <Rowt label={t("Richiedi il numero di telefono")}><Toggle on={c.requirePhone} onChange={(v) => set("requirePhone", v)} /></Rowt>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Pagamenti accettati")}</SectionTitle>
            <div className="divide-y divide-[color:var(--line)]">
              <Rowt label={t("Carta di credito")} hint="VISA · Mastercard · American Express"><Toggle on={c.payCard} onChange={(v) => set("payCard", v)} /></Rowt>
              <Rowt label="PayPal"><Toggle on={c.payPaypal} onChange={(v) => set("payPaypal", v)} /></Rowt>
              <Rowt label={t("Bonifico bancario")}><Toggle on={c.payTransfer} onChange={(v) => set("payTransfer", v)} /></Rowt>
              <Rowt label={t("Pagamento sul posto")} hint={t("Nessuna carta a garanzia")}><Toggle on={c.payOnsite} onChange={(v) => set("payOnsite", v)} /></Rowt>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Acconto")}
                <select value={c.deposit} onChange={(e) => set("deposit", e.target.value as Cfg["deposit"])} className={`mt-1 ${inp}`}><option value="none">{t("Nessuno")}</option><option value="firstNight">{t("Prima notte")}</option><option value="percent">{t("Percentuale")}</option></select>
              </label>
              {c.deposit === "percent" && <label className="block text-xs font-medium text-dim">%<input type="number" min={0} max={100} value={c.depositPct} onChange={(e) => set("depositPct", +e.target.value)} className={`mt-1 ${inp}`} /></label>}
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Correzione prezzo")}</SectionTitle>
            <div className="flex items-center rounded-lg border border-line p-0.5">
              {(["none", "fixed", "percent"] as const).map((m) => (<button key={m} onClick={() => set("adjMode", m)} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${c.adjMode === m ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{m === "none" ? t("Nessuna") : m === "fixed" ? t("Valore fisso") : t("Percentuale")}</button>))}
            </div>
            {c.adjMode !== "none" && <label className="mt-2 block text-xs font-medium text-dim">{c.adjMode === "fixed" ? t("Variazione €") : t("Variazione %")} {t("(negativo per ridurre)")}<input type="number" value={c.adjValue} onChange={(e) => set("adjValue", +e.target.value)} className={`mt-1 ${inp}`} /></label>}
          </Card>

          <Card>
            <SectionTitle>{t("Codice sorgente")}</SectionTitle>
            <p className="mb-2 text-xs text-dim">{t("Copia e incolla nel tuo sito, dentro il tag")} <code>&lt;body&gt;</code>.</p>
            <div className="text-xs font-medium text-dim">Script</div>
            <div className="mt-1 flex items-start gap-2">
              <textarea readOnly value={script} rows={3} className="w-full resize-none rounded-lg border border-line bg-paper p-2 font-mono text-[11px] text-txt" />
              <button onClick={() => copy("s", script)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-txt hover:bg-wash">{copied === "s" ? "✓" : t("Copia")}</button>
            </div>
            <div className="mt-3 text-xs font-medium text-dim">Iframe</div>
            <div className="mt-1 flex items-start gap-2">
              <textarea readOnly value={iframe} rows={3} className="w-full resize-none rounded-lg border border-line bg-paper p-2 font-mono text-[11px] text-txt" />
              <button onClick={() => copy("i", iframe)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-txt hover:bg-wash">{copied === "i" ? "✓" : t("Copia")}</button>
            </div>
            <p className="mt-2 text-xs text-faint">{t("C'è anche il")} <b className="text-dim">{t("plugin WordPress")}</b> {t("(in arrivo): installalo e incolla la sitekey. Le prenotazioni dirette entrano nel calendario e nel registro attività.")}</p>
          </Card>
        </div>

        {/* Anteprima live */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <SectionTitle>{t("Anteprima widget")}</SectionTitle>
          <div className="mx-auto max-w-[440px] overflow-hidden border border-line bg-surface shadow-lg" style={{ borderRadius: radius }}>
            {c.showHeader && (
              <div className="px-5 py-4 text-white" style={{ backgroundColor: c.accent }}>
                <div className="text-sm opacity-90">{t("Prenotazione online")}</div>
                <div className="font-display text-xl font-bold">{structure?.name ?? t("La tua struttura")}</div>
              </div>
            )}
            <div className="flex flex-col gap-3 p-5">
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-dim">{t("Arrivo")}<input type="date" value={ci} onChange={(e) => setCi(e.target.value)} className={`mt-1 ${inp}`} style={{ borderRadius: radius / 2 }} /></label>
                <label className="block text-xs font-medium text-dim">{t("Partenza")}<input type="date" value={co} onChange={(e) => setCo(e.target.value)} className={`mt-1 ${inp}`} style={{ borderRadius: radius / 2 }} /></label>
              </div>
              <div className={`grid gap-2 ${c.askChildren ? "grid-cols-3" : "grid-cols-2"}`}>
                <label className="block text-xs font-medium text-dim">{t("Adulti")}<input type="number" min={1} value={guests} onChange={(e) => setGuests(Math.max(1, +e.target.value))} className={`mt-1 ${inp}`} /></label>
                {c.askChildren && <label className="block text-xs font-medium text-dim">{t("Bambini")}<input type="number" min={0} value={children} onChange={(e) => setChildren(Math.max(0, +e.target.value))} className={`mt-1 ${inp}`} /></label>}
                <label className="block text-xs font-medium text-dim">{t("Camera")}<select value={rtId} onChange={(e) => setRtId(e.target.value)} className={`mt-1 ${inp}`}>{typesOf.map((rt) => (<option key={rt.id} value={rt.id}>{rt.name}</option>))}</select></label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-dim">{t("Cognome")}<input value={lastName} onChange={(e) => setLastName(e.target.value)} className={`mt-1 ${inp}`} /></label>
                <label className="block text-xs font-medium text-dim">{t("Nome")}<input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={`mt-1 ${inp}`} /></label>
              </div>
              <label className="block text-xs font-medium text-dim">{t("Email")}<input value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 ${inp}`} placeholder={t("opzionale")} /></label>
              {c.requirePhone && <label className="block text-xs font-medium text-dim">{t("Telefono")}<input value={phone} onChange={(e) => setPhone(e.target.value)} className={`mt-1 ${inp}`} placeholder="+39…" /></label>}

              {c.showPrices && (
                <div className="rounded-lg bg-wash px-3 py-2" style={{ borderRadius: radius / 2 }}>
                  <div className="flex items-baseline justify-between"><span className="text-sm text-dim">{n} {n === 1 ? t("notte") : t("notti")} · {rt?.name}</span><span className="font-mono text-lg font-bold text-txt">{eur(price)}</span></div>
                  {depositAmt > 0 && <div className="mt-0.5 flex items-baseline justify-between text-xs text-dim"><span>{t("Acconto")}{c.deposit === "percent" ? ` (${c.depositPct}%)` : ` (${t("prima notte")})`}</span><span className="font-mono">{eur(depositAmt)}</span></div>}
                </div>
              )}

              {doneMsg ? (
                <div className="px-3 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: "var(--ok)", borderRadius: radius / 2 }}>✓ {t("Prenotazione ricevuta! Aggiunta al calendario.")}</div>
              ) : (
                <button onClick={prenota} className="py-2.5 text-sm font-bold text-white transition hover:opacity-90" style={{ backgroundColor: c.accent, borderRadius: radius / 2 }}>{t("Prenota ora")}</button>
              )}
              <div className="text-center text-[10px] text-faint">{t("Pagamenti:")} {[c.payCard && t("Carta"), c.payPaypal && "PayPal", c.payTransfer && t("Bonifico"), c.payOnsite && t("Sul posto")].filter(Boolean).join(" · ") || "—"}</div>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-faint">{t("Anteprima reale: “Prenota ora” crea la prenotazione nel calendario.")}</p>
        </div>
      </div>
    </div>
  );
}
