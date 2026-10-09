"use client";

import { useEffect, useMemo, useRef } from "react";
import { useStore, type ModuleId } from "@/lib/client/store";

/** Coarse 5° land mask: row = latitude band (87.5N → -87.5), spans of columns (lon -180 + col*5). */
const LAND: Record<number, Array<[number, number]>> = {
  1: [[26, 31]],
  2: [[18, 27], [26, 32], [50, 55], [60, 66]],
  3: [[7, 12], [14, 28], [26, 32], [40, 44], [46, 70]],
  4: [[5, 12], [13, 28], [27, 31], [31, 33], [38, 44], [44, 71]],
  5: [[4, 12], [13, 29], [28, 31], [37, 43], [43, 71]],
  6: [[4, 11], [13, 30], [34, 36], [37, 42], [42, 71]],
  7: [[12, 30], [34, 36], [36, 43], [43, 71]],
  8: [[12, 30], [35, 44], [44, 71]],
  9: [[13, 29], [34, 40], [40, 45], [45, 70]],
  10: [[13, 29], [34, 40], [40, 46], [46, 68], [68, 70]],
  11: [[14, 29], [34, 44], [44, 48], [48, 68]],
  12: [[14, 25], [34, 46], [46, 48], [49, 55], [55, 68]],
  13: [[14, 21], [23, 26], [34, 47], [44, 48], [49, 54], [54, 66]],
  14: [[16, 20], [22, 26], [33, 46], [50, 54], [55, 65]],
  15: [[17, 21], [23, 28], [32, 45], [50, 54], [56, 64]],
  16: [[19, 22], [23, 30], [32, 45], [56, 64]],
  17: [[23, 32], [32, 44], [55, 64]],
  18: [[23, 33], [33, 43], [56, 64]],
  19: [[23, 33], [33, 42], [57, 66]],
  20: [[24, 33], [33, 42], [58, 67]],
  21: [[24, 32], [34, 42], [44, 45], [60, 68]],
  22: [[25, 32], [34, 41], [44, 45], [58, 69]],
  23: [[25, 32], [34, 40], [58, 69]],
  24: [[26, 31], [35, 40], [59, 68]],
  25: [[26, 30], [62, 66], [70, 71]],
  26: [[26, 29], [70, 71]],
  27: [[27, 29]],
  28: [[27, 29]],
  30: [[24, 27]],
  31: [[0, 20], [24, 71]],
  32: [[0, 71]],
  33: [[0, 71]],
  34: [[0, 71]],
};

type LandPoint = { lat: number; lon: number };

function buildLand(): LandPoint[] {
  const pts: LandPoint[] = [];
  for (const [rowKey, spans] of Object.entries(LAND)) {
    const row = Number(rowKey);
    const lat = 87.5 - row * 5;
    const stepMul = Math.abs(lat) > 60 ? 2 : 1; // thin out near poles
    for (const [a, b] of spans) {
      for (let c = a; c <= b; c += stepMul) {
        pts.push({ lat, lon: -180 + c * 5 });
        if (Math.abs(lat) < 60) pts.push({ lat: lat - 2.5, lon: -180 + c * 5 + 2.5 });
      }
    }
  }
  return pts;
}

const MODULES: Array<{ id: ModuleId; label: string; orbit: number; speed: number; phase: number }> = [
  { id: "voice", label: "VOICE", orbit: 1.28, speed: 0.00042, phase: 0 },
  { id: "ai", label: "AI", orbit: 1.5, speed: -0.00031, phase: 1.1 },
  { id: "system", label: "SYS", orbit: 1.38, speed: 0.00025, phase: 2.3 },
  { id: "files", label: "FILES", orbit: 1.62, speed: -0.00019, phase: 3.4 },
  { id: "network", label: "NET", orbit: 1.18, speed: 0.00036, phase: 4.6 },
  { id: "developer", label: "DEV", orbit: 1.72, speed: -0.00023, phase: 5.5 },
];

