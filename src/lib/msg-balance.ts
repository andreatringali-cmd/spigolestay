// {saldo} dei messaggi agli ospiti: UNA definizione, la stessa del voucher e dell'elenco prenotazioni (incassi.ts → balanceDue:
// soggiorno + pulizia + extra + tassa di soggiorno dovuta − incassato, ai centesimi). Per un gruppo di camere si sommano i residui delle camere
// (con la QUOTA di tassa del gruppo, vedi booking.ts → groupRowBalances), perché al gruppo parte un solo messaggio.
import type { Structure } from "./types";
import { balanceDue } from "./incassi";
import { groupRowBalances } from "./booking";

type Row = Parameters<typeof balanceDue>[0] & { id?: string };

export function messageBalance(b: Row, structure: Structure | undefined, groupRows?: Row[]): number {
  if (groupRows && groupRows.length > 1) {
    const rows = groupRows as Parameters<typeof groupRowBalances>[1];
    return Math.round(groupRowBalances(structure, rows).reduce((a, r) => a + Math.round(r.balance * 100), 0)) / 100;
  }
  return balanceDue(b, structure);
}
