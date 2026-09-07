"use client";
import { useState } from "react";

export default function GlassUI() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    setOffset({ x: dx * 18, y: dy * 14 });
  };

  const handleMouseLeave = () => {
    setOffset({ x: 0, y: 0 });
  };

  return (
    <section
      id="glass"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative min-h-[120vh] flex items-center justify-center px-6 py-24 z-10"
    >
      <div
        className="relative max-w-2xl w-full p-8 sm:p-14 rounded-3xl border border-white/20 bg-neutral-900/40 backdrop-blur-2xl shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)] transition-transform duration-200 ease-out"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
      >
        <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-cyan-400 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          Telemetry HUD
        </div>

        <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight text-white leading-tight">
          Enterprise defense, floating on the{" "}
          <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">
            waveform.
          </span>
        </h2>

        <p className="text-neutral-300 mt-4 text-sm sm:text-base leading-relaxed">
          Frosted glass telemetry panels, crisp audio diagnostics, real-time spectral dispersion. Monitor call risk scores live while acoustic waves breathe behind it &mdash; zero distraction, complete situational awareness.
        </p>

        <div className="flex gap-8 sm:gap-12 mt-8 pt-8 border-t border-white/10 flex-wrap">
          <div>
            <div className="text-3xl sm:text-4xl font-semibold tracking-tight bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              AA
            </div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-neutral-400 mt-1">
              Enterprise Compliance
            </div>
          </div>
          <div>
            <div className="text-3xl sm:text-4xl font-semibold tracking-tight bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              &lt;28ms
            </div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-neutral-400 mt-1">
              Decision Latency
            </div>
          </div>
          <div>
            <div className="text-3xl sm:text-4xl font-semibold tracking-tight bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              0
            </div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-neutral-400 mt-1">
              Audio Payloads Stored
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
