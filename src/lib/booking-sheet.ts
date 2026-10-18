// Scheda stampabile della prenotazione (pulsante «Stampa» del pannello): stessa impostazione della stampa di Channex,
// una pagina con i dati della prenotazione come arrivano dall'OTA. Modulo puro: restituisce l'HTML (tutto già escapato).

export interface SheetNight { date: string; rate?: string; price: string; promo?: string }
export interface SheetRoom {
  title: string;                // "Deluxe - 225,56 €"
  checkIn: string; checkOut: string;
  guests: string[]; occupancy: string; mealPlan?: string; smoking?: string; bed?: string; policies?: string;
  nights: SheetNight[]; subtotal: string; total: string;
}
export interface SheetInput {
  property: string; channel: string; header: string;
  checkIn: string; checkOut: string; arrival: string; nights: string; rooms: string; occupancy: string; total: string;
  customer: { name: string; country?: string; language?: string; email?: string; phone?: string };
  otaCode?: string; bookedAt?: string; commission?: string;
  notes?: string; payment?: string;
  roomsList: SheetRoom[];
}

const esc = (s: unknown): string => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] || c));
const field = (label: string, value: string | undefined, big = false): string =>
  value ? `<div class="f"><div class="l">${esc(label)}</div><div class="v${big ? " big" : ""}">${esc(value)}</div></div>` : "";
const multi = (label: string, value: string | undefined): string =>
  value ? `<div class="f"><div class="l">${esc(label)}</div><div class="v pre">${esc(value)}</div></div>` : "";

export function bookingSheetHtml(s: SheetInput, title = "Prenotazione"): string {
  const rooms = s.roomsList.map((r) => `
    <div class="room">
      <div class="rt">${esc(r.title)}</div>
      <div class="rd">→ ] ${esc(r.checkIn)} &nbsp;&nbsp; [ → ${esc(r.checkOut)}</div>
      <div class="rg">
        <div>
          ${r.guests.length ? `<div class="f"><div class="l">Ospiti</div>${r.guests.map((g) => `<div class="v">${esc(g)}</div>`).join("")}</div>` : ""}
          ${field("Occupazione", r.occupancy)}
          ${field("Piano pasto", r.mealPlan)}
          ${field("Letti", r.bed)}
          ${field("Preferenze per i fumatori", r.smoking)}
          ${multi("Politiche", r.policies)}
        </div>
        <table>
          <thead><tr><th>Data</th><th>Tariffa</th><th class="num">Prezzo</th></tr></thead>
          <tbody>
            ${r.nights.map((n) => `<tr><td>${esc(n.date)}</td><td>${esc(n.rate ?? "")}${n.promo ? `<div class="pm">${esc(n.promo)}</div>` : ""}</td><td class="num">${esc(n.price)}</td></tr>`).join("")}
            <tr class="sum"><td colspan="2">Subtotale</td><td class="num">${esc(r.subtotal)}</td></tr>
            <tr class="sum"><td colspan="2">Totale</td><td class="num">${esc(r.total)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>`).join("");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  *{box-sizing:border-box} body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a2131;margin:0;padding:34px 40px;font-size:12px;line-height:1.45}
  .top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:1px solid #ccd;padding-bottom:8px;margin-bottom:14px}
  .top .p{font-weight:700;font-size:13px} .top .h{font-weight:700;font-size:12px;text-align:right}
  .ch{text-align:right;font-size:11px;color:#555;margin-bottom:4px}
  .cols{display:grid;grid-template-columns:1fr 1.15fr 1.2fr;gap:22px;padding-bottom:12px;border-bottom:1px solid #ccd}
  .f{margin-bottom:9px} .l{font-size:10px;color:#8a8f9c} .v{font-size:12px} .big{font-size:14px;font-weight:700} .pre{white-space:pre-wrap}
  .room{padding:12px 0;border-bottom:1px solid #ccd} .rt{font-weight:700;font-size:14px} .rd{font-size:11px;color:#555;margin:2px 0 10px}
  .rg{display:grid;grid-template-columns:1fr 1.7fr;gap:22px}
  table{border-collapse:collapse;width:100%;font-size:11.5px} th{text-align:left;font-weight:500;color:#555;padding:4px 6px;border-bottom:1px solid #ccd}
  td{padding:5px 6px;border-bottom:1px solid #e5e7ee;vertical-align:top} .num{text-align:right} .sum td{font-weight:700} .pm{font-size:9.5px;color:#8a8f9c}
  @media print{body{padding:18px 22px}}
</style></head><body>
  <div class="ch">${esc(s.channel)}</div>
  <div class="top"><div class="p">${esc(s.property)}</div><div class="h">${esc(s.header)}</div></div>
  <div class="cols">
    <div>
      ${field("Check-in", s.checkIn, true)}${field("Check-out", s.checkOut, true)}${field("Orario di arrivo", s.arrival)}
      ${field("Notti", s.nights)}${field("Camere", s.rooms)}${field("Occupazione", s.occupancy)}${field("Importo totale", s.total, true)}
    </div>
    <div>
      ${field("Cliente", s.customer.name, true)}${field("Paese", s.customer.country)}${field("Lingua", s.customer.language)}
      ${field("E-mail", s.customer.email)}${field("Telefono", s.customer.phone)}${field("ID prenotazione OTA", s.otaCode)}
      ${field("Prenotato il", s.bookedAt)}${field("Commissione OTA", s.commission)}
    </div>
    <div>
      ${multi("Note", s.notes)}${field("Metodo di pagamento", s.payment)}
    </div>
  </div>
  ${rooms}
  <script>window.addEventListener("load",function(){setTimeout(function(){window.print()},250)})</script>
</body></html>`;
}
