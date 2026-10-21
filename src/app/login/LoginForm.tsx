"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLockup, Notice, PUB, PASSWORD_MIN, PASSWORD_RULE } from "@/components/PublicUi";
import PublicTheme from "@/components/PublicTheme";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import Turnstile from "@/components/Turnstile";

// Site key pubblica di Cloudflare Turnstile: se presente, mostra il captcha e invia il token a Supabase.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Mode = "login" | "signup";

// `next` valido solo se resta sulla STESSA origine: niente "//host", "/\host" (il browser tratta "\" come "/"),
// caratteri di controllo, né URL assoluti.
function isSafeNext(next: string): boolean {
  if (!next.startsWith("/") || next.startsWith("//")) return false;
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return false;
  try { return new URL(next, window.location.origin).origin === window.location.origin; } catch { return false; }
}

// Dove andare dopo l'accesso: ?next=/percorso (solo interno) oppure un invito in sospeso.
function afterLoginPath(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (isSafeNext(next)) return next;
  try { const code = localStorage.getItem("xn-pending-invite"); if (code) return `/accetta-invito?code=${encodeURIComponent(code)}`; } catch {}
  return "/";
}
type Provider = "google";

// Glifi social (path SVG) — coerenti con il footer dell'app.
const SOCIAL_PATHS: Record<string, string> = {
  instagram: "M12 2c2.7 0 3 0 4.1.1 1 .1 1.7.2 2.3.5.6.2 1.1.5 1.6 1 .5.5.8 1 1 1.6.2.6.4 1.3.5 2.3.1 1.1.1 1.4.1 4.1s0 3-.1 4.1c-.1 1-.2 1.7-.5 2.3-.2.6-.5 1.1-1 1.6-.5.5-1 .8-1.6 1-.6.2-1.3.4-2.3.5-1.1.1-1.4.1-4.1.1s-3 0-4.1-.1c-1-.1-1.7-.2-2.3-.5-.6-.2-1.1-.5-1.6-1-.5-.5-.8-1-1-1.6-.2-.6-.4-1.3-.5-2.3C2 15 2 14.7 2 12s0-3 .1-4.1c.1-1 .2-1.7.5-2.3.2-.6.5-1.1 1-1.6.5-.5 1-.8 1.6-1 .6-.2 1.3-.4 2.3-.5C9 2 9.3 2 12 2zm0 1.8c-2.7 0-3 0-4 .1-.8 0-1.2.2-1.5.3-.4.1-.7.3-1 .6-.3.3-.5.6-.6 1-.1.3-.3.7-.3 1.5-.1 1-.1 1.3-.1 4s0 3 .1 4c0 .8.2 1.2.3 1.5.1.4.3.7.6 1 .3.3.6.5 1 .6.3.1.7.3 1.5.3 1 .1 1.3.1 4 .1s3 0 4-.1c.8 0 1.2-.2 1.5-.3.4-.1.7-.3 1-.6.3-.3.5-.6.6-1 .1-.3.3-.7.3-1.5.1-1 .1-1.3.1-4s0-3-.1-4c0-.8-.2-1.2-.3-1.5-.1-.4-.3-.7-.6-1-.3-.3-.6-.5-1-.6-.3-.1-.7-.3-1.5-.3-1-.1-1.3-.1-4-.1zm0 3.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2zm0 1.8a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6zm5.3-3.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z",
  tiktok: "M16.5 3c.3 2.1 1.5 3.4 3.5 3.5v2.4c-1.2.1-2.3-.3-3.5-1v5.9c0 3.5-2.6 5.9-5.9 5.9-2.8 0-5.1-2-5.1-4.9 0-3 2.4-5 5.6-4.7v2.5c-.5-.1-1-.2-1.4-.1-1.2.2-2 1-1.9 2.3.1 1.2 1 2 2.2 1.9 1.3-.1 2.1-1 2.1-2.5V3h2.9z",
  facebook: "M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z",
  linkedin: "M20.4 3H3.6C3 3 2.5 3.5 2.5 4.1v15.8c0 .6.5 1.1 1.1 1.1h16.8c.6 0 1.1-.5 1.1-1.1V4.1c0-.6-.5-1.1-1.1-1.1zM8.3 18.3H5.6V9.5h2.7v8.8zM6.9 8.3a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zm11.4 10H15.6v-4.3c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.4H9.9V9.5h2.6v1.2h.1c.4-.7 1.2-1.4 2.5-1.4 2.7 0 3.2 1.8 3.2 4.1v4.9z",
};

