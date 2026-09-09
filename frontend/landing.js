// ChhayaSwara Real-Time WebGL Fluid Engine & Scroll Controller

"use strict";
(function () {
  const canvas = document.getElementById('c');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const config = {
    SIM_RESOLUTION:192, DYE_RESOLUTION:1024,
    DENSITY_DISSIPATION:0.74, VELOCITY_DISSIPATION:0.962,
    PRESSURE:0.8, PRESSURE_ITERATIONS:26, CURL:16,
    SPLAT_RADIUS:0.28, SPLAT_FORCE:2700,
    SHADING:true, BLOOM:true, BLOOM_ITERATIONS:8, BLOOM_RESOLUTION:256,
    BLOOM_INTENSITY:0.85, BLOOM_THRESHOLD:0.58, BLOOM_SOFT_KNEE:0.7,
    COLOR_UPDATE_SPEED:5.25, AUTO_PAINT:true, PAUSED:false,
  };
  if (reduceMotion){ config.PRESSURE_ITERATIONS=18; config.SIM_RESOLUTION=160; config.DYE_RESOLUTION=768; }

  const { gl, ext } = getWebGLContext(canvas);
  if (!gl){ drawFallback(); return; }
  if (!ext.supportLinearFiltering){ config.DYE_RESOLUTION=512; config.SHADING=false; config.BLOOM=false; }

  function getWebGLContext(canvas){
    const params={alpha:true,depth:false,stencil:false,antialias:false,preserveDrawingBuffer:false,premultipliedAlpha:false};
    let gl=canvas.getContext('webgl2',params); const isWebGL2=!!gl;
    if(!isWebGL2) gl=canvas.getContext('webgl',params)||canvas.getContext('experimental-webgl',params);
    if(!gl) return {gl:null,ext:null};
    let halfFloat,supportLinearFiltering;
    if(isWebGL2){ gl.getExtension('EXT_color_buffer_float'); supportLinearFiltering=!!gl.getExtension('OES_texture_float_linear'); }
    else { halfFloat=gl.getExtension('OES_texture_half_float'); supportLinearFiltering=!!gl.getExtension('OES_texture_half_float_linear'); }
    gl.clearColor(0.01,0.02,0.05,1.0);
    const halfFloatTexType=isWebGL2?gl.HALF_FLOAT:(halfFloat?halfFloat.HALF_FLOAT_OES:null);
    let formatRGBA,formatRG,formatR;
    if(isWebGL2){ formatRGBA=getSupportedFormat(gl,gl.RGBA16F,gl.RGBA,halfFloatTexType); formatRG=getSupportedFormat(gl,gl.RG16F,gl.RG,halfFloatTexType); formatR=getSupportedFormat(gl,gl.R16F,gl.RED,halfFloatTexType); }
    else { formatRGBA=getSupportedFormat(gl,gl.RGBA,gl.RGBA,halfFloatTexType); formatRG=getSupportedFormat(gl,gl.RGBA,gl.RGBA,halfFloatTexType); formatR=getSupportedFormat(gl,gl.RGBA,gl.RGBA,halfFloatTexType); }
    return {gl,ext:{isWebGL2,formatRGBA,formatRG,formatR,halfFloatTexType,supportLinearFiltering}};
  }
  function getSupportedFormat(gl,internalFormat,format,type){
    if(!supportRenderTextureFormat(gl,internalFormat,format,type)){ switch(internalFormat){ case gl.R16F: return getSupportedFormat(gl,gl.RG16F,gl.RG,type); case gl.RG16F: return getSupportedFormat(gl,gl.RGBA16F,gl.RGBA,type); default: return null; } }
    return {internalFormat,format};
  }
  function supportRenderTextureFormat(gl,internalFormat,format,type){
    const texture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,internalFormat,4,4,0,format,type,null);
    const fbo=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER); gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return status===gl.FRAMEBUFFER_COMPLETE;
  }
  function compileShader(type,source,keywords){ source=addKeywords(source,keywords); const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s)); return s; }
  function addKeywords(source,keywords){ if(!keywords) return source; let p=''; keywords.forEach(k=>p+='#define '+k+'\n'); return p+source; }
  function createProgram(vs,fs){ const p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) console.warn(gl.getProgramInfoLog(p)); return p; }
  function getUniforms(program){ const u={}; const c=gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS); for(let i=0;i<c;i++){ const n=gl.getActiveUniform(program,i).name; u[n]=gl.getUniformLocation(program,n); } return u; }
  class Program{ constructor(vs,fs){ this.program=createProgram(vs,fs); this.uniforms=getUniforms(this.program); } bind(){ gl.useProgram(this.program); } }
  class Material{ constructor(vs,src){ this.vertexShader=vs; this.fragmentShaderSource=src; this.programs={}; this.activeProgram=null; this.uniforms={}; }
    setKeywords(kw){ let h=0; for(let i=0;i<kw.length;i++) h+=hashCode(kw[i]); let p=this.programs[h]; if(p==null){ const fs=compileShader(gl.FRAGMENT_SHADER,this.fragmentShaderSource,kw); p=createProgram(this.vertexShader,fs); this.programs[h]=p; } if(p===this.activeProgram) return; this.uniforms=getUniforms(p); this.activeProgram=p; }
    bind(){ gl.useProgram(this.activeProgram); } }
  function hashCode(s){ if(s.length===0) return 0; let h=0; for(let i=0;i<s.length;i++){ h=(h<<5)-h+s.charCodeAt(i); h|=0; } return h; }

  const baseVertexShader=compileShader(gl.VERTEX_SHADER,`precision highp float; attribute vec2 aPosition; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform vec2 texelSize; void main(){ vUv=aPosition*0.5+0.5; vL=vUv-vec2(texelSize.x,0.0); vR=vUv+vec2(texelSize.x,0.0); vT=vUv+vec2(0.0,texelSize.y); vB=vUv-vec2(0.0,texelSize.y); gl_Position=vec4(aPosition,0.0,1.0); }`);
  const copyShader=compileShader(gl.FRAGMENT_SHADER,`precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; uniform sampler2D uTexture; void main(){ gl_FragColor=texture2D(uTexture,vUv); }`);
  const clearShader=compileShader(gl.FRAGMENT_SHADER,`precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value; void main(){ gl_FragColor=value*texture2D(uTexture,vUv); }`);
  const displayShaderSource=`precision highp float; precision highp sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uTexture; uniform sampler2D uBloom; uniform vec2 texelSize; vec3 linearToGamma(vec3 c){ c=max(c,vec3(0.0)); return max(1.055*pow(c,vec3(0.416666667))-0.055,vec3(0.0)); } void main(){ vec3 c=texture2D(uTexture,vUv).rgb;
    #ifdef SHADING
      vec3 lc=texture2D(uTexture,vL).rgb; vec3 rc=texture2D(uTexture,vR).rgb; vec3 tc=texture2D(uTexture,vT).rgb; vec3 bc=texture2D(uTexture,vB).rgb;
      float dx=length(rc)-length(lc); float dy=length(tc)-length(bc); vec3 n=normalize(vec3(dx,dy,length(texelSize))); vec3 l=vec3(0.0,0.0,1.0); float diffuse=clamp(dot(n,l)+0.7,0.7,1.0); c*=diffuse;
    #endif
    #ifdef BLOOM
      vec3 bloom=texture2D(uBloom,vUv).rgb; bloom=linearToGamma(bloom); c+=bloom;
    #endif
      c=max(c,vec3(0.0)); float lum=max(c.r,max(c.g,c.b)); if(lum>0.0001){ float mapped=lum/(1.0+0.55*max(lum-0.85,0.0)); mapped=min(mapped,0.97); c*=mapped/lum; } float a=max(c.r,max(c.g,c.b)); gl_FragColor=vec4(c,a); }`;
  const splatShader=compileShader(gl.FRAGMENT_SHADER,`precision highp float; precision highp sampler2D; varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius; void main(){ vec2 p=vUv-point.xy; p.x*=aspectRatio; vec3 splat=exp(-dot(p,p)/radius)*color; vec3 base=texture2D(uTarget,vUv).xyz; gl_FragColor=vec4(base+splat,1.0); }`);
  const advectionShader=compileShader(gl.FRAGMENT_SHADER,`precision highp float; precision highp sampler2D; varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform vec2 dyeTexelSize; uniform float dt; uniform float dissipation; vec4 bilerp(sampler2D sam,vec2 uv,vec2 tsize){ vec2 st=uv/tsize-0.5; vec2 iuv=floor(st); vec2 fuv=fract(st); vec4 a=texture2D(sam,(iuv+vec2(0.5,0.5))*tsize); vec4 b=texture2D(sam,(iuv+vec2(1.5,0.5))*tsize); vec4 c=texture2D(sam,(iuv+vec2(0.5,1.5))*tsize); vec4 d=texture2D(sam,(iuv+vec2(1.5,1.5))*tsize); return mix(mix(a,b,fuv.x),mix(c,d,fuv.x),fuv.y); } void main(){
    #ifdef MANUAL_FILTERING
      vec2 coord=vUv-dt*bilerp(uVelocity,vUv,texelSize).xy*texelSize; vec4 result=bilerp(uSource,coord,dyeTexelSize);
    #else
      vec2 coord=vUv-dt*texture2D(uVelocity,vUv).xy*texelSize; vec4 result=texture2D(uSource,coord);
    #endif
      float decay=1.0+dissipation*dt; gl_FragColor=result/decay; }`, ext.supportLinearFiltering?null:['MANUAL_FILTERING']);
  const divergenceShader=compileShader(gl.FRAGMENT_SHADER,`precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uVelocity; void main(){ float L=texture2D(uVelocity,vL).x; float R=texture2D(uVelocity,vR).x; float T=texture2D(uVelocity,vT).y; float B=texture2D(uVelocity,vB).y; vec2 C=texture2D(uVelocity,vUv).xy; if(vL.x<0.0){L=-C.x;} if(vR.x>1.0){R=-C.x;} if(vT.y>1.0){T=-C.y;} if(vB.y<0.0){B=-C.y;} float div=0.5*(R-L+T-B); gl_FragColor=vec4(div,0.0,0.0,1.0); }`);
  const curlShader=compileShader(gl.FRAGMENT_SHADER,`precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uVelocity; void main(){ float L=texture2D(uVelocity,vL).y; float R=texture2D(uVelocity,vR).y; float T=texture2D(uVelocity,vT).x; float B=texture2D(uVelocity,vB).x; float vorticity=R-L-T+B; gl_FragColor=vec4(0.5*vorticity,0.0,0.0,1.0); }`);
  const vorticityShader=compileShader(gl.FRAGMENT_SHADER,`precision highp float; precision highp sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt; void main(){ float L=texture2D(uCurl,vL).x; float R=texture2D(uCurl,vR).x; float T=texture2D(uCurl,vT).x; float B=texture2D(uCurl,vB).x; float C=texture2D(uCurl,vUv).x; vec2 force=0.5*vec2(abs(T)-abs(B),abs(R)-abs(L)); force/=length(force)+0.0001; force*=curl*C; force.y*=-1.0; vec2 velocity=texture2D(uVelocity,vUv).xy; velocity+=force*dt; velocity=min(max(velocity,-1000.0),1000.0); gl_FragColor=vec4(velocity,0.0,1.0); }`);
  const pressureShader=compileShader(gl.FRAGMENT_SHADER,`precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uPressure; uniform sampler2D uDivergence; void main(){ float L=texture2D(uPressure,vL).x; float R=texture2D(uPressure,vR).x; float T=texture2D(uPressure,vT).x; float B=texture2D(uPressure,vB).x; float divergence=texture2D(uDivergence,vUv).x; float pressure=(L+R+B+T-divergence)*0.25; gl_FragColor=vec4(pressure,0.0,0.0,1.0); }`);
  const gradientSubtractShader=compileShader(gl.FRAGMENT_SHADER,`precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uPressure; uniform sampler2D uVelocity; void main(){ float L=texture2D(uPressure,vL).x; float R=texture2D(uPressure,vR).x; float T=texture2D(uPressure,vT).x; float B=texture2D(uPressure,vB).x; vec2 velocity=texture2D(uVelocity,vUv).xy; velocity.xy-=vec2(R-L,T-B); gl_FragColor=vec4(velocity,0.0,1.0); }`);
  const bloomPrefilterShader=compileShader(gl.FRAGMENT_SHADER,`precision mediump float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTexture; uniform vec3 curve; uniform float threshold; void main(){ vec3 c=texture2D(uTexture,vUv).rgb; float br=max(c.r,max(c.g,c.b)); float rq=clamp(br-curve.x,0.0,curve.y); rq=curve.z*rq*rq; c*=max(rq,br-threshold)/max(br,0.0001); gl_FragColor=vec4(c,0.0); }`);
  const bloomBlurShader=compileShader(gl.FRAGMENT_SHADER,`precision mediump float; precision mediump sampler2D; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uTexture; void main(){ vec4 sum=vec4(0.0); sum+=texture2D(uTexture,vL); sum+=texture2D(uTexture,vR); sum+=texture2D(uTexture,vT); sum+=texture2D(uTexture,vB); sum*=0.25; gl_FragColor=sum; }`);
  const bloomFinalShader=compileShader(gl.FRAGMENT_SHADER,`precision mediump float; precision mediump sampler2D; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uTexture; uniform float intensity; void main(){ vec4 sum=vec4(0.0); sum+=texture2D(uTexture,vL); sum+=texture2D(uTexture,vR); sum+=texture2D(uTexture,vT); sum+=texture2D(uTexture,vB); sum*=0.25; gl_FragColor=sum*intensity; }`);

  const blit=(()=>{ gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,-1,1,1,1,1,-1]),gl.STATIC_DRAW); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,1,2,0,2,3]),gl.STATIC_DRAW); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(0); return (target,clear=false)=>{ if(target==null){ gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER,null);} else { gl.viewport(0,0,target.width,target.height); gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);} if(clear){ gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);} gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0); }; })();

  function createFBO(w,h,internalFormat,format,type,param){ gl.activeTexture(gl.TEXTURE0); const texture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,param); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,param); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D,0,internalFormat,w,h,0,format,type,null); const fbo=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0); gl.viewport(0,0,w,h); gl.clear(gl.COLOR_BUFFER_BIT); const texelSizeX=1.0/w,texelSizeY=1.0/h; return {texture,fbo,width:w,height:h,texelSizeX,texelSizeY,attach(id){ gl.activeTexture(gl.TEXTURE0+id); gl.bindTexture(gl.TEXTURE_2D,texture); return id; }}; }
  function createDoubleFBO(w,h,iF,f,t,p){ let a=createFBO(w,h,iF,f,t,p); let b=createFBO(w,h,iF,f,t,p); return {width:w,height:h,texelSizeX:a.texelSizeX,texelSizeY:a.texelSizeY,get read(){return a;},set read(v){a=v;},get write(){return b;},set write(v){b=v;},swap(){const t=a;a=b;b=t;}}; }
  function resizeFBO(target,w,h,iF,f,t,p){ const n=createFBO(w,h,iF,f,t,p); copyProgram.bind(); gl.uniform1i(copyProgram.uniforms.uTexture,target.attach(0)); blit(n); return n; }
  function resizeDoubleFBO(target,w,h,iF,f,t,p){ if(target.width===w&&target.height===h) return target; target.read=resizeFBO(target.read,w,h,iF,f,t,p); target.write=createFBO(w,h,iF,f,t,p); target.width=w; target.height=h; target.texelSizeX=1.0/w; target.texelSizeY=1.0/h; return target; }

  const copyProgram=new Program(baseVertexShader,copyShader);
  const clearProgram=new Program(baseVertexShader,clearShader);
  const splatProgram=new Program(baseVertexShader,splatShader);
  const advectionProgram=new Program(baseVertexShader,advectionShader);
  const divergenceProgram=new Program(baseVertexShader,divergenceShader);
  const curlProgram=new Program(baseVertexShader,curlShader);
  const vorticityProgram=new Program(baseVertexShader,vorticityShader);
  const pressureProgram=new Program(baseVertexShader,pressureShader);
  const gradienSubtractProgram=new Program(baseVertexShader,gradientSubtractShader);
  const bloomPrefilterProgram=new Program(baseVertexShader,bloomPrefilterShader);
  const bloomBlurProgram=new Program(baseVertexShader,bloomBlurShader);
  const bloomFinalProgram=new Program(baseVertexShader,bloomFinalShader);
  const displayMaterial=new Material(baseVertexShader,displayShaderSource);

  let dye,velocity,divergence,curl,pressure; let bloom; let bloomFramebuffers=[];
  function getResolution(r){ let ar=gl.drawingBufferWidth/gl.drawingBufferHeight; if(ar<1) ar=1.0/ar; const min=Math.round(r); const max=Math.round(r*ar); if(gl.drawingBufferWidth>gl.drawingBufferHeight) return {width:max,height:min}; return {width:min,height:max}; }
  function initFramebuffers(){ const simRes=getResolution(config.SIM_RESOLUTION); const dyeRes=getResolution(config.DYE_RESOLUTION); const texType=ext.halfFloatTexType; const rgba=ext.formatRGBA,rg=ext.formatRG,r=ext.formatR; const filtering=ext.supportLinearFiltering?gl.LINEAR:gl.NEAREST; gl.disable(gl.BLEND);
    if(!dye) dye=createDoubleFBO(dyeRes.width,dyeRes.height,rgba.internalFormat,rgba.format,texType,filtering); else dye=resizeDoubleFBO(dye,dyeRes.width,dyeRes.height,rgba.internalFormat,rgba.format,texType,filtering);
    if(!velocity) velocity=createDoubleFBO(simRes.width,simRes.height,rg.internalFormat,rg.format,texType,filtering); else velocity=resizeDoubleFBO(velocity,simRes.width,simRes.height,rg.internalFormat,rg.format,texType,filtering);
    divergence=createFBO(simRes.width,simRes.height,r.internalFormat,r.format,texType,gl.NEAREST);
    curl=createFBO(simRes.width,simRes.height,r.internalFormat,r.format,texType,gl.NEAREST);
    pressure=createDoubleFBO(simRes.width,simRes.height,r.internalFormat,r.format,texType,gl.NEAREST);
    initBloomFramebuffers();
  }
  function initBloomFramebuffers(){ if(!config.BLOOM) return; const res=getResolution(config.BLOOM_RESOLUTION); const texType=ext.halfFloatTexType; const rgba=ext.formatRGBA; const filtering=ext.supportLinearFiltering?gl.LINEAR:gl.NEAREST; bloom=createFBO(res.width,res.height,rgba.internalFormat,rgba.format,texType,filtering); bloomFramebuffers.length=0; for(let i=0;i<config.BLOOM_ITERATIONS;i++){ const w=res.width>>(i+1); const h=res.height>>(i+1); if(w<2||h<2) break; bloomFramebuffers.push(createFBO(w,h,rgba.internalFormat,rgba.format,texType,filtering)); } }
  function updateKeywords(){ const kw=[]; if(config.SHADING) kw.push('SHADING'); if(config.BLOOM) kw.push('BLOOM'); displayMaterial.setKeywords(kw); }
  updateKeywords(); initFramebuffers();

  // ---- palettes ----
  const PALETTES = {
    ink:   [[0.04,0.14,0.65],[0.06,0.30,0.85],[0.04,0.52,0.96],[0.08,0.72,0.98],[0.18,0.86,0.96],[0.10,0.38,0.90]],
    ash:   [[0.10,0.18,0.32],[0.14,0.24,0.40],[0.18,0.30,0.48],[0.22,0.36,0.52],[0.16,0.28,0.44],[0.12,0.20,0.36]],
    steel: [[0.08,0.28,0.68],[0.14,0.44,0.80],[0.18,0.62,0.85],[0.35,0.75,0.90],[0.18,0.42,0.76],[0.10,0.24,0.62]],
    smoke: [[0.10,0.16,0.26],[0.16,0.24,0.34],[0.22,0.30,0.40],[0.18,0.26,0.36],[0.14,0.20,0.30],[0.08,0.14,0.22]],
    neon:  [[0.05,0.65,0.98],[0.10,0.42,0.96],[0.15,0.88,0.98],[0.06,0.30,0.88],[0.20,0.82,1.00],[0.04,0.52,0.92]],
    calm:  [[0.12,0.32,0.56],[0.16,0.44,0.62],[0.22,0.58,0.68],[0.28,0.54,0.62],[0.18,0.40,0.58],[0.12,0.30,0.52]],
    ember: [[0.05,0.20,0.68],[0.08,0.42,0.86],[0.12,0.68,0.96],[0.22,0.86,0.98],[0.10,0.52,0.90],[0.04,0.32,0.78]],
  };
  let paletteCur = PALETTES.ink.map(a=>a.slice());
  let paletteTgt = PALETTES.ink.map(a=>a.slice());
  let paletteT = Math.random()*paletteCur.length;
  function paletteColor(t){ const n=paletteCur.length; const idx=((t%n)+n)%n; const i0=Math.floor(idx); const i1=(i0+1)%n; const f=idx-i0; const a=paletteCur[i0],b=paletteCur[i1]; return {r:a[0]+(b[0]-a[0])*f,g:a[1]+(b[1]-a[1])*f,b:a[2]+(b[2]-a[2])*f}; }
  function generateColor(){ paletteT+=0.45+Math.random()*0.6; const c=paletteColor(paletteT); const s=0.16; return {r:c.r*s,g:c.g*s,b:c.b*s}; }

  // ---- config target tweening ----
  const TWEEN_KEYS=['CURL','SPLAT_FORCE','BLOOM_INTENSITY','DENSITY_DISSIPATION'];
  const target={}; TWEEN_KEYS.forEach(k=>target[k]=config[k]);
  function tweenStep(){ const k=0.045; TWEEN_KEYS.forEach(key=>{ config[key]+=(target[key]-config[key])*k; }); for(let i=0;i<paletteCur.length;i++){ for(let j=0;j<3;j++){ paletteCur[i][j]+=(paletteTgt[i][j]-paletteCur[i][j])*k; } } }

  function pointerPrototype(){ return {id:-1,down:false,moved:false,texcoordX:0,texcoordY:0,prevTexcoordX:0,prevTexcoordY:0,deltaX:0,deltaY:0,color:{r:0.1,g:0.04,b:0.16}}; }
  const pointers=[pointerPrototype()];
  function updatePointerDown(p,id,x,y){ p.id=id; p.down=true; p.moved=false; p.texcoordX=x/canvas.width; p.texcoordY=1.0-y/canvas.height; p.prevTexcoordX=p.texcoordX; p.prevTexcoordY=p.texcoordY; p.deltaX=0; p.deltaY=0; p.color=generateColor(); }
  function updatePointerMove(p,x,y){ p.prevTexcoordX=p.texcoordX; p.prevTexcoordY=p.texcoordY; p.texcoordX=x/canvas.width; p.texcoordY=1.0-y/canvas.height; p.deltaX=correctDeltaX(p.texcoordX-p.prevTexcoordX); p.deltaY=correctDeltaY(p.texcoordY-p.prevTexcoordY); p.moved=Math.abs(p.deltaX)>0||Math.abs(p.deltaY)>0; }
  function correctDeltaX(d){ const ar=canvas.width/canvas.height; if(ar<1) d*=ar; return d; }
  function correctDeltaY(d){ const ar=canvas.width/canvas.height; if(ar>1) d/=ar; return d; }
  function correctRadius(r){ const ar=canvas.width/canvas.height; if(ar>1) r*=ar; return r; }

  function splat(x,y,dx,dy,color){ splatProgram.bind(); gl.uniform1i(splatProgram.uniforms.uTarget,velocity.read.attach(0)); gl.uniform1f(splatProgram.uniforms.aspectRatio,canvas.width/canvas.height); gl.uniform2f(splatProgram.uniforms.point,x,y); gl.uniform3f(splatProgram.uniforms.color,dx,dy,0.0); gl.uniform1f(splatProgram.uniforms.radius,correctRadius(config.SPLAT_RADIUS/100.0)); blit(velocity.write); velocity.swap(); gl.uniform1i(splatProgram.uniforms.uTarget,dye.read.attach(0)); gl.uniform3f(splatProgram.uniforms.color,color.r,color.g,color.b); blit(dye.write); dye.swap(); }
  function splatPointer(p){ const dx=p.deltaX*config.SPLAT_FORCE; const dy=p.deltaY*config.SPLAT_FORCE; splat(p.texcoordX,p.texcoordY,dx,dy,p.color); }
  function clickSplat(p){ const color=generateColor(); color.r*=9; color.g*=9; color.b*=9; const dx=10*(Math.random()-0.5); const dy=30*(Math.random()-0.5); splat(p.texcoordX,p.texcoordY,dx,dy,color); }
  const splatStack=[];
  function multipleSplats(n){ for(let i=0;i<n;i++){ const color=generateColor(); color.r*=10; color.g*=10; color.b*=10; const x=Math.random(),y=Math.random(); const dx=1000*(Math.random()-0.5); const dy=1000*(Math.random()-0.5); splat(x,y,dx,dy,color); } }

  function step(dt){ gl.disable(gl.BLEND);
    curlProgram.bind(); gl.uniform2f(curlProgram.uniforms.texelSize,velocity.texelSizeX,velocity.texelSizeY); gl.uniform1i(curlProgram.uniforms.uVelocity,velocity.read.attach(0)); blit(curl);
    vorticityProgram.bind(); gl.uniform2f(vorticityProgram.uniforms.texelSize,velocity.texelSizeX,velocity.texelSizeY); gl.uniform1i(vorticityProgram.uniforms.uVelocity,velocity.read.attach(0)); gl.uniform1i(vorticityProgram.uniforms.uCurl,curl.attach(1)); gl.uniform1f(vorticityProgram.uniforms.curl,config.CURL); gl.uniform1f(vorticityProgram.uniforms.dt,dt); blit(velocity.write); velocity.swap();
    divergenceProgram.bind(); gl.uniform2f(divergenceProgram.uniforms.texelSize,velocity.texelSizeX,velocity.texelSizeY); gl.uniform1i(divergenceProgram.uniforms.uVelocity,velocity.read.attach(0)); blit(divergence);
    clearProgram.bind(); gl.uniform1i(clearProgram.uniforms.uTexture,pressure.read.attach(0)); gl.uniform1f(clearProgram.uniforms.value,config.PRESSURE); blit(pressure.write); pressure.swap();
    pressureProgram.bind(); gl.uniform2f(pressureProgram.uniforms.texelSize,velocity.texelSizeX,velocity.texelSizeY); gl.uniform1i(pressureProgram.uniforms.uDivergence,divergence.attach(0)); for(let i=0;i<config.PRESSURE_ITERATIONS;i++){ gl.uniform1i(pressureProgram.uniforms.uPressure,pressure.read.attach(1)); blit(pressure.write); pressure.swap(); }
    gradienSubtractProgram.bind(); gl.uniform2f(gradienSubtractProgram.uniforms.texelSize,velocity.texelSizeX,velocity.texelSizeY); gl.uniform1i(gradienSubtractProgram.uniforms.uPressure,pressure.read.attach(0)); gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity,velocity.read.attach(1)); blit(velocity.write); velocity.swap();
    advectionProgram.bind(); gl.uniform2f(advectionProgram.uniforms.texelSize,velocity.texelSizeX,velocity.texelSizeY); if(!ext.supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize,velocity.texelSizeX,velocity.texelSizeY); gl.uniform1i(advectionProgram.uniforms.uVelocity,velocity.read.attach(0)); gl.uniform1i(advectionProgram.uniforms.uSource,velocity.read.attach(0)); gl.uniform1f(advectionProgram.uniforms.dt,dt); gl.uniform1f(advectionProgram.uniforms.dissipation,(1.0/config.VELOCITY_DISSIPATION-1.0)); blit(velocity.write); velocity.swap();
    if(!ext.supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize,dye.texelSizeX,dye.texelSizeY); gl.uniform1i(advectionProgram.uniforms.uVelocity,velocity.read.attach(0)); gl.uniform1i(advectionProgram.uniforms.uSource,dye.read.attach(1)); gl.uniform1f(advectionProgram.uniforms.dissipation,(1.0/config.DENSITY_DISSIPATION-1.0)); blit(dye.write); dye.swap();
  }
  function render(target){ if(config.BLOOM) applyBloom(dye.read,bloom); gl.disable(gl.BLEND); drawDisplay(target); }
  function drawDisplay(target){ const w=target==null?gl.drawingBufferWidth:target.width; const h=target==null?gl.drawingBufferHeight:target.height; displayMaterial.bind(); if(config.SHADING) gl.uniform2f(displayMaterial.uniforms.texelSize,1.0/w,1.0/h); gl.uniform1i(displayMaterial.uniforms.uTexture,dye.read.attach(0)); if(config.BLOOM) gl.uniform1i(displayMaterial.uniforms.uBloom,bloom.attach(1)); blit(target); }
  function applyBloom(source,destination){ if(bloomFramebuffers.length<2) return; let last=destination; gl.disable(gl.BLEND); bloomPrefilterProgram.bind(); const knee=config.BLOOM_THRESHOLD*config.BLOOM_SOFT_KNEE+0.0001; gl.uniform3f(bloomPrefilterProgram.uniforms.curve,config.BLOOM_THRESHOLD-knee,knee*2,0.25/knee); gl.uniform1f(bloomPrefilterProgram.uniforms.threshold,config.BLOOM_THRESHOLD); gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture,source.attach(0)); blit(last); bloomBlurProgram.bind(); for(let i=0;i<bloomFramebuffers.length;i++){ const dest=bloomFramebuffers[i]; gl.uniform2f(bloomBlurProgram.uniforms.texelSize,last.texelSizeX,last.texelSizeY); gl.uniform1i(bloomBlurProgram.uniforms.uTexture,last.attach(0)); blit(dest); last=dest; } gl.blendFunc(gl.ONE,gl.ONE); gl.enable(gl.BLEND); for(let i=bloomFramebuffers.length-2;i>=0;i--){ const baseTex=bloomFramebuffers[i]; gl.uniform2f(bloomBlurProgram.uniforms.texelSize,last.texelSizeX,last.texelSizeY); gl.uniform1i(bloomBlurProgram.uniforms.uTexture,last.attach(0)); gl.viewport(0,0,baseTex.width,baseTex.height); blit(baseTex); last=baseTex; } gl.disable(gl.BLEND); bloomFinalProgram.bind(); gl.uniform2f(bloomFinalProgram.uniforms.texelSize,last.texelSizeX,last.texelSizeY); gl.uniform1i(bloomFinalProgram.uniforms.uTexture,last.attach(0)); gl.uniform1f(bloomFinalProgram.uniforms.intensity,config.BLOOM_INTENSITY); blit(destination); }

  let lastUpdateTime=performance.now(); let colorUpdateTimer=0.0;
  function calcDeltaTime(now){ let dt=(now-lastUpdateTime)/1000; if(!(dt>0)) dt=0; dt=Math.min(dt,0.033); lastUpdateTime=now; return dt * 0.75; }
  function resizeCanvas(){ const dpr=Math.min(window.devicePixelRatio||1,2); const w=Math.floor(canvas.clientWidth*dpr); const h=Math.floor(canvas.clientHeight*dpr); if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; return true; } return false; }
  function updateColors(dt){ colorUpdateTimer+=dt*config.COLOR_UPDATE_SPEED; if(colorUpdateTimer>=1){ colorUpdateTimer%=1; pointers.forEach(p=>p.color=generateColor()); } }
  function applyInputs(){ if(splatStack.length>0) multipleSplats(splatStack.pop()); pointers.forEach(p=>{ if(p.moved){ p.moved=false; splatPointer(p); } }); }

  let autoT=Math.random()*1000; let autoAccum=0; let autoPrev=autoT;
  const AUTO_PAINT_INTERVAL=0.05; const AUTO_DYE_SCALE=0.85;
  const AUTO_EMITTERS=[{ax:0.40,ay:0.34,fx:0.43,fy:0.31,phx:0.0,phy:1.3},{ax:0.36,ay:0.30,fx:0.27,fy:0.52,phx:2.1,phy:0.4},{ax:0.30,ay:0.38,fx:0.61,fy:0.23,phx:4.0,phy:2.7}];
  function autoPos(e,t){ return {x:0.5+e.ax*Math.sin(t*e.fx+e.phx)*Math.cos(t*e.fy*0.6+e.phy),y:0.5+e.ay*Math.sin(t*e.fy+e.phy)}; }
  function autoPaintStep(dt){ autoT+=dt*0.465; autoAccum+=dt; if(autoAccum<AUTO_PAINT_INTERVAL) return; const span=autoAccum; autoAccum=0; const inv=span>0?(1.0/span):0.0; for(const e of AUTO_EMITTERS){ const p=autoPos(e,autoT),pp=autoPos(e,autoPrev); const dx=(p.x-pp.x)*inv*config.SPLAT_FORCE*0.30; const dy=(p.y-pp.y)*inv*config.SPLAT_FORCE*0.30; const color=generateColor(); color.r*=AUTO_DYE_SCALE; color.g*=AUTO_DYE_SCALE; color.b*=AUTO_DYE_SCALE; splat(p.x,p.y,dx,dy,color); } autoPrev=autoT; }

  let idleTimer=0;
  function frame(now){ const dt=calcDeltaTime(now); if(resizeCanvas()) initFramebuffers(); tweenStep(); updateColors(dt); applyInputs(); if(!pointers[0].down) idleTimer+=dt; else idleTimer=0; const doAuto=config.AUTO_PAINT||(idleTimer>5&&!reduceMotion)||reduceMotion; if(!config.PAUSED){ if(doAuto) autoPaintStep(dt); step(dt); } render(null); }
  function update(now){ frame(typeof now==='number'?now:performance.now()); requestAnimationFrame(update); }

  // ---- global hover painting (alive everywhere) ----
  function clientToCanvas(cx,cy){ const r=canvas.getBoundingClientRect(); return {x:(cx-r.left)*(canvas.width/r.width),y:(cy-r.top)*(canvas.height/r.height)}; }
  let lastMove=0;
  window.addEventListener('mousemove',e=>{ const now=performance.now(); if(now-lastMove<16) {} const pt=pointers[0]; const p=clientToCanvas(e.clientX,e.clientY); if(!pt.down){ pt.prevTexcoordX=pt.texcoordX||(p.x/canvas.width); pt.prevTexcoordY=pt.texcoordY||(1-p.y/canvas.height); } updatePointerMove(pt,p.x,p.y); if(!pt.down && pt.moved){ const dx=pt.deltaX*config.SPLAT_FORCE*0.42; const dy=pt.deltaY*config.SPLAT_FORCE*0.42; const c=pt.color; splat(pt.texcoordX,pt.texcoordY,dx,dy,{r:c.r*0.45,g:c.g*0.45,b:c.b*0.45}); pt.moved=false; } lastMove=now; });
  window.addEventListener('mousedown',e=>{ const p=clientToCanvas(e.clientX,e.clientY); updatePointerDown(pointers[0],-1,p.x,p.y); clickSplat(pointers[0]); });
  window.addEventListener('mouseup',()=>pointers[0].down=false);
  window.addEventListener('touchstart',e=>{ const t=e.targetTouches[0]; if(!t) return; const p=clientToCanvas(t.clientX,t.clientY); updatePointerDown(pointers[0],-1,p.x,p.y); clickSplat(pointers[0]); },{passive:true});
  window.addEventListener('touchmove',e=>{ const t=e.targetTouches[0]; if(!t) return; const p=clientToCanvas(t.clientX,t.clientY); updatePointerMove(pointers[0],p.x,p.y); },{passive:true});
  window.addEventListener('touchend',()=>pointers[0].down=false);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) lastUpdateTime=performance.now(); });

  function drawFallback(){ const ctx=canvas.getContext('2d'); if(!ctx) return; function fit(){canvas.width=innerWidth;canvas.height=innerHeight;} fit(); window.addEventListener('resize',fit); const g=ctx.createRadialGradient(innerWidth*0.5,innerHeight*0.45,40,innerWidth*0.5,innerHeight*0.45,Math.max(innerWidth,innerHeight)*0.7); g.addColorStop(0,'#041e42'); g.addColorStop(0.5,'#021024'); g.addColorStop(1,'#01050e'); ctx.fillStyle=g; ctx.fillRect(0,0,innerWidth,innerHeight); }

  resizeCanvas(); initFramebuffers();
  function seed(){ const bursts=reduceMotion?14:11; for(let i=0;i<bursts;i++){ const color=generateColor(); color.r*=8; color.g*=8; color.b*=8; const ang=(i/bursts)*Math.PI*2+Math.random()*0.6; const rad=0.10+(i/bursts)*0.30; const x=0.5+Math.cos(ang)*rad; const y=0.5+Math.sin(ang)*rad*0.9; const dx=-Math.sin(ang)*675+(Math.random()-0.5)*225; const dy=Math.cos(ang)*675+(Math.random()-0.5)*225; splat(x,y,dx,dy,color); } }
  seed();
  requestAnimationFrame(update);

  // ---- public API ----
  window.INK = {
    config, target,
    toState(obj){
      if(!obj) return;
      if(typeof obj==='string') obj={palette:obj};
      TWEEN_KEYS.forEach(k=>{ if(k in obj) target[k]=obj[k]; });
      if(obj.palette && PALETTES[obj.palette]) paletteTgt=PALETTES[obj.palette].map(a=>a.slice());
      if(obj.VELOCITY_DISSIPATION!=null) config.VELOCITY_DISSIPATION=obj.VELOCITY_DISSIPATION;
    },
    setNow(k,v){ if(k in config) config[k]=v; if(TWEEN_KEYS.includes(k)) target[k]=v; },
    burst(n=10){ splatStack.push(n); },
    // inject a directional splat at normalized coords (0..1, y down)
    splatNorm(x,y,dx,dy,strength=1){ const color=generateColor(); color.r*=8*strength; color.g*=8*strength; color.b*=8*strength; splat(x,1.0-y,dx,dy,color); },
    palettes:Object.keys(PALETTES),
    isWebGL2:ext.isWebGL2, reduceMotion
  };
})();



