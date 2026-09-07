export default function SpecsSection() {
  return (
    <section id="spec" className="relative py-24 sm:py-36 px-6 sm:px-12 max-w-7xl mx-auto z-10">
      <div className="font-mono text-xs uppercase tracking-widest text-cyan-400 mb-8">
        Forensic Benchmarks
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 border-t border-white/15">
        <div className="p-6 sm:p-10 border-b border-r border-white/15">
          <div className="text-5xl sm:text-7xl font-medium tracking-tight text-white">
            28<span className="text-xl sm:text-2xl text-cyan-400 font-mono align-super ml-1">ms</span>
          </div>
          <div className="font-mono text-xs uppercase tracking-wider text-neutral-400 mt-4">
            Inference Latency
          </div>
          <div className="h-1 w-full bg-white/10 rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-cyan-400 w-[85%]" />
          </div>
        </div>

        <div className="p-6 sm:p-10 border-b md:border-r border-white/15">
          <div className="text-5xl sm:text-7xl font-medium tracking-tight text-white">
            99.4<span className="text-xl sm:text-2xl text-cyan-400 font-mono align-super ml-1">%</span>
          </div>
          <div className="font-mono text-xs uppercase tracking-wider text-neutral-400 mt-4">
            Detection Accuracy
          </div>
          <div className="h-1 w-full bg-white/10 rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-cyan-400 w-[99%]" />
          </div>
        </div>

        <div className="p-6 sm:p-10 border-b border-r border-white/15">
          <div className="text-5xl sm:text-7xl font-medium tracking-tight text-white">
            60<span className="text-xl sm:text-2xl text-cyan-400 font-mono align-super ml-1">fps</span>
          </div>
          <div className="font-mono text-xs uppercase tracking-wider text-neutral-400 mt-4">
            Waveform Telemetry
          </div>
          <div className="h-1 w-full bg-white/10 rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-cyan-400 w-[95%]" />
          </div>
        </div>

        <div className="p-6 sm:p-10 border-b border-white/15">
          <div className="text-5xl sm:text-7xl font-medium tracking-tight text-white">
            0<span className="text-xl sm:text-2xl text-cyan-400 font-mono align-super ml-1">loss</span>
          </div>
          <div className="font-mono text-xs uppercase tracking-wider text-neutral-400 mt-4">
            Telephony Latency
          </div>
          <div className="h-1 w-full bg-white/10 rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-cyan-400 w-[100%]" />
          </div>
        </div>
      </div>
    </section>
  );
}
