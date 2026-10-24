/* Kozi websites: booking form, lightbox and motion. Every block checks that its elements exist,
   so one file serves the global home, the country homes and the inner pages. */
(function () {
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var WA = document.documentElement.getAttribute('data-wa') || '';

  /* ---------- availability -> WhatsApp ---------- */
  var form = $('#check');
  if (form) {
    var ci = $('#ci'), co = $('#co'), gs = $('#gs'), st = $('#st'), wa = $('#wa'), msg = $('#msg');
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var iso = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    ci.min = iso(today); co.min = iso(new Date(today.getTime() + 864e5));
    var nice = function (v) { return new Date(v + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
    var building = form.getAttribute('data-building') || 'Kozi';
    var build = function () {
      var a = ci.value, b = co.value, n = +gs.value, s = st ? st.value : 'any', ok = true, note;
      if (a) { var nx = new Date(a + 'T00:00:00'); nx.setDate(nx.getDate() + 1); co.min = iso(nx); }
      var text = 'Hi Kozi, I would like to check availability at ' + building;
      if (a && b) {
        var nights = Math.round((new Date(b) - new Date(a)) / 864e5);
        if (nights < 1) { ok = false; note = 'Check-out needs to be after check-in.'; }
        else {
          text += ' for ' + nice(a) + ' to ' + nice(b) + ' (' + nights + ' night' + (nights > 1 ? 's' : '') + ')';
          note = nights + ' night' + (nights > 1 ? 's' : '') + ', ' + n + ' guest' + (n > 1 ? 's' : '') + (s === 'any' ? '' : ', ' + s) + '. Tap the button to open WhatsApp.';
        }
      } else note = 'Pick your dates and we’ll open WhatsApp with your message ready to send.';
      text += ', ' + n + ' guest' + (n > 1 ? 's' : '') + (n === 5 ? ' (one on the extra bed)' : '') + (s === 'any' ? '' : ', ' + s + ' suite') + '. Thank you!';
      wa.href = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(text);
      msg.className = 'msg' + (ok ? '' : ' err');
      msg.textContent = ''; var sp = document.createElement(a && b ? 'b' : 'span'); sp.textContent = note; msg.appendChild(sp);
      return ok;
    };
    [ci, co, gs, st].forEach(function (el) { if (el) { el.addEventListener('input', build); el.addEventListener('change', build); } });
    wa.addEventListener('click', function (e) { if (!build()) e.preventDefault(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    build();
    $$('[data-suite]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (st) st.value = b.getAttribute('data-suite'); build();
        window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
        setTimeout(function () { ci.focus({ preventScroll: true }); }, 700);
      });
    });
  }

  /* ---------- lightbox ---------- */
  var lb = $('#lb'), lbimg = $('#lbimg');
  if (lb) {
    $$('[data-zoom] figure').forEach(function (f) {
      f.addEventListener('click', function () {
        var i = $('img', f); lbimg.src = i.getAttribute('data-full') || i.currentSrc || i.src; lbimg.alt = i.alt; lb.hidden = false;
        if (window.gsap) gsap.fromTo(lbimg, { scale: .9, opacity: 0 }, { scale: 1, opacity: 1, duration: .5, ease: 'power3.out' });
      });
    });
    var closeLb = function () { lb.hidden = true; };
    $('#lbx').addEventListener('click', closeLb);
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLb(); });
  }

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var intro = $('#intro');
  if (!window.gsap || reduce) { if (intro) intro.remove(); return; }
  gsap.registerPlugin(ScrollTrigger);
  var fine = window.matchMedia('(pointer:fine)').matches;

  /* ---------- split headings into words ---------- */
  $$('.split').forEach(function (h) {
    var walk = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(function (t) {
            if (!t) return;
            if (/^\s+$/.test(t)) { frag.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span'); w.className = 'w';
            var i = document.createElement('span'); i.textContent = t; w.appendChild(i); frag.appendChild(w);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1 && !c.classList.contains('w')) walk(c);
      });
    };
    walk(h);
  });

  /* ---------- hero entrance (after the intro on home pages) ---------- */
  var heroTl = gsap.timeline({ paused: true });
  heroTl.from('.hero h1 .w>span, .phero h1 .w>span', { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: .06 })
    .from('.hero-in:not(#gw)', { y: 28, opacity: 0, duration: .9, ease: 'power3.out', stagger: .1 }, '-=.8')
    .from('.top .wrap', { y: -30, opacity: 0, duration: .8, ease: 'power3.out' }, .3);
  if ($('#shot')) heroTl.from('#shot', { clipPath: 'inset(100% 0 0 0 round 220px 220px 18px 18px)', duration: 1.4, ease: 'expo.inOut' }, 0)
    .from('#shot img', { scale: 1.35, duration: 2.2, ease: 'expo.out' }, .1);
  if ($('#badge')) heroTl.from('#badge', { x: -40, opacity: 0, duration: .9, ease: 'back.out(1.6)' }, .9);
  if ($('#spin')) heroTl.from('#spin', { scale: 0, rotate: -120, duration: 1, ease: 'back.out(1.4)' }, 1);
  if ($('.cross.v')) heroTl.from('.cross.v', { scaleY: 0, transformOrigin: '50% 0', duration: 1.6, ease: 'expo.inOut' }, 0)
    .from('.cross.h', { scaleX: 0, transformOrigin: '0 50%', duration: 1.6, ease: 'expo.inOut' }, .1);
  if ($('#sun')) heroTl.from('#sun', { yPercent: 30, opacity: 0, duration: 2.4, ease: 'power2.out' }, 0);
  if ($('#gw')) heroTl.from('#gw', { scale: .6, rotate: -20, opacity: 0, duration: 1.8, ease: 'expo.out' }, .1);
  if ($('.phero .ph')) heroTl.from('.phero .ph', { clipPath: 'inset(0 0 100% 0 round 22px)', duration: 1.3, ease: 'expo.inOut' }, 0)
    .from('.phero .ph img', { scale: 1.3, duration: 2, ease: 'expo.out' }, .1);

  /* the logo builds itself and the sun rises in the O; shown once per visit */
  var seen = false; try { seen = sessionStorage.getItem('kozi-intro') === '1'; } catch (e) {}
  if (!intro || seen) { if (intro) intro.remove(); heroTl.play(); }
  else {
    var L = '.intro .logo ';
    var it = gsap.timeline({ onComplete: function () { intro.remove(); try { sessionStorage.setItem('kozi-intro', '1'); } catch (e) {} } });
    it.set(L + '.lg-clip', { attr: { y: 302, height: 0 } })
      .from(L + '.lg-v', { scaleY: 0, transformOrigin: '50% 50%', duration: .9, ease: 'expo.inOut' })
      .from(L + '.lg-h', { scaleX: 0, transformOrigin: '50% 50%', duration: .9, ease: 'expo.inOut' }, '<.1')
      .from([L + '.lg-k', L + '.lg-z', L + '.lg-i'], { opacity: 0, y: 40, duration: .7, ease: 'power3.out', stagger: .12 }, '-=.35')
      .from(L + '.lg-bar', { scaleX: 0, transformOrigin: '50% 50%', duration: .5, ease: 'power2.out' }, '-=.3')
      .to(L + '.lg-clip', { attr: { y: -4, height: 306 }, duration: 1.1, ease: 'power2.inOut' }, '-=.1')
      .to('.intro .logo', { scale: .92, duration: .5, ease: 'power2.in' }, '+=.25')
      .to('.intro .panel', { yPercent: -100, duration: .8, ease: 'expo.inOut' }, '-=.2')
      .to(intro, { yPercent: -100, duration: .9, ease: 'expo.inOut' }, '-=.35')
      .add(function () { heroTl.play(); }, '-=.6');
    $('#skip').addEventListener('click', function () { it.progress(1); });
  }
  var hb = $('.top .brand');
  if (hb) hb.addEventListener('mouseenter', function () { gsap.fromTo('.top .lg-clip', { attr: { y: 302, height: 0 } }, { attr: { y: -4, height: 306 }, duration: .9, ease: 'power2.inOut' }); });

  /* ambient */
  if ($('#shot')) {
    gsap.to('#shot img', { scale: 1.08, xPercent: -2, duration: 14, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 2.4 });
    gsap.to('#shot', { yPercent: -8, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  }
  if ($('#spin')) gsap.to('#spin text', { rotate: 360, transformOrigin: '60px 60px', duration: 22, ease: 'none', repeat: -1 });
  if ($('#sun')) gsap.to('#sun', { x: '6vw', y: '-4vh', duration: 9, ease: 'sine.inOut', yoyo: true, repeat: -1 });

  /* progress bar + header that hides on the way down */
  gsap.to('#progress', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: .2 } });
  var top = $('#top'), lastY = 0;
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: function (s) { var y = s.scroll(); top.classList.toggle('solid', y > 40); top.classList.toggle('hide', y > lastY && y > 400); lastY = y; } });

  /* marquee that speeds up and skews with scroll speed */
  var mq = $('#mq');
  if (mq) {
    var half = 0, x = 0, boost = 0;
    var measure = function () { half = mq.children[0].offsetWidth; }; measure(); window.addEventListener('resize', measure);
    ScrollTrigger.create({ start: 0, end: 'max', onUpdate: function (s) { boost = gsap.utils.clamp(-14, 14, s.getVelocity() / 220); } });
    gsap.ticker.add(function () { x -= (1.1 + Math.abs(boost)); boost *= .92; if (x <= -half) x += half; gsap.set(mq, { x: x, skewX: -boost * .8 }); });
  }

  /* reveals */
  $$('.split').forEach(function (h) { if (h.closest('.hero') || h.closest('.phero')) return;
    gsap.from($$('.w>span', h), { yPercent: 110, duration: 1, ease: 'expo.out', stagger: .05, scrollTrigger: { trigger: h, start: 'top 86%' } }); });
  $$('.lede, .reveal').forEach(function (e) { if (e.closest('.hero') || e.closest('.phero')) return;
    gsap.from(e, { opacity: 0, y: 24, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: e, start: 'top 88%' } }); });

  /* cities: the city name slides past */
  if ($('.cityname')) {
    gsap.fromTo('.cityname', { xPercent: 4 }, { xPercent: -38, ease: 'none', scrollTrigger: { trigger: '.cities', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from('.bldg .ph', { clipPath: 'inset(0 100% 0 0 round 20px)', duration: 1.4, ease: 'expo.inOut', scrollTrigger: { trigger: '.bldg', start: 'top 85%' } });
  }

  /* day to night: pinned sideways story, the sun crosses the arc, the page darkens */
  var frames = $$('.frame');
  if (frames.length) {
    var clock = $('#clock'), phase = $('#phase');
    var setTime = function (i) { var f = frames[i]; if (!f || clock.textContent === f.dataset.t) return; clock.textContent = f.dataset.t; phase.textContent = f.dataset.p; gsap.fromTo([clock, phase], { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: .4, ease: 'power2.out' }); };
    var mm = gsap.matchMedia();
    mm.add('(min-width: 761px)', function () {
      var track = $('#track'), path = $('#arcp'), len = path.getTotalLength(), orb = $('#orb'), glow = $('#glow');
      var dist = function () { return track.scrollWidth - window.innerWidth; };
      var tl = gsap.timeline({ scrollTrigger: { trigger: '#pin', start: 'top top', end: function () { return '+=' + dist() * 1.1; }, pin: true, scrub: .6, invalidateOnRefresh: true,
        onUpdate: function (s) { var p = s.progress, pt = path.getPointAtLength(len * p);
          orb.setAttribute('cx', pt.x); orb.setAttribute('cy', pt.y); glow.setAttribute('cx', pt.x); glow.setAttribute('cy', pt.y);
          setTime(Math.min(frames.length - 1, Math.floor(p * frames.length))); } } });
      tl.to(track, { x: function () { return -dist(); }, ease: 'none' }, 0)
        .to('.day', { backgroundColor: '#1B1815', color: '#F6EFE4', ease: 'power1.in' }, 0)
        .to('.day .frame figcaption span', { color: '#B9AE9F', ease: 'none' }, 0);
      frames.forEach(function (f) { gsap.to($('img', f), { scale: 1, ease: 'none', scrollTrigger: { trigger: f, containerAnimation: tl, start: 'left right', end: 'right left', scrub: true } }); });
      return function () { gsap.set('.day', { clearProps: 'backgroundColor,color' }); };
    });
    mm.add('(max-width: 760px)', function () {
      frames.forEach(function (f, i) {
        gsap.from(f, { opacity: 0, y: 50, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: f, start: 'top 88%', onEnter: function () { setTime(i); }, onEnterBack: function () { setTime(i); } } });
        gsap.to($('img', f), { scale: 1, ease: 'none', scrollTrigger: { trigger: f, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    });
  }

  /* cards rise; on a mouse they tilt toward the pointer */
  if ($('.cards')) gsap.from('.card', { y: 90, opacity: 0, rotateX: 8, duration: 1.1, ease: 'expo.out', stagger: .14, scrollTrigger: { trigger: '.cards', start: 'top 82%' } });
  if (fine) $$('.tilt').forEach(function (c) {
    var rx = gsap.quickTo(c, 'rotationX', { duration: .6, ease: 'power3' }), ry = gsap.quickTo(c, 'rotationY', { duration: .6, ease: 'power3' });
    gsap.set(c, { transformPerspective: 900 });
    c.addEventListener('pointermove', function (e) { var r = c.getBoundingClientRect(); ry(((e.clientX - r.left) / r.width - .5) * 8); rx(-((e.clientY - r.top) / r.height - .5) * 8); });
    c.addEventListener('pointerleave', function () { rx(0); ry(0); });
  });
  if ($('.std')) gsap.timeline({ repeat: -1, repeatDelay: 1.4, scrollTrigger: { trigger: '.std', start: 'top bottom', toggleActions: 'play pause resume pause' } })
    .fromTo('.std .lg-clip', { attr: { y: 302, height: 0 } }, { attr: { y: -4, height: 306 }, duration: 1.6, ease: 'power2.inOut' })
    .to('.std .lg-clip', { attr: { y: 302, height: 0 }, duration: 1.2, ease: 'power2.inOut', delay: 1.6 });

  /* icons draw themselves, numbers count up */
  $$('.feat').forEach(function (f, i) {
    var p = $('.draw', f); if (!p) return; var l = p.getTotalLength();
    gsap.set(p, { strokeDasharray: l, strokeDashoffset: l });
    gsap.timeline({ scrollTrigger: { trigger: f, start: 'top 88%' } })
      .to(p, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut', delay: (i % 4) * .1 })
      .from($$('h4,p', f), { y: 14, opacity: 0, stagger: .08, duration: .6, ease: 'power2.out' }, '<.3');
  });
  $$('.count').forEach(function (c) { var o = { v: 0 }; gsap.to(o, { v: +c.dataset.to, duration: 1.6, ease: 'power2.out', snap: { v: 1 }, onUpdate: function () { c.textContent = o.v; }, scrollTrigger: { trigger: c, start: 'top 90%' } }); });

  $$('.row').forEach(function (r, i) { gsap.from(r, { xPercent: i % 2 ? 8 : -8, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: r, start: 'top 92%' } }); });
  if ($('.gcards')) gsap.from('.gcard', { y: 80, opacity: 0, duration: 1, ease: 'expo.out', stagger: .12, scrollTrigger: { trigger: '.gcards', start: 'top 85%' } });
  $$('.orbit').forEach(function (o, i) { gsap.to(o, { rotate: 360, duration: 10 + i * 3, ease: 'none', repeat: -1 }); });
  $$('.mason figure, .thumbs figure').forEach(function (f) {
    gsap.from(f, { clipPath: 'inset(0 0 100% 0)', duration: 1.2, ease: 'expo.inOut', scrollTrigger: { trigger: f, start: 'top 92%' } });
    gsap.from($('img', f), { scale: 1.3, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: f, start: 'top 92%' } });
  });
  if ($('.ccard')) {
    gsap.from('.ccard', { clipPath: 'inset(18% 18% 18% 18% round 26px)', duration: 1.5, ease: 'expo.inOut', scrollTrigger: { trigger: '.dgrid', start: 'top 80%' } });
    gsap.to('.ccard img', { scale: 1, ease: 'none', scrollTrigger: { trigger: '.ccard', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from('.next', { x: 60, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.dgrid', start: 'top 75%' } });
  }
  $$('.radar i').forEach(function (r, i) { gsap.fromTo(r, { scale: .2, opacity: .8 }, { scale: 1, opacity: 0, duration: 3, ease: 'power1.out', repeat: -1, delay: i }); });

  /* finale: the sun rises over the horizon at the end of the page */
  if ($('#bigsun')) {
    gsap.fromTo('#bigsun', { yPercent: 62 }, { yPercent: 8, ease: 'none', scrollTrigger: { trigger: '.finale', start: 'top 70%', end: 'bottom bottom', scrub: .5 } });
    gsap.from('.horizon .ground', { scaleX: 0, transformOrigin: '50% 50%', duration: 1.6, ease: 'expo.inOut', scrollTrigger: { trigger: '.horizon', start: 'top 95%' } });
  }

  /* magnetic buttons and a cursor ring on mouse devices */
  if (fine) {
    $$('.magnet').forEach(function (b) {
      var mx = gsap.quickTo(b, 'x', { duration: .5, ease: 'power3' }), my = gsap.quickTo(b, 'y', { duration: .5, ease: 'power3' });
      b.addEventListener('pointermove', function (e) { var r = b.getBoundingClientRect(); mx((e.clientX - r.left - r.width / 2) * .3); my((e.clientY - r.top - r.height / 2) * .4); });
      b.addEventListener('pointerleave', function () { mx(0); my(0); });
    });
    var cur = $('#cur'), ring = $('#ring');
    if (cur) {
      var cx = gsap.quickTo(cur, 'x', { duration: .08 }), cy = gsap.quickTo(cur, 'y', { duration: .08 }), rx2 = gsap.quickTo(ring, 'x', { duration: .45, ease: 'power3' }), ry2 = gsap.quickTo(ring, 'y', { duration: .45, ease: 'power3' });
      window.addEventListener('pointermove', function (e) { cx(e.clientX); cy(e.clientY); rx2(e.clientX); ry2(e.clientY); });
      $$('a,button,figure,.card,select,input,summary').forEach(function (el) { el.addEventListener('pointerenter', function () { ring.classList.add('big'); }); el.addEventListener('pointerleave', function () { ring.classList.remove('big'); }); });
    }
  }
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