export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [denied, setDenied] = useState(false); // l'utente ha tentato l'accesso ma non è abilitato (su invito)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0); // cambiando la key si rigenera il token (monouso)
  const resetCaptcha = () => { setCaptchaToken(null); setCaptchaKey((k) => k + 1); };

  // Link dall'email di benvenuto per chi non è su Gmail (?mode=signup&email=...): primo passo
  // "credenziali" semplificato (username + email precompilata + password), coerente col wizard
  // che segue subito dopo — invece della pagina di login completa con tutte le altre opzioni.
  const [inviteFlow, setInviteFlow] = useState(false);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const qEmail = params.get("email");
      if (qEmail) setEmail(qEmail);
      else if (params.get("mode") !== "signup") {
        // "Ricordami": l'email dell'ultimo accesso (solo l'email, mai la password) si ripropone da sola.
        const saved = localStorage.getItem("xn-remember-email");
        if (saved) setEmail(saved);
      }
      if (params.get("mode") === "signup") { setMode("signup"); if (qEmail) setInviteFlow(true); }
    } catch {}
  }, []);

  useEffect(() => {
    if (!supabaseEnabled || !supabase) return;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const fromEmail = hash.includes("access_token") || hash.includes("type=");
    const cleanHash = () => { try { history.replaceState(null, "", window.location.pathname); } catch {} };
    if (fromEmail) {
      const isRecovery = hash.includes("type=recovery");
      (async () => {
        await supabase!.auth.getSession();
        if (isRecovery) setRecovery(true);
        else { try { await supabase!.auth.signOut(); } catch {} setInfo("Email confermata. Ora accedi con la tua email e password."); }
        cleanHash();
      })();
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      const params = new URLSearchParams(window.location.search);
      const linkEmail = (params.get("email") || "").trim().toLowerCase();
      if (data.session) {
        // Link di invito per UN'email precisa (?email=...), ma il browser è già loggato con
        // un account DIVERSO (sessione rimasta aperta da un test/uso precedente): senza questo
        // controllo si finiva dentro all'account sbagliato, mostrando i suoi dati invece di
        // partire da zero con l'email per cui è stato approvato l'accesso.
        const sessionEmail = (data.session.user?.email || "").trim().toLowerCase();
        if (linkEmail && sessionEmail && linkEmail !== sessionEmail) {
          try { await supabase!.auth.signOut(); } catch {}
          setInfo(`Questo browser era collegato come ${sessionEmail}: ti abbiamo disconnesso. Continua qui sotto con ${linkEmail}.`);
        } else {
          router.replace(afterLoginPath());
          return;
        }
      }
      // Link diretto dall'email (?auto=google): parte subito il login Google, un click solo,
      // invece di aprire la pagina e aspettare che la persona prema di nuovo "Accedi con Google".
      try {
        const auto = params.get("auto");
        if (auto === "google") void oauth("google");
      } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Se il cancello di accesso ha rifiutato l'utente (registrazione su invito), mostra l'avviso.
  useEffect(() => { try { if (localStorage.getItem("xn-access-denied")) setDenied(true); } catch {} }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setInfo(null);
    if (!supabaseEnabled || !supabase) { router.push("/"); return; }
    if (TURNSTILE_SITE_KEY && !captchaToken) { setErr("Completa la verifica di sicurezza qui sotto."); return; }
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pwd, options: { captchaToken: captchaToken ?? undefined } });
        if (error) { setErr(traduci(error.message)); return; }
        try { if (remember) localStorage.setItem("xn-remember-email", email.trim()); else localStorage.removeItem("xn-remember-email"); } catch {}
        router.push(afterLoginPath());
      } else {
        if (pwd.length < PASSWORD_MIN) { setErr(`La password deve avere almeno ${PASSWORD_MIN} caratteri.`); return; }
        if (inviteFlow) {
          if (!username.trim() || username.trim().length < 3) { setErr("Scegli un nome utente di almeno 3 caratteri."); return; }
          if (pwd !== pwd2) { setErr("Le due password non coincidono."); return; }
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: pwd,
          options: { data: { full_name: name.trim(), phone: phone.trim() }, emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined, captchaToken: captchaToken ?? undefined },
        });
        if (error) { setErr(traduci(error.message)); return; }
        if (inviteFlow) { try { localStorage.setItem("xn-prefill-username", username.trim()); } catch {} }
        if (data.session) router.push(afterLoginPath());
        else { setInfo("Ti abbiamo inviato un'email di conferma. Apri il link e poi torna qui per accedere."); setMode("login"); }
      }
    } catch {
      setErr("Si è verificato un problema. Riprova tra poco.");
    } finally { setBusy(false); if (TURNSTILE_SITE_KEY) resetCaptcha(); }
  };

  const oauth = async (provider: Provider) => {
    setErr(null); setInfo(null);
    if (!supabaseEnabled || !supabase) { router.push("/"); return; }
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: typeof window !== "undefined" ? `${window.location.origin}${afterLoginPath()}` : undefined } });
      if (error) { void provider; setErr("Accesso con Google non disponibile al momento. Usa email e password."); }
    } catch { setErr("Accesso social non disponibile al momento."); }
  };

  const resetPwd = async () => {
    setErr(null); setInfo(null);
    if (!supabaseEnabled || !supabase) { setInfo("Accesso libero in questo ambiente: premi Accedi."); return; }
    if (!email.trim()) { setErr("Scrivi prima la tua email qui sopra, poi premi «Password dimenticata»."); return; }
    if (TURNSTILE_SITE_KEY && !captchaToken) { setErr("Completa la verifica di sicurezza qui sotto."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined, captchaToken: captchaToken ?? undefined });
      if (error) setErr(traduci(error.message));
      else setInfo("Ti abbiamo inviato un'email per reimpostare la password.");
    } finally { setBusy(false); if (TURNSTILE_SITE_KEY) resetCaptcha(); }
  };

  const updatePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setInfo(null);
    if (!supabase) return;
    if (pwd.length < PASSWORD_MIN) { setErr(`La password deve avere almeno ${PASSWORD_MIN} caratteri.`); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) { setErr(traduci(error.message)); return; }
      try { await supabase.auth.signOut(); } catch {}
      setRecovery(false); setPwd("");
      setInfo("Password aggiornata. Ora accedi con la nuova password.");
    } finally { setBusy(false); }
  };

  const linkCls = PUB.link;
  const pwdProps = { show, onToggle: () => setShow((s) => !s), disabled: busy };

  return (
    <div className={`${PUB.page} flex flex-col px-4 py-6 sm:px-6`}>
      <PublicTheme />
      <main className="flex w-full flex-1 items-center justify-center py-4">
        <div className={`${PUB.card} max-w-md`}>
          <div className="mb-6"><BrandLockup /></div>

          {inviteFlow ? (
            <>
              <h1 className={PUB.h1}>Crea le tue credenziali</h1>
              <p className={PUB.lead}>Scegli un nome utente e una password: ci vuole un minuto, poi si parte con la configurazione della tua struttura.</p>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <Field label="Nome utente" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="es. mario.rossi" disabled={busy} autoFocus required minLength={3} autoCapitalize="none" autoComplete="username" />
                <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} autoComplete="email" />
                <PasswordField label="Password" value={pwd} onChange={setPwd} hint={`Almeno ${PASSWORD_MIN} caratteri.`} minLength={PASSWORD_MIN} autoComplete="new-password" {...pwdProps} />
                <PasswordField label="Ripeti password" value={pwd2} onChange={setPwd2} minLength={PASSWORD_MIN} autoComplete="new-password" {...pwdProps} />

                {TURNSTILE_SITE_KEY && <Turnstile key={captchaKey} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />}
                {err && <Notice kind="err">{err}</Notice>}
                {info && <Notice kind="info">{info}</Notice>}

                <button type="submit" disabled={busy} className={`${PUB.btnPrimary} w-full`}>{busy ? "Attendi…" : "Continua"}</button>
              </form>
            </>
          ) : recovery ? (
            <>
              <h1 className={PUB.h1}>Imposta una nuova password</h1>
              <p className={PUB.lead}>Scegli la nuova password per il tuo account.</p>
              <form onSubmit={updatePwd} className="mt-6 space-y-4">
                <PasswordField label="Nuova password" value={pwd} onChange={setPwd} hint={PASSWORD_RULE} minLength={PASSWORD_MIN} autoComplete="new-password" autoFocus {...pwdProps} />
                {err && <Notice kind="err">{err}</Notice>}
                <button type="submit" disabled={busy} className={`${PUB.btnPrimary} w-full`}>{busy ? "Attendi…" : "Salva password"}</button>
              </form>
            </>
          ) : (
            <>
              <h1 className={PUB.h1}>{mode === "login" ? "Accedi a Xenora" : "Crea il tuo account"}</h1>
              <p className={PUB.lead}>{mode === "login" ? "Entra nel tuo gestionale." : "Inserisci i tuoi dati per iniziare."}</p>
              <form onSubmit={submit} className="mt-6 space-y-4">
                {mode === "signup" && (
                  <Field label="Nome e cognome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mario Rossi" disabled={busy} required autoComplete="name" />
                )}
                {mode === "signup" && (
                  <Field label="Telefono" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+39 333 1234567" disabled={busy} required autoComplete="tel" />
                )}

                <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete={mode === "signup" ? "off" : "email"} placeholder="tu@esempio.com" disabled={busy} />

                {/* In accesso nessun minimo lato browser: lo verifica il server (gli account esistenti restano utilizzabili). La regola dei ${PASSWORD_MIN} caratteri vale in registrazione e nel cambio password. */}
                <PasswordField label="Password" value={pwd} onChange={setPwd} hint={mode === "signup" ? PASSWORD_RULE : undefined} minLength={mode === "signup" ? PASSWORD_MIN : undefined} autoComplete={mode === "signup" ? "new-password" : "current-password"} {...pwdProps} />

                <div className="flex items-center justify-between gap-2">
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-txt">
                    <input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); if (!e.target.checked) { try { localStorage.removeItem("xn-remember-email"); } catch {} } }} className="h-4 w-4 rounded accent-focus" />
                    Ricordami
                  </label>
                  {mode === "login" && <button type="button" onClick={resetPwd} className={`${PUB.link} min-h-9 text-sm`} disabled={busy}>Password dimenticata?</button>}
                </div>

                {TURNSTILE_SITE_KEY && <Turnstile key={captchaKey} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />}

                {denied && (
                  <Notice kind="warn">
                    Il tuo account non è ancora abilitato. Xenora è ad <strong>accesso su invito</strong>:{" "}
                    <a href="https://www.xenoradigitalsolutions.it" target="_blank" rel="noreferrer" className={linkCls}>richiedi una demo</a> per ottenere l&apos;accesso.
                  </Notice>
                )}
                {err && <Notice kind="err">{err}</Notice>}
                {info && <Notice kind="info">{info}</Notice>}

                <button type="submit" disabled={busy} className={`${PUB.btnPrimary} w-full`}>{busy ? "Attendi…" : mode === "login" ? "Accedi" : "Crea account"}</button>
              </form>

              <div className="my-5 flex items-center gap-3 text-xs font-medium text-dim" role="separator">
                <span className="h-px flex-1 bg-line" />
                {mode === "login" ? "Oppure accedi con" : "Oppure registrati con"}
                <span className="h-px flex-1 bg-line" />
              </div>

              <button type="button" onClick={() => oauth("google")} className={`${PUB.btnSecondary} w-full`}>
                <GoogleIcon /> Continua con Google
              </button>

              {mode === "login" ? (
                <p className="mt-6 text-center text-sm text-dim">
                  Non hai un account? <a href="https://xenoradigitalsolutions.it#contatti" target="_blank" rel="noreferrer" className={linkCls}>Richiedi la demo</a>
                </p>
              ) : (
                <p className="mt-6 text-center text-sm text-dim">
                  Hai già un account? <button type="button" onClick={() => { setMode("login"); setErr(null); setInfo(null); }} className={linkCls}>Accedi</button>
                </p>
              )}

              {!supabaseEnabled && <p className="mt-3 text-center text-xs text-dim">Servizio di accesso non configurato in questo ambiente.</p>}
            </>
          )}
        </div>
      </main>

      <footer className="mx-auto mt-4 flex w-full max-w-3xl flex-col gap-3 border-t border-line pt-3 text-xs text-dim sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Informazioni legali" className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
          <a href="/termini" className={`${PUB.linkSubtle} py-2`}>Termini di servizio</a>
          <a href="/privacy" className={`${PUB.linkSubtle} py-2`}>Informativa privacy</a>
          <a href="/cookie" className={`${PUB.linkSubtle} py-2`}>Cookie</a>
          <a href="https://xenoradigitalsolutions.com" target="_blank" rel="noreferrer" className={`${PUB.linkSubtle} py-2`}>xenoradigitalsolutions.com</a>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:justify-end">
          <span>© {new Date().getFullYear()} Xenora Digital Solutions</span>
          <SocialIcons />
        </div>
      </footer>
    </div>
  );
}

