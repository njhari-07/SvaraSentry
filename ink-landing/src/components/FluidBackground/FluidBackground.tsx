import React, { useEffect, useRef, useState } from "react";
import type { FluidBackgroundProps } from "./types";
import { NavierStokesFluidEngine } from "./engine";
import { getResponsiveDPR, isWebGL2Supported } from "./utils";

export const FluidBackground: React.FC<FluidBackgroundProps> = ({
  colors = ["#1D4ED8", "#06B6D4", "#2563EB", "#38BDF8"],
  simResolution = 128,
  dyeResolution = 1024,
  densityDissipation = 0.98,
  velocityDissipation = 0.99,
  pressureIterations = 20,
  curl = 30,
  splatRadius = 0.25,
  splatForce = 6000,
  autoSplatIntervalMs = 3000,
  backgroundColor = "transparent",
  bloom = true,
  bloomIntensity = 0.5,
  className = "fixed inset-0 -z-10",
  style = {},
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<NavierStokesFluidEngine | null>(null);
  const [supported, setSupported] = useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  useEffect(() => {
    // 1. WebGL2 Support Check
    if (!isWebGL2Supported()) {
      setSupported(false);
      return;
    }

    // 2. Prefers-reduced-motion Check
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) {
      setReducedMotion(true);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // 3. Initialize Navier-Stokes Engine
    try {
      const dpr = getResponsiveDPR(2);
      const w = window.innerWidth;
      const h = window.innerHeight;

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      engineRef.current = new NavierStokesFluidEngine(canvas, {
        colors,
        simResolution,
        dyeResolution,
        densityDissipation,
        velocityDissipation,
        pressureIterations,
        curl,
        splatRadius,
        splatForce,
        autoSplatIntervalMs,
        backgroundColor,
        bloom,
        bloomIntensity,
      });
    } catch (err) {
      console.warn("WebGL2 Fluid Simulation failed to start, falling back to static poster:", err);
      setSupported(false);
      return;
    }

    // 4. ResizeObserver for responsive viewport adaptation
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && canvas) {
          const dpr = getResponsiveDPR(2);
          const pxW = Math.floor(width * dpr);
          const pxH = Math.floor(height * dpr);

          canvas.width = pxW;
          canvas.height = pxH;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;

          if (engineRef.current) {
            engineRef.current.updateSize(pxW, pxH);
          }
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // 5. Cleanup on Unmount (Safe for React StrictMode)
    return () => {
      resizeObserver.disconnect();
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [
    colors,
    simResolution,
    dyeResolution,
    densityDissipation,
    velocityDissipation,
    pressureIterations,
    curl,
    splatRadius,
    splatForce,
    autoSplatIntervalMs,
    backgroundColor,
    bloom,
    bloomIntensity,
  ]);

  // Graceful fallback for unsupported WebGL2 or prefers-reduced-motion
  if (!supported || reducedMotion) {
    return (
      <div
        className={`${className} overflow-hidden pointer-events-none`}
        style={{
          background:
            backgroundColor === "transparent"
              ? "radial-gradient(ellipse at 50% 50%, rgba(29, 78, 216, 0.20), rgba(6, 182, 212, 0.10) 50%, #020617 90%)"
              : backgroundColor,
          ...style,
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`${className} overflow-hidden pointer-events-none`}
      style={style}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block pointer-events-none"
        style={{
          background: backgroundColor === "transparent" ? "transparent" : backgroundColor,
        }}
      />
    </div>
  );
};

export default FluidBackground;
