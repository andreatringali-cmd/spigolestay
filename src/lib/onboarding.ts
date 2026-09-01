// Stato "primo accesso" + reset dei dati (prototipo, localStorage).
// onboarded: "1" = configurato · "0" = reset in corso (mostra il wizard) · assente = demo (nessun wizard).

export const ONBOARDED_KEY = "spigolestay:onboarded";

// Il wizard si mostra SOLO dopo un reset esplicito (onboarded === "0"),
// così i visitatori del demo continuano a vedere i dati d'esempio.
export function isOnboardingActive(): boolean {
  try { return localStorage.getItem(ONBOARDED_KEY) === "0"; } catch { return false; }
}
export function markOnboarded(): void {
  try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch {}
}

const EMPTY_DATA = { structures: [], roomTypes: [], units: [], guests: [], bookings: [], events: [], rateOverrides: {} };

// Svuota tutto e riparte come primo accesso: dati vuoti + wizard attivo.
export function resetAll(): void {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("spigolestay:")).forEach((k) => localStorage.removeItem(k));
    // Dati vuoti così il seed demo non ricompare, poi attivo il wizard.
    localStorage.setItem("spigolestay:data:v1", JSON.stringify(EMPTY_DATA));
    localStorage.setItem("spigolestay:users", JSON.stringify([]));
    localStorage.setItem("spigolestay:activestruct", "all");
    localStorage.setItem(ONBOARDED_KEY, "0");
  } catch {}
  window.location.href = "/";
}
