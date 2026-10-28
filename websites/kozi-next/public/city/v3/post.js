// KLC.post: scene -> (MSAA) HDR target -> bright pass -> blurred mip chain bloom -> filmic composite.
// No EffectComposer: a single full-screen triangle and a handful of small targets. Falls back to a plain render.
// Scene shaders output display-referred colour (no encoding), so the tone curve is identity in the mid-tones and
// only rolls off highlights (ACES-like shoulder, hue-preserving-ish), with bloom strongest at night.
(function () {
  const KLC = (window.KLC = window.KLC || {});

  const VS = 'varying vec2 vUv; void main(){ vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0); }';
  const BRIGHT = `uniform sampler2D tSrc; uniform vec2 uPx; uniform float uThr; uniform float uKnee; varying vec2 vUv;
// clamp each tap so tiny over-bright cores (pinnacles, lamps) keep a tight halo instead of a blob
vec3 s(vec2 o){ return min(texture2D(tSrc, vUv+o*uPx).rgb, vec3(2.0)); }
void main(){
  // 4 bilinear taps = 4x4 box; weight each by 1/(1+luma) against fireflies
  vec3 a=s(vec2(-1.,-1.)), b=s(vec2(1.,-1.)), c=s(vec2(-1.,1.)), d=s(vec2(1.,1.));
  float wa=1./(1.+dot(a,vec3(.2126,.7152,.0722))), wb=1./(1.+dot(b,vec3(.2126,.7152,.0722))), wc=1./(1.+dot(c,vec3(.2126,.7152,.0722))), wd=1./(1.+dot(d,vec3(.2126,.7152,.0722)));
  vec3 col=(a*wa+b*wb+c*wc+d*wd)/(wa+wb+wc+wd);
  float br=max(col.r,max(col.g,col.b));
  float rq=clamp(br-uThr+uKnee,0.,2.*uKnee); rq=rq*rq/(4.*uKnee+1e-4);
  gl_FragColor=vec4(col*max(rq,br-uThr)/max(br,1e-4),1.0);
}`;
  const DOWN = `uniform sampler2D tSrc; uniform vec2 uPx; varying vec2 vUv;
void main(){ vec3 c=texture2D(tSrc,vUv+uPx*vec2(-1.,-1.)).rgb+texture2D(tSrc,vUv+uPx*vec2(1.,-1.)).rgb+texture2D(tSrc,vUv+uPx*vec2(-1.,1.)).rgb+texture2D(tSrc,vUv+uPx*vec2(1.,1.)).rgb;
  gl_FragColor=vec4(c*0.25,1.0); }`;
  // 9-tap gaussian folded into 5 bilinear fetches
  const BLUR = `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main(){ vec3 c=texture2D(tSrc,vUv).rgb*0.2270270270;
  vec2 o1=uDir*1.3846153846, o2=uDir*3.2307692308;
  c+=(texture2D(tSrc,vUv+o1).rgb+texture2D(tSrc,vUv-o1).rgb)*0.3162162162;
  c+=(texture2D(tSrc,vUv+o2).rgb+texture2D(tSrc,vUv-o2).rgb)*0.0702702703;
  gl_FragColor=vec4(c,1.0); }`;
  // coarse levels: H+V in one pass, 3x3 bilinear taps (~6x6 texel gaussian-ish)
  const BLUR2 = `uniform sampler2D tSrc; uniform vec2 uPx; varying vec2 vUv;
void main(){ vec3 c=vec3(0.); for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ float w=(i==0?0.4:0.3)*(j==0?0.4:0.3); c+=texture2D(tSrc,vUv+uPx*vec2(float(i),float(j))*1.25).rgb*w; }
  gl_FragColor=vec4(c,1.0); }`;
  // add the (tent-filtered) coarser level onto this one (uWs: weight of this level itself)
  const UP = `uniform sampler2D tSrc; uniform sampler2D tLow; uniform vec2 uPx; uniform float uW; uniform float uWs; varying vec2 vUv;
void main(){ vec3 l=texture2D(tLow,vUv+uPx*vec2(-.5,-.5)).rgb+texture2D(tLow,vUv+uPx*vec2(.5,-.5)).rgb+texture2D(tLow,vUv+uPx*vec2(-.5,.5)).rgb+texture2D(tLow,vUv+uPx*vec2(.5,.5)).rgb;
  gl_FragColor=vec4(texture2D(tSrc,vUv).rgb*uWs+l*0.25*uW,1.0); }`;
  const COMP = `uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uDay; uniform float uDusk; uniform float uTime; uniform vec2 uRes; uniform float uGrain; varying vec2 vUv;
float h(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
// identity below the knee, smooth exponential shoulder towards 1 above it
vec3 shoulder(vec3 x){ const float k=0.8; vec3 t=max(x-k,0.0); return min(x,vec3(k)) + (1.0-k)*(1.0-exp(-t/(1.0-k))); }
void main(){
  vec3 col=texture2D(tScene,vUv).rgb;
  vec3 b=texture2D(tBloom,vUv).rgb;
  col+=b*uBloom;
  // bright cores drift towards white like film, then the shoulder
  float m=max(col.r,max(col.g,col.b));
  col=mix(col, vec3(m), smoothstep(1.0,3.0,m)*0.5);
  col=shoulder(col);
  // gentle filmic contrast in the shadows (slight toe), richer saturation at night
  col=col*col*(3.0-2.0*col)*0.08 + col*0.92;
  float l=dot(col,vec3(.2126,.7152,.0722));
  col=max(mix(vec3(l),col,1.0+0.08*(1.0-uDay)),0.0);
  // vignette
  vec2 q=vUv-0.5; q.x*=uRes.x/uRes.y;
  col*=1.0-0.16*smoothstep(0.35,1.05,length(q));
  // grain (night) + dither against banding in the dark sky gradients
  float n=h(vUv*uRes+fract(uTime*7.31)*91.7)+h(vUv*uRes*1.37+fract(uTime*3.17)*53.1)-1.0;
  col+=n*(1.0/255.0 + uGrain*(1.0-uDay)*0.012*(0.4+0.6*(1.0-l)));
  gl_FragColor=vec4(col,1.0);
}`;

  KLC.post = {
    create(ctx) {
      const { THREE, renderer, scene, camera, uniforms: U } = ctx;
      // nativeAA: whether the page's own (antialias:true) backbuffer is still what gets seen. When it is false the page
      // should create its renderer with antialias:false: the MSAA default framebuffer is otherwise allocated for nothing.
      const plain = { render() { renderer.render(scene, camera); }, resize() {}, nativeAA: true };
      try {
        const gl = renderer.getContext(), caps = renderer.capabilities, ext = renderer.extensions;
        const half = caps.isWebGL2 ? ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
          : ext.has('OES_texture_half_float') && ext.has('OES_texture_half_float_linear') && ext.has('EXT_color_buffer_half_float');
        const msaa = caps.isWebGL2 && THREE.WebGLMultisampleRenderTarget && caps.maxSamples > 0;
        const small = ctx.small;
        // no MSAA target (WebGL1): keep the context's native antialiasing rather than a jagged post path
        if (!msaa && (gl.getContextAttributes() || {}).antialias) return plain;
        // high DPR already supersamples: fewer samples there (and on phones)
        const samplesFor = (pr) => Math.min(caps.maxSamples || 0, small ? (pr > 1.6 ? 0 : 2) : (pr > 1.3 ? 2 : 4));
        const opts = (type, depth) => ({ minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type, depthBuffer: depth, stencilBuffer: false });

        // full-screen triangle
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
        const quad = new THREE.Mesh(geo); quad.frustumCulled = false;
        const qScene = new THREE.Scene(); qScene.add(quad); const qCam = new THREE.Camera();
        const M = (fs, uni) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: uni, depthTest: false, depthWrite: false });
        const mBright = M(BRIGHT, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() }, uThr: { value: 0.7 }, uKnee: { value: 0.3 } });
        const mDown = M(DOWN, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() } });
        const mBlur = M(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
        const mBlur2 = M(BLUR2, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() } });
        const mUp = M(UP, { tSrc: { value: null }, tLow: { value: null }, uPx: { value: new THREE.Vector2() }, uW: { value: 1 }, uWs: { value: 1 } });
        const mComp = M(COMP, { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 1 }, uDay: U.uDay, uDusk: U.uDusk, uTime: U.uTime, uRes: { value: new THREE.Vector2() }, uGrain: { value: small ? 0.6 : 1 } });

        // pick the best scene target that is framebuffer-complete here
        function complete(rt) { renderer.setRenderTarget(rt); const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; renderer.setRenderTarget(null); return ok; }
        let type = THREE.UnsignedByteType, sceneRT = null;
        const tries = [];
        if (half && msaa) tries.push([THREE.HalfFloatType, true]);
        if (half) tries.push([THREE.HalfFloatType, false]);
        if (msaa) tries.push([THREE.UnsignedByteType, true]);
        tries.push([THREE.UnsignedByteType, false]);
        let samples = msaa ? samplesFor(renderer.getPixelRatio()) : 0;
        if (!samples) for (let i = tries.length - 1; i >= 0; i--) if (tries[i][1]) tries.splice(i, 1);
        for (const [t, ms] of tries) {
          const rt = ms ? new THREE.WebGLMultisampleRenderTarget(4, 4, opts(t, true)) : new THREE.WebGLRenderTarget(4, 4, opts(t, true));
          if (ms) rt.samples = samples;
          if (complete(rt)) { sceneRT = rt; type = t; break; }
          rt.dispose();
        }
        if (!sceneRT) return plain;
        const hdr = type === THREE.HalfFloatType;
        const levels = small ? 3 : 5, first = small ? 4 : 2; // first bloom level at 1/2 (desktop) or 1/4 (phone)
        const A = [], B = [];
        for (let i = 0; i < levels; i++) { A.push(new THREE.WebGLRenderTarget(4, 4, opts(type, false))); B.push(new THREE.WebGLRenderTarget(4, 4, opts(type, false))); }
        if (!complete(A[0])) { sceneRT.dispose(); return plain; }

        const res = new THREE.Vector2();
        function resize(w, h) {
          const pr = renderer.getPixelRatio(), W = Math.max(1, Math.floor(w * pr)), H = Math.max(1, Math.floor(h * pr));
          if (sceneRT.isWebGLMultisampleRenderTarget) { const sm = Math.max(1, samplesFor(pr)); if (sm !== sceneRT.samples) { sceneRT.samples = sm; sceneRT.dispose(); } }
          sceneRT.setSize(W, H); res.set(W, H); mComp.uniforms.uRes.value.set(W, H);
          for (let i = 0; i < levels; i++) { const d = first << i, ww = Math.max(1, Math.round(W / d)), hh = Math.max(1, Math.round(H / d)); A[i].setSize(ww, hh); B[i].setSize(ww, hh); }
        }
        renderer.getDrawingBufferSize(res); resize(res.x / renderer.getPixelRatio(), res.y / renderer.getPixelRatio());

        function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(qScene, qCam); }
        const info = renderer.info; info.autoReset = false;
        let failed = false;

        function render() {
          if (failed) return renderer.render(scene, camera);
          try {
            info.reset();
            const day = U.uDay.value, dusk = U.uDusk.value;
            renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
            const sr = { calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines };
            // bright pass: threshold rises by day so only the sun/specular cores bloom
            const bu = mBright.uniforms;
            bu.tSrc.value = sceneRT.texture; bu.uPx.value.set(first * 0.25 / sceneRT.width, first * 0.25 / sceneRT.height);
            bu.uThr.value = (hdr ? 0.42 : 0.38) + 0.55 * day; bu.uKnee.value = 0.22;
            pass(mBright, A[0]);
            for (let i = 1; i < levels; i++) { mDown.uniforms.tSrc.value = A[i - 1].texture; mDown.uniforms.uPx.value.set(1 / A[i - 1].width, 1 / A[i - 1].height); pass(mDown, A[i]); }
            const fused = levels - 2; // the two coarsest levels blur in a single pass (into B)
            const L = [];
            for (let i = 0; i < levels; i++) {
              if (i >= fused) { mBlur2.uniforms.tSrc.value = A[i].texture; mBlur2.uniforms.uPx.value.set(1 / A[i].width, 1 / A[i].height); pass(mBlur2, B[i]); L.push(B[i]); continue; }
              mBlur.uniforms.tSrc.value = A[i].texture; mBlur.uniforms.uDir.value.set(1 / A[i].width, 0); pass(mBlur, B[i]);
              mBlur.uniforms.tSrc.value = B[i].texture; mBlur.uniforms.uDir.value.set(0, 1 / A[i].height); pass(mBlur, A[i]); L.push(A[i]);
            }
            // upsample-add into the free target of each level (A for fused levels, B otherwise); the finest level
            // counts half so thin bright structures keep a crisp core
            let up = L[levels - 1];
            for (let i = levels - 2; i >= 0; i--) {
              const dst = L[i] === A[i] ? B[i] : A[i];
              const u = mUp.uniforms; u.tSrc.value = L[i].texture; u.tLow.value = up.texture; u.uPx.value.set(1 / up.width, 1 / up.height); u.uW.value = 0.8; u.uWs.value = i === 0 ? 0.5 : 1;
              pass(mUp, dst); up = dst;
            }
            const c = mComp.uniforms; c.tScene.value = sceneRT.texture; c.tBloom.value = up.texture;
            c.uBloom.value = (0.4 * (1 - day) + 0.06 * day + 0.08 * dusk) * (small ? 0.85 : 1);
            pass(mComp, null);
            Object.assign(info.render, sr); // report the scene's own cost to the page, not the post passes
          } catch (e) { console.warn('post disabled:', e); failed = true; renderer.setRenderTarget(null); info.autoReset = true; renderer.render(scene, camera); }
        }
        return { render, resize, hdr, msaa: !!sceneRT.isWebGLMultisampleRenderTarget, nativeAA: false, get samples() { return sceneRT.samples || 0; }, passes: 1 + (levels - 1) + (levels - 2) * 2 + 2 + (levels - 1) + 1 };
      } catch (e) { console.warn('post unavailable:', e); return plain; }
    },
  };
})();
