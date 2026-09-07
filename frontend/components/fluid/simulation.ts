import {
  baseVertexShader,
  splatShader,
  advectionShader,
  divergenceShader,
  curlShader,
  vorticityShader,
  clearPressureShader,
  pressureJacobiShader,
  gradientSubtractShader,
  displayShader,
} from "./shaders";
import { DEFAULT_FLUID_CONFIG, MOBILE_FLUID_CONFIG } from "./constants";
import type { FluidConfig } from "./constants";

interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  attach: (id: number) => number;
}

interface DoubleFBO {
  width: number;
  height: number;
  read: FBO;
  write: FBO;
  swap: () => void;
}

export class FluidSimulation {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private config: FluidConfig;
  private animId: number = 0;
  private lastTime: number = performance.now();
  private colorIndex: number = 0;
  private autoSplatTimer: number = 0;

  // Quad Geometry
  private quadBuffer: WebGLBuffer | null = null;

  // Shader Programs
  private splatProgram!: WebGLProgram;
  private advectionProgram!: WebGLProgram;
  private divergenceProgram!: WebGLProgram;
  private curlProgram!: WebGLProgram;
  private vorticityProgram!: WebGLProgram;
  private clearProgram!: WebGLProgram;
  private pressureProgram!: WebGLProgram;
  private gradSubtractProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;

  // Framebuffers
  private density!: DoubleFBO;
  private velocity!: DoubleFBO;
  private pressure!: DoubleFBO;
  private divergence!: FBO;
  private curl!: FBO;

  // Mouse & Touch Tracking
  private pointers: Map<number, { x: number; y: number; prevX: number; prevY: number; down: boolean }> = new Map();

  constructor(canvas: HTMLCanvasElement, customConfig?: Partial<FluidConfig>) {
    this.canvas = canvas;
    const isMobile = window.innerWidth < 768 || window.devicePixelRatio > 2.5;
    this.config = {
      ...(isMobile ? MOBILE_FLUID_CONFIG : DEFAULT_FLUID_CONFIG),
      ...customConfig,
    };

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error("WebGL2 not supported in this browser context.");
    }
    this.gl = gl;

    // Extensions for floating-point textures
    this.gl.getExtension("EXT_color_buffer_float");
    this.gl.getExtension("OES_texture_float_linear");

