"use client";
export default function Manifesto() {
  return (
    <section id="manifesto" className="relative py-32 sm:py-48 px-6 sm:px-12 max-w-7xl mx-auto z-10">
      <div className="flex flex-col gap-3 sm:gap-6 font-serif text-3xl sm:text-6xl md:text-7xl font-normal tracking-tight text-white leading-tight">
        <div>
          <i>Audio</i> <i>shouldn&rsquo;t</i> <i>just</i> <i>be</i> <i>trusted.</i>
        </div>
        <div className="font-sans font-medium tracking-tight">
          <i>It&rsquo;s</i> <i>meant</i> <i>to</i> <i>be</i>{" "}
          <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">
            verified
          </span>
        </div>
        <div>
          <i>&mdash; in every frame, across every call,</i>
        </div>
        <div className="font-sans font-medium tracking-tight">
          <i>to keep</i> <i>human connection</i>{" "}
          <span className="font-serif italic font-normal bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            genuinely authentic.
          </span>
        </div>
      </div>
    </section>
  );
}
