// KLC.sky: tropical sky over Kuala Lumpur for every uDay/uDusk mix. One camera-centred BackSide dome
// (gradient, light-pollution glow, sun, moon, drifting cumulus, Titiwangsa hills to the NE/E) + a few stars.
// Units: 1 = 10 m, x east, z south, y up. No fog: the horizon itself fades into uFog so the ground meets it seamlessly.
(function () {
  const KLC = (window.KLC = window.KLC || {});
  const R = 2400;

  // shared by the dome and the stars (stars hide behind clouds)
  const COMMON = `
uniform float uDay; uniform float uDusk; uniform float uOn; uniform float uTime; uniform vec3 uFog;
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<OCT;i++){ s+=a*vnoise(p); p=mat2(1.6,1.2,-1.2,1.6)*p+7.3; a*=.5; } return s; }
// cloud plane coordinates for a view direction (y>0)
// (the constant offset leaves a clear gap around the moon at t=0..90 s)
vec2 cloudUV(vec3 d){ return d.xz/(d.y+0.12)*1.35 + vec2(uTime*0.0035 - 0.25, uTime*0.0012 + 1.25); }
// cumulus coverage 0..1 (+ thin haze in .y)
vec2 clouds(vec2 uv){
  float base = fbm(uv*0.55);
  float d = fbm(uv*1.7 + base*1.2);
  float cov = smoothstep(0.58, 0.80, d*0.62 + base*0.5);
  float haze = smoothstep(0.45, 0.85, fbm(uv*0.32 + 3.1))*0.35;
  return vec2(cov, haze);
}
`;

  // drawn last at the far plane (xyww): only pixels nothing else covered pay for the sky shader
const VERT = `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=(projectionMatrix*modelViewMatrix*vec4(position,1.0)).xyww; }`;

  const FRAG = COMMON + `
uniform vec3 uSun; uniform vec3 uMoon; uniform float uCamY;
varying vec3 vD;
const float PI=3.14159265;
// Titiwangsa range: azimuth 0 = north, 90 = east. two ridge layers (far, higher & hazier; near, lower)
float ridge(float az, float s, float k){ float n=fbm(vec2(az*k, s)) + 0.12*vnoise(vec2(az*k*6.0, s+5.0)); return clamp((n-0.22)/0.62, 0.0, 1.0); }
void main(){
  vec3 d = normalize(vD);
  float y = d.y, yc = max(y, 0.0);
  float az = atan(d.x, -d.z)*180.0/PI;           // -180..180, 0 = north, 90 = east
  float day = uDay, dusk = uDusk, night = (1.0-day)*(1.0-0.7*dusk);
  float sunUp = smoothstep(-0.12, 0.06, uSun.y);
  float cs = dot(d, uSun), cm = dot(d, uMoon);
  float hs = max(dot(normalize(vec3(d.x,0.0,d.z)), normalize(vec3(uSun.x,0.0,uSun.z))), 0.0); // towards the sun's azimuth

  // --- gradient ---
  vec3 nTop = vec3(0.010,0.016,0.050), nMid = vec3(0.036,0.034,0.098);
  vec3 dTop = vec3(0.24,0.44,0.76), dMid = vec3(0.50,0.66,0.86);
  vec3 kTop = vec3(0.17,0.18,0.38), kMid = vec3(0.58,0.40,0.50);
  vec3 top = mix(mix(nTop,dTop,day), kTop, dusk*0.75);
  vec3 mid = mix(mix(nMid,dMid,day), kMid, dusk*0.85);
  vec3 col = mix(mid, top, smoothstep(0.08, 0.75, y));
  // horizon band: fog colour + warm light pollution at night, white haze by day, orange glow towards a low sun
  // night glow peaks at an absolute colour, so a brighter night haze (uFog) carries part of it with no step
  vec3 glowN = vec3(0.102,0.078,0.149) + vec3(0.28,0.145,0.15)*(0.85+0.3*vnoise(vec2(az*0.05,1.0)));
  vec3 hor = uFog + max(glowN-uFog, 0.0)*night*(1.0-0.5*dusk);
  hor = mix(hor, vec3(0.86,0.89,0.93), day*(1.0-dusk)*0.6);
  hor = mix(hor, mix(vec3(0.82,0.50,0.46), vec3(1.0,0.56,0.28), hs*hs), dusk*0.85);
  hor = mix(uFog, hor, smoothstep(-0.003, mix(0.032, 0.08, day), y));   // at y=0 the sky equals the ground's haze
  float hb = exp(-yc*mix(10.0, 6.0, day)) ;
  col = mix(col, hor, hb);
  // pink-violet "skyglow" a little higher up at night
  col += vec3(0.05,0.022,0.04)*night*exp(-yc*4.0);

  // --- sun glow (Mie-ish) ---
  float sunV = sunUp*(0.35+0.65*day);
  vec3 sunC = mix(vec3(1.0,0.92,0.8), vec3(1.0,0.5,0.2), dusk);
  col += sunC*(pow(max(cs,0.0), 6.0)*0.22 + pow(max(cs,0.0), 60.0)*0.35)*sunV;
  col += vec3(1.0,0.45,0.2)*pow(max(cs,0.0), 3.0)*0.25*dusk*sunUp*exp(-yc*3.0);
  float disc = smoothstep(0.99955, 0.99975, cs)*sunV*smoothstep(-0.01, 0.02, y);
  col = mix(col, mix(vec3(1.6,1.5,1.35), vec3(1.7,0.9,0.45), dusk), disc);

  // --- moon (night) with halo ---
  float mv = clamp(1.0-day*1.6, 0.0, 1.0)*(1.0-dusk*0.8);
  vec3 mt = normalize(cross(uMoon, vec3(0.0,1.0,0.0))); vec3 mb = cross(mt, uMoon);
  vec2 mp = vec2(dot(d,mt), dot(d,mb))/0.0075;     // disc coords, radius 1
  float mr = length(mp), md = smoothstep(1.0, 0.86, mr)*step(0.0, cm);
  vec3 mn = vec3(mp, sqrt(max(1.0-mr*mr, 0.0)));
  float maria = md > 0.0 ? 0.74 + 0.26*fbm(mp*2.2+2.0) : 1.0;
  float phase = smoothstep(-0.06, 0.12, dot(mn, normalize(vec3(-0.85, 0.25, 0.55)))); // waxing gibbous
  float cmp = max(cm, 0.0), mNear = smoothstep(0.990, 0.9993, cm)*mv;   // within ~8 degrees
  vec3 sky0 = mix(col, uFog, smoothstep(0.0, -0.012, y));               // cloud-free sky, the haze the hills dissolve into
  float a = 0.0;

  // --- clouds ---
  if (y > -0.02) {
    vec2 uv = cloudUV(vec3(d.x, yc, d.z));
    vec2 cl = clouds(uv);
    vec2 to = normalize(uSun.xz + 1e-4)*0.06;
    vec2 cl2 = clouds(uv + to);
    float lit = clamp(0.62 + (cl.x - cl2.x)*2.4, 0.0, 1.0);        // sun-facing edges brighter
    float core = smoothstep(0.35, 1.0, cl.x);
    vec3 cDay = mix(vec3(0.66,0.70,0.77), vec3(0.98,0.98,0.99), lit) * (1.0 - 0.18*core);
    vec3 cDusk = mix(vec3(0.42,0.33,0.42), vec3(1.0,0.66,0.48), lit*(0.5+0.5*hs));
    // night: underside lit by the city (warmer and brighter towards the horizon)
    vec3 cNight = mix(vec3(0.05,0.045,0.085), vec3(0.22,0.12,0.10), (0.3+0.7*core)*exp(-yc*2.2)) * (0.55+0.45*uOn);
    cNight += vec3(0.07,0.075,0.09)*lit*mv*pow(cmp, 8.0);           // moonlit side of the sky
    vec3 cc = mix(mix(cNight, cDay, day), cDusk, dusk*0.85);
    float fade = smoothstep(-0.02, 0.10, y);
    a = cl.x*0.88*fade;
    col = mix(col, mix(cc, hor, 0.35*hb), a);
    col = mix(col, mix(cc, top, 0.4), cl.y*fade*(1.0-a)*mix(0.6, 1.0, day));
    col += vec3(0.55,0.56,0.6)*mNear*(a*(1.0-a)*3.0*(0.4+0.6*lit) + cl.y*0.25);   // silver lining near the moon
  }
  // moon after the clouds: thin cloud only veils it
  col += vec3(0.75,0.8,0.95)*(pow(cmp, 400.0)*0.25 + pow(cmp, 40.0)*0.045)*mv*(1.0-0.5*a);
  col = mix(col, vec3(1.3,1.27,1.16)*maria*(0.12+0.88*phase), md*mv*(1.0-0.45*a));

  // below the horizon: the ground's haze
  col = mix(col, uFog, smoothstep(0.0, -0.012, y));

  // --- distant hills: Titiwangsa main range (~20-30 km, NE/E) and the nearer Ampang hills.
  // heights in units (1 = 10 m) so camera height matters: from high up they sink towards the ground's horizon (yg).
  // Their base dissolves exponentially into the sky behind them (no flat base line).
  float env = smoothstep(-45.0, 0.0, az)*(1.0-smoothstep(120.0, 165.0, az));
  float envN = smoothstep(15.0, 45.0, az)*(1.0-smoothstep(100.0, 140.0, az));
  float yg = -uCamY/3000.0;
  if (env + envN > 0.0 && y < 0.08 && y > yg - 0.02) {
    float hF = (20.0 + 140.0*pow(ridge(az, 1.0, 0.11), 1.7))*env;     // far ridge, up to ~1.6 km
    float hN = (10.0 + 55.0*pow(ridge(az, 7.0, 0.23), 1.5))*envN;     // near hills, up to ~650 m
    float yF = (hF - uCamY)/2900.0, yN = (hN - uCamY)/1100.0;
    vec3 hill = mix(uFog*0.6 + vec3(0.01,0.008,0.02), mix(uFog, vec3(0.42,0.51,0.60), 0.42), day);
    hill = mix(hill, uFog*vec3(0.82,0.72,0.8), dusk*0.6);
    float aa = 0.0012, h0 = max(y - yg, 0.0);
    float mF = (1.0 - smoothstep(yF-aa, yF+aa, y))*smoothstep(0.0, 0.2, env)*(1.0 - day*smoothstep(90.0, 140.0, uCamY));
    float mN = (1.0 - smoothstep(yN-aa, yN+aa, y))*smoothstep(0.0, 0.2, envN);
    float kF = 1.0 - (1.0 - mix(0.5, 0.62, day))*(1.0 - exp(-h0*110.0));
    float kN = 1.0 - (1.0 - mix(0.28, 0.4, day))*(1.0 - exp(-h0*90.0));
    col = mix(col, mix(hill, sky0, kF), mF);
    col = mix(col, mix(hill*0.92, sky0, kN), mN);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

  const STAR_V = COMMON + `
attribute float aMag; attribute float aSeed; uniform float uPR;
varying float vA; varying float vT;
void main(){
  vec3 d = normalize(position);
  vec2 cl = clouds(cloudUV(d));
  float tw = 0.75 + 0.25*sin(uTime*(1.5+aSeed*3.0) + aSeed*60.0);
  vA = aMag*tw*(1.0-cl.x)*(1.0-cl.y*0.6)*smoothstep(0.06, 0.45, d.y)*(1.0-uDay)*(1.0-uDusk*0.85);
  vT = aSeed;
  gl_PointSize = (1.2 + 1.6*aMag)*uPR;
  gl_Position = (projectionMatrix*modelViewMatrix*vec4(position,1.0)).xyww;
}`;
  const STAR_F = `varying float vA; varying float vT;
void main(){ vec2 p=gl_PointCoord-0.5; float a=smoothstep(0.5,0.1,length(p))*vA; if(a<0.004) discard;
  vec3 c = vT<0.3 ? vec3(1.0,0.88,0.75) : vT<0.8 ? vec3(0.92,0.95,1.0) : vec3(0.75,0.85,1.0);
  gl_FragColor=vec4(c*a,1.0); }`;

  function dir(azDeg, elDeg) { const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180; return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)); }

  KLC.sky = {
    build(ctx) {
      const { THREE, scene, uniforms: U, camera, renderer } = ctx;
      const uSun = { value: new THREE.Vector3() }, uMoon = { value: dir(296, 13.5) };
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthFunc: THREE.LessEqualDepth, fog: false, vertexShader: VERT, fragmentShader: FRAG, defines: { OCT: ctx.small ? 4 : 5 },
        uniforms: { uDay: U.uDay, uDusk: U.uDusk, uOn: U.uOn, uTime: U.uTime, uFog: U.uFog, uSun, uMoon, uCamY: { value: 20 } },
      });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 32), mat);
      dome.frustumCulled = false; dome.renderOrder = 100; // after all opaque geometry, depth-tested at the far plane
      dome.onBeforeRender = (r, s, cam) => { dome.position.copy(cam.position); dome.updateMatrixWorld(); mat.uniforms.uCamY.value = cam.position.y; };
      scene.add(dome);

      // stars: few (KL light pollution), thinning towards the horizon
      const rnd = ctx.rng(9071), n = ctx.small ? 260 : 420;
      const pos = new Float32Array(n * 3), mag = new Float32Array(n), sd = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, y = Math.sqrt(rnd()) * 0.92 + 0.06, r = Math.sqrt(1 - y * y);
        pos.set([Math.cos(a) * r * R * 0.95, y * R * 0.95, Math.sin(a) * r * R * 0.95], i * 3);
        mag[i] = Math.pow(rnd(), 3.0) * 0.85 + 0.12; sd[i] = rnd();
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aMag', new THREE.BufferAttribute(mag, 1)); sg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
      const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
        vertexShader: STAR_V, fragmentShader: STAR_F, defines: { OCT: 4 }, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
        uniforms: { uDay: U.uDay, uDusk: U.uDusk, uOn: U.uOn, uTime: U.uTime, uFog: U.uFog, uPR: { value: renderer.getPixelRatio() } },
      }));
      stars.frustumCulled = false; stars.renderOrder = -9; dome.add(stars);

      // sun path: east-high in the morning, overhead at noon, low in the WSW at dusk, below the horizon at night
      const W = dir(278, 0), E = dir(95, 0), tmp = new THREE.Vector3();
      // atmosphere (runs after the page has set uFog for the frame; ctx.skyAtmos === false turns it off):
      // - haze is thinner looking down from altitude than along the horizon: uFogD scales with camera height
      //   (an external change of uFogD becomes the new base value);
      // - the night haze carries some of the city glow (max with 0x3a2640, so a page that adopts that colour is unaffected).
      const atmos = ctx.skyAtmos !== false, LIFT = new THREE.Color(0x3a2640);
      let fogBase = U.uFogD.value, fogSet = NaN;
      function update() {
        const d = U.uDay.value, k = U.uDusk.value;
        if (atmos) {
          if (U.uFogD.value !== fogSet) fogBase = U.uFogD.value;
          const hy = THREE.MathUtils.smoothstep(camera.position.y, 30, 230);
          fogSet = U.uFogD.value = fogBase * (1 - 0.45 * hy) * (1 - 0.12 * d * (1 - k));
          const F = U.uFog.value, n = (1 - d) * (1 - k);
          F.setRGB(Math.max(F.r, LIFT.r * n), Math.max(F.g, LIFT.g * n), Math.max(F.b, LIFT.b * n));
        }
        const el = (-4 + 74 * d - 25 * k) * Math.PI / 180, m = THREE.MathUtils.smoothstep(d, 0.5, 0.7);
        tmp.copy(W).lerp(E, m); tmp.y = 0; if (tmp.lengthSq() < 1e-6) tmp.set(0, 0, 1); tmp.normalize();
        uSun.value.set(tmp.x * Math.cos(el), Math.sin(el), tmp.z * Math.cos(el) + 0.12).normalize();
        stars.material.uniforms.uPR.value = renderer.getPixelRatio();
      }
      update();
      return { update };
    },
  };
})();
