"use client";
import { useRef, useState } from "react";

interface GradientBorderProps {
  children: React.ReactNode;
  className?: string;
  gradientColor?: string;
  borderRadius?: string;
}

export function GradientBorder({
  children,
  className = "",
  gradientColor = "var(--accent)",
  borderRadius = "var(--radius-lg)",
}: GradientBorderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setAngle(Math.atan2(y, x) * (180 / Math.PI) + 180);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={`relative p-[1px] ${className}`}
      style={{ borderRadius }}
    >
      <div
        className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500"
        style={{
          borderRadius,
          background: `conic-gradient(from ${angle}deg, transparent 0%, ${gradientColor} 10%, transparent 20%)`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          borderRadius,
          background: "var(--border-subtle)",
        }}
      />
      <div
        className="relative z-10"
        style={{
          borderRadius,
          background: "var(--surface)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
