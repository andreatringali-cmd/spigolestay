"use client";

// NUCLEO dell'Assistente Xenora — un core "osservatorio" caldo e vivo, non un HUD freddo.
// Una sfera di luce con anelli orbitali inclinati (profondità 3D), un "signal ring" ondulato che
// reagisce alla voce (idle = respiro, listen = increspatura, speak = onda) e il wordmark XENORA. al
// centro. Regia UNICA: una sola animazione orchestrata; lo stato è letto via ref (l'effetto non viene
// ricostruito a ogni transizione). Palette theme-aware: greige + terracotta/oro in chiaro (niente
// azzurrino), notte calda con ambra/terracotta in scuro. Rispetta prefers-reduced-motion.
import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

type CoreState = "idle" | "listen" | "speak";

function rgba(hex: string, a: number) {
  const h = (hex || "#B65C3C").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${isNaN(r) ? 182 : r},${isNaN(g) ? 92 : g},${isNaN(b) ? 60 : b},${Math.max(0, Math.min(1, a))})`;
}
function cssVar(name: string, fallback: string) {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch { return fallback; }
}

export default function AssistantCore({ state = "idle", size = 220 }: { state?: CoreState; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CoreState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const { theme } = useTheme();
  const light = theme !== "dark";

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const W = size, H = size;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2, cy = H / 2;

    // Palette calda: terracotta protagonista, oro/ambra come luce, neutri greige per gli anelli.
    // Un solo accento freddo (--focus) usato con parsimonia come contrappunto nel nucleo.
    const focus = cssVar("--focus", light ? "#2F6BB0" : "#6FA3DC");
    const terra = light ? "#B65C3C" : "#E08A5B";
    const amber = light ? "#C79544" : "#E7B968";
    const neutral = light ? "#9C9488" : "#8A8478";
    const faint = light ? "#C9C1B5" : "#4A4137";
    // Nucleo: gradiente sfera (alto-sinistra chiaro -> bordo caldo scuro).
    const sphereHi = light ? "#FDFBF7" : "#3A2E26";
    const sphereMid = light ? "#EFE7DB" : "#2A211B";
    const sphereLo = light ? "#DED2C2" : "#160F0B";

    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Energia della voce: lerp morbido verso il target dello stato (nessun salto al cambio stato).
    const target: Record<CoreState, number> = { idle: 0.16, listen: 1, speak: 0.72 };
    let energy = target[stateRef.current];
    let raf = 0, t = 0, ang = 0;

    // Anelli orbitali inclinati: (rx, ry, rotazione di fase, verso, colore).
    const orbits = [
      { rx: 0.96, ry: 0.34, spd: 0.006, tilt: -0.18, col: neutral, a: light ? 0.5 : 0.62 },
      { rx: 0.78, ry: 0.92, spd: -0.0044, tilt: 0.42, col: neutral, a: light ? 0.4 : 0.5 },
      { rx: 0.62, ry: 0.5, spd: 0.009, tilt: 1.15, col: amber, a: light ? 0.55 : 0.72 },
    ];
    // Particelle orbitanti (poche, luminose) distribuite sugli anelli.
    const sats = Array.from({ length: 5 }, (_, i) => ({ orbit: i % orbits.length, ph: Math.random() * Math.PI * 2, sp: 0.5 + Math.random() * 0.9 }));

    // Signal ring ondulato attorno alla sfera (la "voce" resa visibile).
    const wavePath = (baseR: number, amp: number, k: number, phase: number) => {
      ctx.beginPath();
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const r = baseR + amp * Math.sin(k * a + phase) + amp * 0.4 * Math.sin(k * 2 * a - phase * 1.3);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const draw = () => {
      const s = stateRef.current;
      energy += (target[s] - energy) * 0.06;
      const dt = 0.016;
      t += dt;
      ang += 0.004 + 0.006 * energy;
      const pulse = 0.5 + 0.5 * Math.sin(t * (1.2 + 1.8 * energy));
      const breathe = 1 + (0.012 + 0.02 * energy) * Math.sin(t * 1.6);
      const R = size * 0.46 * breathe;
      ctx.clearRect(0, 0, W, H);

      // ── 1. Alone volumetrico caldo (respiro) ──
      const halo = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.02);
      halo.addColorStop(0, rgba(terra, (light ? 0.10 : 0.22) * (0.5 + 0.5 * pulse)));
      halo.addColorStop(0.55, rgba(amber, (light ? 0.05 : 0.10) * (0.5 + 0.5 * pulse)));
      halo.addColorStop(1, rgba(amber, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2); ctx.fill();

      // ── 2. Anelli orbitali inclinati (profondità) + satelliti luminosi ──
      orbits.forEach((o) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(o.tilt + ang * o.spd * 12);
        ctx.strokeStyle = rgba(o.col, o.a * (light ? 0.7 : 0.85));
        ctx.lineWidth = 1.1;
        if (!light) { ctx.shadowColor = rgba(o.col, 0.5); ctx.shadowBlur = 6; }
        ctx.beginPath(); ctx.ellipse(0, 0, R * o.rx, R * o.ry, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
      });
      sats.forEach((p) => {
        const o = orbits[p.orbit];
        const th = p.ph + t * p.sp * (0.5 + energy);
        const lx = Math.cos(th) * R * o.rx, ly = Math.sin(th) * R * o.ry;
        const rot = o.tilt + ang * o.spd * 12;
        const x = cx + lx * Math.cos(rot) - ly * Math.sin(rot);
        const y = cy + lx * Math.sin(rot) + ly * Math.cos(rot);
        const depth = 0.5 + 0.5 * Math.sin(th); // davanti = più luminoso
        ctx.fillStyle = rgba(amber, (light ? 0.55 : 0.7) * (0.35 + 0.65 * depth));
        if (!light) { ctx.shadowColor = rgba(amber, 0.9); ctx.shadowBlur = 8 * depth; }
        ctx.beginPath(); ctx.arc(x, y, 1.3 + 1.8 * depth, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      });

      // ── 3. Sfera del nucleo: gradiente con highlight (vetro/gemma) ──
      const sphereR = R * 0.5;
      const sph = ctx.createRadialGradient(cx - sphereR * 0.4, cy - sphereR * 0.45, sphereR * 0.1, cx, cy, sphereR);
      sph.addColorStop(0, sphereHi);
      sph.addColorStop(0.5, sphereMid);
      sph.addColorStop(1, sphereLo);
      ctx.fillStyle = sph; ctx.beginPath(); ctx.arc(cx, cy, sphereR, 0, Math.PI * 2); ctx.fill();
      // Bordo caldo del nucleo
      ctx.strokeStyle = rgba(terra, light ? 0.4 : 0.55); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, sphereR, 0, Math.PI * 2); ctx.stroke();
      // Riflesso speculare (in alto a sinistra)
      const spec = ctx.createRadialGradient(cx - sphereR * 0.42, cy - sphereR * 0.46, 0, cx - sphereR * 0.42, cy - sphereR * 0.46, sphereR * 0.7);
      spec.addColorStop(0, rgba("#FFFFFF", light ? 0.55 : 0.16));
      spec.addColorStop(1, rgba("#FFFFFF", 0));
      ctx.fillStyle = spec; ctx.beginPath(); ctx.arc(cx, cy, sphereR, 0, Math.PI * 2); ctx.fill();

      // ── 4. Signal ring ondulato (la voce) — due tracciati controrotanti ──
      const amp = R * (0.012 + 0.055 * energy) * (0.7 + 0.3 * Math.sin(t * (4 + 6 * energy)));
      wavePath(R * 0.66, amp, 7, t * (0.8 + 1.6 * energy));
      ctx.strokeStyle = rgba(terra, light ? 0.85 : 0.95); ctx.lineWidth = 2.2;
      if (!light) { ctx.shadowColor = rgba(terra, 0.7); ctx.shadowBlur = 10; }
      ctx.stroke(); ctx.shadowBlur = 0;
      wavePath(R * 0.71, amp * 0.7, 11, -t * (0.6 + 1.2 * energy) + 1.7);
      ctx.strokeStyle = rgba(amber, light ? 0.5 : 0.65); ctx.lineWidth = 1.2; ctx.stroke();

      // ── 5. Anello sottile tratteggiato che ruota (fine dettaglio strumentale) ──
      ctx.save();
      ctx.setLineDash([1.5, 8]); ctx.lineDashOffset = -ang * 26;
      ctx.strokeStyle = rgba(focus, light ? 0.22 : 0.3); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.84, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // ── 6. Marker cardinali discreti ──
      for (let i = 0; i < 4; i++) {
        const th = (i / 4) * Math.PI * 2 + ang * 0.3;
        const x = cx + Math.cos(th) * R * 0.92, y = cy + Math.sin(th) * R * 0.92;
        ctx.fillStyle = rgba(neutral, light ? 0.5 : 0.6);
        ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
      }

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, light]);

  return (
    <div className="pointer-events-none relative select-none" style={{ width: size, height: size }} aria-hidden>
      <canvas ref={ref} className="absolute inset-0" />
      <div className="absolute inset-0 grid place-items-center">
        <span
          className="font-display font-bold"
          style={{
            fontSize: Math.round(size * 0.108),
            letterSpacing: "0.18em",
            paddingLeft: "0.18em",
            color: light ? "#2A2620" : "#F3E9DE",
            textShadow: light ? "0 1px 1px rgba(255,255,255,.6)" : "0 0 18px rgba(224,138,91,.4)",
          }}
        >
          XENORA<span style={{ color: light ? "#B65C3C" : "#E08A5B" }}>.</span>
        </span>
      </div>
    </div>
  );
}
