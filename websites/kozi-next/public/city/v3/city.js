// KLC.city: the real Kuala Lumpur building footprints (Overture Maps) extruded into merged meshes (facades, roofs,
// aviation beacons), bucketed into a few sectors for frustum culling, with procedural world-scale facades.
// 1 unit = 10 m, x east, z south. Optional inputs: ctx.citySkip [{x,z,r}], ctx.cityRoof [{x,z,color:[r,g,b],green}].
// Exposes ctx.cityHide(x,z,r) (hide buildings after build), KLC.city.towers and KLC.city.greenRoofs.
(function () {
  const KLC = (window.KLC = window.KLC || {});
  // facade archetypes (aB.y) and roof types (aR.x)
  const GLASS = 0, CONDO = 1, OFFICE = 2, SHOP = 3, HOUSE = 4, PARK = 5, IND = 6, CIVIC = 7, RELIG = 8, PLANT = 9, CANOPY = 10, MALL = 11;
  const R_FLAT = 0, R_TILE = 1, R_METAL = 2, R_BOX = 3, R_CANOPY = 4, R_DOME = 5, R_STAND = 6, R_GREEN = 7, R_BIG = 8, R_MALL = 9;
  const PAL = {
    glass: [[.30, .44, .58], [.26, .47, .50], [.52, .57, .62], [.46, .40, .32], [.28, .44, .40], [.22, .27, .35], [.38, .50, .62], [.44, .52, .58]],
    condo: [[.88, .87, .84], [.89, .85, .77], [.80, .80, .80], [.83, .80, .73], [.74, .76, .78], [.91, .90, .87], [.82, .78, .70], [.86, .84, .80]],
    office: [[.72, .70, .66], [.78, .74, .67], [.62, .62, .64], [.75, .67, .61], [.60, .53, .46], [.82, .82, .80], [.68, .70, .72]],
    shop: [[.90, .86, .72], [.92, .83, .58], [.68, .82, .72], [.88, .67, .58], [.64, .75, .84], [.85, .83, .78], [.83, .69, .47], [.86, .73, .73]],
    house: [[.92, .91, .88], [.90, .86, .76], [.92, .86, .66], [.82, .82, .82], [.80, .86, .80], [.90, .80, .74]],
    ind: [[.74, .76, .78], [.62, .68, .74], [.80, .78, .72], [.56, .59, .62], [.70, .72, .68]],
    civic: [[.92, .90, .86], [.88, .83, .72], [.84, .84, .82], [.70, .40, .30]],
    relig: [[.94, .93, .90], [.90, .87, .80]],
    mall: [[.84, .82, .78], [.72, .72, .74], [.80, .76, .70], [.62, .64, .66]],
    plant: [[.62, .63, .64], [.70, .70, .68], [.55, .57, .60]],
    roof: [[.56, .56, .55], [.62, .61, .59], [.46, .46, .46], [.74, .74, .72], [.55, .52, .47], [.38, .39, .40], [.68, .65, .58], [.80, .80, .78], [.44, .52, .58], [.52, .45, .40], [.42, .50, .42]],
    // weathered clay tiles (faded brown-red, not Mediterranean orange) and corrugated zinc for landed houses / shophouses
    tile: [[.55, .36, .29], [.48, .32, .27], [.60, .42, .33], [.42, .27, .23], [.43, .44, .46], [.32, .32, .34], [.56, .38, .30], [.58, .40, .31]],
    zinc: [[.55, .57, .58], [.47, .33, .27], [.40, .46, .52], [.62, .62, .60], [.50, .50, .49]],
    metal: [[.66, .68, .69], [.36, .46, .58], [.72, .74, .76], [.30, .40, .52], [.80, .80, .78], [.58, .60, .62]], // neutral (big roofs)
    shed: [[.56, .40, .30], [.58, .30, .26], [.47, .33, .27]], // rusty / red, small sheds only
    canopy: [[.70, .70, .68], [.62, .63, .62], [.66, .64, .58], [.52, .54, .55], [.45, .48, .50]],
    dome: [[.80, .62, .30], [.30, .45, .70], [.30, .55, .45], [.90, .90, .88]],
    box: [[.70, .70, .68], [.60, .61, .62], [.32, .44, .62], [.82, .82, .80]],
  };

  // ---------- shaders ----------
  const COMMON = `
uniform float uDay; uniform float uDusk; uniform float uOn; uniform float uTime; uniform float uFogD; uniform vec3 uFog; uniform vec3 uSun;
float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),f.x),mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),f.x),f.y); }
// anti-aliased pulse on a cell coordinate f: 1 inside [a,b]; w = pixel footprint in cell units; fades to coverage when w is large
float bx(float f,float a,float b,float w){ float m=clamp(min(f-a,b-f)/max(w,1e-4)+0.5,0.0,1.0); return mix(m,b-a,smoothstep(0.35,0.9,w)); }
// anti-aliased band in absolute units (no fade to coverage)
float band(float x,float a,float b,float w){ return clamp(min(x-a,b-x)/max(w,1e-4)+0.5,0.0,1.0); }
vec3 SUN(){ return normalize(uSun); }
vec3 sunCol(){ return mix(vec3(1.0,0.94,0.84),vec3(1.0,0.62,0.38),uDusk)*0.78*smoothstep(-0.05,0.12,uSun.y); }
vec3 ambCol(){ return mix(vec3(0.54,0.60,0.70),vec3(0.62,0.50,0.54),uDusk); }
vec3 fogIt(vec3 c,float d){ float f=1.0-exp(-uFogD*uFogD*d*d); return mix(c,uFog,f); }
`;
  const WALL_VS = `
attribute vec2 aN; attribute vec2 aF; attribute vec2 aE; attribute vec4 aB; attribute vec3 aC;
varying vec2 vF; varying vec2 vE; varying vec4 vB; varying vec3 vC; varying vec3 vN; varying vec3 vV; varying float vD;
void main(){ vF=aF; vE=aE; vB=aB; vC=aC; vN=vec3(aN.x,0.0,aN.y);
  vec4 wp=modelMatrix*vec4(position,1.0); vV=wp.xyz-cameraPosition;
  vec4 mv=viewMatrix*wp; vD=-mv.z; gl_Position=projectionMatrix*mv; }`;
  const WALL_FS = COMMON + `
varying vec2 vF; varying vec2 vE; varying vec4 vB; varying vec3 vC; varying vec3 vN; varying vec3 vV; varying float vD;
vec3 skyR(vec3 r){
  vec3 hor=mix(vec3(0.17,0.12,0.20),vec3(0.80,0.84,0.88),uDay); hor=mix(hor,vec3(1.0,0.60,0.40),uDusk*0.85);
  vec3 top=mix(vec3(0.02,0.03,0.07),vec3(0.30,0.48,0.78),uDay); top=mix(top,vec3(0.32,0.30,0.52),uDusk*0.6);
  vec3 gnd=mix(vec3(0.03,0.03,0.045),vec3(0.36,0.38,0.38),uDay);
  vec3 c=r.y>0.0 ? mix(hor,top,smoothstep(0.0,0.55,r.y)) : mix(hor*0.85,gnd,smoothstep(0.0,0.45,-r.y));
#ifndef LITE
  // reflected skyline (random building heights along the horizon) and soft clouds by day
  float sk=0.02+0.08*h21(vec2(floor(atan(r.z,r.x)*40.0),7.0));
  c=mix(c,c*0.55,smoothstep(-0.06,-0.02,r.y)*smoothstep(sk+0.015,sk-0.015,r.y));
  c=mix(c,mix(vec3(0.97,0.97,0.98),c*1.1,uDusk*0.6),smoothstep(0.55,0.8,vn(r.xz/(r.y+0.1)*3.0))*0.5*smoothstep(0.1,0.2,r.y)*uDay);
#endif
  return c+vec3(0.10,0.06,0.05)*(1.0-uDay)*smoothstep(0.15,-0.05,r.y); // city glow at night
}
vec2 flr(float v,float F,float G){ if(v<G) return vec2(0.0,clamp(v/G,0.0,1.0)); float k=(v-G)/F; return vec2(1.0+floor(k),fract(k)); }
vec3 homeLight(float h){ return h<0.5?vec3(1.0,0.66,0.34):h<0.76?vec3(1.0,0.85,0.64):h<0.95?vec3(0.85,0.91,1.0):vec3(0.42,0.58,1.0)*(0.7+0.3*sin(uTime*7.0+h*90.0)); }
vec3 signCol(float h){ return h<0.3?vec3(1.0,0.22,0.16):h<0.5?vec3(1.0,0.86,0.3):h<0.72?vec3(0.95,0.95,0.92):h<0.86?vec3(0.25,0.55,1.0):vec3(0.2,0.85,0.45); }
vec3 pastel(float h){ vec3 c=clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); return mix(vec3(0.86,0.84,0.80),c,0.28); }
// lit room interior seen up close: ceiling glow, some blinds drawn, uneven light across the pane
float interior(vec2 cell,float fy,float u,float v,float far){
  float k=mix(0.55,1.0,smoothstep(0.0,0.8,fy))*(1.0-0.45*step(h21(cell),0.35)*smoothstep(0.55,0.75,fy));
#ifndef LITE
  k*=0.8+0.2*vn(vec2(u,v)*1.3+cell*7.0);
#endif
  return mix(k,0.82,far);
}
void main(){
  vec3 n=normalize(vN);
  vec3 V=normalize(vV);
  // varyings of a per-building constant can drift by an ulp across a triangle: snap them, or the hashes sparkle
  float seed=floor(vB.x*255.0+0.5)/255.0, arch=floor(vB.y+0.5), top=vB.z, aux=floor(vB.w+0.5), u=vF.x, v=vF.y;
  vec2 fw=max(fwidth(vF),vec2(1e-4));
  float s2=fract(seed*7.31+0.13), s3=fract(seed*13.7+0.37), s4=fract(seed*23.9+0.71);
  vec3 alb=vC, gt=vec3(0.16,0.20,0.24), em=vec3(0.0), jit=vec3(0.0);
  float gm=0.0, rf=0.55, par=step(top,v);
  float wfar=smoothstep(0.4,1.2,fw.y/3.5);    // floors no longer resolvable
  float farP=0.0; vec3 farC=vec3(0.0);        // far-field lit probability / colour
  if(arch<0.5){ // glass curtain-wall tower
    float W=1.5; vec2 fl=flr(v,4.0,6.0); float wy=fw.y/(fl.x<0.5?6.0:4.0), wx=fw.x/W;
    float fx=fract(u/W), bay=floor(u/W), fdx=smoothstep(0.3,0.9,wx);
    float mull=bx(fx,0.05,0.95,wx), sp=bx(fl.y,0.22,0.97,wy), vis=mull*sp;
    gm=1.0-0.85*(1.0-mull); gt=vC*mix(0.6,1.0,vis); rf=1.0;
    alb=mix(vec3(0.62,0.64,0.66),vC,0.3);
    jit=(vec3(h21(vec2(bay,fl.x+seed*50.0)),h21(vec2(fl.x*1.7,bay+seed*20.0)),h21(vec2(bay+fl.x*3.1,seed*9.0)))-0.5)*vec3(0.08,0.05,0.08)*(1.0-smoothstep(0.08,0.4,wx));
    // offices lit by zones of a few bays; ~15% of floors fully dark, the rest a mix of lit zones and dim corridor light
    float lf=0.22+0.38*s2, zone=floor(bay/(2.0+4.0*s4));
    float fon=step(0.15,h21(vec2(fl.x,seed*3.0)));
    float lit=step(h21(vec2(zone+seed*9.0,fl.x)),lf)*fon*(0.78+0.22*h21(vec2(bay*0.7+seed,fl.x*2.1)));
    lit=mix(lit,lf*0.8,fdx); lit=mix(lit,lf*0.62,wfar);
    float wa=h21(vec2(fl.x,seed*5.0)), wb=h21(vec2(fl.x-1.0,seed*5.0));
    vec3 lc=wa<0.06&&wb>=0.06?vec3(1.0,0.8,0.55):vec3(0.84,0.9,0.98)*(0.8+0.25*h21(vec2(seed,fl.x*0.7)));
    lc=mix(lc,vec3(0.9,0.91,0.92),wfar);
    float lum=mix(mix(0.7+0.5*smoothstep(0.45,0.95,fl.y),0.95,fdx),1.0,wfar);
    em=lc*(lit+0.14*(1.0-lit)*fon)*lum*mix(mix(0.45,1.0,mull)*sp,0.72,wfar)*0.72;
    if(fl.x<0.5) em=vec3(1.0,0.86,0.66)*0.85*vis*step(0.2,s3);
    farP=lf*0.5; farC=vec3(0.92,0.9,0.86);
    em*=1.0-par;
  } else if(arch<1.5){ // condominium: concrete, balconies, window bays
    float W=s3<0.5?3.75:3.0; vec2 fl=flr(v,3.2,5.0); float wy=fw.y/3.2, wx=fw.x/W;
    float fx=fract(u/W), bay=floor(u/W), fade=smoothstep(0.35,0.9,wx);
    float inC=mix(step(0.7,vE.x-fx*W)*step(0.7,vE.y-(1.0-fx)*W),1.0,fade);
    float bal=step(mod(bay,2.0+floor(s4*3.0)),0.5);
    gt=vec3(0.17,0.21,0.25); rf=0.55;
    if(fl.x<0.5){ gm=bx(fx,0.1,0.9,wx)*bx(fl.y,0.05,0.8,fw.y/5.0)*inC; em=vec3(1.0,0.86,0.64)*0.7*gm*step(0.3,s2); }
    else {
      float slab=1.0-bx(fl.y,0.07,1.0,wy), win;
      if(bal>0.5){
        float rail=bx(fl.y,0.07,0.36,wy);
        win=bx(fx,0.08,0.92,wx)*bx(fl.y,0.07,0.93,wy)*inC;
        alb=mix(alb*mix(1.0,0.55,win),vC*1.1,slab); gm=win*(1.0-0.55*rail);
        gt=mix(gt,vec3(0.3,0.4,0.42),rail*0.5);
      } else { win=bx(fx,0.2,0.8,wx)*bx(fl.y,0.32,0.84,wy)*inC; gm=win; alb=mix(alb,vC*1.06,slab*0.6); }
      float lf=0.2+0.32*s2;
      float pf=lf*(0.35+1.3*h21(vec2(fl.x,seed*31.0)));
      float lit=step(h21(vec2(bay*1.7+seed*13.0,fl.x*3.1)),pf);
      lit=mix(mix(lit,pf,fade),lf,wfar);
      vec3 lc=mix(homeLight(h21(vec2(bay+seed*7.0,fl.x*1.9+3.0))),vec3(0.98,0.78,0.55),max(fade,wfar));
      float mul=1.0-0.85*(1.0-bx(fract(fx*2.0),0.04,0.96,wx*2.0))*(1.0-fade);
      em=lc*lit*win*mul*(0.6+0.5*h21(vec2(fl.x+seed,bay*0.37)))*interior(vec2(bay,fl.x+seed*9.0),fl.y,u,v,max(fade,wfar))*1.1;
      farP=lf*0.5; farC=vec3(1.0,0.74,0.46);
    }
    em*=1.0-par;
  } else if(arch<2.5){ // older office block: concrete spandrels, ribbon or punched windows
    bool pun=s3<0.4; float W=pun?3.0:1.5; vec2 fl=flr(v,3.8,5.0); float wy=fw.y/3.8, wx=fw.x/W;
    float fx=fract(u/W), bay=floor(u/W), fade=smoothstep(0.35,0.9,wx);
    float inC=mix(step(0.5,vE.x-fx*W)*step(0.5,vE.y-(1.0-fx)*W),1.0,fade);
    float win=pun?bx(fx,0.18,0.82,wx)*bx(fl.y,0.3,0.86,wy):bx(fx,0.04,0.96,wx)*bx(fl.y,0.34,0.9,wy);
    win*=inC; if(fl.x<0.5) win=bx(fx,0.06,0.94,wx)*bx(fl.y,0.05,0.82,fw.y/5.0)*inC;
    gm=win; gt=s4<0.5?vec3(0.15,0.25,0.29):s4<0.8?vec3(0.27,0.24,0.2):vec3(0.2,0.22,0.26); rf=0.85;
    // lit by zones of a few bays (no full-width bands); some floors dark, warm light per zone, dim corridor light elsewhere
    float lf=0.25+0.4*s2, zone=floor(bay/(2.0+4.0*s4)), fon=step(0.18,h21(vec2(fl.x,seed*3.0)));
    float lit=step(h21(vec2(zone+seed*11.0,fl.x*1.3)),lf)*fon;
    lit=mix(lit,lf*0.7,wfar);
    vec3 lc=h21(vec2(zone*0.37+fl.x,seed*7.0))<0.22?vec3(1.0,0.82,0.58):vec3(0.86,0.93,1.0)*(0.85+0.2*h21(vec2(zone,fl.x)));
    em=mix(lc,vec3(0.95,0.88,0.78),wfar)*(lit+0.12*(1.0-lit)*fon)*win*interior(vec2(bay,fl.x+seed*5.0),fl.y,u,v,max(fade,wfar))*0.95;
    if(fl.x<0.5) em=vec3(1.0,0.85,0.62)*win*0.8*step(0.35,s3+0.2);
    farP=lf*0.45; farC=mix(vec3(0.9,0.94,1.0),vec3(1.0,0.8,0.55),0.5);
    em*=1.0-par;
  } else if(arch<3.5){ // shophouses: five-foot way, signboards, shuttered upper windows
    float Wu=s3<0.5?5.0:6.0, G=4.2, unit=floor(u/Wu), ux=fract(u/Wu), wxu=fw.x/Wu;
    vec3 uc=vC*mix(vec3(1.0),pastel(h21(vec2(unit,seed*41.0)))*1.12,0.65)*(0.88+0.16*h21(vec2(unit,seed*3.7)));
    alb=uc; gt=vec3(0.13,0.15,0.16); rf=0.35;
    if(v<G){
      float open=bx(ux,0.07,0.93,wxu)*band(v/G,-1.0,0.82,fw.y/G);
      alb=mix(uc,uc*0.25,open); gm=open*0.5; gt=vec3(0.12,0.1,0.09);
      vec3 sc=h21(vec2(unit*3.1,seed))<0.6?vec3(1.0,0.84,0.6):vec3(0.88,0.94,1.0);
      em=sc*open*mix(step(h21(vec2(unit,seed*3.0)),0.62),0.62,smoothstep(0.4,1.0,wxu))*0.8;
    } else if(v<G+1.1){
      float hs=h21(vec2(unit,seed*9.0)), sb=bx(ux,0.04,0.96,wxu)*bx((v-G)/1.1,0.1,0.9,fw.y/1.1)*step(hs,0.72);
      vec3 sgc=signCol(h21(vec2(unit,seed*17.0)));
      alb=mix(uc,sgc*0.8,sb);
      em=sgc*sb*step(h21(vec2(unit,seed*13.0)),0.7)*0.9;
    } else {
      float k=(v-G-1.1)/3.6, fy=fract(k), W=Wu*0.5, wx=fw.x/W, fx=fract(u/W);
      float win=bx(fx,0.22,0.78,wx)*bx(fy,0.16,0.8,fw.y/3.6)*(1.0-par);
      float sh=step(h21(vec2(floor(u/W),floor(k)+seed*5.0)),0.35); // closed timber shutters
      alb=mix(uc,mix(vec3(0.3,0.42,0.36),vec3(0.42,0.3,0.22),step(0.5,s4)),win*sh);
      gm=win*(1.0-sh);
      float lit=step(h21(vec2(floor(u/W)+seed*3.0,floor(k))),0.14);
      em=vec3(1.0,0.72,0.4)*win*(1.0-sh*0.8)*mix(lit,0.14,smoothstep(0.4,1.0,wx))*0.8;
      alb*=mix(1.0,1.08,step(top-0.7,v));
    }
  } else if(arch<4.5){ // landed house
    float W=3.5; vec2 fl=flr(v,3.2,3.2); float wx=fw.x/W, fx=fract(u/W), bay=floor(u/W), fade=smoothstep(0.35,0.9,wx);
    float inC=mix(step(0.5,vE.x-fx*W)*step(0.5,vE.y-(1.0-fx)*W),1.0,fade);
    float win=bx(fx,0.25,0.72,wx)*bx(fl.y,0.3,0.78,fw.y/3.2)*inC;
    gm=win; gt=vec3(0.14,0.15,0.16); rf=0.35;
    float lit=step(h21(vec2(bay+seed*9.0,fl.x)),0.3);
    em=vec3(1.0,0.72,0.42)*win*mix(lit,0.3,fade)*0.8;
    farP=0.1; farC=vec3(1.0,0.72,0.42);
  } else if(arch<5.5){ // multi-storey car park: open decks
    vec2 fl=flr(v,3.0,4.0); float wy=fw.y/3.0;
    float col=1.0-bx(fract(u/8.0),0.04,0.96,fw.x/8.0);
    float open=fl.x<0.5?bx(fl.y,0.05,0.8,fw.y/4.0)*0.6:bx(fl.y,0.38,0.97,wy)*(1.0-col);
    alb=mix(vC,vC*0.12,open);
#ifndef LITE
    float cu=floor(u/2.6), car=step(h21(vec2(cu,fl.x+seed*7.0)),0.55)*bx(fract(u/2.6),0.12,0.88,fw.x/2.6)*bx(fl.y,0.38,0.56,wy)*step(0.5,fl.x);
    alb=mix(alb,mix(vec3(0.8),vec3(0.55,0.12,0.1),step(0.8,h21(vec2(cu,fl.x*3.0))))*mix(0.25,1.0,step(0.35,h21(vec2(fl.x,cu*1.3)))),car*open);
#endif
    em=vec3(0.72,0.9,0.82)*0.5*open*(0.6+0.4*h21(vec2(fl.x,seed*9.0)));
    farP=0.45; farC=vec3(0.72,0.9,0.82)*0.7;
    em*=1.0-par;
  } else if(arch<6.5){ // industrial / warehouse: metal cladding, roller doors, clerestory
#ifndef LITE
    float rb=fw.x/0.4; alb*=mix(0.9+0.1*smoothstep(0.2,0.8,abs(fract(u/0.4)-0.5)*2.0),0.95,smoothstep(0.3,0.8,rb));
#endif
    float dc=fract(u/14.0), door=bx(dc,0.32,0.68,fw.x/14.0)*step(v,4.5);
    alb=mix(alb,alb*0.72,door);
    float cl=band(v,top-3.2,top-2.0,fw.y)*bx(fract(u/3.0),0.1,0.9,fw.x/3.0)*step(4.0,top);
    gm=cl; gt=vec3(0.2,0.24,0.26); rf=0.6;
    float lp=step(h21(vec2(floor(u/14.0),seed*5.0)),0.5); vec2 dl=vec2((dc-0.5)*14.0,v-5.0);
    em=vec3(1.0,0.62,0.28)*0.7*lp*exp(-dot(dl,dl)*0.18)+vec3(0.85,0.92,1.0)*cl*0.6*step(h21(vec2(floor(u/3.0),seed)),0.25);
  } else if(arch<8.5){ // civic (7) and religious (8): white, tall windows, floodlit
    bool rel=arch>7.5; float W=rel?3.0:3.75, F=rel?5.0:4.2; vec2 fl=flr(v,F,5.5);
    float wx=fw.x/W, fx=fract(u/W), fade=smoothstep(0.35,0.9,wx);
    float inC=mix(step(0.8,vE.x-fx*W)*step(0.8,vE.y-(1.0-fx)*W),1.0,fade);
    float win=bx(fx,0.3,0.7,wx)*bx(fl.y,0.2,0.78,fw.y/F);
#ifndef LITE
    if(rel){ vec2 q=vec2((fx-0.5)*W,(fl.y-0.62)*F); win=bx(fx,0.3,0.7,wx)*bx(fl.y,0.2,0.62,fw.y/F)+step(0.62,fl.y)*clamp((W*0.2-length(q))/max(fw.x,1e-3)+0.5,0.0,1.0)*(1.0-fade); }
#endif
    win*=inC*(1.0-par); gm=win; gt=vec3(0.14,0.16,0.18); rf=0.45;
    float lit=step(h21(vec2(floor(u/W)+seed*3.0,fl.x)),rel?0.55:0.35);
    em=(rel?vec3(1.0,0.82,0.55):vec3(0.9,0.95,1.0))*win*mix(lit,0.4,fade)*0.8;
    farP=0.12; farC=vec3(0.95,0.9,0.8);
    float fl2=step(0.45,s3)+(rel?1.0:0.0);
    em+=vC*mix(vec3(1.0,0.86,0.62),vec3(0.8,0.95,0.85),rel?0.5:0.0)*0.2*fl2*(1.0-0.6*smoothstep(0.0,max(top,1.0),v))*(1.0-win);
  } else if(arch<9.5){ // rooftop plant room / penthouse / lantern: louvres
#ifndef LITE
    alb*=mix(0.84+0.16*smoothstep(0.3,0.7,fract(v/0.45)),0.92,smoothstep(0.3,0.8,fw.y/0.45));
#endif
    gm=0.0;
  } else if(arch<10.5){ // canopy fascia (petrol stations, porches, walkways)
    em=vec3(0.92,0.96,1.0)*0.7*step(s3,0.4);
  } else { // malls and big low-rise commercial blocks
    float rv=bx(fract(v/4.5),0.03,1.0,fw.y/4.5); alb*=mix(0.86,1.0,rv);
    float c24=fract(u/24.0), slot=bx(c24,0.4,0.6,fw.x/24.0)*step(0.25,s3)*step(6.0,v)*(1.0-par);
    float shop=bx(fract(u/6.0),0.05,0.95,fw.x/6.0)*band(v,0.3,5.0,fw.y);
    gm=max(slot,shop); gt=vec3(0.18,0.24,0.28); rf=0.8;
    float c30=floor(u/30.0), sg=bx(fract(u/30.0),0.3,0.7,fw.x/30.0)*band(v,top-5.0,top-1.8,fw.y)*step(h21(vec2(c30,seed*5.0)),0.4)*step(8.0,top);
    alb=mix(alb,signCol(h21(vec2(c30,seed)))*0.85,sg);
    em=vec3(1.0,0.88,0.7)*shop*0.8+vec3(0.85,0.92,1.0)*slot*0.35+signCol(h21(vec2(c30,seed)))*sg*0.95;
    em+=vC*vec3(1.0,0.84,0.6)*0.1*exp(-max(v-5.0,0.0)/7.0)*(1.0-gm)*(1.0-sg); // podium wash from street signs / floodlights
  }
  em=min(em,vec3(0.92));
  // far field: once windows are sub-pixel, blend the mean glow with sparse coarse cells (>= 2x2 windows) keeping the mean;
  // whole buildings of a few pixels keep only the smooth mean (no white static)
  vec2 px=fw/vec2(2.0,3.5); float ff=smoothstep(0.55,1.15,px.y)*step(0.001,farP)*(1.0-par);
  if(ff>0.0){
    vec2 sc=exp2(clamp(floor(log2(px*1.3))+1.0,vec2(1.0),vec2(7.0,6.0)));
    vec2 c=floor(vec2(u,v)/(vec2(2.0,3.5)*sc));
    float sp=step(h21(c+vec2(seed*17.0,seed*31.0+sc.y*7.0)),farP)*(0.5+0.5*h21(c.yx+seed*3.0));
    sp=mix(sp,farP*0.75,smoothstep(3.0,5.0,px.y));
    em=mix(em,farC*(farP*0.7+sp*0.6),ff);
  }
  // lit crowns on a few tall towers: up-light washing the top floors, broken by fins
  if(aux>0.5){
    float cr=arch>8.5&&arch<9.5?1.0:smoothstep(top-7.0,top-5.5,v)*(1.0-step(top+1.5,v));
    vec3 cc=aux<1.5?vec3(0.9,0.94,1.0):aux<2.5?vec3(1.0,0.76,0.46):vec3(0.62,0.72,1.0);
    float pat=min(0.35+0.65*exp(-max(v-(top-7.0),0.0)/2.5),1.0)*(0.6+0.4*bx(fract(u/1.5),0.3,0.7,fw.x/1.5));
    em=mix(em,cc*pat*0.6,cr*0.8);
    alb=mix(alb,vec3(0.78,0.8,0.82),cr*0.4);
  }
#ifndef LITE
  // rain streaks / mould on concrete (very KL): elongated vertical noise, faded out with distance
  float st=h21(vec2(floor(u/1.7),seed*13.0))*h21(vec2(floor(u/1.7)+0.5,floor(v/9.0)+seed));
  alb*=1.0-0.22*st*(1.0-gm)*(1.0-smoothstep(0.15,0.6,fw.x))*smoothstep(top+2.0,top-14.0,v)*step(1.5,arch)*step(arch,8.5);
#endif
  // lighting: hazy tropical day / night lit by sky glow, sodium uplight from the street and the building's own windows
  float so=0.08+0.9*fract(seed*3.71+floor(v/8.0)*0.013), onB=smoothstep(so-0.08,so,uOn);
  float ndl=max(dot(n,SUN()),0.0);
  float ao=mix(0.6,1.0,smoothstep(-3.0,16.0,v));
  vec3 dl=(ambCol()*0.8+sunCol()*ndl)*ao;
  vec3 R=reflect(V,n);
#ifndef LITE
  R+=jit;
#endif
  R=normalize(R);
  vec3 rc=skyR(R);
  float ct=clamp(-dot(V,n),0.0,1.0), fr=0.07+0.93*pow(1.0-ct,5.0);
  vec3 sg=sunCol()*pow(max(dot(R,SUN()),0.0),80.0)*1.4*uDay;
  vec3 gD=gt*dl*0.45+(rc+sg)*mix(vec3(1.0),gt*1.6+0.2,0.5)*mix(0.38,1.0,fr)*rf;
  vec3 dayC=mix(alb*dl,gD,gm);
  vec3 nA=(vec3(0.10,0.10,0.14)+vec3(0.20,0.11,0.045)*exp(-max(v,0.0)/14.0)*mix(0.4,1.0,uOn)+vec3(0.05,0.03,0.06)*smoothstep(0.0,40.0,v)+farC*farP*0.15*onB)*ao;
  vec3 nG=gt*0.03+rc*mix(0.35,0.9,fr)*rf*0.8+vec3(0.06,0.035,0.02)*exp(-max(v,0.0)/60.0);
  vec3 nightC=mix(alb*nA,nG,gm);
  vec3 col=mix(nightC,dayC,uDay);
  col+=em*onB*clamp(1.0-uDay*1.15,0.0,1.0);
  gl_FragColor=vec4(fogIt(col,vD),1.0);
}`;
  const ROOF_VS = `
attribute vec3 aC; attribute vec3 aR;
varying vec3 vC; varying vec3 vR; varying vec3 vN; varying vec3 vW; varying vec3 vV; varying float vD;
void main(){ vC=aC; vR=aR; vN=normal; vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; vV=wp.xyz-cameraPosition;
  vec4 mv=viewMatrix*wp; vD=-mv.z; gl_Position=projectionMatrix*mv; }`;
  const ROOF_FS = COMMON + `
varying vec3 vC; varying vec3 vR; varying vec3 vN; varying vec3 vW; varying vec3 vV; varying float vD;
void main(){
  vec3 n=normalize(vN); float t=floor(vR.x+0.5), seed=floor(vR.y*255.0+0.5)/255.0; vec3 alb=vC, em=vec3(0.0);
  float pf=max(fwidth(vW.x),fwidth(vW.z)), spec=0.0, fix=0.0, gl=0.0;
  if(t<0.5||t>7.5||(t>3.5&&t<4.5)){ // flat concrete, big flat roofs, canopies: stains and patches
#ifndef LITE
    float k=vn(vW.xz*1.6+seed*40.0)*0.6+vn(vW.xz*5.0+seed*9.0)*0.4; alb*=mix(0.82+0.32*k,1.0,smoothstep(0.08,0.4,pf));
#endif
    fix=t<4.5&&t>3.5?0.0:1.0; spec=t>3.5&&t<4.5?0.08:0.0;
    if(t>7.5){ // big roofs: ribs every 2 units, HVAC boxes; malls get glazed skylight strips along the long axis
      vec2 ax=vec2(cos(vR.z),sin(vR.z)), q=vec2(dot(vW.xz,ax),dot(vW.xz,vec2(-ax.y,ax.x)));
      alb*=1.0-0.16*bx(fract(q.y/2.0),0.0,0.05,pf/2.0);
      vec2 ce=floor(q*vec2(0.8,1.2));
      alb=mix(alb,alb*0.55,step(0.92,h21(ce+seed*13.0))*bx(fract(q.x*0.8),0.2,0.8,pf*0.8)*bx(fract(q.y*1.2),0.25,0.75,pf*1.2));
      if(t>8.5) gl=bx(fract(q.y/3.5),0.44,0.56,pf/3.5)*bx(fract(q.x/6.0),0.04,0.96,pf/6.0);
    }
  } else if(t<1.5){ // clay tiles: horizontal courses + weathering
    float c=fract(vW.y/0.032); alb*=mix(0.84+0.16*smoothstep(0.15,0.6,c),0.93,smoothstep(0.3,0.8,fwidth(vW.y)/0.032));
#ifndef LITE
    alb*=0.88+0.24*vn(vW.xz*2.5+seed*9.0);
#endif
  } else if(t<2.5){ spec=0.3; alb*=0.88+0.24*vn(vW.xz*3.0+seed*5.0); }
  else if(t<3.5){ alb*=0.95; }
  else if(t<5.5){ spec=0.6; }
  else if(t<6.5){ // stadium stands: seat rows
    alb*=mix(0.78+0.22*smoothstep(0.2,0.6,fract(vW.y/0.05)),0.89,smoothstep(0.3,0.8,fwidth(vW.y)/0.05));
  } else { // green roof: lawn with darker tree clumps
    alb*=0.8+0.35*vn(vW.xz*3.0+seed*5.0);
    alb=mix(alb,vec3(0.15,0.24,0.11),smoothstep(0.55,0.75,vn(vW.xz*1.1+seed*3.0)));
  }
  float ndl=max(dot(n,SUN()),0.0);
  vec3 dl=ambCol()*(0.72+0.28*n.y)*0.8+sunCol()*ndl*0.75;
  vec3 V=normalize(vV), R=reflect(V,n);
  vec3 sk=mix(vec3(0.62,0.70,0.80),vec3(0.95,0.7,0.5),uDusk*0.7);
  vec3 dayC=alb*dl+sunCol()*pow(max(dot(R,SUN()),0.0),24.0)*spec*0.5;
  dayC=mix(dayC,vec3(0.2,0.25,0.3)*dl+sk*0.35,gl);
  vec3 nightC=alb*(vec3(0.09,0.085,0.11)*(0.6+0.4*n.y)+vec3(0.07,0.04,0.017)*exp(-max(vW.y,0.0)*0.15));
  float on=smoothstep(seed-0.08,seed,uOn)*clamp(1.0-uDay*1.15,0.0,1.0);
  // sparse rooftop fixtures (fade before they get sub-pixel) and lit mall skylights
  vec2 fc=vW.xz*2.0;
  em=vec3(1.0,0.82,0.6)*1.1*fix*step(0.985,h21(floor(fc)+seed*7.0))*clamp((0.14-length(fract(fc)-0.5))/max(pf*2.0,1e-4)+0.5,0.0,1.0)*(1.0-smoothstep(0.04,0.12,pf));
  em+=vec3(1.0,0.86,0.66)*0.55*gl;
  vec3 col=mix(nightC,dayC,uDay)+em*on;
  gl_FragColor=vec4(fogIt(col,vD),1.0);
}`;
  const BEACON_VS = `
uniform float uPx; attribute float aS; varying float vS; varying float vD;
void main(){ vS=aS; vec4 mv=modelViewMatrix*vec4(position,1.0); vD=-mv.z; gl_PointSize=clamp(700.0/vD,2.0,7.0)*uPx; gl_Position=projectionMatrix*mv; }`;
  const BEACON_FS = `
uniform float uDay; uniform float uOn; uniform float uTime; uniform float uFogD; uniform vec3 uFog; varying float vS; varying float vD;
void main(){ vec2 c=gl_PointCoord-0.5; float a=smoothstep(0.5,0.05,length(c));
  float bl=pow(max(sin(uTime*2.4+vS*6.283),0.0),5.0);
  float on=smoothstep(0.6,0.9,uOn)*(1.0-uDay*0.85);
  float f=1.0-exp(-uFogD*uFogD*vD*vD);
  gl_FragColor=vec4(vec3(1.0,0.1,0.05)*a*(0.2+1.3*bl)*on*(1.0-f),1.0); }`;

  // ---------- growable typed buffers ----------
  function buf(T, n) { return { T, a: new T(n), n: 0 }; }
  function room(b, k) { if (b.n + k > b.a.length) { const a = new b.T(Math.max(b.a.length * 2, b.n + k)); a.set(b.a); b.a = a; } }

  function build(ctx) {
    const { THREE, data, small, uniforms } = ctx;
    const heightAt = ctx.heightAt || (() => 0);
    if (!uniforms.uSun) uniforms.uSun = { value: new THREE.Vector3(-0.46, 0.80, 0.38).normalize() };
    const B = data.buildings, AR = data.areas || [];
    // wall attributes
    const wP = buf(Float32Array, 1 << 21), wN = buf(Float32Array, 1 << 20), wF = buf(Float32Array, 1 << 20), wE = buf(Float32Array, 1 << 20),
      wB = buf(Float32Array, 1 << 21), wC = buf(Uint8Array, 1 << 21), wI = buf(Uint32Array, 1 << 21);
    // roof attributes
    const rP = buf(Float32Array, 1 << 20), rN = buf(Float32Array, 1 << 20), rC = buf(Uint8Array, 1 << 20), rR = buf(Float32Array, 1 << 20), rI = buf(Uint32Array, 1 << 20);
    const bcn = [], bcnS = [];
    let cb0 = 0, cb1 = 0, cb2 = 0, cb3 = 0, cc0 = 0, cc1 = 0, cc2 = 0; // current facade attributes
    let rt = 0, rs = 0, ra = 0, rc0 = 0, rc1 = 0, rc2 = 0; // current roof attributes (type, seed, axis angle, colour)
    const setC = (c, k) => { cc0 = Math.min(255, c[0] * k * 255) | 0; cc1 = Math.min(255, c[1] * k * 255) | 0; cc2 = Math.min(255, c[2] * k * 255) | 0; };
    const setR = (t, c, k) => { rt = t; rc0 = Math.min(255, c[0] * k * 255) | 0; rc1 = Math.min(255, c[1] * k * 255) | 0; rc2 = Math.min(255, c[2] * k * 255) | 0; };

    function wv(x, y, z, nx, nz, u, v, e0, e1) {
      room(wP, 3); room(wN, 2); room(wF, 2); room(wE, 2); room(wB, 4); room(wC, 3);
      wP.a[wP.n++] = x; wP.a[wP.n++] = y; wP.a[wP.n++] = z; wN.a[wN.n++] = nx; wN.a[wN.n++] = nz;
      wF.a[wF.n++] = u; wF.a[wF.n++] = v; wE.a[wE.n++] = e0; wE.a[wE.n++] = e1;
      wB.a[wB.n++] = cb0; wB.a[wB.n++] = cb1; wB.a[wB.n++] = cb2; wB.a[wB.n++] = cb3;
      wC.a[wC.n++] = cc0; wC.a[wC.n++] = cc1; wC.a[wC.n++] = cc2;
    }
    function rv(x, y, z, nx, ny, nz) {
      room(rP, 3); room(rN, 3); room(rC, 3); room(rR, 3);
      rP.a[rP.n++] = x; rP.a[rP.n++] = y; rP.a[rP.n++] = z; rN.a[rN.n++] = nx; rN.a[rN.n++] = ny; rN.a[rN.n++] = nz;
      rC.a[rC.n++] = rc0; rC.a[rC.n++] = rc1; rC.a[rC.n++] = rc2; rR.a[rR.n++] = rt; rR.a[rR.n++] = rs; rR.a[rR.n++] = ra;
      return rP.n / 3 - 1;
    }
    function ri(a, b, c) { room(rI, 3); rI.a[rI.n++] = a; rI.a[rI.n++] = b; rI.a[rI.n++] = c; }
    // one roof triangle with its own flat normal, oriented upward
    function rtri(ax, ay, az, bx, by, bz, cx, cy, cz) {
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
      if (l < 1e-7) return; nx /= l; ny /= l; nz /= l;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; const i = rv(ax, ay, az, nx, ny, nz); ri(i, rv(cx, cy, cz, nx, ny, nz), rv(bx, by, bz, nx, ny, nz)); }
      else { const i = rv(ax, ay, az, nx, ny, nz); ri(i, rv(bx, by, bz, nx, ny, nz), rv(cx, cy, cz, nx, ny, nz)); }
    }

    // scratch arrays for ring processing
    let EX = new Float32Array(64), EZ = new Float32Array(64), LEN = new Float32Array(64), COR = new Uint8Array(64);
    // walls for a closed ring xs/zs (n points, CCW in x/z math axes = outward facing) from y0 to y1 (or per-vertex tops ty),
    // facade v0..v1 metres. A clockwise ring gives inward-facing walls (parapet insides, stadium bowls).
    function walls(xs, zs, n, y0, y1, v0, v1, salt, ty) {
      if (EX.length < n) { EX = new Float32Array(n * 2); EZ = new Float32Array(n * 2); LEN = new Float32Array(n * 2); COR = new Uint8Array(n * 2); }
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, dx = xs[j] - xs[i], dz = zs[j] - zs[i], l = Math.hypot(dx, dz) || 1e-6; EX[i] = dx / l; EZ[i] = dz / l; LEN[i] = l * 10; }
      let c0 = -1;
      for (let i = 0; i < n; i++) { const p = (i + n - 1) % n; COR[i] = EX[p] * EX[i] + EZ[p] * EZ[i] < 0.9 ? 1 : 0; if (COR[i] && c0 < 0) c0 = i; }
      const st = c0 < 0 ? 0 : c0;
      let k = 0, run = 0;
      while (k < n) {
        let m = k, rl = 0;
        do { rl += LEN[(st + m) % n]; m++; } while (m < n && !COR[(st + m) % n]);
        const off = 60 * (3 + ((run * 7 + salt) % 53)) - rl / 2;
        let d = 0;
        for (let q = k; q < m; q++) {
          const i = (st + q) % n, j = (i + 1) % n, p = (i + n - 1) % n;
          let ax = EZ[i], az = -EX[i], bx = ax, bz = az; // edge normal (dz,-dx)
          if (!COR[i]) { ax += EZ[p]; az -= EX[p]; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
          if (!COR[j]) { bx += EZ[j]; bz -= EX[j]; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
          const L = LEN[i], u0 = off + d, u1 = off + d + L, base = wP.n / 3;
          const ti = ty ? ty[i] : y1, tj = ty ? ty[j] : y1;
          wv(xs[i], y0, zs[i], ax, az, u0, v0, d, rl - d);
          wv(xs[j], y0, zs[j], bx, bz, u1, v0, d + L, rl - d - L);
          wv(xs[j], tj, zs[j], bx, bz, u1, v1 + (tj - y1) * 10, d + L, rl - d - L);
          wv(xs[i], ti, zs[i], ax, az, u0, v1 + (ti - y1) * 10, d, rl - d);
          room(wI, 6); const I = wI.a; let t = wI.n;
          I[t++] = base; I[t++] = base + 2; I[t++] = base + 1; I[t++] = base; I[t++] = base + 3; I[t++] = base + 2; wI.n = t;
          d += L;
        }
        k = m; run++;
      }
    }
    let RX = new Float64Array(64), RZ = new Float64Array(64);
    function inner(xs, zs, n, y0, y1, v0, v1, salt) { // inward-facing walls on the same ring (reversed)
      if (RX.length < n) { RX = new Float64Array(n * 2); RZ = new Float64Array(n * 2); }
      for (let i = 0; i < n; i++) { RX[i] = xs[n - 1 - i]; RZ[i] = zs[n - 1 - i]; }
      walls(RX, RZ, n, y0, y1, v0, v1, salt);
    }
    // flat roof triangulation; validated against the ring area (falls back to a centroid fan)
    let badTri = 0;
    function triangulate(xs, zs, n, area, cx, cz) {
      let convex = true;
      for (let i = 0; i < n && convex; i++) { const j = (i + 1) % n, k = (i + 2) % n; if ((xs[j] - xs[i]) * (zs[k] - zs[j]) - (zs[j] - zs[i]) * (xs[k] - xs[j]) < -1e-6) convex = false; }
      if (convex) { const t = []; for (let i = 1; i < n - 1; i++) t.push(0, i, i + 1); return t; }
      const pts = []; for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(xs[i], zs[i]));
      const f = THREE.ShapeUtils.triangulateShape(pts, []), t = []; let s = 0;
      for (const tri of f) { t.push(tri[0], tri[1], tri[2]); s += Math.abs((xs[tri[1]] - xs[tri[0]]) * (zs[tri[2]] - zs[tri[0]]) - (zs[tri[1]] - zs[tri[0]]) * (xs[tri[2]] - xs[tri[0]])) / 2; }
      if (Math.abs(s - area) <= area * 0.05) return t;
      badTri++;
      return null; // caller uses a fan around the centroid
    }
    // flat roof at y (or per-vertex ty), optionally scaled about (cx,cz); down=true emits a downward face (canopy undersides)
    function flatRoof(xs, zs, n, tris, y, cx, cz, s, down) {
      if (!tris) { // centroid fan
        const c = rv(cx, y, cz, 0, down ? -1 : 1, 0);
        for (let i = 0; i < n; i++) rv(cx + (xs[i] - cx) * s, y, cz + (zs[i] - cz) * s, 0, down ? -1 : 1, 0);
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (down) ri(c, c + 1 + i, c + 1 + j); else ri(c, c + 1 + j, c + 1 + i); }
        return;
      }
      const b = rP.n / 3;
      for (let i = 0; i < n; i++) rv(cx + (xs[i] - cx) * s, y, cz + (zs[i] - cz) * s, 0, down ? -1 : 1, 0);
      for (let i = 0; i < tris.length; i += 3) {
        const a = tris[i], c = tris[i + 1], d = tris[i + 2];
        // keep upward winding: ring is CCW in math axes, which faces down in three's y-up frame
        const up = (xs[c] - xs[a]) * (zs[d] - zs[a]) - (zs[c] - zs[a]) * (xs[d] - xs[a]) > 0;
        if (up !== !!down) ri(b + a, b + d, b + c); else ri(b + a, b + c, b + d);
      }
    }
    function slopedRoof(xs, zs, n, tris, ty, cx, cz) {
      if (!tris) { let y = 0; for (let i = 0; i < n; i++) y += ty[i] / n; for (let i = 0; i < n; i++) { const j = (i + 1) % n; rtri(cx, y, cz, xs[i], ty[i], zs[i], xs[j], ty[j], zs[j]); } return; }
      for (let i = 0; i < tris.length; i += 3) { const a = tris[i], c = tris[i + 1], d = tris[i + 2]; rtri(xs[a], ty[a], zs[a], xs[c], ty[c], zs[c], xs[d], ty[d], zs[d]); }
    }
    function box(cx, cz, ux, uz, hl, hw, y0, y1) { // oriented box: axis (ux,uz), half sizes
      const wx = -uz, wz = ux, X = [], Z = [];
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => { X.push(cx + ux * hl * a + wx * hw * b); Z.push(cz + uz * hl * a + wz * hw * b); });
      // orientation: make CCW in math axes
      const ar = (X[1] - X[0]) * (Z[2] - Z[0]) - (Z[1] - Z[0]) * (X[2] - X[0]); if (ar < 0) { X.reverse(); Z.reverse(); }
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4, nx = Z[j] - Z[i], nz = -(X[j] - X[i]), l = Math.hypot(nx, nz) || 1;
        const a = rv(X[i], y0, Z[i], nx / l, 0, nz / l), b = rv(X[j], y0, Z[j], nx / l, 0, nz / l), c = rv(X[j], y1, Z[j], nx / l, 0, nz / l), d = rv(X[i], y1, Z[i], nx / l, 0, nz / l);
        ri(a, c, b); ri(a, d, c);
      }
      const t = rv(X[0], y1, Z[0], 0, 1, 0); rv(X[1], y1, Z[1], 0, 1, 0); rv(X[2], y1, Z[2], 0, 1, 0); rv(X[3], y1, Z[3], 0, 1, 0);
      ri(t, t + 2, t + 1); ri(t, t + 3, t + 2);
    }
    function inside(xs, zs, n, x, z) {
      let c = false;
      for (let i = 0, j = n - 1; i < n; j = i++) if ((zs[i] > z) !== (zs[j] > z) && x < ((xs[j] - xs[i]) * (z - zs[i])) / (zs[j] - zs[i]) + xs[i]) c = !c;
      return c;
    }
    const pick = (a, r) => a[(r() * a.length) | 0];
    const cap = (c, m) => { const k = Math.min(1, m / Math.max(c[0], c[1], c[2])); return [c[0] * k, c[1] * k, c[2] * k]; };

    // areas the roofs care about (by centroid, 10-unit grid): sports pitches (open stadium bowls) and parks (green roofs)
    const AG = new Map(), AX = [], AZ = [], AA = [], AK = [];
    AR.forEach((a, k) => {
      if (a.kind !== 4 && a.kind !== 2 && a.kind !== 3 && a.kind !== 5) return;
      const r = a.ring, m = r.length >> 1; let s = 0, x = 0, z = 0;
      for (let i = 0; i < m; i++) { const j = (i + 1) % m, c = r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1]; s += c; x += (r[2 * i] + r[2 * j]) * c; z += (r[2 * i + 1] + r[2 * j + 1]) * c; }
      if (Math.abs(s) < 1e-6) return;
      const id = AX.length; AX.push(x / (3 * s)); AZ.push(z / (3 * s)); AA.push(Math.abs(s / 2)); AK.push([a.kind, k]);
      const key = Math.floor(AX[id] / 10) * 1000 + Math.floor(AZ[id] / 10); (AG.get(key) || AG.set(key, []).get(key)).push(id);
    });
    function areasIn(x0, x1, z0, z1, fn) {
      for (let gx = Math.floor(x0 / 10); gx <= Math.floor(x1 / 10); gx++) for (let gz = Math.floor(z0 / 10); gz <= Math.floor(z1 / 10); gz++) {
        const l = AG.get(gx * 1000 + gz); if (l) for (const id of l) if (AX[id] >= x0 && AX[id] <= x1 && AZ[id] >= z0 && AZ[id] <= z1) fn(id);
      }
    }

    let xs = new Float64Array(64), zs = new Float64Array(64), px = new Float64Array(64), pz = new Float64Array(64), ty = new Float64Array(64);
    let kept = 0;
    // duplicates: the merged sources sometimes carry the same footprint twice (z-fighting walls); keep the tallest
    const skip = new Uint8Array(B.length), grid = new Map(), CX = new Float32Array(B.length), CZ = new Float32Array(B.length);
    for (let bi = 0; bi < B.length; bi++) {
      const rg = B[bi].ring, n = rg.length >> 1; let a = 0, x = 0, z = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, c = rg[2 * i] * rg[2 * j + 1] - rg[2 * j] * rg[2 * i + 1]; a += c; x += (rg[2 * i] + rg[2 * j]) * c; z += (rg[2 * i + 1] + rg[2 * j + 1]) * c; }
      if (Math.abs(a) < 1e-6) { skip[bi] = 1; continue; }
      x /= 3 * a; z /= 3 * a; a = Math.abs(a / 2); CX[bi] = x; CZ[bi] = z;
      if (ctx.citySkip && ctx.citySkip.some((s) => Math.hypot(x - s.x, z - s.z) < s.r)) { skip[bi] = 1; continue; }
      const key = Math.round(x * 2) * 100003 + Math.round(z * 2), prev = grid.get(key);
      if (prev) {
        const [pi, pa] = prev;
        if (Math.abs(pa / a - 1) < 0.2 && Math.abs(B[pi].min - B[bi].min) < 0.3) {
          if (B[bi].h > B[pi].h) { skip[pi] = 1; grid.set(key, [bi, a]); } else skip[bi] = 1;
          continue;
        }
      }
      grid.set(key, [bi, a]);
    }
    // sectors for frustum culling: a central disc plus six 60-degree wedges; emit bucket by bucket (near-to-far inside each)
    const NB = 7, bucketOf = (x, z) => (Math.hypot(x, z) < 80 ? 0 : 1 + Math.min(5, Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * 6)));
    const order = [], bStart = [];
    for (let k = 0; k < NB; k++) { bStart.push(order.length); for (let bi = 0; bi < B.length; bi++) if (!skip[bi] && bucketOf(CX[bi], CZ[bi]) === k) order.push(bi); }
    bStart.push(order.length);
    const BR = []; // per-bucket buffer offsets {wv,wi,rv,ri}
    const rec = { bi: [], x: [], z: [], b: [], w0: [], w1: [], r0: [], r1: [], c0: [], c1: [] }; // per-building index ranges (cityHide)
    const towers = [], greenRoofs = [];
    const overrides = ctx.cityRoof || [];

    for (let k = 0; k < NB; k++) {
      BR.push({ wv: wP.n / 3, wi: wI.n, rv: rP.n / 3, ri: rI.n });
      for (let oi = bStart[k]; oi < bStart[k + 1]; oi++) {
        const bi = order[oi];
        const w0 = wI.n, r0 = rI.n, c0 = bcn.length / 3;
        if (emit(bi)) { rec.c0.push(c0); rec.c1.push(bcn.length / 3); rec.bi.push(bi); rec.x.push(CX[bi]); rec.z.push(CZ[bi]); rec.b.push(k); rec.w0.push(w0); rec.w1.push(wI.n); rec.r0.push(r0); rec.r1.push(rI.n); }
      }
    }
    BR.push({ wv: wP.n / 3, wi: wI.n, rv: rP.n / 3, ri: rI.n });

    function emit(bi) {
      const b = B[bi], ring = b.ring, n0 = ring.length >> 1;
      if (xs.length < n0 + 1) { xs = new Float64Array(n0 * 2); zs = new Float64Array(n0 * 2); px = new Float64Array(n0 * 2); pz = new Float64Array(n0 * 2); ty = new Float64Array(n0 * 2); }
      // clean: drop repeated points
      let n = 0;
      for (let i = 0; i < n0; i++) { const x = ring[2 * i], z = ring[2 * i + 1]; if (n && Math.abs(x - xs[n - 1]) < 0.004 && Math.abs(z - zs[n - 1]) < 0.004) continue; xs[n] = x; zs[n] = z; n++; }
      while (n > 2 && Math.abs(xs[0] - xs[n - 1]) < 0.004 && Math.abs(zs[0] - zs[n - 1]) < 0.004) n--;
      if (n < 3) return false;
      let A2 = 0, cx = 0, cz = 0, li = 0, ll = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, c = xs[i] * zs[j] - xs[j] * zs[i]; A2 += c; cx += (xs[i] + xs[j]) * c; cz += (zs[i] + zs[j]) * c;
        const l = Math.hypot(xs[j] - xs[i], zs[j] - zs[i]); if (l > ll) { ll = l; li = i; }
      }
      if (A2 < 0) { // keep everything CCW
        for (let i = 0, j = n - 1; i < j; i++, j--) { let t = xs[i]; xs[i] = xs[j]; xs[j] = t; t = zs[i]; zs[i] = zs[j]; zs[j] = t; }
        A2 = -A2; cx = -cx; cz = -cz; li = (n - 2 - li + n) % n;
      }
      const area = A2 / 2; if (area < 0.015) return false;
      cx /= 3 * A2; cz /= 3 * A2;
      { // grow each footprint by a few cm (by seed) so coplanar walls of touching building parts don't z-fight
        const k = 1 + (0.006 + 0.03 * ((bi * 0.618034) % 1)) / Math.sqrt(area);
        for (let i = 0; i < n; i++) { xs[i] = cx + (xs[i] - cx) * k; zs[i] = cz + (zs[i] - cz) * k; }
      }
      const dist = Math.hypot(cx, cz), h = b.h, hmin = b.min, kind = b.kind;
      if (h - hmin < 0.05) return false;
      if (small && h < 1.2 && dist > 180) return false;
      if (kind === 12 && h > 2 && area > 20) return false; // floating mega-canopies: bad data
      const r = ctx.rng(bi * 9973 + 17), seed = b.seed;
      // principal axis from the longest edge, oriented extents
      let ux = xs[(li + 1) % n] - xs[li], uz = zs[(li + 1) % n] - zs[li]; { const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l; }
      let amin = 1e9, amax = -1e9, bmin = 1e9, bmax = -1e9;
      for (let i = 0; i < n; i++) { const a = (xs[i] - cx) * ux + (zs[i] - cz) * uz, c = -(xs[i] - cx) * uz + (zs[i] - cz) * ux; if (a < amin) amin = a; if (a > amax) amax = a; if (c < bmin) bmin = c; if (c > bmax) bmax = c; }
      if (bmax - bmin > amax - amin) { const t = ux; ux = -uz; uz = t; } // long axis = principal axis
      amin = 1e9; amax = -1e9; bmin = 1e9; bmax = -1e9;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < n; i++) {
        const a = (xs[i] - cx) * ux + (zs[i] - cz) * uz, c = -(xs[i] - cx) * uz + (zs[i] - cz) * ux; if (a < amin) amin = a; if (a > amax) amax = a; if (c < bmin) bmin = c; if (c > bmax) bmax = c;
        if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; if (zs[i] < z0) z0 = zs[i]; if (zs[i] > z1) z1 = zs[i];
      }
      const hl = (amax - amin) / 2, hw = (bmax - bmin) / 2, ac = (amax + amin) / 2, bc = (bmax + bmin) / 2;
      ra = Math.atan2(uz, ux);

      // open-air stadium (a sports pitch inside the footprint) and rooftop parks
      let stadium = false, green = false;
      if (kind === 11 || ((kind === 8 || kind === 10) && area > 15)) areasIn(x0, x1, z0, z1, (id) => { if (AK[id][0] === 4 && inside(xs, zs, n, AX[id], AZ[id])) stadium = true; });
      if (!stadium && area >= 1) areasIn(x0, x1, z0, z1, (id) => {
        if (AK[id][0] !== 4 && AA[id] >= 0.4 * area && AA[id] < 2.5 * area && inside(xs, zs, n, AX[id], AZ[id])) { green = true; greenRoofs.push({ area: AK[id][1], building: bi }); }
      });
      let ovr = null;
      for (const o of overrides) if (o.x >= x0 && o.x <= x1 && o.z >= z0 && o.z <= z1 && inside(xs, zs, n, o.x, o.z)) ovr = o;
      if (ovr && ovr.green) green = true;

      // ---- archetype ----
      let arch, col, ck = 0.92 + r() * 0.12;
      const q = r();
      if (kind === 12) arch = CANOPY;
      else if (kind === 2) arch = HOUSE;
      else if (kind === 7) arch = PARK;
      else if (kind === 6 || kind === 11) arch = h < 6 ? IND : OFFICE;
      else if (kind === 9) arch = RELIG;
      else if (kind === 8 || kind === 10) arch = h >= 6 && q < 0.5 ? OFFICE : CIVIC;
      else if (kind === 3) arch = h >= 5 ? (q < 0.7 ? GLASS : OFFICE) : h < 1.8 && area < 5 ? SHOP : h >= 3 && q < 0.3 ? GLASS : OFFICE;
      else if (kind === 5) arch = h >= 6 ? (q < 0.55 ? GLASS : CONDO) : OFFICE;
      else if (kind === 4) arch = h < 1.8 && area < 5 ? SHOP : area >= 12 && h < 6 ? MALL : h >= 6 && q < 0.5 ? GLASS : OFFICE;
      else if (kind === 1) arch = h < 0.75 && area < 3 ? HOUSE : h >= 12 && q < 0.25 ? GLASS : CONDO;
      else { // unknown: guess from height and footprint
        if (h >= 12) arch = q < 0.55 ? GLASS : q < 0.85 ? CONDO : OFFICE;
        else if (h >= 4) arch = q < 0.45 ? CONDO : q < 0.75 ? OFFICE : GLASS;
        else if (h >= 1.8) arch = area >= 25 ? (q < 0.5 ? MALL : IND) : q < 0.5 ? OFFICE : CONDO;
        else if (h <= 0.75 && area < 3.5) arch = HOUSE;
        else if (area < 6) arch = SHOP;
        else if (area >= 25) arch = q < 0.6 ? IND : MALL;
        else arch = q < 0.5 ? MALL : OFFICE;
      }
      if (stadium) arch = CIVIC;
      col = arch === GLASS ? pick(PAL.glass, r) : arch === CONDO ? pick(PAL.condo, r) : arch === OFFICE ? pick(PAL.office, r) : arch === SHOP ? pick(PAL.shop, r)
        : arch === HOUSE ? pick(PAL.house, r) : arch === IND ? pick(PAL.ind, r) : arch === CIVIC ? pick(stadium ? PAL.civic.slice(0, 3) : PAL.civic, r) : arch === RELIG ? pick(PAL.relig, r)
        : arch === MALL ? pick(PAL.mall, r) : arch === PARK ? [0.66, 0.65, 0.62] : [0.86, 0.87, 0.88];
      if (arch === GLASS) ck = 0.9 + r() * 0.2;
      const towerish = arch === GLASS || arch === CONDO || arch === OFFICE;
      // ---- roof form ----
      const pitched = !stadium && (arch === HOUSE || (b.roof >= 1 && b.roof <= 3 && h < 4 && area < 8) || (arch === SHOP && h <= 1.4 && r() < 0.5)) && hw > 0.05;
      const dome = !pitched && !stadium && (b.roof === 4 || (kind === 9 && area < 40 && r() < 0.4));
      const canopy = arch === CANOPY;
      const crown = h >= 18 && towerish && !pitched && !dome && !stadium && !green;
      const form = crown ? (r() < 0.4 ? 0 : r() < 0.55 ? 1 : 2) : -1; // 0 stepped setbacks, 1 wedge top, 2 lantern
      // a few tasteful lit crowns: white, amber or a rare cool blue (condos only white / amber)
      const lit = crown ? r() < 0.35 : h >= 15 && towerish && area < 25 && r() < 0.12;
      const aux = lit ? (arch === CONDO ? 1 + ((r() * 2) | 0) : (() => { const t = r(); return t < 0.5 ? 1 : t < 0.9 ? 2 : 3; })()) : 0;
      const g = heightAt(cx, cz);
      let gmin = g; for (let i = 0, st = Math.max(1, (n / 8) | 0); i < n; i += st) gmin = Math.min(gmin, heightAt(xs[i], zs[i]));
      const sink = hmin > 0 ? 0 : 0.3 + (g - gmin);
      let eaves = h, rise = 0;
      if (pitched) { rise = Math.min(Math.max(hw * 0.5, 0.06), 0.35); eaves = Math.max(hmin + 0.2, h - rise); if (b.roof === 3) rise = Math.min(rise * 1.3, 0.45); }
      const par = pitched || dome || canopy || stadium || form === 1 ? 0 : h > 1.2 ? 0.1 : 0.06;
      const innerPar = par > 0 && dist < (small ? 60 : 110);
      const salt = (seed * 255) | 0;
      const tris = pitched || stadium ? null : triangulate(xs, zs, n, area, cx, cz);
      rs = seed;
      cb0 = seed; cb1 = arch; cb2 = eaves * 10; cb3 = crown ? 0 : aux; setC(col, ck);
      let topY = g + h + par, topS = 1, mastY = 0;

      if (stadium) {
        // open bowl: outer walls, a raked seating surface down to the pitch, an inner pitch wall, a roof over one stand, floodlight masts
        const H = Math.max(h * 0.55, 0.8), s = 0.78;
        cb2 = H * 10; walls(xs, zs, n, g - sink, g + H, -sink * 10, H * 10, salt);
        for (let i = 0; i < n; i++) { px[i] = cx + (xs[i] - cx) * s; pz[i] = cz + (zs[i] - cz) * s; }
        cb1 = PARK; cb2 = 3; setC([0.7, 0.7, 0.68], 1); inner(px, pz, n, g - 0.05, g + 0.3, -0.5, 3, salt + 3);
        setR(R_STAND, [0.64, 0.64, 0.62], 1);
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; rtri(px[i], g + 0.3, pz[i], xs[j], g + H, zs[j], xs[i], g + H, zs[i]); rtri(px[i], g + 0.3, pz[i], px[j], g + 0.3, pz[j], xs[j], g + H, zs[j]); }
        setR(R_BOX, [0.84, 0.85, 0.86], 1);
        const sb = bc + hw * 0.88, P = (a, c) => [cx + ux * a - uz * c, cz + uz * a + ux * c];
        let [X, Z] = P(ac, sb); box(X, Z, ux, uz, hl * 0.5, hw * 0.15, g + H + 0.32, g + H + 0.4);
        [X, Z] = P(ac, bc + hw * 0.99); box(X, Z, ux, uz, hl * 0.5, 0.04, g + H - 0.1, g + H + 0.4);
        setR(R_BOX, [0.55, 0.56, 0.58], 1);
        for (const [sa, sc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          [X, Z] = P(ac + sa * hl * 0.78, bc + sc * hw * 0.92);
          box(X, Z, ux, uz, 0.06, 0.06, g, g + H + 2.4); box(X, Z, ux, uz, 0.06, 0.28, g + H + 2.4, g + H + 2.6);
        }
        topY = g + H + 2.6;
      } else if (canopy) {
        walls(xs, zs, n, g + h - 0.08, g + h, (h - 0.08) * 10, h * 10, salt);
      } else if (form === 0) { // stepped setbacks over the top 12%
        const T = 2 + (r() < 0.5 ? 1 : 0), yb = h * 0.88; let s = 1, y = yb;
        cb2 = yb * 10; walls(xs, zs, n, g + hmin - sink, g + yb, (hmin - sink) * 10, yb * 10, salt);
        setR(R_FLAT, pick(PAL.roof, r), 0.85);
        flatRoof(xs, zs, n, tris, g + yb, cx, cz, 1);
        for (let t = 1; t <= T; t++) {
          const s2 = s * (1 - (0.08 + 0.07 * r())), y2 = h * (0.88 + (0.12 * t) / T), pp = t === T ? par : 0;
          for (let i = 0; i < n; i++) { px[i] = cx + (xs[i] - cx) * s2; pz[i] = cz + (zs[i] - cz) * s2; }
          cb2 = y2 * 10; cb3 = t === T ? aux : 0;
          walls(px, pz, n, g + y, g + y2 + pp, y * 10, (y2 + pp) * 10, salt + t * 5);
          if (t === T && innerPar) inner(px, pz, n, g + y2, g + y2 + pp, y2 * 10, (y2 + pp) * 10, salt + 9);
          flatRoof(xs, zs, n, tris, g + y2, cx, cz, s2);
          s = s2; y = y2;
        }
        topS = s;
      } else if (form === 1) { // wedge: one long edge raised by 3-5% of the height
        const rs2 = h * (0.03 + 0.02 * r()), sg = r() < 0.5 ? 1 : -1;
        for (let i = 0; i < n; i++) { const c = (-(xs[i] - cx) * uz + (zs[i] - cz) * ux - bmin) / Math.max(bmax - bmin, 1e-3); ty[i] = g + h + rs2 * (sg > 0 ? c : 1 - c); }
        cb3 = aux; walls(xs, zs, n, g + hmin - sink, g + h, (hmin - sink) * 10, h * 10, salt, ty);
        setR(R_FLAT, pick(PAL.roof, r), 0.85);
        slopedRoof(xs, zs, n, tris, ty, cx, cz);
        topY = g + h + rs2;
      } else if (form === 2) { // slim lantern on a plinth roof, sometimes a mast
        const h0 = h * 0.93, kk = Math.min(0.5 + r() * 0.2, Math.sqrt(6 / area));
        cb2 = h0 * 10; walls(xs, zs, n, g + hmin - sink, g + h0 + par, (hmin - sink) * 10, (h0 + par) * 10, salt);
        if (innerPar) inner(xs, zs, n, g + h0, g + h0 + par, h0 * 10, (h0 + par) * 10, salt + 9);
        setR(R_FLAT, pick(PAL.roof, r), 0.85);
        flatRoof(xs, zs, n, tris, g + h0, cx, cz, 1);
        for (let i = 0; i < n; i++) { px[i] = cx + (xs[i] - cx) * kk; pz[i] = cz + (zs[i] - cz) * kk; }
        cb1 = PLANT; cb2 = h * 10; cb3 = aux; setC(arch === GLASS ? [0.78, 0.8, 0.82] : col, ck);
        walls(px, pz, n, g + h0, g + h, h0 * 10, h * 10, salt + 13);
        flatRoof(xs, zs, n, tris, g + h, cx, cz, kk);
        topS = kk; topY = g + h;
        if (r() < 0.5) { setR(R_BOX, [0.8, 0.81, 0.82], 1); mastY = g + h + h * 0.07; box(cx + ux * ac - uz * bc, cz + uz * ac + ux * bc, ux, uz, 0.05, 0.05, g + h, mastY); }
      } else {
        walls(xs, zs, n, g + hmin - sink, g + eaves + par, (hmin - sink) * 10, (eaves + par) * 10, salt);
        if (innerPar) inner(xs, zs, n, g + eaves, g + eaves + par, eaves * 10, (eaves + par) * 10, salt + 9);
      }
      kept++;
      if (pitched) {
        // raised hip: eave ring (slight overhang) up to a ridge line along the principal axis; tiles or zinc, weathered
        const metal = r() < (arch === SHOP ? 0.45 : 0.4), tc = pick(metal ? PAL.zinc : arch === SHOP ? PAL.tile.slice(0, 4) : PAL.tile, r);
        setR(metal ? R_METAL : R_TILE, tc, 0.88 + r() * 0.24);
        const Rr = b.roof === 3 ? 0 : Math.max(hl - hw * (b.roof === 1 ? 0.35 : 1), 0), yE = g + eaves, yT = g + eaves + rise;
        for (let i = 0; i < n; i++) {
          const p = (i + n - 1) % n, j = (i + 1) % n;
          let mx = (zs[i] - zs[p]) / (Math.hypot(xs[i] - xs[p], zs[i] - zs[p]) || 1) + (zs[j] - zs[i]) / (Math.hypot(xs[j] - xs[i], zs[j] - zs[i]) || 1);
          let mz = -(xs[i] - xs[p]) / (Math.hypot(xs[i] - xs[p], zs[i] - zs[p]) || 1) - (xs[j] - xs[i]) / (Math.hypot(xs[j] - xs[i], zs[j] - zs[i]) || 1);
          const ml = Math.hypot(mx, mz) || 1, mk = Math.min(2 / ml, 1.6) * 0.05; // ~0.5 m overhang along the miter
          px[i] = xs[i] + (mx / ml) * mk; pz[i] = zs[i] + (mz / ml) * mk;
        }
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ai = (xs[i] - cx) * ux + (zs[i] - cz) * uz, aj = (xs[j] - cx) * ux + (zs[j] - cz) * uz;
          const ti = ac + Math.max(-Rr, Math.min(Rr, ai - ac)), tj = ac + Math.max(-Rr, Math.min(Rr, aj - ac));
          const Tix = cx + ux * ti - uz * bc, Tiz = cz + uz * ti + ux * bc, Tjx = cx + ux * tj - uz * bc, Tjz = cz + uz * tj + ux * bc;
          rtri(px[i], yE, pz[i], Tjx, yT, Tjz, px[j], yE, pz[j]);
          rtri(px[i], yE, pz[i], Tix, yT, Tiz, Tjx, yT, Tjz);
        }
        topY = yT;
      } else if (!stadium && form < 0) {
        if (ovr && ovr.color) setR(green ? R_GREEN : R_FLAT, ovr.color, 1);
        else if (green) setR(R_GREEN, [0.30, 0.40, 0.20], 0.9 + r() * 0.2);
        else if (canopy) area > 15 ? setR(R_FLAT, cap(pick(PAL.roof, r), 0.6), 0.95) : setR(R_CANOPY, pick(PAL.canopy, r), 0.92 + r() * 0.12);
        else if (arch === IND || (arch === MALL && r() < 0.4)) area > 20 ? setR(arch === MALL ? R_MALL : R_BIG, pick(PAL.metal, r), 0.92) : setR(R_METAL, pick(r() < 0.35 ? PAL.shed : PAL.metal, r), 1);
        else if (area > 20) setR(arch === MALL ? R_MALL : R_BIG, cap(pick(PAL.roof, r), 0.62), 0.92 + r() * 0.08);
        else setR(R_FLAT, r() < 0.05 ? [0.42, 0.52, 0.42] : pick(PAL.roof, r), 0.92 + r() * 0.16);
        flatRoof(xs, zs, n, tris, g + h, cx, cz, 1);
        if (canopy) flatRoof(xs, zs, n, tris, g + h - 0.08, cx, cz, 1, true);
        if (dome) { // dome rings over a scaled base (stadium domes are wide and shallow)
          const st = kind === 11, base = b.roof === 4 ? (st ? 0.95 : 1) : 0.6, Rd = Math.min(hw, hl) * base * (st ? 0.42 : 0.95), K = st ? 6 : 4, yb = g + h + (b.roof === 4 ? 0 : par);
          setR(R_DOME, st ? [0.76, 0.78, 0.78] : pick(PAL.dome, r), 1);
          for (let k = 0; k < K; k++) {
            const s0 = Math.cos((k / K) * Math.PI / 2) * base, s1 = Math.cos(((k + 1) / K) * Math.PI / 2) * base, y0 = yb + Rd * Math.sin((k / K) * Math.PI / 2), y1 = yb + Rd * Math.sin(((k + 1) / K) * Math.PI / 2);
            for (let i = 0; i < n; i++) {
              const j = (i + 1) % n;
              const ax = cx + (xs[i] - cx) * s0, az = cz + (zs[i] - cz) * s0, bx2 = cx + (xs[j] - cx) * s0, bz = cz + (zs[j] - cz) * s0;
              const cx1 = cx + (xs[j] - cx) * s1, cz1 = cz + (zs[j] - cz) * s1, dx = cx + (xs[i] - cx) * s1, dz = cz + (zs[i] - cz) * s1;
              rtri(ax, y0, az, cx1, y1, cz1, bx2, y0, bz); if (k < K - 1) rtri(ax, y0, az, dx, y1, dz, cx1, y1, cz1);
            }
          }
          topY = yb + Rd;
        } else if (h >= 8 && towerish && area >= 2 && r() < 0.85) {
          // rooftop plant room / crown box
          const pk = Math.min(0.5 + r() * 0.25, Math.sqrt(5 / area)), ph = 0.3 + r() * 0.5;
          for (let i = 0; i < n; i++) { px[i] = cx + (xs[i] - cx) * pk; pz[i] = cz + (zs[i] - cz) * pk; }
          cb1 = PLANT; cb2 = (h + ph) * 10; setC(pick(PAL.plant, r), 1);
          walls(px, pz, n, g + h, g + h + ph, h * 10, (h + ph) * 10, salt + 11);
          setR(R_FLAT, pick(PAL.roof, r), 0.85);
          flatRoof(xs, zs, n, tris, g + h + ph, cx, cz, pk);
          topS = pk; topY = g + h + ph;
        } else if (h >= 0.6 && h < 8 && area >= 2.5 && !canopy && !green && (!small || dist < 150)) {
          // lift motor rooms, water tanks and AC units
          const cnt = 1 + ((r() * 3) | 0) + (area > 20 ? 2 : 0), lim = Math.min(hl, hw);
          for (let c = 0; c < cnt; c++) {
            const bl = Math.min(0.12 + r() * 0.35, lim * 0.45), bw = Math.min(0.1 + r() * 0.3, lim * 0.45), bh = 0.12 + r() * 0.3;
            const a = ac + (r() - 0.5) * (hl - bl) * 1.4, bb = bc + (r() - 0.5) * (hw - bw) * 1.4;
            const X = cx + ux * a - uz * bb, Z = cz + uz * a + ux * bb;
            if (!inside(xs, zs, n, X + ux * bl + uz * bw, Z + uz * bl - ux * bw) || !inside(xs, zs, n, X - ux * bl - uz * bw, Z - uz * bl + ux * bw)
              || !inside(xs, zs, n, X + ux * bl - uz * bw, Z + uz * bl + ux * bw) || !inside(xs, zs, n, X - ux * bl + uz * bw, Z - uz * bl - ux * bw)) continue;
            setR(R_BOX, pick(PAL.box, r), 0.9 + r() * 0.15);
            box(X, Z, ux, uz, bl, bw, g + h, g + h + bh);
          }
        }
      }
      // red aviation beacons on buildings over ~150 m: corners of the top ring, or the mast tip
      if (h >= 15) {
        if (mastY) { bcn.push(cx + ux * ac - uz * bc, mastY + 0.1, cz + uz * ac + ux * bc); bcnS.push(seed); }
        else {
          let ix = [0, 0, 0, 0];
          for (let i = 0; i < n; i++) { if (xs[i] < xs[ix[0]]) ix[0] = i; if (xs[i] > xs[ix[1]]) ix[1] = i; if (zs[i] < zs[ix[2]]) ix[2] = i; if (zs[i] > zs[ix[3]]) ix[3] = i; }
          ix = [...new Set(ix)];
          for (const i of ix) { bcn.push(cx + (xs[i] - cx) * topS * 0.95, (form === 1 ? ty[i] : topY) + 0.12, cz + (zs[i] - cz) * topS * 0.95); bcnS.push(seed); }
        }
      }
      if (h >= 18) towers.push({ index: bi, x: cx, z: cz, h, form, lit: aux });
      return true;
    }

    // ---------- meshes: one wall + one roof mesh per sector, sharing two materials ----------
    const U = { uDay: uniforms.uDay, uDusk: uniforms.uDusk, uOn: uniforms.uOn, uTime: uniforms.uTime, uFog: uniforms.uFog, uFogD: uniforms.uFogD, uSun: uniforms.uSun };
    const defines = small ? { LITE: 1 } : {};
    const wallMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: WALL_VS, fragmentShader: WALL_FS, side: THREE.FrontSide, defines, extensions: { derivatives: true } });
    const roofMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: ROOF_VS, fragmentShader: ROOF_FS, side: THREE.FrontSide, defines, extensions: { derivatives: true } });
    function freeArray() { this.array = null; } // geometry is static: drop the CPU copy once it is on the GPU
    function geo(attrs, I, v0, v1, i0, i1) {
      const g = new THREE.BufferGeometry();
      for (const [name, b, s, norm] of attrs) g.setAttribute(name, new THREE.BufferAttribute(b.a.slice(v0 * s, v1 * s), s, !!norm).onUpload(freeArray));
      const idx = (v1 - v0 < 65536 ? new Uint16Array(i1 - i0) : new Uint32Array(i1 - i0)), src = I.a;
      for (let i = i0; i < i1; i++) idx[i - i0] = src[i] - v0;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      return g;
    }
    const meshes = [];
    for (let k = 0; k < NB; k++) {
      const a = BR[k], z = BR[k + 1], m = [];
      if (z.wi > a.wi) m.push(new THREE.Mesh(geo([['position', wP, 3], ['aN', wN, 2], ['aF', wF, 2], ['aE', wE, 2], ['aB', wB, 4], ['aC', wC, 3, true]], wI, a.wv, z.wv, a.wi, z.wi), wallMat));
      else m.push(null);
      if (z.ri > a.ri) m.push(new THREE.Mesh(geo([['position', rP, 3], ['normal', rN, 3], ['aC', rC, 3, true], ['aR', rR, 3]], rI, a.rv, z.rv, a.ri, z.ri), roofMat));
      else m.push(null);
      m.forEach((me, j) => { if (me) { me.name = (j ? 'city-roofs-' : 'city-walls-') + k; ctx.group.add(me); } });
      meshes.push(m);
    }
    let beacons = null;
    if (bcn.length) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bcn, 3));
      bg.setAttribute('aS', new THREE.Float32BufferAttribute(bcnS, 1));
      const bm = new THREE.ShaderMaterial({ uniforms: { ...U, uPx: { value: ctx.renderer.getPixelRatio() } }, vertexShader: BEACON_VS, fragmentShader: BEACON_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const pts = new THREE.Points(bg, bm); pts.name = 'city-beacons'; pts.renderOrder = 2; ctx.group.add(pts); beacons = bg.attributes.position;
    }
    const st = { buildings: kept, wallTris: wI.n / 3, roofTris: rI.n / 3, beacons: bcn.length / 3, badTri, towers: towers.length, greenRoofs: greenRoofs.length, buckets: BR.map((b, i) => (i ? (b.wi - BR[i - 1].wi + b.ri - BR[i - 1].ri) / 3 : 0)).slice(1) };
    // release the growable build buffers (the closures below would otherwise keep them alive)
    for (const b of [wP, wN, wF, wE, wB, wC, wI, rP, rN, rC, rR, rI]) b.a = null;

    // hide buildings after build (e.g. a landmark modelled by hand, or a fly-through camera path): degenerate their triangles
    const RB = Int32Array.from(rec.b), RW0 = Uint32Array.from(rec.w0), RW1 = Uint32Array.from(rec.w1), RR0 = Uint32Array.from(rec.r0), RR1 = Uint32Array.from(rec.r1), RXs = Float32Array.from(rec.x), RZs = Float32Array.from(rec.z), RBI = Int32Array.from(rec.bi), RC0 = Uint32Array.from(rec.c0), RC1 = Uint32Array.from(rec.c1);
    ctx.cityHide = function (x, z, rad, index) {
      let c = 0;
      for (let i = 0; i < RB.length; i++) {
        if (index != null ? RBI[i] !== index : Math.hypot(RXs[i] - x, RZs[i] - z) > rad) continue;
        const k = RB[i], [mw, mr] = meshes[k];
        if (mw) { const ia = mw.geometry.index; ia.array.fill(0, RW0[i] - BR[k].wi, RW1[i] - BR[k].wi); ia.needsUpdate = true; }
        if (mr) { const ia = mr.geometry.index; ia.array.fill(0, RR0[i] - BR[k].ri, RR1[i] - BR[k].ri); ia.needsUpdate = true; }
        if (beacons && RC1[i] > RC0[i]) { for (let j = RC0[i]; j < RC1[i]; j++) beacons.array[j * 3 + 1] = -1e4; beacons.needsUpdate = true; }
        c++;
      }
      return c;
    };
    KLC.city.towers = towers; KLC.city.greenRoofs = greenRoofs; KLC.city.stats = st;
    return { update() {} };
  }
  KLC.city = { build };
})();
