"use client";

import { useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import {
  PERMISSIONS, PERM_GROUPS, PERM_TEMPLATES, USER_LANGS, AV_COLORS, initials,
  loadUsers, saveUsers, blankUser, defaultNotify,
  NOTIFY_EVENTS, NOTIFY_CHANNELS, WORK_DAYS, PAY_TYPES,
  type User, type PermLevel,
} from "@/lib/users";
import { eur } from "@/lib/format";
import { downscaleImage } from "@/lib/images";
import { useLang } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import MfaSetup from "@/components/MfaSetup";

// --- Micro-componenti ---------------------------------------------------------
function Toggle({ on, onClick, disabled, color = "var(--focus)" }: { on: boolean; onClick?: () => void; disabled?: boolean; color?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={on}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
      style={{ backgroundColor: on ? color : "var(--line)" }}>
      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} />
    </button>
  );
}
function Info({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  const c = tone === "warn" ? "var(--warn)" : "var(--focus)";
  return (
    <div className="mt-1 flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] leading-snug" style={{ backgroundColor: `color-mix(in srgb, ${c} 9%, transparent)`, color: "var(--dim)" }}>
      <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: c }}>i</span>
      <span>{children}</span>
    </div>
  );
}
const IcoBan = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6 18.4 18.4" /></svg>;
const IcoEye = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
const IcoPen = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></svg>;
const LEVEL_META: Record<PermLevel, { label: string; icon: React.ReactNode; color: string }> = {
  none: { label: "Nessuno", icon: IcoBan, color: "#D64545" },
  view: { label: "Visualizza", icon: IcoEye, color: "#2563EB" },
  edit: { label: "Modifica", icon: IcoPen, color: "#0E9F6E" },
};

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

