import React from "react";
import { motion } from "framer-motion";

const stats = [
  { value: "< 3.0s", label: "Initial Assessment Window", detail: "Overlapping 3s rolling buffer" },
  { value: "99.8%", label: "Synthetic Rejection Rate", detail: "Wav2Vec2 anti-spoofing head" },
  { value: "16 kHz", label: "Standardized Audio Ingress", detail: "PCM mono stream contract" },
  { value: "100%", label: "Ephemeral RAM Processing", detail: "Zero audio stored on disk" },
];

export const StatsBar: React.FC = () => {
  return (
    <section id="stats" className="relative z-10 border-y border-white/[0.08] bg-black/40 backdrop-blur-xl py-12 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            className="flex flex-col items-center"
          >
            <span className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight font-sans">
              {stat.value}
            </span>
            <span className="text-xs font-mono uppercase tracking-widest text-cyan-300 mt-2 font-semibold">
              {stat.label}
            </span>
            <span className="text-[11px] text-white/40 mt-0.5 font-mono">
              {stat.detail}
            </span>
          </motion.div>
        ))}
      </div>
    </section>
  );
};

export default StatsBar;
