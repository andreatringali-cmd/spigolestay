import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// SOLO SVILUPPO LOCALE (NEXT_PUBLIC_LOCAL_ONLY=1): restituisce uno script che riempie il browser con dati di prova (una struttura, camere, ~150 prenotazioni, ospiti) per provare
// le schermate senza accesso. In produzione la variabile non c'è e la rotta risponde 404.
// Uso (dal browser, in un tab di localhost): (await import("/api/dev/seed")).seed()   oppure   fetch("/api/dev/seed").then(r => r.text()).then(eval)
function build() {
  const day = (off: number) => new Date(Date.UTC(2026, 9, 19) + off * 86400000).toISOString().slice(0, 10); // oggi nei dati di prova = 19.10.2026
  const now = Date.now();
  const sid = "demo-struct";
  const rts = [
    { id: "rt-dbl", structureId: sid, name: "Camera matrimoniale", beds: 2, basePrice: 90, maxOccupancy: 3, updatedAt: now },
    { id: "rt-fam", structureId: sid, name: "Camera familiare vista mare", beds: 4, basePrice: 140, maxOccupancy: 5, updatedAt: now },
    { id: "rt-sng", structureId: sid, name: "Singola", beds: 1, basePrice: 60, maxOccupancy: 1, updatedAt: now },
  ];
  const units = [
    { id: "u1", structureId: sid, roomTypeId: "rt-dbl", name: "Ortigia", code: "1", updatedAt: now },
    { id: "u2", structureId: sid, roomTypeId: "rt-dbl", name: "Aretusa", code: "2", updatedAt: now },
    { id: "u3", structureId: sid, roomTypeId: "rt-dbl", name: "Maniace", code: "3", updatedAt: now },
    { id: "u4", structureId: sid, roomTypeId: "rt-fam", name: "Plemmirio", code: "4", updatedAt: now },
    { id: "u5", structureId: sid, roomTypeId: "rt-fam", name: "Vendicari", code: "5", updatedAt: now },
    { id: "u6", structureId: sid, roomTypeId: "rt-sng", name: "Duomo", code: "6", updatedAt: now },
  ];
  const names = ["Giulia Rossi", "Marco Bianchi", "Karl Josef Scholz", "Sophie Martin", "Luca Ferrari", "Anna Kowalska", "John Smith", "Elena Greco", "Pedro Alvarez", "Marie Dubois", "Hans Müller", "Chiara Conti", "Tom Wilson", "Sara Marino", "Paolo Romano", "Julia Weber"];
  const countries = ["IT", "IT", "DE", "FR", "IT", "PL", "GB", "IT", "ES", "FR", "DE", "IT", "GB", "IT", "IT", "DE"];
  const guests = names.map((n, i) => ({ id: "g" + i, fullName: n, firstName: n.split(" ")[0], lastName: n.split(" ").slice(-1)[0], email: `ospite${i}@example.com`, phone: `+39333${1000000 + i * 137}`, country: countries[i], language: countries[i] === "IT" ? "it" : countries[i] === "DE" ? "de" : countries[i] === "FR" ? "fr" : "en", updatedAt: now }));
  const channels = ["booking", "direct", "expedia", "airbnb", "booking", "hotelbeds", "direct", "booking"];
  const bookings: Record<string, unknown>[] = [];
  let n = 0;
  for (let u = 0; u < units.length; u++) {
    let cursor = -150 + u * 5;
    while (cursor < 150) {
      const stay = 2 + ((n * 7) % 5), gap = (n * 3) % 4;
      const ci = cursor + gap, co = ci + stay;
      const un = units[u], rt = rts.find((r) => r.id === un.roomTypeId)!;
      const total = rt.basePrice * stay;
      const g = guests[n % guests.length];
      bookings.push({
        id: "b" + n, code: `XEN-2026-${String(n + 1).padStart(4, "0")}`, structureId: sid, roomTypeId: un.roomTypeId, unitId: un.id, guestId: g.id,
        channel: channels[n % channels.length], status: n % 23 === 0 ? "cancelled" : "confirmed", checkIn: day(ci), checkOut: day(co), bookedOn: day(ci - 20 - (n % 30)),
        adults: 1 + (n % 2), children: n % 7 === 0 ? 1 : 0, total, paid: n % 3 === 0 ? total : n % 3 === 1 ? Math.round(total * 0.3) : 0, cleaningFee: 20, updatedAt: now - n * 1000,
        webCheckin: ci < 5 && n % 2 === 0,
      });
      cursor = co; n++;
    }
  }
  const data = {
    structures: [{ id: sid, name: "Casa Demo Siracusa", groupName: "Demo", city: "Siracusa", address: "Via Roma 1", phone: "+39 0931 000000", checkInFrom: "15:00", checkOutBy: "11:00", updatedAt: now }],
    roomTypes: rts, units, guests, bookings, events: [], directReviews: [], rateOverrides: {}, _deleted: {},
  };
  return data;
}

export async function GET() {
  if (process.env.NEXT_PUBLIC_LOCAL_ONLY !== "1") return new NextResponse("not found", { status: 404 });
  const data = JSON.stringify(build());
  const js = `
export async function seed() {
  localStorage.setItem("spigolestay:data:v1", ${JSON.stringify(data)});
  localStorage.setItem("spigolestay:onboarded", "1");
  localStorage.setItem("spigolestay:forcereset:v1", "1");
  localStorage.setItem("spigolestay:zeroprices:v1", "1");
  localStorage.setItem("spigolestay:activestruct", "all");
  localStorage.removeItem("xn-bigstore-migrated"); // così il blocco dati passa dal localStorage all'archivio IndexedDB all'avvio
  location.reload();
  return "ok";
}
`;
  return new NextResponse(js, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });
}
