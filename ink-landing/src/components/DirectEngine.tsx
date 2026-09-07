import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

const PRESETS = [
  {
    name: "Sentry",
    desc: "Tight, vivid cobalt defense filaments — the signature shield look.",
    curl: 18,
    force: 3800,
    bloom: 0.85,
    fade: 0.74,
  },
  {
    name: "Radar",
    desc: "Slow, high-contrast monochrome sonar — anomaly spike isolation.",
    curl: 6,
    force: 2600,
    bloom: 0.34,
    fade: 0.93,
  },
  {
    name: "Spectrogram",
    desc: "Luminous electric cyan and neon — vocal tract harmonic inspection.",
    curl: 32,
    force: 5400,
    bloom: 1.28,
    fade: 0.68,
  },
  {
    name: "BonaFide",
    desc: "Gentle organic emerald and teal drift — verified human voice resonance.",
    curl: 11,
    force: 2000,
    bloom: 0.55,
    fade: 0.82,
  },
];

export default function DirectEngine() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  return (
    <section ref={sectionRef} id="direct" className="relative h-[380vh] z-10">
      <div className="sticky top-0 h-screen overflow-hidden flex flex-col justify-center px-6 sm:px-12 max-w-7xl mx-auto">
        <div className="font-mono text-xs uppercase tracking-widest text-cyan-400 mb-6">
          Direct the Engine &mdash; With Your Scroll
        </div>

        {/* Dynamic Preset Name */}
        <div className="overflow-hidden">
          <h2 className="text-6xl sm:text-9xl font-semibold tracking-tighter bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">
            {PRESETS[0].name}
          </h2>
        </div>

        <p className="text-neutral-300 mt-4 text-base sm:text-xl max-w-xl">
          {PRESETS[0].desc}
        </p>

        {/* Live Parameter Telemetry Bars */}
        <div className="mt-8 max-w-md p-6 rounded-2xl border border-white/15 bg-neutral-950/70 backdrop-blur-xl shadow-2xl flex flex-col gap-4">
          <div>
            <div className="flex justify-between font-mono text-xs text-neutral-400 mb-1.5">
              <span>VORTICITY</span>
              <span className="text-white">18</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                style={{ scaleX: useTransform(scrollYProgress, [0, 1], [0.45, 0.9]) }}
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 origin-left"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between font-mono text-xs text-neutral-400 mb-1.5">
              <span>SPLAT FORCE</span>
              <span className="text-white">3800</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                style={{ scaleX: useTransform(scrollYProgress, [0, 1], [0.63, 0.35]) }}
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 origin-left"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between font-mono text-xs text-neutral-400 mb-1.5">
              <span>BLOOM GAIN</span>
              <span className="text-white">0.85</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                style={{ scaleX: useTransform(scrollYProgress, [0, 1], [0.6, 0.95]) }}
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 origin-left"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between font-mono text-xs text-neutral-400 mb-1.5">
              <span>DISSIPATION DECAY</span>
              <span className="text-white">0.74</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                style={{ scaleX: useTransform(scrollYProgress, [0, 1], [0.74, 0.5]) }}
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 origin-left"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
