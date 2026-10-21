"use client";

// Salute del sistema: semaforo su invii automatici, attività notturne, Channex, WhatsApp e configurazione.
// I dati arrivano già classificati da /api/health (src/lib/health.ts): qui si mostrano soltanto.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader, Card, SectionTitle, Button, Alert } from "@/components/ui";
import type { HealthReport, Light } from "@/lib/health";
import { fmtDateTime } from "@/lib/dates";

const COLOR: Record<Light, string> = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)", idle: "var(--faint)" };
const LABEL: Record<Light, string> = { ok: "Tutto bene", warn: "Da controllare", err: "Problema", idle: "Nessun dato" };

function Dot({ light, size = 12 }: { light: Light; size?: number }) {
  return <span role="img" aria-label={LABEL[light]} title={LABEL[light]} className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: COLOR[light] }} />;
}

const fmt = (iso?: string) => (iso ? fmtDateTime(iso) : "");

export default function SalutePage() {
  const [data, setData] = useState<(HealthReport & { generatedAt?: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      let e: string | null = null, d: (HealthReport & { generatedAt?: string }) | null = null;
      try {
        const token = (await supabase?.auth.getSession())?.data.session?.access_token;
        if (!token) e = "Accedi per vedere la salute del sistema.";
        else {
          const r = await fetch("/api/health", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
          if (!r.ok) e = r.status === 401 || r.status === 403 ? "Non hai i permessi per vedere questa pagina." : "Non riesco a leggere lo stato del sistema. Riprova tra poco.";
          else d = await r.json();
        }
      } catch { e = "Nessuna connessione: non riesco a leggere lo stato del sistema."; }
      if (!alive) return;
      setErr(e); if (d) setData(d); setLoading(false);
    })();
    return () => { alive = false; };
  }, [tick]);

  const ricontrolla = () => { setLoading(true); setTick((n) => n + 1); };

  const s = data?.summary;
  return (
    <div className="w-full">
      <PageHeader
        title="Salute del sistema"
        subtitle="Se tutto funziona, qui è tutto verde. Altrimenti ti diciamo cosa guardare."
        actions={<Button variant="secondary" size="sm" onClick={ricontrolla} loading={loading}>{loading ? "Controllo…" : "Ricontrolla"}</Button>}
      />

      {err && <Alert tone="err" className="mb-4">{err}</Alert>}

      {s && (
        <div className="mb-5 flex items-center gap-4 rounded-xl border bg-surface p-4 shadow-sm max-sm:mb-3 max-sm:gap-3 max-sm:p-3 sm:p-5" style={{ borderColor: COLOR[s.light], borderLeftWidth: 6 }}>
          <Dot light={s.light} size={20} />
          <div className="min-w-0">
            <div className="font-display text-xl font-bold text-txt">{s.headline}</div>
            <div className="text-sm text-dim">{s.attention === 0 ? "Invii, portali e collegamenti risultano regolari." : "Guarda le voci gialle e rosse qui sotto."}{data?.generatedAt ? ` Aggiornato il ${fmt(data.generatedAt)}.` : ""}</div>
          </div>
        </div>
      )}

      {!s && !err && <Card><p className="text-sm text-dim">Controllo in corso…</p></Card>}

      <div className="grid gap-4 max-sm:gap-3 lg:grid-cols-2">
        {data?.sections.map((sec) => (
          <Card key={sec.id}>
            <SectionTitle>{sec.title}</SectionTitle>
            <ul className="divide-y divide-line">
              {sec.items.map((it) => (
                <li key={it.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="mt-1"><Dot light={it.light} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="break-words text-sm font-semibold text-txt">{it.title}</span>
                      {it.at && <span className="text-[11px] text-faint">{fmt(it.at)}</span>}
                    </div>
                    <p className="mt-0.5 text-sm text-dim">{it.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-faint">Verde: tutto bene · Giallo: da controllare · Rosso: problema · Grigio: non in uso o nessun dato. Per la configurazione si mostra solo se una variabile è impostata, mai il suo valore.</p>
    </div>
  );
}
