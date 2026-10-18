import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { bookingSheetHtml } = await import("../src/lib/booking-sheet.ts");

const input = {
  property: "Spigolehouse", channel: "BookingCom", header: "ven 30.10.2026 - 2 notti - Giovanni luca Cosenza",
  checkIn: "ven 30.10.2026", checkOut: "dom 01.11.2026", arrival: "N/D", nights: "2", rooms: "1", occupancy: "2 adulti", total: "225,56 €",
  customer: { name: "Giovanni <b>luca</b> Cosenza", country: "Italia", language: "italiano", email: "g@guest.booking.com" },
  otaCode: "6088543047", bookedAt: "sab 17.10.2026", commission: "51,88 €", notes: "Meal Plan: colazione\nSmoking: No", payment: "Bonifico",
  roomsList: [{
    title: "Deluxe - 225,56 €", checkIn: "ven 30.10.2026", checkOut: "dom 01.11.2026", guests: ["Giuseppe Gerardi"], occupancy: "2 adulti", mealPlan: "Colazione inclusa", smoking: "Non-Smoking",
    nights: [{ date: "ven 30.10.2026", rate: "Standard", price: "107,41 €", promo: "Tariffa settimanale" }, { date: "sab 31.10.2026", rate: "Standard", price: "118,15 €" }],
    subtotal: "225,56 €", total: "225,56 €",
  }],
};

test("scheda stampabile: contiene i dati e fa l'escape dell'HTML", () => {
  const h = bookingSheetHtml(input, "Prenotazione 6088543047");
  assert.ok(h.includes("Spigolehouse") && h.includes("Deluxe - 225,56 €") && h.includes("107,41 €") && h.includes("Giuseppe Gerardi"));
  assert.ok(h.includes("Tariffa settimanale") && h.includes("Commissione OTA") && h.includes("51,88 €"));
  assert.ok(!h.includes("<b>luca</b>") && h.includes("&lt;b&gt;luca&lt;/b&gt;"));
});
test("scheda stampabile: i campi vuoti non compaiono", () => {
  const h = bookingSheetHtml({ ...input, commission: undefined, customer: { name: "Mario" }, roomsList: [{ ...input.roomsList[0], guests: [], mealPlan: undefined }] });
  assert.ok(!h.includes("Commissione OTA") && !h.includes("Piano pasto") && !h.includes(">Lingua<"));
});
