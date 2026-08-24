// Motore audio del gestionale: toni sintetizzati (Web Audio API), niente file esterni.
// Ogni evento ha il suo "cinguettio". Rispetta il mute (localStorage) e la policy autoplay
// (l'AudioContext si sblocca al primo gesto dell'utente).

export type SoundName = "booking" | "cancel" | "done" | "message" | "notify" | "sent" | "received" | "login" | "logout" | "error";

interface Note { f: number; t: number; d: number }
interface Def { seq: Note[]; type?: OscillatorType; vol?: number }

const S: Record<SoundName, Def> = {
  booking: { seq: [{ f: 523.25, t: 0, d: 0.13 }, { f: 659.25, t: 0.1, d: 0.13 }, { f: 783.99, t: 0.2, d: 0.2 }], vol: 0.09 }, // arpeggio allegro
  cancel: { seq: [{ f: 659.25, t: 0, d: 0.12 }, { f: 523.25, t: 0.1, d: 0.12 }, { f: 415.3, t: 0.2, d: 0.2 }], type: "triangle", vol: 0.08 },
  done: { seq: [{ f: 783.99, t: 0, d: 0.09 }, { f: 1046.5, t: 0.08, d: 0.18 }], vol: 0.09 }, // ding soddisfacente
  message: { seq: [{ f: 880, t: 0, d: 0.05 }, { f: 660, t: 0.06, d: 0.09 }], vol: 0.07 },
  notify: { seq: [{ f: 880, t: 0, d: 0.06 }, { f: 1174.7, t: 0.07, d: 0.11 }], vol: 0.07 },
  sent: { seq: [{ f: 660, t: 0, d: 0.05 }, { f: 990, t: 0.05, d: 0.09 }], vol: 0.07 }, // swoosh su
  received: { seq: [{ f: 990, t: 0, d: 0.05 }, { f: 660, t: 0.06, d: 0.1 }], vol: 0.07 },
  login: { seq: [{ f: 440, t: 0, d: 0.1 }, { f: 659.25, t: 0.1, d: 0.16 }], type: "triangle", vol: 0.08 },
  logout: { seq: [{ f: 659.25, t: 0, d: 0.1 }, { f: 440, t: 0.1, d: 0.16 }], type: "triangle", vol: 0.08 },
  error: { seq: [{ f: 220, t: 0, d: 0.22 }], type: "square", vol: 0.06 },
};

let ctx: AudioContext | null = null;
const soundOn = () => { try { return localStorage.getItem("spigolestay:sound") !== "off"; } catch { return true; } };
export const isSoundOn = soundOn;
export function setSoundOn(on: boolean) { try { localStorage.setItem("spigolestay:sound", on ? "on" : "off"); } catch {} }

function getCtx(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = ctx || new AC();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}

export function playSound(name: SoundName) {
  if (!soundOn()) return;
  const def = S[name];
  const c = getCtx();
  if (!def || !c) return;
  const now = c.currentTime;
  for (const n of def.seq) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = def.type ?? "sine";
    osc.frequency.setValueAtTime(n.f, now + n.t);
    osc.connect(g); g.connect(c.destination);
    const vol = def.vol ?? 0.08;
    g.gain.setValueAtTime(0.0001, now + n.t);
    g.gain.exponentialRampToValueAtTime(vol, now + n.t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
    osc.start(now + n.t);
    osc.stop(now + n.t + n.d + 0.03);
  }
}
