"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import Turnstile from "@/components/Turnstile";

// Site key pubblica di Cloudflare Turnstile: se presente, mostra il captcha e invia il token a Supabase.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Mode = "login" | "signup";
type Provider = "google";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0); // cambiando la key si rigenera il token (monouso)
  const resetCaptcha = () => { setCaptchaToken(null); setCaptchaKey((k) => k + 1); };

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
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace("/"); });
  }, [router]);

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
        router.push("/");
      } else {
        if (pwd.length < 8) { setErr("La password deve avere almeno 8 caratteri."); return; }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: pwd,
          options: { data: { full_name: name.trim(), phone: phone.trim() }, emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined, captchaToken: captchaToken ?? undefined },
        });
        if (error) { setErr(traduci(error.message)); return; }
        if (data.session) router.push("/");
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
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: typeof window !== "undefined" ? `${window.location.origin}/` : undefined } });
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
    <div className="flex min-h-screen items-center justify-center bg-white px-6 py-10 text-[#1f1b16]">
      <main className="flex w-full flex-col items-center justify-center">
        <div className="w-full max-w-sm">
          {/* Logo allineato a sinistra, come i campi */}
          <div className="mb-3 mt-2 flex">
            <Image src="/xenora-logo.png" alt="Xenora" width={170} height={48} priority className="object-contain" style={{ width: 170, height: "auto" }} />
          </div>

          {recovery ? (
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
              <h1 className="text-2xl font-bold tracking-tight">{mode === "login" ? "Accedi al tuo account" : "Crea il tuo account"}</h1>
              <p className="mt-1 text-sm text-[#6b6459]">{mode === "login" ? "Bentornato. Inserisci le tue credenziali." : "Bastano pochi dati per iniziare."}</p>

              <form onSubmit={submit} className="mt-6">
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

              <div className="mt-6 text-center text-sm text-[#4a453d]">
                {mode === "login" ? (
                  <>Non hai ancora un account? <a href="https://www.xenoradigitalsolutions.it" target="_blank" rel="noreferrer" className={linkCls}>Contattaci</a></>
                ) : (
                  <>Hai già un account? <button onClick={() => { setMode("login"); setErr(null); setInfo(null); }} className={linkCls}>Accedi</button></>
                )}
              </div>

              {!supabaseEnabled && <div className="mt-3 text-center text-xs text-[#9a9186]">Accesso dimostrativo · backend non configurato</div>}
            </>
          )}
        </div>
      </main>
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
