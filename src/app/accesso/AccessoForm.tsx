"use client";

// Un solo clic dall'email di invito. Tre casi, decisi dal server (api/auth/access-status):
//  - indirizzo nuovo: sceglie la password ed entra;
//  - indirizzo che ha già un accesso (es. registrato con Google, tolto dall'elenco e invitato di nuovo): può entrare con Google oppure impostare la password
//    (il link firmato prova che l'indirizzo è suo, come una email di reset);
//  - link già usato o non più valido: si può chiederne uno nuovo.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BrandLockup, Notice, PUB, PASSWORD_MIN, PASSWORD_RULE } from "@/components/PublicUi";
import PublicTheme from "@/components/PublicTheme";

type Params = { e: string; t: string; n: string; s: string };
type View = "loading" | "bad" | "new" | "existing" | "used";
type Problem = { text: string; renew: boolean; login?: boolean } | null;

export default function AccessoForm() {
  const [p, setP] = useState<Params | null>(null);
  const [view, setView] = useState<View>("loading");
  const [badText, setBadText] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [renewed, setRenewed] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = q.get("e") || "", t = q.get("t") || "", n = q.get("n") || "/", s = q.get("s") || "";
    if (!(e && t && s)) { setView("bad"); setBadText("Il link è incompleto. Apri di nuovo l'email di invito e clicca il pulsante."); return; }
    const params = { e, t, n, s };
    setP(params);
    (async () => {
      try {
        const r = await fetch("/api/auth/access-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
        const j = await r.json().catch(() => ({})) as { state?: string; providers?: string[]; message?: string };
        if (j.state === "new") setView("new");
        else if (j.state === "existing") { setProviders(j.providers ?? []); setView("existing"); }
        else if (j.state === "used") setView("used");
        else { setView("bad"); setBadText(j.message || "Non riesco a controllare il link: riprova tra poco."); }
      } catch { setView("bad"); setBadText("Errore di rete. Riprova."); }
    })();
  }, []);

  async function renew() {
    if (!p) return;
    setBusy(true);
    try { await fetch("/api/auth/access-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: p.e, next: p.n }) }); } catch { /* risposta uguale */ }
    setBusy(false); setRenewed(true);
  }

  async function google() {
    if (!p || !supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}${p.n || "/"}` } });
    if (error) { setBusy(false); setProblem({ text: "Accesso con Google non disponibile al momento: usa la password.", renew: false }); }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!p || busy) return;
    setProblem(null);
    if (pwd.length < PASSWORD_MIN) { setProblem({ text: `La password deve avere almeno ${PASSWORD_MIN} caratteri.`, renew: false }); return; }
    if (pwd !== pwd2) { setProblem({ text: "Le due password non coincidono.", renew: false }); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/complete-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...p, password: pwd }) });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; message?: string };
      if (!r.ok || !j.ok) {
        setProblem({ text: j.message || "Non sono riuscito a completare l'accesso. Riprova.", renew: j.error === "invalid_link" || j.error === "not_invited" || j.error === "link_used", login: j.error === "already_registered" || j.error === "link_used" });
        return;
      }
      if (!supabase) { setProblem({ text: "Servizio non disponibile: riprova tra poco.", renew: false }); return; }
      const { error } = await supabase.auth.signInWithPassword({ email: p.e, password: pwd });
      if (error) { setProblem({ text: "Password salvata, ma non sono riuscito a farti entrare: vai alla pagina di accesso e usa la tua email e la password scelta.", renew: false, login: true }); return; }
      window.location.assign(p.n || "/"); // ricarica completa: l'app parte già con la sessione
    } catch {
      setProblem({ text: "Errore di rete. Riprova.", renew: false });
    } finally { setBusy(false); }
  }

  const loginHref = `/login?next=${encodeURIComponent(p?.n || "/")}${p ? `&email=${encodeURIComponent(p.e)}` : ""}`;
  const passwordForm = (
    <form onSubmit={submit} noValidate>
      <label className={PUB.label} htmlFor="pw1">Password</label>
      <input id="pw1" type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} className={PUB.field} disabled={busy} autoFocus={view === "new"} />
      <span className={PUB.hint}>{PASSWORD_RULE}</span>
      <label className={`${PUB.label} mt-4`} htmlFor="pw2">Ripeti la password</label>
      <input id="pw2" type="password" autoComplete="new-password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} className={PUB.field} disabled={busy} />
      {problem && (
        <Notice kind="err" className="mt-4">
          <span>
            {problem.text}
            {problem.login && <> <a href={loginHref} className="font-semibold underline">Vai all&apos;accesso</a></>}
          </span>
        </Notice>
      )}
      {problem?.renew && !renewed && <button type="button" onClick={renew} disabled={busy} className={`${PUB.btnSecondary} mt-3 w-full`}>Richiedi un nuovo link</button>}
      <button type="submit" disabled={busy} className={`${PUB.btnPrimary} mt-5 w-full`}>{busy ? "Attendi…" : view === "existing" ? "Imposta la password ed entra" : "Entra in Xenora"}</button>
    </form>
  );

  return (
    <div className={`${PUB.page} flex items-center justify-center px-4 py-10`}>
      <PublicTheme />
      <main className={`${PUB.card} max-w-md`} style={{ overflowWrap: "anywhere" }}>
        <div className="mb-6"><BrandLockup /></div>
        {view === "loading" ? (
          <div role="status" aria-busy="true" aria-label="Caricamento in corso" className="grid place-items-center py-7">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/xenora-mark.png" alt="" width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain", opacity: 0.8 }} />
          </div>
        ) : view === "bad" ? (
          <>
            <h1 className={PUB.h1}>Link non valido</h1>
            <p className={`${PUB.lead} mb-5`}>{badText}</p>
            {p && !renewed && <button type="button" onClick={renew} disabled={busy} className={`${PUB.btnSecondary} mb-3 w-full`}>Richiedi un nuovo link</button>}
            {renewed && <Notice kind="ok" className="mb-3"><span>Se l&apos;indirizzo è ancora abilitato, ti abbiamo inviato un nuovo link. Controlla la posta.</span></Notice>}
            <a href="/login" className={`${PUB.btnPrimary} w-full`}>Vai all&apos;accesso</a>
          </>
        ) : view === "used" ? (
          <>
            <h1 className={PUB.h1}>Link già usato</h1>
            <p className={`${PUB.lead} mb-5`}>Da quando abbiamo creato questo link hai già fatto l&apos;accesso con <b className="text-txt">{p?.e}</b>. Entra con le tue credenziali, oppure chiedi un nuovo link se vuoi cambiare la password.</p>
            {!renewed && <button type="button" onClick={renew} disabled={busy} className={`${PUB.btnSecondary} mb-3 w-full`}>Richiedi un nuovo link</button>}
            {renewed && <Notice kind="ok" className="mb-3"><span>Ti abbiamo inviato un nuovo link. Controlla la posta.</span></Notice>}
            <a href={loginHref} className={`${PUB.btnPrimary} w-full`}>Vai all&apos;accesso</a>
          </>
        ) : view === "existing" ? (
          <>
            <h1 className={PUB.h1}>Bentornato</h1>
            <p className={`${PUB.lead} mb-5`}>Hai già un accesso a Xenora con <b className="text-txt">{p?.e}</b>. L&apos;invito è attivo: scegli come entrare.</p>
            {providers.includes("google") && (
              <>
                <button type="button" onClick={google} disabled={busy} className={`${PUB.btnPrimary} w-full`}>Entra con Google</button>
                <div className="my-5 flex items-center gap-3 text-xs text-dim" aria-hidden><span className="h-px flex-1 bg-line" />oppure<span className="h-px flex-1 bg-line" /></div>
              </>
            )}
            <p className={`${PUB.lead} mb-3`}>{providers.includes("google") ? "Imposta una password per entrare anche senza Google." : "Imposta una nuova password per questo accesso."}</p>
            {passwordForm}
            <p className="mt-4 text-center text-xs text-dim">Ricordi già la tua password? <a href={loginHref} className="font-semibold text-focus underline">Accedi</a></p>
          </>
        ) : (
          <>
            <h1 className={PUB.h1}>Scegli la tua password</h1>
            <p className={`${PUB.lead} mb-5`}>Ultimo passo: scegli la password per <b className="text-txt">{p?.e}</b>. Poi entri subito.</p>
            {passwordForm}
          </>
        )}
      </main>
    </div>
  );
}
