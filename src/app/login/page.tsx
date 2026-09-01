"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [forgot, setForgot] = useState(false);

  // Login dimostrativo: si entra comunque, anche senza credenziali.
  const login = (e?: React.FormEvent) => { e?.preventDefault(); router.push("/"); };

  const fld = "w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-txt outline-none focus:border-focus";

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 text-txt">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#D97F57] to-[#B04A2C] font-display text-2xl font-black text-white shadow-lg">X</div>
          <div>
            <div className="font-display text-2xl font-extrabold tracking-tight">Xenora</div>
            <div className="text-sm text-dim">Digital Solution</div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={login} className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-dim">Nome utente</span>
            <input value={user} onChange={(e) => setUser(e.target.value)} autoFocus placeholder="Il tuo nome utente" className={fld} />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-dim">Password</span>
            <div className="relative">
              <input type={show ? "text" : "password"} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" className={`${fld} pr-16`} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold text-dim hover:text-txt">{show ? "Nascondi" : "Mostra"}</button>
            </div>
          </label>

          <div className="mb-4 flex items-center justify-between text-xs">
            <label className="flex cursor-pointer items-center gap-2 text-dim">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-3.5 w-3.5 accent-[color:var(--focus)]" />
              Ricorda password
            </label>
            <button type="button" onClick={() => setForgot((f) => !f)} className="font-medium text-focus hover:underline">Password dimenticata?</button>
          </div>

          {forgot && (
            <div className="mb-4 rounded-lg border border-line bg-paper px-3 py-2.5 text-xs text-dim">
              Per reimpostare la password contatta l&apos;amministratore della struttura.
              <span className="mt-1 block text-faint">Nella versione dimostrativa l&apos;accesso è libero: premi <b>Accedi</b>.</span>
            </div>
          )}

          <button type="submit" className="block w-full rounded-lg bg-focus py-2.5 text-center text-sm font-semibold text-white transition hover:opacity-90">
            Accedi
          </button>

          <div className="mt-3 text-center text-xs text-faint">Accesso dimostrativo · l&apos;autenticazione reale arriverà con il backend</div>
        </form>

        {/* Copyright */}
        <div className="mt-6 text-center text-xs text-faint">
          © {new Date().getFullYear()} Xenora · Digital Solution — Tutti i diritti riservati
        </div>
      </div>
    </div>
  );
}
