// The portal's night sky (Aryan, 18 Nov: "make it premium: thickness, gravity"): a sun with the
// company's departments in orbit, drawn on a canvas in 3D. The orbits lie on a tilted disk; a
// band of glowing dust turns at Kepler's speeds (the inner faster), so the whole thing has weight;
// what passes behind the sun is hidden by it; near things are bigger and brighter; each planet's
// lit side faces the sun. The mouse tilts it a little. It stops when off screen and stays still for
// people who ask for less motion.

import { useEffect, useRef } from "react";

type Planet = { name: string; r: number; size: number; rgb: [number, number, number]; light: string; at: number; ring?: boolean; moon?: boolean };

const PLANETS: Planet[] = [
  { name: "Orders", r: 0.25, size: 7, rgb: [52, 178, 97], light: "#c9f7d8", at: 0.6 },
  { name: "Money", r: 0.38, size: 9, rgb: [139, 92, 246], light: "#e4d8ff", at: 2.4 },
  { name: "Stock", r: 0.53, size: 11, rgb: [245, 165, 36], light: "#fff0c4", at: 4.1, ring: true },
  { name: "Delivery", r: 0.77, size: 8.5, rgb: [255, 107, 74], light: "#ffd9cf", at: 1.2 },
  { name: "People", r: 0.95, size: 12.5, rgb: [59, 130, 246], light: "#d6e6ff", at: 5.3, moon: true },
];

/** One turn of the outermost orbit, in seconds; the rest follow Kepler (period ∝ r^1.5). */
const OUTER_TURN = 120;
const omega = (r: number) => ((2 * Math.PI) / OUTER_TURN) * r ** -1.5;

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The dust: a wide warm disk, thicker near the sun, and a belt between Stock and Delivery. */
function makeDust() {
  const random = seeded(1811);
  const gauss = () => (random() + random() + random() - 1.5) / 1.5;
  const count = 3400;
  const r = new Float32Array(count);
  const angle = new Float32Array(count);
  const lift = new Float32Array(count);
  const size = new Float32Array(count);
  const glow = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const belt = i < 1000;
    const rr = belt ? 0.62 + random() * 0.1 : 0.12 + random() ** 0.85 * 0.98;
    r[i] = rr;
    angle[i] = random() * Math.PI * 2;
    lift[i] = gauss() * (belt ? 0.012 : 0.03 * (1.15 - rr));
    size[i] = belt ? 0.5 + random() * 1.1 : 0.4 + random() * 0.9;
    glow[i] = 0.25 + random() * 0.6;
  }
  return { count, r, angle, lift, size, glow };
}

