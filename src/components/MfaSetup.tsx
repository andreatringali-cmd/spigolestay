"use client";

// Configurazione 2FA (TOTP) per l'account collegato: mostra il QR da scansionare con l'app
// di autenticazione (Google Authenticator/Authy) e conferma con un codice a 6 cifre.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Status = "loading" | "off" | "enrolling" | "on";

function qrSrc(qr: string): string {
  if (!qr) return "";
  if (qr.startsWith("data:") || qr.startsWith("http")) return qr;
  if (qr.trim().startsWith("<svg")) return "data:image/svg+xml;utf8," + encodeURIComponent(qr);
  return qr;
}

export default function MfaSetup() {
  const [status, setStatus] = useState<Status>("loading");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = async () => {
    if (!supabase) { setStatus("off"); return; }
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      setStatus(data?.totp?.some((f) => f.status === "verified") ? "on" : "off");
    } catch { setStatus("off"); }
  };
  useEffect(() => { refresh(); }, []);

  const start = async () => {
    if (!supabase) return;
    setBusy(true); setMsg(null);
    try {
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) if (f.status === "unverified") { try { await supabase.auth.mfa.unenroll({ factorId: f.id }); } catch {} }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) { setMsg({ ok: false, text: "Impossibile avviare la configurazione. Riprova." }); return; }
      setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret); setCode(""); setStatus("enrolling");
    } catch { setMsg({ ok: false, text: "Errore di rete. Riprova." }); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!supabase || !factorId) return;
    if (code.trim().length < 6) { setMsg({ ok: false, text: "Inserisci il codice a 6 cifre." }); return; }
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (error) { setMsg({ ok: false, text: "Codice non valido. Riprova." }); return; }
      setQr(""); setSecret(""); setCode(""); setStatus("on"); setMsg({ ok: true, text: "2FA attivata ✅" });
    } catch { setMsg({ ok: false, text: "Errore. Riprova." }); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    if (!supabase) return;
    setBusy(true); setMsg(null);
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      for (const f of data?.totp ?? []) { try { await supabase.auth.mfa.unenroll({ factorId: f.id }); } catch {} }
      setStatus("off"); setMsg({ ok: true, text: "2FA disattivata." });
    } catch { setMsg({ ok: false, text: "Errore. Riprova." }); }
    finally { setBusy(false); }
  };

  const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between py-1.5">
        <span className="text-sm text-txt">Autenticazione a 2 fattori (app)</span>
        {status === "on" ? (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>Attiva ✓</span>
        ) : status === "loading" ? (
          <span className="text-[11px] text-faint">…</span>
        ) : (
          <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-dim">Non attiva</span>
        )}
      </div>

      {status === "off" && (
        <button onClick={start} disabled={busy} className="mt-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-txt hover:bg-wash disabled:opacity-50">🔒 {busy ? "Attendi…" : "Configura con app"}</button>
      )}

      {status === "on" && (
        <button onClick={disable} disabled={busy} className="mt-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-[color:var(--err)] hover:bg-wash disabled:opacity-50">Rimuovi 2FA</button>
      )}

      {status === "enrolling" && (
        <div className="mt-2 rounded-lg border border-line bg-paper p-3">
          <p className="text-xs text-dim">1. Scansiona questo QR con Google Authenticator o Authy.</p>
          {qr && <img src={qrSrc(qr)} alt="QR 2FA" width={168} height={168} className="mx-auto my-2 rounded bg-white p-1" />}
          {secret && <p className="mb-2 text-center text-[11px] text-faint">oppure inserisci il codice: <span className="font-mono text-dim">{secret}</span></p>}
          <p className="mb-1 text-xs text-dim">2. Inserisci il codice a 6 cifre che vedi nell&apos;app:</p>
          <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className={`${inp} text-center tracking-widest`} />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={confirm} disabled={busy} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? "Verifico…" : "Attiva"}</button>
            <button onClick={() => { setStatus("off"); setQr(""); setSecret(""); setCode(""); }} className="text-xs font-medium text-dim hover:underline">Annulla</button>
          </div>
        </div>
      )}

      {msg && <div className="mt-2 rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: msg.ok ? "color-mix(in srgb, var(--ok) 12%, transparent)" : "color-mix(in srgb, var(--err) 12%, transparent)", color: msg.ok ? "var(--ok)" : "var(--err)" }}>{msg.text}</div>}
      <p className="mt-2 text-[11px] text-faint">Con l&apos;app di autenticazione (gratuita): a ogni accesso, dopo la password, ti verrà chiesto un codice a 6 cifre.</p>
    </div>
  );
}
