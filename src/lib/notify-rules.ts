// Quando una modifica a una prenotazione merita l'email "Prenotazione modificata" al titolare.
// Cambiare SOLO la camera assegnata (unitId, ed eventualmente la tipologia che ne deriva) non la merita: resta nel registro attività.
// Date, ospiti, tariffa, canale, stato e ospite sì.

const SOLO_CAMERA = new Set(["unitId", "roomTypeId"]);

/** `changed` = campi della prenotazione davvero cambiati dall'aggiornamento. */
export const modificaMeritaEmail = (changed: readonly string[]): boolean => changed.some((f) => !SOLO_CAMERA.has(f));

/** Spostamento nel Calendario: email solo se cambiano le date o la struttura (non per il solo cambio camera). */
export const spostamentoMeritaEmail = (prev: { checkIn: string; checkOut: string }, next: { checkIn: string; checkOut: string }, cambiaStruttura: boolean): boolean =>
  cambiaStruttura || prev.checkIn !== next.checkIn || prev.checkOut !== next.checkOut;
