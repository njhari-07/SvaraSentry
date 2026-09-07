"use client";
export default function TouchSection() {
  return (
    <section id="touch" className="relative h-[80vh] flex flex-col items-center justify-center text-center px-6 z-10">
      <div className="text-5xl sm:text-8xl md:text-9xl font-medium tracking-tight text-white">
        Now <span className="font-serif italic font-normal bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">probe</span> it.
      </div>
      <div className="font-mono text-xs uppercase tracking-widest text-neutral-400 mt-6">
        Move your cursor &middot; drag to perturb acoustic field &middot; click to trigger defense burst
      </div>
    </section>
  );
}
