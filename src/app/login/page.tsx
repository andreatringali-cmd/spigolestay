"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseEnabled } from "@/lib/supabase";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Se già autenticato, entra direttamente.
  useEffect(() => {
    if (!supabaseEnabled || !supabase) return;
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace("/"); });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setInfo(null);

    // Modalità dimostrativa (variabili non configurate): accesso libero come prima.
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
          options: { data: { full_name: name.trim() }, emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined },
        });
        if (error) { setErr(traduci(error.message)); return; }
        if (data.session) {
          // Registrazione con accesso immediato (conferma email disattivata).
          router.push("/");
        } else {
          // Serve la conferma via email prima di poter accedere.
          setInfo("Ti abbiamo inviato un'email di conferma. Apri il link e poi torna qui per accedere.");
          setMode("login");
        }
      }
    } catch {
      setErr("Si è verificato un problema. Riprova tra poco.");
    } finally {
      setBusy(false);
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

  const fld = "w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-txt outline-none focus:border-focus disabled:opacity-60";

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 text-txt">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#D97F57] to-[#B04A2C] font-display text-2xl font-black text-white shadow-lg">X</div>
          <div>
            <div className="font-display text-2xl font-extrabold tracking-tight">Xenora</div>
            <div className="text-sm text-dim">Channel Manager</div>
          </div>
        </div>

        {/* Selettore accesso / registrazione */}
        <div className="mb-4 flex rounded-xl border border-line bg-surface p-1 text-sm font-semibold">
          <button type="button" onClick={() => { setMode("login"); setErr(null); setInfo(null); }} className={`flex-1 rounded-lg py-2 transition ${mode === "login" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>Accedi</button>
          <button type="button" onClick={() => { setMode("signup"); setErr(null); setInfo(null); }} className={`flex-1 rounded-lg py-2 transition ${mode === "signup" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>Crea account</button>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          {mode === "signup" && (
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-dim">Nome e cognome</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mario Rossi" className={fld} disabled={busy} />
            </label>
          )}

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-dim">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="tu@esempio.com" className={fld} disabled={busy} />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-dim">Password</span>
            <div className="relative">
              <input type={show ? "text" : "password"} required minLength={6} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" className={`${fld} pr-16`} disabled={busy} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold text-dim hover:text-txt">{show ? "Nascondi" : "Mostra"}</button>
            </div>
            {mode === "signup" && <span className="mt-1 block text-[11px] text-faint">Almeno 6 caratteri.</span>}
          </label>

          {mode === "login" && (
            <div className="mb-4 flex items-center justify-end text-xs">
              <button type="button" onClick={resetPwd} className="font-medium text-focus hover:underline" disabled={busy}>Password dimenticata?</button>
            </div>
          )}

          {err && <div className="mb-3 rounded-lg border border-[color:var(--bad)] bg-[color:color-mix(in_srgb,var(--bad)_10%,transparent)] px-3 py-2.5 text-xs font-medium text-[color:var(--bad)]">{err}</div>}
          {info && <div className="mb-3 rounded-lg border border-line bg-paper px-3 py-2.5 text-xs text-dim">{info}</div>}

          <button type="submit" disabled={busy} className="block w-full rounded-lg bg-focus py-2.5 text-center text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
            {busy ? "Attendi…" : mode === "login" ? "Accedi" : "Crea account"}
          </button>

          {!supabaseEnabled && <div className="mt-3 text-center text-xs text-faint">Accesso dimostrativo · backend non configurato</div>}
        </form>

        {/* Copyright */}
        <div className="mt-6 text-center text-xs text-faint">
          © {new Date().getFullYear()} Xenora · Channel Manager — Tutti i diritti riservati
        </div>
      </div>
    </div>
  );
}

// Messaggi Supabase → italiano leggibile.
function traduci(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "Email o password non corretti.";
  if (m.includes("email not confirmed")) return "Devi prima confermare l'email: apri il link che ti abbiamo inviato.";
  if (m.includes("already registered") || m.includes("already exists")) return "Esiste già un account con questa email. Prova ad accedere.";
  if (m.includes("password should be at least")) return "La password è troppo corta (minimo 6 caratteri).";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "L'indirizzo email non è valido.";
  if (m.includes("rate limit") || m.includes("too many")) return "Troppi tentativi. Attendi qualche minuto e riprova.";
  return msg;
}
