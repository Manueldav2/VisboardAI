"use client";
import { useEffect, useRef } from "react";

export function BackgroundBeams({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resize();
    window.addEventListener("resize", resize);

    const beams = Array.from({ length: 6 }, (_, i) => ({
      x: Math.random() * canvas.offsetWidth,
      speed: 0.2 + Math.random() * 0.3,
      width: 1 + Math.random() * 2,
      offset: Math.random() * Math.PI * 2,
      hue: i % 2 === 0 ? "212, 166, 74" : "90, 159, 212",
      opacity: 0.04 + Math.random() * 0.06,
    }));

    const animate = () => {
      time += 0.005;
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

      beams.forEach((beam) => {
        const x =
          beam.x + Math.sin(time * beam.speed + beam.offset) * 100;

        const gradient = ctx.createLinearGradient(x, 0, x, canvas.offsetHeight);
        gradient.addColorStop(0, `rgba(${beam.hue}, 0)`);
        gradient.addColorStop(0.3, `rgba(${beam.hue}, ${beam.opacity})`);
        gradient.addColorStop(0.7, `rgba(${beam.hue}, ${beam.opacity * 0.5})`);
        gradient.addColorStop(1, `rgba(${beam.hue}, 0)`);

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + beam.width, 0);
        ctx.lineTo(x + beam.width + 40, canvas.offsetHeight);
        ctx.lineTo(x + 40, canvas.offsetHeight);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
