import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

const STAGES = [
  {
    num: "STAGE 01",
    title: "Ingest",
    desc: "Capture raw 16kHz PCM audio stream via WebRTC or SIP trunk in real-time.",
  },
  {
    num: "STAGE 02",
    title: "Dual-Path Mel",
    desc: "Extract log-mel filterbanks and Constant-Q transform bi-spectral spectrograms.",
  },
  {
    num: "STAGE 03",
    title: "Glottal Jitter",
    desc: "Measure micro-tremors and natural biomechanical variations in vocal fold oscillations.",
  },
  {
    num: "STAGE 04",
    title: "Phase Check",
    desc: "Detect mathematical vocoder phase mismatches and neural diffusion artifacts.",
  },
  {
    num: "STAGE 05",
    title: "Wav2Vec2",
    desc: "Project acoustic frames through self-supervised transformer representations.",
  },
  {
    num: "STAGE 06",
    title: "Temporal Variance",
    desc: "Evaluate cross-frame phonetic transitions against synthetic robotic stillness.",
  },
  {
    num: "STAGE 07",
    title: "Bayesian Score",
    desc: "Fuse multi-band anomaly likelihoods into a calibrated spoof probability.",
  },
  {
    num: "STAGE 08",
    title: "Kill Switch",
    desc: "Trigger automated SIP call teardown, supervisor alert, and transaction freeze.",
  },
];

export default function PipelineScrub() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  // Transform 0 -> 1 into horizontal scroll translation
  const x = useTransform(scrollYProgress, [0, 1], ["0%", "-70%"]);

  return (
    <section ref={sectionRef} id="reveal" className="relative h-[480vh] z-10">
      <div className="sticky top-0 h-screen overflow-hidden flex flex-col justify-center">
        {/* Section Header */}
        <div className="px-6 sm:px-12 max-w-7xl mx-auto w-full mb-8 sm:mb-12">
          <div className="font-mono text-xs uppercase tracking-widest text-cyan-400 mb-2">
            The Loop &middot; 8 forensic stages every frame
          </div>
          <h2 className="text-3xl sm:text-5xl font-medium tracking-tight text-white">
            It&rsquo;s <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">biometrics.</span>
          </h2>
        </div>

        {/* Horizontal Moving Stage Track */}
        <motion.div style={{ x }} className="flex gap-6 sm:gap-8 px-6 sm:px-12 w-max will-change-transform">
          {STAGES.map((s, idx) => (
            <div
              key={s.num}
              className="w-[300px] sm:w-[380px] p-6 sm:p-8 rounded-2xl border border-white/15 bg-neutral-950/70 backdrop-blur-xl shadow-2xl flex flex-col justify-between"
            >
              <div>
                <div className="font-mono text-xs uppercase tracking-widest text-neutral-400">{s.num}</div>
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-white mt-3 mb-2">
                  <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                    {s.title}
                  </span>
                </div>
                <p className="text-neutral-400 text-sm leading-relaxed">{s.desc}</p>
              </div>

              {/* Progress Bar under each stage */}
              <div className="mt-8 h-1 w-full bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  style={{
                    scaleX: useTransform(
                      scrollYProgress,
                      [idx / STAGES.length, (idx + 1) / STAGES.length],
                      [0, 1]
                    ),
                  }}
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 origin-left"
                />
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
