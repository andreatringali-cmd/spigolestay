"use client";

// Pannello SOLO-OWNER: gestione degli accessi "su invito".
// Xenora non è a registrazione aperta: solo le email in questa lista (più owner, utenti già
// esistenti, membri e invitati) possono entrare. Qui l'owner approva/rimuove le email.

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { supabase } from "@/lib/supabase";

interface Row { email: string; note: string | null; added_by: string | null; created_at: string }

const authToken = async () => (await (supabase?.auth.getSession() ?? Promise.resolve({ data: { session: null } }))).data.session?.access_token || "";

export default function AccessiPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const token = await authToken();
      if (!token) { setErr("Sessione scaduta: rientra."); return; }
      const res = await fetch("/api/admin/allowlist", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) { setForbidden(true); return; }
      const d = await res.json().catch(() => null) as { ok?: boolean; items?: Row[]; error?: string } | null;
      if (d?.ok && d.items) setItems(d.items);
      else setErr(d?.error || `Errore ${res.status}`);
    } catch { setErr("Errore di rete."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const add = async () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setErr("Email non valida."); return; }
    setBusy(true); setErr("");
    try {
      const token = await authToken();
      const res = await fetch("/api/admin/allowlist", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ email: e, note: note.trim() || undefined }) });
      const d = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (d?.ok) { setEmail(""); setNote(""); await load(); }
      else setErr(d?.error || `Errore ${res.status}`);
    } catch { setErr("Errore di rete."); }
    finally { setBusy(false); }
  };

  const remove = async (e: string) => {
    setErr("");
    try {
      const token = await authToken();
      const res = await fetch("/api/admin/allowlist", { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ email: e }) });
      const d = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (d?.ok) setItems((xs) => xs.filter((x) => x.email !== e));
      else setErr(d?.error || `Errore ${res.status}`);
    } catch { setErr("Errore di rete."); }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((r) => r.email.includes(s) || (r.note || "").toLowerCase().includes(s)) : items;
  }, [items, q]);

  if (forbidden) return (
    <div><PageHeader title="Accessi" hideHelp />
      <Card><div className="py-6 text-center text-sm text-dim">🔒 Area riservata al titolare.</div></Card>
    </div>
  );

  const fmtDate = (s: string) => { const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }); };

  return (
    <div>
      <PageHeader title="Accessi (su invito)" subtitle="Solo le email approvate qui possono entrare in Xenora. Utenti già esistenti, membri e invitati sono ammessi in automatico." hideHelp />

      <Card className="mb-4">
        <div className="text-sm font-semibold text-txt">Approva una nuova email</div>
        <p className="mt-1 text-[13px] text-dim">Aggiungi l&apos;indirizzo Google/email della persona a cui hai fatto la demo: potrà accedere subito.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="text-[11px] font-semibold text-dim">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@gmail.com" className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt" />
          </div>
          <div className="min-w-[160px] flex-1">
            <label className="text-[11px] font-semibold text-dim">Nota (opzionale)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. B&B Aurora, Siracusa" className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt" />
          </div>
          <button onClick={add} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--focus)" }}>
            {busy ? "Aggiungo…" : "Approva accesso"}
          </button>
        </div>
        {err && <div className="mt-2 text-[13px]" style={{ color: "var(--err)" }}>⚠ {err}</div>}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-txt">Email abilitate <span className="text-faint">({items.length})</span></div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca…" className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-txt" />
        </div>
        {loading ? (
          <div className="py-6 text-center text-sm text-dim">Carico…</div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-sm text-dim">Nessuna email in lista.</div>
        ) : (
          <div className="divide-y divide-line">
            {filtered.map((r) => (
              <div key={r.email} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-txt">{r.email}</div>
                  <div className="text-[11px] text-faint">aggiunta {fmtDate(r.created_at)}{r.note === "grandfathered" ? " · utente esistente" : r.note ? ` · ${r.note}` : ""}</div>
                </div>
                <button onClick={() => remove(r.email)} className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-dim hover:bg-wash hover:text-[color:var(--err)]">Rimuovi</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