// Campo di testo con etichetta associata (htmlFor/id) e suggerimento collegato con aria-describedby.
function Field({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={PUB.label}>{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...props} className={PUB.field} />
      {hint && <span id={`${id}-hint`} className={PUB.hint}>{hint}</span>}
    </div>
  );
}

// Password con interruttore mostra/nascondi (fuori dall'etichetta, con nome accessibile e stato).
function PasswordField({ label, value, onChange, show, onToggle, disabled, hint, ...props }: {
  label: string; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; disabled?: boolean; hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={PUB.label}>{label}</label>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} required value={value} onChange={(e) => onChange(e.target.value)} placeholder="••••••••" disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} {...props} className={`${PUB.field} pr-24`} />
        <button type="button" onClick={onToggle} aria-pressed={show} aria-label={show ? "Nascondi password" : "Mostra password"} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md px-3 py-2 text-xs font-semibold text-dim transition hover:text-txt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
          {show ? "Nascondi" : "Mostra"}
        </button>
      </div>
      {hint && <span id={`${id}-hint`} className={PUB.hint}>{hint}</span>}
    </div>
  );
}

function SocialIcons() {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {[
        { k: "facebook", n: "Facebook", u: "https://www.facebook.com" },
        { k: "linkedin", n: "LinkedIn", u: "https://www.linkedin.com" },
        { k: "instagram", n: "Instagram", u: "https://www.instagram.com" },
        { k: "tiktok", n: "TikTok", u: "https://www.tiktok.com" },
      ].map((s) => (
        <a key={s.k} href={s.u} target="_blank" rel="noreferrer" aria-label={s.n} className="grid h-9 w-9 place-items-center rounded-md border border-line text-dim transition hover:bg-wash hover:text-txt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d={SOCIAL_PATHS[s.k]} /></svg>
        </a>
      ))}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.3 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 6.9-9.6 6.9-16.9z" />
      <path fill="#FBBC05" d="M10.3 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.3-4.6 2.1-7.9 2.1-6.4 0-11.8-3.8-13.7-9.4l-7.8 6.1C6.4 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function traduci(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "Email o password non corretti.";
  if (m.includes("email not confirmed")) return "Devi prima confermare l'email: apri il link che ti abbiamo inviato.";
  if (m.includes("already registered") || m.includes("already exists")) return "Esiste già un account con questa email. Prova ad accedere.";
  if (m.includes("password should be at least")) return `La password è troppo corta (minimo ${PASSWORD_MIN} caratteri).`;
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "L'indirizzo email non è valido.";
  if (m.includes("rate limit") || m.includes("too many")) return "Troppi tentativi. Attendi qualche minuto e riprova.";
  if (m.includes("captcha")) return "Verifica di sicurezza non riuscita. Riprova.";
  if (m.includes("same password")) return "La nuova password non può essere uguale alla precedente.";
  return msg;
}
