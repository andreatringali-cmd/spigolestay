"use client";

import LoginWaves from "@/components/LoginWaves";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import Turnstile from "@/components/Turnstile";

// Site key pubblica di Cloudflare Turnstile: se presente, mostra il captcha e invia il token a Supabase.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Mode = "login" | "signup";

// Dove andare dopo l'accesso: ?next=/percorso (solo interno) oppure un invito in sospeso.
function afterLoginPath(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (next.startsWith("/") && !next.startsWith("//")) return next;
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

export default function LoginPage() {
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
        else { try { await supabase!.auth.signOut(); } catch {} setInfo("Email confermata ✅ Ora accedi con la tua email e password."); }
        cleanHash();
      })();
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { router.replace(afterLoginPath()); return; }
      // Link diretto dall'email (?auto=google): parte subito il login Google, un click solo,
      // invece di aprire la pagina e aspettare che la persona prema di nuovo "Accedi con Google".
      try {
        const auto = new URLSearchParams(window.location.search).get("auto");
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
        router.push(afterLoginPath());
      } else {
        if (pwd.length < 8) { setErr("La password deve avere almeno 8 caratteri."); return; }
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
      if (error) { void provider; setErr("Accesso con Google non ancora attivo. Va abilitato nelle impostazioni."); }
    } catch { setErr("Accesso social non disponibile al momento."); }
  };

  const resetPwd = async () => {
    setErr(null); setInfo(null);
    if (!supabaseEnabled || !supabase) { setInfo("Nella versione dimostrativa l'accesso è libero: premi Accedi."); return; }
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
    if (pwd.length < 8) { setErr("La password deve avere almeno 8 caratteri."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) { setErr(traduci(error.message)); return; }
      try { await supabase.auth.signOut(); } catch {}
      setRecovery(false); setPwd("");
      setInfo("Password aggiornata ✅ Ora accedi con la nuova password.");
    } finally { setBusy(false); }
  };

  const fld = "w-full rounded-lg border border-[#d9d5cf] bg-white px-3.5 py-2.5 text-sm text-[#1f1b16] outline-none transition focus:border-[#2f6bb0] focus:ring-2 focus:ring-[#2f6bb0]/20 disabled:opacity-60";
  const primaryBtn = "block w-full rounded-lg bg-[#2f6bb0] py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-[#285d99] disabled:opacity-60";
  const linkCls = "font-semibold text-[#2f6bb0] hover:underline";

  return (
    <div className="login-bg relative flex flex-col overflow-hidden px-6 py-6 text-[#1f1b16]">
      <LoginWaves />
      <main className="relative flex w-full min-h-0 flex-1 flex-col items-center justify-center overflow-x-hidden overflow-y-auto">
        <div className="w-full max-w-md rounded-3xl border border-[#e6ebf5] bg-white px-6 py-6 shadow-[0_20px_50px_-28px_rgba(31,27,22,0.35)] sm:px-8 sm:py-8">
          {/* Logo dentro il box, centrato */}
          <div className="mb-4 flex flex-col items-center">
            <Image src="/xenora-logo.png" alt="Xenora" width={220} height={62} priority className="object-contain" style={{ width: 220, height: "auto" }} />
            {/* Slogan di marca: resta in inglese in ogni lingua (volutamente non passa dal sistema i18n) */}
          </div>

          {inviteFlow ? (
            <>
              <div className="mb-4 flex items-center justify-between text-[11px] font-medium text-[#9a9186]">
                <span>Passo 1 di 7</span><span>Il tuo accesso</span>
              </div>
              <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-[#f0eee9]"><div className="h-full rounded-full bg-[#2f6bb0]" style={{ width: "14%" }} /></div>
              <h1 className="text-2xl font-bold tracking-tight">Crea le tue credenziali</h1>
              <p className="mt-1 text-sm text-[#6b6459]">Scegli un nome utente e una password: ci vuole un minuto, poi si parte con la configurazione della tua struttura.</p>
              <form onSubmit={submit} className="mt-6">
                <label className="mb-3 block">
                  <span className="mb-1 block text-[13px] font-medium text-[#4a453d]">Nome utente</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="es. mario.rossi" className={fld} disabled={busy} autoFocus required minLength={3} />
                </label>
                <label className="mb-3 block">
                  <span className="mb-1 block text-[13px] font-medium text-[#4a453d]">Email</span>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={fld} disabled={busy} />
                </label>
                <label className="mb-3 block">
                  <span className="mb-1 block text-[13px] font-medium text-[#4a453d]">Password</span>
                  <div className="relative">
                    <input type={show ? "text" : "password"} required minLength={8} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" className={`${fld} pr-16`} disabled={busy} />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold text-[#6b6459] hover:text-[#1f1b16]">{show ? "Nascondi" : "Mostra"}</button>
                  </div>
                  <span className="mt-1 block text-[11px] text-[#9a9186]">Almeno 8 caratteri.</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium text-[#4a453d]">Ripeti password</span>
                  <input type={show ? "text" : "password"} required minLength={8} value={pwd2} onChange={(e) => setPwd2(e.target.value)} placeholder="••••••••" className={fld} disabled={busy} />
                </label>

                {TURNSTILE_SITE_KEY && <Turnstile key={captchaKey} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />}
                {err && <div className="mt-4 rounded-lg border border-[#f0c2c2] bg-[#fdf1f1] px-3 py-2.5 text-[13px] font-medium text-[#c0392b]">{err}</div>}
                {info && <div className="mt-4 rounded-lg border border-[#e2ded7] bg-[#f6f4f1] px-3 py-2.5 text-[13px] text-[#4a453d]">{info}</div>}

                <button type="submit" disabled={busy} className={`mt-5 ${primaryBtn}`}>{busy ? "Attendi…" : "Continua →"}</button>
              </form>
            </>
          ) : recovery ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Imposta una nuova password</h1>
              <p className="mt-1 text-sm text-[#6b6459]">Scegli la nuova password per il tuo account.</p>
              <form onSubmit={updatePwd} className="mt-6">
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium text-[#4a453d]">Nuova password</span>
                  <div className="relative">
                    <input type={show ? "text" : "password"} required minLength={8} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" className={`${fld} pr-16`} disabled={busy} autoFocus />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold text-[#6b6459] hover:text-[#1f1b16]">{show ? "Nascondi" : "Mostra"}</button>
                  </div>
                  <span className="mt-1 block text-[11px] text-[#9a9186]">Almeno 8 caratteri, meglio con lettere e numeri.</span>
                </label>
                {err && <div className="mt-4 rounded-lg border border-[#f0c2c2] bg-[#fdf1f1] px-3 py-2.5 text-[13px] font-medium text-[#c0392b]">{err}</div>}
                <button type="submit" disabled={busy} className={`mt-5 ${primaryBtn}`}>{busy ? "Attendi…" : "Salva password"}</button>
              </form>
            </>
          ) : (
            <>
              <form onSubmit={submit} className="mt-2">
                {mode === "signup" && (
                  <label className="mb-3 block">
                    <span className="mb-1 block text-[13px] font-medium text-[#4a453d]">Nome e cognome</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mario Rossi" className={fld} disabled={busy} required />
                  </label>
                )}
                {mode === "signup" && (
                  <label className="mb-3 block">
                    <span className="mb-1 block text-[13px] font-medium text-[#4a453d]">Telefono</span>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+39 333 1234567" className={fld} disabled={busy} required />
                  </label>
                )}

                <label className="mb-3 block">
                  <span className="mb-1 block text-[13px] font-medium text-[#4a453d]">Email</span>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete={mode === "signup" ? "off" : "email"} placeholder="tu@esempio.com" className={fld} disabled={busy} />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium text-[#4a453d]">Password</span>
                  <div className="relative">
                    <input type={show ? "text" : "password"} required minLength={mode === "signup" ? 8 : 6} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" className={`${fld} pr-16`} disabled={busy} />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold text-[#6b6459] hover:text-[#1f1b16]">{show ? "Nascondi" : "Mostra"}</button>
                  </div>
                  {mode === "signup" && <span className="mt-1 block text-[11px] text-[#9a9186]">Almeno 8 caratteri, meglio con lettere e numeri.</span>}
                </label>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#4a453d]">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-[#2f6bb0]" />
                    Ricordami
                  </label>
                  {mode === "login" && <button type="button" onClick={resetPwd} className="text-[13px] font-medium text-[#2f6bb0] hover:underline" disabled={busy}>Password dimenticata?</button>}
                </div>

                {TURNSTILE_SITE_KEY && <Turnstile key={captchaKey} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />}

                {denied && (
                  <div className="mt-4 rounded-lg border border-[#e6cfa2] bg-[#fbf3e2] px-3 py-2.5 text-[13px] text-[#8a6d1f]">
                    Il tuo account non è ancora abilitato. Xenora è ad <strong>accesso su invito</strong>: {" "}
                    <a href="https://www.xenoradigitalsolutions.it" target="_blank" rel="noreferrer" className={linkCls}>richiedi una demo</a> per ottenere l&apos;accesso.
                  </div>
                )}
                {err && <div className="mt-4 rounded-lg border border-[#f0c2c2] bg-[#fdf1f1] px-3 py-2.5 text-[13px] font-medium text-[#c0392b]">{err}</div>}
                {info && <div className="mt-4 rounded-lg border border-[#e2ded7] bg-[#f6f4f1] px-3 py-2.5 text-[13px] text-[#4a453d]">{info}</div>}

                <button type="submit" disabled={busy} className={`mt-5 ${primaryBtn}`}>{busy ? "Attendi…" : mode === "login" ? "Accedi" : "Crea account"}</button>
              </form>

              <div className="my-5 flex items-center gap-3 text-[12px] font-medium text-[#9a9186]">
                <span className="h-px flex-1 bg-[#e2ded7]" />
                {mode === "login" ? "Oppure accedi con" : "Oppure registrati con"}
                <span className="h-px flex-1 bg-[#e2ded7]" />
              </div>

              <button type="button" onClick={() => oauth("google")} className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#d9d5cf] bg-white py-2.5 text-sm font-semibold text-[#1f1b16] transition hover:bg-[#f6f4f1]">
                <GoogleIcon /> Google
              </button>

              {mode === "login" ? (
                <div className="mt-6 text-center">
                  <div className="text-[13px] text-[#4a453d] sm:whitespace-nowrap sm:text-sm">
                    Non hai un account? <a href="https://xenoradigitalsolutions.it#contatti" target="_blank" rel="noreferrer" className="text-[#2f6bb0] hover:underline">Richiedi la demo</a>.
                  </div>
                  <div className="mt-2 text-[11px] text-[#9a9186]">© {new Date().getFullYear()} Xenora Digital Solutions · Tutti i diritti riservati</div>
                </div>
              ) : (
                <div className="mt-6 text-center text-sm text-[#4a453d]">
                  Hai già un account? <button onClick={() => { setMode("login"); setErr(null); setInfo(null); }} className={linkCls}>Accedi</button>
                </div>
              )}

              {!supabaseEnabled && <div className="mt-3 text-center text-xs text-[#9a9186]">Accesso dimostrativo · backend non configurato</div>}
            </>
          )}
        </div>

      </main>
      <footer className="relative mt-3 border-t border-[#eceae4] px-2 pt-2 text-[11px] text-[#9a9186]">
        {/* Mobile: sito + social sulla stessa riga */}
        <div className="flex items-center justify-between gap-2 sm:hidden">
          <a href="https://xenoradigitalsolutions.com" target="_blank" rel="noreferrer" className="hover:text-[#4a453d] hover:underline">xenoradigitalsolutions.com</a>
          <SocialIcons />
        </div>

        {/* Desktop: tutto su una riga */}
        <div className="hidden sm:flex sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <a href="/termini" className="hover:text-[#4a453d] hover:underline">Termini di servizio</a>
            <span className="text-[#dcd6cc]">·</span>
            <a href="/privacy" className="hover:text-[#4a453d] hover:underline">Informativa privacy</a>
            <span className="text-[#dcd6cc]">·</span>
            <a href="/cookie" className="hover:text-[#4a453d] hover:underline">Cookie</a>
            <span className="text-[#dcd6cc]">·</span>
            <a href="https://xenoradigitalsolutions.com" target="_blank" rel="noreferrer" className="hover:text-[#4a453d] hover:underline">xenoradigitalsolutions.com</a>
          </div>
          <SocialIcons />
        </div>
      </footer>

      <style>{`
        html,body{overscroll-behavior-y:none}
        .login-bg{height:100vh;height:100dvh;background-color:#FCFDFF}
      `}</style>
    </div>
  );
}

function SocialIcons() {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {[
        { k: "facebook", u: "https://www.facebook.com", c: "#1877F2" },
        { k: "linkedin", u: "https://www.linkedin.com", c: "#0A66C2" },
        { k: "instagram", u: "https://www.instagram.com", c: "#E4405F" },
        { k: "tiktok", u: "https://www.tiktok.com", c: "#010101" },
      ].map((s) => (
        <a key={s.k} href={s.u} target="_blank" rel="noreferrer" aria-label={s.k} style={{ color: s.c }} className="grid h-6 w-6 place-items-center rounded-md border border-[#e6e1d8] transition hover:bg-[#f2eee6] hover:opacity-90">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d={SOCIAL_PATHS[s.k]} /></svg>
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
  if (m.includes("password should be at least")) return "La password è troppo corta (minimo 6 caratteri).";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "L'indirizzo email non è valido.";
  if (m.includes("rate limit") || m.includes("too many")) return "Troppi tentativi. Attendi qualche minuto e riprova.";
  if (m.includes("captcha")) return "Verifica di sicurezza non riuscita. Riprova.";
  if (m.includes("same password")) return "La nuova password non può essere uguale alla precedente.";
  return msg;
}
