// Helper lato browser per il modulo Documenti: chiamate alle route API (con bearer)
// e utilità di formato. La LETTURA dei documenti avviene direttamente via supabase
// (RLS tenant_id = auth.uid()); la SCRITTURA fiscale passa dalle route server.
import { supabase } from "@/lib/supabase";

export async function invPost<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new Error("Devi essere connesso");
  const r = await fetch(`/api/invoicing/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.message || j.error || "Errore");
  return j as T;
}

export const centsEur = (c?: number | null) => (c ?? 0) / 100;

export const DOC_KIND_LABEL: Record<string, string> = {
  fattura: "Fattura",
  nota_di_credito: "Nota di credito",
  ricevuta_non_fiscale: "Ricevuta",
};

export const STATO: Record<string, { label: string; color: string }> = {
  bozza: { label: "Bozza", color: "var(--faint)" },
  emessa: { label: "Emessa", color: "var(--focus)" },
  inviata_intermediario: { label: "Inviata", color: "var(--warn)" },
  consegnata: { label: "Consegnata", color: "var(--ok)" },
  scartata: { label: "Scartata", color: "var(--err)" },
  stornata: { label: "Stornata", color: "var(--dim)" },
};
