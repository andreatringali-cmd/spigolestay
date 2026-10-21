"use client";

// Copie disponibili — SOLA LETTURA, solo amministratore di piattaforma.
// Elenca, per ogni account e organizzazione, le copie giornaliere (migrazione 0018): giorno, dimensione, versione. Nessun pulsante di ripristino:
// il ripristino si fa a mano, in sicurezza, seguendo docs/COPIE-GIORNALIERE.md. Nessun selettore di struttura qui (la struttura si sceglie solo in alto a destra).

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, DataTable, PageHeader, StatCard } from "@/components/ui";
import { fmtDMY } from "@/lib/dates";
import { fmtBytes, type AccountCopies, type CopyRow } from "@/lib/daily-copies";
import { supabase } from "@/lib/supabase";

interface Resp { ok?: boolean; ready?: boolean; accounts?: AccountCopies[]; totalBytes?: number; totalCopies?: number; error?: string; message?: string }

const authToken = async () => (await (supabase?.auth.getSession() ?? Promise.resolve({ data: { session: null } }))).data.session?.access_token || "";

export default function CopiePage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const fetchCopies = useCallback(async () => {
    try {
      const token = await authToken();
      if (!token) { setErr("Sessione scaduta: esci e rientra."); return; }
      const res = await fetch("/api/admin/copie", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) { setForbidden(true); return; }
      const d = await res.json().catch(() => null) as Resp | null;
      if (d?.ok) setData(d); else setErr(d?.message || d?.error || `Errore ${res.status}`);
    } catch { setErr("Errore di rete."); }
    finally { setLoading(false); }
  }, []);
  const refresh = () => { setLoading(true); setErr(""); void fetchCopies(); };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- caricamento iniziale dal server
  useEffect(() => { void fetchCopies(); }, [fetchCopies]);

  if (forbidden) return (
    <div>
      <PageHeader title="Copie disponibili" hideHelp />
      <Alert tone="warn" title="Area riservata">Questa pagina è visibile solo all&apos;amministratore.</Alert>
    </div>
  );

  const accounts = data?.accounts ?? [];
  const columns = [
    { key: "day", header: "Giorno", cell: (r: CopyRow) => <span className="font-mono tabular-nums">{fmtDMY(r.day)}</span> },
    { key: "size", header: "Dimensione", align: "right" as const, cell: (r: CopyRow) => <span className="font-mono tabular-nums">{fmtBytes(r.bytes)}</span> },
    { key: "rev", header: "Versione", align: "right" as const, cell: (r: CopyRow) => <span className="font-mono tabular-nums">{r.rev}</span> },
    { key: "at", header: "Copiata alle", cell: (r: CopyRow) => r.takenAt ? new Date(r.takenAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—" },
  ];

  return (
    <div>
      <PageHeader
        title="Copie disponibili"
        subtitle="Una copia al giorno di ogni account, conservata 30 giorni. Solo consultazione: per ripristinare segui la guida «Copie giornaliere»."
        actions={<Button variant="secondary" size="sm" onClick={refresh} loading={loading}>Aggiorna</Button>}
        hideHelp
      />

      {err && <Alert tone="err" className="mb-4" onClose={() => setErr("")}>{err}</Alert>}

      {data && data.ready === false && (
        <Alert tone="info" title="Copie giornaliere non ancora attive" className="mb-4">
          La migrazione 0018 non è ancora stata applicata al database: appena lo sarà, qui compariranno le copie notturne.
        </Alert>
      )}

      {data?.ready && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Account con copie" value={accounts.length} />
          <StatCard label="Copie in tutto" value={data.totalCopies ?? 0} />
          <StatCard label="Spazio (testo)" value={fmtBytes(data.totalBytes ?? 0)} hint="Su disco è circa un terzo: i dati sono compressi" />
        </div>
      )}

      {data?.ready && accounts.length === 0 && !loading && (
        <Card><div className="py-6 text-center text-sm text-dim">Nessuna copia ancora: la prima si crea questa notte.</div></Card>
      )}

      <div className="space-y-3">
        {accounts.map((a) => {
          const k = `${a.kind}:${a.id}`;
          const isOpen = !!open[k];
          return (
            <Card key={k} padding="sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-txt">{a.label}</span>
                    <Badge tone={a.kind === "org" ? "info" : "neutral"}>{a.kind === "org" ? "Organizzazione" : "Utente"}</Badge>
                  </div>
                  <div className="mt-0.5 text-[12px] text-dim">
                    {a.copies.length} {a.copies.length === 1 ? "copia" : "copie"} · ultima {a.lastDay ? fmtDMY(a.lastDay) : "—"} · {fmtBytes(a.totalBytes)} · <span className="font-mono">{a.id}</span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [k]: !isOpen }))}>
                  {isOpen ? "Nascondi" : "Mostra le copie"}
                </Button>
              </div>
              {isOpen && (
                <div className="mt-3">
                  <DataTable caption={`Copie di ${a.label}`} columns={columns} rows={a.copies} rowKey={(r) => `${r.id}:${r.day}`} />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