export default function GlobeCore({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const land = useMemo(() => buildLand(), []);
  const ref = useRef({
    aiState: "idle",
    intensity: 0,
    micLevel: 0,
    quality: "high",
    modules: {} as Record<string, boolean>,
    online: true,
  });

  const aiState = useStore((s) => s.aiState);
  const intensity = useStore((s) => s.intensity);
  const micLevel = useStore((s) => s.micLevel);
  const quality = useStore((s) => s.quality);
  const activeModules = useStore((s) => s.activeModules);
  const online = useStore((s) => s.telemetry?.network.online ?? true);

  useEffect(() => {
    ref.current = { aiState, intensity, micLevel, quality, modules: activeModules, online };
  }, [aiState, intensity, micLevel, quality, activeModules, online]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let rot = 0;
    let smooth = 0;
    let last = performance.now();
    const arcs = Array.from({ length: 10 }, () => ({
      a: Math.floor(Math.random() * 1000),
      b: Math.floor(Math.random() * 1000),
      t: Math.random(),
      speed: 0.004 + Math.random() * 0.008,
    }));

    const accent = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--mr-accent").trim() ||
      "0, 255, 170";
    const accent2 = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--mr-accent-2").trim() ||
      "0, 200, 255";

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const project = (lat: number, lon: number, radius: number, rotation: number) => {
      const phi = (lat * Math.PI) / 180;
      const theta = ((lon + rotation) * Math.PI) / 180;
      const x = Math.cos(phi) * Math.sin(theta);
      const y = Math.sin(phi);
      const z = Math.cos(phi) * Math.cos(theta);
      // slight axial tilt
      const tilt = 0.32;
      const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
      const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
      return { x: x * radius, y: -y2 * radius, z: z2 };
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const s = ref.current;
      const targetMs = s.quality === "low" ? 50 : s.quality === "medium" ? 33 : 16;
      if (now - last < targetMs) return;
      const dt = Math.min(3, (now - last) / 16.67);
      last = now;

      const rgb = accent();
      const rgb2 = accent2();
      const cx = w / 2;
      const cy = h / 2;

      const targetIntensity = Math.max(s.intensity, s.micLevel * 0.9);
      smooth += (targetIntensity - smooth) * 0.09 * dt;

      const speaking = s.aiState === "speaking";
      const thinking = s.aiState === "thinking";
      const warn = s.aiState === "warning" || s.aiState === "error";
      const dev = s.aiState === "developer";
      const searching = s.aiState === "searching";
      const success = s.aiState === "success";
      // Idle breathing keeps the core alive without extra CPU cost.
      const breath = s.quality === "low" ? 1 : Math.sin(now / 2600) * 0.01 + 1;

      const baseR = Math.min(w, h) * (compact ? 0.3 : 0.26);
      // The globe visibly EXPANDS when MR00100 speaks, executes, or searches.
      const executing = s.aiState === "executing" || s.aiState === "developer";
      const R = baseR * breath * (1 + smooth * (speaking ? 0.2 : executing ? 0.14 : searching ? 0.12 : 0.09));
      const rotSpeed =
        (searching ? 0.06 : thinking ? 0.055 : speaking ? 0.04 : executing ? 0.05 : dev ? 0.035 : 0.014) * dt;
      rot = (rot + rotSpeed) % 360;

      const warnRgb = warn ? "255, 88, 72" : rgb;

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(cx, cy);

      // ------------------------------------------------- atmosphere glow
      const glowR = R * (1.5 + smooth * 0.4);
      const g = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, glowR);
      g.addColorStop(0, `rgba(${warnRgb}, ${(0.1 + smooth * 0.2).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(${warnRgb}, ${(0.035 + smooth * 0.07).toFixed(3)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, glowR, 0, Math.PI * 2);
      ctx.fill();

      // -------------------------------------------------------- sphere
      ctx.strokeStyle = `rgba(${warnRgb}, ${(0.3 + smooth * 0.4).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();

      // graticule: latitude rings
      const latStep = s.quality === "low" ? 30 : 20;
      for (let lat = -60; lat <= 60; lat += latStep) {
        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 6) {
          const p = project(lat, lon, R, rot);
          if (p.z < 0) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = `rgba(${rgb}, ${(0.07 + smooth * 0.08).toFixed(3)})`;
        ctx.stroke();
      }
      // longitude meridians
      const lonStep = s.quality === "low" ? 45 : 30;
      for (let lon = -180; lon < 180; lon += lonStep) {
        ctx.beginPath();
        let started = false;
        for (let lat = -88; lat <= 88; lat += 5) {
          const p = project(lat, lon, R, rot);
          if (p.z < 0) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = `rgba(${rgb}, ${(0.07 + smooth * 0.08).toFixed(3)})`;
        ctx.stroke();
      }

      // ----------------------------------------------------- continents
      const stride = s.quality === "low" ? 3 : s.quality === "medium" ? 2 : 1;
      const dotSize = Math.max(0.9, R * 0.011);
      for (let i = 0; i < land.length; i += stride) {
        const p = project(land[i].lat, land[i].lon, R, rot);
        if (p.z <= 0.02) continue;
        const a = (0.22 + p.z * 0.55) * (0.7 + smooth * 0.6);
        ctx.fillStyle = `rgba(${warnRgb}, ${Math.min(0.95, a).toFixed(3)})`;
        ctx.fillRect(p.x - dotSize / 2, p.y - dotSize / 2, dotSize, dotSize);
      }

      // -------------------------------------------- network node arcs
      if (s.online && s.quality !== "low") {
        for (const arc of arcs) {
          arc.t += arc.speed * dt * (thinking || speaking ? 2.2 : 1);
          if (arc.t > 1) arc.t = 0;
          const A = land[arc.a % land.length];
          const B = land[arc.b % land.length];
          const pa = project(A.lat, A.lon, R, rot);
          const pb = project(B.lat, B.lon, R, rot);
          if (pa.z <= 0 || pb.z <= 0) continue;
          const mx = (pa.x + pb.x) / 2;
          const my = (pa.y + pb.y) / 2;
          const lift = 1 + 0.32;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.quadraticCurveTo(mx * lift, my * lift, pb.x, pb.y);
          ctx.strokeStyle = `rgba(${rgb2}, ${(0.12 + smooth * 0.2).toFixed(3)})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();

          const t = arc.t;
          const px = (1 - t) * (1 - t) * pa.x + 2 * (1 - t) * t * mx * lift + t * t * pb.x;
          const py = (1 - t) * (1 - t) * pa.y + 2 * (1 - t) * t * my * lift + t * t * pb.y;
          ctx.fillStyle = `rgba(${rgb2}, 0.95)`;
          ctx.shadowBlur = 8;
          ctx.shadowColor = `rgba(${rgb2}, 0.9)`;
          ctx.beginPath();
          ctx.arc(px, py, 1.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // ------------------------------------------------- scanning band
      const scanPhase = (now / (thinking ? 900 : 2400)) % 1;
      const scanY = (scanPhase * 2 - 1) * R;
      const halfChord = Math.sqrt(Math.max(0, R * R - scanY * scanY));
      ctx.strokeStyle = `rgba(${rgb2}, ${(0.18 + smooth * 0.35).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, scanY, halfChord, Math.max(2, halfChord * 0.14), 0, 0, Math.PI * 2);
      ctx.stroke();

      // --------------------------------------------------- orbit rings
      const ringCount = s.quality === "low" ? 2 : 3;
      for (let i = 0; i < ringCount; i++) {
        const rr = R * (1.2 + i * 0.19);
        const tilt = 0.42 + i * 0.26;
        const spin = now * (0.00012 + i * 0.00009) * (thinking || speaking ? 3.2 : 1);
        ctx.save();
        ctx.rotate(spin * (i % 2 === 0 ? 1 : -1));
        ctx.strokeStyle = `rgba(${i % 2 === 0 ? rgb : rgb2}, ${(0.12 + smooth * 0.25).toFixed(3)})`;
        ctx.lineWidth = i === 0 ? 1.4 : 0.8;
        ctx.beginPath();
        ctx.ellipse(0, 0, rr, rr * Math.cos(tilt), 0, 0, Math.PI * 2);
        ctx.stroke();
        // ring tick marks
        if (s.quality === "high") {
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
            const x = Math.cos(a) * rr;
            const y = Math.sin(a) * rr * Math.cos(tilt);
            ctx.fillStyle = `rgba(${rgb}, ${(0.1 + smooth * 0.2).toFixed(3)})`;
            ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
          }
        }
        ctx.restore();
      }

      // ---------------------------------------------- execution ring
      if (s.aiState === "executing" || s.aiState === "developer") {
        const rr = R * 1.08;
        const sweep = (now / 520) % (Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb2}, 0.75)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, rr, sweep, sweep + Math.PI / 2.4);
        ctx.stroke();
      }

      // ------------------------------------------------ searching radar
      if (searching) {
        const sweepAngle = (now / 900) % (Math.PI * 2);
        const radar = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.6);
        radar.addColorStop(0, `rgba(${rgb2}, 0.16)`);
        radar.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = radar;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R * 1.6, sweepAngle, sweepAngle + 0.55);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = `rgba(${rgb2}, 0.65)`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.28, sweepAngle, sweepAngle + 0.7);
        ctx.stroke();
        for (let ring = 1; ring <= 2; ring++) {
          const pulse = ((now / 1100 + ring / 3) % 1);
          ctx.strokeStyle = `rgba(${rgb2}, ${((1 - pulse) * 0.3).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, 0, R * (1 + pulse * 0.45), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ---------------------------------------------------- success pulse
      if (success) {
        for (let i = 0; i < 2; i++) {
          const phase = (now / 1500 + i / 2) % 1;
          ctx.strokeStyle = `rgba(${rgb}, ${((1 - phase) * 0.45).toFixed(3)})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(0, 0, R * (1.05 + phase * 0.4), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ------------------------------------------------ speaking pulse
      if (speaking || s.aiState === "listening") {
        const pulses = speaking ? 3 : 2;
        for (let i = 0; i < pulses; i++) {
          const phase = ((now / 1400 + i / pulses) % 1);
          const rr = R * (1 + phase * (speaking ? 0.7 : 0.4));
          ctx.strokeStyle = `rgba(${rgb}, ${((1 - phase) * (0.25 + smooth * 0.4)).toFixed(3)})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(0, 0, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // -------------------------------------------------- satellites
      for (const mod of MODULES) {
        const on = s.modules[mod.id];
        const angle = now * mod.speed * (thinking ? 2.4 : 1) + mod.phase;
        const rr = R * mod.orbit;
        const tilt = 0.55 + mod.orbit * 0.1;
        const x = Math.cos(angle) * rr;
        const y = Math.sin(angle) * rr * Math.cos(tilt);
        const size = on ? 3.4 : 2;
        ctx.fillStyle = on ? `rgba(${rgb}, 0.95)` : `rgba(${rgb}, 0.32)`;
        if (on) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = `rgba(${rgb}, 0.9)`;
        }
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (on) {
          ctx.strokeStyle = `rgba(${rgb}, 0.35)`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(x, y, size + 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (!compact && s.quality !== "low") {
          ctx.font = "8px ui-monospace, monospace";
          ctx.fillStyle = on ? `rgba(${rgb}, 0.85)` : `rgba(${rgb}, 0.28)`;
          ctx.fillText(mod.label, x + 7, y + 3);
        }
      }

      // --------------------------------------------------- HUD ticks
      if (!compact) {
        ctx.strokeStyle = `rgba(${rgb}, 0.2)`;
        ctx.lineWidth = 1;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
          const r1 = R * 1.86;
          const r2 = R * 1.95;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
          ctx.stroke();
        }
        const arcSpin = now / 4200;
        ctx.strokeStyle = `rgba(${rgb}, ${(0.16 + smooth * 0.22).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.9, arcSpin, arcSpin + 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.9, arcSpin + Math.PI, arcSpin + Math.PI + 0.45);
        ctx.stroke();
      }

      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [land, compact]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}
