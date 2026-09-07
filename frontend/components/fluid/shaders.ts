/**
 * Navier–Stokes WebGL2 Fluid Simulation Shaders
 * Architecture inspired by Stam's Stable Fluids & Pavel DoGreat
 */

export const baseVertexShader = `#version 300 es
precision highp float;

in vec2 aPosition;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;

uniform vec2 uTexelSize;

void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(uTexelSize.x, 0.0);
  vR = vUv + vec2(uTexelSize.x, 0.0);
  vT = vUv + vec2(0.0, uTexelSize.y);
  vB = vUv - vec2(0.0, uTexelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const splatShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTarget;
uniform float uAspectRatio;
uniform vec3 uColor;
uniform vec2 uPoint;
uniform float uRadius;

void main () {
  vec2 p = vUv - uPoint.xy;
  p.x *= uAspectRatio;
  vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
  vec3 base = texture(uTarget, vUv).xyz;
  fragColor = vec4(base + splat, 1.0);
}
`;

export const advectionShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexelSize;
uniform float uDt;
uniform float uDissipation;

void main () {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexelSize;
  vec4 result = texture(uSource, coord);
  float decay = 1.0 + uDissipation * uDt;
  fragColor = result / decay;
}
`;

export const divergenceShader = `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uVelocity;

void main () {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;

  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }

  float div = 0.5 * (R - L + T - B);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

export const curlShader = `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uVelocity;

void main () {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`;

export const vorticityShader = `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uCurlScale;
uniform float uDt;

void main () {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;

  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlScale * C;
  force.y *= -1.0;

  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity += force * uDt;
  velocity = min(max(velocity, -1000.0), 1000.0);
  fragColor = vec4(velocity, 0.0, 1.0);
}
`;

export const clearPressureShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTexture;
uniform float uPressureDecay;

void main () {
  fragColor = vec4(uPressureDecay * texture(uTexture, vUv).x, 0.0, 0.0, 1.0);
}
`;

export const pressureJacobiShader = `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float C = texture(uPressure, vUv).x;
  float divergence = texture(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

export const gradientSubtractShader = `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  fragColor = vec4(velocity, 0.0, 1.0);
}
`;

export const displayShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uDye;
uniform vec2 uResolution;
uniform float uBloomIntensity;

void main () {
  vec3 c = texture(uDye, vUv).rgb;

  // Cinematic tone curve & soft bloom
  vec3 bloom = max(c - 0.4, 0.0) * uBloomIntensity;
  c += bloom;

  // Background blend into near-black (#05050a)
  vec3 bg = vec3(0.02, 0.02, 0.04);
  vec3 finalColor = bg + c;

  // Vignette
  vec2 uv = (gl_FragCoord.xy / uResolution.xy) * 2.0 - 1.0;
  float vignette = clamp(1.0 - dot(uv, uv) * 0.25, 0.0, 1.0);
  finalColor *= vignette;

  fragColor = vec4(finalColor, 1.0);
}
`;
