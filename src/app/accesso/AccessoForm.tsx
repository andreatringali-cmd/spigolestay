"use client";

// Un solo clic dall'email di invito: la persona sceglie la password ed entra (niente seconda email di conferma).
// Il link firmato dimostra che l'indirizzo è il suo; il server crea l'accesso già confermato (api/auth/complete-access) e qui si fa il login.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BrandLockup, Notice, PUB, PASSWORD_MIN, PASSWORD_RULE } from "@/components/PublicUi";
import PublicTheme from "@/components/PublicTheme";

type Params = { e: string; t: string; n: string; s: string };
type Problem = { text: string; renew: boolean; login?: boolean } | null;

export default function AccessoForm() {
  const [p, setP] = useState<Params | null>(null);
  const [ready, setReady] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [renewed, setRenewed] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = q.get("e") || "", t = q.get("t") || "", n = q.get("n") || "/", s = q.get("s") || "";
    setP(e && t && s ? { e, t, n, s } : null);
    setReady(true);
  }, []);

  async function renew() {
    if (!p) return;
    setBusy(true);
    try { await fetch("/api/auth/access-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: p.e, next: p.n }) }); } catch { /* risposta uguale */ }
    setBusy(false); setRenewed(true);
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
        setProblem({ text: j.message || "Non sono riuscito a completare l'accesso. Riprova.", renew: j.error === "invalid_link" || j.error === "not_invited", login: j.error === "already_registered" });
        return;
      }
      if (!supabase) { setProblem({ text: "Servizio non disponibile: riprova tra poco.", renew: false }); return; }
      const { error } = await supabase.auth.signInWithPassword({ email: p.e, password: pwd });
      if (error) { setProblem({ text: "Accesso creato, ma non sono riuscito a farti entrare: vai alla pagina di accesso e usa la tua email e la password scelta.", renew: false, login: true }); return; }
      window.location.assign(p.n || "/"); // ricarica completa: l'app parte già con la sessione
    } catch {
      setProblem({ text: "Errore di rete. Riprova.", renew: false });
    } finally { setBusy(false); }
  }

  return (
    <div className={`${PUB.page} flex items-center justify-center px-4 py-10`}>
      <PublicTheme />
      <main className={`${PUB.card} max-w-md`} style={{ overflowWrap: "anywhere" }}>
        <div className="mb-6"><BrandLockup /></div>
        {!ready ? null : !p ? (
          <>
            <h1 className={PUB.h1}>Link non valido</h1>
            <p className={`${PUB.lead} mb-6`}>Il link è incompleto. Apri di nuovo l&apos;email di invito e clicca il pulsante, oppure vai alla pagina di accesso.</p>
            <a href="/login" className={`${PUB.btnPrimary} w-full`}>Vai all&apos;accesso</a>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <h1 className={PUB.h1}>Scegli la tua password</h1>
            <p className={`${PUB.lead} mb-5`}>Ultimo passo: scegli la password per <b className="text-txt">{p.e}</b>. Poi entri subito.</p>
            <label className={PUB.label} htmlFor="pw1">Password</label>
            <input id="pw1" type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} className={PUB.field} disabled={busy} autoFocus />
            <span className={PUB.hint}>{PASSWORD_RULE}</span>
            <label className={`${PUB.label} mt-4`} htmlFor="pw2">Ripeti la password</label>
            <input id="pw2" type="password" autoComplete="new-password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} className={PUB.field} disabled={busy} />
            {problem && (
              <Notice kind="err" className="mt-4">
                <span>
                  {problem.text}
                  {problem.login && <> <a href="/login" className="font-semibold underline">Vai all&apos;accesso</a></>}
                </span>
              </Notice>
            )}
            {problem?.renew && !renewed && (
              <button type="button" onClick={renew} disabled={busy} className={`${PUB.btnSecondary} mt-3 w-full`}>Richiedi un nuovo link</button>
            )}
            {renewed && <Notice kind="ok" className="mt-3"><span>Se l&apos;indirizzo è ancora abilitato, ti abbiamo inviato un nuovo link. Controlla la posta.</span></Notice>}
            <button type="submit" disabled={busy} className={`${PUB.btnPrimary} mt-5 w-full`}>{busy ? "Attendi…" : "Entra in Xenora"}</button>
          </form>
        )}
      </main>
    </div>
  );
}
