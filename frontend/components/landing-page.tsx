"use client";

import React from "react";
import { FluidBackground } from "./FluidBackground";
import Navbar from "./Navbar";
import Hero from "./Hero";
import Showcase from "./Showcase";
import TrueFocus from "./TrueFocus";
import TensionScrub from "./TensionScrub";
import PipelineScrub from "./PipelineScrub";
import SpecsSection from "./SpecsSection";
import GlassUI from "./GlassUI";
import DirectEngine from "./DirectEngine";
import CodeBlock from "./CodeBlock";
import TouchSection from "./TouchSection";
import Manifesto from "./Manifesto";
import CtaSection from "./CtaSection";
import Footer from "./Footer";
import SideIndex from "./SideIndex";

interface LandingPageProps {
  onLaunchMonitor?: () => void;
}

export function LandingPage({ onLaunchMonitor }: LandingPageProps) {
  return (
    <div className="relative min-h-screen bg-[#020617] text-[#faf6f0] antialiased selection:bg-cyan-400 selection:text-black font-sans overflow-x-hidden">
      {/* 1. Full-screen, real-time interactive WebGL2 Fluid Simulation */}
      <FluidBackground
        colors={["#1d4ed8", "#06b6d4", "#2563eb", "#38bdf8"]}
        simResolution={192}
        dyeResolution={1024}
        densityDissipation={0.97}
        velocityDissipation={0.98}
        pressureIterations={24}
        curl={22}
        splatRadius={0.28}
        splatForce={3750}
        autoSplatIntervalMs={4000}
        backgroundColor="transparent"
        className="fixed inset-0 -z-10"
      />

      {/* 2. HUD Framing Brackets */}
      <div className="fixed top-6 left-6 w-5 h-5 border-t border-l border-white/20 pointer-events-none z-40 hidden sm:block" />
      <div className="fixed top-6 right-6 w-5 h-5 border-t border-r border-white/20 pointer-events-none z-40 hidden sm:block" />
      <div className="fixed bottom-6 left-6 w-5 h-5 border-b border-l border-white/20 pointer-events-none z-40 hidden sm:block" />
      <div className="fixed bottom-6 right-6 w-5 h-5 border-b border-r border-white/20 pointer-events-none z-40 hidden sm:block" />

      {/* 3. Side Navigation Rail */}
      <SideIndex />

      {/* 4. Sticky Top Navigation */}
      <Navbar onLaunchMonitor={onLaunchMonitor} />

      {/* 5. Main Sequence matching Aura Reference */}
      <main className="relative z-10">
        <Hero onLaunchMonitor={onLaunchMonitor} />
        <Showcase />
        <TrueFocus />
        <TensionScrub />
        <PipelineScrub />
        <SpecsSection />
        <GlassUI />
        <DirectEngine />
        <CodeBlock />
        <TouchSection />
        <Manifesto />
        <CtaSection onLaunchMonitor={onLaunchMonitor} />
      </main>

      {/* 6. Minimal Technical Footer */}
      <Footer />
    </div>
  );
}

export default LandingPage;