export default function UserSchedaPage() {
  const router = useRouter();
  const { t } = useLang();
  const params = useParams<{ id: string }>();
  const isNew = params.id === "nuovo";
  const { structures } = useData();
  const ask = useConfirm();

  const [u, setU] = useState<User>(() => {
    if (isNew) return blankUser();
    const found = loadUsers().find((x) => x.id === params.id);
    return found ?? blankUser();
  });
  const set = <K extends keyof User>(k: K, v: User[K]) => setU((p) => ({ ...p, [k]: v }));

  // Cambio password reale (account collegato via Supabase): attuale + nuova ×2.
  const { user: authUser } = useAuth();
  // È l'account attualmente loggato? La password (con quella attuale) si può cambiare solo per sé;
  // per gli altri utenti si può solo inviare un'email di reset.
  const isSelf = !!authUser?.email && !!u.email && authUser.email.trim().toLowerCase() === u.email.trim().toLowerCase();
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const resetPwFields = () => { setCurPw(""); setNewPw(""); setNewPw2(""); setPwMsg(null); };
  const changePw = async () => {
    setPwMsg(null);
    if (newPw.length < 6) { setPwMsg({ ok: false, text: t("La nuova password deve avere almeno 6 caratteri.") }); return; }
    if (newPw !== newPw2) { setPwMsg({ ok: false, text: t("Le due nuove password non coincidono.") }); return; }
    if (!isSelf) { setPwMsg({ ok: false, text: t("Puoi cambiare direttamente solo la password del TUO account. Per gli altri usa «Invia email di reset».") }); return; }
    if (!supabase || !authUser?.email) { setPwMsg({ ok: false, text: t("Accesso non disponibile.") }); return; }
    setPwBusy(true);
    try {
      const { error: e1 } = await supabase.auth.signInWithPassword({ email: authUser.email, password: curPw });
      if (e1) { setPwMsg({ ok: false, text: t("Password attuale errata.") }); return; }
      const { error: e2 } = await supabase.auth.updateUser({ password: newPw });
      if (e2) { setPwMsg({ ok: false, text: e2.message }); return; }
      resetPwFields(); setPwOpen(false); setPwMsg({ ok: true, text: t("Password aggiornata ✅") });
    } catch { setPwMsg({ ok: false, text: t("Si è verificato un problema. Riprova.") }); }
    finally { setPwBusy(false); }
  };
  const forgotPw = async () => {
    const target = (u.email || authUser?.email || "").trim();
    if (!supabase || !target) { setPwMsg({ ok: false, text: t("Serve un'email valida sull'utente.") }); return; }
    setPwBusy(true); setPwMsg(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(target, { redirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined });
      setPwMsg(error ? { ok: false, text: error.message } : { ok: true, text: `${t("Email di reset inviata a")} ${target}.` });
    } finally { setPwBusy(false); }
  };

  // Avatar / foto profilo (salvata sull'utente)
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (f?: File) => { if (!f || !f.type.startsWith("image/")) return; try { set("photo", await downscaleImage(f, 256, 0.8)); } catch {} };

  // Strutture (dual-list)
  const [q1, setQ1] = useState(""); const [q2, setQ2] = useState("");
  const [pickA, setPickA] = useState<Set<string>>(new Set());
  const [pickS, setPickS] = useState<Set<string>>(new Set());
  const selected = structures.filter((s) => u.structureIds.includes(s.id));
  const available = structures.filter((s) => !u.structureIds.includes(s.id));
  const fA = available.filter((s) => s.name.toLowerCase().includes(q1.toLowerCase()));
  const fS = selected.filter((s) => s.name.toLowerCase().includes(q2.toLowerCase()));
  const moveRight = () => { set("structureIds", [...u.structureIds, ...[...pickA]]); setPickA(new Set()); };
  const moveAllRight = () => { set("structureIds", structures.map((s) => s.id)); setPickA(new Set()); };
  const moveLeft = () => { set("structureIds", u.structureIds.filter((id) => !pickS.has(id))); setPickS(new Set()); };
  const moveAllLeft = () => { set("structureIds", []); setPickS(new Set()); };
  const togglePick = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => set((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Permessi
  const setPerm = (key: string, level: PermLevel) => setU((p) => ({ ...p, perms: { ...p.perms, [key]: level }, templateKey: "custom" }));
  const applyTemplate = (tkey: string) => { const t = PERM_TEMPLATES.find((x) => x.key === tkey); if (!t) return; setU((p) => ({ ...p, perms: t.perms(), templateKey: tkey })); };
  const setAllGroup = (group: string, level: PermLevel) => setU((p) => { const perms = { ...p.perms }; for (const perm of PERMISSIONS.filter((x) => x.group === group)) perms[perm.key] = perm.levels.includes(level) ? level : perm.levels[perm.levels.length - 1]; return { ...p, perms, templateKey: "custom" }; });
  const templateLabel = u.templateKey === "custom" ? t("Personalizzato") : t(PERM_TEMPLATES.find((x) => x.key === u.templateKey)?.label ?? "Nessuno");
  const stats = useMemo(() => {
    const vals = Object.values(u.perms);
    return { edit: vals.filter((v) => v === "edit").length, view: vals.filter((v) => v === "view").length, none: vals.filter((v) => v === "none").length };
  }, [u.perms]);

  // Validazione
  const errs: string[] = [];
  if (!u.firstName.trim()) errs.push(t("Nome"));
  if (!u.lastName.trim()) errs.push(t("Cognome"));
  if (!u.email.trim() || !/.+@.+\..+/.test(u.email)) errs.push(t("Email valida"));
  if (!u.phone.trim()) errs.push(t("Cellulare"));
  if (!u.username.trim()) errs.push(t("Username"));
  const valid = errs.length === 0;

  const save = () => {
    if (!valid) return;
    const list = loadUsers();
    const clean: User = { ...u, avatarColor: u.avatarColor ?? AV_COLORS[0] };
    const next = isNew || !list.some((x) => x.id === u.id) ? [...list, { ...clean, status: clean.status }] : list.map((x) => (x.id === u.id ? clean : x));
    saveUsers(next);
    router.push("/utenti");
  };
  const isAdmin = u.templateKey === "owner" || u.id === "u-owner"; // l'amministratore non è eliminabile
  const userCount = loadUsers().length;
  const canDelete = !isNew && !isAdmin && userCount > 1;
  const remove = async () => {
    if (isAdmin) { await ask({ title: t("Non eliminabile"), message: t("L'amministratore non può essere eliminato."), confirmLabel: t("Ho capito") }); return; }
    if (loadUsers().length <= 1) { await ask({ title: t("Non eliminabile"), message: t("Deve restare almeno un utente."), confirmLabel: t("Ho capito") }); return; }
    if (!(await ask({ title: t("Elimina utente"), message: `${t("Eliminare definitivamente")} ${u.firstName} ${u.lastName}?`, danger: true, confirmLabel: t("Elimina") }))) return;
    saveUsers(loadUsers().filter((x) => x.id !== u.id)); router.push("/utenti");
  };

  const fullName = `${u.firstName} ${u.lastName}`.trim() || t("Nuovo utente");
  const avatar = (size: number) => (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white" style={{ width: size, height: size, backgroundColor: u.avatarColor, fontSize: size * 0.36 }}>
      {u.photo ? <img src={u.photo} alt="" className="h-full w-full object-cover" /> : initials(u.firstName, u.lastName)}
    </div>
  );

  return (
    <div>
      <PageHeader
        title={isNew ? t("Nuovo utente") : t("Scheda utente")}
        subtitle={isNew ? t("Crea un nuovo accesso al gestionale") : `${fullName} · ${u.email}`}
        actions={
          <div className="flex items-center gap-2">
            {canDelete && <button onClick={remove} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button>}
            <button onClick={() => router.push("/utenti")} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash">{t("Annulla")}</button>
            <button onClick={save} disabled={!valid} title={valid ? "" : `${t("Mancano:")} ${errs.join(", ")}`} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{isNew ? t("Crea utente") : t("Salva")}</button>
          </div>
        }
      />

      {!valid && <div className="mb-4 rounded-lg border border-[color:var(--warn)] bg-[color:color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-xs text-dim">{t("Per salvare completa:")} <b className="text-txt">{errs.join(", ")}</b>.</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------------- Colonna sinistra ---------------- */}
        <div className="flex flex-col gap-4">
          {/* Account */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle>{t("Account")}</SectionTitle>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-txt">{t("Utente attivo")}</span>
              <Toggle on={u.active} onClick={() => set("active", !u.active)} color="var(--ok)" />
            </div>
            <label className="mt-2 block text-xs font-medium text-dim">{t("Username")} *
              <input value={u.username} onChange={(e) => set("username", e.target.value)} className={`${inp} mt-1`} placeholder={t("es. mario.rossi")} />
            </label>
            <div className="mt-3">
              <div className="text-xs font-medium text-dim">{t("Password")}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <button onClick={() => { setPwOpen((o) => !o); resetPwFields(); }} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-txt hover:bg-wash">🔑 {t("Cambia password")}</button>
              </div>
              {pwOpen && (isSelf ? (
                <div className="mt-2 space-y-2">
                  <input type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder={t("Password attuale")} className={inp} />
                  <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={t("Nuova password (min. 6)")} className={inp} />
                  <input type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder={t("Ripeti nuova password")} className={inp} />
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={changePw} disabled={pwBusy} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{pwBusy ? t("Attendi…") : t("Aggiorna password")}</button>
                    <button type="button" onClick={forgotPw} disabled={pwBusy} className="text-xs font-medium text-focus hover:underline">{t("Password dimenticata?")}</button>
                  </div>
                  <p className="text-[11px] text-faint">{t("Se non ricordi quella attuale, usa «Password dimenticata»: ti arriva un link via email per reimpostarla.")}</p>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-[12px] text-dim">{t("Per motivi di sicurezza non puoi impostare tu la password di un altro utente. Invia un'email di reset: l'utente sceglierà la sua nuova password.")}</p>
                  <button onClick={forgotPw} disabled={pwBusy} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{pwBusy ? t("Attendi…") : `✉ ${t("Invia email di reset")}`}</button>
                </div>
              ))}
              {pwMsg && <div className="mt-2 rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: pwMsg.ok ? "color-mix(in srgb, var(--ok) 12%, transparent)" : "color-mix(in srgb, var(--err) 12%, transparent)", color: pwMsg.ok ? "var(--ok)" : "var(--err)" }}>{pwMsg.text}</div>}
            </div>
            <MfaSetup />
          </Card>

          {/* Informazioni generali */}
          <Card>
            <SectionTitle>{t("Informazioni generali")}</SectionTitle>
            <div className="mb-3 flex items-center gap-3">
              <button type="button" onClick={() => fileRef.current?.click()} title={t("Carica foto")} className="group relative shrink-0 rounded-full">
                {avatar(56)}
                <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-base text-white opacity-0 transition group-hover:opacity-100">📷</span>
              </button>
              <div>
                {u.photo && <button onClick={() => set("photo", undefined)} className="text-xs font-medium text-faint hover:text-[color:var(--err)]">{t("Rimuovi foto")}</button>}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                <div className="mt-0.5 text-[11px] text-faint">{t("Clicca il tondino per caricare la foto. In alternativa scegli un colore:")}</div>
                <div className="mt-1 flex gap-1.5">{AV_COLORS.map((c) => <button key={c} onClick={() => set("avatarColor", c)} className={`h-5 w-5 rounded-full border-2 ${u.avatarColor === c ? "border-txt" : "border-transparent"}`} style={{ backgroundColor: c }} />)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Nome")} *<input value={u.firstName} onChange={(e) => set("firstName", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Cognome")} *<input value={u.lastName} onChange={(e) => set("lastName", e.target.value)} className={`${inp} mt-1`} /></label>
            </div>
            <label className="mt-3 block text-xs font-medium text-dim">{t("Email")} *
              <input value={u.email} onChange={(e) => set("email", e.target.value)} className={`${inp} mt-1`} placeholder={t("nome@dominio.it")} />
            </label>
            <Info>{t("Inseriscila con cura: la usiamo per comunicazioni importanti e per confermare l'identità in fase di accesso.")}</Info>
            <label className="mt-3 block text-xs font-medium text-dim">{t("Cellulare")} * <span className="text-faint">({t("obbligatorio")})</span>
              <input value={u.phone} onChange={(e) => set("phone", e.target.value)} className={`${inp} mt-1`} placeholder="+39 3xx xxx xxxx" />
            </label>
            <Info>{t("Serve per il secondo fattore di autenticazione e per i contatti urgenti.")}</Info>
            <label className="mt-3 block text-xs font-medium text-dim">{t("Lingua")}
              <select value={u.language} onChange={(e) => set("language", e.target.value)} className={`${inp} mt-1`}>
                {USER_LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
              </select>
            </label>
          </Card>

          {/* Sicurezza & accessi */}
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle>{t("Sicurezza & accessi")}</SectionTitle>
              {(u.sessions ?? []).length > 0 && <button onClick={() => set("sessions", (u.sessions ?? []).filter((s) => s.current))} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-[color:var(--err)] hover:bg-wash">{t("Disconnetti tutti")}</button>}
            </div>
            <div className="mb-3 text-xs text-dim">{t("Ultimo accesso:")} {u.lastLogin ? <>{new Date(u.lastLogin.at).toLocaleString("it-IT")} {t("da")} <span className="font-mono">{u.lastLogin.ip}</span></> : <span className="text-faint">{t("mai")}</span>}</div>
            {(u.sessions ?? []).length === 0 ? (
              <div className="text-sm text-faint">{t("Nessuna sessione attiva.")}</div>
            ) : (
              <div className="flex flex-col divide-y divide-[color:var(--line)]">
                {(u.sessions ?? []).map((s) => (
                  <div key={s.id} className="flex items-center gap-2 py-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-wash text-dim"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M11 18h2" /></svg></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm text-txt">{s.device}{s.current && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>{t("questa sessione")}</span>}</div>
                      <div className="text-[11px] text-faint"><span className="font-mono">{s.ip}</span> · {new Date(s.lastActive).toLocaleString("it-IT")}</div>
                    </div>
                    {!s.current && <button onClick={() => set("sessions", (u.sessions ?? []).filter((x) => x.id !== s.id))} className="shrink-0 rounded p-1 text-faint hover:bg-wash hover:text-[color:var(--err)]" title={t("Termina sessione")}>✕</button>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Turni & disponibilità */}
          <Card>
            <SectionTitle>{t("Turni & disponibilità")}</SectionTitle>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-dim">{t("Giorni lavorativi")}</span>
              {(() => { const all = WORK_DAYS.every((d) => (u.workDays ?? []).includes(d)); return (
                <button onClick={() => set("workDays", all ? [] : [...WORK_DAYS])} className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-focus hover:bg-wash">{all ? t("Deseleziona tutti") : t("Seleziona tutti")}</button>
              ); })()}
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {WORK_DAYS.map((d) => { const on = (u.workDays ?? []).includes(d); return (
                <button key={d} onClick={() => set("workDays", on ? (u.workDays ?? []).filter((x) => x !== d) : [...(u.workDays ?? []), d])} className={`h-9 w-11 rounded-lg border text-xs font-semibold transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(d)}</button>
              ); })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Dalle")}<input type="time" value={u.workFrom ?? ""} onChange={(e) => set("workFrom", e.target.value)} className={`${inp} mt-1`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Alle")}<input type="time" value={u.workTo ?? ""} onChange={(e) => set("workTo", e.target.value)} className={`${inp} mt-1`} /></label>
            </div>
          </Card>

          {/* Compenso */}
          <Card>
            <SectionTitle>{t("Compenso")} <span className="font-normal normal-case text-faint">· {t("collegato alla Cassa")}</span></SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Tipo compenso")}
                <select value={u.payType ?? "none"} onChange={(e) => set("payType", e.target.value as User["payType"])} className={`${inp} mt-1`}>{PAY_TYPES.map((p) => <option key={p.key} value={p.key}>{t(p.label)}</option>)}</select>
              </label>
              {u.payType && u.payType !== "none" && (
                <label className="block text-xs font-medium text-dim">{t("Importo")} €{u.payType === "hourly" ? t("/ora") : u.payType === "monthly" ? t("/mese") : t("/intervento")}
                  <input inputMode="decimal" value={u.payAmount ?? ""} onChange={(e) => set("payAmount", e.target.value === "" ? undefined : Number(e.target.value))} className={`${inp} mt-1`} placeholder="0" />
                </label>
              )}
            </div>
            {u.payType === "monthly" && (
              <button onClick={() => set("payToCassa", !u.payToCassa)} className="mt-3 flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left hover:bg-wash">
                <span className="text-sm text-txt">{t("Registra come uscita ricorrente in Cassa")} <span className="block text-[11px] text-faint">{t("Voce «Personale», ogni mese")}</span></span>
                <Toggle on={!!u.payToCassa} onClick={() => set("payToCassa", !u.payToCassa)} color="var(--ok)" />
              </button>
            )}
            {u.payType && u.payType !== "none" && u.payAmount ? <div className="mt-2 text-[11px] text-faint">{t("Costo indicativo:")} <b className="text-dim">{u.payType === "monthly" ? `${eur(u.payAmount)}${t("/mese")}` : u.payType === "hourly" ? `${eur(u.payAmount)}${t("/ora")}` : `${eur(u.payAmount)}${t("/intervento")}`}</b>.</div> : null}
          </Card>

          {/* Network / strutture */}
          <Card>
            <SectionTitle>{t("Network · Strutture")}</SectionTitle>
            <div className="flex flex-col gap-1">
              {([["managerCheckin", "Gestore check-in"], ["managerCheckout", "Gestore check-out"], ["managerHousekeeping", "Gestore housekeeping"]] as [keyof User, string][]).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-txt">{t(label)}</span>
                  <Toggle on={u[k] as boolean} onClick={() => set(k, !(u[k] as boolean) as never)} />
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between border-t border-line py-2">
                <span className="text-sm font-medium text-txt">{t("Accesso a tutte le strutture")}</span>
                <Toggle on={u.allStructures} onClick={() => set("allStructures", !u.allStructures)} />
              </div>
            </div>
            {u.allStructures ? (
              <p className="mt-2 rounded-lg bg-wash px-3 py-2 text-xs text-dim">{t("Questo utente accede a")} <b className="text-txt">{t("tutte le strutture")}</b> {t("del network, incluse quelle aggiunte in futuro.")}</p>
            ) : (
              <>
                <p className="mt-2 mb-2 text-xs text-dim">{t("Consenti l'accesso solo alle strutture selezionate.")}</p>
                <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
                  {/* Disponibili */}
                  <div className="rounded-lg border border-line">
                    <div className="border-b border-line px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Disponibili")} ({available.length})</div>
                    <input value={q1} onChange={(e) => setQ1(e.target.value)} placeholder={t("Cerca…")} className="w-full border-b border-line bg-paper px-2 py-1.5 text-xs outline-none" />
                    <div className="max-h-44 overflow-y-auto p-1">
                      {fA.length === 0 ? <div className="px-2 py-3 text-center text-[11px] text-faint">—</div> : fA.map((s) => (
                        <button key={s.id} onClick={() => togglePick(setPickA, s.id)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${pickA.has(s.id) ? "bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] text-focus" : "text-txt hover:bg-wash"}`}>
                          <span className="truncate">{s.name}</span><span className="ml-2 font-mono text-[10px] text-faint">{s.cin ?? ""}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Frecce */}
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <button onClick={moveRight} disabled={pickA.size === 0} className="grid h-8 w-8 place-items-center rounded-md border border-line text-dim hover:bg-wash disabled:opacity-30" title={t("Sposta selezionate")}>›</button>
                    <button onClick={moveAllRight} disabled={available.length === 0} className="grid h-8 w-8 place-items-center rounded-md border border-line text-dim hover:bg-wash disabled:opacity-30" title={t("Sposta tutte")}>»</button>
                    <button onClick={moveLeft} disabled={pickS.size === 0} className="grid h-8 w-8 place-items-center rounded-md border border-line text-dim hover:bg-wash disabled:opacity-30" title={t("Rimuovi selezionate")}>‹</button>
                    <button onClick={moveAllLeft} disabled={selected.length === 0} className="grid h-8 w-8 place-items-center rounded-md border border-line text-dim hover:bg-wash disabled:opacity-30" title={t("Rimuovi tutte")}>«</button>
                  </div>
                  {/* Selezionate */}
                  <div className="rounded-lg border border-line">
                    <div className="border-b border-line px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Selezionate")} ({selected.length})</div>
                    <input value={q2} onChange={(e) => setQ2(e.target.value)} placeholder={t("Cerca…")} className="w-full border-b border-line bg-paper px-2 py-1.5 text-xs outline-none" />
                    <div className="max-h-44 overflow-y-auto p-1">
                      {fS.length === 0 ? <div className="px-2 py-3 text-center text-[11px] text-faint">{t("Nessuna struttura")}</div> : fS.map((s) => (
                        <button key={s.id} onClick={() => togglePick(setPickS, s.id)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${pickS.has(s.id) ? "bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] text-focus" : "text-txt hover:bg-wash"}`}>
                          <span className="truncate">{s.name}</span><span className="ml-2 font-mono text-[10px] text-faint">{s.cin ?? ""}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* ---------------- Colonna destra: permessi ---------------- */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>{t("Permessi")}</SectionTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-dim">{t("Modello:")}</span>
                <select value={u.templateKey === "custom" ? "custom" : u.templateKey} onChange={(e) => applyTemplate(e.target.value)} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs font-medium text-txt outline-none focus:border-focus">
                  {u.templateKey === "custom" && <option value="custom">{t("Personalizzato")}</option>}
                  {PERM_TEMPLATES.map((tpl) => <option key={tpl.key} value={tpl.key}>{t(tpl.label)}</option>)}
                </select>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-wash px-3 py-2 text-xs">
              <span className="font-semibold text-txt">{templateLabel}</span>
              <span className="text-faint">·</span>
              <span className="flex items-center gap-1" style={{ color: "#0E9F6E" }}>{stats.edit} {t("in modifica")}</span>
              <span className="flex items-center gap-1" style={{ color: "#2563EB" }}>{stats.view} {t("in lettura")}</span>
              <span className="text-faint">{stats.none} {t("nessuno")}</span>
            </div>

            <div className="flex flex-col gap-4">
              {PERM_GROUPS.map((group) => (
                <div key={group}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t(group)}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">{t("tutta la categoria")}</span>
                      <div className="flex shrink-0 overflow-hidden rounded-lg border border-dashed border-line">
                        {(["none", "view", "edit"] as PermLevel[]).map((lv) => {
                          const m = LEVEL_META[lv];
                          return (
                            <button key={lv} onClick={() => setAllGroup(group, lv)} title={`${t("Imposta tutta la categoria")}: ${t(m.label)}`}
                              className="grid h-7 w-8 place-items-center border-l border-dashed border-line first:border-l-0 transition hover:bg-wash"
                              style={{ color: m.color }}>
                              {m.icon}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col divide-y divide-[color:var(--line)]">
                    {PERMISSIONS.filter((p) => p.group === group).map((perm) => {
                      const cur = u.perms[perm.key] ?? "none";
                      return (
                        <div key={perm.key} className="flex items-center gap-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm text-txt" title={t(perm.label)}>{t(perm.label)}</span>
                          {perm.help && <span title={t(perm.help)} className="grid h-4 w-4 shrink-0 cursor-help place-items-center rounded-full border border-line text-[9px] text-faint">?</span>}
                          <div className="flex shrink-0 overflow-hidden rounded-lg border border-line">
                            {(["none", "view", "edit"] as PermLevel[]).map((lv) => {
                              const allowed = perm.levels.includes(lv);
                              const active = cur === lv;
                              const m = LEVEL_META[lv];
                              return (
                                <button key={lv} disabled={!allowed} onClick={() => setPerm(perm.key, lv)} title={allowed ? t(m.label) : t("Non disponibile")}
                                  className={`grid h-7 w-8 place-items-center border-l border-line first:border-l-0 transition ${!allowed ? "cursor-not-allowed opacity-25" : active ? "text-white" : "text-faint hover:bg-wash"}`}
                                  style={active && allowed ? { backgroundColor: m.color } : undefined}>
                                  {m.icon}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>


          {/* Notifiche */}
          <Card>
            <SectionTitle>{t("Notifiche")}</SectionTitle>
            <p className="mb-3 text-xs text-dim">{t("Scegli su quali canali avvisare questo utente per ciascun evento.")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-faint">
                    <th className="py-1.5 text-left font-semibold">{t("Evento")}</th>
                    {NOTIFY_CHANNELS.map((c) => <th key={c.key} className="px-1 py-1.5 text-center font-semibold">{t(c.label)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {NOTIFY_EVENTS.map((ev) => (
                    <tr key={ev.key} className="border-t border-line">
                      <td className="py-1.5 pr-2 text-txt">{t(ev.label)}</td>
                      {NOTIFY_CHANNELS.map((c) => {
                        const key = `${ev.key}.${c.key}`;
                        const on = (u.notify ?? defaultNotify())[key];
                        return (
                          <td key={c.key} className="px-1 py-1.5 text-center">
                            <button onClick={() => set("notify", { ...(u.notify ?? defaultNotify()), [key]: !on })} title={on ? t("Attivo") : t("Disattivo")}
                              className="mx-auto grid h-6 w-6 place-items-center rounded-full transition"
                              style={on ? { backgroundColor: "var(--ok)", color: "#fff" } : { backgroundColor: "var(--wash)", color: "var(--faint)" }}>
                              {on ? "✓" : ""}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
