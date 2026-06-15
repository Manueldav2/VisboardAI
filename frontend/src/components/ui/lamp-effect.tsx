"use client";
import { motion } from "motion/react";

interface LampProps {
  children: React.ReactNode;
  className?: string;
  color?: string;
}

export function LampEffect({
  children,
  className = "",
  color = "rgba(212, 166, 74, 0.12)",
}: LampProps) {
  return (
    <div className={`relative flex flex-col items-center overflow-hidden ${className}`}>
      {/* Lamp cone */}
      <div className="relative w-full flex justify-center">
        <motion.div
          initial={{ opacity: 0, width: "8rem" }}
          animate={{ opacity: 1, width: "24rem" }}
          transition={{ delay: 0.2, duration: 0.8, ease: "easeOut" }}
          className="absolute top-0"
          style={{
            height: "200px",
            background: `conic-gradient(from 90deg at 50% 0%, ${color} 0deg, transparent 60deg, transparent 300deg, ${color} 360deg)`,
            filter: "blur(40px)",
          }}
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="absolute top-0 w-40 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, var(--accent), transparent)`,
            boxShadow: `0 0 20px var(--accent), 0 0 60px ${color}`,
          }}
        />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
