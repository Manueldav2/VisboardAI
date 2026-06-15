"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface HoverCardItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  link: string;
  color: string;
  glowColor: string;
}

interface HoverEffectProps {
  items: HoverCardItem[];
  className?: string;
}

export function CardHoverEffect({ items, className = "" }: HoverEffectProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-5 ${className}`}>
      {items.map((item, idx) => (
        <div
          key={item.link}
          className="relative group"
          onMouseEnter={() => setHoveredIndex(idx)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <AnimatePresence>
            {hoveredIndex === idx && (
              <motion.span
                className="absolute inset-0 rounded-[var(--radius-lg)] block"
                style={{ background: item.glowColor }}
                layoutId="hoverBg"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.15 } }}
                exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.1 } }}
              />
            )}
          </AnimatePresence>
          <div className="relative z-10">{item.icon}</div>
        </div>
      ))}
    </div>
  );
}
