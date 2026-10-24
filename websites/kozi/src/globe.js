/* The turning globe on staykozi.com: dots on a sphere, Kuala Lumpur pinned, arcs flying in. */
(function(){
  var $=function(s,c){return (c||document).querySelector(s)};
  if(!$('#globe'))return;
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* ---------- globe ---------- */
  var cv=$('#globe'),ctx=cv.getContext('2d'),label=$('#pinlabel'),gw=$('#gw');
  var R=Math.PI/180, KL={lat:3.14*R,lon:101.69*R};
  // places guests fly in from; drawn as arcs only, no figures
  var FROM=[[1.35,103.82],[-6.2,106.85],[-33.87,151.21],[25.2,55.27],[51.5,-0.12],[37.57,126.98],[22.32,114.17],[28.61,77.21]].map(function(p){return {lat:p[0]*R,lon:p[1]*R}});
  var N=1400,pts=[],ga=Math.PI*(3-Math.sqrt(5));
  for(var i=0;i<N;i++){var y=1-(i/(N-1))*2,lon=ga*i;pts.push({lat:Math.asin(y),lon:lon})}
  var W=0,H=0,dpr=1,tilt=-.32,spin=0,t0=performance.now(),zoom=1;
  function size(){dpr=Math.min(2,window.devicePixelRatio||1);W=cv.clientWidth;H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}
  function proj(p,lon0){var cl=Math.cos(p.lat),x=cl*Math.sin(p.lon-lon0),y=Math.sin(p.lat),z=cl*Math.cos(p.lon-lon0);
    var y2=y*Math.cos(tilt)-z*Math.sin(tilt),z2=y*Math.sin(tilt)+z*Math.cos(tilt);return {x:x,y:-y2,z:z2}}
  function slerp(a,b,f){var A=[Math.cos(a.lat)*Math.cos(a.lon),Math.cos(a.lat)*Math.sin(a.lon),Math.sin(a.lat)],B=[Math.cos(b.lat)*Math.cos(b.lon),Math.cos(b.lat)*Math.sin(b.lon),Math.sin(b.lat)];
    var d=Math.acos(Math.min(1,A[0]*B[0]+A[1]*B[1]+A[2]*B[2]))||1e-6,s1=Math.sin((1-f)*d)/Math.sin(d),s2=Math.sin(f*d)/Math.sin(d);
    var v=[A[0]*s1+B[0]*s2,A[1]*s1+B[1]*s2,A[2]*s1+B[2]*s2];return {lat:Math.asin(v[2]),lon:Math.atan2(v[1],v[0]),d:d}}
  function draw(now){
    var t=(now-t0)/1000, lon0=KL.lon+Math.sin(t*.12)*.75+spin, r=Math.min(W,H)*.42*zoom, cx=W/2, cy=H/2;
    ctx.clearRect(0,0,W,H);
    // sphere body
    var g=ctx.createRadialGradient(cx-r*.35,cy-r*.4,r*.1,cx,cy,r);g.addColorStop(0,'#FBF7F0');g.addColorStop(1,'#EADFCD');
    ctx.beginPath();ctx.arc(cx,cy,r,0,7);ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='rgba(43,38,34,.18)';ctx.lineWidth=1;ctx.stroke();
    // dots
    for(var i=0;i<N;i++){var p=proj(pts[i],lon0);if(p.z<=0)continue;ctx.globalAlpha=.15+.6*p.z;ctx.fillStyle='#2B2622';ctx.beginPath();ctx.arc(cx+p.x*r,cy+p.y*r,.6+1.1*p.z,0,7);ctx.fill()}
    ctx.globalAlpha=1;
    // arcs flying in to Kuala Lumpur
    FROM.forEach(function(f,k){var ph=((t*.22+k/FROM.length)%1),seg=28;ctx.beginPath();var started=false;
      for(var s=0;s<=seg;s++){var fr=s/seg;if(fr>ph)break;var q=slerp(f,KL,fr),lift=1+Math.sin(fr*Math.PI)*.18*Math.min(1,q.d),pp=proj(q,lon0);
        if(pp.z<-.05){started=false;continue}var X=cx+pp.x*r*lift,Y=cy+pp.y*r*lift;if(!started){ctx.moveTo(X,Y);started=true}else ctx.lineTo(X,Y)}
      ctx.strokeStyle='rgba(200,134,46,'+(0.85*(1-Math.pow(ph,6)))+')';ctx.lineWidth=1.6;ctx.stroke();
      var o=proj(f,lon0);if(o.z>0){ctx.fillStyle='rgba(43,38,34,.55)';ctx.beginPath();ctx.arc(cx+o.x*r,cy+o.y*r,2.2,0,7);ctx.fill()}});
    // Kuala Lumpur pin with pulse
    var k=proj(KL,lon0);
    if(k.z>0){var X=cx+k.x*r,Y=cy+k.y*r;for(var j=0;j<3;j++){var pr=((t*.6+j/3)%1);ctx.beginPath();ctx.arc(X,Y,6+pr*34,0,7);ctx.strokeStyle='rgba(200,134,46,'+(1-pr)*.7+')';ctx.lineWidth=1.5;ctx.stroke()}
      ctx.beginPath();ctx.arc(X,Y,7,0,7);ctx.fillStyle='#C8862E';ctx.fill();ctx.beginPath();ctx.arc(X,Y,2.6,0,7);ctx.fillStyle='#FBF7F0';ctx.fill();
      label.style.opacity=1;label.style.transform='translate('+(X+14)+'px,'+(Y-0)+'px) translateY(-50%)';}
    else label.style.opacity=0;
  }
  size();window.addEventListener('resize',size);
  if(reduce){draw(t0)}else{(function loop(n){draw(n);requestAnimationFrame(loop)})(t0)}

  if(window.gsap&&!reduce&&window.ScrollTrigger){
    gsap.registerPlugin(ScrollTrigger);
    var gs={v:0};
    gsap.to(gs,{v:1,ease:'none',scrollTrigger:{trigger:'.ghero',start:'top top',end:'bottom top',scrub:.4},onUpdate:function(){spin=gs.v*2.2;zoom=1+gs.v*.25}});
  }
})();
