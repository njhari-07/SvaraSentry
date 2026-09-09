"use client";
export default function Showcase() {
  return (
    <section id="showcase" className="relative py-24 sm:py-36 px-6 sm:px-12 max-w-7xl mx-auto z-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-cyan-400 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee]" />
            The Platform
          </div>
          <h2 className="text-3xl sm:text-5xl font-medium tracking-tight text-white">
            One acoustic stream. <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">Continuous</span> defense.
          </h2>
        </div>
        <p className="text-neutral-400 max-w-md text-sm sm:text-base leading-relaxed">
          Evaluating live telephony &amp; microphone PCM &mdash; zero delay. Move your cursor anywhere to perturb the acoustic defense field.
        </p>
      </div>

      <div className="relative mt-8">
        {/* Terminal / Monitor Window */}
        <div className="relative rounded-2xl overflow-hidden border border-white/15 bg-neutral-950/60 backdrop-blur-xl shadow-2xl h-[360px] sm:h-[480px]">
          {/* Window Bar */}
          <div className="flex items-center gap-2 px-4 py-3 bg-white/[0.04] border-b border-white/10">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
            <span className="mx-auto font-mono text-xs text-neutral-400 bg-white/5 px-4 py-1 rounded-md">
              chhayaswara.app / live-telemetry
            </span>
          </div>

          {/* Window Body with Scanline and Grid */}
          <div className="relative h-[calc(100%-45px)] overflow-hidden flex items-center justify-center">
            {/* Grid */}
            <div className="absolute inset-0 opacity-40 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:44px_44px]" />
            {/* Scanline */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/5 to-transparent pointer-events-none animate-pulse" />
            
            {/* Giant Watermark */}
            <div className="font-bold tracking-tighter text-7xl sm:text-9xl text-white/[0.05] select-none">
              SWARA<span className="text-cyan-500/30">.</span>
            </div>

            {/* Bottom HUD bar */}
            <div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-6 py-3 bg-gradient-to-t from-black/80 to-transparent">
              <span className="font-mono text-xs text-neutral-400">
                3.0s window &middot; 16kHz PCM &middot; Wav2Vec2 Encoders
              </span>
              <span className="inline-flex items-center gap-2 font-mono text-xs text-cyan-300 border border-cyan-500/30 bg-cyan-950/40 px-3 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                60 FPS LIVE
              </span>
            </div>
          </div>
        </div>

        {/* Floating Glass Annotation Cards */}
        <div className="sm:absolute -top-4 -left-4 mt-4 sm:mt-0 max-w-xs p-4 rounded-xl border border-white/15 bg-neutral-900/80 backdrop-blur-xl shadow-xl">
          <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">Classifier</div>
          <div className="text-sm font-medium text-white mt-1">Wav2Vec2 + CQT</div>
          <div className="text-xs text-neutral-400 mt-0.5">Stable dual-path spectral feature extraction</div>
        </div>

        <div className="sm:absolute top-1/3 -right-4 mt-4 sm:mt-0 max-w-xs p-4 rounded-xl border border-white/15 bg-neutral-900/80 backdrop-blur-xl shadow-xl">
          <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">Confidence</div>
          <div className="text-sm font-medium text-white mt-1">99.4% ROC-AUC</div>
          <div className="text-xs text-neutral-400 mt-0.5">Forensic spoof vs bona fide evaluation</div>
        </div>

        <div className="sm:absolute -bottom-4 left-1/4 mt-4 sm:mt-0 max-w-xs p-4 rounded-xl border border-white/15 bg-neutral-900/80 backdrop-blur-xl shadow-xl">
          <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">Latency</div>
          <div className="text-sm font-medium text-white mt-1">&lt; 28 ms</div>
          <div className="text-xs text-neutral-400 mt-0.5">Single-frame neural inference on consumer GPUs</div>
        </div>
      </div>
    </section>
  );
}
