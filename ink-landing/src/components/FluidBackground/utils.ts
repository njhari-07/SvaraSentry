import type { RGBColor } from "./types";

/**
 * Converts a hex color string (e.g. "#7C3AED" or "#06B") to normalized RGB values in [0, 1]
 */
export function hexToRGB(hex: string): RGBColor {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) {
    return { r: 0.1, g: 0.5, b: 0.95 }; // fallback blue
  }
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

/**
 * Checks if WebGL2 is supported in the current browser environment
 */
export function isWebGL2Supported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGL2RenderingContext &&
      canvas.getContext("webgl2", { alpha: true })
    );
  } catch {
    return false;
  }
}

/**
 * Computes responsive Device Pixel Ratio, capped on mobile/low-end devices
 */
export function getResponsiveDPR(maxDPR = 2): number {
  const isMobile =
    /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) || window.innerWidth < 768;

  const dpr = window.devicePixelRatio || 1;
  return isMobile ? Math.min(dpr, 1.25) : Math.min(dpr, maxDPR);
}

/**
 * Clamps a number between min and max
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
