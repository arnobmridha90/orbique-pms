// A soft, painterly sky drawn on the GPU: gradient, sun glow, drifting cloud, stars and the moon.
// It renders at a low resolution (the sky is soft, so nobody can tell) and at ~30 fps, and stops
// whenever it is off screen or the tab is hidden.
import type { SkyState } from './sun';

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision mediump float;
uniform vec2 uRes;uniform float uTime,uAspect,uHorizon,uGlowAmt,uStars,uSunVis,uMoonVis,uMoonFrac,uMoonWax,uClouds;
uniform vec3 uZen,uHor,uGlow;uniform vec2 uSun,uMoon;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 q=vec2(uv.x*uAspect,uv.y);
  float t=clamp((uv.y-uHorizon)/(1.-uHorizon),0.,1.);
  vec3 col=mix(uHor,uZen,pow(t,.62));
  vec2 s=vec2(uSun.x*uAspect,uSun.y);
  float d=distance(q,s);
  col+=uGlow*uGlowAmt*(exp(-d*3.2)*.5+exp(-d*11.)*.35);
  float band=exp(-abs(uv.y-uHorizon)*7.)*exp(-abs(q.x-s.x)*.9);
  col+=uGlow*uGlowAmt*band*.45;
  float low=1.-smoothstep(uHorizon+.02,uHorizon+.34,uSun.y);
  col+=uGlow*uGlowAmt*exp(-d*24.)*.55*low*uSunVis;
  float disc=smoothstep(.034,.029,d);
  col=mix(col,mix(vec3(1.,.97,.9),vec3(1.,.74,.44),low),disc*uSunVis);
  vec2 cp=vec2(q.x*1.4+uTime*.006,q.y*4.6-uTime*.001);
  float c=fbm(cp);
  c=smoothstep(.56,.86,c)*smoothstep(uHorizon,uHorizon+.22,uv.y)*(1.-smoothstep(.8,1.,uv.y));
  vec3 cc=mix(mix(uHor,uZen,.25)*1.06,uGlow,.45*uGlowAmt);
  col=mix(col,cc,c*uClouds);
  vec2 g=floor(gl_FragCoord.xy/1.6);
  float r=h(g);
  float tw=.55+.45*sin(uTime*1.7+r*80.);
  col+=vec3(step(.9975,r)*tw*smoothstep(uHorizon+.04,uHorizon+.35,uv.y))*uStars;
  vec2 m=vec2(uMoon.x*uAspect,uMoon.y);
  float md=distance(q,m),R=.026;
  float disk=smoothstep(R,R-.003,md);
  vec2 off=vec2((uMoonWax>.5?-1.:1.)*R*2.*uMoonFrac,0.);
  float shade=smoothstep(R,R-.003,distance(q,m+off));
  float lit=disk*(uMoonFrac>.98?1.:(1.-shade));
  col+=vec3(.06,.07,.1)*exp(-md*9.)*uMoonVis;
  col=mix(col,mix(col,vec3(.97,.95,.88),.12),disk*uMoonVis);
  col=mix(col,vec3(.97,.95,.88),lit*uMoonVis);
  col+=(h(gl_FragCoord.xy+fract(uTime*7.))-.5)*.022;
  gl_FragColor=vec4(col,1.);
}`;

export class SkyGL {
  private gl: WebGLRenderingContext | null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0; private last = 0; private visible = true; private t0 = performance.now();
  state: SkyState | null = null;
  clouds = 0.55;

  constructor(private canvas: HTMLCanvasElement, private scale = 0.6) {
    this.gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!this.gl) return;
    const gl = this.gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.gl = null; return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['uRes', 'uTime', 'uAspect', 'uHorizon', 'uGlowAmt', 'uStars', 'uSunVis', 'uMoonVis', 'uMoonFrac', 'uMoonWax', 'uClouds', 'uZen', 'uHor', 'uGlow', 'uSun', 'uMoon'])
      this.u[k] = gl.getUniformLocation(prog, k);
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.loop(); }).observe(canvas);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.loop(); });
    this.resize();
  }

  get ok() { return !!this.gl; }

  private resize() {
    if (!this.gl) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const s = Math.min(this.scale, 1.1e6 / Math.max(1, w * h)) * Math.min(1.5, devicePixelRatio || 1);
    this.canvas.width = Math.max(2, Math.round(w * s)); this.canvas.height = Math.max(2, Math.round(h * s));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.draw(performance.now());
  }

  set(state: SkyState) { this.state = state; this.draw(performance.now()); }

  draw(now: number) {
    const gl = this.gl, s = this.state; if (!gl || !s) return;
    const u = this.u, W = this.canvas.width, H = this.canvas.height;
    gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uTime, (now - this.t0) / 1000); gl.uniform1f(u.uAspect, W / H);
    gl.uniform1f(u.uHorizon, 0.3); gl.uniform1f(u.uGlowAmt, s.glowAmt); gl.uniform1f(u.uStars, s.stars);
    gl.uniform1f(u.uSunVis, s.sun.vis); gl.uniform1f(u.uMoonVis, s.moon.vis); gl.uniform1f(u.uMoonFrac, s.moon.fraction);
    gl.uniform1f(u.uMoonWax, s.moon.waxing ? 1 : 0); gl.uniform1f(u.uClouds, this.clouds);
    gl.uniform3fv(u.uZen, s.zen); gl.uniform3fv(u.uHor, s.hor); gl.uniform3fv(u.uGlow, s.glow);
    gl.uniform2f(u.uSun, s.sun.x, s.sun.y); gl.uniform2f(u.uMoon, s.moon.x, s.moon.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Animate (clouds drift, stars twinkle). Reduced motion keeps a still frame. */
  loop() {
    if (!this.gl || this.raf || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tick = (now: number) => {
      this.raf = 0;
      if (!this.visible || document.hidden) return;
      if (now - this.last > 33) { this.last = now; this.draw(now); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}