    this.initShaders();
    this.initFBOs();
    this.setupListeners();
    this.start();
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vertexSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(vs));
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragmentSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(fs));
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
    }
    return program;
  }

  private initShaders() {
    this.splatProgram = this.createProgram(baseVertexShader, splatShader);
    this.advectionProgram = this.createProgram(baseVertexShader, advectionShader);
    this.divergenceProgram = this.createProgram(baseVertexShader, divergenceShader);
    this.curlProgram = this.createProgram(baseVertexShader, curlShader);
    this.vorticityProgram = this.createProgram(baseVertexShader, vorticityShader);
    this.clearProgram = this.createProgram(baseVertexShader, clearPressureShader);
    this.pressureProgram = this.createProgram(baseVertexShader, pressureJacobiShader);
    this.gradSubtractProgram = this.createProgram(baseVertexShader, gradientSubtractShader);
    this.displayProgram = this.createProgram(baseVertexShader, displayShader);

    // Full screen quad buffer
    this.quadBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      this.gl.STATIC_DRAW
    );
  }

  private createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): FBO {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      fbo,
      width: w,
      height: h,
      attach: (id: number) => {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  private createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): DoubleFBO {
    let fbo1 = this.createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = this.createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w,
      height: h,
      get read() {
        return fbo1;
      },
      set read(value) {
        fbo1 = value;
      },
      get write() {
        return fbo2;
      },
      set write(value) {
        fbo2 = value;
      },
      swap() {
        const temp = fbo1;
        fbo1 = fbo2;
        fbo2 = temp;
      },
    };
  }

  private initFBOs() {
    const gl = this.gl;
    const simRes = this.config.SIM_RESOLUTION;
    const dyeRes = this.config.DYE_RESOLUTION;

    const rgbaHalfFloat = gl.RGBA16F;
    const rgba = gl.RGBA;
    const halfFloat = gl.HALF_FLOAT;

    const rHalfFloat = gl.R16F;
    const red = gl.RED;

    this.density = this.createDoubleFBO(dyeRes, dyeRes, rgbaHalfFloat, rgba, halfFloat, gl.LINEAR);
    this.velocity = this.createDoubleFBO(simRes, simRes, rgbaHalfFloat, rgba, halfFloat, gl.LINEAR);
    this.divergence = this.createFBO(simRes, simRes, rHalfFloat, red, halfFloat, gl.NEAREST);
    this.curl = this.createFBO(simRes, simRes, rHalfFloat, red, halfFloat, gl.NEAREST);
    this.pressure = this.createDoubleFBO(simRes, simRes, rHalfFloat, red, halfFloat, gl.NEAREST);
  }

  private renderQuad() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  public splat(x: number, y: number, dx: number, dy: number, color: { r: number; g: number; b: number }) {
    const gl = this.gl;

    // 1. Splat Velocity
    gl.viewport(0, 0, this.velocity.width, this.velocity.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
    gl.useProgram(this.splatProgram);
    gl.uniform1i(gl.getUniformLocation(this.splatProgram, "uTarget"), this.velocity.read.attach(0));
    gl.uniform1f(gl.getUniformLocation(this.splatProgram, "uAspectRatio"), this.canvas.width / this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.splatProgram, "uPoint"), x, y);
    gl.uniform3f(gl.getUniformLocation(this.splatProgram, "uColor"), dx, dy, 0.0);
    gl.uniform1f(gl.getUniformLocation(this.splatProgram, "uRadius"), this.config.SPLAT_RADIUS / 100.0);
    this.renderQuad();
    this.velocity.swap();

    // 2. Splat Color Dye
    gl.viewport(0, 0, this.density.width, this.density.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.density.write.fbo);
    gl.uniform1i(gl.getUniformLocation(this.splatProgram, "uTarget"), this.density.read.attach(0));
    gl.uniform3f(gl.getUniformLocation(this.splatProgram, "uColor"), color.r, color.g, color.b);
    this.renderQuad();
    this.density.swap();
  }

  private setupListeners() {
    const onPointerMove = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;

      const p = this.pointers.get(e.pointerId);
      if (p) {
        const dx = (x - p.prevX) * this.config.SPLAT_FORCE;
        const dy = (y - p.prevY) * this.config.SPLAT_FORCE;

        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          const color = this.config.COLOR_PALETTE[this.colorIndex % this.config.COLOR_PALETTE.length];
          this.splat(x, y, dx, dy, color);
          this.colorIndex++;
        }
        p.prevX = x;
        p.prevY = y;
      } else {
        this.pointers.set(e.pointerId, { x, y, prevX: x, prevY: y, down: true });
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;
      this.pointers.set(e.pointerId, { x, y, prevX: x, prevY: y, down: true });

      // Immediate splat on click
      const color = this.config.COLOR_PALETTE[this.colorIndex % this.config.COLOR_PALETTE.length];
      const angle = Math.random() * Math.PI * 2;
      this.splat(x, y, Math.cos(angle) * 350, Math.sin(angle) * 350, color);
      this.colorIndex++;
    };

    const onPointerUp = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });

    // Window Resize
    const onResize = () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);
    onResize();

    // Trigger initial burst so page starts with stunning colors
    setTimeout(() => {
      for (let i = 0; i < 3; i++) {
        const angle = Math.random() * Math.PI * 2;
        this.splat(
          0.35 + Math.random() * 0.3,
          0.45 + Math.random() * 0.25,
          Math.cos(angle) * 500,
          Math.sin(angle) * 500,
          this.config.COLOR_PALETTE[i % this.config.COLOR_PALETTE.length]
        );
      }
    }, 150);
  }

  private step(dt: number) {
    const gl = this.gl;

    // 1. Curl
    gl.viewport(0, 0, this.curl.width, this.curl.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.curl.fbo);
    gl.useProgram(this.curlProgram);
    gl.uniform2f(gl.getUniformLocation(this.curlProgram, "uTexelSize"), 1.0 / this.velocity.width, 1.0 / this.velocity.height);
    gl.uniform1i(gl.getUniformLocation(this.curlProgram, "uVelocity"), this.velocity.read.attach(0));
    this.renderQuad();

    // 2. Vorticity Confinement
    gl.viewport(0, 0, this.velocity.width, this.velocity.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
    gl.useProgram(this.vorticityProgram);
    gl.uniform2f(gl.getUniformLocation(this.vorticityProgram, "uTexelSize"), 1.0 / this.velocity.width, 1.0 / this.velocity.height);
    gl.uniform1i(gl.getUniformLocation(this.vorticityProgram, "uVelocity"), this.velocity.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.vorticityProgram, "uCurl"), this.curl.attach(1));
    gl.uniform1f(gl.getUniformLocation(this.vorticityProgram, "uCurlScale"), this.config.CURL);
    gl.uniform1f(gl.getUniformLocation(this.vorticityProgram, "uDt"), dt);
    this.renderQuad();
    this.velocity.swap();

    // 3. Divergence
    gl.viewport(0, 0, this.divergence.width, this.divergence.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.divergence.fbo);
    gl.useProgram(this.divergenceProgram);
    gl.uniform2f(gl.getUniformLocation(this.divergenceProgram, "uTexelSize"), 1.0 / this.velocity.width, 1.0 / this.velocity.height);
    gl.uniform1i(gl.getUniformLocation(this.divergenceProgram, "uVelocity"), this.velocity.read.attach(0));
    this.renderQuad();

    // 4. Clear Pressure
    gl.viewport(0, 0, this.pressure.width, this.pressure.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.write.fbo);
    gl.useProgram(this.clearProgram);
    gl.uniform1i(gl.getUniformLocation(this.clearProgram, "uTexture"), this.pressure.read.attach(0));
    gl.uniform1f(gl.getUniformLocation(this.clearProgram, "uPressureDecay"), this.config.PRESSURE);
    this.renderQuad();
    this.pressure.swap();

    // 5. Pressure (Jacobi Relaxation)
    gl.useProgram(this.pressureProgram);
    gl.uniform2f(gl.getUniformLocation(this.pressureProgram, "uTexelSize"), 1.0 / this.velocity.width, 1.0 / this.velocity.height);
    gl.uniform1i(gl.getUniformLocation(this.pressureProgram, "uDivergence"), this.divergence.attach(1));
    for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.write.fbo);
      gl.uniform1i(gl.getUniformLocation(this.pressureProgram, "uPressure"), this.pressure.read.attach(0));
      this.renderQuad();
      this.pressure.swap();
    }

    // 6. Subtract Pressure Gradient
    gl.viewport(0, 0, this.velocity.width, this.velocity.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
    gl.useProgram(this.gradSubtractProgram);
    gl.uniform2f(gl.getUniformLocation(this.gradSubtractProgram, "uTexelSize"), 1.0 / this.velocity.width, 1.0 / this.velocity.height);
    gl.uniform1i(gl.getUniformLocation(this.gradSubtractProgram, "uPressure"), this.pressure.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.gradSubtractProgram, "uVelocity"), this.velocity.read.attach(1));
    this.renderQuad();
    this.velocity.swap();

    // 7. Advect Velocity
    gl.viewport(0, 0, this.velocity.width, this.velocity.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
    gl.useProgram(this.advectionProgram);
    gl.uniform2f(gl.getUniformLocation(this.advectionProgram, "uTexelSize"), 1.0 / this.velocity.width, 1.0 / this.velocity.height);
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, "uVelocity"), this.velocity.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, "uSource"), this.velocity.read.attach(0));
    gl.uniform1f(gl.getUniformLocation(this.advectionProgram, "uDt"), dt);
    gl.uniform1f(gl.getUniformLocation(this.advectionProgram, "uDissipation"), 1.0 - this.config.VELOCITY_DISSIPATION);
    this.renderQuad();
    this.velocity.swap();

    // 8. Advect Dye Color
    gl.viewport(0, 0, this.density.width, this.density.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.density.write.fbo);
    gl.uniform2f(gl.getUniformLocation(this.advectionProgram, "uTexelSize"), 1.0 / this.velocity.width, 1.0 / this.velocity.height);
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, "uVelocity"), this.velocity.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, "uSource"), this.density.read.attach(1));
    gl.uniform1f(gl.getUniformLocation(this.advectionProgram, "uDissipation"), 1.0 - this.config.DENSITY_DISSIPATION);
    this.renderQuad();
    this.density.swap();

    // 9. Composite to Screen
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.displayProgram);
    gl.uniform1i(gl.getUniformLocation(this.displayProgram, "uDye"), this.density.read.attach(0));
    gl.uniform2f(gl.getUniformLocation(this.displayProgram, "uResolution"), this.canvas.width, this.canvas.height);
    gl.uniform1f(gl.getUniformLocation(this.displayProgram, "uBloomIntensity"), this.config.BLOOM_INTENSITY);
    this.renderQuad();
  }

  private loop = (now: number) => {
    const dt = Math.min((now - this.lastTime) / 1000, 0.033);
    this.lastTime = now;

    // Automatic Idle Splats
    if (now - this.autoSplatTimer > this.config.AUTO_SPLAT_INTERVAL) {
      this.autoSplatTimer = now;
      const angle = Math.random() * Math.PI * 2;
      const color = this.config.COLOR_PALETTE[this.colorIndex % this.config.COLOR_PALETTE.length];
      this.splat(
        0.2 + Math.random() * 0.6,
        0.3 + Math.random() * 0.4,
        Math.cos(angle) * 450,
        Math.sin(angle) * 450,
        color
      );
      this.colorIndex++;
    }

    this.step(dt);
    this.animId = requestAnimationFrame(this.loop);
  };

  public start() {
    this.lastTime = performance.now();
    this.autoSplatTimer = performance.now();
    this.animId = requestAnimationFrame(this.loop);
  }

  public destroy() {
    cancelAnimationFrame(this.animId);
  }
}
