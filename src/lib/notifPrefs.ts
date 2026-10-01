// Preferenze di notifica (Impostazioni → Notifiche), condivise tra l'UI (Impostazioni), lo
// store client (store.tsx, per le azioni manuali) e l'import OTA server-side (channex-inbound.ts,
// che legge la stessa chiave dal blob sincronizzato invece che da localStorage). Un'unica fonte
// per i default evita che le due letture vadano fuori sincrono.
export const NOTIF_DEF = {
  newBooking: true,
  modified: true,
  cancel: true,
  checkin: true,
  payment: false,
  review: true,
  message: true,
  cleaning: false,
  ota: true,
};
export type NotifPrefs = typeof NOTIF_DEF;

export function parseNotifPrefs(raw: string | null | undefined): NotifPrefs {
  try { return raw ? { ...NOTIF_DEF, ...JSON.parse(raw) } : { ...NOTIF_DEF }; } catch { return { ...NOTIF_DEF }; }
}

export function loadNotifPrefs(): NotifPrefs {
  try { return parseNotifPrefs(localStorage.getItem("spigolestay:notifs")); } catch { return { ...NOTIF_DEF }; }
}
