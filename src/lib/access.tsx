"use client";

// Contesto di accesso: utente "collegato" + moduli attivi (Abbonamento).
// Permette a menu e pagine di adattarsi a permessi e moduli. In produzione l'utente
// arriverà dall'autenticazione; qui è simulato con uno switch per provare i ruoli.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { loadUsers, saveUsers, type User, type PermLevel } from "./users";
import { TIERS } from "./plans";
import { supabase } from "./supabase";

interface AccessValue {
  user: User | null;
  users: User[];
  setUserId: (id: string) => void;
  modules: Record<string, boolean>;
  can: (perm?: string) => boolean;       // permesso ≠ "none"
  level: (perm?: string) => PermLevel;   // livello del permesso
  moduleOn: (m?: string) => boolean;     // modulo attivo
}

const Ctx = createContext<AccessValue | null>(null);
const CUR_KEY = "spigolestay:currentuser";

export function AccessProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUid] = useState<string>("");
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [planIncludes, setPlanIncludes] = useState<string[]>([]);
  // Ruolo/permessi dell'utente sulle strutture CONDIVISE (per limitare i co-gestori invitati).
  const [share, setShare] = useState<Record<string, { role: string; active: boolean; permissions: Record<string, PermLevel> | null }>>({});
  const [activeOrgId, setActiveOrgId] = useState<string>("");

  const reload = () => {
    try {
      const us = loadUsers();
      setUsers(us);
      const cur = localStorage.getItem(CUR_KEY);
      setUid(cur && us.some((u) => u.id === cur) ? cur : us[0]?.id ?? "");
      const m = localStorage.getItem("spigolestay:modules");
      setModules(m ? JSON.parse(m) : {});
      // Il PIANO è la fonte di verità: tutto ciò che è incluso nel piano è sbloccato,
      // anche se la mappa dei moduli fosse vecchia o incompleta.
      const planKey = localStorage.getItem("spigolestay:plan") || localStorage.getItem("spigolestay:tier") || "";
      const tier = TIERS.find((t) => t.key === planKey);
      setPlanIncludes(tier ? ["pms", ...tier.includes] : []);
    } catch {}
  };
  // Ricarica al cambio pagina (così le modifiche fatte in Abbonamento/Utenti si riflettono).
  useEffect(() => { reload(); }, [pathname]);
  // Ricarica anche quando moduli/utenti cambiano nella stessa pagina (es. add-on in Abbonamento).
  useEffect(() => {
    const h = () => reload();
    window.addEventListener("spigolestay:modules", h);
    window.addEventListener("spigolestay:users", h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener("spigolestay:modules", h); window.removeEventListener("spigolestay:users", h); window.removeEventListener("storage", h); };
  }, []);

  // Registra l'ultimo accesso dell'utente collegato una volta per sessione del browser
  // (il login qui è dimostrativo). Così l'elenco utenti mostra un dato reale, non "Mai".
  useEffect(() => {
    if (!userId) return;
    try {
      const flag = `spigolestay:stamped:${userId}`;
      if (sessionStorage.getItem(flag)) return;
      const list = loadUsers();
      const now = new Date().toISOString();
      const next = list.map((u) => (u.id === userId ? { ...u, lastLogin: { at: now, ip: u.lastLogin?.ip ?? "—" } } : u));
      saveUsers(next);
      sessionStorage.setItem(flag, "1");
      setUsers(next);
    } catch {}
  }, [userId]);

  // Carica il mio ruolo/permessi sulle strutture condivise (una volta / al cambio pagina).
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const token = (await supabase?.auth.getSession())?.data.session?.access_token;
        if (!token) return;
        const r = await fetch("/api/org/access", { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json().catch(() => ({}));
        if (stop || !j?.orgs) return;
        const map: Record<string, { role: string; active: boolean; permissions: Record<string, PermLevel> | null }> = {};
        for (const o of j.orgs) map[o.orgId] = { role: o.role, active: o.active !== false, permissions: (o.permissions as Record<string, PermLevel>) || null };
        setShare(map);
      } catch {}
    })();
    return () => { stop = true; };
  }, [pathname]);
  // Ricava l'org della struttura ATTIVA (per applicare i limiti del co-gestore).
  useEffect(() => {
    const compute = () => {
      try {
        const act = localStorage.getItem("spigolestay:activestruct") || "all";
        if (act === "all") { setActiveOrgId(""); return; }
        const raw = localStorage.getItem("spigolestay:data:v1");
        const d = raw ? JSON.parse(raw) : {};
        const s = (Array.isArray(d.structures) ? d.structures : []).find((x: { id?: string }) => x.id === act);
        setActiveOrgId((s?.orgId as string) || "");
      } catch { setActiveOrgId(""); }
    };
    compute();
    const h = () => compute();
    window.addEventListener("spigolestay:activestruct", h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener("spigolestay:activestruct", h); window.removeEventListener("storage", h); };
  }, [pathname]);

  const setUserId = (id: string) => { setUid(id); try { localStorage.setItem(CUR_KEY, id); } catch {} };
  const user = users.find((u) => u.id === userId) ?? users[0] ?? null;

  // Limite del co-gestore: attivo SOLO se la struttura attiva è di un'org di cui sono "member"
  // (mai per il proprietario né per le strutture personali).
  const sh = activeOrgId ? share[activeOrgId] : undefined;
  const restriction = sh && sh.role === "member" ? { paused: sh.active === false, perms: sh.permissions } : null;
  const ORD: Record<string, number> = { none: 0, view: 1, edit: 2 };
  const minLvl = (a: PermLevel, b: PermLevel): PermLevel => (ORD[a] <= ORD[b] ? a : b);

  const level = (perm?: string): PermLevel => {
    if (!perm) return "edit";
    const own: PermLevel = user ? ((user.perms?.[perm] as PermLevel) ?? "none") : "edit";
    if (restriction) {
      if (restriction.paused) return "none";                              // accesso in pausa dal proprietario
      const g = ((restriction.perms?.[perm] as PermLevel) ?? "none");
      return minLvl(own, g);
    }
    return own;
  };
  const can = (perm?: string) => level(perm) !== "none";
  const hasModules = Object.keys(modules).length > 0;
  const hasInfo = hasModules || planIncludes.length > 0;
  const moduleOn = (m?: string) => {
    if (!m || m === "pms") return true;
    if (planIncludes.includes(m)) return true; // incluso nel piano attivo
    if (modules[m] === true) return true;        // add-on attivato a parte
    if (!hasInfo) return true;                    // nessuna info: non bloccare
    return false;
  };

  return <Ctx.Provider value={{ user, users, setUserId, modules, can, level, moduleOn }}>{children}</Ctx.Provider>;
}

export function useAccess(): AccessValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAccess deve stare dentro <AccessProvider>");
  return c;
}
