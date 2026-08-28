"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fades + rises its children into view when they enter the viewport.
 * Respects prefers-reduced-motion via Tailwind's motion-reduce.
 */
export function ScrollReveal({
  children,
  className = "",
  delay = 0,
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Stagger this reveal by N ms after it enters the viewport. */
  delay?: number;
  /** Reveal once and stay visible (default). Set false to also fade back
   *  out when the content scrolls back out of view — e.g. scrolling up
   *  past a section, mirroring the same fade/rise transition in reverse. */
  once?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [once]);

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        visible
          ? "translate-y-0 opacity-100 blur-0"
          : "translate-y-6 opacity-0 blur-[2px] motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:blur-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}
