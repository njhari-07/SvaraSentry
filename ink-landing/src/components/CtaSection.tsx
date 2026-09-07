import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Radio, ShieldCheck } from "lucide-react";

export const CtaSection: React.FC = () => {
  return (
    <section className="relative z-10 py-28 px-6">
      <div className="max-w-4xl mx-auto text-center relative p-12 sm:p-20 rounded-3xl bg-gradient-to-b from-white/[0.04] to-transparent border border-white/[0.1] backdrop-blur-2xl shadow-[0_0_60px_rgba(0,242,254,0.1)] overflow-hidden">
        {/* Glow ambient background */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-tr from-blue-600/20 to-cyan-500/20 rounded-full blur-3xl pointer-events-none" />

        <motion.span
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-xs font-mono uppercase tracking-widest text-cyan-300 font-semibold"
        >
          DEPLOY IN SECONDS
        </motion.span>

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight mt-4 mb-6 font-sans"
        >
          Architect Your Acoustic Defense.
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="text-white/70 text-base sm:text-lg max-w-xl mx-auto mb-10 leading-relaxed"
        >
          Protect wire transfers, executive authorization calls, and support centers from AI voice cloning
          and synthetic impersonation attacks before damage occurs.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href="http://127.0.0.1:8000/app"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-full text-xs font-mono font-bold tracking-widest uppercase bg-gradient-to-r from-blue-600 via-sky-600 to-cyan-500 text-white shadow-[0_0_30px_rgba(6,182,212,0.5)] hover:shadow-[0_0_45px_rgba(6,182,212,0.7)] transition-all duration-300 hover:scale-[1.03]"
          >
            <ShieldCheck className="w-4 h-4 text-cyan-200" />
            <span>Launch Live Monitor</span>
            <ArrowRight className="w-4 h-4" />
          </a>

          <a
            href="http://127.0.0.1:8000/phone"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-4 rounded-full text-xs font-mono font-semibold tracking-wider uppercase bg-white/[0.05] text-white hover:bg-white/[0.1] border border-white/[0.15] backdrop-blur-md transition-all duration-300 hover:scale-[1.02]"
          >
            <Radio className="w-4 h-4 text-pink-400" />
            <span>Phone Relay Telemetry</span>
          </a>
        </motion.div>
      </div>
    </section>
  );
};

export default CtaSection;
