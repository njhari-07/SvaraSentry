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
import type { DoubleFBO, FBO, FluidBackgroundProps, PointerState, RGBColor } from "./types";
import { hexToRGB } from "./utils";

export class NavierStokesFluidEngine {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private props: Required<FluidBackgroundProps>;

  // Performance monitoring
  private frameTimes: number[] = [];
  private lastTime: number = performance.now();
  private autoSplatTimer: number = performance.now();
  private colorIndex: number = 0;
  private animId: number = 0;
  private isDestroyed: boolean = false;

  // Geometry
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

  // Multi-Touch & Pointer Tracking
  private pointers: Map<number, PointerState> = new Map();
  private cleanupListeners: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, props: FluidBackgroundProps) {
    this.canvas = canvas;
    this.props = {
      colors: props.colors ?? ["#1D4ED8", "#06B6D4", "#2563EB", "#38BDF8"],
      simResolution: props.simResolution ?? 128,
      dyeResolution: props.dyeResolution ?? 1024,
      densityDissipation: props.densityDissipation ?? 0.98,
      velocityDissipation: props.velocityDissipation ?? 0.99,
      pressureIterations: props.pressureIterations ?? 20,
      curl: props.curl ?? 30,
      splatRadius: props.splatRadius ?? 0.25,
      splatForce: props.splatForce ?? 6000,
      autoSplatIntervalMs: props.autoSplatIntervalMs ?? 3000,
      backgroundColor: props.backgroundColor ?? "transparent",
      bloom: props.bloom ?? true,
      bloomIntensity: props.bloomIntensity ?? 0.5,
      className: props.className ?? "fixed inset-0 -z-10",
      style: props.style ?? {},
    };

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error("WebGL2 not supported in this browser environment.");
    }
    this.gl = gl;

    // Extensions for floating point textures
    this.gl.getExtension("EXT_color_buffer_float");
    this.gl.getExtension("OES_texture_float_linear");

    this.initShaders();
    this.initFBOs();
    this.setupPointerListeners();
    this.start();
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error("[FluidEngine VS Error]", gl.getShaderInfoLog(vs));
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error("[FluidEngine FS Error]", gl.getShaderInfoLog(fs));
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[FluidEngine Program Link Error]", gl.getProgramInfoLog(program));
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

    this.quadBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      this.gl.STATIC_DRAW
    );
  }

  private createFBO(
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number
  ): FBO {
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

  private createDoubleFBO(
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number
  ): DoubleFBO {
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
    const simRes = this.props.simResolution;
    const dyeRes = this.props.dyeResolution;

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

  public splat(
    x: number,
    y: number,
    dx: number,
    dy: number,
    color: RGBColor,
    radiusMultiplier = 1.0
  ) {
    const gl = this.gl;
    const radius = (this.props.splatRadius * radiusMultiplier) / 100.0;

    // 1. Splat Velocity
    gl.viewport(0, 0, this.velocity.width, this.velocity.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
    gl.useProgram(this.splatProgram);
    gl.uniform1i(gl.getUniformLocation(this.splatProgram, "uTarget"), this.velocity.read.attach(0));
    gl.uniform1f(gl.getUniformLocation(this.splatProgram, "uAspectRatio"), this.canvas.width / this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.splatProgram, "uPoint"), x, y);
    gl.uniform3f(gl.getUniformLocation(this.splatProgram, "uColor"), dx, dy, 0.0);
    gl.uniform1f(gl.getUniformLocation(this.splatProgram, "uRadius"), radius);
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

  private getNextColor(): RGBColor {
    const palette = this.props.colors;
    const hex = palette[this.colorIndex % palette.length];
    this.colorIndex++;
    return hexToRGB(hex);
  }

  private setupPointerListeners() {
    const onPointerMove = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;
      const now = performance.now();

      const p = this.pointers.get(e.pointerId);
      if (p) {
        const dt = Math.max((now - p.time) / 1000, 0.001);
        const dx = ((x - p.prevX) / dt) * (this.props.splatForce / 60);
        const dy = ((y - p.prevY) / dt) * (this.props.splatForce / 60);

        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          const color = this.getNextColor();
          this.splat(x, y, dx, dy, color);
        }

        p.prevX = x;
        p.prevY = y;
        p.time = now;
      } else {
        this.pointers.set(e.pointerId, {
          id: e.pointerId,
          x,
          y,
          prevX: x,
          prevY: y,
          time: now,
          down: true,
        });
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;
      const now = performance.now();

      this.pointers.set(e.pointerId, {
        id: e.pointerId,
        x,
        y,
        prevX: x,
        prevY: y,
        time: now,
        down: true,
      });

      // Single concentrated ink drop splat on click
      const color = this.getNextColor();
      const angle = Math.random() * Math.PI * 2;
      const impulse = 500.0;
      this.splat(x, y, Math.cos(angle) * impulse, Math.sin(angle) * impulse, color, 1.8);
    };

    const onPointerUp = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
    };

    // Attach to window so clicks/scrolls on UI above are never blocked
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });

    this.cleanupListeners = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };

    // Initial burst on load
    setTimeout(() => {
      if (this.isDestroyed) return;
      for (let i = 0; i < 3; i++) {
        const angle = Math.random() * Math.PI * 2;
        this.splat(
          0.3 + Math.random() * 0.4,
          0.4 + Math.random() * 0.3,
          Math.cos(angle) * 600,
          Math.sin(angle) * 600,
          this.getNextColor(),
          1.4
        );
      }
    }, 120);
  }

  public updateSize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  public updateProps(newProps: Partial<FluidBackgroundProps>) {
    Object.assign(this.props, newProps);
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
    gl.uniform1f(gl.getUniformLocation(this.vorticityProgram, "uCurlScale"), this.props.curl);
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
    gl.uniform1f(gl.getUniformLocation(this.clearProgram, "uPressureDecay"), 0.8);
    this.renderQuad();
    this.pressure.swap();

    // 5. Pressure (Jacobi Relaxation)
    gl.useProgram(this.pressureProgram);
    gl.uniform2f(gl.getUniformLocation(this.pressureProgram, "uTexelSize"), 1.0 / this.velocity.width, 1.0 / this.velocity.height);
    gl.uniform1i(gl.getUniformLocation(this.pressureProgram, "uDivergence"), this.divergence.attach(1));
    for (let i = 0; i < this.props.pressureIterations; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.write.fbo);
      gl.uniform1i(gl.getUniformLocation(this.pressureProgram, "uPressure"), this.pressure.read.attach(0));
      this.renderQuad();
      this.pressure.swap();
    }

    // 6. Subtract Gradient
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
    gl.uniform1f(gl.getUniformLocation(this.advectionProgram, "uDissipation"), 1.0 - this.props.velocityDissipation);
    this.renderQuad();
    this.velocity.swap();

    // 8. Advect Dye Color
    gl.viewport(0, 0, this.density.width, this.density.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.density.write.fbo);
    gl.uniform2f(gl.getUniformLocation(this.advectionProgram, "uTexelSize"), 1.0 / this.velocity.width, 1.0 / this.velocity.height);
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, "uVelocity"), this.velocity.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, "uSource"), this.density.read.attach(1));
    gl.uniform1f(gl.getUniformLocation(this.advectionProgram, "uDissipation"), 1.0 - this.props.densityDissipation);
    this.renderQuad();
    this.density.swap();

    // 9. Composite to Canvas
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.displayProgram);
    gl.uniform1i(gl.getUniformLocation(this.displayProgram, "uDye"), this.density.read.attach(0));
    gl.uniform2f(gl.getUniformLocation(this.displayProgram, "uResolution"), this.canvas.width, this.canvas.height);
    gl.uniform1f(
      gl.getUniformLocation(this.displayProgram, "uBloomIntensity"),
      this.props.bloom ? this.props.bloomIntensity : 0.0
    );

    // Background color uniform: [r, g, b, isTransparent]
    const isTransparent = this.props.backgroundColor === "transparent" ? 1.0 : 0.0;
    const bgRGB = isTransparent ? { r: 0, g: 0, b: 0 } : hexToRGB(this.props.backgroundColor);
    gl.uniform4f(
      gl.getUniformLocation(this.displayProgram, "uBackgroundColor"),
      bgRGB.r,
      bgRGB.g,
      bgRGB.b,
      isTransparent
    );

    this.renderQuad();
  }

  private loop = (now: number) => {
    if (this.isDestroyed) return;

    const frameTime = now - this.lastTime;
    // Reduce background fluid simulation speed by 25% (dt * 0.75)
    const dt = Math.min(frameTime / 1000, 0.033) * 0.75;
    this.lastTime = now;

    // Rolling Frame Time Monitor: Auto-downgrade resolution if frame time exceeds 20ms over 30 frames
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > 30) {
      this.frameTimes.shift();
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      if (avg > 20.0 && this.props.simResolution > 64) {
        this.props.simResolution = 64;
        this.props.dyeResolution = 512;
        this.props.pressureIterations = 16;
        this.destroyFBOs();
        this.initFBOs();
      }
    }

    // Auto-Generate Idle Splats (paced smoothly)
    if (
      this.props.autoSplatIntervalMs > 0 &&
      now - this.autoSplatTimer > this.props.autoSplatIntervalMs
    ) {
      this.autoSplatTimer = now;
      const angle = Math.random() * Math.PI * 2;
      const color = this.getNextColor();
      this.splat(
        0.2 + Math.random() * 0.6,
        0.25 + Math.random() * 0.5,
        Math.cos(angle) * 412.5,
        Math.sin(angle) * 412.5,
        color,
        1.2
      );
    }

    this.step(dt);
    this.animId = requestAnimationFrame(this.loop);
  };

  public start() {
    this.lastTime = performance.now();
    this.autoSplatTimer = performance.now();
    this.animId = requestAnimationFrame(this.loop);
  }

  private destroyFBO(fbo: FBO) {
    const gl = this.gl;
    if (fbo.texture) gl.deleteTexture(fbo.texture);
    if (fbo.fbo) gl.deleteFramebuffer(fbo.fbo);
  }

  private destroyFBOs() {
    this.destroyFBO(this.density.read);
    this.destroyFBO(this.density.write);
    this.destroyFBO(this.velocity.read);
    this.destroyFBO(this.velocity.write);
    this.destroyFBO(this.divergence);
    this.destroyFBO(this.curl);
    this.destroyFBO(this.pressure.read);
    this.destroyFBO(this.pressure.write);
  }

  public destroy() {
    this.isDestroyed = true;
    cancelAnimationFrame(this.animId);

    if (this.cleanupListeners) {
      this.cleanupListeners();
      this.cleanupListeners = null;
    }

    const gl = this.gl;
    if (!gl) return;

    this.destroyFBOs();

    if (this.quadBuffer) {
      gl.deleteBuffer(this.quadBuffer);
      this.quadBuffer = null;
    }

    const programs = [
      this.splatProgram,
      this.advectionProgram,
      this.divergenceProgram,
      this.curlProgram,
      this.vorticityProgram,
      this.clearProgram,
      this.pressureProgram,
      this.gradSubtractProgram,
      this.displayProgram,
    ];

    programs.forEach((prog) => {
      if (prog) gl.deleteProgram(prog);
    });
  }
}
