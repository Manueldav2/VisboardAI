'use client';

import { useEffect, useRef } from 'react';

/**
 * ThoughtField — a slow, living constellation of nodes that drift and
 * link when near. It's the product metaphor made ambient: ideas becoming
 * a connected graph. Deliberately restrained (low opacity, gentle drift)
 * so it reads as atmosphere, never decoration-for-its-own-sake.
 */
export function ThoughtField({ active = false }: { active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    type Node = { x: number; y: number; vx: number; vy: number; r: number; hue: string };
    let nodes: Node[] = [];

    const GOLD = 'rgba(212,166,74,';
    const BLUE = 'rgba(90,159,212,';
    const CREAM = 'rgba(221,217,207,';
    const palette = [GOLD, GOLD, BLUE, CREAM];

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(46, Math.round((w * h) / 26000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: Math.random() * 1.6 + 0.6,
        hue: palette[(Math.random() * palette.length) | 0],
      }));
    };
    build();

    const ro = new ResizeObserver(build);
    ro.observe(canvas);

    let raf = 0;
    let t = 0;
    const LINK = 132;

    const frame = () => {
      t += 1;
      ctx.clearRect(0, 0, w, h);
      const speed = activeRef.current ? 1.9 : 1;

      // links
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < LINK) {
            const o = (1 - d / LINK) * (activeRef.current ? 0.22 : 0.13);
            ctx.strokeStyle = `${GOLD}${o})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // nodes
      for (const n of nodes) {
        if (!reduced) {
          n.x += n.vx * speed;
          n.y += n.vy * speed;
          if (n.x < 0 || n.x > w) n.vx *= -1;
          if (n.y < 0 || n.y > h) n.vy *= -1;
        }
        const pulse = activeRef.current ? 0.5 + 0.35 * Math.sin(t * 0.05 + n.x) : 0.4;
        ctx.fillStyle = `${n.hue}${pulse})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduced) raf = requestAnimationFrame(frame);
    };
    frame();
    if (reduced) { /* draw one static frame only */ }

    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduced) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: 'none' }}
    />
  );
}
