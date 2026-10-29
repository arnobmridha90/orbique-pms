/* Orbique PMS website: scroll reveals, the exploded view, hotspots and counters. No libraries.
   Everything is visible without this file (see boot.js); it only adds motion. Animations move transform and opacity only. */
(function () {
  'use strict';
  window.__orb = true;
  var doc = document, root = doc.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var hasIO = 'IntersectionObserver' in window;
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function easeInOut(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  /* ---------- 1. reveal on scroll (staggered among siblings) ---------- */
  var groups = new Map();
  $$('.rv').forEach(function (el) {
    var p = el.parentNode, n = groups.get(p) || 0;
    groups.set(p, n + 1);
    if (n) el.style.setProperty('--d', Math.min(n * 80, 480) + 'ms');
  });
  var watched = $$('.rv, .hero-visual, .mini-cal, .alerts, .wf, .phones');
  function show(el) { el.classList.add('in'); }
  if (reduced || !hasIO) watched.forEach(show);
  else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    watched.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 2. counters: count up fast from 0, once, when they come into view ---------- */
  var counters = $$('.ct');
  function runCounter(el) {
    var to = +el.getAttribute('data-to'), t0 = null, dur = 650 + Math.min(to, 60) * 6;
    function step(t) {
      if (t0 === null) t0 = t;
      var x = clamp((t - t0) / dur, 0, 1), v = 1 - Math.pow(2, -10 * x); /* ease out expo */
      el.textContent = x >= 1 ? String(to) : String(Math.round(to * v));
      if (x < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (!reduced && hasIO) {
    counters.forEach(function (el) { el.textContent = '0'; });
    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { runCounter(e.target); cio.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { cio.observe(el); });
  }

  /* ---------- 3. exploded view: a pinned scene whose layers separate in 2.5D as you scroll ---------- */
  var xv = doc.querySelector('.xv');
  if (xv) (function () {
    var body = xv.querySelector('.xv-body'), scene = xv.querySelector('.xv-scene'), stack = xv.querySelector('.xv-stack');
    var svg = xv.querySelector('.xv-lines'), NS = 'http://www.w3.org/2000/svg';
    var layers = $$('.xl', stack);
    /* the callouts are listed in on-screen order; each one belongs to the layer with the same number */
    var calls = layers.map(function (el) { return xv.querySelector('.xv-callouts li[data-n="' + el.getAttribute('data-n') + '"]'); });
    var anchors = layers.map(function (el) { return el.querySelector('.xl-a'); });
    /* per layer: lift (z), and how far it slides out in its own plane (x, y), in stack pixels */
    var MOVE_WIDE = { 1: [0, -60, -40], 2: [60, 0, 0], 3: [170, 30, 30], 4: [260, 70, 80], 5: [330, 150, 40], 6: [400, 60, 20] };
    var MOVE_NARROW = { 1: [0, -40, -20], 2: [50, 0, 0], 3: [150, 20, 20], 4: [240, 50, 60], 5: [300, 0, 20], 6: [380, 0, 0] };
    var MOVE = MOVE_WIDE;
    var linePath = doc.createElementNS(NS, 'path'), dotPath = doc.createElementNS(NS, 'path');
    linePath.setAttribute('class', 'xv-l'); dotPath.setAttribute('class', 'xv-d');
    svg.appendChild(linePath); svg.appendChild(dotPath);
    var k = 1, wide = false, active = false, queued = false, last = -1, callPos = [];
    function measure() {
      wide = window.innerWidth >= 1000;
      MOVE = wide ? MOVE_WIDE : MOVE_NARROW;
      if (wide) { scene.style.height = ''; k = Math.min(scene.clientWidth / 1240, scene.clientHeight / 820); }
      else {
        /* phones and tablets: size from the width alone and give the scene just the height the stack needs */
        k = Math.min(scene.clientWidth / 1120, (window.innerWidth - 8) / 1200, (window.innerHeight * 0.5) / 760);
        scene.style.height = Math.round(760 * k + 24) + 'px';
      }
      stack.style.setProperty('--ti', (0.85 / k).toFixed(3)); /* layer numbers stay about 22px on screen */
      /* callouts do not move inside the pinned frame: measure them once, relative to .xv-body */
      callPos = calls.map(function (li) {
        var x = 0, y = 0, el = li;
        while (el && el !== body) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
        return [x, y + li.offsetHeight / 2];
      });
    }
    function progress() {
      if (reduced) return 1;
      var r = xv.getBoundingClientRect(), span = xv.offsetHeight - window.innerHeight;
      return span > 0 ? clamp(-r.top / span, 0, 1) : 1;
    }
    function render(force) {
      queued = false;
      var p = progress();
      if (!force && Math.abs(p - last) < 0.0005) return;
      last = p;
      var e = easeInOut(clamp((p - 0.05) / 0.8, 0, 1));
      stack.style.transform = 'translate3d(' + (wide ? 0 : k * 30 * e).toFixed(1) + 'px,' + (k * (wide ? 30 : 60) * e).toFixed(1) + 'px,0) scale(' + (k * (wide ? 1 - 0.24 * e : 1 - 0.3 * e)).toFixed(4) + ') rotateX(' + (54 * e).toFixed(2) + 'deg) rotateZ(' + (-30 * e).toFixed(2) + 'deg)';
      layers.forEach(function (el, i) {
        var m = MOVE[i + 1];
        el.style.transform = 'translate3d(' + (m[1] * e).toFixed(1) + 'px,' + (m[2] * e).toFixed(1) + 'px,' + (m[0] * e).toFixed(1) + 'px)';
        var on = clamp((e - 0.12 - i * 0.1) * 5, 0, 1);
        el.querySelector('.xl-tag').style.opacity = on;
        el.querySelector('.xl-o').style.opacity = (on * 0.9).toFixed(3);
        if (calls[i]) calls[i].classList.toggle('on', on > 0.5 || reduced);
      });
      if (!wide) return;
      /* one layout read per frame (the anchors), then one path for all lines and one for all dots */
      var br = body.getBoundingClientRect(), dl = '', dd = '';
      anchors.forEach(function (a, i) {
        if (!calls[i] || !calls[i].classList.contains('on')) return;
        var r = a.getBoundingClientRect(), x1 = (r.left - br.left).toFixed(1), y1 = (r.top - br.top).toFixed(1);
        dl += 'M' + x1 + ' ' + y1 + 'L' + callPos[i][0] + ' ' + callPos[i][1].toFixed(1);
        dd += 'M' + (x1 - 3).toFixed(1) + ' ' + y1 + 'a3 3 0 1 0 6 0a3 3 0 1 0 -6 0';
      });
      linePath.setAttribute('d', dl || 'M0 0'); dotPath.setAttribute('d', dd || 'M0 0');
    }
    function onScroll() { if (active && !queued) { queued = true; requestAnimationFrame(function () { render(false); }); } }
    measure(); render(true);
    if (!reduced) {
      if (hasIO) new IntersectionObserver(function (es) { active = es[0].isIntersecting; if (active) onScroll(); }, { rootMargin: '100px 0px' }).observe(xv);
      else active = true;
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    window.addEventListener('resize', function () { measure(); render(true); });
  })();

  /* ---------- 4. hotspots: pulsing dots on real screens; a compact card pops up ---------- */
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
    $$('.hs-list li', fig).forEach(function (li) {
      var id = 'hs-' + (++hsId), dot = doc.createElement('button'), title = li.querySelector('b').textContent;
      li.id = id;
      dot.type = 'button'; dot.className = 'hs-dot';
      dot.setAttribute('aria-expanded', 'false'); dot.setAttribute('aria-controls', id);
      dot.innerHTML = '<span class="sr-only">' + title + '</span>';
      setDot(dot, li); dots.push([dot, li]);
      fig.insertBefore(dot, fig.querySelector('.hs-list'));
      dot.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (openDot === dot && dot._pinned) close(); else { open(dot); dot._pinned = true; }
      });
      /* on touch screens a tap on the open card closes it, so the dots under it can be reached */
      if (!canHover) li.addEventListener('click', function () { if (openDot === dot) close(); });
      if (canHover) {
        li.addEventListener('mouseenter', function () { if (openDot === dot) clearTimeout(hoverTimer); });
        li.addEventListener('mouseleave', function () { if (openDot === dot && !dot._pinned) hoverTimer = setTimeout(function () { if (openDot === dot && !dot._pinned) close(); }, 180); });
        dot.addEventListener('mouseenter', function () { clearTimeout(hoverTimer); hoverTimer = setTimeout(function () { open(dot); }, 40); });
        dot.addEventListener('mouseleave', function () { clearTimeout(hoverTimer); if (!dot._pinned) hoverTimer = setTimeout(function () { if (openDot === dot && !dot._pinned) close(); }, 180); });
      }
    });
  });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openDot) close(true); });
  doc.addEventListener('click', function (e) { if (openDot && !e.target.closest('.hs-list li')) close(); });
  function relayout() { dots.forEach(function (d) { setDot(d[0], d[1]); }); if (openDot) { if (openDot.hidden) close(); else place(openDot); } }
  if (phoneHs.addEventListener) phoneHs.addEventListener('change', relayout);
  window.addEventListener('resize', relayout);
})();
