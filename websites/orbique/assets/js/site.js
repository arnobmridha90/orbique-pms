/* Orbique PMS website: scroll reveals, the exploded view, hotspots and counters.
   Libraries (self-hosted in /assets/vendor, loaded with defer before this file): GSAP 3.15.0 with ScrollTrigger,
   SplitText and DrawSVGPlugin, and Lenis 1.3.27 (smooth wheel scrolling, desktop mouse only).
   Everything is visible without this file (see boot.js); it only adds motion. Animations move transform and opacity only.
   If GSAP did not load, or boot.js already gave up waiting, the page stays as it is without JavaScript.
   prefers-reduced-motion: every final state, no movement, no smooth scrolling. */
(function () {
  'use strict';
  window.__orb = true;
  var doc = document, root = doc.documentElement, gsap = window.gsap, ST = window.ScrollTrigger;
  if (!root.classList.contains('js')) return; /* boot.js timed out: keep the static page */
  if (!gsap || !ST) { root.classList.remove('js'); return; }
  var Split = window.SplitText, Draw = window.DrawSVGPlugin;
  gsap.registerPlugin.apply(gsap, [ST, Split, Draw].filter(Boolean));
  ST.config({ ignoreMobileResize: true });

  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function has(el, c) { return el.classList.contains(c); }

  /* end for play-and-rewind triggers: past the bottom of the page, so they stay "entered" all the way down and
     even a jump straight back to the top (Home key, a link) rewinds them */
  function END() { return ST.maxScroll(window) + 10; }
  var mm = gsap.matchMedia();
  var MOTION = '(prefers-reduced-motion: no-preference)', REDUCE = '(prefers-reduced-motion: reduce)';
  /* Setting up the animations is split into small tasks (what is on screen first), so no single long task blocks
     the page after it loads. add() queues a gsap.matchMedia().add(); a lower number runs sooner. */
  var queue = [];
  function add(query, fn, order) { queue.push({ o: order, f: function () { mm.add(query, fn); } }); }
  function runQueue() {
    queue.sort(function (a, b) { return a.o - b.o; });
    (function next() { var q = queue.shift(); if (!q) return; q.f(); if (queue.length) setTimeout(next, 0); })();
  }

  /* ---------- smooth wheel scrolling (Lenis), desktop mouse and trackpad only ---------- */
  /* Native scrolling stays for touch, keyboard, the skip link and in-page links. */
  if (window.Lenis) mm.add(MOTION + ' and (hover: hover) and (pointer: fine)', function () {
    var lenis = new window.Lenis({ lerp: 0.11, wheelMultiplier: 1, smoothWheel: true, syncTouch: false, autoRaf: false });
    function raf(t) { lenis.raf(t * 1000); }
    lenis.on('scroll', ST.update);
    /* an in-page link or the skip link always jumps natively, even while a wheel glide is still running */
    function onLink(e) { var a = e.target.closest && e.target.closest('a[href^="#"]'); if (a) lenis.scrollTo(window.scrollY, { immediate: true, force: true }); }
    doc.addEventListener('click', onLink, true);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    return function () { doc.removeEventListener('click', onLink, true); gsap.ticker.remove(raf); gsap.ticker.lagSmoothing(500, 33); lenis.destroy(); };
  });

  /* one more refresh after a heading is split again (fonts or a resize changed its lines), so the trigger
     positions below it match the page as it is now */
  var rT = 0;
  function refreshSoon() { clearTimeout(rT); rT = setTimeout(function () { ST.refresh(); }, 120); }

  /* ---------- 1. headings: lines rise out of a mask (SplitText) ---------- */
  /* each heading is split only when it comes within about a screen of the viewport, so the work is spread out */
  var heads = Split ? $$('.feat h2.rv, .end h2.rv, .xv-head h2') : [];
  if (heads.length) add(MOTION, function (ctx) {
    heads.forEach(function (h) {
      ST.create({ trigger: h, start: 'top bottom+=400', once: true, onEnter: function () { ctx.add(function () { splitHead(h); }); } });
    });
  }, 4);
  function splitHead(h) {
      Split.create(h, {
        type: 'lines', mask: 'lines', linesClass: 'sl', autoSplit: true,
        onSplit: function (self) {
          if (h._split) refreshSoon();
          h._split = true;
          gsap.set(h, { opacity: 1, y: 0 });
          return gsap.from(self.lines, {
            yPercent: 110, duration: 1.05, ease: 'expo.out', stagger: 0.09,
            scrollTrigger: { trigger: h, start: 'top 88%', end: END, toggleActions: 'play none none reverse' }
          });
        }
      });
  }

  /* ---------- 2. reveal on scroll: batched, staggered, and reversed when you scroll back up ---------- */
  var rv = $$('.rv').filter(function (el) { return heads.indexOf(el) < 0; });
  /* GSAP calls function values with (index, target) */
  function hiddenX(i, el) { return has(el, 'rv-l') ? -32 : 0; }
  function hiddenY(i, el) { return has(el, 'rv-s') || has(el, 'rv-l') ? 0 : 26; }
  function hiddenS(i, el) { return has(el, 'rv-s') ? 0.94 : 1; }
  add(MOTION, function () {
    ST.batch(rv, {
      start: 'top 90%', end: END,
      /* the stagger is capped, so a long jump never leaves blocks waiting their turn */
      onEnter: function (b) { gsap.to(b, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.9, ease: 'expo.out', stagger: Math.min(0.07, 0.42 / b.length), overwrite: true }); },
      onLeaveBack: function (b) { gsap.to(b, { opacity: 0, x: hiddenX, y: hiddenY, scale: hiddenS, duration: 0.3, ease: 'power2.in', overwrite: true }); }
    });
  }, 1);

  /* ---------- 3. hero: the copy drifts up and the screen eases closer as you scroll away (the entrance is pure CSS) ---------- */
  add(MOTION, function () {
    var hero = doc.querySelector('.hero');
    if (!hero) return;
    var st = { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.4 };
    gsap.to('.hero-in', { y: -56, opacity: 0.2, ease: 'none', scrollTrigger: st });
    gsap.fromTo('.hero-screen img', { scale: 1 }, { scale: 1.06, transformOrigin: '50% 0%', ease: 'none', scrollTrigger: st });
  }, 0);

  /* ---------- 4. counters: count up fast from 0 when they come into view, again after you scroll back up ---------- */
  var counters = $$('.ct');
  /* each counter keeps the width of its final number, so the text around it never moves while it counts */
  function fit() { /* all writes, then all reads, then all writes: one layout */
    var cur = counters.map(function (el) { var t = el.textContent; el.style.minWidth = ''; el.textContent = el.getAttribute('data-to'); return t; });
    var w = counters.map(function (el) { return el.getBoundingClientRect().width; });
    counters.forEach(function (el, i) { el.style.minWidth = w[i].toFixed(1) + 'px'; el.textContent = cur[i]; });
  }
  add(MOTION, function () {
    fit();
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fit);
    counters.forEach(function (el) {
      var to = +el.getAttribute('data-to'), o = { v: 0 }, tw = null;
      el.textContent = '0';
      ST.create({
        trigger: el, start: 'top 88%', end: END,
        onEnter: function () {
          if (tw) tw.kill();
          o.v = 0;
          tw = gsap.to(o, {
            v: to, duration: 0.8 + Math.min(to, 60) * 0.008, ease: 'expo.out',
            onUpdate: function () { el.textContent = String(Math.round(o.v)); },
            onComplete: function () { el.textContent = String(to); }
          });
        },
        onLeaveBack: function () { if (tw) tw.kill(); tw = null; el.textContent = '0'; }
      });
    });
    return function () { counters.forEach(function (el) { el.textContent = el.getAttribute('data-to'); el.style.minWidth = ''; }); };
  }, 2);

  /* ---------- 5. exploded view: pinned, scrubbed by scroll; the layers lift apart in 2.5D,
     then blueprint leader lines draw out to the callouts (DrawSVG). Scrolling back runs it in reverse. ---------- */
  var xv = doc.querySelector('.xv');
  if (xv) add({ motion: MOTION, reduce: REDUCE, wide: '(min-width: 1000px)' }, function (ctx) {
    var c = ctx.conditions, wide = c.wide;
    var body = xv.querySelector('.xv-body'), scene = xv.querySelector('.xv-scene');
    var stack = xv.querySelector('.xv-stack'), svg = xv.querySelector('.xv-lines'), NS = 'http://www.w3.org/2000/svg';
    var layers = $$('.xl', stack);
    /* the callouts are listed in on-screen order; each one belongs to the layer with the same number */
    var calls = layers.map(function (el) { return xv.querySelector('.xv-callouts li[data-n="' + el.getAttribute('data-n') + '"]'); });
    var anchors = layers.map(function (el) { return el.querySelector('.xl-a'); });
    /* per layer: lift (z), and how far it slides out in its own plane (x, y), in stack pixels */
    var MOVE = wide
      ? { 1: [0, -60, -40], 2: [60, 0, 0], 3: [170, 30, 30], 4: [260, 70, 80], 5: [330, 150, 40], 6: [400, 60, 20] }
      : { 1: [0, -40, -20], 2: [50, 0, 0], 3: [150, 20, 20], 4: [240, 50, 60], 5: [300, 0, 20], 6: [380, 0, 0] };
    var k = 1, s = { e: 0 };

    function measure() {
      if (wide) { scene.style.height = ''; k = Math.min(scene.clientWidth / 1240, scene.clientHeight / 820); }
      else {
        /* phones and tablets: size from the width alone and give the scene just the height the stack needs */
        k = Math.min(scene.clientWidth / 1120, (window.innerWidth - 8) / 1200, (window.innerHeight * 0.5) / 760);
        scene.style.height = Math.round(760 * k + 24) + 'px';
      }
      stack.style.setProperty('--ti', (0.85 / k).toFixed(3)); /* layer numbers stay about 22px on screen */
    }
    function renderStack() {
      var e = s.e;
      stack.style.transform = 'translate3d(' + (wide ? 0 : k * 30 * e).toFixed(1) + 'px,' + (k * (wide ? 30 : 60) * e).toFixed(1) + 'px,0) scale(' + (k * (wide ? 1 - 0.24 * e : 1 - 0.3 * e)).toFixed(4) + ') rotateX(' + (54 * e).toFixed(2) + 'deg) rotateZ(' + (-30 * e).toFixed(2) + 'deg)';
    }
    measure();

    var tl = gsap.timeline({ paused: !!c.reduce, defaults: { ease: 'none' } });
    /* the stack tilts back while the layers lift off one after another */
    tl.to(s, { e: 1, duration: 0.7, ease: 'power3.inOut', onUpdate: renderStack }, 0.04);
    layers.forEach(function (el, i) {
      var m = MOVE[i + 1];
      tl.fromTo(el, { x: 0, y: 0, z: 0 }, { x: m[1], y: m[2], z: m[0], duration: 0.58, ease: 'power3.inOut', force3D: true }, 0.04 + i * 0.03);
      tl.fromTo(el.querySelectorAll('.xl-tag'), { opacity: 0 }, { opacity: 1, duration: 0.1 }, 0.16 + i * 0.075);
      tl.fromTo(el.querySelectorAll('.xl-o'), { opacity: 0 }, { opacity: 0.9, duration: 0.1 }, 0.16 + i * 0.075);
      /* the callout lights up with its layer; on phones fully (no leader lines), on desktop part way, and its line finishes it */
      if (calls[i]) tl.fromTo(calls[i], { opacity: 0.25, x: 12 }, wide ? { opacity: 0.6, x: 6, duration: 0.12, ease: 'power2.out' } : { opacity: 1, x: 0, duration: 0.12, ease: 'power2.out' }, 0.18 + i * 0.075);
    });

    /* desktop: leader lines drawn once the layers have settled; their geometry is measured at the final state */
    var lines = [], lineTweens = [];
    if (wide) {
      svg.textContent = '';
      layers.forEach(function (el, i) {
        if (!calls[i]) return;
        var p = doc.createElementNS(NS, 'path'), d = doc.createElementNS(NS, 'circle');
        p.setAttribute('class', 'xv-l'); d.setAttribute('class', 'xv-d'); d.setAttribute('r', '3.5');
        svg.appendChild(p); svg.appendChild(d);
        lines.push({ i: i, p: p, d: d });
      });
    }
    /* measuring the lines needs the timeline at its end state once, so it waits until the section is about a screen away */
    var near = false;
    function layoutLines() {
      if (!lines.length || !near) return;
      var t = tl.time();
      tl.progress(1);
      var br = body.getBoundingClientRect();
      lines.forEach(function (L) {
        var a = anchors[L.i].getBoundingClientRect(), li = calls[L.i], x = 0, y = 0, el = li;
        while (el && el !== body) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
        var ax = a.left - br.left, ay = a.top - br.top, cy = y + li.offsetHeight / 2;
        L.p.setAttribute('d', 'M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + 'L' + (x - 26).toFixed(1) + ' ' + cy.toFixed(1) + 'L' + x.toFixed(1) + ' ' + cy.toFixed(1));
        L.d.setAttribute('cx', ax.toFixed(1)); L.d.setAttribute('cy', ay.toFixed(1));
      });
      lineTweens.forEach(function (tw) { tw.invalidate(); });
      tl.time(0).time(t); /* rendering through them again re-measures the invalidated paths */
    }
    if (wide) {
      /* each line starts as its layer settles, so something is always moving while the scene is held */
      lines.forEach(function (L, j) {
        var at = 0.62 + j * 0.05;
        tl.fromTo(L.d, { opacity: 0, scale: 0, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.04, ease: 'back.out(3)' }, at);
        var draw = Draw
          ? gsap.fromTo(L.p, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.12, ease: 'power2.inOut' })
          : gsap.fromTo(L.p, { opacity: 0 }, { opacity: 1, duration: 0.12 });
        tl.add(draw, at);
        lineTweens.push(draw);
        tl.to(calls[L.i], { opacity: 1, x: 0, duration: 0.08, ease: 'power2.out' }, at + 0.08);
      });
    }
    tl.to({}, { duration: 0.06 }); /* a short hold at the end before the scene scrolls away */

    if (c.reduce) { near = true; layoutLines(); tl.progress(1); return; }
    /* (in a task of its own, so it does not add to the setup task) */
    var dead = false;
    if (wide) ST.create({ trigger: xv, start: function () { return 'top bottom+=' + window.innerHeight; }, once: true, onEnter: function () { setTimeout(function () { if (!dead) { near = true; layoutLines(); } }, 0); } });
    ST.create({
      animation: tl, trigger: xv, start: 'top top', end: 'bottom bottom',
      scrub: canHover ? 0.35 : 0.6,
      /* the scene is held by the CSS sticky pin at every width (no GSAP pin): no layout shift, and a reload
         mid-section comes back to the same place */
      onRefreshInit: function () { measure(); }
    });
    function onRefresh() { renderStack(); layoutLines(); }
    ST.addEventListener('refresh', onRefresh);
    return function () { dead = true; ST.removeEventListener('refresh', onRefresh); svg.textContent = ''; stack.style.transform = ''; scene.style.height = ''; };
  }, 1.5);

  /* ---------- 6. small scenes that play in when they come into view and rewind when you scroll back up ---------- */
  add(MOTION, function () {
    function onView(el, tl, start, extra) {
      var o = { trigger: el, start: start || 'top 78%', end: END, toggleActions: 'play none none reverse', animation: tl };
      for (var key in extra) o[key] = extra[key];
      ST.create(o);
    }
    /* calendar: booking bars slide in from their check-in night, site by site */
    var cal = doc.querySelector('.mini-cal');
    if (cal) {
      var order = ['mc-a', 'mc-c', 'mc-e', 'mc-g', 'mc-h', 'mc-d', 'mc-f', 'mc-b', 'mc-i'].map(function (c) { return cal.querySelector('.' + c); }).filter(Boolean);
      var tc = gsap.timeline({ paused: true });
      tc.fromTo(order, { scaleX: 0, opacity: 0 }, { scaleX: 1, duration: 0.8, ease: 'expo.out', stagger: 0.08 }, 0)
        .to(order, { opacity: 1, duration: 0.2, stagger: 0.08 }, 0);
      onView(cal, tc);
    }
    /* booking alerts: three notes drop in, the bell rings (CSS keyframes on .in) */
    var al = doc.querySelector('.alerts');
    if (al) {
      var ta = gsap.timeline({ paused: true });
      ta.fromTo('.alerts .note', { opacity: 0, y: -26, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'back.out(1.6)', stagger: 0.25 }, 0.35);
      onView(al, ta, 'top 75%', { onEnter: function () { al.classList.add('in'); }, onLeaveBack: function () { al.classList.remove('in'); } });
    }
    /* pricing: the waterfall builds factor by factor to the suggested price */
    var wf = doc.querySelector('.wf');
    if (wf) {
      var bars = $$('.wf-b', wf), ems = $$('.wf-col em', wf), tw = gsap.timeline({ paused: true });
      var BAR = [0, 0.35, 0.55, 0.75, 0.95, 1.15, 1.4], EM = [0.1, 0.45, 0.65, 0.85, 1.05, 1.25, 1.9];
      bars.forEach(function (b, i) { tw.fromTo(b, { scaleY: 0 }, { scaleY: 1, duration: i === 6 ? 0.8 : 0.5, ease: i === 6 ? 'expo.out' : 'power3.out' }, BAR[i]); });
      ems.forEach(function (e, i) { tw.fromTo(e, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, EM[i]); });
      onView(wf, tw);
    }
    /* phones: the two screens rise at different speeds, tied to the scroll */
    var ph = doc.querySelector('.phones');
    if (ph) {
      var p1 = ph.querySelector('.p1'), p2 = ph.querySelector('.p2');
      gsap.fromTo(p1, { opacity: 0, y: 80, rotation: -3 }, { opacity: 1, y: 0, rotation: 0, ease: 'power2.out', scrollTrigger: { trigger: ph, start: 'top bottom', end: 'center 62%', scrub: 0.6 } });
      gsap.fromTo(p2, { opacity: 0, y: 140, rotation: 3 }, { opacity: 1, y: 0, rotation: 0, ease: 'power2.out', scrollTrigger: { trigger: ph, start: 'top bottom', end: 'center 50%', scrub: 0.6 } });
    }
    /* scroll progress bar and picture drift, where the browser has no CSS scroll-driven animations */
    if (!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'))) {
      var bar = doc.querySelector('.progress');
      if (bar) { gsap.set(bar, { display: 'block' }); gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.2 } }); }
      $$('.shot img, .op img').forEach(function (img) {
        gsap.fromTo(img, { scale: 1.08, y: 12 }, { scale: 1, y: 0, ease: 'none', scrollTrigger: { trigger: img, start: 'top bottom', end: 'center center', scrub: true } });
      });
    }
  }, 3);

  /* ---------- 7. hotspots: pulsing dots on real screens; a compact card pops up ---------- */
  var openDot = null, hoverTimer = 0, hsId = 0, dots = [];
  var phoneHs = window.matchMedia('(max-width: 699px)'); /* matches the <picture> source for the inbox */
  function setDot(dot, li) {
    var mx = li.getAttribute('data-mx'), useM = phoneHs.matches && li.closest('.hs-desk');
    if (useM && mx === null) { dot.hidden = true; return; }
    dot.hidden = false;
    dot.style.left = (useM ? mx : li.getAttribute('data-x')) + '%';
    dot.style.top = (useM ? li.getAttribute('data-my') : li.getAttribute('data-y')) + '%';
  }
  function cardOf(dot) { return doc.getElementById(dot.getAttribute('aria-controls')); }
  function place(dot) {
    var card = cardOf(dot), fig = dot.parentNode, fr = fig.getBoundingClientRect();
    var x = parseFloat(dot.style.left) / 100 * fr.width, y = parseFloat(dot.style.top) / 100 * fr.height;
    var cw = card.offsetWidth, ch = card.offsetHeight, vw = doc.documentElement.clientWidth, vh = window.innerHeight, gap = 24, left, top;
    if (vw >= 700 && fr.width > 500) {
      left = x + gap; top = y - ch / 2;
      if (fr.left + left + cw > vw - 12 || left + cw > fr.width + 40) left = x - gap - cw;
    } else {
      left = x - cw / 2; top = y + gap;
      if (top + ch > fr.height + 30) top = y - gap - ch;
    }
    left = clamp(left, 12 - fr.left, vw - 12 - fr.left - cw); /* stays on screen */
    top = clamp(top, -20, Math.max(-20, fr.height - ch + 20));
    /* keep the card clear of the sticky header (60px) and the bottom of the screen; flip to the other side if needed */
    if (fr.top + top < 72) top = (vw >= 700 && fr.width > 500) ? 72 - fr.top : y + gap;
    if (fr.top + top + ch > vh - 12) { var up = y - gap - ch; top = fr.top + up >= 72 ? up : vh - 12 - ch - fr.top; }
    card.style.left = left.toFixed(0) + 'px'; card.style.top = top.toFixed(0) + 'px';
    card.style.transformOrigin = clamp(x - left, 0, cw).toFixed(0) + 'px ' + clamp(y - top, 0, ch).toFixed(0) + 'px';
  }
  function open(dot) {
    if (openDot === dot) return;
    close();
    openDot = dot; dot.setAttribute('aria-expanded', 'true');
    var card = cardOf(dot); place(dot); card.classList.add('open');
  }
  function close(refocus) {
    if (!openDot) return;
    var d = openDot; openDot = null; d.setAttribute('aria-expanded', 'false'); d._pinned = false; cardOf(d).classList.remove('open');
    if (refocus) d.focus();
  }
  $$('[data-hs]').forEach(function (fig) {
    var figDots = [];
    $$('.hs-list li', fig).forEach(function (li) {
      var id = 'hs-' + (++hsId), dot = doc.createElement('button'), label = doc.createElement('span');
      li.id = id;
      dot.type = 'button'; dot.className = 'hs-dot';
      dot.setAttribute('aria-expanded', 'false'); dot.setAttribute('aria-controls', id);
      label.className = 'sr-only'; label.textContent = li.querySelector('b').textContent; dot.appendChild(label);
      setDot(dot, li); dots.push([dot, li]); figDots.push(dot);
      fig.insertBefore(dot, fig.querySelector('.hs-list'));
      dot.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (openDot === dot && dot._pinned) close(); else { open(dot); dot._pinned = true; }
      });
      /* a keyboard user never waits for the pop-in */
      dot.addEventListener('focus', function () { gsap.set(dot, { scale: 1, opacity: 1 }); });
      /* on touch screens a tap on the open card closes it, so the dots under it can be reached */
      if (!canHover) li.addEventListener('click', function () { if (openDot === dot) close(); });
      if (canHover) {
        li.addEventListener('mouseenter', function () { if (openDot === dot) clearTimeout(hoverTimer); });
        li.addEventListener('mouseleave', function () { if (openDot === dot && !dot._pinned) hoverTimer = setTimeout(function () { if (openDot === dot && !dot._pinned) close(); }, 180); });
        dot.addEventListener('mouseenter', function () { clearTimeout(hoverTimer); hoverTimer = setTimeout(function () { open(dot); }, 40); });
        dot.addEventListener('mouseleave', function () { clearTimeout(hoverTimer); if (!dot._pinned) hoverTimer = setTimeout(function () { if (openDot === dot && !dot._pinned) close(); }, 180); });
      }
    });
    /* the dots pop onto the screen one by one the first time it comes into view */
    add(MOTION, function () {
      gsap.set(figDots, { scale: 0, opacity: 0 });
      ST.create({ trigger: fig, start: 'top 72%', once: true, onEnter: function () {
        gsap.to(figDots, { scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(2.4)', stagger: 0.07, delay: 0.25 });
      } });
    }, 3.5);
  });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openDot) close(true); });
  doc.addEventListener('click', function (e) { if (openDot && !e.target.closest('.hs-list li')) close(); });
  function relayout() { dots.forEach(function (d) { setDot(d[0], d[1]); }); if (openDot) { if (openDot.hidden) close(); else place(openDot); } }
  if (phoneHs.addEventListener) phoneHs.addEventListener('change', relayout);
  window.addEventListener('resize', relayout);
  runQueue();
})();
