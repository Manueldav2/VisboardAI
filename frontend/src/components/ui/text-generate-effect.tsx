"use client";
import { useEffect, useState } from "react";
import { motion, stagger, useAnimate } from "motion/react";

interface TextGenerateEffectProps {
  words: string;
  className?: string;
  delay?: number;
}

export function TextGenerateEffect({
  words,
  className = "",
  delay = 0,
}: TextGenerateEffectProps) {
  const [scope, animate] = useAnimate();
  const [started, setStarted] = useState(false);
  const wordsArray = words.split(" ");

  useEffect(() => {
    const timer = setTimeout(() => {
      setStarted(true);
      animate(
        "span",
        { opacity: 1, filter: "blur(0px)" },
        { duration: 0.4, delay: stagger(0.05) }
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [animate, delay]);

  return (
    <div ref={scope} className={className}>
      {wordsArray.map((word, idx) => (
        <motion.span
          key={`${word}-${idx}`}
          className="inline-block"
          style={{
            opacity: started ? undefined : 0,
            filter: started ? undefined : "blur(8px)",
          }}
        >
          {word}&nbsp;
        </motion.span>
      ))}
    </div>
  );
}
