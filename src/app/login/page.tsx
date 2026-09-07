"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseEnabled } from "@/lib/supabase";

type Mode = "login" | "signup";
type Provider = "google" | "facebook";

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
  const [recovery, setRecovery] = useState(false); // arrivo da link "reimposta password"

  // All'apertura: se arrivo da un LINK EMAIL (conferma o reset) resto sulla pagina di accesso,
  // altrimenti — se sono già autenticato normalmente — entro nell'app.
  useEffect(() => {
    if (!supabaseEnabled || !supabase) return;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const fromEmail = hash.includes("access_token") || hash.includes("type=");
    const cleanHash = () => { try { history.replaceState(null, "", window.location.pathname); } catch {} };

    if (fromEmail) {
      const isRecovery = hash.includes("type=recovery");
      (async () => {
        await supabase!.auth.getSession(); // lascia elaborare il token dell'URL
        if (isRecovery) {
          setRecovery(true); // mostra il form "nuova password"
        } else {
          // Conferma email: chiudo la sessione temporanea e invito ad accedere.
          try { await supabase!.auth.signOut(); } catch {}
          setInfo("Email confermata ✅ Ora accedi con la tua email e password.");
        }
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

    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pwd });
        if (error) { setErr(traduci(error.message)); return; }
        router.push("/");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: pwd,
          options: { data: { full_name: name.trim(), phone: phone.trim() }, emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined },
        });
        if (error) { setErr(traduci(error.message)); return; }
        if (data.session) router.push("/");
        else { setInfo("Ti abbiamo inviato un'email di conferma. Apri il link e poi torna qui per accedere."); setMode("login"); }
      }
    } catch {
      setErr("Si è verificato un problema. Riprova tra poco.");
    } finally { setBusy(false); }
  };

  const oauth = async (provider: Provider) => {
    setErr(null); setInfo(null);
    if (!supabaseEnabled || !supabase) { router.push("/"); return; }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: typeof window !== "undefined" ? `${window.location.origin}/` : undefined },
      });
      if (error) setErr(`Accesso con ${provider === "google" ? "Google" : "Facebook"} non ancora attivo. Va abilitato nelle impostazioni.`);
    } catch {
      setErr("Accesso social non disponibile al momento.");
    }
  };

  const resetPwd = async () => {
    setErr(null); setInfo(null);
    if (!supabaseEnabled || !supabase) { setInfo("Nella versione dimostrativa l'accesso è libero: premi Accedi."); return; }
    if (!email.trim()) { setErr("Scrivi prima la tua email qui sopra, poi premi «Password dimenticata»."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined,
      });
      if (error) setErr(traduci(error.message));
      else setInfo("Ti abbiamo inviato un'email per reimpostare la password.");
    } finally { setBusy(false); }
  };

  // Imposta la nuova password dopo aver aperto il link di reset.
  const updatePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setInfo(null);
    if (!supabase) return;
    if (pwd.length < 6) { setErr("La password deve avere almeno 6 caratteri."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) { setErr(traduci(error.message)); return; }
      try { await supabase.auth.signOut(); } catch {}
      setRecovery(false); setPwd("");
      setInfo("Password aggiornata ✅ Ora accedi con la nuova password.");
    } finally { setBusy(false); }
  };

  const fld = "w-full rounded-lg border border-[#e3e0e6] bg-white px-3.5 py-2.5 text-sm text-[#1a1523] outline-none transition focus:border-[#7c6bd6] focus:ring-2 focus:ring-[#7c6bd6]/25 disabled:opacity-60";

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f6f5f8] px-4 py-8 text-[#1a1523]">
      {/* Sfondo astratto */}
      <div aria-hidden className="xbg" />

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#D97F57] to-[#B04A2C] font-display text-2xl font-black text-white shadow-lg">X</div>
          <div>
            <div className="font-display text-2xl font-extrabold tracking-tight text-[#1a1523]">Xenora</div>
            <div className="text-sm text-[#6b6577]">Channel Manager</div>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/70 bg-white/95 p-7 shadow-[0_20px_60px_-15px_rgba(40,30,70,0.35)] backdrop-blur-sm sm:p-8">
          {recovery ? (
            /* ---- Nuova password (dopo il link di reset) ---- */
            <>
              <h1 className="text-xl font-bold tracking-tight text-[#1a1523]">Imposta una nuova password</h1>
              <p className="mt-1 text-[13px] text-[#6b6577]">Scegli la nuova password per il tuo account.</p>
              <form onSubmit={updatePwd} className="mt-5">
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium text-[#4a4458]">Nuova password</span>
                  <div className="relative">
                    <input type={show ? "text" : "password"} required minLength={6} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" className={`${fld} pr-16`} disabled={busy} autoFocus />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold text-[#6b6577] hover:text-[#1a1523]">{show ? "Nascondi" : "Mostra"}</button>
                  </div>
                  <span className="mt-1 block text-[11px] text-[#9a94a6]">Almeno 6 caratteri.</span>
                </label>
                {err && <div className="mt-4 rounded-lg border border-[#f0c2c2] bg-[#fdf1f1] px-3 py-2.5 text-[13px] font-medium text-[#c0392b]">{err}</div>}
                <button type="submit" disabled={busy} className="mt-5 block w-full rounded-lg bg-[#6a5acd] py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-[#5b4bc4] disabled:opacity-60">{busy ? "Attendi…" : "Salva password"}</button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold tracking-tight text-[#1a1523]">{mode === "login" ? "Accedi al tuo account" : "Crea il tuo account"}</h1>

              <form onSubmit={submit} className="mt-5">
                {mode === "signup" && (
                  <label className="mb-3 block">
                    <span className="mb-1 block text-[13px] font-medium text-[#4a4458]">Nome e cognome</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mario Rossi" className={fld} disabled={busy} required />
                  </label>
                )}

                {mode === "signup" && (
                  <label className="mb-3 block">
                    <span className="mb-1 block text-[13px] font-medium text-[#4a4458]">Telefono</span>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+39 333 1234567" className={fld} disabled={busy} required />
                  </label>
                )}

                <label className="mb-3 block">
                  <span className="mb-1 block text-[13px] font-medium text-[#4a4458]">Email</span>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="tu@esempio.com" className={fld} disabled={busy} />
                </label>

                <label className="block">
                  <span className="mb-1 flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[#4a4458]">Password</span>
                    {mode === "login" && <button type="button" onClick={resetPwd} className="text-[13px] font-medium text-[#6a5acd] hover:underline" disabled={busy}>Password dimenticata?</button>}
                  </span>
                  <div className="relative">
                    <input type={show ? "text" : "password"} required minLength={6} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" className={`${fld} pr-16`} disabled={busy} />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold text-[#6b6577] hover:text-[#1a1523]">{show ? "Nascondi" : "Mostra"}</button>
                  </div>
                  {mode === "signup" && <span className="mt-1 block text-[11px] text-[#9a94a6]">Almeno 6 caratteri.</span>}
                </label>

                <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-[#4a4458]">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-[#6a5acd]" />
                  Ricordami su questo dispositivo
                </label>

                {err && <div className="mt-4 rounded-lg border border-[#f0c2c2] bg-[#fdf1f1] px-3 py-2.5 text-[13px] font-medium text-[#c0392b]">{err}</div>}
                {info && <div className="mt-4 rounded-lg border border-[#e3e0e6] bg-[#f6f5f8] px-3 py-2.5 text-[13px] text-[#4a4458]">{info}</div>}

                <button type="submit" disabled={busy} className="mt-5 block w-full rounded-lg bg-[#6a5acd] py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-[#5b4bc4] disabled:opacity-60">
                  {busy ? "Attendi…" : mode === "login" ? "Accedi" : "Crea account"}
                </button>
              </form>

              {/* Divisore */}
              <div className="my-5 flex items-center gap-3 text-[12px] font-medium text-[#9a94a6]">
                <span className="h-px flex-1 bg-[#e3e0e6]" />
                {mode === "login" ? "Oppure accedi con" : "Oppure registrati con"}
                <span className="h-px flex-1 bg-[#e3e0e6]" />
              </div>

              {/* Social */}
              <div className="flex flex-col gap-2.5">
                <button type="button" onClick={() => oauth("google")} className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#e3e0e6] bg-white py-2.5 text-sm font-semibold text-[#1a1523] transition hover:bg-[#f6f5f8]">
                  <GoogleIcon /> Google
                </button>
                <button type="button" onClick={() => oauth("facebook")} className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#e3e0e6] bg-white py-2.5 text-sm font-semibold text-[#1a1523] transition hover:bg-[#f6f5f8]">
                  <FacebookIcon /> Facebook
                </button>
              </div>
            </>
          )}
        </div>

        {/* Passa a registrazione / login */}
        {!recovery && (
          <div className="mt-5 text-center text-sm text-[#4a4458]">
            {mode === "login" ? (
              <>Non hai ancora un account? <button onClick={() => { setMode("signup"); setErr(null); setInfo(null); }} className="font-semibold text-[#6a5acd] hover:underline">Crea un account</button></>
            ) : (
              <>Hai già un account? <button onClick={() => { setMode("login"); setErr(null); setInfo(null); }} className="font-semibold text-[#6a5acd] hover:underline">Accedi</button></>
            )}
          </div>
        )}

        {!supabaseEnabled && <div className="mt-3 text-center text-xs text-[#9a94a6]">Accesso dimostrativo · backend non configurato</div>}
        <div className="mt-8 text-center text-xs text-[#9a94a6]">© {new Date().getFullYear()} Xenora · Channel Manager</div>
      </div>

      <style>{`
        .xbg {
          position: absolute; inset: -20% -20% -20% -20%; z-index: 0;
          background:
            radial-gradient(38% 45% at 18% 22%, rgba(122,163,220,0.55) 0%, rgba(122,163,220,0) 60%),
            radial-gradient(40% 42% at 82% 18%, rgba(240,169,60,0.55) 0%, rgba(240,169,60,0) 60%),
            radial-gradient(46% 50% at 78% 78%, rgba(232,106,154,0.55) 0%, rgba(232,106,154,0) 62%),
            radial-gradient(44% 48% at 22% 82%, rgba(123,108,224,0.50) 0%, rgba(123,108,224,0) 62%),
            radial-gradient(50% 55% at 50% 50%, rgba(217,127,87,0.35) 0%, rgba(217,127,87,0) 65%);
          filter: blur(30px) saturate(1.05);
          animation: xflow 22s ease-in-out infinite alternate;
        }
        @keyframes xflow {
          0%   { transform: translate3d(0,0,0) scale(1); }
          50%  { transform: translate3d(2%, -1.5%, 0) scale(1.06); }
          100% { transform: translate3d(-2%, 2%, 0) scale(1.03); }
        }
        @media (prefers-reduced-motion: reduce) { .xbg { animation: none; } }
      `}</style>
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

function FacebookIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
      <path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.68 4.53-4.68 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
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
  if (m.includes("same password")) return "La nuova password non può essere uguale alla precedente.";
  return msg;
}
