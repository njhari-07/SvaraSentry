import React from "react";

export interface FluidBackgroundProps {
  /** Array of hex color strings to cycle through per splat (e.g. ['#7C3AED', '#06B6D4', '#EC4899', '#3B82F6']) */
  colors?: string[];
  /** Internal simulation grid resolution (default: 128, lower = faster) */
  simResolution?: number;
  /** Visual dye field resolution (default: 1024, lower = faster) */
  dyeResolution?: number;
  /** Rate at which dye fades over time (0.0 to 1.0, default: 0.98) */
  densityDissipation?: number;
  /** Rate at which fluid momentum slows down (0.0 to 1.0, default: 0.99) */
  velocityDissipation?: number;
  /** Number of Jacobi relaxation iterations per frame (default: 20) */
  pressureIterations?: number;
  /** Vorticity confinement strength for organic swirling (default: 30) */
  curl?: number;
  /** Radius of pointer splats (default: 0.25) */
  splatRadius?: number;
  /** Momentum force injected per unit of pointer velocity (default: 6000) */
  splatForce?: number;
  /** Milliseconds between idle auto-splats (default: 3000, 0 to disable) */
  autoSplatIntervalMs?: number;
  /** Background fill color: hex string or "transparent" (default: "transparent") */
  backgroundColor?: string;
  /** Optional bloom glow pass (default: true) */
  bloom?: boolean;
  /** Bloom intensity multiplier (default: 0.5) */
  bloomIntensity?: number;
  /** CSS classes applied to container (default: "fixed inset-0 -z-10") */
  className?: string;
  /** Optional inline styles */
  style?: React.CSSProperties;
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  attach: (id: number) => number;
}

export interface DoubleFBO {
  width: number;
  height: number;
  read: FBO;
  write: FBO;
  swap: () => void;
}

export interface PointerState {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  time: number;
  down: boolean;
}
