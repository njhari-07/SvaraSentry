import React from "react";

export const Footer: React.FC = () => {
  return (
    <footer className="relative z-10 border-t border-white/[0.08] bg-[#030307]/90 py-12 px-6 text-white/50 text-xs font-mono">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-base tracking-tight text-white font-sans">ChhayaSwara</span>
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          <span className="text-white/40 ml-2">AI VOICE DEEPFAKE DEFENSE // 16 KHZ MONO</span>
        </div>

        {/* Links */}
        <div className="flex items-center gap-6">
          <a href="http://127.0.0.1:8000/app" className="hover:text-white transition-colors">
            Live Monitor
          </a>
          <a href="http://127.0.0.1:8000/phone" className="hover:text-white transition-colors">
            Phone Relay
          </a>
          <a href="http://127.0.0.1:8000/health" className="hover:text-white transition-colors">
            Health Check
          </a>
          <a href="http://127.0.0.1:8000/docs" className="hover:text-white transition-colors">
            FastAPI Docs
          </a>
        </div>

        {/* Status & Copyright */}
        <div className="flex items-center gap-4">
          <span className="text-cyan-400 font-semibold">SYSTEM OPERATIONAL // LATENCY &lt; 3.0S</span>
          <span className="text-white/20">|</span>
          <span>© {new Date().getFullYear()} ChhayaSwara.</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
