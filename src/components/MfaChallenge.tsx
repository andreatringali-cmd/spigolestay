"use client";

// Schermata di verifica 2FA al login: chiede il codice a 6 cifre dell'app di autenticazione.
// Mostrata dal gate quando l'account ha il 2FA attivo ma la sessione è ancora a un fattore.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function MfaChallenge({ onVerified, onSignOut }: { onVerified: () => void; onSignOut: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const factorId = useRef<string>("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (!supabase) { onVerified(); return; }
      try {
        const { data } = await supabase.auth.mfa.listFactors();
        const f = data?.totp?.find((x) => x.status === "verified") || data?.totp?.[0];
        if (f) factorId.current = f.id;
        else { onVerified(); return; } // nessun fattore: non bloccare
      } catch { onVerified(); return; }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!supabase || !factorId.current) { onVerified(); return; }
    if (code.trim().length < 6) { setErr("Inserisci il codice a 6 cifre."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.current, code: code.trim() });
      if (error) { setErr("Codice non valido. Riprova."); return; }
      onVerified();
    } catch { setErr("Si è verificato un problema. Riprova."); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f2f1ee", color: "#1f1b16", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", marginBottom: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: 15, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 24, background: "linear-gradient(135deg,#D97F57,#B04A2C)" }}>X</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Verifica in due passaggi</div>
        </div>
        <form onSubmit={verify} style={{ background: "#fff", border: "1px solid #e3e0e6", borderRadius: 16, padding: 24, boxShadow: "0 20px 60px -15px rgba(40,30,70,0.25)" }}>
          <p style={{ fontSize: 13, color: "#6b6459", margin: "0 0 14px" }}>Apri l&apos;app di autenticazione e inserisci il codice a 6 cifre.</p>
          <input inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456"
            style={{ width: "100%", textAlign: "center", letterSpacing: 6, fontSize: 22, padding: "10px 12px", borderRadius: 10, border: "1px solid #d9d5cf", outline: "none" }} disabled={busy || !ready} />
          {err && <div style={{ marginTop: 12, background: "#fdf1f1", border: "1px solid #f0c2c2", color: "#c0392b", borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>{err}</div>}
          <button type="submit" disabled={busy || !ready} style={{ marginTop: 16, width: "100%", padding: "10px 12px", borderRadius: 10, border: "none", background: "#2f6bb0", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "Verifico…" : "Verifica ed entra"}</button>
        </form>
        <button onClick={onSignOut} style={{ marginTop: 16, width: "100%", background: "none", border: "none", color: "#6b6459", fontSize: 13, cursor: "pointer" }}>Esci</button>
      </div>
    </div>
  );
}
