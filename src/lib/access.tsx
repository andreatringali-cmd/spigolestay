"use client";

// Contesto di accesso: utente "collegato" + moduli attivi (Abbonamento).
// Permette a menu e pagine di adattarsi a permessi e moduli. In produzione l'utente
// arriverà dall'autenticazione; qui è simulato con uno switch per provare i ruoli.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { loadUsers, saveUsers, type User, type PermLevel } from "./users";
import { TIERS } from "./plans";

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

  const setUserId = (id: string) => { setUid(id); try { localStorage.setItem(CUR_KEY, id); } catch {} };
  const user = users.find((u) => u.id === userId) ?? users[0] ?? null;

  const level = (perm?: string): PermLevel => { if (!perm || !user) return "edit"; return (user.perms?.[perm] as PermLevel) ?? "none"; };
  const can = (perm?: string) => !perm || !user || level(perm) !== "none";
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
