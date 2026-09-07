"use client";
import React, { useEffect, useRef } from "react";
import { FluidSimulation } from "./simulation";
import type { FluidConfig } from "./constants";

interface FluidCanvasProps {
  config?: Partial<FluidConfig>;
  className?: string;
}

export const FluidCanvas: React.FC<FluidCanvasProps> = ({ config, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<FluidSimulation | null>(null);

  useEffect(() => {
    // Check for prefers-reduced-motion
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) {
      return;
    }

    // Lazy initialize after paint to avoid blocking First Contentful Paint (LCP)
    const timer = requestAnimationFrame(() => {
      if (canvasRef.current && !simRef.current) {
        try {
          simRef.current = new FluidSimulation(canvasRef.current, config);
        } catch (err) {
          console.warn("Failed to initialize WebGL2 fluid engine:", err);
        }
      }
    });

    return () => {
      cancelAnimationFrame(timer);
      if (simRef.current) {
        simRef.current.destroy();
        simRef.current = null;
      }
    };
  }, [config]);

  return (
    <div className={`fixed inset-0 pointer-events-none z-0 overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        id="fluid-canvas"
        className="w-full h-full block"
        style={{
          background: "#05050a",
        }}
      />
      {/* Fallback & depth vignette scrim */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at center, transparent 30%, rgba(5, 5, 10, 0.45) 75%, rgba(5, 5, 10, 0.85) 100%)",
        }}
      />
    </div>
  );
};

export default FluidCanvas;