const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`;
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const WARM: [number, number, number] = [255, 196, 128];
const COOL: [number, number, number] = [160, 178, 255];
const DUST_TONES = Array.from({ length: 8 }, (_, i) => rgba(mix(WARM, COOL, i / 7), 1));

export function Cosmos() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dust = makeDust();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let running = false;
    let last = performance.now();
    let clock = 40; // start mid-turn so the disk is already spread
    const tilt = { now: 0.3, want: 0.3, shift: 0, shiftWant: 0 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2 + tilt.shift;
      const cy = height * 0.5;
      const R = Math.min(width * 0.46, (height * 0.5 - 44) / tilt.now);
      const scale = Math.max(0.55, R / 640);
      const sunR = Math.max(16, R * 0.07);
      // A point on the disk at radius r (0..1 of R), angle a, lifted by h: screen x, y and depth (-1 back, 1 front).
      const place = (r: number, a: number, h = 0) => {
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const depth = z;
        const grow = 1 + depth * 0.06;
        return { x: cx + x * R * grow, y: cy + z * R * tilt.now - h * R, depth };
      };

      const drawOrbits = (front: boolean) => {
        for (const planet of PLANETS) {
          const steps = 160;
          ctx.beginPath();
          let pen = false;
          for (let s = 0; s <= steps; s++) {
            const a = (s / steps) * Math.PI * 2;
            const p = place(planet.r, a);
            if (p.depth >= 0 === front) {
              if (pen) ctx.lineTo(p.x, p.y);
              else ctx.moveTo(p.x, p.y);
              pen = true;
            } else pen = false;
          }
          if (front) {
            ctx.strokeStyle = "rgba(255,226,196,0.05)";
            ctx.lineWidth = 5;
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,236,214,0.26)";
            ctx.lineWidth = 1.3;
          } else {
            ctx.strokeStyle = "rgba(255,236,214,0.09)";
            ctx.lineWidth = 1;
          }
          ctx.stroke();
        }
      };

      const drawDust = (front: boolean) => {
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < dust.count; i++) {
          const r = dust.r[i] as number;
          const a = (dust.angle[i] as number) + omega(r) * clock;
          const z = Math.sin(a) * r;
          if (z >= 0 !== front) continue;
          const p = place(r, a, dust.lift[i] as number);
          // Hide what is behind the sun.
          if (!front && (p.x - cx) ** 2 + (p.y - cy) ** 2 < sunR * sunR) continue;
          const tone = Math.min(7, Math.floor(r * 8));
          ctx.fillStyle = DUST_TONES[tone] as string;
          ctx.globalAlpha = (dust.glow[i] as number) * (front ? 0.95 : 0.5) * (1.15 - r * 0.45);
          const s = (dust.size[i] as number) * Math.max(1, scale * 1.35) * (front ? 1.2 : 0.95);
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      };

      const drawSun = () => {
        const pulse = 1 + Math.sin(clock * 0.9) * 0.012;
        ctx.globalCompositeOperation = "lighter";
        let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sunR * 9);
        g.addColorStop(0, "rgba(255,150,70,0.30)");
        g.addColorStop(0.35, "rgba(243,107,33,0.10)");
        g.addColorStop(1, "rgba(243,107,33,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - sunR * 9, cy - sunR * 9, sunR * 18, sunR * 18);
        g = ctx.createRadialGradient(cx, cy, sunR * 0.8, cx, cy, sunR * 2.6 * pulse);
        g.addColorStop(0, "rgba(255,190,110,0.75)");
        g.addColorStop(0.4, "rgba(255,140,60,0.22)");
        g.addColorStop(1, "rgba(255,120,40,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, sunR * 2.6 * pulse, 0, Math.PI * 2);
        ctx.fill();
        // The lens streak.
        g = ctx.createLinearGradient(cx - R * 0.7, 0, cx + R * 0.7, 0);
        g.addColorStop(0, "rgba(255,230,200,0)");
        g.addColorStop(0.5, "rgba(255,236,214,0.55)");
        g.addColorStop(1, "rgba(255,230,200,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - R * 0.7, cy - 0.75, R * 1.4, 1.5);
        ctx.globalCompositeOperation = "source-over";
        g = ctx.createRadialGradient(cx - sunR * 0.25, cy - sunR * 0.3, sunR * 0.05, cx, cy, sunR * pulse);
        g.addColorStop(0, "#fffef9");
        g.addColorStop(0.35, "#fff0c8");
        g.addColorStop(0.7, "#ffb766");
        g.addColorStop(1, "#f36b21");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, sunR * pulse, 0, Math.PI * 2);
        ctx.fill();
      };

      const planetAt = (planet: Planet) => {
        const a = planet.at + omega(planet.r) * clock;
        return { planet, a, ...place(planet.r, a) };
      };

      const drawPlanet = ({ planet, x, y, depth, a }: ReturnType<typeof planetAt>) => {
        const sz = planet.size * scale * (1 + depth * 0.22);
        const toSun = Math.atan2(cy - y, cx - x);
        const lx = Math.cos(toSun);
        const ly = Math.sin(toSun);
        const bright = 0.75 + depth * 0.25;
        // Atmosphere.
        ctx.globalCompositeOperation = "lighter";
        const halo = ctx.createRadialGradient(x, y, sz * 0.8, x, y, sz * 2.6);
        halo.addColorStop(0, rgba(planet.rgb, 0.28 * bright));
        halo.addColorStop(1, rgba(planet.rgb, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, sz * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        const ring = (half: "back" | "front") => {
          if (!planet.ring) return;
          ctx.beginPath();
          ctx.ellipse(x, y, sz * 2.3, sz * 0.62, -0.18, half === "back" ? Math.PI : 0, half === "back" ? Math.PI * 2 : Math.PI);
          ctx.strokeStyle = `rgba(255,232,180,${0.55 * bright})`;
          ctx.lineWidth = Math.max(1.2, sz * 0.18);
          ctx.stroke();
        };
        ring("back");
        // The sphere, lit from the sun's side.
        const body = ctx.createRadialGradient(x + lx * sz * 0.45, y + ly * sz * 0.45, sz * 0.08, x, y, sz * 1.02);
        body.addColorStop(0, planet.light);
        body.addColorStop(0.42, rgba(planet.rgb, 1));
        body.addColorStop(0.85, rgba(mix(planet.rgb, [6, 7, 13], 0.7), 1));
        body.addColorStop(1, "#05060b");
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
        // A thin lit rim on the sun's side.
        ctx.beginPath();
        ctx.arc(x, y, sz - 0.4, toSun - 1.1, toSun + 1.1);
        ctx.strokeStyle = "rgba(255,240,220,0.55)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ring("front");
        if (planet.moon) {
          const m = a * 4.2 + clock * 0.9;
          const mx = x + Math.cos(m) * sz * 2.1;
          const my = y + Math.sin(m) * sz * 0.7;
          ctx.fillStyle = "#cfd6e6";
          ctx.beginPath();
          ctx.arc(mx, my, Math.max(1.4, sz * 0.2), 0, Math.PI * 2);
          ctx.fill();
        }
        // The name, quiet and upright.
        ctx.font = `500 ${Math.round(10 + scale * 1.5)}px "Inter Variable", Inter, sans-serif`;
        if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "2.5px";
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(255,255,255,${0.45 + bright * 0.3})`;
        ctx.fillText(planet.name.toUpperCase(), x, y + sz + 20 + (planet.ring ? sz * 0.2 : 0));
      };

      const planets = PLANETS.map(planetAt).sort((p, q) => p.depth - q.depth);
      drawOrbits(false);
      drawDust(false);
      for (const p of planets) if (p.depth < 0) drawPlanet(p);
      drawSun();
      drawOrbits(true);
      drawDust(true);
      for (const p of planets) if (p.depth >= 0) drawPlanet(p);
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      tilt.now += (tilt.want - tilt.now) * 0.04;
      tilt.shift += (tilt.shiftWant - tilt.shift) * 0.04;
      draw();
      if (running) frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (running || still) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    resize();
    draw();
    const sized = new ResizeObserver(() => {
      resize();
      draw();
    });
    sized.observe(canvas);
    const seen = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()));
    seen.observe(canvas);
    const move = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const mx = (event.clientX - box.left) / box.width - 0.5;
      const my = (event.clientY - box.top) / box.height - 0.5;
      tilt.want = 0.3 + my * 0.1;
      tilt.shiftWant = mx * -24;
    };
    canvas.parentElement?.addEventListener("pointermove", move);
    return () => {
      stop();
      sized.disconnect();
      seen.disconnect();
      canvas.parentElement?.removeEventListener("pointermove", move);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Orders, money, stock, delivery and people in orbit around one record"
      className="block h-full w-full"
    />
  );
}
