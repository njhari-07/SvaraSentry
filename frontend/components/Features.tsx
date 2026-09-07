"use client";
import React from "react";
import { motion } from "framer-motion";
import { Cpu, Radio, ShieldAlert, Lock } from "lucide-react";

const features = [
  {
    icon: Cpu,
    num: "01",
    title: "Attentive Wav2Vec2 Encoder",
    desc: "A fine-tuned transformer encoder with an attentive classification head trained to isolate synthetic vocoder phase distortion, micro-jitter, and neural voice cloning signatures.",
    badge: "Neural Anti-Spoofing",
  },
  {
    icon: Radio,
    num: "02",
    title: "Tri-Channel Audio Ingress",
    desc: "Ingest live audio seamlessly via your browser microphone, pre-recorded audio files, or our mobile phone relay using an instant paired session ID.",
    badge: "PCM 16 kHz Mono",
  },
  {
    icon: ShieldAlert,
    num: "03",
    title: "Explainable Risk Guidance",
    desc: "Delivers transparent operator intelligence: deepfake probability percentage, smoothed alert status (LOW, CAUTION, HIGH), Mel-spectrograms, and model-attention temporal regions.",
    badge: "Human-in-the-Loop",
  },
  {
    icon: Lock,
    num: "04",
    title: "100% Ephemeral In-Memory Privacy",
    desc: "Audio buffers are evaluated in volatile RAM and discarded immediately. No raw voice recordings are stored on disk, preserving strict banking and privacy compliance.",
    badge: "Zero Disk Footprint",
  },
];

export const Features: React.FC = () => {
  return (
    <section id="engine" className="relative z-10 py-28 px-6 max-w-7xl mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-2xl mx-auto mb-20">
        <motion.span
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-xs font-mono uppercase tracking-widest text-cyan-400 font-semibold"
        >
          01 // ARCHITECTURAL CAPABILITIES
        </motion.span>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-3 mb-4 font-sans"
        >
          Engineered for Continuous Precision
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="text-white/60 text-base sm:text-lg leading-relaxed"
        >
          Four cohesive defense layers synchronizing real-time stream normalization, neural spectral
          analysis, and instantaneous threat alerts.
        </motion.p>
      </div>

      {/* Bento Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((item, index) => {
          const Icon = item.icon;
          return (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.15 }}
              className="group relative p-8 sm:p-10 rounded-3xl bg-white/[0.025] border border-white/[0.08] hover:border-cyan-400/40 backdrop-blur-2xl transition-all duration-500 overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:shadow-[0_20px_50px_rgba(0,242,254,0.12)] hover:-translate-y-1"
            >
              {/* Radial Hover Glow */}
              <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl group-hover:bg-violet-500/20 transition-all duration-500 pointer-events-none" />

              <div className="flex items-center justify-between mb-8">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-cyan-300 group-hover:scale-110 group-hover:border-cyan-400/40 transition-all duration-300">
                  <Icon className="w-6 h-6" />
                </div>
                <span className="font-mono text-xs font-bold tracking-widest text-white/40">
                  {item.num}
                </span>
              </div>

              <h3 className="text-2xl font-bold text-white tracking-tight mb-3 group-hover:text-cyan-200 transition-colors font-sans">
                {item.title}
              </h3>

              <p className="text-white/70 text-sm sm:text-base leading-relaxed mb-6">
                {item.desc}
              </p>

              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono font-medium text-cyan-300">
                <span>{item.badge}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
};

export default Features;
