/* Runs first, in <head>: turns on the animations (html.js). If site.js has not started within 4 s
   (blocked, failed to load), the class comes off again so every word and picture stays visible. */
(function (d) {
  var h = d.documentElement;
  h.className += ' js';
  setTimeout(function () { if (!window.__orb) h.className = h.className.replace(/\bjs\b/, ''); }, 4000);
})(document);
