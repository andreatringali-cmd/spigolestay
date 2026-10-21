"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Notice, PUB } from "@/components/PublicUi";
import { CONTACT_EMAIL } from "./data";

// Modulo «Richiedi l'accesso». Xenora è ad accesso su invito: il modulo usa la rotta già esistente /api/demo-request
// (la stessa del sito vetrina), che invia la richiesta a info@xenora.it. Se l'invio non riesce resta il link email.
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Richiesta di accesso a Xenora")}`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PlanOption { key: string; label: string }

export default function RequestAccessForm({ plans }: { plans: PlanOption[] }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false); // errore di invio (non di compilazione): mostra anche l'indirizzo email
  // Falso nel rendering del server e prima dell'idratazione: senza JavaScript un invio nativo metterebbe i dati dell'utente nell'indirizzo della pagina (GET), quindi il modulo compare solo quando è attivo.
  const ready = useSyncExternalStore(() => () => {}, () => true, () => false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "busy") return;
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    const name = v("name"), email = v("email");
    if (!name) { setError("Inserisci il tuo nome."); setState("err"); return; }
    if (!EMAIL_RE.test(email)) { setError("Inserisci un indirizzo email valido."); setState("err"); return; }
    setState("busy"); setError(null); setSendFailed(false);
    const plan = v("plan"), note = v("message");
    const message = [plan ? `Piano di interesse: ${plan}` : "", note].filter(Boolean).join("\n\n");
    try {
      const res = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone: v("phone"), structure: v("structure"), message, website: v("website") }),
      });
      const j = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (res.ok && j.ok) { setState("ok"); return; }
      const badInput = typeof j.error === "string" && res.status === 400;
      setError(badInput ? j.error! : "Non siamo riusciti a inviare la richiesta."); setSendFailed(!badInput);
      setState("err");
    } catch {
      setError("Non siamo riusciti a inviare la richiesta."); setSendFailed(true); setState("err");
    }
  }

  if (state === "ok") {
    return (
      <Notice kind="ok">
        <p className="font-semibold">Richiesta inviata.</p>
        <p className="mt-1 text-dim">Ti risponderemo all&apos;indirizzo indicato. Quando il tuo accesso sarà abilitato potrai entrare da <Link href="/login" className={PUB.link}>Accedi</Link>.</p>
      </Notice>
    );
  }

  if (!ready) {
    return <p className="text-sm text-dim">Caricamento del modulo… Se non compare, scrivici a <a href={MAILTO} className={PUB.link}>{CONTACT_EMAIL}</a>.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-describedby={state === "err" ? "rq-err" : undefined}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rq-name" className={PUB.label}>Nome e cognome <span aria-hidden>*</span></label>
          <input id="rq-name" name="name" type="text" required autoComplete="name" maxLength={120} className={PUB.field} />
        </div>
        <div>
          <label htmlFor="rq-email" className={PUB.label}>Email <span aria-hidden>*</span></label>
          <input id="rq-email" name="email" type="email" required autoComplete="email" maxLength={160} className={PUB.field} />
        </div>
        <div>
          <label htmlFor="rq-phone" className={PUB.label}>Telefono (facoltativo)</label>
          <input id="rq-phone" name="phone" type="tel" autoComplete="tel" maxLength={60} className={PUB.field} />
        </div>
        <div>
          <label htmlFor="rq-structure" className={PUB.label}>Nome della struttura (facoltativo)</label>
          <input id="rq-structure" name="structure" type="text" autoComplete="organization" maxLength={160} className={PUB.field} />
        </div>
      </div>
      <div>
        <label htmlFor="rq-plan" className={PUB.label}>Piano di interesse (facoltativo)</label>
        <select id="rq-plan" name="plan" defaultValue="" className={PUB.field}>
          <option value="">Non ancora deciso</option>
          {plans.map((p) => <option key={p.key} value={p.label}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="rq-msg" className={PUB.label}>Messaggio (facoltativo)</label>
        <textarea id="rq-msg" name="message" rows={3} maxLength={1500} className={`${PUB.field} h-auto py-2`} />
      </div>
      {/* Trappola anti-spam: invisibile alle persone, ignorata dai lettori di schermo */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Non compilare<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      </div>

      {state === "err" && error && (
        <div id="rq-err">
          <Notice kind="err">
            {error}{sendFailed && <> Riprova oppure scrivici a <a href={MAILTO} className={PUB.link}>{CONTACT_EMAIL}</a>.</>}
          </Notice>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="submit" disabled={state === "busy"} className={PUB.btnPrimary}>{state === "busy" ? "Invio in corso…" : "Richiedi l'accesso"}</button>
        <p className="text-xs text-dim">Usiamo i tuoi dati solo per risponderti. Vedi l&apos;<Link href="/privacy" className={PUB.linkSubtle}>Informativa sulla privacy</Link>.</p>
      </div>
    </form>
  );
}
