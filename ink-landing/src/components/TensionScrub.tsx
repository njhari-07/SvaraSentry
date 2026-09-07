import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

export default function TensionScrub() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  const line1Y = useTransform(scrollYProgress, [0.0, 0.25], ["100%", "0%"]);
  const line1Opacity = useTransform(scrollYProgress, [0.0, 0.25], [0.15, 1]);

  const line2Y = useTransform(scrollYProgress, [0.2, 0.45], ["100%", "0%"]);
  const line2Opacity = useTransform(scrollYProgress, [0.2, 0.45], [0.15, 1]);

  const line3Y = useTransform(scrollYProgress, [0.4, 0.65], ["100%", "0%"]);
  const line3Opacity = useTransform(scrollYProgress, [0.4, 0.65], [0.15, 1]);

  const line4Y = useTransform(scrollYProgress, [0.6, 0.85], ["100%", "0%"]);
  const line4Opacity = useTransform(scrollYProgress, [0.6, 0.85], [0.15, 1]);

  const line5Y = useTransform(scrollYProgress, [0.75, 1.0], ["100%", "0%"]);
  const line5Opacity = useTransform(scrollYProgress, [0.75, 1.0], [0.15, 1]);

  return (
    <section ref={sectionRef} id="tension" className="relative h-[260vh] z-10">
      <div className="sticky top-0 h-screen overflow-hidden flex items-center px-6 sm:px-12 max-w-7xl mx-auto">
        <div className="text-3xl sm:text-6xl md:text-7xl font-medium tracking-tight leading-[1.08] flex flex-col gap-2 sm:gap-4">
          <div className="overflow-hidden">
            <motion.div style={{ y: line1Y, opacity: line1Opacity }} className="text-neutral-500">
              Every voice that ever spoke
            </motion.div>
          </div>
          <div className="overflow-hidden">
            <motion.div style={{ y: line2Y, opacity: line2Opacity }} className="text-neutral-500">
              across a phone call
            </motion.div>
          </div>
          <div className="overflow-hidden">
            <motion.div style={{ y: line3Y, opacity: line3Opacity }}>
              was <span className="font-serif italic font-normal text-white">authentic.</span>
            </motion.div>
          </div>
          <div className="overflow-hidden mt-4">
            <motion.div style={{ y: line4Y, opacity: line4Opacity }} className="text-white">
              Now AI <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">speaks in their breath.</span>
            </motion.div>
          </div>
          <div className="overflow-hidden">
            <motion.div style={{ y: line5Y, opacity: line5Opacity }}>
              SvaraSentry <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">guards the line.</span>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
