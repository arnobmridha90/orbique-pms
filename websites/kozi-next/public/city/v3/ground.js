// KLC.ground: everything at street level - ground + procedural low-rise roofscape, Bukit Nanas hill, baked sun shadows,
// roads + flyovers, rail guideways, street lamps, traffic + light trails, trains, water, parks/forest, trees and a
// far-field skyline of low boxes past the mapped area. Units: 1 = 10 m, x east, z south, y up.
(function () {
  const KLC = (window.KLC = window.KLC || {});

  // ---------- Bukit Nanas (hill under the KL Tower) ----------
  const HX = -44, HZ = 19.5, HRX = 26, HRZ = 21, HH = 4.5;
  function heightAt(x, z) {
    const dx = (x - HX) / HRX, dz = (z - HZ) / HRZ, a = Math.atan2(dz, dx);
    const r = Math.sqrt(dx * dx + dz * dz) / (1 + 0.1 * Math.sin(2 * a + 1.3) + 0.07 * Math.sin(3 * a + 0.4));
    if (r >= 1) return 0;
    const t = Math.min(1, (1 - r) / 0.78); // plateau of ~22% radius around the summit
    return HH * t * t * (3 - 2 * t);
  }
  const nearHill = (x, z) => Math.abs(x - HX) < HRX * 1.25 && Math.abs(z - HZ) < HRZ * 1.25;

  // the scene's day sun (from the WSW, ~53 deg up): exposed as ctx.sun so every module can light and glint the same way
  const SUNV = (() => { const v = [-0.46, 0.8, 0.38], l = Math.hypot(...v); return v.map((c) => c / l); })();
  const SUNS = SUNV.map((c) => c.toFixed(5)).join(',');

  // ---------- shared GLSL ----------
  const LM_R = 460; // light map + shadow map cover [-LM_R, LM_R]^2
  const GLSL = `
uniform float uDay; uniform float uDusk; uniform float uOn; uniform float uTime; uniform vec3 uFog; uniform float uFogD;
uniform sampler2D uLM; uniform sampler2D uSH;
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x), f.y), f.z); }
float lampsOn(){ return 1.0-smoothstep(0.2,0.85,uDay); }
// intro: the city switches on from the Vortex outward in soft, irregular patches
float blockOn(vec2 p){ float sd = clamp(0.08 + 0.55*length(p)/420.0 + 0.3*(vnoise(p*0.025)-0.5) + 0.12*vnoise(p*0.11+5.0), 0.0, 1.0); return smoothstep(sd-0.15, sd, uOn); }
const vec3 SUN = vec3(${SUNS});
vec2 mapUV(vec2 p){ return (p + ${LM_R}.0) / ${2 * LM_R}.0; }
// baked day shadows: r = buildings/flyovers, g = contact AO, b = tree shadows
vec4 shAt(vec2 p){ return texture2D(uSH, mapUV(p)); }
vec3 natLight(vec3 n, float sh, float ao){
  float d = smoothstep(0.0, 1.0, uDay);
  vec3 sunC = mix(vec3(1.0,0.95,0.86), vec3(1.0,0.6,0.36), uDusk);
  vec3 amb = mix(vec3(0.56,0.62,0.72), vec3(0.52,0.4,0.5), uDusk);
  vec3 day = amb*0.62*(0.72+0.28*n.y)*(1.0-0.4*ao)*(1.0-0.22*sh) + sunC*0.62*max(dot(n,SUN),0.0)*(1.0-0.86*sh);
  vec3 night = vec3(0.028,0.032,0.058) + vec3(0.07,0.04,0.06)*uDusk;
  return mix(night, day, d);
}
vec3 natLight(vec3 n){ return natLight(n, 0.0, 0.0); }
vec3 fogc(vec3 c, float d){ float f = 1.0-exp(-uFogD*uFogD*d*d); return mix(c, uFog, f); }
`;
  // fragment-only: street-lamp light falling on the ground (pre-baked road glow), procedural glow beyond the map edge
  const LAMP = `
vec3 lampTex(vec2 p){ return texture2D(uLM, mapUV(p)).rgb; }
vec3 spill(vec2 p){ return texture2D(uLM, mapUV(p), 4.5).rgb; } // soft urban spill: blurred (mip-biased) read
vec3 lampAt(vec2 p){
  float ed = length(p);
  vec3 c = lampTex(p) + spill(p)*0.28, far = vec3(0.0); float ins = 1.0;
  if (ed > 370.0) {
    ins = smoothstep(425.0, 385.0, ed);
    float urb = smoothstep(0.25, 0.65, vnoise(p*0.006+3.0)) * (0.55 + 0.45*vnoise(p*0.05));
    far = vec3(1.0,0.6,0.3) * 0.22 * urb * smoothstep(370.0, 440.0, ed);
  }
  return mix(far, c, ins) * blockOn(p) * lampsOn();
}
`;
  const VS_STD = `
varying vec3 vW; varying vec3 vN; varying float vD;
void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
  vec4 mv = viewMatrix*w; vD = -mv.z; gl_Position = projectionMatrix*mv; }`;

  // ground: paving, car parks, verges; a procedural low-rise roofscape fills the gaps the map leaves (and the suburbs past it)
  const FS_GROUND = GLSL + LAMP + `
varying vec3 vW; varying vec3 vN; varying float vD;
vec3 roofPal(float h){
  if (h < 0.30) return mix(vec3(0.46,0.31,0.25), vec3(0.54,0.37,0.29), fract(h*13.1)); // faded clay tile
  if (h < 0.55) return mix(vec3(0.45,0.47,0.49), vec3(0.57,0.58,0.59), fract(h*7.7));  // grey zinc / metal deck
  if (h < 0.66) return mix(vec3(0.40,0.32,0.27), vec3(0.50,0.40,0.33), fract(h*5.3));  // rusty zinc
  if (h < 0.93) return mix(vec3(0.58,0.57,0.53), vec3(0.69,0.67,0.62), fract(h*9.1));  // concrete slab
  return mix(vec3(0.34,0.42,0.48), vec3(0.32,0.40,0.36), fract(h*3.3));                  // painted roof
}
const vec3 RAVG = vec3(0.50,0.46,0.42);
// block frame: blocks ~7.5 x 5.5 units, slowly rotating street grid; returns lane coverage (0 roof .. 1 lane)
float laneAt(vec2 q, float fw, out vec2 bi, out vec2 bf){
  vec2 bs = vec2(7.5, 5.5); bi = floor(q/bs); bf = q - bi*bs;
  vec2 e = min(bf, bs - bf);
  vec2 lw = vec2(mod(bi.x, 4.0) < 0.5 ? 0.85 : 0.42, mod(bi.y, 5.0) < 0.5 ? 0.85 : 0.42); // every few blocks an arterial
  vec2 l = 1.0 - smoothstep(lw*0.5 - fw, lw*0.5 + fw, e);
  return max(l.x, l.y);
}
vec3 roofscape(vec2 p, float fw, float ed, out float lane){
  float a = (vnoise(p*0.0045+7.0)-0.5)*3.0; float ca = cos(a), sa = sin(a);
  mat2 rot = mat2(ca, sa, -sa, ca);
  vec2 q = rot*p, sd = rot*normalize(SUN.xz);
  vec2 bi, bf; lane = laneAt(q, fw, bi, bf);
  vec2 bi2, bf2; float laneS = laneAt(q + sd*0.4, fw, bi2, bf2); // lane in the shade of the roofs on its sun side
  float bh = hash12(bi + 31.0), det = 1.0 - smoothstep(0.08, 0.32, fw);
  vec3 col;
  if (bh < 0.6) { // terrace / shop houses in back-to-back rows
    bool ax = hash12(bi + 7.0) < 0.5; vec2 r = ax ? bf : bf.yx; float sdy = ax ? sd.y : sd.x;
    float rowW = (ax ? 5.5 : 7.5) * 0.5, row = floor(r.y/rowW), ry = r.y/rowW - row;
    float uw = 0.5 + 0.3*hash12(bi + row*3.1), ui = floor(r.x/uw), ux = r.x/uw - ui;
    float run = hash12(vec2(floor(ui/4.0), row) + bi*2.3), ch = hash12(vec2(ui, row) + bi*1.7);
    vec3 c0 = roofPal(fract(run*0.83 + bh*0.4)) * (0.9 + 0.18*ch);
    float gable = sign(ry - 0.5) * sdy;             // pitched roofs: the sun-side slope is brighter
    float gap = 1.0 - smoothstep(0.03, 0.03 + fw/uw, min(ux, 1.0-ux));
    vec3 cd = c0 * (1.0 + 0.2*gable) * (1.0 - 0.45*gap);
    col = mix(c0 * (0.94 + 0.1*hash12(bi)), cd, det);
  } else if (bh < 0.8) { // flats / factories / malls: one big slab with rooftop plant
    vec3 c0 = roofPal(fract(bh*7.3 + 0.55)) * 1.04;
    vec2 g = bf*2.2; float box = step(0.86, hash12(floor(g) + bi)) * step(abs(fract(g.x)-0.5), 0.3) * step(abs(fract(g.y)-0.5), 0.3);
    float rim = 1.0 - smoothstep(0.55, 0.62, min(min(bf.x, 7.5-bf.x), min(bf.y, 5.5-bf.y)));
    col = mix(c0, c0*mix(1.0, 0.72, box)*(1.0 + 0.12*rim), det);
  } else if (bh < 0.9) { // trees / scrub
    col = mix(vec3(0.19,0.25,0.12), vec3(0.27,0.32,0.16), vnoise(p*0.9)) * (0.8 + 0.3*vnoise(p*2.7));
  } else { // open car park: asphalt with white stall lines
    float st = abs(fract(bf.x*4.0) - 0.5)*0.25;
    float stall = (1.0 - smoothstep(0.02, 0.02 + fw, st)) * step(0.45, fract(bf.y*0.8)) * det;
    col = mix(vec3(0.30,0.30,0.31), vec3(0.6,0.6,0.58), stall*0.6);
  }
  vec3 lc = vec3(0.27,0.27,0.28) * (1.0 - 0.35*laneS*smoothstep(0.3, 0.7, uDay));
  col = mix(col, lc, lane);
  return mix(col, mix(RAVG, vec3(0.42,0.43,0.40), smoothstep(400.0, 900.0, ed)), smoothstep(1.0, 3.0, fw));
}
void main(){
  vec2 p = vW.xz; float ed = length(p);
  float fw = max(fwidth(p.x), fwidth(p.y));
  vec4 sh = shAt(p);
  float n2 = vnoise(p*0.7), n3 = vnoise(p*0.11+4.0);
  // paved yards and verges
  vec3 alb = mix(vec3(0.45,0.445,0.42), vec3(0.54,0.53,0.49), n3) * (0.93 + 0.12*n2);
  float cp = smoothstep(0.6, 0.64, vnoise(p*0.07+11.0)); // car parks
  float stl = (1.0 - smoothstep(0.03, 0.03 + fw, abs(fract(p.x*4.0)-0.5)*0.25)) * step(0.55, fract(p.y*0.85)) * (1.0 - smoothstep(0.06, 0.15, fw));
  alb = mix(alb, mix(vec3(0.29,0.29,0.3), vec3(0.62,0.62,0.6), stl*0.7) * (0.94 + 0.1*n2), cp);
  float veg = smoothstep(0.6, 0.68, fbm(p*0.03) + 0.08*n3); // pocket greens, ~10%
  alb = mix(alb, mix(vec3(0.24,0.32,0.15), vec3(0.32,0.39,0.19), n3)*(0.85+0.3*n2), veg);
  // roofscape: fades in where the map data thins out, everywhere past the mapped edge
  float lane = 0.0;
  float rw = smoothstep(110.0, 200.0, ed) * smoothstep(0.18, 0.3, vnoise(p*0.018 + 2.0));
  rw = max(rw, smoothstep(380.0, 430.0, ed));
  if (rw > 0.001) {
    vec3 rs = roofscape(p, fw, ed, lane);
    float grn = smoothstep(0.6, 0.72, vnoise(p*0.011 + 9.0)) * smoothstep(380.0, 450.0, ed) * 0.8; // suburban green belts past the edge
    rs = mix(rs, mix(vec3(0.20,0.27,0.13), vec3(0.28,0.33,0.17), vnoise(p*0.2))*(0.85+0.25*vnoise(p*1.3)), grn * (1.0 - lane));
    alb = mix(alb, rs, rw); lane *= rw * (1.0 - grn);
  }
  float hill = smoothstep(0.05, 1.0, vW.y);
  alb = mix(alb, vec3(0.17,0.26,0.12)*(0.8+0.4*n2), hill);
  alb *= 1.0 - 0.28*sh.g*smoothstep(0.2, 0.8, uDay);
  vec3 n = normalize(vN);
  vec3 col = alb*natLight(n, max(sh.r, sh.b*0.8), sh.g) + alb*lampAt(p)*1.5;
  // night: the lanes of the roofscape glow sodium, like the low-rise districts of a real aerial night shot
  col += lane * vec3(1.0,0.56,0.24) * 0.16 * (0.6 + 0.4*vnoise(p*0.3)) * lampsOn() * blockOn(p) * (1.0 - smoothstep(1.5, 6.0, fw)*0.4);
  gl_FragColor = vec4(fogc(col, vD), 1.0);
}`;

  // area kinds: 2 park,3 forest,4 pitch,5 golf,6 plaza,7 cemetery
  const VS_AREA = `attribute float aK; varying float vK;
varying vec3 vW; varying float vD;
void main(){ vK = aK; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix*w; vD = -mv.z; gl_Position = projectionMatrix*mv; }`;
  const FS_AREA = GLSL + LAMP + `
varying float vK; varying vec3 vW; varying float vD;
vec2 worley(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8., d2=8.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 o=vec2(hash12(i+g), hash12(i+g+19.7));
    vec2 r=g+o-f; float d=dot(r,r); if(d<d1){ d2=d1; d1=d; } else if(d<d2) d2=d; }
  return vec2(sqrt(d1), sqrt(d2)); }
void main(){
  vec2 p = vW.xz; float k = vK; float n2 = vnoise(p*0.9), n1 = fbm(p*0.08);
  float fw = fwidth(p.x);
  vec3 alb; vec3 nn = vec3(0.,1.,0.);
  vec4 sh = shAt(p); float tsh = sh.b;
  if (k < 2.1) { alb = mix(vec3(0.33,0.45,0.19), vec3(0.42,0.52,0.24), n1) * (0.9+0.2*n2); }
  else if (k < 2.5) { // urban wood floor: shaded lawn + leaf litter between the instanced trees
    alb = mix(vec3(0.28,0.39,0.16), vec3(0.38,0.47,0.21), n1) * (0.84+0.22*n2);
    alb = mix(alb, vec3(0.30,0.27,0.18), smoothstep(0.55, 0.8, vnoise(p*0.45+3.0))*0.5);
  }
  else if (k < 3.5) { // rainforest canopy seen from above: crown cells
    vec2 w = worley(p*0.75 + vec2(fbm(p*0.2))*0.6);
    float dome = 1.0 - smoothstep(0.0, 0.85, w.x), gap = smoothstep(0.0, 0.3, w.y-w.x + 0.12*(vnoise(p*3.1)-0.5));
    float cell = hash12(floor(p*0.75));
    vec3 a = mix(vec3(0.10,0.21,0.08), vec3(0.20,0.33,0.12), cell);
    float det = 1.0 - smoothstep(0.25, 0.7, fw);
    alb = mix(a*0.82, a*(0.62+0.5*dome)*(0.68+0.32*gap)*(0.85+0.3*vnoise(p*2.3)), det) * (0.85+0.3*n1);
    tsh = 0.0;
  }
  else if (k < 4.5) { alb = vec3(0.30,0.52,0.22)*(0.92+0.1*step(0.5,fract(p.x*0.35))) * (0.95+0.1*n2); }
  else if (k < 5.5) { float rough = smoothstep(0.45,0.62,fbm(p*0.05)); alb = mix(vec3(0.42,0.60,0.25), vec3(0.28,0.42,0.17), rough)*(0.93+0.14*n2); }
  else if (k < 6.5) { alb = vec3(0.60,0.58,0.54)*(0.9+0.16*n2); }
  else {
    vec2 tc = p*3.2; float tomb = step(0.42, hash12(floor(tc))) * step(abs(fract(tc.x)-0.5), 0.36) * step(abs(fract(tc.y)-0.5), 0.3);
    float det = 1.0 - smoothstep(0.08, 0.3, fw);
    vec3 grass = mix(vec3(0.30,0.38,0.20), vec3(0.38,0.43,0.25), n1);
    vec3 stone = mix(vec3(0.56,0.55,0.52), vec3(0.66,0.64,0.6), hash12(floor(tc)+5.0));
    alb = mix(mix(grass, stone, 0.5), mix(grass, stone, tomb), det) * (0.9+0.18*n2);
    float wood = smoothstep(0.52, 0.6, fbm(p*0.09 + 4.0));  // tree clumps between the tomb terraces
    alb = mix(alb, mix(vec3(0.11,0.19,0.08), vec3(0.19,0.27,0.11), vnoise(p*1.7))*(0.75+0.4*vnoise(p*4.0)), wood);
  }
  alb *= 1.0 - 0.25*sh.g*smoothstep(0.2, 0.8, uDay);
  vec3 col = alb*natLight(nn, max(sh.r, tsh), sh.g) + alb*lampAt(p)*(k>2.5&&k<3.5 ? 0.6 : 1.3);
  gl_FragColor = vec4(fogc(col, vD), 1.0);
}`;

  // water: kind 0 lake/river, 1 pool, 2 stream
  const FS_WATER = GLSL + LAMP + `
varying float vK; varying vec3 vW; varying float vD;
// analytic reflection of the Petronas Twin Towers (tapering cylinders) for the KLCC lake
float twinHit(vec3 o, vec3 r){
  float hit = 0.0; vec2 d = normalize(r.xz); float k = length(r.xz) + 1e-4;
  for (int i = 0; i < 2; i++) {
    vec2 c = i == 0 ? vec2(45.78,-31.77) : vec2(53.91,-38.71);
    vec2 oc = o.xz - c; float b = dot(oc, d), cc = dot(oc, oc);
    float rad = 2.75;
    for (int j = 0; j < 2; j++) {
      float disc = b*b - (cc - rad*rad);
      if (disc > 0.0) {
        float s = -b - sqrt(disc); float y = o.y + r.y*s/k;
        rad = y < 29.0 ? 2.7 : y < 33.0 ? 2.35 : y < 36.5 ? 1.9 : y < 38.0 ? 1.25 : y < 41.0 ? 0.65 : 0.18;
        if (j == 1 && s > 0.0 && y < 45.0) hit = max(hit, 1.0 - smoothstep(38.0, 45.0, y)*0.6);
      } else break;
    }
  }
  return hit;
}
void main(){
  vec2 p = vW.xz; vec3 V = normalize(cameraPosition - vW);
  float fres = 0.05 + 0.95*pow(1.0 - clamp(V.y,0.0,1.0), 4.0);
  float rip = vnoise(p*1.6 + vec2(uTime*0.12, uTime*0.07)) + 0.5*vnoise(p*4.3 - uTime*0.18);
  vec4 sh = shAt(p);
  vec3 sky = mix(vec3(0.06,0.06,0.13), vec3(0.62,0.72,0.84), uDay); sky = mix(sky, vec3(0.85,0.52,0.42), uDusk*0.7);
  vec3 deep = mix(vec3(0.012,0.016,0.03), vec3(0.13,0.24,0.22), uDay) * (1.0 - 0.45*sh.r*uDay);
  if (vK > 1.5) deep = mix(vec3(0.012,0.016,0.03), vec3(0.22,0.26,0.19), uDay);
  vec3 col = mix(deep, sky, clamp(fres*(0.75+0.3*rip), 0.0, 1.0));
  // reflections of lamp-lit banks: smear the light map away from the viewer, broken up by ripples
  vec2 dv = normalize(-V.xz + 1e-4); vec3 rl = vec3(0.0);
  for (int i=1;i<4;i++){ rl += lampTex(p + dv*float(i)*2.0 + vec2(rip-0.75)*0.6) * (1.2-float(i)*0.25); }
  rl *= blockOn(p) * lampsOn();
  vec2 sq = vec2(dot(p, vec2(dv.y,-dv.x))*3.0, dot(p, dv)*0.6);
  float sp = smoothstep(0.55, 0.9, vnoise(sq + vec2(0.0, uTime*0.4)));
  rl = min(rl, vec3(0.55)); // lamp-lit banks, capped so rivers under lit flyovers do not turn into white strips
  col += rl * (0.1 + 0.45*sp) * (0.5+0.5*fres);
  if (vK < 0.5 && length(p - vec2(52.0,-18.0)) < 30.0) { // the Twin Towers mirrored in the KLCC lake
    vec3 R = reflect(-V, normalize(vec3((rip-0.75)*0.05, 1.0, (vnoise(p*2.2+uTime*0.2)-0.5)*0.05)));
    float tw = twinHit(vW, R);
    float streak = 0.55 + 0.45*vnoise(vec2(dot(p, vec2(dv.y,-dv.x))*5.0, dot(p, dv)*0.35 + uTime*0.3));
    col += vec3(0.8,0.85,1.0) * 0.6 * tw * streak * (1.0-uDay) * smoothstep(0.3, 0.8, uOn);
    col = mix(col, vec3(0.62,0.65,0.7)*natLight(vec3(0.,1.,0.))*1.1, tw * 0.55 * smoothstep(0.3, 1.0, uDay));
  }
  if (vK > 0.5 && vK < 1.5) { // swimming pool, lit from inside at night
    float c = vnoise(p*6.0 + uTime*0.3);
    col = mix(vec3(0.24,0.66,0.74)*(0.85+0.3*c), vec3(0.62,0.85,0.92), fres*0.4) * natLight(vec3(0.,1.,0.), sh.r, 0.0) * 1.25;
    col += vec3(0.04,0.3,0.38)*(0.75+0.25*c) * lampsOn() * blockOn(p);
  }
  gl_FragColor = vec4(fogc(col, vD), 1.0);
}`;

  // road ribbons: aR = (u along, v across -1..1, class, width)
  const VS_ROAD = `attribute vec4 aR; varying vec4 vR;
varying vec3 vW; varying float vD;
void main(){ vR = aR; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix*w; vD = -mv.z; gl_Position = projectionMatrix*mv; }`;
  const FS_ROAD = GLSL + LAMP + `
varying vec4 vR; varying vec3 vW; varying float vD;
float band(float x, float w, float fw){ return 1.0 - smoothstep(w*0.5-fw, w*0.5+fw, abs(x)); }
void main(){
  vec2 p = vW.xz; float u = vR.x, cls = vR.z, w = vR.w; float x = vR.y*w*0.5; // across, in units (+x = left of +u)
  float fw = max(fwidth(x), 1e-4);
  float det = 1.0 - smoothstep(0.03, 0.09, fw); // markings fade when sub-pixel
  float n2 = vnoise(p*1.3), n3 = vnoise(vec2(u*0.15, x*2.0));
  vec3 alb;
  if (cls < 1.5) alb = vec3(0.20,0.205,0.215);
  else if (cls < 3.5) alb = vec3(0.225,0.226,0.235);
  else if (cls < 5.5) alb = vec3(0.25,0.25,0.255);
  else if (cls < 6.5) alb = vec3(0.28,0.28,0.28);
  else if (cls < 7.5) alb = vec3(0.32,0.315,0.305);
  else if (cls < 8.5) alb = vec3(0.56,0.52,0.47);
  else alb = vec3(0.33,0.30,0.27);
  alb *= 0.9 + 0.12*n2 + 0.08*n3;
  float hw = w*0.5, nl = 1.0, lw = 1.0, xl = 0.0;
  if (cls < 6.5) {
    float kerb = smoothstep(hw-0.05-fw, hw-0.05, abs(x));
    alb = mix(alb, vec3(0.55,0.54,0.5), kerb*0.7);
    float edge = band(abs(x)-(hw-0.13), 0.025, fw);
    float mk = edge*(cls < 5.5 ? 1.0 : 0.0);
    nl = max(1.0, floor((w-0.2)/0.34 + 0.5)); lw = (w-0.26)/nl;
    xl = x + (w-0.26)*0.5; float m = abs(fract(xl/lw + 0.5) - 0.5)*lw;
    float dash = step(fract(u/1.0), 0.32) * step(abs(x), hw-0.2) * step(1.5, nl);
    mk = max(mk, band(m, 0.022, fw)*dash);
    if (cls > 5.5) mk = max(mk, band(x, 0.02, fw)*step(fract(u/0.9), 0.4)*step(0.55, w));
    alb = mix(alb, vec3(0.8,0.8,0.76), mk*det*0.85);
  } else if (cls > 8.5) { // rail: ballast, sleepers, two rails
    float sl = step(fract(u*1.6), 0.4)*step(abs(x), 0.14);
    alb = mix(alb, vec3(0.42,0.38,0.33), sl*det);
    alb = mix(alb, vec3(0.5,0.5,0.52), band(abs(x)-0.072, 0.012, fw)*det);
  }
  vec4 sh = shAt(p);
  vec3 col = alb*natLight(vec3(0.,1.,0.), max(sh.r, sh.b*0.8), sh.g*0.6) + alb*lampAt(p)*1.6;
  // night: long-exposure light trails on the main roads - white towards the camera, red going away (traffic keeps left)
  if (cls < 5.5) {
    float on = (1.0-smoothstep(0.3, 0.9, uDay)) * blockOn(p);
    if (on > 0.001) {
      vec2 dpx = dFdx(p), dpy = dFdy(p); float dux = dFdx(u), duy = dFdy(u);
      vec2 g = vec2(dux*dpy.y - duy*dpx.y, dpx.x*duy - dux*dpy.x);   // ~ grad(u) * det
      float det2 = dpx.x*dpy.y - dpx.y*dpy.x;
      float dir = x > 0.0 ? 1.0 : -1.0;
      float toward = step(0.0, dot(g, cameraPosition.xz - p) * det2 * dir);
      float li = floor(xl/lw), lc = abs(fract(xl/lw) - 0.5)*lw;
      float lh = hash12(vec2(li, cls*7.0 + floor(u/300.0)));
      float den = cls < 1.5 ? 0.42 : cls < 2.5 ? 0.5 : cls < 3.5 ? 0.58 : cls < 4.5 ? 0.7 : 0.82;
      float ph = u*0.07 - uTime*0.15*dir;
      float tr = max(smoothstep(den, 1.0, fract(ph + lh)), 0.7*smoothstep(den + 0.06, 1.0, fract(ph*1.37 + lh*3.1 + 0.4)));
      float wl = 0.07, cov = band(lc, wl, fw) * min(1.0, wl/(2.0*fw)) + 0.25*band(lc, 0.24, fw)*min(1.0, 0.24/(2.0*fw));
      vec3 tc = mix(vec3(1.0,0.09,0.04)*1.25, vec3(1.0,0.9,0.74)*1.45, toward);
      col += tc * tr * cov * on * step(abs(x), hw - 0.12);
    }
  }
  gl_FragColor = vec4(fogc(col, vD), 1.0);
}`;

  // concrete structures (flyover sides, piers, viaducts, monorail beams): vertex colour + normal
  const VS_CON = `attribute vec3 color; varying vec3 vC;
varying vec3 vW; varying vec3 vN; varying float vD;
void main(){ vC = color; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vec4 mv = viewMatrix*w; vD = -mv.z; gl_Position = projectionMatrix*mv; }`;
  const FS_CON = GLSL + LAMP + `
varying vec3 vC; varying vec3 vW; varying vec3 vN; varying float vD;
void main(){
  vec3 n = normalize(vN); vec3 alb = vC*(0.92+0.12*vnoise(vW.xz*2.0+vW.y*3.0));
  float dn = clamp(-n.y, 0.0, 1.0), side = 1.0 - abs(n.y);
  vec3 lamp = lampAt(vW.xz) * (0.4 + 1.5*dn + 0.3*side) * clamp(1.4 - vW.y*0.35, 0.3, 1.4);
  vec4 sh = shAt(vW.xz);
  vec3 col = alb*natLight(n, sh.r*(0.35 + 0.65*max(n.y, 0.0)), 0.0) + alb*lamp;
  gl_FragColor = vec4(fogc(col, vD), 1.0);
}`;

  // trees: instanced; aT 0 crown / 1 trunk; per-instance tint. Crowns get lumpy silhouettes + leaf-clump shading.
  const VS_TREE = GLSL + `attribute float aT; attribute vec3 aTint; varying float vT; varying vec3 vTint; varying vec3 vL; varying vec3 vC;
varying vec3 vW; varying vec3 vN; varying float vD;
void main(){ vT = aT; vTint = aTint; vL = position;
  vec3 io = instanceMatrix[3].xyz;
  float lump = vnoise3(position*1.7 + io*0.37) + 0.5*vnoise3(position*3.6 - io*0.21);
  vec3 pos = position + normal*(lump - 0.75)*0.22*(1.0 - aT);
  vC = (modelMatrix*instanceMatrix*vec4(0.0, 0.62, 0.0, 1.0)).xyz;
  vec4 w = modelMatrix*instanceMatrix*vec4(pos,1.0); vW = w.xyz;
  vec3 s2 = vec3(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz), dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz), dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));
  vN = normalize(mat3(modelMatrix)*mat3(instanceMatrix)*(normal/s2)); vec4 mv = viewMatrix*w; vD = -mv.z; gl_Position = projectionMatrix*mv; }`;
  const FS_TREE = GLSL + LAMP + `
varying float vT; varying vec3 vTint; varying vec3 vL; varying vec3 vC; varying vec3 vW; varying vec3 vN; varying float vD;
void main(){
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  if (vT < 0.5) { // close up: ragged leafy outline instead of a polygon edge
    float rim = 1.0 - abs(dot(n, normalize(cameraPosition - vW)));
    if (rim * (1.0 - smoothstep(20.0, 55.0, vD)) > 0.3 + 0.55*vnoise3(vW*7.0)) discard;
  }
  if (vT < 0.5) n = normalize(mix(n, normalize((vW - vC)*vec3(1.0, 1.35, 1.0)), 0.7)); // round crown shading, not facets
  // leaf clumps (~1.5 m): directional shading along the sun + darker crevices
  vec3 q = vW*6.5; float c1 = vnoise3(q), c2 = vnoise3(q + SUN*0.45), c3 = vnoise3(q*2.3 + 7.0);
  float clump = clamp(0.62 + 1.5*(c1 - c2) + 0.35*c1, 0.15, 1.35);
  float crev = mix(0.55 + 0.45*smoothstep(0.2, 0.75, c1*0.7 + c3*0.3), 1.0, vT);
  vec3 alb = mix(vTint*(0.82+0.3*c3), vec3(0.24,0.2,0.16), vT);
  float ao = mix(0.55 + 0.45*clamp(vL.y, 0.0, 1.0), 1.0, vT*0.5) * crev;
  vec4 sh = shAt(vW.xz);
  float d = smoothstep(0.0, 1.0, uDay);
  vec3 amb = mix(vec3(0.56,0.62,0.72), vec3(0.52,0.4,0.5), uDusk)*0.62*(0.72+0.28*n.y);
  vec3 sunC = mix(vec3(1.0,0.95,0.86), vec3(1.0,0.6,0.36), uDusk)*0.66*max(dot(n,SUN)*0.8+0.2, 0.0)*mix(1.0, clump, 1.0-vT)*(1.0-0.85*sh.r);
  vec3 lit = mix(vec3(0.05,0.045,0.07)*(0.6 + 0.4*n.y) + vec3(0.07,0.04,0.06)*uDusk, amb + sunC, d); // night: faint city sky-glow
  vec3 col = alb*lit*ao;
  // night: street lamps light the crowns from below (sodium / LED, from the same light map as the road)
  // + a warm fill from the blurred street-light density, so roadside crowns never go pure black
  vec3 lp = lampAt(vW.xz) + (texture2D(uLM, mapUV(vW.xz), 3.0).rgb*0.5 + texture2D(uLM, mapUV(vW.xz), 6.0).rgb*2.0)*blockOn(vW.xz)*lampsOn();
  float up = 0.7 + 1.5*max(-n.y, 0.0) + 0.6*(1.0 - abs(n.y));
  col += alb*lp*up*clamp(1.5 - vL.y*0.8, 0.5, 1.5)*(0.6 + 0.4*c1)*0.95;
  gl_FragColor = vec4(fogc(col, vD), 1.0);
}`;

  // far field past the mapped area: one instanced mesh of plain blocks (open bottom), day concrete / night window glow
  const VS_FAR = GLSL + `attribute vec4 aC; varying vec4 vC; varying vec2 vF; varying float vR;
varying vec3 vW; varying vec3 vN; varying float vD;
void main(){ vC = aC;
  vec4 w = modelMatrix*instanceMatrix*vec4(position,1.0); vW = w.xyz;
  vec3 sx = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vF = vec2(abs(normal.x) > 0.5 ? position.z*sx.z : position.x*sx.x, position.y*sx.y); vR = step(0.5, normal.y);
  vN = normalize(mat3(modelMatrix)*mat3(instanceMatrix)*(normal/(sx*sx))); vec4 mv = viewMatrix*w; vD = -mv.z; gl_Position = projectionMatrix*mv; }`;
  const FS_FAR = GLSL + LAMP + `
varying vec4 vC; varying vec2 vF; varying float vR; varying vec3 vW; varying vec3 vN; varying float vD;
void main(){
  vec3 n = normalize(vN);
  vec2 g = vec2(vF.x/0.4, vF.y/0.32), gi = floor(g);
  float fwv = max(fwidth(g.x), fwidth(g.y)), det = 1.0 - smoothstep(0.3, 0.8, fwv);
  float win = step(abs(fract(g.x)-0.5), 0.3) * step(abs(fract(g.y)-0.5), 0.28);
  vec3 alb = vC.rgb * mix(1.0, 0.8 + 0.25*win*step(0.5, vC.a), det*(1.0-vR)) * (vR > 0.5 ? 1.05 : 0.92);
  vec3 col = alb*natLight(n) + alb*lampAt(vW.xz)*0.35*(1.0 - 0.6*vR);
  float lit = step(0.6, hash12(gi + vC.a*311.0)), warm = step(0.4, hash12(gi*1.7 + vC.a*97.0));
  vec3 wc = mix(vec3(0.75,0.82,1.0)*0.8, vec3(1.0,0.68,0.36), warm);
  float e = mix(0.17, lit*win*(0.6 + 0.6*hash12(gi + 3.7)), det) * (1.0 - vR) * step(0.12, vF.y);
  col += wc * e * 0.95 * (1.0-smoothstep(0.1, 0.6, uDay)) * blockOn(vW.xz);
  gl_FragColor = vec4(fogc(col, vD), 1.0);
}`;

  // glowing points: lamps, fountains and trains (aBody: day body colour + alpha)
  const GLOW_FS = `
uniform float uDay; varying vec3 vCol; varying vec4 vBody; varying float vI; varying float vF;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0; float r2 = dot(c,c); if (r2 > 1.0) discard;
  float g = (exp(-r2*14.0) + 0.22*exp(-r2*3.0)) * (1.0 - r2);
  vec3 glow = vCol*g*vI*(1.0-vF);
  float bodyA = vBody.a * step(max(abs(c.x),abs(c.y)), 0.62) * smoothstep(0.0, 0.35, uDay) * (1.0 - vF*vF);
  vec3 body = mix(vBody.rgb, vec3(0.75,0.8,0.86), vF);
  gl_FragColor = vec4(glow*(1.0-bodyA) + body*bodyA, bodyA);
}`;
  const VS_GLOW = GLSL + `
uniform float uPx; attribute vec3 aCol; attribute vec4 aBody; attribute float aS;
varying vec3 vCol; varying vec4 vBody; varying float vI; varying float vF;
void main(){
  vec4 w = modelMatrix*vec4(position,1.0); vec4 mv = viewMatrix*w; gl_Position = projectionMatrix*mv;
  float d = -mv.z; float px = aS*0.5*uPx/d;
  gl_PointSize = clamp(px, 1.4, 18.0); vI = clamp(px*px/2.0, 0.35, 1.0) * smoothstep(3.0, 8.0, d); // no floating halos right at the camera
  vF = 1.0-exp(-uFogD*uFogD*d*d);
  float on = lampsOn()*blockOn(w.xz);
  vCol = aCol*on; vBody = vec4(aBody.rgb*natLight(vec3(0.,1.,0.))*1.2, aBody.a*smoothstep(8.0, 22.0, d));
}`;
  // traffic: each car rides one road segment (aA -> aB) and loops; head/tail colour from its heading vs the camera
  const VS_CAR = GLSL + `
uniform float uPx; attribute vec3 aA; attribute vec3 aB; attribute vec4 aP; attribute vec3 aBody;
varying vec3 vCol; varying vec4 vBody; varying float vI; varying float vF;
void main(){
  float s = fract(aP.x + uTime*aP.y);
  vec3 pos = mix(aA, aB, s); vec3 dir = aB - aA;
  vec4 mv = viewMatrix*modelMatrix*vec4(pos,1.0); gl_Position = projectionMatrix*mv;
  float d = -mv.z; float sz = mix(0.3, 0.26, uDay); float px = sz*uPx/d;
  gl_PointSize = clamp(px, 1.4, 40.0); vI = clamp(px*px/1.96, 0.3, 1.0);
  vF = 1.0-exp(-uFogD*uFogD*d*d);
  float head = step(0.0, dot(dir, cameraPosition - pos));
  float on = blockOn(pos.xz) * (1.0-smoothstep(0.3, 0.9, uDay));
  vCol = mix(vec3(1.0,0.12,0.05)*0.85, vec3(1.0,0.92,0.78)*1.05, head) * on;
  vBody = vec4(aBody*natLight(vec3(0.,1.,0.))*1.15, smoothstep(10.0, 30.0, d));
}`;

  // simplified landmark shadow casters (they are not in city.bin): [x, z, radius, y0, y1] tiers, units
  const LM_CAST = [];
  for (const [cx, cz, bx, bz] of [[45.78, -31.77, 44.0, -34.3], [53.91, -38.71, 50.65, -41.5]]) {
    LM_CAST.push([cx, cz, 2.7, 0, 29], [cx, cz, 2.35, 29, 33], [cx, cz, 1.9, 33, 36.5], [cx, cz, 1.25, 36.5, 38], [cx, cz, 0.65, 38, 41], [cx, cz, 0.2, 41, 45.2], [bx, bz, 1.15, 0, 18.5]);
  }
  LM_CAST.push([-39.5, 20.7, 0.85, 0, 30.5], [-39.5, 20.7, 2.2, 30.5, 33.5], [-39.5, 20.7, 0.45, 33.5, 36], [-39.5, 20.7, 0.14, 36, 42.1]); // KL Tower
  LM_CAST.push([-73.6, 145.2, 2.7, 0, 37.5], [-73.4, 144.9, 2.4, 37.5, 50], [-73.1, 144.5, 1.8, 50, 52.5], [-72.6, 143.8, 1.2, 52.5, 55], [-72.0, 142.4, 0.25, 55, 67.9]); // Merdeka 118
  LM_CAST.push([126.4, 142.85, 3.4, 0, 40], [126.4, 142.85, 2.6, 40, 44], [126.4, 142.85, 0.6, 44, 45.4]); // Exchange 106
  LM_CAST.push([0, 0, 1.6, 0, 23.5]); // Vortex

  KLC.ground = {
    build(ctx) {
      const { THREE, data, group, uniforms: U, small } = ctx;
      ctx.heightAt = heightAt;
      ctx.sun = new THREE.Vector3(SUNV[0], SUNV[1], SUNV[2]);
      if (!U.uSun) U.uSun = { value: ctx.sun.clone() }; // the static day sun the baked shadows use; city lights by the same object
      const R = ctx.rng(5150); const __t0 = performance.now();
      const uPx = { value: 800 };
      const shared = { uDay: U.uDay, uDusk: U.uDusk, uOn: U.uOn, uTime: U.uTime, uFog: U.uFog, uFogD: U.uFogD };
      const W = { 1: 1.6, 2: 1.45, 3: 1.35, 4: 1.15, 5: 0.95, 6: 0.65, 7: 0.42, 8: 0.4, 20: 0.55 };
      const elevOf = (cls, lv) => (cls >= 20 ? 0.95 + 0.32 * (lv - 1) : 0.15 + 0.68 * lv);
      // lamp colour per road: LED white on big roads, sodium orange on small ones
      const SOD = [1.0, 0.58, 0.22], LED = [0.86, 0.9, 1.0], WARM = [1.0, 0.82, 0.58];
      const lampCol = (cls, s) => { const pL = cls <= 3 ? 0.45 : cls <= 5 ? 0.3 : 0.14; return s < pL ? LED : s < pL + 0.15 ? WARM : SOD; };
      const roads = data.lines.filter((l) => l.cls <= 8 || l.cls === 20);
      roads.forEach((l, i) => { l.s = ((Math.sin(i * 12.9898 + l.pts[0] * 78.233) * 43758.5453) % 1 + 1) % 1; l.lc = lampCol(l.cls, l.s); });
      const statics = []; // geometries whose CPU arrays can be dropped after upload
      const freeArr = function () { this.array = null; };

      // ---------- light map: road glow baked into a canvas ----------
      const LMN = small ? 1024 : 2048, sc = LMN / (2 * LM_R), cvx = (x) => (x + LM_R) * sc;
      const cv = document.createElement('canvas'); cv.width = cv.height = LMN;
      const g2 = cv.getContext('2d'); g2.fillStyle = '#000'; g2.fillRect(0, 0, LMN, LMN);
      g2.globalCompositeOperation = 'lighter'; g2.lineCap = 'round'; g2.lineJoin = 'round';
      const ringPath = (g, r, ox, oz, rev) => {
        const n = r.length / 2;
        for (let k = 0; k < n; k++) { const i = (rev ? n - 1 - k : k) * 2, X = cvx(r[i] + ox), Z = cvx(r[i + 1] + oz); if (k) g.lineTo(X, Z); else g.moveTo(X, Z); }
        g.closePath();
      };
      // plazas get a warm uplit glow; park paths a soft bollard glow
      g2.fillStyle = 'rgba(255,204,140,0.22)'; g2.beginPath();
      for (const a of data.areas) if (a.kind === 6) ringPath(g2, a.ring, 0, 0);
      g2.fill();
      const groups = new Map();
      for (const l of roads) { if (l.cls > 6 && l.cls !== 8) continue; const lc = l.cls === 8 ? WARM : l.lc, k = l.cls + '|' + lc.join(); if (!groups.has(k)) groups.set(k, { cls: l.cls, c: lc, ls: [] }); groups.get(k).ls.push(l); }
      const passes = [[2.6, 0.05], [1.1, 0.12], [0.25, 0.34]];
      for (const [extra, a] of passes) for (const gr of groups.values()) {
        const w = W[gr.cls] + extra, bright = gr.cls <= 3 ? 1.0 : gr.cls <= 5 ? 0.85 : gr.cls === 8 ? 0.45 : 0.6;
        g2.strokeStyle = `rgba(${gr.c.map((v) => Math.round(v * 255 * bright)).join(',')},${a})`; g2.lineWidth = w * sc;
        g2.beginPath();
        for (const l of gr.ls) { const p = l.pts; g2.moveTo(cvx(p[0]), cvx(p[1])); for (let j = 2; j < p.length; j += 2) g2.lineTo(cvx(p[j]), cvx(p[j + 1])); }
        g2.stroke();
      }
      const canvasTex = (c) => {
        const t = new THREE.CanvasTexture(c); t.flipY = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
        t.anisotropy = Math.min(4, ctx.renderer.capabilities.getMaxAnisotropy());
        t.onUpdate = () => { c.width = c.height = 1; }; // the canvas is not needed once uploaded
        return t;
      };
      const lmTex = canvasTex(cv);
      const shTex = new THREE.Texture(); // filled once the trees are placed (they cast shadows too)
      const uni = (extra) => Object.assign({ uLM: { value: lmTex }, uSH: { value: shTex } }, shared, extra || {});
      const mat = (vs, fs, o) => new THREE.ShaderMaterial(Object.assign({ vertexShader: vs, fragmentShader: fs, uniforms: uni(), extensions: { derivatives: true } }, o || {}));
      const overlay = (m) => { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; return m; };
      const geom = (attrs, idx) => {
        const g = new THREE.BufferGeometry();
        for (const k in attrs) g.setAttribute(k, attrs[k]);
        if (idx) g.setIndex(idx);
        statics.push(g); return g;
      };
      const F = (a, n) => new THREE.Float32BufferAttribute(a, n);

      // ---------- ground plane + hill (one mesh): polar grid over the hill whose rim sinks below the plane ----------
      {
        const NR = small ? 16 : 26, NA = small ? 48 : 72, RMAX = 1.25, pos = [], idx = [];
        for (let i = 0; i <= NR; i++) for (let j = 0; j < NA; j++) {
          const r = (i / NR) * RMAX, a = (j / NA) * Math.PI * 2, x = HX + Math.cos(a) * r * HRX, z = HZ + Math.sin(a) * r * HRZ;
          pos.push(x, heightAt(x, z) - 0.06, z);
        }
        for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * NA + j, b = i * NA + ((j + 1) % NA), c = a + NA, d = b + NA; idx.push(a, c, b, b, c, d); }
        const hg = new THREE.BufferGeometry(); hg.setAttribute('position', F(pos, 3)); hg.setIndex(idx); hg.computeVertexNormals();
        const nor = Array.from(hg.attributes.normal.array), b0 = pos.length / 3, E = 3000;
        pos.push(-E, -0.03, -E, -E, -0.03, E, E, -0.03, E, E, -0.03, -E); nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
        const g = geom({ position: F(pos, 3), normal: F(nor, 3) }, idx);
        const m = new THREE.Mesh(g, mat(VS_STD, FS_GROUND)); m.renderOrder = -10; m.frustumCulled = false; group.add(m);
      }

      // ---------- polygon helpers ----------
      const toV2 = (r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push(new THREE.Vector2(r[i], r[i + 1])); return o; };
      // triangulate (with holes); split triangles on the hill so they follow it
      function triangulate(ring, holes, lift, outPos, outK, k) {
        const c = toV2(ring), hs = holes.map(toV2);
        if (THREE.ShapeUtils.isClockWise(c)) c.reverse();
        hs.forEach((h) => { if (!THREE.ShapeUtils.isClockWise(h)) h.reverse(); });
        let faces; try { faces = THREE.ShapeUtils.triangulateShape(c, hs); } catch (e) { return; }
        const all = c.concat(...hs);
        const emit = (ax, az, bx, bz, cx, cz, depth) => {
          const onHill = nearHill(ax, az) || nearHill(bx, bz) || nearHill(cx, cz);
          if (onHill && depth < 6) {
            const l1 = Math.hypot(ax - bx, az - bz), l2 = Math.hypot(bx - cx, bz - cz), l3 = Math.hypot(cx - ax, cz - az);
            if (Math.max(l1, l2, l3) > (small ? 3.5 : 2.2)) {
              const abx = (ax + bx) / 2, abz = (az + bz) / 2, bcx = (bx + cx) / 2, bcz = (bz + cz) / 2, cax = (cx + ax) / 2, caz = (cz + az) / 2;
              emit(ax, az, abx, abz, cax, caz, depth + 1); emit(abx, abz, bx, bz, bcx, bcz, depth + 1); emit(cax, caz, bcx, bcz, cx, cz, depth + 1); emit(abx, abz, bcx, bcz, cax, caz, depth + 1);
              return;
            }
          }
          for (const [x, z] of [[ax, az], [cx, cz], [bx, bz]]) { const h = heightAt(x, z); outPos.push(x, h + (h > 0 ? lift + 0.03 : lift), z); outK.push(k); }
        };
        for (const f of faces) { const a = all[f[0]], b = all[f[1]], cc = all[f[2]]; emit(a.x, a.y, b.x, b.y, cc.x, cc.y, 0); }
      }
      function inRing(r, x, z) { let ins = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins; } return ins; }
      const bbox = (r) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); } return [x0, x1, z0, z1]; };
      const area2 = (r) => { let s = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) s += r[j] * r[i + 1] - r[i] * r[j + 1]; return s; };
      const bigForest = (a) => Math.abs(area2(a.ring)) > 800 || nearHill(a.ring[0], a.ring[1]); // small woods are open groves

      // ---------- parks, forest, pitches, golf, plazas, cemeteries ----------
      const ORDER = { 7: 0, 5: 1, 2: 2, 3: 3, 6: 4, 4: 5 };
      const land = data.areas.filter((a) => ORDER[a.kind] !== undefined).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
      {
        const pos = [], ks = [];
        for (const a of land) triangulate(a.ring, a.holes, 0, pos, ks, a.kind === 3 && !bigForest(a) ? 2.2 : a.kind);
        const m = new THREE.Mesh(geom({ position: F(pos, 3), aK: F(ks, 1) }), overlay(mat(VS_AREA, FS_AREA))); m.renderOrder = -9; m.frustumCulled = false; group.add(m);
      }
      // ---------- water: rivers/lakes, pools, streams ----------
      const waterAreas = data.areas.filter((a) => a.kind === 1 || a.kind === 8);
      {
        const pos = [], ks = [];
        for (const a of waterAreas) triangulate(a.ring, a.holes, 0.004, pos, ks, a.kind === 8 ? 1 : 0);
        for (const wl of data.waterLines) {
          const p = wl.pts, hw = Math.max(wl.width, 0.12) * 0.75;
          for (let j = 0; j + 3 < p.length; j += 2) {
            const x0 = p[j], z0 = p[j + 1], x1 = p[j + 2], z1 = p[j + 3], L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = (z1 - z0) / L * hw, nz = -(x1 - x0) / L * hw;
            const q = [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz]];
            for (const t of [0, 2, 1, 1, 2, 3]) { pos.push(q[t][0], heightAt(q[t][0], q[t][1]) + 0.006, q[t][1]); ks.push(2); }
          }
        }
        const m = new THREE.Mesh(geom({ position: F(pos, 3), aK: F(ks, 1) }), overlay(mat(VS_AREA, FS_WATER))); m.renderOrder = -8; m.frustumCulled = false; group.add(m);
      }

      // ---------- roads ----------
      function densify(p, maxLen, force) {
        const o = [p[0], p[1]];
        for (let j = 2; j < p.length; j += 2) {
          const x0 = p[j - 2], z0 = p[j - 1], x1 = p[j], z1 = p[j + 1], L = Math.hypot(x1 - x0, z1 - z0);
          const n = force || nearHill(x0, z0) || nearHill(x1, z1) ? Math.ceil(L / maxLen) : 1;
          for (let k = 1; k <= n; k++) o.push(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n);
        }
        return o;
      }
      // per-point left normals with mitre, cumulative length
      function frame(p) {
        const n = p.length / 2, nx = new Float32Array(n), nz = new Float32Array(n), m = new Float32Array(n), u = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
          let ax = p[i * 2] - p[i0 * 2], az = p[i * 2 + 1] - p[i0 * 2 + 1], bx = p[i1 * 2] - p[i * 2], bz = p[i1 * 2 + 1] - p[i * 2 + 1];
          const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
          if (la > 1e-6) { ax /= la; az /= la; } else { ax = bx / (lb || 1); az = bz / (lb || 1); }
          if (lb > 1e-6) { bx /= lb; bz /= lb; } else { bx = ax; bz = az; }
          let tx = ax + bx, tz = az + bz; const lt = Math.hypot(tx, tz) || 1; tx /= lt; tz /= lt;
          nx[i] = tz; nz[i] = -tx; m[i] = Math.min(2.2, 1 / Math.max(0.3, tx * ax + tz * az));
          u[i] = i ? u[i - 1] + la : 0;
        }
        return { n, nx, nz, m, u };
      }
      // endpoints/vertices of every line, to find where flyovers touch down
      const vgrid = new Map(), vkey = (x, z) => Math.round(x * 2) + ',' + Math.round(z * 2);
      for (const l of data.lines) for (let j = 0; j < l.pts.length; j += 2) { const k = vkey(l.pts[j], l.pts[j + 1]); const o = vgrid.get(k); if (o === undefined || l.level < o) vgrid.set(k, l.level); }
      const lowestNear = (x, z, lv) => { let lo = lv; for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) { const o = vgrid.get(Math.round(x * 2) + dx + ',' + (Math.round(z * 2) + dz)); if (o !== undefined && o < lo) lo = o; } return lo; };
      // elevation profile along an elevated line (ramps where it meets lower roads)
      function profile(l, p, f) {
        const base = elevOf(l.cls, l.level), L = f.u[f.n - 1], e = new Float32Array(f.n);
        const lo0 = lowestNear(p[0], p[1], l.level), lo1 = lowestNear(p[p.length - 2], p[p.length - 1], l.level);
        const t0 = lo0 < l.level ? (lo0 === 0 ? 0.02 : elevOf(l.cls, lo0)) : base, t1 = lo1 < l.level ? (lo1 === 0 ? 0.02 : elevOf(l.cls, lo1)) : base;
        const r0 = Math.min(14, L * (t1 !== base ? 0.45 : 0.9)), r1 = Math.min(14, L * (t0 !== base ? 0.45 : 0.9));
        const ss = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
        for (let i = 0; i < f.n; i++) e[i] = base + (t0 - base) * (1 - ss(f.u[i] / r0)) + (t1 - base) * (1 - ss((L - f.u[i]) / r1));
        return e;
      }

      const rPos = [], rAt = [], rIdx = [], ePos = [], eAt = [], eIdx = [];
      const cPos = [], cNor = [], cCol = [];
      const CON = [0.62, 0.6, 0.57], CON2 = [0.5, 0.49, 0.47];
      const quad = (a, b, c, d, n, col) => { for (const v of [a, b, c, a, c, d]) { cPos.push(v[0], v[1], v[2]); cNor.push(n[0], n[1], n[2]); cCol.push(col[0], col[1], col[2]); } };
      function box(x, z, y0, y1, hx, hz, dx, dz, col, beam) { // oriented box sides (+ bottom when lifted); beam: long sides only
        const ax = dx * hx, az = dz * hx, bx = -dz * hz, bz = dx * hz;
        const P = (sx, sz, y) => [x + ax * sx + bx * sz, y, z + az * sx + bz * sz];
        if (!beam) { quad(P(1, -1, y0), P(1, 1, y0), P(1, 1, y1), P(1, -1, y1), [dx, 0, dz], col); quad(P(-1, 1, y0), P(-1, -1, y0), P(-1, -1, y1), P(-1, 1, y1), [-dx, 0, -dz], col); }
        quad(P(1, 1, y0), P(-1, 1, y0), P(-1, 1, y1), P(1, 1, y1), [-dz, 0, dx], col);
        quad(P(-1, -1, y0), P(1, -1, y0), P(1, -1, y1), P(-1, -1, y1), [dz, 0, -dx], col);
        if (y0 > 0.3 && !(beam && hz < 0.1)) quad(P(-1, -1, y0), P(-1, 1, y0), P(1, 1, y0), P(1, -1, y0), [0, -1, 0], col);
      }
      const lampPts = [], lampCols = [], lampS = [], carSegs = [], elevShadow = [];
      const sortedRoads = roads.slice().sort((a, b) => (a.cls === 20 ? 9 : 9 - Math.min(a.cls, 8)) - (b.cls === 20 ? 9 : 9 - Math.min(b.cls, 8)));
      const pierD2 = small ? 150 * 150 : 230 * 230, bottomD2 = small ? 60 * 60 : 160 * 160;
      const farCut = small ? { 6: 300, 7: 140, 8: 140 } : { 7: 260, 8: 260 };
      const keepLamp = small ? 0.4 : 0.6; // the light map carries the glow; points are just the lamp heads
      for (const l of sortedRoads) {
        const elev = l.level > 0, fc = farCut[l.cls];
        if (fc && Math.hypot(l.pts[0], l.pts[1]) > fc && Math.hypot(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]) > fc) continue;
        const p = densify(l.pts, elev ? 4.0 : 2.0, elev), f = frame(p), w = W[l.cls], hw = w / 2;
        const e = elev ? profile(l, p, f) : null;
        const P = elev ? ePos : rPos, A = elev ? eAt : rAt, I = elev ? eIdx : rIdx, b0 = P.length / 3;
        const ys = new Float32Array(f.n);
        for (let i = 0; i < f.n; i++) {
          const x = p[i * 2], z = p[i * 2 + 1], ox = f.nx[i] * hw * f.m[i], oz = f.nz[i] * hw * f.m[i];
          const y = heightAt(x, z) + (elev ? e[i] : 0.012 + (nearHill(x, z) ? 0.05 : 0)); ys[i] = y;
          P.push(x + ox, y, z + oz, x - ox, y, z - oz);
          const cl = l.cls === 20 ? 20 : l.cls; A.push(f.u[i], 1, cl, w, f.u[i], -1, cl, w);
          if (i) { const a = b0 + (i - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
        if (elev) { // deck sides, underside, piers
          elevShadow.push({ p, e, w });
          const th = l.cls === 20 ? 0.2 : 0.17, wall = l.cls <= 6 ? 0.05 : 0.03;
          let nextPier = 2;
          for (let i = 1; i < f.n; i++) {
            const L0 = [p[i * 2 - 2] + f.nx[i - 1] * hw * f.m[i - 1], p[i * 2 - 1] + f.nz[i - 1] * hw * f.m[i - 1]], L1 = [p[i * 2] + f.nx[i] * hw * f.m[i], p[i * 2 + 1] + f.nz[i] * hw * f.m[i]];
            const R0 = [p[i * 2 - 2] - f.nx[i - 1] * hw * f.m[i - 1], p[i * 2 - 1] - f.nz[i - 1] * hw * f.m[i - 1]], R1 = [p[i * 2] - f.nx[i] * hw * f.m[i], p[i * 2 + 1] - f.nz[i] * hw * f.m[i]];
            const y0 = ys[i - 1], y1 = ys[i], b0y = Math.max(y0 - th, heightAt(p[i * 2 - 2], p[i * 2 - 1]) - 0.02), b1y = Math.max(y1 - th, heightAt(p[i * 2], p[i * 2 + 1]) - 0.02);
            const nl = [f.nx[i], 0, f.nz[i]], nr = [-f.nx[i], 0, -f.nz[i]];
            quad([L0[0], b0y, L0[1]], [L1[0], b1y, L1[1]], [L1[0], y1 + wall, L1[1]], [L0[0], y0 + wall, L0[1]], nl, CON);
            quad([R1[0], b1y, R1[1]], [R0[0], b0y, R0[1]], [R0[0], y0 + wall, R0[1]], [R1[0], y1 + wall, R1[1]], nr, CON);
            if (e[i] > 0.3 && p[i * 2] * p[i * 2] + p[i * 2 + 1] * p[i * 2 + 1] < bottomD2) quad([L1[0], b1y, L1[1]], [L0[0], b0y, L0[1]], [R0[0], b0y, R0[1]], [R1[0], b1y, R1[1]], [0, -1, 0], CON2);
            if (f.u[i] >= nextPier && e[i] > 0.45 && l.cls !== 7 && p[i * 2] * p[i * 2] + p[i * 2 + 1] * p[i * 2 + 1] < pierD2) {
              const x = p[i * 2], z = p[i * 2 + 1], g0 = heightAt(x, z), top = ys[i] - th, dx = -f.nz[i], dz = f.nx[i];
              box(x, z, g0 - 0.05, top - 0.12, 0.11, 0.13, dx, dz, CON2);
              box(x, z, top - 0.14, top, Math.min(hw * 0.85, 0.65), 0.12, f.nx[i], f.nz[i], CON);
              nextPier = f.u[i] + (l.cls === 20 ? 4 : 5.2);
            }
          }
        }
        // street lamps
        if (l.cls <= 6 || l.cls === 8) {
          const ped = l.cls === 8, sp = ped ? 2.2 : l.cls <= 3 ? 3.2 : l.cls <= 5 ? 3.6 : 4.2, both = (l.cls <= 4 || elev) && !ped;
          const lc = ped ? WARM.map((c) => c * 2) : l.lc === LED ? LED.map((c) => c * 0.8) : l.lc;
          let s = (l.s * sp) % sp, side = 1;
          for (let i = 1; i < f.n; i++) {
            const L = f.u[i] - f.u[i - 1]; if (L < 1e-4) continue;
            while (s <= f.u[i]) {
              const t = (s - f.u[i - 1]) / L, x = p[i * 2 - 2] + (p[i * 2] - p[i * 2 - 2]) * t, z = p[i * 2 - 1] + (p[i * 2 + 1] - p[i * 2 - 1]) * t;
              const y = ys[i - 1] + (ys[i] - ys[i - 1]) * t + (ped ? 0.35 : 0.95), off = elev || ped ? 0 : hw + 0.12;
              const sides = elev ? [0] : both ? [1, -1] : [side];
              for (const sd of sides) {
                if (!elev && !ped && R() > keepLamp) continue;
                lampPts.push(x + f.nx[i] * off * sd, y, z + f.nz[i] * off * sd); lampCols.push(lc[0], lc[1], lc[2]); lampS.push(ped ? 0.45 : elev ? 1.0 : 0.85);
              }
              side = -side; s += sp;
            }
          }
        }
        // traffic segments (cls 1-5 and flyovers)
        if (l.cls <= 5) {
          for (let i = 1; i < f.n; i++) carSegs.push([p[i * 2 - 2], ys[i - 1], p[i * 2 - 1], p[i * 2], ys[i], p[i * 2 + 1], f.nx[i], f.nz[i], hw, l.cls]);
        }
      }
      const roadMesh = (pos, at, idx, ov) => {
        const g = geom({ position: F(pos, 3), aR: F(at, 4) }, pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
        const m = mat(VS_ROAD, FS_ROAD, { side: THREE.DoubleSide }); if (ov) overlay(m);
        const me = new THREE.Mesh(g, m); me.frustumCulled = false; return me;
      };
      const rm = roadMesh(rPos, rAt, rIdx, true); rm.renderOrder = -7; group.add(rm);
      group.add(roadMesh(ePos, eAt, eIdx, false));

      // ---------- rail guideways: LRT viaducts and KL Monorail beams ----------
      const rails = data.lines.filter((l) => (l.cls === 21 || l.cls === 23) && l.level > 0);
      for (const l of rails) {
        const p = densify(l.pts, 2.5, false), mono = l.cls === 23, y0 = elevOf(20, l.level), sp = mono ? 3.0 : 3.6;
        elevShadow.push({ p, e: null, y: y0, w: mono ? 0.45 : 0.72 });
        let s = 1.5;
        for (let j = 2; j < p.length; j += 2) {
          const ax = p[j - 2], az = p[j - 1], bx = p[j], bz = p[j + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
          if (L < 1e-4) continue;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2, gy = heightAt(mx, mz) + y0, tx = dx / L, tz = dz / L;
          if (mono) for (const o of [0.17, -0.17]) box(mx + tz * o, mz - tx * o, gy - 0.16, gy, L / 2 + 0.02, 0.045, tx, tz, CON, true);
          else { box(mx, mz, gy - 0.2, gy, L / 2 + 0.02, 0.36, tx, tz, CON, true); quad([ax + tz * 0.36, gy, az - tx * 0.36], [bx + tz * 0.36, gy, bz - tx * 0.36], [bx - tz * 0.36, gy, bz + tx * 0.36], [ax - tz * 0.36, gy, az + tx * 0.36], [0, 1, 0], CON2); }
          for (; s < L; s += sp) { // piers along the segment
            const x = ax + tx * s, z = az + tz * s; if (x * x + z * z > pierD2) continue;
            const g0 = heightAt(x, z);
            if (mono) { box(x, z, g0 - 0.05, gy - 0.16, 0.07, 0.07, tx, tz, CON2); box(x, z, gy - 0.26, gy - 0.16, 0.06, 0.26, tx, tz, CON2); }
            else box(x, z, g0 - 0.05, gy - 0.2, 0.12, 0.16, tx, tz, CON2);
          }
          s -= L;
        }
      }
      {
        const m = new THREE.Mesh(geom({ position: F(cPos, 3), normal: F(cNor, 3), color: F(cCol, 3) }), mat(VS_CON, FS_CON, { side: THREE.DoubleSide })); m.frustumCulled = false; group.add(m);
      }

      // ---------- garden lamps in the central parks: warm pools of light on lawns + bollard heads ----------
      {
        const gl = [];
        for (const a of land) {
          if (a.kind !== 2 && !(a.kind === 3 && Math.abs(area2(a.ring)) < 1600 && !nearHill(a.ring[0], a.ring[1]))) continue;
          const [x0, x1, z0, z1] = bbox(a.ring); if (Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) > 220) continue;
          for (let x = x0; x < x1; x += 3.4) for (let z = z0; z < z1; z += 3.4) {
            const px = x + R() * 3.4, pz = z + R() * 3.4;
            if (!inRing(a.ring, px, pz) || waterAreas.some((w) => inRing(w.ring, px, pz))) continue;
            gl.push([px, pz]);
          }
        }
        g2.globalCompositeOperation = 'lighter';
        for (const [x, z] of gl) {
          const X = cvx(x), Z = cvx(z), r = 2.2 * sc, gr = g2.createRadialGradient(X, Z, 0, X, Z, r);
          gr.addColorStop(0, 'rgba(255,190,120,0.26)'); gr.addColorStop(1, 'rgba(255,190,120,0)');
          g2.fillStyle = gr; g2.fillRect(X - r, Z - r, 2 * r, 2 * r);
          lampPts.push(x, heightAt(x, z) + 0.3, z); lampCols.push(1.6, 1.15, 0.7); lampS.push(0.45);
        }
      }
      // ---------- KLCC lake fountains (Lake Symphony): a few lit jets on the lake's north side ----------
      {
        let lake = null, best = 1e9;
        for (const a of waterAreas) {
          if (a.kind !== 1) continue; const [x0, x1, z0, z1] = bbox(a.ring), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, d = Math.hypot(cx - 50, cz + 20);
          if (d < best && d < 25 && (x1 - x0) * (z1 - z0) > 10) { best = d; lake = a; }
        }
        if (lake) {
          const [x0, x1, z0, z1] = bbox(lake.ring), cand = [];
          for (let x = x0; x <= x1; x += 0.6) for (let z = z0; z <= z1; z += 0.6) if (inRing(lake.ring, x, z) && inRing(lake.ring, x + 0.8, z) && inRing(lake.ring, x - 0.8, z) && inRing(lake.ring, x, z - 0.8)) cand.push([x, z]);
          cand.sort((a, b) => a[1] - b[1]);
          const jets = [];
          for (const c of cand) { if (jets.length >= 9) break; if (jets.every((j) => Math.hypot(j[0] - c[0], j[1] - c[1]) > 1.1)) jets.push(c); }
          for (const [x, z] of jets) {
            const H = 0.5 + R() * 0.7;
            for (let k = 0; k < 11; k++) { const t = k / 10; lampPts.push(x, 0.05 + H * t, z); const c = 1.1 - t * 0.5; lampCols.push(0.75 * c, 0.9 * c, 1.0 * c); lampS.push(0.3 - t * 0.12); }
          }
        }
      }

      // ---------- trains on the guideways (positions updated per frame) ----------
      const runs = [];
      {
        const pool = rails.map((l) => ({ cls: l.cls, lv: l.level, p: Array.from(l.pts) }));
        const eq = (a, b) => Math.abs(a[0] - b[0]) < 0.4 && Math.abs(a[1] - b[1]) < 0.4;
        while (pool.length) { // chain pieces that share endpoints into long runs
          let cur = pool.shift(), grew = true;
          while (grew) {
            grew = false;
            for (let i = 0; i < pool.length; i++) {
              const q = pool[i]; if (q.cls !== cur.cls) continue;
              const cs = [cur.p[0], cur.p[1]], ce = cur.p.slice(-2), qs = [q.p[0], q.p[1]], qe = q.p.slice(-2);
              const rev = (a) => { const o = []; for (let j = a.length - 2; j >= 0; j -= 2) o.push(a[j], a[j + 1]); return o; };
              if (eq(ce, qs)) cur.p = cur.p.concat(q.p.slice(2)); else if (eq(ce, qe)) cur.p = cur.p.concat(rev(q.p).slice(2));
              else if (eq(cs, qe)) cur.p = q.p.concat(cur.p.slice(2)); else if (eq(cs, qs)) cur.p = rev(q.p).concat(cur.p.slice(2)); else continue;
              pool.splice(i, 1); grew = true; break;
            }
          }
          const p = cur.p, u = [0]; for (let j = 2; j < p.length; j += 2) u.push(u[u.length - 1] + Math.hypot(p[j] - p[j - 2], p[j + 1] - p[j - 1]));
          if (u[u.length - 1] > 25) runs.push({ cls: cur.cls, y: elevOf(20, cur.lv), p, u, L: u[u.length - 1] });
        }
      }
      const trains = [];
      runs.sort((a, b) => b.L - a.L);
      for (const r of runs) { const n = Math.max(1, Math.round(r.L / 70)); for (let k = 0; k < n; k++) trains.push({ r, ph: (k + R() * 0.5) / n, v: r.cls === 23 ? 1.4 : 2.0, len: r.cls === 23 ? 4.0 : 7.0, side: k % 2 ? 1 : -1 }); }
      const TS = 0.22, tCount = trains.reduce((s, t) => s + Math.ceil(t.len / TS), 0);

      // ---------- glow points: lamps + fountains + trains in one Points (train part re-uploaded per frame) ----------
      const glowMat = () => new THREE.ShaderMaterial({ vertexShader: VS_GLOW, fragmentShader: GLOW_FS, uniforms: uni({ uPx }), transparent: true, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, extensions: { derivatives: true } });
      const nL = lampPts.length / 3, gPos = new Float32Array((nL + tCount) * 3); gPos.set(lampPts);
      const gAttr = new THREE.BufferAttribute(gPos, 3); gAttr.setUsage(THREE.DynamicDrawUsage); gAttr.updateRange = { offset: nL * 3, count: tCount * 3 };
      {
        const col = new Float32Array((nL + tCount) * 3), s = new Float32Array(nL + tCount), body = new Float32Array((nL + tCount) * 4);
        for (let i = 0; i < nL; i++) { const k = 0.75 + R() * 0.4; col[i * 3] = lampCols[i * 3] * k; col[i * 3 + 1] = lampCols[i * 3 + 1] * k; col[i * 3 + 2] = lampCols[i * 3 + 2] * k; s[i] = lampS[i]; }
        let o = nL;
        for (const t of trains) for (let k = 0; k < Math.ceil(t.len / TS); k++, o++) {
          const w = R() < 0.85 ? [0.95, 0.92, 0.82] : [0.7, 0.85, 1.0]; col.set([w[0] * 0.9, w[1] * 0.9, w[2] * 0.9], o * 3); s[o] = 0.6;
          body.set(t.r.cls === 23 ? [0.85, 0.3, 0.28, 1] : [0.88, 0.89, 0.9, 1], o * 4);
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', gAttr); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aS', new THREE.BufferAttribute(s, 1)); g.setAttribute('aBody', new THREE.BufferAttribute(body, 4));
        for (const k of ['aCol', 'aS', 'aBody']) g.attributes[k].onUpload(freeArr);
        const m = new THREE.Points(g, glowMat()); m.frustumCulled = false; m.renderOrder = 2; group.add(m);
      }
      // ---------- traffic ----------
      {
        const DEN = { 1: 0.38, 2: 0.3, 3: 0.24, 4: 0.15, 5: 0.07 }, SPD = { 1: 2.2, 2: 1.8, 3: 1.3, 4: 1.1, 5: 0.9 }, dk = small ? 0.5 : 1;
        const BODY = [[0.92, 0.92, 0.9], [0.92, 0.92, 0.9], [0.92, 0.92, 0.9], [0.7, 0.72, 0.74], [0.7, 0.72, 0.74], [0.12, 0.12, 0.13], [0.12, 0.12, 0.13], [0.42, 0.43, 0.45], [0.6, 0.12, 0.1], [0.15, 0.25, 0.45]];
        const A = [], B = [], Pp = [], Bd = [];
        for (const sg of carSegs) {
          const [ax, ay, az, bx, by, bz, nx, nz, hw, cls] = sg, L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
          const lanes = Math.max(1, Math.round((hw * 2 - 0.2) / 0.68));
          for (const dir of [1, -1]) {
            let cnt = L * DEN[cls] * dk; cnt = Math.floor(cnt) + (R() < cnt % 1 ? 1 : 0);
            for (let c = 0; c < cnt; c++) {
              const lane = (Math.floor(R() * lanes) + 0.5) / lanes, off = (0.08 + lane * (hw - 0.16)) * dir; // Malaysia drives on the left
              const ox = nx * off, oz = nz * off, y = 0.05;
              if (dir > 0) { A.push(ax + ox, ay + y, az + oz); B.push(bx + ox, by + y, bz + oz); } else { A.push(bx + ox, by + y, bz + oz); B.push(ax + ox, ay + y, az + oz); }
              Pp.push(R(), (SPD[cls] * (0.75 + R() * 0.5)) / L, R(), 0); Bd.push(...BODY[Math.floor(R() * BODY.length)]);
            }
          }
        }
        const n = A.length / 3;
        const g = geom({ position: F(new Float32Array(n * 3), 3), aA: F(A, 3), aB: F(B, 3), aP: F(Pp, 4), aBody: F(Bd, 3) });
        const m = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: VS_CAR, fragmentShader: GLOW_FS, uniforms: uni({ uPx }), transparent: true, depthWrite: false,
          blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, extensions: { derivatives: true } }));
        m.frustumCulled = false; m.renderOrder = 2; group.add(m);
      }
      function sampleRun(r, s, out) {
        s = Math.max(0, Math.min(r.L, s)); let lo = 0, hi = r.u.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r.u[mid] <= s) lo = mid; else hi = mid; }
        const t = (s - r.u[lo]) / Math.max(1e-6, r.u[hi] - r.u[lo]), p = r.p;
        const dx = p[hi * 2] - p[lo * 2], dz = p[hi * 2 + 1] - p[lo * 2 + 1], dl = Math.hypot(dx, dz) || 1;
        out[0] = p[lo * 2] + dx * t; out[1] = p[lo * 2 + 1] + dz * t; out[2] = dz / dl; out[3] = -dx / dl;
      }
      const tmp = [0, 0, 0, 0];
      function updateTrains(time) {
        let o = nL * 3;
        for (const t of trains) {
          const span = t.r.L - t.len, cyc = (t.ph + (time * t.v) / (2 * span)) % 1, head = t.len + span * (cyc < 0.5 ? cyc * 2 : 2 - cyc * 2), back = cyc >= 0.5;
          const n = Math.ceil(t.len / TS), lat = t.r.cls === 23 ? (back ? -0.17 : 0.17) : back ? -0.18 : 0.18;
          for (let k = 0; k < n; k++) {
            sampleRun(t.r, head - k * TS, tmp);
            gPos[o++] = tmp[0] + tmp[2] * lat; gPos[o++] = heightAt(tmp[0], tmp[1]) + t.r.y + (t.r.cls === 23 ? 0.02 : 0.16); gPos[o++] = tmp[1] + tmp[3] * lat;
          }
        }
        if (tCount) gAttr.needsUpdate = true;
      }

      // ---------- trees ----------
      const pick = [[], [], []];
      const bgrid = new Map(), cell = 8;
      { // building / water lookup so scattered trees avoid roofs and lakes
        const addTo = (ring, ref) => {
          const [x0, x1, z0, z1] = bbox(ring);
          for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz++) { const k = gx + ',' + gz; if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(ref); }
        };
        for (const b of data.buildings) if (b.min < 0.5) addTo(b.ring, b.ring);
        for (const a of waterAreas) addTo(a.ring, a.ring);
        const blocked = (x, z) => { const c = bgrid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)); if (c) for (const r of c) if (inRing(r, x, z)) return true; return false; };
        // candidates: [x, z, type 0 forest crown/1 broadleaf with trunk/2 palm, radius, height, priority]
        const cand = [];
        const tr = data.trees, J = () => 0.85 + R() * 0.3;
        for (let i = 0; i < tr.length; i += 2) { const x = tr[i], z = tr[i + 1], r = R(); cand.push([x, z, r < 0.28 ? 2 : 1, (0.45 + R() * 0.4) * J(), (0.9 + R() * 0.6) * J(), Math.hypot(x, z) * 0.5 * (0.6 + R() * 0.8)]); }
        const SPC = { 3: 1.25, 2: 3.9, 5: 4.2, 7: 4.5 };
        for (const a of land) {
          const urbanWood = a.kind === 3 && !bigForest(a), sp = urbanWood ? 2.1 : SPC[a.kind]; if (!sp) continue; // small urban woods (e.g. KLCC Park): open canopy
          const r = a.ring, [x0, x1, z0, z1] = bbox(r);
          for (let gx = x0; gx < x1; gx += sp) for (let gz = z0; gz < z1; gz += sp) {
            const x = gx + R() * sp, z = gz + R() * sp;
            if (!inRing(r, x, z) || a.holes.some((h) => inRing(h, x, z))) continue;
            const d = Math.hypot(x, z), cl = Math.sin(x * 0.21 + Math.sin(z * 0.17) * 2.0) + Math.sin(z * 0.19 - x * 0.07);
            if (a.kind !== 3 && cl < (a.kind === 2 ? -0.1 : 0.4)) continue; // open lawns / fairways
            if (urbanWood && cl < -0.6) continue;
            if (a.kind === 3) { const hb = nearHill(x, z) ? 1.25 : 1; cand.push([x, z, 0, (0.75 + R() * 0.65) * J(), (1.6 + R() * 1.6) * hb * J(), d * (0.6 + R() * 0.8)]); continue; }
            const q = R(), type = q < 0.1 ? 2 : q < 0.82 ? 1 : 0;
            // parks: big isolated rain trees with wide umbrella crowns over lawn
            const big = a.kind === 2 && type === 1, rr = big ? 0.75 + R() * 0.9 : 0.6 + R() * 0.5, hh = big ? 1.1 + R() * 0.9 : 1.0 + R() * 0.9;
            cand.push([x, z, type, rr * J(), hh * J(), d * (0.6 + R() * 0.8) * 0.8]);
          }
        }
        cand.sort((a, b) => a[5] - b[5]);
        const CAP = small ? [750, 650, 250] : [2050, 1950, 700], used = [0, 0, 0];
        for (const c of cand) { if (used[c[2]] >= CAP[c[2]]) continue; if (blocked(c[0], c[1])) continue; used[c[2]]++; pick[c[2]].push(c); }
        // geometries (unit size: crown radius 1, height 1); smooth spherical normals from the crown centre
        function crown(y0, y1, trunk, seed) {
          const rr = ctx.rng(seed), pos = [], nor = [], t = [], S = 6, cy = y0 + (y1 - y0) * 0.5;
          const ring = (y, r, ph) => { const o = []; for (let i = 0; i < S; i++) { const a = ((i + ph) / S) * Math.PI * 2, k = 1 + (rr() - 0.5) * 0.2; o.push([Math.cos(a) * r * k, y + (rr() - 0.5) * 0.05, Math.sin(a) * r * k]); } return o; };
          const top = [0, y1, 0], up = ring(y0 + (y1 - y0) * 0.7, 0.86, 0.5), md = ring(y0 + (y1 - y0) * 0.28, 1.0, 0), bot = [0, y0, 0];
          const nrm = (v) => { const x = v[0], y = (v[1] - cy) * 1.5, z = v[2], l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
          const tri = (a, b, c, tk) => { for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); const n = tk ? [v[0] * 3, 0, v[2] * 3] : nrm(v); const l = Math.hypot(n[0], n[1], n[2]) || 1; nor.push(n[0] / l, n[1] / l, n[2] / l); t.push(tk ? 1 : 0); } };
          for (let i = 0; i < S; i++) { const j = (i + 1) % S; tri(top, up[j], up[i]); tri(up[i], up[j], md[i]); tri(up[j], md[j], md[i]); tri(md[i], md[j], bot); }
          if (trunk) { const tw = 0.06, tt = [[tw, 0, 0], [-tw * 0.5, 0, tw * 0.87], [-tw * 0.5, 0, -tw * 0.87]]; for (let i = 0; i < 3; i++) { const a = tt[i], b = tt[(i + 1) % 3], A2 = [a[0], y0 + 0.12, a[2]], B2 = [b[0], y0 + 0.12, b[2]]; tri(a, b, B2, 1); tri(a, B2, A2, 1); } }
          return { pos, nor, t };
        }
        function palm() {
          const pos = [], nor = [], t = [];
          const tri = (a, b, c, tk, n) => { for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); t.push(tk); } };
          const tw = 0.05, H = 0.86; const tt = [[tw, 0, 0], [-tw * 0.5, 0, tw * 0.87], [-tw * 0.5, 0, -tw * 0.87]];
          for (let i = 0; i < 3; i++) { const a = tt[i], b = tt[(i + 1) % 3], n = [(a[0] + b[0]) * 10, 0, (a[2] + b[2]) * 10]; tri(a, b, [b[0] * 0.7, H, b[2] * 0.7], 1, n); tri(a, [b[0] * 0.7, H, b[2] * 0.7], [a[0] * 0.7, H, a[2] * 0.7], 1, n); }
          for (let i = 0; i < 7; i++) { // drooping fronds
            const a = (i / 7) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a), px = -cz * 0.16, pz = cx * 0.16;
            const base = [0, H + 0.02, 0], mid = [cx * 0.55, H + 0.1, cz * 0.55], tip = [cx * 1.0, H - 0.22, cz * 1.0];
            tri(base, [mid[0] + px, mid[1], mid[2] + pz], [mid[0] - px, mid[1], mid[2] - pz], 0, [0, 1, 0]);
            tri([mid[0] + px, mid[1], mid[2] + pz], tip, [mid[0] - px, mid[1], mid[2] - pz], 0, [cx * 0.5, 0.85, cz * 0.5]);
          }
          return { pos, nor, t };
        }
        const GEOS = [crown(0.1, 1.0, false, 11), crown(0.34, 1.0, true, 12), palm()];
        // darker, varied olive / rainforest greens (luminance ~0.12-0.30)
        const TINT = [[[0.11, 0.2, 0.08], [0.17, 0.27, 0.1], [0.14, 0.24, 0.11], [0.21, 0.28, 0.11], [0.12, 0.17, 0.07]],
          [[0.2, 0.28, 0.11], [0.25, 0.32, 0.13], [0.16, 0.25, 0.1], [0.28, 0.33, 0.16], [0.19, 0.24, 0.09]], [[0.27, 0.34, 0.14], [0.23, 0.31, 0.13]]];
        const tmat = mat(VS_TREE, FS_TREE, { side: THREE.DoubleSide }), o = new THREE.Object3D();
        for (let ty = 0; ty < 3; ty++) {
          const list = pick[ty]; if (!list.length) continue;
          const G = GEOS[ty], g = geom({ position: F(G.pos, 3), normal: F(G.nor, 3), aT: F(G.t, 1) });
          const tint = new Float32Array(list.length * 3);
          const im = new THREE.InstancedMesh(g, tmat, list.length);
          list.forEach((c, i) => {
            const [x, z, , r, h] = c, y = heightAt(x, z) - 0.02;
            o.position.set(x, y, z); o.rotation.set(0, R() * 6.283, 0);
            if (ty === 2) o.scale.set(r * 0.75, h * 1.5, r * 0.75); else o.scale.set(r, h, r);
            o.updateMatrix(); im.setMatrixAt(i, o.matrix);
            const tc = TINT[ty][Math.floor(R() * TINT[ty].length)], k = 0.85 + R() * 0.3, hr = 1 + (R() - 0.5) * 0.3, hb = 1 + (R() - 0.5) * 0.3;
            tint[i * 3] = tc[0] * k * hr; tint[i * 3 + 1] = tc[1] * k; tint[i * 3 + 2] = tc[2] * k * hb;
          });
          g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
          im.frustumCulled = false; group.add(im);
        }
      }

      // ---------- baked day shadows (r: buildings, landmarks, flyovers; g: contact AO; b: trees) ----------
      {
        const out = document.createElement('canvas'); out.width = out.height = LMN;
        const go = out.getContext('2d');
        go.fillStyle = '#000'; go.fillRect(0, 0, LMN, LMN); go.globalCompositeOperation = 'lighter'; // channels add independently
        const ox = -SUNV[0] / SUNV[1], oz = -SUNV[2] / SUNV[1], olen = Math.hypot(ox, oz); // ground offset per unit of height
        // buildings: footprint swept along the shadow direction (copies spaced below the footprint size), one small fill each
        go.fillStyle = '#f00';
        for (const b of data.buildings) {
          const r = b.ring, [x0, x1, z0, z1] = bbox(r), dm = Math.max(0.3, Math.min(x1 - x0, z1 - z0)), rev = area2(r) < 0;
          const h0 = Math.max(0, b.min), h1 = b.h, steps = Math.min(48, Math.ceil(((h1 - h0) * olen) / (dm * 0.6)));
          go.beginPath(); for (let k = 0; k <= steps; k++) { const h = h0 + ((h1 - h0) * k) / steps; ringPath(go, r, ox * h, oz * h, rev); } go.fill();
        }
        for (const [cx, cz, rad, y0, y1] of LM_CAST) {
          const steps = Math.min(60, Math.ceil(((y1 - y0) * olen) / Math.max(0.25, rad * 1.2)));
          go.beginPath();
          for (let k = 0; k <= steps; k++) { const h = y0 + ((y1 - y0) * k) / steps; go.moveTo(cvx(cx + ox * h + rad), cvx(cz + oz * h)); go.arc(cvx(cx + ox * h), cvx(cz + oz * h), rad * sc, 0, Math.PI * 2); }
          go.fill();
        }
        // flyovers and guideways
        go.strokeStyle = 'rgba(255,0,0,0.85)'; go.lineJoin = 'round';
        for (const s of elevShadow) {
          go.lineWidth = s.w * sc; go.beginPath();
          for (let i = 0; i < s.p.length / 2; i++) { const y = s.e ? s.e[i] : s.y, X = cvx(s.p[i * 2] + ox * y), Z = cvx(s.p[i * 2 + 1] + oz * y); if (i) go.lineTo(X, Z); else go.moveTo(X, Z); }
          go.stroke();
        }
        // contact AO: ground-floor footprints dilated in three soft steps (no blur pass needed)
        go.fillStyle = go.strokeStyle = 'rgba(0,70,0,1)';
        for (const wd of [3.4, 2.2, 1.1]) {
          go.lineWidth = wd * sc;
          for (let i0 = 0; i0 < data.buildings.length; i0 += 400) {
            go.beginPath();
            for (let i = i0; i < Math.min(i0 + 400, data.buildings.length); i++) { const b = data.buildings[i]; if (b.min < 0.5 && b.h > 0.6) ringPath(go, b.ring, 0, 0, false); }
            go.stroke();
          }
        }
        // tree shadows
        go.fillStyle = 'rgba(0,0,255,0.7)';
        for (let ty = 0; ty < 3; ty++) for (const [x, z, , r, h] of pick[ty]) {
          const rr = (ty === 2 ? r * 0.6 : r * 0.85) * sc, hh = ty === 2 ? h * 1.3 : h * 0.6, X = cvx(x + ox * hh), Z = cvx(z + oz * hh);
          go.beginPath(); go.arc(X, Z, rr, 0, Math.PI * 2); go.fill();
        }
        shTex.image = out; shTex.flipY = false; shTex.minFilter = THREE.LinearMipmapLinearFilter; shTex.generateMipmaps = true;
        shTex.anisotropy = Math.min(4, ctx.renderer.capabilities.getMaxAnisotropy());
        shTex.onUpdate = () => { out.width = out.height = 1; }; shTex.needsUpdate = true;
      }

      // ---------- far field: low blocks + scattered condo towers from the map edge to the haze ----------
      {
        const N = small ? 800 : 2400, CS = small ? 26 : 19, cand = [];
        const urb = (x, z) => 0.5 + 0.25 * Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2.1) + 0.25 * Math.sin(z * 0.013 - x * 0.005 + 1.7);
        for (let gx = -820; gx < 820; gx += CS) for (let gz = -820; gz < 820; gz += CS) {
          const x = gx + R() * CS, z = gz + R() * CS, d = Math.hypot(x, z), u = urb(x, z);
          if (d < 405 || d > 800 || R() > 0.35 + 0.65 * u) continue;
          cand.push([x, z, u, d + R() * 120]);
        }
        cand.sort((a, b) => a[3] - b[3]);
        const list = cand.slice(0, N), n = list.length;
        // unit box, open bottom: x,z in [-0.5,0.5], y in [0,1]
        const P = [], Nn = [], face = (a, b, c, d, nn) => { for (const v of [a, b, c, a, c, d]) { P.push(...v); Nn.push(...nn); } };
        face([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [1, 0, 0]); face([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5], [-1, 0, 0]);
        face([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5], [0, 0, 1]); face([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5], [0, 0, -1]);
        face([-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5], [0, 1, 0]);
        const g = geom({ position: F(P, 3), normal: F(Nn, 3) });
        const im = new THREE.InstancedMesh(g, mat(VS_FAR, FS_FAR), n), aC = new Float32Array(n * 4), o = new THREE.Object3D();
        const WALL = [[0.78, 0.76, 0.7], [0.72, 0.71, 0.68], [0.66, 0.64, 0.6], [0.8, 0.78, 0.72], [0.6, 0.6, 0.6], [0.7, 0.62, 0.55]], GLASS = [[0.3, 0.42, 0.46], [0.36, 0.44, 0.52], [0.42, 0.48, 0.5]];
        list.forEach(([x, z, u], i) => {
          const q = R(), tower = q < 0.03 + 0.07 * u, mid = !tower && q < 0.25 + 0.15 * u;
          const h = tower ? 7 + R() * 11 : mid ? 2.5 + R() * 3.5 : 0.5 + R() * 1.6, w = tower ? 2.2 + R() * 1.6 : 1.6 + R() * 2.6, dd = tower ? 2.2 + R() * 1.6 : 1.4 + R() * 3.0;
          o.position.set(x, -0.05, z); o.rotation.set(0, (Math.floor(R() * 4) * Math.PI) / 2 + Math.sin(x * 0.004) * 0.6, 0); o.scale.set(w, h, dd); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
          const glass = tower && R() < 0.45, c = glass ? GLASS[Math.floor(R() * GLASS.length)] : WALL[Math.floor(R() * WALL.length)], k = 0.9 + R() * 0.15;
          aC.set([c[0] * k, c[1] * k, c[2] * k, R() * 0.98 + 0.01 + (glass ? 0 : 0)], i * 4);
        });
        g.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 4));
        im.frustumCulled = false; group.add(im);
      }

// drop CPU copies of static vertex data once on the GPU (nothing raycasts the ground)
      for (const g of statics) { g.computeBoundingSphere(); for (const k in g.attributes) g.attributes[k].onUpload(freeArr); if (g.index) g.index.onUpload(freeArr); }

      const vsz = new THREE.Vector2();
      return {
        update(t) {
          ctx.renderer.getDrawingBufferSize(vsz); uPx.value = vsz.y * 0.5 * ctx.camera.projectionMatrix.elements[5];
          updateTrains(t);
        },
      };
    },
  };
})();
