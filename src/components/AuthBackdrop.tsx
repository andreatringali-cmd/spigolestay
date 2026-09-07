"use client";

// Sfondo della pagina di accesso: una rete di nodi che si collegano fra loro.
// Metafora dei "canali" che si sincronizzano (Channel Manager). Tinte sobrie, movimento lento.
import { useEffect, useRef } from "react";

export default function AuthBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);

    let w = 0, h = 0;
    type Node = { x: number; y: number; vx: number; vy: number; accent: boolean };
    let nodes: Node[] = [];

    const count = () => Math.min(70, Math.max(26, Math.round((w * h) / 24000)));
    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = count();
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        accent: Math.random() < 0.13,
      }));
    };
    resize();

    const LINK = 158; // distanza massima per tracciare una connessione
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      // Connessioni
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < LINK) {
            const al = (1 - d / LINK) * 0.15;
            ctx.strokeStyle = `rgba(92,106,130,${al})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      // Nodi
      for (const p of nodes) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.accent ? 2.5 : 1.7, 0, Math.PI * 2);
        ctx.fillStyle = p.accent ? "rgba(176,74,44,0.55)" : "rgba(64,78,102,0.42)";
        ctx.fill();
        if (!reduce) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();

    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
