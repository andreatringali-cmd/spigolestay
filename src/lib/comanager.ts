// Permessi del CO-GESTORE (proprietario invitato a co-gestire una struttura di un altro).
// Riusa il modello permessi dello staff (users.ts: PermLevel none/view/edit per modulo).
// La mappa permessi viene salvata sulla membership e applicata lato client (access.tsx)
// SOLO quando la struttura attiva è condivisa-con-me (mai per il proprietario).

import { PERMISSIONS, type PermLevel } from "./users";

export type CoLevel = "viewer" | "operator" | "manager";

export const CO_LEVELS: { key: CoLevel; label: string; desc: string }[] = [
  { key: "viewer", label: "Sola lettura", desc: "Vede tutto, non modifica nulla." },
  { key: "operator", label: "Operativo", desc: "Gestisce calendario, prenotazioni e check-in. Niente prezzi né incassi." },
  { key: "manager", label: "Co-gestore", desc: "Gestisce tutto, tranne eliminare la struttura o gestire la condivisione." },
];

const clamp = (key: string, want: PermLevel): PermLevel => {
  const p = PERMISSIONS.find((x) => x.key === key);
  if (!p) return "none";
  if (p.levels.includes(want)) return want;
  // se il livello desiderato non è ammesso, scendi (edit->view->none) o sali al massimo consentito
  if (want === "view" && p.levels.includes("none")) return "none";
  return p.levels[p.levels.length - 1] ?? "none";
};

// Chiavi permesso considerate "sensibili" (prezzi/incassi/config) per il livello Operativo.
const SENSITIVE = new Set(["tariffe", "revenue", "ratechecker", "canali", "cassa", "pagamenti", "chiusura_cassa", "annulla_chiusura", "abbonamento", "utenti", "impostazioni", "statistiche"]);
const OPERATOR_EDIT = new Set(["prenotazioni", "calendario", "pulizie", "webconcierge", "checkin", "alloggiati", "tassa", "camere", "contatti_ospite", "dati_personali"]);

// Costruisce la mappa permessi per un livello. `_level` è solo un'etichetta per la UI.
export function coManagerPerms(level: CoLevel): Record<string, PermLevel | string> {
  const out: Record<string, PermLevel | string> = { _level: level };
  for (const p of PERMISSIONS) {
    let want: PermLevel = "none";
    if (level === "manager") want = "edit";
    else if (level === "viewer") want = "view";
    else { // operator
      if (OPERATOR_EDIT.has(p.key)) want = "edit";
      else if (SENSITIVE.has(p.key)) want = "view"; // vede ma non tocca prezzi/incassi
      else want = "view";
    }
    out[p.key] = clamp(p.key, want);
  }
  return out;
}

export function levelOf(permissions: Record<string, unknown> | null | undefined): CoLevel {
  const l = permissions?._level;
  return l === "viewer" || l === "operator" || l === "manager" ? l : "manager";
}
