"use client";
import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Radio, ShieldAlert } from "lucide-react";
import LiveDemoStrip from "./LiveDemoStrip";

interface HeroProps {
  onLaunchMonitor?: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onLaunchMonitor }) => {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-28 pb-20 z-10">
      {/* Central Soft Blur Scrim to ensure crisp typography over fluid */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[850px] h-[580px] bg-black/50 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* Top Tag Pill */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.12] backdrop-blur-md mb-8 text-xs font-mono uppercase tracking-widest text-cyan-300 shadow-[0_0_15px_rgba(0,242,254,0.15)]"
      >
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#00f2fe]" />
        <span>REAL-TIME AI VOICE-DEEPFAKE RECOGNITION</span>
      </motion.div>

      {/* Main Headline */}
      <motion.h1
        initial={{ opacity: 0, y: 25 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.15 }}
        className="text-5xl sm:text-7xl lg:text-8xl font-extrabold tracking-tight text-white max-w-5xl leading-[1.02] mb-6"
      >
        Intercept AI Voice Clones <br />
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-sky-400 drop-shadow-[0_0_35px_rgba(6,182,212,0.35)]">
          in Real Time.
        </span>
      </motion.h1>

      {/* Subheadline */}
      <motion.p
        initial={{ opacity: 0, y: 25 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.3 }}
        className="text-lg sm:text-xl text-white/75 max-w-3xl font-normal leading-relaxed mb-10"
      >
        Continuous acoustic defense powered by fine-tuned Wav2Vec2 neural encoders. Evaluates overlapping
        three-second speech windows, isolates high-frequency vocoder distortions, and neutralizes
        social engineering attacks before trust is breached.
      </motion.p>

      {/* Action CTAs */}
      <motion.div
        initial={{ opacity: 0, y: 25 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.45 }}
        className="flex flex-col sm:flex-row items-center gap-4 mb-14"
      >
        <button
          onClick={onLaunchMonitor || (() => { window.location.hash = 'dashboard'; })}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-full text-xs font-mono font-bold tracking-widest uppercase bg-gradient-to-r from-blue-600 via-sky-600 to-cyan-500 text-white shadow-[0_0_30px_rgba(37,99,235,0.45)] hover:shadow-[0_0_40px_rgba(6,182,212,0.6)] transition-all duration-300 hover:scale-[1.03] cursor-pointer"
        >
          <ShieldAlert className="w-4 h-4 text-cyan-200" />
          <span>Launch Live Monitor</span>
          <ArrowRight className="w-4 h-4" />
        </button>

        <a
          href="/phone"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-4 rounded-full text-xs font-mono font-semibold tracking-wider uppercase bg-white/[0.05] text-white hover:bg-white/[0.1] border border-white/[0.15] backdrop-blur-md transition-all duration-300 hover:scale-[1.02]"
        >
          <Radio className="w-4 h-4 text-pink-400" />
          <span>Connect Phone Relay</span>
        </a>
      </motion.div>

      {/* Live Interactive Fluid Cue */}
      <LiveDemoStrip />
    </section>
  );
};

export default Hero;
