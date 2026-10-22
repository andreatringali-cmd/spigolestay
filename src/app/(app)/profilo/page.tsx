"use client";

// «Il mio profilo»: per chi ha pochi permessi (es. la signora delle pulizie) e deve solo mettere la propria foto, cambiare la password o uscire.
// Non mostra permessi, strutture o altri utenti: la scheda completa (Utenti) resta per chi amministra.
import { useRef, useState } from "react";
import { PageHeader, Card, SectionTitle, Button } from "@/components/ui";
import { useAccess } from "@/lib/access";
import { useAuth } from "@/lib/authsync";
import { AV_COLORS, initials, loadUsers, saveUsers } from "@/lib/users";
import { downscaleImage } from "@/lib/images";
import { onSolid, solidBg } from "@/lib/on-solid";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/friendly-error";
import { PASSWORD_MIN } from "@/components/PublicUi";

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-base text-txt outline-none focus:border-focus sm:text-sm";

export default function ProfiloPage() {
  const { user } = useAccess();
  const { user: authUser, signOut } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Salva foto/colore sulla scheda di questo utente (stessi dati della scheda in Utenti) e avvisa il resto dell'app.
  const patch = (changes: { photo?: string | undefined; avatarColor?: string }) => {
    if (!user) return;
    const next = loadUsers().map((x) => (x.id === user.id ? { ...x, ...changes } : x));
    saveUsers(next);
    try { window.dispatchEvent(new Event("spigolestay:users")); } catch { /* ambiente senza window */ }
  };
  const onFile = async (f?: File) => {
    if (!f || !f.type.startsWith("image/")) { setMsg({ ok: false, text: "Scegli una fotografia (JPG o PNG)." }); return; }
    try { patch({ photo: await downscaleImage(f, 256, 0.8) }); setMsg({ ok: true, text: "Foto aggiornata ✓" }); } catch { setMsg({ ok: false, text: "Non sono riuscito a caricare la foto. Riprova con un'altra." }); }
  };

  const changePw = async () => {
    setMsg(null);
    if (!supabase || !authUser?.email) { setMsg({ ok: false, text: "Servizio non disponibile: riprova tra poco." }); return; }
    if (!curPw) { setMsg({ ok: false, text: "Scrivi la password attuale." }); return; }
    if (newPw.length < PASSWORD_MIN) { setMsg({ ok: false, text: `La nuova password deve avere almeno ${PASSWORD_MIN} caratteri.` }); return; }
    if (newPw !== newPw2) { setMsg({ ok: false, text: "Le due nuove password non coincidono." }); return; }
    setBusy(true);
    try {
      const { error: e1 } = await supabase.auth.signInWithPassword({ email: authUser.email, password: curPw });
      if (e1) { setMsg({ ok: false, text: "La password attuale non è corretta." }); return; }
      const { error: e2 } = await supabase.auth.updateUser({ password: newPw });
      if (e2) { setMsg({ ok: false, text: friendlyError(e2) }); return; }
      setCurPw(""); setNewPw(""); setNewPw2("");
      setMsg({ ok: true, text: "Password aggiornata ✓" });
    } catch { setMsg({ ok: false, text: "Si è verificato un problema. Riprova." }); }
    finally { setBusy(false); }
  };

  if (!user) return <div className="p-6 text-sm text-dim">Caricamento…</div>;
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.username || authUser?.email || "";
  const color = user.avatarColor ?? AV_COLORS[0];

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Il mio profilo" subtitle="La tua foto e la tua password" hideHelp />
      <Card>
        <SectionTitle>Foto</SectionTitle>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => fileRef.current?.click()} aria-label="Carica una foto" className="shrink-0 rounded-full">
            <div className={`grid h-20 w-20 place-items-center overflow-hidden rounded-full text-2xl font-bold ${onSolid(color)}`} style={{ backgroundColor: solidBg(color) }}>
              {user.photo ? <img src={user.photo} alt="" className="h-full w-full object-cover" /> : initials(user.firstName, user.lastName)}
            </div>
          </button>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-txt">{name}</div>
            {authUser?.email && <div className="truncate text-xs text-dim">{authUser.email}</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="xs" onClick={() => fileRef.current?.click()}>{user.photo ? "Cambia foto" : "Carica foto"}</Button>
              {user.photo && <Button variant="secondary" size="xs" onClick={() => patch({ photo: undefined })}>Rimuovi</Button>}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <div className="mt-4 text-xs font-medium text-dim">Oppure scegli un colore</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {AV_COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Colore ${c}`} aria-pressed={user.avatarColor === c} onClick={() => patch({ avatarColor: c })}
              className="h-7 w-7 rounded-full border-2" style={{ backgroundColor: c, borderColor: user.avatarColor === c ? "var(--txt)" : "transparent" }} />
          ))}
        </div>
      </Card>

      <div className="mt-4" />
      <Card>
        <SectionTitle>Cambia password</SectionTitle>
        <div className="space-y-2">
          <input type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="Password attuale" className={inp} />
          <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={`Nuova password (almeno ${PASSWORD_MIN} caratteri)`} className={inp} />
          <input type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="Ripeti la nuova password" className={inp} />
        </div>
        <div className="mt-3"><Button onClick={changePw} disabled={busy}>{busy ? "Attendi…" : "Aggiorna password"}</Button></div>
      </Card>

      {msg && <div role="status" className="mt-4 rounded-lg px-3 py-2 text-sm font-medium" style={{ backgroundColor: msg.ok ? "color-mix(in srgb, var(--ok) 12%, transparent)" : "color-mix(in srgb, var(--err) 12%, transparent)", color: msg.ok ? "var(--ok)" : "var(--err)" }}>{msg.text}</div>}

      <div className="mt-6"><Button variant="secondary" onClick={() => { void signOut(); }}>Esci</Button></div>
    </div>
  );
}
