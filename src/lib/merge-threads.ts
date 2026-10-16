// Unione di due schede ospite: la conversazione (e i suoi stati: archiviata, fissata, "da leggere", ultimo visto) segue la scheda che resta.
// Funzioni pure, testate in tests/merge-threads.test.ts. Senza questo, la chat della scheda eliminata resterebbe orfana (nome = id interno).
export interface ChatMsg { id: string; ts: number; wid?: string }
export interface ChatState<M extends ChatMsg = ChatMsg> {
  threads: Record<string, M[]>;
  archived: string[];
  pinned: string[];
  manualUnread: string[];
  seen: Record<string, number>;
}

export function mergeChatState<M extends ChatMsg>(state: ChatState<M>, dropToKeep: Map<string, string>): ChatState<M> {
  const threads: Record<string, M[]> = { ...state.threads };
  let archived = [...state.archived], pinned = [...state.pinned], manualUnread = [...state.manualUnread];
  const seen = { ...state.seen };
  const groups = new Map<string, string[]>();
  for (const [d, k] of dropToKeep) if (d && k && d !== k) groups.set(k, [...(groups.get(k) ?? []), d]);
  for (const [keep, drops] of groups) {
    const members = [keep, ...drops];
    const withThread = members.filter((m) => (state.threads[m]?.length ?? 0) > 0);
    // 1) Messaggi: uniti, senza doppioni (per id o per id WhatsApp), in ordine di tempo.
    if (drops.some((d) => (state.threads[d]?.length ?? 0) > 0)) {
      const ids = new Set<string>(); const wids = new Set<string>(); const out: M[] = [];
      for (const m of members.flatMap((k) => state.threads[k] ?? [])) {
        if (ids.has(m.id) || (m.wid && wids.has(m.wid))) continue;
        ids.add(m.id); if (m.wid) wids.add(m.wid); out.push(m);
      }
      threads[keep] = out.sort((a, b) => a.ts - b.ts);
    }
    for (const d of drops) delete threads[d];
    // 2) Archiviata: la chat unita resta archiviata solo se lo erano tutte le conversazioni che avevano messaggi.
    const arcMembers = withThread.length ? withThread : members.filter((m) => state.archived.includes(m));
    const arc = arcMembers.length > 0 && arcMembers.every((m) => state.archived.includes(m));
    archived = archived.filter((x) => !members.includes(x)); if (arc) archived.push(keep);
    // 3) Fissata / segnata "da leggere": basta una delle due.
    const pin = members.some((m) => state.pinned.includes(m));
    pinned = pinned.filter((x) => !members.includes(x)); if (pin) pinned.push(keep);
    const unr = members.some((m) => state.manualUnread.includes(m));
    manualUnread = manualUnread.filter((x) => !members.includes(x)); if (unr) manualUnread.push(keep);
    // 4) Ultimo messaggio visto: il più recente, così i messaggi già letti non tornano non letti.
    const ts = Math.max(0, ...members.map((m) => seen[m] ?? 0));
    for (const d of drops) delete seen[d];
    if (ts > 0) seen[keep] = ts;
  }
  return { threads, archived, pinned, manualUnread, seen };
}

/** Applica l'unione al browser (localStorage) e avvisa i badge. Silenziosa se non c'è nulla da spostare. */
export function moveGuestChats(dropToKeep: Map<string, string>): void {
  if (typeof window === "undefined" || dropToKeep.size === 0) return;
  const rd = <T,>(k: string, fb: T): T => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; } };
  const wr = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* niente */ } };
  const state: ChatState = {
    threads: rd<Record<string, ChatMsg[]>>("spigolestay:threads:v1", {}),
    archived: rd<string[]>("spigolestay:archived", []),
    pinned: rd<string[]>("spigolestay:pinned", []),
    manualUnread: rd<string[]>("spigolestay:manualunread", []),
    seen: rd<Record<string, number>>("nav:msgseen", {}),
  };
  const touches = [...dropToKeep.keys()].some((d) => (state.threads[d]?.length ?? 0) > 0 || state.archived.includes(d) || state.pinned.includes(d) || state.manualUnread.includes(d) || d in state.seen);
  if (!touches) return;
  const next = mergeChatState(state, dropToKeep);
  wr("spigolestay:threads:v1", next.threads); wr("spigolestay:archived", next.archived); wr("spigolestay:pinned", next.pinned);
  wr("spigolestay:manualunread", next.manualUnread); wr("nav:msgseen", next.seen);
  try { window.dispatchEvent(new Event("spigolestay:threads")); } catch { /* niente */ }
}