"use strict";
(function(){
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const $=(s,c=document)=>c.querySelector(s);
  const $$=(s,c=document)=>Array.from(c.querySelectorAll(s));
  const INK=window.INK;

  /* ---------- split kinetic text helpers (already authored in markup) ---------- */

  /* ---------- per-word stagger delays ---------- */
  $$('#manifesto .line, #cta h2').forEach(line=>{
    $$('.word',line).forEach((w,i)=>w.style.setProperty('--d',(i*0.07)+'s'));
  });

  /* ---------- scroll-driven reveals (ticker-based, deterministic) ---------- */
  let revealEls=$$('.reveal,.fade,.clipUp,.mask,.word').filter(el=>!el.closest('#hero'));
  function revealStep(){
    if(!revealEls.length) return;
    const trig=innerHeight*0.86;
    revealEls=revealEls.filter(el=>{ const r=el.getBoundingClientRect(); if(r.top<trig && r.bottom>0){ el.classList.add('in'); return false; } return true; });
  }

  function playHero(){
    $$('#hero .reveal,#hero .fade,#hero .mask,#hero .clipUp').forEach((el,i)=>{
      setTimeout(()=>el.classList.add('in'), 120 + i*90);
    });
    const hero=$('#hero'); if(hero) hero.classList.add('huddle');
    const hud=$('#hudStatus'); if(hud&&INK) hud.textContent=(INK.isWebGL2?'WebGL2':'WebGL1')+' · live';
  }

  /* ---------- preloader ---------- */
  const pre=$('#pre'), preCount=$('#preCount'), preBarI=$('#preBar i');
  function runPreloader(done){
    if(reduce){ pre.classList.add('gone'); done(); return; }
    let p=0; const start=performance.now(); const dur=2100;
    function tick(now){
      const t=clamp((now-start)/dur,0,1);
      // ease-out
      const e=1-Math.pow(1-t,2.2);
      p=Math.round(e*100);
      preCount.textContent=p;
      preBarI.style.width=(e*100)+'%';
      if(t<1){ requestAnimationFrame(tick); }
      else { setTimeout(()=>{ pre.classList.add('gone'); done(); }, 260); }
    }
    requestAnimationFrame(tick);
  }

  /* ---------- pointer tracking (for magnetic buttons only) ---------- */
  let mx=innerWidth/2,my=innerHeight/2;
  if(!coarse){ window.addEventListener('mousemove',e=>{ mx=e.clientX; my=e.clientY; },{passive:true}); }
  const magnets=$$('[data-magnetic]');
  function magnetStep(){
    if(coarse) return;
    magnets.forEach(el=>{
      const r=el.getBoundingClientRect();
      const cx=r.left+r.width/2, cy=r.top+r.height/2;
      const ddx=mx-cx, ddy=my-cy; const dist=Math.hypot(ddx,ddy);
      if(dist<r.width*0.9){ el.style.transform=`translate(${ddx*0.26}px,${ddy*0.36}px)`; }
      else { el.style.transform=''; }
    });
  }

  /* ---------- scroll index ---------- */
  const idxWrap=$('#idx');
  const idxSections=$$('section[data-idx]').filter(s=>s.getAttribute('data-idx'));
  idxSections.forEach((s,i)=>{
    const it=document.createElement('div'); it.className='it';
    it.innerHTML=`<span class="lab">${s.getAttribute('data-idx')}</span><span class="pip"></span>`;
    it.addEventListener('click',()=>s.scrollIntoView({behavior:'smooth'}));
    s._idxEl=it; idxWrap.appendChild(it);
  });

  /* ---------- count-ups ---------- */
  let countsDone=false;
  function runCounts(){
    if(countsDone) return; countsDone=true;
    $$('#spec [data-count]').forEach(el=>{
      const tgt=parseFloat(el.getAttribute('data-count')); const start=performance.now(); const dur=1400;
      function t(now){ const k=clamp((now-start)/dur,0,1); const e=1-Math.pow(1-k,3); el.firstChild ? el.textContent=Math.round(e*tgt) : null; el.textContent=Math.round(e*tgt); if(k<1) requestAnimationFrame(t); }
      requestAnimationFrame(t);
    });
  }
  const specIO=new IntersectionObserver(es=>{ es.forEach(e=>{ if(e.isIntersecting){ runCounts(); $$('#spec .spec').forEach(s=>s.classList.add('in')); specIO.disconnect(); } }); },{threshold:0.35});
  if($('#spec')) specIO.observe($('#spec'));

  /* ---------- TrueFocus band ---------- */
  (function setupTrueFocus(){
    const c=$('#trueFocus'); if(!c) return;
    const frame=$('.focus-frame',c);
    const words=(c.getAttribute('data-words')||'').split(' ').filter(Boolean);
    const spans=words.map(w=>{ const s=document.createElement('span'); s.className='focus-word'; s.textContent=w; c.appendChild(s); return s; });
    let idx=0, manual=false, manualIdx=0, active=false;
    function place(i){ const el=spans[i]; if(!el) return; const pr=c.getBoundingClientRect(); const r=el.getBoundingClientRect();
      frame.style.transform=`translate(${r.left-pr.left}px,${r.top-pr.top}px)`; frame.style.width=r.width+'px'; frame.style.height=r.height+'px'; frame.style.opacity='1';
      spans.forEach((s,j)=>s.classList.toggle('active', j===i)); }
    spans.forEach((s,i)=>{ s.addEventListener('mouseenter',()=>{ manual=true; manualIdx=i; place(i); }); s.addEventListener('mouseleave',()=>{ manual=false; }); });
    const fio=new IntersectionObserver(es=>es.forEach(e=>{ active=e.isIntersecting; if(active) place(manual?manualIdx:idx); }),{threshold:0.4});
    fio.observe(c);
    setInterval(()=>{ if(!active||manual) return; idx=(idx+1)%spans.length; place(idx); }, 1900);
    window.addEventListener('resize',()=>place(manual?manualIdx:idx),{passive:true});
    setTimeout(()=>place(0),140);
  })();

  /* ---------- DIRECT states ---------- */
  const directStates=[
    { name:'Sentry',      CURL:18, SPLAT_FORCE:2850, BLOOM_INTENSITY:0.85, DENSITY_DISSIPATION:0.74, palette:'ink',   desc:'Tight, vivid cobalt defense filaments &mdash; the <span class="s">signature</span> shield look.' },
    { name:'Radar',       CURL:6,  SPLAT_FORCE:1950, BLOOM_INTENSITY:0.34, DENSITY_DISSIPATION:0.93, palette:'smoke', desc:'Slow, high-contrast monochrome sonar &mdash; <span class="s">anomaly spike isolation</span>.' },
    { name:'Spectrogram', CURL:32, SPLAT_FORCE:4050, BLOOM_INTENSITY:1.28, DENSITY_DISSIPATION:0.68, palette:'neon',  desc:'Luminous electric cyan and neon &mdash; <span class="s">vocal tract harmonics</span>.' },
    { name:'BonaFide',    CURL:11, SPLAT_FORCE:1500, BLOOM_INTENSITY:0.55, DENSITY_DISSIPATION:0.82, palette:'calm',  desc:'Gentle organic emerald and teal drift &mdash; <span class="s">verified human voice</span>.' },
  ];
  const directWord=$('#directWord');
  const directDesc=$('#directDesc'), directBarI=$('#directBar i');
  const m_curl=$('#m_curl'),m_force=$('#m_force'),m_bloom=$('#m_bloom'),m_fade=$('#m_fade');
  const b_curl=$('#b_curl'),b_force=$('#b_force'),b_bloom=$('#b_bloom'),b_fade=$('#b_fade');
  let lastPaletteIdx=0;
  function swapWord(idx){
    if(!directWord) return;
    directWord.classList.add('out');
    setTimeout(()=>{
      directWord.textContent=directStates[idx].name;
      directWord.classList.remove('out'); directWord.classList.add('inq');
      // force reflow then animate in
      void directWord.offsetWidth;
      directWord.classList.remove('inq');
    },260);
  }
  function updateDirect(p){
    const n=directStates.length;
    const sf=clamp(p,0,1)*(n-1);
    const i0=Math.floor(sf), i1=Math.min(i0+1,n-1), f=sf-i0;
    const a=directStates[i0], b=directStates[i1];
    const cur=lerp(a.CURL,b.CURL,f), force=lerp(a.SPLAT_FORCE,b.SPLAT_FORCE,f), bloom=lerp(a.BLOOM_INTENSITY,b.BLOOM_INTENSITY,f), fade=lerp(a.DENSITY_DISSIPATION,b.DENSITY_DISSIPATION,f);
    const palIdx=Math.round(sf);
    if(INK){ INK.toState({CURL:cur,SPLAT_FORCE:force,BLOOM_INTENSITY:bloom,DENSITY_DISSIPATION:fade}); }
    if(m_curl){ m_curl.textContent=Math.round(cur); m_force.textContent=Math.round(force); m_bloom.textContent=bloom.toFixed(2); m_fade.textContent=fade.toFixed(2); }
    if(b_curl){ b_curl.style.width=clamp(cur/40*100,2,100)+'%'; b_force.style.width=clamp(force/6000*100,2,100)+'%'; b_bloom.style.width=clamp(bloom/1.4*100,2,100)+'%'; b_fade.style.width=clamp((fade-0.6)/0.35*100,2,100)+'%'; }
    if(palIdx!==lastPaletteIdx){
      if(INK) INK.toState({palette:directStates[palIdx].palette});
      swapWord(palIdx);
      directDesc.innerHTML=directStates[palIdx].desc;
      lastPaletteIdx=palIdx;
    }
    if(directBarI) directBarI.style.width=(clamp(p,0,1)*100)+'%';
  }
  if(directWord) directWord.textContent=directStates[0].name;
  updateDirect(0);

  /* ---------- tension scrub ---------- */
  const tensionLines=$$('#tension [data-scrub-lines] .ln > span');
  function updateTension(p){
    const n=tensionLines.length;
    tensionLines.forEach((el,i)=>{
      const seg=clamp((p*(n+0.5) - i),0,1);
      const e=1-Math.pow(1-seg,3);
      el.parentElement.style.transform=`translateY(${(1-e)*110}%)`;
      el.parentElement.style.opacity=String(0.15+e*0.85);
    });
  }

  /* ---------- pipeline scrub ---------- */
  const pipeTrack=$('#pipeTrack');
  function updatePipe(p){
    if(!pipeTrack) return;
    const max=pipeTrack.scrollWidth - innerWidth;
    pipeTrack.style.transform=`translateX(${-clamp(p,0,1)*max}px)`;
    $$('.pstage .pbar',pipeTrack).forEach((bar,i)=>{
      const seg=clamp(p*8 - i,0,1);
      bar.style.transform=`scaleX(${seg})`;
    });
  }
  $$('.pstage .pbar').forEach(b=>b.style.transform='scaleX(0)');

  /* ---------- fluid state by active section ---------- */
  let lastFluidId='';
  function fluidByActive(active){
    if(!active||!INK) return;
    if(active.id==='direct') return; // direct handled by its scrub
    const d=active.getAttribute('data-fluid');
    if(d && active.id!==lastFluidId){ try{ INK.toState(JSON.parse(d)); lastFluidId=active.id; }catch(e){} }
  }

  /* ---------- scroll velocity → fluid kick ---------- */
  let lastScroll=window.scrollY, vel=0, kickAccum=0;

  /* ---------- main ticker ---------- */
  const prog=$('#prog');
  const glassLens=$('#glassCard'), glassSec=$('#glass');
  const pins={ tension:$('#tension'), reveal:$('#reveal'), direct:$('#direct') };
  function pinProgress(sec){ if(!sec) return 0; const r=sec.getBoundingClientRect(); return clamp(-r.top/(r.height-innerHeight),0,1); }

  function tick(){
    magnetStep();
    revealStep();
    // scroll metrics
    const sy=window.scrollY;
    const docH=document.documentElement.scrollHeight-innerHeight;
    prog.style.width=(clamp(sy/docH,0,1)*100)+'%';
    vel=sy-lastScroll; lastScroll=sy;

    // scroll-velocity fluid kick (subtle)
    if(INK){
      kickAccum+=Math.abs(vel);
      if(kickAccum>240){ const yy=clamp(0.5 - (vel/innerHeight),0.05,0.95); const dir=Math.sign(vel)||1; INK.splatNorm(Math.random()*0.9+0.05, yy, (Math.random()-0.5)*700, dir*460, 0.45); kickAccum=0; }
    }

    // glass lens parallax
    if(glassLens && glassSec && !coarse){ const r=glassSec.getBoundingClientRect(); if(r.bottom>0 && r.top<innerHeight){ const ox=(mx-innerWidth/2)/innerWidth, oy=(my-innerHeight/2)/innerHeight; glassLens.style.transform=`translate(${ox*18}px,${oy*14}px)`; } }

    // pins
    updateTension(pinProgress(pins.tension));
    const rP=pinProgress(pins.reveal);
    updatePipe(rP);
    // hide the index rail while the horizontal pipeline is pinned (it overlaps)
    idxWrap.classList.toggle('hide', rP>0.01 && rP<0.99);
    const dP=pinProgress(pins.direct);
    if(dP>0 && dP<1){ lastFluidId='direct-active'; }
    updateDirect(dP);

    // active section for index + fluid
    const center=innerHeight/2; let active=null, best=1e9;
    idxSections.forEach(s=>{ const r=s.getBoundingClientRect(); const c=r.top+r.height/2; const d=Math.abs(c-center); if(r.top<center && r.bottom>center){ if(d<best){ best=d; active=s; } } });
    idxSections.forEach(s=>{ if(s._idxEl) s._idxEl.classList.toggle('on', s===active); });
    fluidByActive(active);

    requestAnimationFrame(tick);
  }

  /* ---------- boot ---------- */
  window.addEventListener('load',()=>{},{once:true});
  runPreloader(()=>{ playHero(); });
  requestAnimationFrame(tick);

  // recompute pipe max on resize
  window.addEventListener('resize',()=>{ updatePipe(pinProgress(pins.reveal)); },{passive:true});

  // expose for verification
  window.__inkReady=true;
})();
