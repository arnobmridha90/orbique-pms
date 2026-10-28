// Decode city.bin (see city.json) into typed arrays and simple iterators. Units: 1 = 10 m, x east, z south.
(function () {
  const KLC = (window.KLC = window.KLC || {});
  KLC.decode = function (buf, man) {
    const T = { Int16: Int16Array, Uint16: Uint16Array, Uint8: Uint8Array, Uint32: Uint32Array, Float32: Float32Array };
    const s = {}; for (const [k, v] of Object.entries(man.sections)) s[k] = new T[v.type](buf, v.offset, v.count);
    const iq = 1 / man.q;
    // buildings: ring = Float32Array [x0,z0,x1,z1,...] (counter-clockwise seen from above with z south... i.e. CCW in (x,z) math axes)
    const buildings = []; let p = 0;
    for (let i = 0; i < s.b_count.length; i++) {
      const n = s.b_count[i], ring = new Float32Array(n * 2);
      for (let j = 0; j < n * 2; j++) ring[j] = s.b_pts[p + j] * iq;
      p += n * 2;
      buildings.push({ ring, h: s.b_height_dm[i] / 100, min: s.b_min_dm[i] / 100, kind: s.b_kind[i], roof: s.b_roof[i], seed: s.b_seed[i] / 255 }); // h, min in units (10 m)
    }
    const lines = []; p = 0;
    for (let i = 0; i < s.l_count.length; i++) { const n = s.l_count[i], pts = new Float32Array(n * 2); for (let j = 0; j < n * 2; j++) pts[j] = s.l_pts[p + j] * iq; p += n * 2; lines.push({ pts, cls: s.l_class[i], level: s.l_level[i] }); }
    const waterLines = []; p = 0;
    for (let i = 0; i < s.w_count.length; i++) { const n = s.w_count[i], pts = new Float32Array(n * 2); for (let j = 0; j < n * 2; j++) pts[j] = s.w_pts[p + j] * iq; p += n * 2; waterLines.push({ pts, width: s.w_width_dm[i] / 100 }); }
    const areas = []; p = 0; let hc = 0;
    const take = (n) => { const r = new Float32Array(n * 2); for (let j = 0; j < n * 2; j++) r[j] = s.a_pts[p + j] * iq; p += n * 2; return r; };
    for (let i = 0; i < s.a_count.length; i++) { const ring = take(s.a_count[i]); const holes = []; for (let h = 0; h < s.a_holes[i]; h++) holes.push(take(s.a_hole_counts[hc++])); areas.push({ ring, holes, kind: s.a_kind[i] }); }
    const trees = new Float32Array(s.t_pts.length); for (let j = 0; j < trees.length; j++) trees[j] = s.t_pts[j] * iq;
    return { buildings, lines, waterLines, areas, trees, codes: man.codes, credit: man.credit };
  };
  KLC.load = async function (base = '') {
    const [man, buf] = await Promise.all([fetch(base + 'city.json').then((r) => r.json()), fetch(base + 'city.bin').then((r) => r.arrayBuffer())]);
    return KLC.decode(buf, man);
  };
})();
