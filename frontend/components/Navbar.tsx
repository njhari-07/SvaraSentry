"use client";
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Radio } from "lucide-react";

interface NavbarProps {
  onLaunchMonitor?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onLaunchMonitor }) => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#05050a]/85 backdrop-blur-xl border-b border-white/[0.08] py-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.7)]"
          : "bg-transparent py-5"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Brand Logo */}
        <a href="/" className="flex items-center gap-3 group">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-2xl tracking-tighter text-white group-hover:text-cyan-300 transition-colors">
              ChhayaSwara
            </span>
            <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_10px_#00f2fe]" />
          </div>
          <span className="hidden sm:inline-block font-mono text-[10px] tracking-widest text-white/40 uppercase border border-white/10 px-2 py-0.5 rounded">
            AI ACOUSTIC DEFENSE
          </span>
        </a>

        {/* Center Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-xs font-mono tracking-wider uppercase text-white/70">
          <a href="#engine" className="hover:text-cyan-300 transition-colors">
            Detection Engine
          </a>
          <a href="#stats" className="hover:text-cyan-300 transition-colors">
            Verification Specs
          </a>
          <a href="#integration" className="hover:text-cyan-300 transition-colors">
            WebSocket API
          </a>
          <a href="/phone" className="hover:text-cyan-300 transition-colors flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-pink-400" />
            <span>Phone Relay</span>
          </a>
        </nav>

        {/* Right Action CTA */}
        <div className="flex items-center gap-4">
          <a
            href="/phone"
            className="hidden sm:inline-flex items-center font-mono text-xs uppercase tracking-wider text-white/70 hover:text-white px-3 py-1.5 transition-colors"
          >
            Relay [PSTN]
          </a>
          <button
            onClick={onLaunchMonitor}
            className="relative group inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-mono font-bold tracking-wider uppercase bg-gradient-to-r from-blue-600 via-sky-600 to-cyan-500 text-white shadow-[0_0_20px_rgba(37,99,235,0.35)] hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] transition-all duration-300 hover:scale-[1.02] cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-cyan-200" />
            <span>Launch Monitor</span>
          </button>
        </div>
      </div>
    </motion.header>
  );
};

export default Navbar;
