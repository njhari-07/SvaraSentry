/**
 * Tunable Parameters for the Navier-Stokes WebGL2 Fluid Simulation
 */

export interface FluidConfig {
  SIM_RESOLUTION: number;
  DYE_RESOLUTION: number;
  DENSITY_DISSIPATION: number;
  VELOCITY_DISSIPATION: number;
  PRESSURE: number;
  PRESSURE_ITERATIONS: number;
  CURL: number;
  SPLAT_RADIUS: number;
  SPLAT_FORCE: number;
  COLOR_PALETTE: Array<{ r: number; g: number; b: number }>;
  AUTO_SPLAT_INTERVAL: number; // in milliseconds
  BLOOM: boolean;
  BLOOM_INTENSITY: number;
  BLOOM_THRESHOLD: number;
}

export const DEFAULT_FLUID_CONFIG: FluidConfig = {
  SIM_RESOLUTION: 128,
  DYE_RESOLUTION: 1024,
  DENSITY_DISSIPATION: 0.98,
  VELOCITY_DISSIPATION: 0.985,
  PRESSURE: 0.8,
  PRESSURE_ITERATIONS: 24,
  CURL: 32.0,
  SPLAT_RADIUS: 0.28,
  SPLAT_FORCE: 6000.0,
  // 5 Signature INK Brand Colors: Deep Indigo, Electric Violet, Luminous Cyan, Hot Pink, Electric Blue
  COLOR_PALETTE: [
    { r: 0.35, g: 0.08, b: 0.58 }, // Deep Indigo / Violet
    { r: 0.65, g: 0.15, b: 0.95 }, // Electric Violet
    { r: 0.00, g: 0.95, b: 0.99 }, // Cyan Glow
    { r: 1.00, g: 0.12, b: 0.60 }, // Hot Pink
    { r: 0.17, g: 0.52, b: 1.00 }, // Electric Blue
  ],
  AUTO_SPLAT_INTERVAL: 2600,
  BLOOM: true,
  BLOOM_INTENSITY: 0.45,
  BLOOM_THRESHOLD: 0.55,
};

export const MOBILE_FLUID_CONFIG: FluidConfig = {
  ...DEFAULT_FLUID_CONFIG,
  SIM_RESOLUTION: 64,
  DYE_RESOLUTION: 512,
  PRESSURE_ITERATIONS: 16,
  SPLAT_RADIUS: 0.35,
};
