"use client";
import { useEffect, useRef } from "react";

interface BlobCursorProps {
  color?: string;
  size?: number;
}

export function BlobCursor({
  color = "rgba(212, 166, 74, 0.08)",
  size = 300,
}: BlobCursorProps) {
  const blobRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const blob = blobRef.current;
    if (!blob) return;

    let mouseX = 0;
    let mouseY = 0;
    let blobX = 0;
    let blobY = 0;
    let animId: number;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const animate = () => {
      blobX += (mouseX - blobX) * 0.08;
      blobY += (mouseY - blobY) * 0.08;
      blob.style.transform = `translate(${blobX - size / 2}px, ${blobY - size / 2}px)`;
      animId = requestAnimationFrame(animate);
    };

    window.addEventListener("mousemove", handleMouseMove);
    animId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animId);
    };
  }, [size]);

  return (
    <div
      ref={blobRef}
      className="fixed top-0 left-0 pointer-events-none z-0"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color}, transparent 60%)`,
        filter: "blur(40px)",
      }}
    />
  );
}
