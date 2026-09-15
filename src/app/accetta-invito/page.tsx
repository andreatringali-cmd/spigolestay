"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type State = "loading" | "need-login" | "accepting" | "ok" | "mismatch" | "error";

export default function AccettaInvito() {
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState("");
  const [structure, setStructure] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [nextUrl, setNextUrl] = useState("/login");

  useEffect(() => {
    (async () => {
      try {
        const code = new URLSearchParams(window.location.search).get("code") || "";
        if (!code) { setState("error"); setMsg("Link non valido."); return; }
        if (!supabase) { setState("error"); setMsg("Servizio non disponibile."); return; }
        const { data: sess } = await supabase.auth.getSession();
        const token = sess?.session?.access_token;
        try { localStorage.setItem("xn-pending-invite", code); } catch {}
        setNextUrl(`/login?next=${encodeURIComponent(`/accetta-invito?code=${code}`)}`);
        if (!token) { setState("need-login"); return; }
        setState("accepting");
        const r = await fetch("/api/org/accept", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code }),
        });
        const j = await r.json().catch(() => ({}));
        try { localStorage.removeItem("xn-pending-invite"); } catch {} // esito ricevuto: niente più rimandi automatici
        if (r.ok && j?.ok) { setStructure(j.structureName || ""); setState("ok"); return; }
        if (j?.error === "email_mismatch") { setInvitedEmail(j.invitedEmail || ""); setState("mismatch"); return; }
        setState("error");
        setMsg(j?.error === "invite_not_found" ? "Invito non trovato o già annullato." : j?.error === "invite_revoked" ? "Invito annullato." : (j?.message || "Impossibile accettare l'invito."));
      } catch { setState("error"); setMsg("Errore di rete."); }
    })();
  }, []);

  const card = "w-full max-w-md rounded-2xl border p-6 shadow-sm";
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f5f7", padding: 16 }}>
      <div className={card} style={{ background: "#fff", borderColor: "#e6e8ec" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/xenora-mark.png" alt="" width={26} height={26} style={{ objectFit: "contain" }} />
          <span style={{ fontWeight: 700, color: "#1f2430" }}>Xenora · Invito</span>
        </div>

        {state === "loading" || state === "accepting" ? (
          <p style={{ color: "#6b7280", fontSize: 14, padding: "24px 0", textAlign: "center" }}>Verifica dell'invito…</p>
        ) : state === "need-login" ? (
          <>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1f2430", margin: "0 0 8px" }}>Accedi per accettare</h1>
            <p style={{ fontSize: 14, color: "#4b5563", margin: "0 0 16px" }}>Per accettare l'invito, accedi (o registrati) con <b>l'email a cui hai ricevuto questo invito</b>. Dopo l'accesso tornerai qui e l'invito verrà accettato in automatico.</p>
            <a href={nextUrl} style={{ display: "block", textAlign: "center", background: "#285f92", color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 15, padding: 14, borderRadius: 10 }}>Vai all'accesso →</a>
          </>
        ) : state === "ok" ? (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ margin: "0 auto 12px", width: 56, height: 56, borderRadius: "50%", display: "grid", placeItems: "center", background: "#0E9F6E", color: "#fff", fontSize: 26 }}>✓</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1f2430", margin: 0 }}>Invito accettato</h1>
            <p style={{ fontSize: 14, color: "#4b5563", margin: "6px 0 18px" }}>Ora gestisci{structure ? <> <b>{structure}</b></> : " la struttura"} insieme al tuo socio. La trovi nel gestionale (potrebbe comparire dopo pochi secondi).</p>
            <a href="/" style={{ display: "block", textAlign: "center", background: "#285f92", color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 15, padding: 14, borderRadius: 10 }}>Vai al gestionale →</a>
          </div>
        ) : state === "mismatch" ? (
          <>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1f2430", margin: "0 0 8px" }}>Email diversa</h1>
            <p style={{ fontSize: 14, color: "#4b5563", margin: "0 0 16px" }}>Questo invito è per <b>{invitedEmail}</b>, ma hai effettuato l'accesso con un'altra email. Esci e accedi con l'email invitata, poi riapri il link.</p>
            <a href={nextUrl} style={{ display: "block", textAlign: "center", background: "#285f92", color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 15, padding: 14, borderRadius: 10 }}>Cambia account →</a>
          </>
        ) : (
          <p style={{ color: "#b91c1c", fontSize: 14, padding: "16px 0", textAlign: "center" }}>{msg || "Errore."}</p>
        )}
      </div>
    </div>
  );
}
