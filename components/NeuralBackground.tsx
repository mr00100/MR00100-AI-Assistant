"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/client/store";

type Node = { x: number; y: number; vx: number; vy: number; r: number; energy: number };
type Packet = { a: number; b: number; t: number; speed: number };
type Drop = { x: number; y: number; speed: number; chars: string[]; head: number };

const GLYPHS = "01ACDEF3579{}<>/\\|-+=#$%&*".split("");

export default function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ aiState: "idle", quality: "high", intensity: 0, particles: 0.7, effects: true, rain: true });

  const aiState = useStore((s) => s.aiState);
  const quality = useStore((s) => s.quality);
  const intensity = useStore((s) => s.intensity);
  const particleDensity = useStore((s) => s.settings.particleDensity);
  const backgroundEffects = useStore((s) => s.settings.backgroundEffects);
  const matrixRain = useStore((s) => s.settings.matrixRain);
  const setFps = useStore((s) => s.setFps);

  stateRef.current = {
    aiState,
    quality,
    intensity,
    particles: particleDensity,
    effects: backgroundEffects,
    rain: matrixRain,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    let packets: Packet[] = [];
    let drops: Drop[] = [];
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsClock = performance.now();

    const accent = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--mr-accent").trim() ||
      "0, 255, 170";

    const build = () => {
      const q = stateRef.current.quality;
      const densityFactor = q === "low" ? 0.35 : q === "medium" ? 0.65 : 1;
      const count = Math.round(
        Math.min(78, Math.max(14, (w * h) / 26000) * stateRef.current.particles * densityFactor),
      );
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.11,
        vy: (Math.random() - 0.5) * 0.11,
        r: 0.8 + Math.random() * 1.5,
        energy: Math.random(),
      }));
      packets = [];
      const dropCount = q === "low" ? 0 : q === "medium" ? 10 : 20;
      drops = Array.from({ length: dropCount }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        speed: 0.35 + Math.random() * 0.9,
        head: 0,
        chars: Array.from({ length: 8 + Math.floor(Math.random() * 12) }, () => GLYPHS[(Math.random() * GLYPHS.length) | 0]),
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const s = stateRef.current;
      const targetFrameMs = s.quality === "low" ? 50 : s.quality === "medium" ? 33 : 16;
      if (now - last < targetFrameMs) return;
      const dt = Math.min(3, (now - last) / 16.67);
      last = now;

      frames++;
      if (now - fpsClock > 1000) {
        setFps(Math.round((frames * 1000) / (now - fpsClock)));
        frames = 0;
        fpsClock = now;
      }

      ctx.clearRect(0, 0, w, h);
      if (!s.effects) return;

      const rgb = accent();
      const active =
        s.aiState === "thinking" || s.aiState === "speaking" || s.aiState === "executing";
      const boost = 0.5 + s.intensity * 1.4;

      // ---------------------------------------------------------- grid
      ctx.save();
      ctx.strokeStyle = `rgba(${rgb}, 0.035)`;
      ctx.lineWidth = 1;
      const step = 64;
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 0; y <= h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.restore();

      // --------------------------------------------------- matrix rain
      if (s.rain && s.quality !== "low") {
        ctx.save();
        ctx.font = "11px ui-monospace, monospace";
        for (const d of drops) {
          d.y += d.speed * dt * (active ? 2.1 : 1);
          if (d.y > h + 160) {
            d.y = -40 - Math.random() * 200;
            d.x = Math.random() * w;
          }
          for (let i = 0; i < d.chars.length; i++) {
            const alpha = (1 - i / d.chars.length) * 0.15;
            ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
            ctx.fillText(d.chars[i], d.x, d.y - i * 13);
          }
          if (Math.random() < 0.05) d.chars[0] = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
        ctx.restore();
      }

      // -------------------------------------------------- neural links
      const linkDist = s.quality === "low" ? 110 : 150;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx * dt * (active ? 1.8 : 1);
        n.y += n.vy * dt * (active ? 1.8 : 1);
        if (n.x < -20) n.x = w + 20;
        if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20;
        if (n.y > h + 20) n.y = -20;
        n.energy += (Math.sin(now / 900 + i) * 0.5 + 0.5 - n.energy) * 0.02;

        for (let j = i + 1; j < nodes.length; j++) {
          const m = nodes[j];
          const dx = n.x - m.x;
          const dy = n.y - m.y;
          const dist = Math.hypot(dx, dy);
          if (dist < linkDist) {
            const a = (1 - dist / linkDist) * 0.16 * boost;
            ctx.strokeStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
            if (active && packets.length < 26 && Math.random() < 0.0009 * boost) {
              packets.push({ a: i, b: j, t: 0, speed: 0.012 + Math.random() * 0.02 });
            }
          }
        }

        const glow = 0.3 + n.energy * 0.55 * boost;
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(0.9, glow).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // ------------------------------------------------- data packets
      packets = packets.filter((p) => p.t < 1);
      for (const p of packets) {
        p.t += p.speed * dt * (active ? 1.6 : 1);
        const a = nodes[p.a];
        const b = nodes[p.b];
        if (!a || !b) continue;
        const x = a.x + (b.x - a.x) * p.t;
        const y = a.y + (b.y - a.y) * p.t;
        ctx.fillStyle = `rgba(${rgb}, 0.85)`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = `rgba(${rgb}, 0.8)`;
        ctx.beginPath();
        ctx.arc(x, y, 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ------------------------------------------------- scanning line
      if (s.quality === "high") {
        const scanY = ((now / 38) % (h + 300)) - 150;
        const grad = ctx.createLinearGradient(0, scanY - 70, 0, scanY + 70);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, `rgba(${rgb}, 0.035)`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, scanY - 70, w, 140);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [setFps]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    />
  );
}
