// KLC.landmarks: hand-modelled Petronas Twin Towers, KL Tower, Merdeka 118, The Exchange 106 and Vortex Tower (Kozi).
// Footprints / tier heights from landmarks-ref.json (OpenStreetMap). Units: 1 = 10 m, x east, z south, y up.
// One shader family (defines per landmark) sharing the site uniforms and fog; all lights fade by day and switch on with uOn.
(function () {
  const KLC = (window.KLC = window.KLC || {});
  const TAU = Math.PI * 2;

  // ---------- reference data (scene units) ----------
  const PET = [ // tower centroid, star rotation (deg, x/z math axes), bustle centre
    { x: 45.78, z: -31.77, rot: 10.8, bx: 43.32, bz: -35.30 },
    { x: 53.91, z: -38.71, rot: -3.0, bx: 50.68, bz: -41.56 },
  ];
  // [y0, y1, outer radius] from the OSM parts (240/295/325/355/370 m)
  const PET_TIERS = [[0, 24.0, 2.93], [24.0, 29.5, 2.72], [29.5, 32.5, 2.42], [32.5, 35.5, 1.94], [35.5, 37.0, 1.3]];
  const MER = { N: [-72.49, 142.03], NE: [-71.46, 142.72], SE: [-71.53, 146.34], SW: [-75.78, 148.5], W: [-75.66, 143.59], S: [-71.95, 142.37] };
  const MER_POD = [[-76.47, 153.23], [-73.05, 153.63], [-67.53, 139.64], [-70.18, 137.65], [-70.74, 137.43], [-71.31, 137.22], [-73.99, 136.72], [-74.46, 137.34], [-73.71, 139.04], [-77.17, 142.97], [-78.01, 148.17], [-80.65, 150.16], [-80.24, 151.1], [-77.88, 152.7]];
  const EXC = [[128.6, 140.2], [127.71, 138.44], [126.45, 139.07], [123.72, 140.43], [122.26, 141.16], [122.81, 142.25], [123.02, 142.65], [123.09, 142.8], [124.84, 146.3], [125.39, 147.35], [126.36, 146.87], [129.55, 145.27], [130.2, 144.95], [130.49, 143.94], [130.2, 143.36]];
  const VOR = [[0.79, 1.44], [1.51, 0.66], [1.64, 0.13], [1.58, -0.39], [1.38, -0.88], [1.02, -1.27], [0.55, -1.52], [0.03, -1.62], [-0.5, -1.53], [-0.97, -1.29], [-1.35, -0.9], [-1.57, -0.41], [-1.62, 0.13], [-1.49, 0.65], [-1.2, 1.1], [-0.77, 1.44], [-0.26, 1.61], [0.28, 1.61]];
  const VORTEX_FLOORS = 58;

  // ---------- geometry helpers ----------
  const area2 = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
  const ccw = (P) => (area2(P) < 0 ? P.slice().reverse() : P);
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  const hardAll = (P) => { const o = []; for (const p of P) o.push(p, [p[0], p[1]]); return o; }; // duplicate every corner -> flat walls

  function G() { this.p = []; this.n = []; this.k = []; this.u = []; }
  G.prototype.v = function (x, y, z, nx, ny, nz, k, u) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.k.push(k); this.u.push(u); };
  // triangle; ref = rough outward direction, used to fix the winding (and as normal when flat)
  G.prototype.tri = function (a, b, c, k, ref, flat) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, wx = c.x - a.x, wy = c.y - a.y, wz = c.z - a.z;
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    if (nx * ref[0] + ny * ref[1] + nz * ref[2] < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
    for (const q of [a, b, c]) flat || !q.nx && q.nx !== 0 ? this.v(q.x, q.y, q.z, nx, ny, nz, k, q.u || 0) : this.v(q.x, q.y, q.z, q.nx, q.ny, q.nz, k, q.u || 0);
  };
  // ring: array of {x,y,z,u}; closed outline P2 with duplicates at hard corners -> ring vertices (+ seam copy)
  function ring(P2, y, cx = 0, cz = 0, s = 1) {
    const R = []; let u = 0;
    for (let i = 0; i <= P2.length; i++) {
      const p = P2[i % P2.length]; const x = cx + (p[0] - cx) * s, z = cz + (p[1] - cz) * s;
      if (i) { const q = R[i - 1]; u += Math.hypot(x - q.x, z - q.z); }
      R.push({ x, y: typeof y === 'function' ? y(p, i) : y, z, u: i === P2.length ? u : u });
    }
    return R;
  }
  // outward 2D tangents with hard corners where a point is duplicated
  function tangents(P2) {
    const n = P2.length, T = [];
    for (let i = 0; i < n; i++) {
      const a = P2[(i - 1 + n) % n], b = P2[i], c = P2[(i + 1) % n];
      let tx, tz;
      if (same(b, c)) { tx = b[0] - a[0]; tz = b[1] - a[1]; } else if (same(a, b)) { tx = c[0] - b[0]; tz = c[1] - b[1]; } else { tx = c[0] - a[0]; tz = c[1] - a[1]; }
      const l = Math.hypot(tx, tz) || 1; T.push([tx / l, tz / l]);
    }
    T.push(T[0]); return T;
  }
  // band between two rings with matching vertex counts; smooth normals around (from T), flat along the profile
  G.prototype.band = function (A, B, k, T, flat, axis) {
    for (let i = 0; i < A.length - 1; i++) {
      const a = A[i], b = A[i + 1], c = B[i + 1], d = B[i];
      if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-7 && Math.hypot(c.x - d.x, c.z - d.z) < 1e-7) continue;
      const mx = (a.x + b.x + c.x + d.x) / 4, mz = (a.z + b.z + c.z + d.z) / 4, my = (a.y + b.y + c.y + d.y) / 4;
      let ref = axis ? [mx - axis[0], 0, mz - axis[1]] : [0, 1, 0];
      if (!flat && T) {
        for (const [q, j, o] of [[a, i, A], [b, i + 1, A], [c, i + 1, B], [d, i, B]]) {
          const t = T[j], ox = t[1], oz = -t[0]; // outward (CCW outline)
          const other = o === A ? B[j] : A[j], sg = o === A ? 1 : -1;
          const dx = (other.x - q.x) * sg, dy = (other.y - q.y) * sg, dz = (other.z - q.z) * sg;
          const or = dx * ox + dz * oz; let nx = ox * dy, ny = -or, nz = oz * dy; const l = Math.hypot(nx, ny, nz) || 1;
          q.nx = nx / l; q.ny = ny / l; q.nz = nz / l;
        }
        ref = [(a.nx + c.nx) / 2, (a.ny + c.ny) / 2, (a.nz + c.nz) / 2];
        this.tri({ ...a }, { ...b }, { ...c }, k, ref); this.tri({ ...a }, { ...c }, { ...d }, k, ref);
        for (const q of [a, b, c, d]) delete q.nx;
      } else {
        if (my > -1e9 && axis) ref = [mx - axis[0], 0.0001, mz - axis[1]];
        const s = (q) => ({ x: q.x, y: q.y, z: q.z, u: q.u });
        this.tri(s(a), s(b), s(c), k, ref, true); this.tri(s(a), s(c), s(d), k, ref, true);
      }
    }
  };
  // flat-shaded quad a,b (bottom) c,d (top), split along a-c or b-d; axis = [x,z] centre for the outward direction
  G.prototype.quad = function (a, b, c, d, k, axis, ac) {
    const s = (q) => ({ x: q.x, y: q.y, z: q.z, u: q.u }), ref = [(a.x + c.x) / 2 - axis[0], 0.0001, (a.z + c.z) / 2 - axis[1]];
    if (ac) { this.tri(s(a), s(b), s(c), k, ref, true); this.tri(s(a), s(c), s(d), k, ref, true); }
    else { this.tri(s(a), s(b), s(d), k, ref, true); this.tri(s(b), s(c), s(d), k, ref, true); }
  };
  // fan cap (roof / floor) from a ring to a point
  G.prototype.fan = function (A, cx, cy, cz, k, up = 1, flat = true) {
    for (let i = 0; i < A.length - 1; i++) this.tri({ x: A[i].x, y: A[i].y, z: A[i].z, u: A[i].u }, { x: A[i + 1].x, y: A[i + 1].y, z: A[i + 1].z, u: A[i + 1].u }, { x: cx, y: cy, z: cz, u: A[i].u }, k, [0, up, 0], flat);
  };
  // lathe profile [[r, y, k], ...] bottom to top; k = zone of the band that starts at this point
  G.prototype.lathe = function (cx, cz, prof, seg, y0 = 0) {
    const C = []; for (let i = 0; i <= seg; i++) C.push([Math.cos((i / seg) * TAU), Math.sin((i / seg) * TAU)]);
    const pn = []; // profile segment normals (outward r, up)
    for (let j = 0; j < prof.length - 1; j++) { const dr = prof[j + 1][0] - prof[j][0], dy = prof[j + 1][1] - prof[j][1], l = Math.hypot(dr, dy) || 1; pn.push([dy / l, -dr / l]); }
    const sm = (j, b) => { const o = b === j ? j - 1 : j; const m = pn[b]; if (o < 0 || o >= pn.length) return m; const q = pn[o]; if (m[0] * q[0] + m[1] * q[1] < 0.82) return m; const l = Math.hypot(m[0] + q[0], m[1] + q[1]); return [(m[0] + q[0]) / l, (m[1] + q[1]) / l]; };
    for (let j = 0; j < prof.length - 1; j++) {
      const [r0, ya, k] = prof[j], [r1, yb] = prof[j + 1]; if (r0 < 1e-6 && r1 < 1e-6) continue;
      const n0 = sm(j, j), n1 = sm(j + 1, j);
      for (let i = 0; i < seg; i++) {
        const P = (ii, r, y, n) => ({ x: cx + C[ii][0] * r, y: y0 + y, z: cz + C[ii][1] * r, u: (ii / seg) * TAU * Math.max(r, 0.05), nx: C[ii][0] * n[0], ny: n[1], nz: C[ii][1] * n[0] });
        const a = P(i, r0, ya, n0), b = P(i + 1, r0, ya, n0), c = P(i + 1, r1, yb, n1), d = P(i, r1, yb, n1);
        const ref = [(a.nx + c.nx) / 2, (n0[1] + n1[1]) / 2, (a.nz + c.nz) / 2];
        if (r0 > 1e-6) this.tri(a, b, c, k, ref); if (r1 > 1e-6) this.tri(a, c, d, k, ref);
      }
    }
  };
  // append a three.js geometry (transformed) as zone k
  G.prototype.add3 = function (THREE, geo, m, k) {
    const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(m); g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) this.v(p[i], p[i + 1], p[i + 2], n[i], n[i + 1], n[i + 2], k, 0);
    g.dispose(); geo.dispose();
  };
  // flat roof / floor polygon (concave ok) at height y
  G.prototype.poly = function (THREE, P2, y, k, up = 1) {
    const tris = THREE.ShapeUtils.triangulateShape(P2.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const t of tris) this.tri(...t.map((i) => ({ x: P2[i][0], y, z: P2[i][1], u: 0 })), k, [0, up, 0], true);
  };
  G.prototype.mesh = function (THREE, mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(this.k, 1));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(this.u, 1));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  };

  // ---------- shaders ----------
  const VERT = `attribute float aK; attribute float aU;
varying vec3 vW; varying vec3 vN; varying float vK; varying float vU; varying float vD;
void main(){ vK=aK; vU=aU; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal);
  vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }`;
  const FRAG = `uniform float uDay; uniform float uDusk; uniform float uOn; uniform float uTime; uniform vec3 uFog; uniform float uFogD; uniform float uY0;
varying vec3 vW; varying vec3 vN; varying float vK; varying float vU; varying float vD;
#ifdef KLT
uniform vec2 uC;
#endif
#ifdef VOR
uniform float uHi0; uniform float uHi1; uniform float uHi2; uniform float uHi3;
#endif
const vec3 SUN = vec3(-0.461, 0.8016, 0.3808);
float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float DL(){ return smoothstep(0.0,1.0,uDay); }
vec3 sunC(){ return mix(vec3(1.0,0.95,0.86), vec3(1.0,0.6,0.36), uDusk); }
vec3 light(vec3 n){
  vec3 amb = mix(vec3(0.56,0.62,0.72), vec3(0.52,0.4,0.5), uDusk);
  vec3 day = amb*0.62*(0.72+0.28*n.y) + sunC()*0.66*max(dot(n,SUN),0.0);
  vec3 night = vec3(0.028,0.032,0.058) + vec3(0.07,0.04,0.06)*uDusk;
  return mix(night, day, DL()); }
vec3 sky(vec3 r){
  vec3 top = mix(vec3(0.02,0.025,0.06), vec3(0.24,0.44,0.76), uDay), hor = mix(vec3(0.16,0.1,0.17), vec3(0.8,0.85,0.9), uDay);
  hor = mix(hor, vec3(1.0,0.6,0.38), uDusk*0.85); top = mix(top, vec3(0.24,0.22,0.42), uDusk*0.5);
  vec3 c = mix(hor, top, smoothstep(0.0,0.55,r.y));
  vec3 g = mix(vec3(0.035,0.03,0.045), vec3(0.42,0.44,0.43), uDay); g = mix(g, vec3(0.36,0.25,0.22), uDusk*0.4);
  c = mix(c, g, smoothstep(0.03,-0.14,r.y));
  float sd = max(dot(r,SUN),0.0); c += sunC()*(pow(sd,300.0)*4.0 + pow(sd,12.0)*0.18)*DL();
  return c; }
float fres(vec3 n, vec3 v){ return 0.04+0.96*pow(1.0-max(dot(n,v),0.0),5.0); }
// antialiased periodic line: 1 on a band of width w (cell fraction) around integers of x
float ln(float x, float w){ float d=abs(fract(x+0.5)-0.5), fw=max(fwidth(x),1e-4); float l=1.0-smoothstep(w*0.5-fw, w*0.5+fw, d); return mix(l, w, smoothstep(0.25,0.7,fw)); }
float detail(vec2 c){ return 1.0-smoothstep(0.35,0.9,max(fwidth(c.x),fwidth(c.y))); } // 1 when cells are big enough on screen
// lit window: p = share lit, warm = share warm; fades to its average when cells are sub-pixel
vec3 win(vec2 c, float p, float warm, float us){
  vec2 cell=floor(c), unit=vec2(floor((cell.x+floor(h12(vec2(cell.y,3.1))*7.0))/us), cell.y); float r=h12(unit), s=h12(unit+17.3), t=h12(unit+5.1);
  vec3 col = t<warm ? vec3(1.0,0.66,0.34) : t<warm+0.3 ? vec3(1.0,0.86,0.66) : vec3(0.76,0.86,1.0);
  vec3 w = col*step(r,p)*(0.3+0.7*h12(unit+9.7))*(0.75+0.25*h12(cell))*smoothstep(s-0.08,s,uOn);
  vec2 f=fract(c); float pane=step(0.12,f.x)*step(f.x,0.9)*step(0.14,f.y)*step(f.y,0.86);
  vec3 avg = mix(vec3(0.76,0.86,1.0), vec3(1.0,0.74,0.45), warm)*p*0.62*smoothstep(0.0,0.6,uOn);
  return mix(avg, w*pane, detail(c)); }
vec3 glass(vec3 n, vec3 v, vec3 tint, vec3 body, float refl){
  vec3 r=reflect(-v,n); float F=fres(n,v); return body*light(n) + sky(r)*tint*mix(refl,1.0,F); }
void main(){
  vec3 n=normalize(vN); vec3 v=normalize(cameraPosition-vW); if(dot(n,v)<-0.2) n=-n;
  float y=vW.y-uY0, k=vK, nl=(1.0-uDay), on=smoothstep(0.0,0.3,uOn);
  vec3 col=vec3(0.0), em=vec3(0.0);
#ifdef PET
  vec3 silver=vec3(0.84,0.89,1.0);
  // floodlights sit on each setback and wash up the tier above it
  float tb = y<24.3 ? 0.0 : y<29.8 ? 24.3 : y<32.8 ? 29.8 : y<35.8 ? 32.8 : 35.8;
  float flood = 0.6+0.75*exp(-(y-tb)/(tb<1.0?5.0:1.6));
  vec2 hn=normalize(n.xz+1e-4), hv=normalize(v.xz+1e-4);
  float lobe=0.3+0.7*pow(abs(dot(hn,hv)),3.0);
  if(k<0.5 || (k>3.5&&k<4.5)){ // facade: stainless spandrel ribbon + sunshade + vertical mullions
    float fl=y/0.42, m1=ln(fl,0.4), m2=ln(fl+0.5,0.1), mu=ln(vU/0.17,0.12);
    float m=clamp(m1+0.7*m2+0.45*mu*(1.0-m1),0.0,1.0);
    vec3 st=vec3(0.84,0.85,0.87)*light(n) + sky(reflect(-v,n))*0.5;
    vec3 gl=glass(n,v,vec3(0.72,0.8,0.84),vec3(0.16,0.18,0.2),0.45);
    col=mix(gl,st,m)*0.92;
    vec3 w=win(vec2(vU/0.34, fl), 0.38, 0.3, 3.0);
    float rim=pow(1.0-abs(dot(n,v)),2.0);
    em=silver*(0.07+0.68*m+0.18*rim)*lobe*flood + w*(1.0-m)*0.3;
    if(k>3.5) em*=0.8;
  } else if(k<1.5){ // pinnacle steel
    float rb=ln(vU/0.08,0.3);
    col=vec3(0.72,0.74,0.78)*light(n) + sky(reflect(-v,n))*0.5;
    em=silver*(0.5+0.25*rb)*(0.75+0.25*lobe)*(0.85+0.15*smoothstep(37.0,45.0,y));
  } else if(k<2.5){ // skybridge: steel with two thin glass decks
    float gb=ln((y-17.25)/0.5,0.42);
    vec3 st=vec3(0.75,0.77,0.8)*light(n)+sky(reflect(-v,n))*0.4;
    col=mix(st, glass(n,v,vec3(0.6,0.7,0.72),vec3(0.07,0.09,0.1),0.3), gb);
    em=mix(silver*0.55, vec3(1.0,0.9,0.75)*0.8, gb);
  } else if(k<3.5){ // setback skirts
    col=vec3(0.74,0.76,0.8)*light(n)*0.85+sky(reflect(-v,n))*vec3(0.2,0.2,0.19);
    em=silver*0.95;
  } else { // legs / dark parts
    col=vec3(0.6,0.62,0.66)*light(n)+sky(reflect(-v,n))*0.3; em=silver*0.6;
  }
  em=min(em,vec3(1.15))*on;
#endif
#ifdef KLT
  float cy=0.5+0.5*sin(uTime*0.06);
  vec3 flood=mix(vec3(0.82,0.86,1.0), vec3(0.52,0.46,1.0), cy);
  float ang=atan(vW.z-uC.y, vW.x-uC.x);
  if(k<0.5){ // shaft: white concrete, uplit from the base and under the pod, 4 vertical service ribs
    float rib=ln(ang/1.5708,0.09), sr=ln(vU/0.42,0.1);
    col=vec3(0.95,0.93,0.89)*light(n)*(1.0-0.05*sr-0.3*rib);
    float lit=0.1+0.85*exp(-y*0.13)+0.65*pow(smoothstep(13.0,24.4,y),2.0);
    em=flood*lit*(0.9+0.15*sr)*(1.0-0.55*rib)*0.75;
  } else if(k<1.5){ // pod glass bands: observation deck, revolving restaurant, sky deck parapet
    float mu=ln(vU/0.22,0.14), fb=ln(y/0.5,0.1);
    col=mix(glass(n,v,vec3(0.35,0.6,0.78),vec3(0.03,0.07,0.12),0.45), vec3(0.75)*light(n), max(mu,fb)*0.6);
    em=vec3(0.9,0.94,1.0)*0.7*(1.0-max(mu,fb)*0.7) + flood*0.12;
  } else if(k<2.5){ // pod white concrete, ribbed underside cone, cap
    float rb=ln(vU/0.3,0.18)*step(y,27.6);
    col=vec3(0.95,0.94,0.91)*light(n)*(1.0-0.15*rb);
    em=flood*(0.35+0.4*smoothstep(25.0,27.6,y))*(0.8+0.4*rb)*0.8 + vec3(0.7,0.8,1.0)*0.05;
  } else if(k<3.5){ // antenna: red/white bands
    float b=step(0.5,fract(y/0.9))*step(37.5,y);
    col=mix(vec3(0.8,0.8,0.8), vec3(0.7,0.18,0.12), b)*light(n);
    em=mix(vec3(0.9,0.95,1.0), vec3(1.0,0.2,0.15), b)*0.2;
  } else if(k<4.5){ // base podium
    float a=ln(vU/0.6,0.25);
    col=vec3(0.82,0.8,0.76)*light(n)*(1.0-0.2*a);
    em=vec3(1.0,0.82,0.6)*0.5*(1.0-a)*step(0.15,y)*step(y,0.85) + flood*0.2;
  } else { // turret above the pod
    float sl=ln(y/0.5,0.15);
    col=vec3(0.9,0.89,0.86)*light(n)*(1.0-0.2*sl);
    em=flood*0.3+vec3(0.9,0.94,1.0)*0.12*sl;
  }
  em*=on*(0.6+0.4*abs(dot(n,v)));
#endif
#ifdef MER
  // songket-like diamond mullions: thin and quiet by day (the facets come from the geometry), LED lines at night
  float da=(vU+y*0.5)/1.7, db=(vU-y*0.5)/1.7;
  float dg=max(ln(da,0.02),ln(db,0.02)), dn=max(ln(da,0.05),ln(db,0.05)), fl=ln(y/0.45,0.05);
  if(k<1.5){ // faceted glass facade and crown
    col=glass(n,v,vec3(0.72,0.82,0.94),vec3(0.13,0.16,0.21),0.55);
    col=mix(col, vec3(0.78,0.82,0.88)*light(n)+sky(reflect(-v,n))*0.25, dg*0.15+fl*0.12);
    vec3 w=win(vec2(vU/0.3, y/0.45), 0.32, 0.12, 4.0);
    em=vec3(0.55,0.75,1.0)*dn*0.85 + w*0.55*(1.0-dn) + vec3(0.25,0.4,0.7)*0.05;
    if(k>0.5) em=vec3(0.7,0.84,1.0)*(0.35+0.5*smoothstep(55.0,60.0,y))+vec3(0.9,0.95,1.0)*dn*0.6;
  } else if(k<2.5){ // podium
    float b=ln(y/0.7,0.45);
    col=mix(glass(n,v,vec3(0.55,0.65,0.72),vec3(0.2,0.21,0.22),0.35), vec3(0.86,0.84,0.8)*light(n), b);
    em=vec3(1.0,0.8,0.55)*0.35*(1.0-b)*step(0.1,n.y<0.5?1.0:0.0) + vec3(0.6,0.75,1.0)*b*0.25*step(n.y,0.5);
  } else { // spire: steel
    col=vec3(0.78,0.82,0.88)*light(n)+sky(reflect(-v,n))*0.45;
    em=vec3(0.7,0.84,1.0)*(0.5+0.5*smoothstep(58.0,68.0,y));
  }
  em=min(em,vec3(1.2))*on;
#endif
#ifdef EXC
  if(k<0.5){ // blue glass with vertical fins
    float fin=ln(vU/0.3,0.2), fl=ln(y/0.42,0.08)+0.6*ln(y/1.68,0.1);
    col=glass(n,v,vec3(0.5,0.68,0.92),vec3(0.07,0.11,0.19),0.55);
    col=mix(col, vec3(0.7,0.74,0.8)*light(n)+sky(reflect(-v,n))*0.2, fin*0.75+fl*0.15);
    vec3 w=win(vec2(vU/0.15, y/0.42), 0.62, 0.1, 6.0);
    em=w*(1.0-fin)*0.85 + vec3(0.5,0.7,1.0)*fin*0.06;
  } else { // crown: diamond glass lantern, frame in steel
    float dg=max(ln((vU+y*0.6)/0.9,0.08),ln((vU-y*0.6)/0.9,0.08));
    col=mix(glass(n,v,vec3(0.7,0.8,0.9),vec3(0.1,0.12,0.16),0.5), vec3(0.8,0.82,0.85)*light(n)+sky(reflect(-v,n))*0.35, dg);
    vec3 lan=mix(vec3(1.0,0.78,0.42), vec3(0.95,0.9,1.0), 0.5+0.5*sin(uTime*0.15));
    em=lan*(0.22+0.4*smoothstep(38.0,45.0,y))*(1.0-0.6*dg) + vec3(1.0,0.95,0.85)*dg*0.75;
    if(k>1.5) em*=0.4;
  }
  em=min(em,vec3(1.1))*on;
#endif
#ifdef VOR
  float fl=(y-0.1)/${((23.5 - 1.5) / VORTEX_FLOORS).toFixed(5)};
  if(k<0.5){ // curved glass, white floor slabs, a slow spiral of fins (the vortex)
    float sl=ln(fl,0.22), sp=ln(vU/1.15+y*0.045,0.07);
    vec3 gl=glass(n,v,vec3(0.62,0.74,0.8),vec3(0.14,0.17,0.2),0.5);
    vec3 wt=vec3(0.9,0.89,0.86)*light(n)+sky(reflect(-v,n))*0.12;
    col=mix(gl, wt, clamp(sl+sp*0.85,0.0,1.0));
    vec3 w=win(vec2(vU/0.16, fl), 0.5, 0.72, 2.0);
    em=w*(1.0-sl)*(1.0-sp) + vec3(1.0,0.75,0.45)*(sl*0.16+sp*0.22) + vec3(0.13,0.12,0.17)*(1.0-sl);
    em*=step(0.7,y);
    em+=vec3(1.0,0.78,0.5)*0.55*(1.0-step(0.7,y)); // lobby
  } else if(k<1.5){ // crown band: amber lit fins
    float fn=ln(vU/0.3,0.35);
    col=mix(glass(n,v,vec3(0.6,0.65,0.7),vec3(0.08,0.08,0.09),0.4), vec3(0.85,0.84,0.8)*light(n), fn);
    em=vec3(0.91,0.65,0.3)*(0.55+0.8*fn);
  } else if(k<2.5){ // roof
    col=vec3(0.55,0.56,0.56)*light(n); em=vec3(0.91,0.65,0.3)*0.08;
  } else if(k<3.5){ // balcony slab edges: white, warm spill from the flats below
    col=vec3(0.88,0.87,0.84)*light(n); em=vec3(1.0,0.72,0.42)*(n.y<-0.5?0.35:0.12);
  } else { // Kozi floor band: intensity from the site (uHi), mostly hidden by day unless highlighted
    float o = k<4.5 ? uHi0 : k<5.5 ? uHi1 : k<6.5 ? uHi2 : uHi3;
    float fd = mix(1.0, 0.15, uDay*(1.0-smoothstep(0.85,0.95,o)));
    col=vec3(0.88,0.87,0.84)*light(n) + vec3(1.0,0.62,0.26)*o*fd*1.3*smoothstep(0.0,0.3,uOn+uDay);
    em=vec3(1.0,0.66,0.3)*o*0.6;
  }
  em*=on;
#endif
  col += em*nl;
  float f=1.0-exp(-uFogD*uFogD*vD*vD);
  gl_FragColor=vec4(mix(col,uFog,f),1.0);
}`;

  // ---------- builders ----------
  // Rub el Hizb plan: two squares (8 sharp tips at r=1) + a convex semicircular lobe in each of the 8 inner angles (16 lobes)
  const SQ = (a) => 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) / Math.SQRT2;
  const LOBE_D = 0.7, LOBE_R = 0.17, Q8 = Math.PI / 8;
  const lobe = (dt) => { const s = LOBE_D * Math.sin(dt), q = LOBE_R * LOBE_R - s * s; return q < 0 ? 0 : LOBE_D * Math.cos(dt) + Math.sqrt(q); };
  const starR = (a) => { const k = Math.round((a - Q8) / (2 * Q8)); return Math.max(SQ(a), SQ(a - Math.PI / 4), lobe(a - Q8 - 2 * Q8 * k)); };
  const JUNC = (() => { let lo = 0, hi = Q8; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (lobe(m) > SQ(Q8 + m)) lo = m; else hi = m; } return lo; })();
  function starOutline(cx, cz, R, off, small) { // tips and lobe/edge junctions duplicated (hard pleats)
    const P = [], na = small ? 6 : 10, pt = (a) => { const r = R * starR(a), t = a + off; return [cx + Math.cos(t) * r, cz + Math.sin(t) * r]; };
    for (let j = 0; j < 8; j++) {
      const a0 = j * 2 * Q8, ac = a0 + Q8, d = JUNC;
      P.push(pt(a0), pt(a0), pt((a0 + ac - d) / 2), pt(ac - d), pt(ac - d));
      for (let i = 1; i < na; i++) P.push(pt(ac - d + (2 * d * i) / na));
      P.push(pt(ac + d), pt(ac + d), pt((ac + d + a0 + 2 * Q8) / 2));
    }
    return P;
  }

  function buildPetronas(ctx, mat) {
    const { THREE, small } = ctx, g = new G(), lseg = small ? 32 : 48;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
    for (const T of PET) {
      const off = (T.rot * Math.PI) / 180;
      const out = (R) => starOutline(T.x, T.z, R, off, small);
      const base = out(1), tg = tangents(base);
      let yb = -0.2;
      PET_TIERS.forEach(([, y1, R], i) => {
        const P = out(R);
        g.band(ring(P, yb), ring(P, y1), 0, tg);
        const nR = i + 1 < PET_TIERS.length ? PET_TIERS[i + 1][2] : 0.82, sk = 0.32;
        const Pn = out(nR);
        g.band(ring(P, y1), ring(Pn, y1 + sk), 3, tg);
        yb = y1 + sk;
        if (i + 1 === PET_TIERS.length) g.fan(ring(Pn, y1 + sk), T.x, y1 + sk, T.z, 3);
      });
      // pinnacle: telescoping drums with lips, mast, ring ball, needle
      const y0 = 37.32;
      g.lathe(T.x, T.z, [[0.8, 0, 1], [0.8, 0.9, 1], [0.88, 0.9, 1], [0.88, 1.0, 1], [0.6, 1.0, 1], [0.6, 1.9, 1], [0.66, 1.9, 1], [0.66, 1.98, 1], [0.38, 1.98, 1], [0.38, 2.8, 1], [0.43, 2.8, 1], [0.43, 2.87, 1], [0.27, 2.87, 1], [0.27, 3.6, 1],
        [0.17, 3.75, 1], [0.13, 4.0, 1], [0.13, 4.25, 1], [0.24, 4.32, 1], [0.31, 4.45, 1], [0.34, 4.6, 1], [0.31, 4.75, 1], [0.24, 4.88, 1], [0.12, 4.95, 1], [0.08, 5.0, 1], [0.065, 6.4, 1], [0.03, 7.9, 1], [0, 7.95, 1]], lseg, y0);
      for (const [yy, r] of [[3.95, 0.24], [4.1, 0.22], [5.4, 0.13], [6.0, 0.11]]) { // mast rings
        Q.setFromAxisAngle(V.set(1, 0, 0), Math.PI / 2); M.compose(V.set(T.x, y0 + yy, T.z), Q, S);
        g.add3(THREE, new THREE.TorusGeometry(r, 0.025, 4, lseg), M, 1);
      }
      // bustle (44-storey annex) and the link to the tower
      g.lathe(T.bx, T.bz, [[1.13, -0.2, 4], [1.13, 18.2, 3], [1.0, 18.45, 4], [1.0, 18.8, 3], [0.78, 19.0, 3], [0.45, 19.25, 3], [0, 19.3, 3]], small ? 40 : 64);
      const dx = T.bx - T.x, dz = T.bz - T.z, dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl, px = -uz, pz = ux, w = 0.62;
      const L0 = 2.2, L1 = dl - 0.6, link = [[ux * L0 - px * w, uz * L0 - pz * w], [ux * L1 - px * w, uz * L1 - pz * w], [ux * L1 + px * w, uz * L1 + pz * w], [ux * L0 + px * w, uz * L0 + pz * w]].map((p) => [T.x + p[0], T.z + p[1]]);
      const LP = hardAll(ccw(link)); g.band(ring(LP, -0.2), ring(LP, 17.5), 4, tangents(LP)); g.poly(THREE, ccw(link), 17.5, 3);
    }
    // skybridge (levels 41-42, 170-180 m) and its two-hinged arch legs from level 29
    const [A, B] = PET, ax = B.x - A.x, az = B.z - A.z, D = Math.hypot(ax, az), ux = ax / D, uz = az / D, px = -uz, pz = ux, mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    const hl = D / 2 - 2.0, hw = 0.34;
    const deck = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([a, b]) => [mx + ux * a + px * b, mz + uz * a + pz * b]);
    const DP = hardAll(ccw(deck)), dt = tangents(DP);
    g.band(ring(DP, 17.0), ring(DP, 18.0), 2, dt); g.poly(THREE, ccw(deck), 18.0, 5); g.poly(THREE, ccw(deck), 17.0, 5, -1);
    const cap = [[-hl, -hw * 0.6], [hl, -hw * 0.6], [hl, hw * 0.6], [-hl, hw * 0.6]].map(([a, b]) => [mx + ux * a + px * b, mz + uz * a + pz * b]);
    const CP = hardAll(ccw(cap)); g.band(ring(CP, 18.0), ring(CP, 18.18), 5, tangents(CP)); g.poly(THREE, ccw(cap), 18.18, 5);
    const leg = (x0, y0, z0, x1, y1, z1, r) => { const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), d = b.clone().sub(a), l = d.length();
      Q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); M.compose(a.add(b).multiplyScalar(0.5), Q, S); g.add3(THREE, new THREE.CylinderGeometry(r, r, l, 8, 1, true), M, 5); };
    for (const sd of [-1, 1]) for (const lat of [-1, 1]) {
      const fx = sd * (D / 2 - 2.45);
      leg(mx + ux * fx + px * lat * 0.42, 12.1, mz + uz * fx + pz * lat * 0.42, mx + ux * sd * 0.25 + px * lat * 0.2, 16.95, mz + uz * sd * 0.25 + pz * lat * 0.2, 0.075);
    }
    const mesh = g.mesh(THREE, mat); mesh.userData.pick = 'petronas'; return mesh;
  }

  function buildKLTower(ctx, mat, y0) {
    const { THREE, small } = ctx, g = new G(), x = ctx.L.kltower.x, z = ctx.L.kltower.z, s = small ? 36 : 56;
    g.lathe(x, z, [[2.6, -0.4, 4], [2.6, 0.62, 2], [2.35, 0.78, 4], [2.3, 1.0, 2], [1.85, 1.2, 2], [1.25, 1.4, 2], [0.95, 1.45, 0]], s, y0);
    // shaft, then the 'gasing' (spinning top) head: long straight ribbed underside cone, raked observation deck (276 m),
    // revolving restaurant band, Sky Deck parapet (300 m), shallow cap, turret to the pod roof (336.5 m), antenna to 421 m
    g.lathe(x, z, [[1.02, 1.45, 0], [0.92, 8.0, 0], [0.86, 16.0, 0], [0.8, 24.6, 2], [1.45, 26.0, 2], [2.05, 27.3, 2], [2.25, 27.6, 1], [2.38, 28.6, 2], [2.4, 28.7, 1],
      [2.32, 29.9, 2], [2.3, 30.05, 1], [2.24, 30.4, 2], [2.2, 30.42, 2], [1.5, 30.8, 2], [0.9, 31.0, 5], [0.85, 31.6, 5], [0.75, 33.65, 5], [0.45, 33.7, 3],
      [0.42, 36.0, 3], [0.28, 36.1, 3], [0.2, 39.0, 3], [0.09, 39.1, 3], [0.05, 42.1, 3], [0, 42.12, 3]], s, y0);
    const mesh = g.mesh(THREE, mat); mesh.userData.pick = 'kltower'; return mesh;
  }

  function buildMerdeka(ctx, mat) {
    const { THREE } = ctx, g = new G(), M_ = MER;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ss = (a, b, t) => { t = Math.min(1, Math.max(0, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
    // corners taper towards the north-east edge where the spire rises (as in the OSM tiers)
    const C = [[M_.N, M_.N, () => 0], [M_.NE, M_.NE, () => 0], [M_.SE, [-72.55, 145.35], (y) => ss(36, 55, y)], [M_.SW, [-74.31, 144.49], (y) => Math.pow(ss(0, 55, y), 0.8)], [M_.W, [-73.81, 142.98], (y) => ss(30, 55, y)]];
    const corners = (y) => C.map(([a, b, f]) => lerp(a, b, f(y)));
    const flip = area2(corners(0)) < 0;
    // diamond lattice: on even levels the corners stand out, on odd levels the face midpoints are folded out;
    // each quad is split along the ridge joining its two 'out' vertices, so every facet is a flat tilted triangle
    const ringAt = (y, odd) => {
      let c = corners(y); if (flip) c = c.slice().reverse();
      const cx = c.reduce((s, p) => s + p[0], 0) / c.length, cz = c.reduce((s, p) => s + p[1], 0) / c.length, P = [];
      c.forEach((p, i) => {
        const q = c[(i + 1) % c.length], ex = q[0] - p[0], ez = q[1] - p[1], el = Math.hypot(ex, ez), ox = ez / el, oz = -ex / el, f = odd ? 1 : 0;
        P.push([p[0] + (cx - p[0]) * f * 0.03, p[1] + (cz - p[1]) * f * 0.03]);
        P.push([(p[0] + q[0]) / 2 + ox * f * el * 0.05, (p[1] + q[1]) / 2 + oz * f * el * 0.05]);
      });
      return { P, cx, cz };
    };
    const NL = 30, lvY = (i) => (i ? (i * 55.0) / NL : -0.2);
    let prev = ringAt(lvY(0), 0);
    for (let i = 1; i <= NL; i++) {
      const cur = ringAt(lvY(i), i & 1), A = ring(prev.P, lvY(i - 1)), B = ring(cur.P, lvY(i)), ax = [cur.cx, cur.cz];
      for (let j = 0; j < A.length - 1; j++) g.quad(A[j], A[j + 1], B[j + 1], B[j], 0, ax, (j & 1) === (i & 1 ? 0 : 1)); // vertex j even = corner
      prev = cur;
    }
    // sloped crown rising to the spire on the north-east edge
    const S = M_.S, P = prev.P, dmax = Math.max(...P.map((p) => Math.hypot(p[0] - S[0], p[1] - S[1])));
    const yTop = (p) => 55.0 + 4.6 * Math.pow(1 - Math.hypot(p[0] - S[0], p[1] - S[1]) / dmax, 1.4);
    g.band(ring(P, 55.0), ring(P, (p) => yTop(p)), 1, null, true, [prev.cx, prev.cz]);
    g.fan(ring(P, (p) => yTop(p)), S[0], 60.4, S[1], 1);
    // spire: slim faceted needle from the crown
    const sp = (y, r) => [0, 1, 2, 3, 4, 5].map((i) => [S[0] + Math.cos((i / 6) * TAU + 0.3) * r, S[1] + Math.sin((i / 6) * TAU + 0.3) * r]);
    const SL = [[55.5, 0.42], [60.0, 0.36], [61.5, 0.22], [64.5, 0.13], [66.6, 0.06]];
    for (let i = 0; i < SL.length - 1; i++) { const a = hardAll(ccw(sp(...SL[i]))), b = hardAll(ccw(sp(...SL[i + 1]))); g.band(ring(a, SL[i][0]), ring(b, SL[i + 1][0]), 3, null, true, S); }
    g.fan(ring(hardAll(ccw(sp(...SL[SL.length - 1]))), SL[SL.length - 1][0]), S[0], 67.9, S[1], 3, 1, true);
    // podium (mall)
    const pod = ccw(MER_POD), PP = hardAll(pod);
    g.band(ring(PP, -0.2), ring(PP, 2.6), 2, tangents(PP)); g.poly(THREE, pod, 2.6, 2);
    const mesh = g.mesh(THREE, mat); mesh.userData.pick = 'merdeka'; return mesh;
  }

  function buildExchange(ctx, mat) {
    const { THREE } = ctx, g = new G();
    const th = (-26.5 * Math.PI) / 180, ux = Math.cos(th), uz = Math.sin(th), vx = -uz, vz = ux;
    let cx = 0, cz = 0; EXC.forEach((p) => { cx += p[0]; cz += p[1]; }); cx /= EXC.length; cz /= EXC.length;
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    EXC.forEach(([x, z]) => { const a = (x - cx) * ux + (z - cz) * uz, b = (x - cx) * vx + (z - cz) * vz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); });
    const oc = [cx + ((a0 + a1) / 2) * ux + ((b0 + b1) / 2) * vx, cz + ((a0 + a1) / 2) * uz + ((b0 + b1) / 2) * vz];
    const hx = Math.min((a1 - a0) / 2, (b1 - b0) / 2) * 0.98, hz = hx; // square plan
    const plan = (s, nt, mids) => { // notched corners; optional face midpoints
      const P = [], n = hx * nt, w = (a, b) => [oc[0] + (a * ux + b * vx) * s, oc[1] + (a * uz + b * vz) * s];
      [[1, -1], [1, 1], [-1, 1], [-1, -1]].forEach(([sx, sz], i, arr) => {
        const pts = sx * sz > 0 ? [[sx * hx, sz * (hz - n)], [sx * (hx - n), sz * (hz - n)], [sx * (hx - n), sz * hz]] : [[sx * (hx - n), sz * hz], [sx * (hx - n), sz * (hz - n)], [sx * hx, sz * (hz - n)]];
        pts.forEach((p) => P.push(w(...p)));
        if (mids) { const [tx, tz] = arr[(i + 1) % 4]; P.push(w(((sx + tx) / 2) * hx, ((sz + tz) / 2) * hz)); }
      });
      return P;
    };
    const flipE = area2(plan(1, 0.12)) < 0, pl = (s, nt, m) => (flipE ? plan(s, nt, m).reverse() : plan(s, nt, m));
    const shaft = [[-0.2, 1.0], [19, 0.965], [36.5, 0.9]];
    for (let i = 0; i < shaft.length - 1; i++) { const a = hardAll(pl(shaft[i][1], 0.12)), b = hardAll(pl(shaft[i + 1][1], 0.12)); g.band(ring(a, shaft[i][0]), ring(b, shaft[i + 1][0]), 0, tangents(a)); }
    // crown: folded diamond glass, faces rising to points at their middles
    const c0 = pl(0.9, 0.12, true), c1 = pl(0.8, 0.12, true), c2 = pl(0.6, 0.12, true), isMid = (i) => (i % 4) === 3;
    g.band(ring(c0, 36.5), ring(c1, 41.0), 1, null, true, oc);
    const topY = (p, i) => (isMid(i % c2.length) ? 45.4 : 43.6);
    g.band(ring(c1, 41.0), ring(c2, topY), 1, null, true, oc);
    g.fan(ring(c2, topY), oc[0], 43.4, oc[1], 2);
    return g.mesh(THREE, mat);
  }

  function vortexOutline(THREE, seg) {
    const c = new THREE.CatmullRomCurve3(ccw(VOR).map((p) => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
    return c.getSpacedPoints(seg).slice(0, seg).map((v) => [v.x, v.z]);
  }
  function buildVortex(ctx, mat) {
    const { THREE, small } = ctx, g = new G(), h = ctx.L.vortex.h, P = ccw(vortexOutline(THREE, small ? 64 : 96)), T = tangents(P);
    const levelY = (lv) => 0.1 + (lv / VORTEX_FLOORS) * (h - 1.5);
    g.band(ring(P, -0.2), ring(P, h - 1.0), 0, T);
    g.band(ring(P, h - 1.0), ring(P, h - 0.25, 0, 0, 1.015), 1, T);
    const Pr = P.map((p) => [p[0] * 0.97, p[1] * 0.97]);
    g.band(ring(P, h - 0.25, 0, 0, 1.015), ring(Pr, h - 0.25), 2, T); g.fan(ring(Pr, h - 0.25), 0, h - 0.25, 0, 2);
    const core = P.map((p) => [p[0] * 0.38, p[1] * 0.3]);
    g.band(ring(core, h - 0.25), ring(core, h + 0.12), 1, T); g.fan(ring(core, h + 0.12), 0, h + 0.12, 0, 2);
    // balcony slab edges every 2nd floor (k 3), and the four Kozi floors as lit bands (k 4..7, one per ring)
    const grow = (d) => P.map((p) => { const l = Math.hypot(p[0], p[1]); return [(p[0] * (l + d)) / l, (p[1] * (l + d)) / l]; });
    const slab = (y, d, t, k) => { const O = grow(d), lo = ring(P, y - t), hi = ring(P, y + t), olo = ring(O, y - t), ohi = ring(O, y + t);
      g.band(olo, ohi, k, T); g.band(hi, ohi, k, null, true); g.band(olo, lo, k, null, true); };
    const KOZI = [26, 41, 43, 47];
    for (let lv = 2; lv < VORTEX_FLOORS - 1; lv += 2) if (!KOZI.includes(lv)) slab(levelY(lv), 0.045, 0.03, 3);
    KOZI.forEach((lv, i) => slab(levelY(lv), 0.09, 0.055, 4 + i));
    const mesh = g.mesh(THREE, mat); mesh.userData.pick = 'vortex'; return { mesh, outline: P };
  }

  // all point lights and glows: one instanced billboard draw; fades (day, uOn, fog), blinking and pulse run in the shader
  const LVERT = `attribute vec3 iP; attribute vec3 iC; attribute vec4 iS; // iS: size (units), phase (<0 steady), kind (0 lamp, 1 glow, 2 beacon), opacity
uniform float uTime; uniform float uDay; uniform float uOn; uniform float uFogD; uniform float uPx; uniform float uGlow; uniform float uBea;
varying vec3 vC; varying float vA; varying vec2 vQ; varying float vK;
void main(){ vec4 mv=viewMatrix*vec4(iP,1.0); float d=max(-mv.z,0.5), on=smoothstep(0.1,0.5,uOn), hs;
  if(iS.z<0.5){ float b = iS.y<0.0 ? 1.0 : 0.15+0.85*pow(0.5+0.5*sin(uTime*2.2+iS.y*6.283),4.0);
    vA=b*on*(1.0-0.75*uDay); hs=0.5*clamp(iS.x*uPx/d, 2.0, 22.0)*d/uPx; }
  else { vA=on*clamp(1.0-1.3*uDay,0.0,1.0)*uGlow; if(iS.z>1.5) vA*=uBea*(0.75+0.25*sin(uTime*2.4)); hs=0.5*iS.x; }
  vA*=iS.w*exp(-uFogD*uFogD*d*d); vC=iC; vQ=position.xy; vK=iS.z;
  mv.xy+=position.xy*hs; gl_Position=projectionMatrix*mv; }`;
  const LFRAG = `varying vec3 vC; varying float vA; varying vec2 vQ; varying float vK;
void main(){ float r=length(vQ); if(r>1.0) discard; float a;
  if(vK<0.5) a=(exp(-r*r*4.0)+0.6*exp(-r*r*40.0))*1.4; else { float e=1.0-r; a=e*e*(0.25+0.75*exp(-r*r*18.0)); }
  gl_FragColor=vec4(vC*a*vA,1.0); }`;
  // stand-in for a sprite / ring so the site can keep writing .material.opacity (it lands in a shader uniform)
  const proxy = (THREE, u, ud) => { const o = new THREE.Object3D(); o.userData = ud || {}; o.material = { get opacity() { return u.value; }, set opacity(v) { u.value = v; } }; return o; };

  KLC.landmarks = {
    build(ctx) {
      const { THREE, group, uniforms: U } = ctx, L = ctx.L;
      const shared = { uDay: U.uDay, uDusk: U.uDusk, uOn: U.uOn, uTime: U.uTime, uFog: U.uFog, uFogD: U.uFogD };
      const mk = (def, y0 = 0, extra) => { const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...shared, uY0: { value: y0 }, ...extra }, defines: { [def]: 1 } }); m.extensions.derivatives = true; return m; };
      const hAt = ctx.heightAt || (() => 0), ky = hAt(L.kltower.x, L.kltower.z);
      const uHi = [0, 1, 2, 3].map(() => ({ value: 0.55 })), hiU = {}; uHi.forEach((u, i) => (hiU['uHi' + i] = u));
      const pet = buildPetronas(ctx, mk('PET')), klt = buildKLTower(ctx, mk('KLT', ky, { uC: { value: new THREE.Vector2(L.kltower.x, L.kltower.z) } }), ky);
      const mer = buildMerdeka(ctx, mk('MER')), exc = buildExchange(ctx, mk('EXC')), vor = buildVortex(ctx, mk('VOR', 0, hiU));
      for (const m of [pet, klt, mer, exc, vor.mesh]) group.add(m);
      const pickables = [pet, klt, mer, vor.mesh]; ctx.pickables.push(...pickables);

      // Kozi floors: lit bands in the Vortex mesh; these proxies carry {lv, suite} and write the band intensity
      const h = L.vortex.h, levelY = (lv) => 0.1 + (lv / VORTEX_FLOORS) * (h - 1.5);
      const rings = [[26, 'premium'], [41, 'standard'], [43, 'boutique'], [47, 'premium']].map(([lv, suite], i) => { const r = proxy(THREE, uHi[i], { lv, suite }); r.position.y = levelY(lv); return r; });

      // lights: x, y, z, r, g, b, size, phase, kind, opacity
      const LT = [], pm = [(PET[0].x + PET[1].x) / 2, (PET[0].z + PET[1].z) / 2];
      for (const T of PET) LT.push([T.x, 45.25, T.z, 1, 0.25, 0.2, 0.5, 0.0, 0, 1], [T.x, 41.75, T.z, 1, 0.95, 0.9, 0.35, -1, 0, 1]);
      LT.push([L.kltower.x, ky + 42.15, L.kltower.z, 1, 0.2, 0.15, 0.55, 0.3, 0, 1], [L.kltower.x, ky + 39.1, L.kltower.z, 1, 0.2, 0.15, 0.4, 0.55, 0, 1], [L.kltower.x, ky + 36.0, L.kltower.z, 1, 0.2, 0.15, 0.4, 0.8, 0, 1]);
      LT.push([MER.S[0], 67.95, MER.S[1], 1, 0.25, 0.2, 0.6, 0.15, 0, 1], [MER.S[0], 62.0, MER.S[1], 0.85, 0.9, 1, 0.35, -1, 0, 1]);
      LT.push([126.4, 45.5, 142.9, 1, 0.25, 0.2, 0.45, 0.65, 0, 1]);
      vor.outline.filter((_, i) => i % 24 === 0).forEach((p, i) => LT.push([p[0] * 0.9, h + 0.05, p[1] * 0.9, 1, 0.25, 0.2, 0.22, 0.2 + i * 0.1, 0, 1]));
      const c = (s) => s.split(',').map((v) => v / 255);
      for (const T of PET) LT.push([T.x, 39.6, T.z, ...c('225,235,255'), 3.6, -1, 1, 0.42]);
      LT.push([pm[0], 24, pm[1], ...c('200,215,255'), 30, -1, 1, 0.1]);
      LT.push([L.kltower.x, ky + 29.0, L.kltower.z, ...c('170,160,255'), 11, -1, 1, 0.4]);
      LT.push([MER.S[0] - 0.9, 58, MER.S[1] + 1.2, ...c('175,205,255'), 12, -1, 1, 0.38]);
      LT.push([126.4, 43.2, 142.9, ...c('255,205,130'), 10, -1, 1, 0.45]);
      LT.push([0, h + 0.6, 0, ...c('255,175,85'), 6.5, -1, 2, 1]);
      const lg = new THREE.InstancedBufferGeometry();
      lg.setIndex([0, 1, 2, 0, 2, 3]); lg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      lg.setAttribute('iP', new THREE.InstancedBufferAttribute(new Float32Array(LT.flatMap((a) => a.slice(0, 3))), 3));
      lg.setAttribute('iC', new THREE.InstancedBufferAttribute(new Float32Array(LT.flatMap((a) => a.slice(3, 6))), 3));
      lg.setAttribute('iS', new THREE.InstancedBufferAttribute(new Float32Array(LT.flatMap((a) => a.slice(6, 10))), 4));
      lg.instanceCount = LT.length;
      const uGlow = { value: 1 }, uBea = { value: 1 }, uPx = { value: 1170 };
      const lights = new THREE.Mesh(lg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...shared, uPx, uGlow, uBea }, vertexShader: LVERT, fragmentShader: LFRAG }));
      lights.frustumCulled = false; lights.renderOrder = 2; group.add(lights);
      // the site fades [glow, baseOpacity] by day via .material.opacity -> uGlow (the shader also fades by uDay)
      const glows = [[proxy(THREE, uGlow), 1]], beacon = proxy(THREE, uBea);
      beacon.position.set(0, h + 0.6, 0);

      return {
        L, pickables, glows,
        vortex: { levelY, rings, mesh: vor.mesh, beacon },
        update(t) {
          uPx.value = ctx.renderer.domElement.height / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360));
          for (const r of rings) if (!r.userData.held) r.material.opacity = 0.5 + 0.2 * Math.sin(t * 2 + r.userData.lv);
        },
      };
    },
  };
})();
