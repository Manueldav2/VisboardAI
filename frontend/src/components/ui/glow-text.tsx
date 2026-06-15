"use client";

interface GlowTextProps {
  children: React.ReactNode;
  className?: string;
  color?: string;
}

export function GlowText({
  children,
  className = "",
  color = "var(--accent)",
}: GlowTextProps) {
  return (
    <span
      className={`relative inline-block ${className}`}
      style={{
        color,
        textShadow: `0 0 20px ${color}, 0 0 40px color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
