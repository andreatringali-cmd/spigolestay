"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BrandLockup, Notice, PUB } from "@/components/PublicUi";
import PublicTheme from "@/components/PublicTheme";

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

  // Stessa scheda, stessi pulsanti e stessi avvisi di login e onboarding (componenti e token in PublicUi).
  return (
    <div className={`${PUB.page} flex items-center justify-center px-4 py-10`}>
      <PublicTheme />
      <main className={`${PUB.card} max-w-md`} style={{ overflowWrap: "anywhere" }}>
        <div className="mb-6"><BrandLockup /></div>

        {state === "loading" || state === "accepting" ? (
          <div role="status" aria-busy="true" aria-label="Caricamento in corso" className="grid place-items-center py-7">
            {/* Solo la farfalla che pulsa, niente testo durante il caricamento. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/xenora-mark.png" alt="" width={40} height={40} className="xn-pulse" style={{ width: 40, height: 40, objectFit: "contain" }} />
            <style>{`.xn-pulse{animation:xpulse 1.4s ease-in-out infinite}@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion:reduce){.xn-pulse{animation:none}}`}</style>
          </div>
        ) : state === "need-login" ? (
          <>
            <h1 className={PUB.h1}>Accedi per accettare</h1>
            <p className={`${PUB.lead} mb-6`}>Per accettare l&apos;invito, accedi (o registrati) con <b className="text-txt">l&apos;email a cui hai ricevuto questo invito</b>. Dopo l&apos;accesso tornerai qui e l&apos;invito verrà accettato in automatico.</p>
            <a href={nextUrl} className={`${PUB.btnPrimary} w-full`}>Vai all&apos;accesso</a>
          </>
        ) : state === "ok" ? (
          <div className="text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </div>
            <h1 className={PUB.h1}>Invito accettato</h1>
            <p className={`${PUB.lead} mb-6`}>Ora puoi gestire{structure ? <> <b className="text-txt">{structure}</b></> : " la struttura"} insieme a chi ti ha invitato. La trovi nel gestionale (potrebbe comparire dopo pochi secondi).</p>
            <a href="/" className={`${PUB.btnPrimary} w-full`}>Vai al gestionale</a>
          </div>
        ) : state === "mismatch" ? (
          <>
            <h1 className={PUB.h1}>Email diversa</h1>
            <p className={`${PUB.lead} mb-6`}>Questo invito è per <b className="text-txt">{invitedEmail}</b>, ma hai effettuato l&apos;accesso con un&apos;altra email. Esci e accedi con l&apos;email invitata, poi riapri il link.</p>
            <a href={nextUrl} className={`${PUB.btnPrimary} w-full`}>Cambia account</a>
          </>
        ) : (
          <>
            <h1 className={`${PUB.h1} mb-3`}>Invito non disponibile</h1>
            <Notice kind="err">{msg || "Si è verificato un errore."}</Notice>
            <a href="/" className={`${PUB.btnSecondary} mt-6 w-full`}>Vai al gestionale</a>
          </>
        )}
      </main>
    </div>
  );
}
