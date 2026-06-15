"use client";
import { useRef, useEffect, useState } from "react";

interface MovingBorderProps {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  borderColor?: string;
  duration?: number;
}

export function MovingBorder({
  children,
  className = "",
  containerClassName = "",
  borderColor = "var(--accent)",
  duration = 4000,
}: MovingBorderProps) {
  const pathRef = useRef<SVGRectElement>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let start: number;
    let animationId: number;

    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const totalLength = pathRef.current?.getTotalLength() || 1;
      setOffset((elapsed / duration) * totalLength % totalLength);
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [duration]);

  return (
    <div className={`relative ${containerClassName}`}>
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ overflow: "visible" }}
      >
        <rect
          ref={pathRef}
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx="14"
          ry="14"
          fill="none"
          stroke={borderColor}
          strokeWidth="2"
          strokeDasharray="80 400"
          strokeDashoffset={-offset}
          strokeLinecap="round"
          opacity="0.6"
        />
      </svg>
      <div className={className}>{children}</div>
    </div>
  );
}
