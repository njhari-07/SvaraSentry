"use client";
import { useState, useEffect, useRef } from "react";

const WORDS = ["Real-time.", "Forensic.", "Unbreakable."];

export default function TrueFocus() {
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const [frameStyle, setFrameStyle] = useState({ left: 0, top: 0, width: 0, height: 0, opacity: 0 });

  useEffect(() => {
    const updatePosition = () => {
      const el = wordsRef.current[activeIdx];
      const container = containerRef.current;
      if (!el || !container) return;
      const cRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setFrameStyle({
        left: elRect.left - cRect.left,
        top: elRect.top - cRect.top,
        width: elRect.width,
        height: elRect.height,
        opacity: 1,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);

    const interval = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % WORDS.length);
    }, 2400);

    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", updatePosition);
    };
  }, [activeIdx]);

  return (
    <section id="focus" className="relative min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-20 z-10">
      <div ref={containerRef} className="relative inline-flex flex-wrap items-center justify-center gap-4 sm:gap-6 p-4">
        {/* Animated Corner Bracket Frame */}
        <div
          className="absolute pointer-events-none transition-all duration-500 ease-out"
          style={{
            transform: `translate(${frameStyle.left}px, ${frameStyle.top}px)`,
            width: `${frameStyle.width}px`,
            height: `${frameStyle.height}px`,
            opacity: frameStyle.opacity,
          }}
        >
          <span className="absolute -top-2 -left-2 w-4 h-4 border-t-2 border-l-2 border-cyan-400 rounded-tl-sm shadow-[0_0_8px_#22d3ee]" />
          <span className="absolute -top-2 -right-2 w-4 h-4 border-t-2 border-r-2 border-cyan-400 rounded-tr-sm shadow-[0_0_8px_#22d3ee]" />
          <span className="absolute -bottom-2 -left-2 w-4 h-4 border-b-2 border-l-2 border-cyan-400 rounded-bl-sm shadow-[0_0_8px_#22d3ee]" />
          <span className="absolute -bottom-2 -right-2 w-4 h-4 border-b-2 border-r-2 border-cyan-400 rounded-br-sm shadow-[0_0_8px_#22d3ee]" />
        </div>

        {WORDS.map((w, idx) => (
          <span
            key={w}
            ref={(el) => { wordsRef.current[idx] = el; }}
            onMouseEnter={() => setActiveIdx(idx)}
            className={`font-semibold tracking-tight text-4xl sm:text-7xl md:text-8xl cursor-pointer transition-all duration-500 ${
              idx === activeIdx
                ? "text-white blur-0 opacity-100 scale-105"
                : "text-neutral-500 blur-[2px] opacity-40 hover:opacity-75"
            }`}
          >
            {w}
          </span>
        ))}
      </div>
      <div className="font-mono text-xs uppercase tracking-widest text-neutral-400 mt-8">
        Three pillars. Zero compromise.
      </div>
    </section>
  );
}
