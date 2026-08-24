"use client";

import Link from "next/link";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("spigolehouse@gmail.com");
  const [pwd, setPwd] = useState("");

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-paper px-4 text-txt">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#D97F57] to-[#B04A2C] font-display text-2xl font-black text-white shadow-lg">S</div>
          <div>
            <div className="font-display text-2xl font-extrabold tracking-tight">SpigoleStay</div>
            <div className="text-sm text-dim">Channel Manager · PMS</div>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-dim">Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-txt outline-none focus:border-focus" />
          </label>
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium text-dim">Password</span>
            <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" className="w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-txt outline-none focus:border-focus" />
          </label>
          <Link href="/" className="block w-full rounded-lg bg-focus py-2.5 text-center text-sm font-semibold text-white hover:opacity-90">
            Entra
          </Link>
          <div className="mt-3 text-center text-xs text-faint">Accesso dimostrativo · l'autenticazione reale (Supabase Auth) arriverà con il backend</div>
        </div>
      </div>
    </div>
  );
}
