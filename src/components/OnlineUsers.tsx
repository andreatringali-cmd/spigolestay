"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useAccess } from "@/lib/access";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";

// Utenti online REALI: presenza Supabase Realtime su un canale per ogni struttura condivisa (org)
// di cui sei membro. Così vedi quando il tuo socio è collegato e ricevi un avviso quando entra.
const initials = (n: string) => n.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
const AVATAR = ["var(--focus)", "#0891B2", "#DB2777", "#2F9E6F", "#C08A3A"];

type Peer = { userId: string; name: string; email: string };

export default function OnlineUsers() {
  const { t } = useLang();
  const { user: localUser } = useAccess();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const known = useRef<Set<string>>(new Set());
  const ready = useRef(false);
  const [netOnline, setNetOnline] = useState(true);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Stato di rete reale: il pallino è verde quando SEI online (connesso), non solo se c'è un socio.
  useEffect(() => {
    const on = () => setNetOnline(true), off = () => setNetOnline(false);
    try { setNetOnline(navigator.onLine); } catch {}
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const selfOnline = netOnline && !!user?.id;

  const md = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const myName = (md.full_name as string) || [md.first_name, md.last_name].filter(Boolean).join(" ") || `${localUser?.firstName ?? ""} ${localUser?.lastName ?? ""}`.trim() || (user?.email ?? "").split("@")[0] || t("Tu");

  useEffect(() => {
    if (!supabase || !user?.id) return;
    const sb = supabase;
    let cancelled = false;
    const channels: ReturnType<typeof sb.channel>[] = [];
    const states = new Map<string, Record<string, Peer[]>>();

    const recompute = () => {
      const map = new Map<string, Peer>();
      for (const st of states.values()) for (const list of Object.values(st)) for (const p of list) if (p.userId && p.userId !== user.id) map.set(p.userId, p);
      const next = [...map.values()];
      if (ready.current) {
        const arrived = next.filter((p) => !known.current.has(p.userId));
        if (arrived.length) { setToast(`${arrived.map((p) => p.name).join(", ")} ${arrived.length > 1 ? t("sono online") : t("è online")}`); setTimeout(() => setToast(null), 5000); }
      }
      known.current = new Set(next.map((p) => p.userId));
      setPeers(next);
    };

    (async () => {
      const { data } = await sb.from("memberships").select("org_id").eq("user_id", user.id);
      const orgIds = ((data as { org_id?: string }[] | null) ?? []).map((r) => r.org_id).filter((x): x is string => !!x);
      if (cancelled) return;
      for (const orgId of orgIds) {
        const ch = sb.channel(`presence:org:${orgId}`, { config: { presence: { key: user.id } } });
        ch.on("presence", { event: "sync" }, () => { states.set(orgId, ch.presenceState() as unknown as Record<string, Peer[]>); recompute(); });
        ch.subscribe(async (status) => {
          if (status === "SUBSCRIBED") await ch.track({ userId: user.id, name: myName, email: user.email ?? "" });
        });
        channels.push(ch);
      }
      // la prima sincronizzazione non genera avvisi (chi era già online non "entra")
      setTimeout(() => { ready.current = true; }, 3000);
    })();

    return () => { cancelled = true; ready.current = false; channels.forEach((c) => { void sb.removeChannel(c); }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const online = [
    // Per me stesso mostro l'email come sottotitolo (così riconosco l'account) ed evito il "tu" doppio.
    { id: user?.id || "me", name: myName, role: user?.email ?? "", you: true, photo: localUser?.photo },
    ...peers.map((p) => ({ id: p.userId, name: p.name, role: t("Socio"), you: false, photo: undefined as string | undefined })),
  ];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title={peers.length ? `${peers.map((p) => p.name).join(", ")} ${t("online")}` : t("Utenti online")} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 transition hover:bg-wash">
        <div className="flex -space-x-2">
          {online.slice(0, 3).map((u, i) => (
            <span key={u.id} className="grid h-6 w-6 place-items-center overflow-hidden rounded-full border-2 border-surface text-[10px] font-bold text-white" style={{ backgroundColor: AVATAR[i % AVATAR.length] }}>{u.photo ? <img src={u.photo} alt="" className="h-full w-full object-cover" /> : initials(u.name)}</span>
          ))}
        </div>
        <span className="hidden items-center gap-1 text-xs font-medium text-dim sm:flex">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: selfOnline ? "var(--ok)" : "var(--faint)" }} />
          {peers.length ? `${peers.length === 1 ? peers[0].name.split(" ")[0] : `${peers.length} ${t("soci")}`} ${t("online")}` : `${online.length} ${t("online")}`}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-line bg-surface p-2 shadow-xl">
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-faint">{t("Online adesso")} · {online.length}</div>
          {online.map((u, i) => (
            <div key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
              <span className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: AVATAR[i % AVATAR.length] }}>
                {u.photo ? <img src={u.photo} alt="" className="h-full w-full object-cover" /> : initials(u.name)}
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-[color:var(--ok)]" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-txt">{u.name}{u.you && <span className="ml-1 text-[10px] text-faint">{t("(tu)")}</span>}</div>
                <div className="text-[11px] text-dim">{u.role}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {toast && (
        <div role="status" className="fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-txt shadow-2xl">
          <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--ok)]" />{toast}
        </div>
      )}
    </div>
  );
}
