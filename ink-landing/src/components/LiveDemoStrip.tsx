import React from "react";
import { motion } from "framer-motion";
import { Activity, MousePointer2 } from "lucide-react";

export const LiveDemoStrip: React.FC = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.6 }}
      className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.1] backdrop-blur-md text-xs text-white/70 font-mono shadow-[0_0_15px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-center gap-1.5 text-cyan-400">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
        <span className="font-semibold uppercase tracking-wider text-[10px]">ACOUSTIC RADAR</span>
      </div>
      <span className="text-white/20">|</span>
      <div className="flex items-center gap-2">
        <MousePointer2 className="w-3.5 h-3.5 text-violet-400 animate-bounce" />
        <span>Move cursor or touch to simulate real-time neural phase perturbation</span>
      </div>
      <Activity className="w-3.5 h-3.5 text-cyan-300 hidden sm:inline-block" />
    </motion.div>
  );
};

export default LiveDemoStrip;
