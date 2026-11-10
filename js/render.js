/* Case Study Machine: deck renderer.
 *
 * One layout pass turns a deck spec (see playbook.md, "Deck format") into flat
 * drawing primitives on a 10 x 5.625 inch slide. Two back ends draw them:
 *   toSVG()  - the on-page preview
 *   toPptx() - a .pptx file that opens cleanly in Google Slides
 * Because both share the same layout, the preview matches the download.
 *
 * Works in the browser (window.CSM) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var W = 10, H = 5.625, MX = 0.5;          // slide size and side margin, inches
  var FONT = 'Arial';
  var INK = '1F2328', GREY = '5F6670', LIGHT = '8B929B', RULE = 'D5D8DC', PANEL = 'F4F5F6', WHITE = 'FFFFFF';

  function hex(c, fallback) {
    c = String(c || '').replace('#', '').trim();
    return /^[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : fallback;
  }
  function tint(c, amount) {               // mix a colour toward white; amount 0..1
    var n = parseInt(c, 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function m(v) { return Math.round(v + (255 - v) * amount); }
    return ((1 << 24) + (m(r) << 16) + (m(g) << 8) + m(b)).toString(16).slice(1).toUpperCase();
  }
  function arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
  function str(v) { return v == null ? '' : String(v); }

  /* A bullet may be a string or {text, sub:[...], bold:true}. "**x**" marks bold runs. */
  function runs(text, base) {
    var out = [], parts = str(text).split(/\*\*/);
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var r = { text: parts[i] };
      if (i % 2 === 1) r.bold = true;
      if (base) for (var k in base) if (r[k] === undefined) r[k] = base[k];
      out.push(r);
    }
    return out.length ? out : [{ text: '' }];
  }
  function bulletParas(items, size) {
    var paras = [];
    arr(items).forEach(function (b) {
      var o = typeof b === 'string' ? { text: b } : (b || {});
      paras.push({ runs: runs(o.text, o.bold ? { bold: true } : null), bullet: 1, size: size });
      arr(o.sub).forEach(function (s) {
        paras.push({ runs: runs(typeof s === 'string' ? s : s.text, { color: GREY }), bullet: 2, size: size - 2 });
      });
    });
    return paras;
  }
  /* Rough height of wrapped text, in inches. Good enough to stack blocks. */
  function textH(text, widthIn, size) {
    var perLine = Math.max(8, Math.floor(widthIn * 72 / (size * 0.5)));
    var lines = 0;
    str(text).split('\n').forEach(function (l) { lines += Math.max(1, Math.ceil(l.length / perLine)); });
    return lines * size * 1.3 / 72;
  }
  function fmt(v, f) {
    if (v == null || v === '') return '';
    if (typeof v !== 'number') return String(v);
    if (f === 'pct') return (Math.round(v * 1000) / 10).toString().replace(/\.0$/, '') + '%';
    if (f === 'pct1') return (v * 100).toFixed(1) + '%';
    if (f === 'usd') return '$' + Math.round(v).toLocaleString('en-US');
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-US');
    return (Math.round(v * 100) / 100).toString();
  }

  /* ---------- layout: spec -> primitives ---------- */

  function layoutDeck(spec) {
    spec = spec || {};
    var meta = spec.meta || {};
    var accent = hex(meta.accent, '2F5D8A');
    var ctx = { accent: accent, soft: tint(accent, 0.86), meta: meta };
    var slides = arr(spec.slides);
    return slides.map(function (s, i) {
      var P = [];
      var draw = BUILDERS[s.type] || BUILDERS.bullets;
      ctx.index = i; ctx.total = slides.length;
      if (s.type !== 'title' && s.type !== 'section') frame(P, s, ctx);
      draw(P, s, ctx);
      return { prims: P, notes: str(s.notes), type: s.type || 'bullets' };
    });
  }

  function T(P, x, y, w, h, text, o) {
    o = o || {};
    P.push({ t: 'text', x: x, y: y, w: w, h: h, paras: o.paras || [{ runs: runs(text, null) }], size: o.size || 14,
      bold: !!o.bold, color: o.color || INK, align: o.align || 'left', valign: o.valign || 'top', italic: !!o.italic });
  }
  function R(P, x, y, w, h, fill, line, o) {
    o = o || {};
    P.push({ t: 'rect', x: x, y: y, w: w, h: h, fill: fill || null, line: line || null, lineW: o.lineW || 0.75, round: !!o.round, dash: !!o.dash });
  }
  function L(P, x1, y1, x2, y2, color, w, dash) {
    P.push({ t: 'line', x1: x1, y1: y1, x2: x2, y2: y2, color: color || RULE, w: w || 0.75, dash: !!dash });
  }
  function E(P, x, y, w, h, fill, line) { P.push({ t: 'ellipse', x: x, y: y, w: w, h: h, fill: fill || null, line: line || null }); }

  /* Title, optional one-line subtitle, footer. Returns nothing; body area is bodyTop(s)..BODY_BOTTOM. */
  var BODY_BOTTOM = 5.0;
  function bodyTop(s) { return s.subtitle ? 1.5 : 1.25; }
  function frame(P, s, ctx) {
    T(P, MX, 0.36, W - 2 * MX, 0.8, s.title, { size: 22, bold: true, valign: 'top' });
    if (s.subtitle) T(P, MX, 1.08, W - 2 * MX, 0.34, s.subtitle, { size: 13, color: GREY });
    var foot = [str(ctx.meta.footer || ctx.meta.title)];
    if (s.source) foot = ['Source: ' + s.source];
    T(P, MX, 5.2, W - 2 * MX - 0.6, 0.25, foot[0], { size: 9, color: LIGHT });
    T(P, W - MX - 0.5, 5.2, 0.5, 0.25, String(ctx.index + 1), { size: 9, color: LIGHT, align: 'right' });
  }
  function callout(P, text, y, ctx, x, w) {
    x = x == null ? MX : x; w = w == null ? W - 2 * MX : w;
    var h = Math.max(0.45, textH(text, w - 0.4, 13) + 0.22);
    R(P, x, y, w, h, ctx.soft, null);
    R(P, x, y, 0.06, h, ctx.accent, null);
    T(P, x + 0.2, y, w - 0.35, h, text, { size: 13, valign: 'middle', paras: [{ runs: runs(text, null) }] });
    return h;
  }

  var BUILDERS = {};

  BUILDERS.title = function (P, s, ctx) {
    var m = ctx.meta;
    R(P, MX, 1.55, 0.9, 0.07, ctx.accent, null);
    T(P, MX, 1.8, 8.4, 1.3, s.title || m.title, { size: 34, bold: true, valign: 'top' });
    T(P, MX, 3.2, 8.4, 0.5, s.subtitle || m.subtitle, { size: 16, color: GREY });
    var by = [m.author, m.date].filter(Boolean).join('  |  ');
    T(P, MX, 4.7, 8.4, 0.3, by, { size: 12, color: GREY });
  };

  BUILDERS.section = function (P, s, ctx) {
    T(P, MX, 2.1, 8.4, 0.8, s.title, { size: 30, bold: true });
    R(P, MX, 2.95, 0.9, 0.07, ctx.accent, null);
    if (s.subtitle) T(P, MX, 3.15, 8.4, 0.5, s.subtitle, { size: 15, color: GREY });
  };

  BUILDERS.bullets = function (P, s, ctx) {
    var top = bodyTop(s), bottom = BODY_BOTTOM;
    if (s.callout) {
      var ch = Math.max(0.45, textH(s.callout, W - 2 * MX - 0.4, 13) + 0.22);
      callout(P, s.callout, bottom - ch, ctx); bottom -= ch + 0.15;
    }
    var cols = arr(s.columns);
    if (cols.length) {
      var gap = 0.4, cw = (W - 2 * MX - gap * (cols.length - 1)) / cols.length;
      cols.forEach(function (c, i) {
        var x = MX + i * (cw + gap), y = top;
        if (c.heading) {
          T(P, x, y, cw, 0.32, c.heading, { size: 14, bold: true, color: ctx.accent });
          L(P, x, y + 0.36, x + cw, y + 0.36, RULE, 0.75); y += 0.46;
        }
        T(P, x, y, cw, bottom - y, '', { size: 13, paras: bulletParas(c.bullets, 13) });
      });
    } else {
      var n = arr(s.bullets).length, size = n > 6 ? 14 : 16;
      T(P, MX, top, W - 2 * MX, bottom - top, '', { size: size, paras: bulletParas(s.bullets, size) });
    }
  };

  /* Big numbers with a label each, then optional bullets. */
  BUILDERS.stats = function (P, s, ctx) {
    var top = bodyTop(s), st = arr(s.stats).slice(0, 4), gap = 0.3;
    var cw = (W - 2 * MX - gap * (st.length - 1)) / Math.max(1, st.length);
    st.forEach(function (a, i) {
      var x = MX + i * (cw + gap);
      L(P, x, top, x + cw, top, i === (s.highlight | 0) ? ctx.accent : RULE, i === (s.highlight | 0) ? 2.25 : 0.75);
      T(P, x, top + 0.1, cw, 0.75, a.value, { size: 36, bold: true, color: i === (s.highlight | 0) ? ctx.accent : INK });
      T(P, x, top + 0.9, cw, 0.75, a.label, { size: 12, color: GREY });
    });
    var y = top + 1.8, bottom = BODY_BOTTOM;
    if (s.callout) { var ch = Math.max(0.45, textH(s.callout, 8.6, 13) + 0.22); callout(P, s.callout, bottom - ch, ctx); bottom -= ch + 0.15; }
    if (arr(s.bullets).length) T(P, MX, y, W - 2 * MX, bottom - y, '', { size: 14, paras: bulletParas(s.bullets, 14) });
  };

  /* Labelled cells in a grid: experiment design, options, risks. */
  BUILDERS.cards = function (P, s, ctx) {
    var top = bodyTop(s), cells = arr(s.cells), cols = s.cols || (cells.length <= 4 ? 2 : 3);
    var rows = Math.ceil(cells.length / cols), gap = 0.22;
    var bottom = BODY_BOTTOM;
    if (s.callout) { var ch = Math.max(0.45, textH(s.callout, 8.6, 13) + 0.22); callout(P, s.callout, bottom - ch, ctx); bottom -= ch + 0.15; }
    var cw = (W - 2 * MX - gap * (cols - 1)) / cols, chh = (bottom - top - gap * (rows - 1)) / rows;
    cells.forEach(function (c, i) {
      var x = MX + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (chh + gap);
      var hot = c.highlight;
      R(P, x, y, cw, chh, hot ? ctx.soft : WHITE, hot ? ctx.accent : RULE, { lineW: hot ? 1.25 : 0.75 });
      T(P, x + 0.15, y + 0.1, cw - 0.3, 0.3, c.label, { size: 12, bold: true, color: ctx.accent });
      var body = c.bullets ? bulletParas(c.bullets, 11.5) : [{ runs: runs(c.text, null) }];
      T(P, x + 0.15, y + 0.42, cw - 0.3, chh - 0.5, '', { size: 11.5, paras: body });
    });
  };

  /* Numbered steps left to right. */
  BUILDERS.steps = function (P, s, ctx) {
    var top = bodyTop(s) + 0.1, st = arr(s.steps).slice(0, 6), gap = 0.2;
    var cw = (W - 2 * MX - gap * (st.length - 1)) / Math.max(1, st.length);
    var bottom = BODY_BOTTOM;
    if (s.callout) { var ch = Math.max(0.45, textH(s.callout, 8.6, 13) + 0.22); callout(P, s.callout, bottom - ch, ctx); bottom -= ch + 0.15; }
    L(P, MX + 0.18, top + 0.18, MX + (st.length - 1) * (cw + gap) + 0.18, top + 0.18, RULE, 1.5);
    st.forEach(function (a, i) {
      var x = MX + i * (cw + gap);
      E(P, x, top, 0.36, 0.36, ctx.accent, null);
      T(P, x, top, 0.36, 0.36, String(i + 1), { size: 12, bold: true, color: WHITE, align: 'center', valign: 'middle' });
      T(P, x, top + 0.5, cw, 0.55, a.label, { size: 13, bold: true });
      if (a.when) T(P, x, top + 1.02, cw, 0.25, a.when, { size: 10.5, color: ctx.accent, bold: true });
      var y = top + (a.when ? 1.3 : 1.08);
      var body = a.bullets ? bulletParas(a.bullets, 11) : [{ runs: runs(a.text, { color: GREY }) }];
      T(P, x, y, cw, bottom - y, '', { size: 11, paras: body });
    });
  };

  BUILDERS.table = function (P, s, ctx) {
    var top = bodyTop(s), cols = arr(s.columns), rows = arr(s.rows);
    var bottom = BODY_BOTTOM, ch = 0;
    if (s.callout) { ch = Math.max(0.45, textH(s.callout, 8.6, 13) + 0.22); callout(P, s.callout, bottom - ch, ctx); bottom -= ch + 0.15; }
    var w = W - 2 * MX, weights = arr(s.widths).length === cols.length ? s.widths : cols.map(function (c, i) { return i === 0 ? 1.6 : 1; });
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    var colW = weights.map(function (x) { return w * x / sum; });
    var size = rows.length > 7 ? 10.5 : 11.5;
    var avail = bottom - top, rowH = Math.min(0.62, avail / (rows.length + 1));
    var data = [cols.map(function (c, i) { return { text: str(c), bold: true, color: INK, fill: PANEL, align: i === 0 ? 'left' : (s.align || 'left') }; })];
    rows.forEach(function (r, ri) {
      var hot = s.highlightRow === ri;
      data.push(arr(r).map(function (c, i) {
        return { text: typeof c === 'number' ? fmt(c, s.format) : str(c), bold: hot || (i === 0 && s.boldFirst !== false), color: INK, fill: hot ? ctx.soft : WHITE, align: i === 0 ? 'left' : (s.align || 'left') };
      }));
    });
    P.push({ t: 'table', x: MX, y: top, w: w, colW: colW, rowH: rowH, rows: data, size: size, border: RULE });
  };

  /* Charts are drawn from plain shapes so they stay editable in Google Slides. */
  BUILDERS.chart = function (P, s, ctx) {
    var top = bodyTop(s), bottom = BODY_BOTTOM;
    var c = s.chart || {}, side = arr(s.bullets);
    if (s.callout) { var ch = Math.max(0.45, textH(s.callout, 8.6, 13) + 0.22); callout(P, s.callout, bottom - ch, ctx); bottom -= ch + 0.15; }
    var cw = side.length ? 5.6 : W - 2 * MX;
    var box = { x: MX, y: top, w: cw, h: bottom - top };
    if (c.caption) { T(P, box.x, box.y, box.w, 0.28, c.caption, { size: 11, color: GREY, bold: true }); box.y += 0.32; box.h -= 0.32; }
    (CHARTS[c.kind] || CHARTS.bar)(P, c, box, ctx);
    if (side.length) T(P, MX + cw + 0.35, top, W - 2 * MX - cw - 0.35, bottom - top, '', { size: 13, paras: bulletParas(side, 13) });
  };

  function seriesColors(n, ctx, highlightSeries) {
    var greys = ['9AA1A9', 'C4C8CD', '6B727B', 'DADDE0'], out = [], g = 0;
    for (var i = 0; i < n; i++) {
      if (n === 1) out.push(ctx.accent);
      else if (i === (highlightSeries == null ? 0 : highlightSeries)) out.push(ctx.accent);
      else out.push(greys[g++ % greys.length]);
    }
    return out;
  }
  function legend(P, names, colors, x, y) {
    var cx = x;
    names.forEach(function (n, i) {
      R(P, cx, y + 0.06, 0.14, 0.14, colors[i], null);
      var w = 0.25 + str(n).length * 0.075;
      T(P, cx + 0.2, y, w, 0.26, n, { size: 10, color: GREY });
      cx += w + 0.3;
    });
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  var CHARTS = {};

  /* Vertical bars. One series: a single bar can be highlighted. Several: grouped. */
  CHARTS.bar = function (P, c, b, ctx) {
    var cats = arr(c.categories), ser = arr(c.series), n = cats.length, m = ser.length || 1;
    var colors = seriesColors(m, ctx, c.highlightSeries);
    var y0 = b.y;
    if (m > 1) { legend(P, ser.map(function (s) { return s.name; }), colors, b.x, b.y); y0 += 0.34; }
    var plotB = b.y + b.h - 0.5, plotT = y0 + 0.25, ph = plotB - plotT;
    var max = 0; ser.forEach(function (s) { arr(s.values).forEach(function (v) { if (v > max) max = v; }); });
    max = c.max || max * 1.08 || 1;
    var slot = b.w / Math.max(1, n), group = slot * 0.72, bw = group / m;
    L(P, b.x, plotB, b.x + b.w, plotB, LIGHT, 0.75);
    cats.forEach(function (cat, i) {
      var gx = b.x + i * slot + (slot - group) / 2;
      ser.forEach(function (s, j) {
        var v = arr(s.values)[i]; if (typeof v !== 'number') return;
        var h = Math.max(0.01, ph * v / max), x = gx + j * bw;
        var col = colors[j];
        if (m === 1 && c.highlight != null) col = i === c.highlight ? ctx.accent : 'B9BEC4';
        R(P, x + 0.02, plotB - h, bw - 0.04, h, col, null);
        if (c.labels !== false && bw > 0.3) T(P, x - 0.15, plotB - h - 0.26, bw + 0.3, 0.24, fmt(v, c.format), { size: m > 1 ? 9 : 11, align: 'center', bold: m === 1 && i === c.highlight, color: INK });
      });
      T(P, b.x + i * slot, plotB + 0.06, slot, 0.42, cat, { size: 10, color: GREY, align: 'center' });
    });
  };

  /* Horizontal bars, one series. Good for funnels and rankings. */
  CHARTS.hbar = function (P, c, b, ctx) {
    var cats = arr(c.categories), vals = arr((arr(c.series)[0] || {}).values), n = cats.length;
    var labelW = Math.min(2.6, Math.max(1.2, cats.reduce(function (a, s) { return Math.max(a, str(s).length); }, 0) * 0.085 + 0.2));
    var note = arr(c.notes), noteW = note.length ? 1.9 : 0;
    var max = c.max || Math.max.apply(null, vals.filter(function (v) { return typeof v === 'number'; }).concat([0])) || 1;
    var rowH = Math.min(0.62, b.h / Math.max(1, n)), barH = rowH * 0.62, bx = b.x + labelW, bwMax = b.w - labelW - 0.9 - noteW;
    cats.forEach(function (cat, i) {
      var y = b.y + i * rowH, v = vals[i];
      T(P, b.x, y, labelW - 0.12, rowH, cat, { size: 11, valign: 'middle', align: 'right', color: INK });
      if (typeof v !== 'number') return;
      var w = Math.max(0.02, bwMax * v / max);
      var col = c.highlight == null ? ctx.accent : (i === c.highlight ? ctx.accent : 'B9BEC4');
      R(P, bx, y + (rowH - barH) / 2, w, barH, col, null);
      T(P, bx + w + 0.08, y, 0.85, rowH, fmt(v, c.format), { size: 11, valign: 'middle', bold: i === c.highlight });
      if (note[i]) T(P, b.x + b.w - noteW, y, noteW, rowH, note[i], { size: 10, valign: 'middle', color: i === c.highlight ? ctx.accent : GREY, bold: i === c.highlight });
    });
    L(P, bx, b.y, bx, b.y + n * rowH, LIGHT, 0.75);
  };

  /* Lines over time. Few x labels are printed so they do not collide. */
  CHARTS.line = function (P, c, b, ctx) {
    var cats = arr(c.categories), ser = arr(c.series), n = cats.length;
    var colors = seriesColors(ser.length, ctx, c.highlightSeries);
    var y0 = b.y;
    if (ser.length > 1) { legend(P, ser.map(function (s) { return s.name; }), colors, b.x + 0.55, b.y); y0 += 0.34; }
    var axisW = 0.55, plotL = b.x + axisW, plotR = b.x + b.w - 0.15, plotT = y0 + 0.1, plotB = b.y + b.h - 0.4;
    var max = 0, min = Infinity;
    ser.forEach(function (s) { arr(s.values).forEach(function (v) { if (typeof v === 'number') { if (v > max) max = v; if (v < min) min = v; } }); });
    max = c.max || niceMax(max); min = c.min != null ? c.min : 0;
    for (var g = 0; g <= 4; g++) {
      var gy = plotB - (plotB - plotT) * g / 4, gv = min + (max - min) * g / 4;
      L(P, plotL, gy, plotR, gy, g === 0 ? LIGHT : 'E6E8EA', 0.75);
      T(P, b.x, gy - 0.12, axisW - 0.08, 0.24, fmt(gv, c.format), { size: 9, color: LIGHT, align: 'right' });
    }
    function px(i) { return plotL + (plotR - plotL) * (n > 1 ? i / (n - 1) : 0.5); }
    function py(v) { return plotB - (plotB - plotT) * (v - min) / (max - min || 1); }
    var every = Math.max(1, Math.ceil(n / 7));
    cats.forEach(function (cat, i) { if (i % every === 0) T(P, px(i) - 0.5, plotB + 0.05, 1.0, 0.24, cat, { size: 9, color: GREY, align: 'center' }); });
    ser.forEach(function (s, j) {
      var v = arr(s.values), hot = colors[j] === ctx.accent;
      for (var i = 1; i < n; i++) if (typeof v[i] === 'number' && typeof v[i - 1] === 'number') L(P, px(i - 1), py(v[i - 1]), px(i), py(v[i]), colors[j], hot ? 2.25 : 1.5);
    });
  };

  /* ---------- wireframe mockups ---------- */

  var EL_H = { nav: 0.34, heading: 0.3, text: 0.26, input: 0.44, button: 0.32, link: 0.22, card: 0.62, list: 0, banner: 0.42,
    image: 0.7, checklist: 0, progress: 0.3, divider: 0.1, spacer: 0.12, chips: 0.28, tabs: 0.3 };

  function elHeight(e, k) {
    var n = arr(e.items).length;
    if (e.type === 'list') return 0.3 * n * k;
    if (e.type === 'checklist') return 0.27 * n * k;
    if (e.type === 'text') return Math.max(0.26, Math.ceil(str(e.text).length / 34) * 0.17 + 0.08) * k;
    if (e.type === 'card') return (e.text && str(e.text).length > 40 ? 0.78 : 0.62) * k;
    if (e.type === 'image' && e.tall) return 1.2 * k;
    return (EL_H[e.type] || 0.26) * k;
  }

  BUILDERS.mockup = function (P, s, ctx) {
    var top = bodyTop(s), bottom = BODY_BOTTOM, screens = arr(s.screens).slice(0, 3);
    var notes = arr(s.annotations), notesW = notes.length ? 3.0 : 0;
    var areaW = W - 2 * MX - notesW - (notesW ? 0.3 : 0);
    var browser = screens.some(function (sc) { return sc.frame === 'browser'; });
    var gap = 0.35, fh = bottom - top - 0.3;
    var fw = browser ? Math.min(areaW / screens.length - gap, fh * 1.45) : Math.min(2.05, (areaW - gap * (screens.length - 1)) / screens.length);
    var totalW = screens.length * fw + (screens.length - 1) * gap;
    var x0 = MX + (notesW ? 0 : (areaW - totalW) / 2);
    screens.forEach(function (sc, i) {
      var x = x0 + i * (fw + gap);
      drawScreen(P, sc, x, top, fw, fh, ctx);
      T(P, x - 0.1, top + fh + 0.04, fw + 0.2, 0.26, sc.caption, { size: 10, color: GREY, align: 'center' });
      if (i < screens.length - 1 && s.flow !== false) T(P, x + fw, top + fh / 2 - 0.15, gap, 0.3, '›', { size: 18, color: LIGHT, align: 'center', valign: 'middle' });
    });
    if (notes.length) {
      var nx = W - MX - notesW, y = top;
      notes.forEach(function (n, i) {
        var h = Math.max(0.4, textH(n, notesW - 0.45, 11.5) + 0.12);
        E(P, nx, y + 0.02, 0.26, 0.26, ctx.accent, null);
        T(P, nx, y + 0.02, 0.26, 0.26, String(i + 1), { size: 10, bold: true, color: WHITE, align: 'center', valign: 'middle' });
        T(P, nx + 0.36, y, notesW - 0.36, h, n, { size: 11.5 });
        y += h + 0.1;
      });
    }
  };

  function drawScreen(P, sc, x, y, w, h, ctx) {
    var phone = sc.frame !== 'browser', pad = 0.12;
    R(P, x, y, w, h, WHITE, '6B727B', { lineW: 1.25, round: phone });
    var cy = y + (phone ? 0.2 : 0.06);
    if (phone) R(P, x + w / 2 - 0.25, y + 0.08, 0.5, 0.05, 'C4C8CD', null, { round: true });
    else {
      R(P, x, y, w, 0.24, PANEL, '6B727B', { lineW: 1.25 });
      for (var d = 0; d < 3; d++) E(P, x + 0.08 + d * 0.13, y + 0.08, 0.08, 0.08, 'C4C8CD', null);
      R(P, x + 0.6, y + 0.05, w - 0.8, 0.14, WHITE, RULE);
      cy = y + 0.3;
    }
    var els = arr(sc.elements), need = els.reduce(function (a, e) { return a + elHeight(e, 1) + 0.06; }, 0);
    var k = Math.min(1, (y + h - cy - 0.1) / (need || 1)), fs = Math.max(7, 9.5 * (k < 0.85 ? 0.9 : 1));
    var ix = x + pad, iw = w - 2 * pad;
    els.forEach(function (e) {
      var eh = elHeight(e, k), t = e.type, hot = !!e.highlight;
      if (cy + eh > y + h - 0.04) return;
      if (t === 'nav') {
        R(P, x + 0.01, cy, w - 0.02, eh, PANEL, null);
        T(P, ix, cy, iw, eh, e.text, { size: fs, bold: true, valign: 'middle', align: e.align || 'center' });
      } else if (t === 'heading') T(P, ix, cy, iw, eh, e.text, { size: fs + 2, bold: true, valign: 'middle' });
      else if (t === 'text') T(P, ix, cy, iw, eh, e.text, { size: fs - 1, color: GREY });
      else if (t === 'link') T(P, ix, cy, iw, eh, e.text, { size: fs - 1, color: ctx.accent, align: e.align || 'center', valign: 'middle' });
      else if (t === 'input') {
        T(P, ix, cy, iw, eh * 0.4, e.label, { size: fs - 2, color: GREY });
        R(P, ix, cy + eh * 0.4, iw, eh * 0.58, WHITE, hot ? ctx.accent : RULE, { lineW: hot ? 1.5 : 0.75 });
        T(P, ix + 0.06, cy + eh * 0.4, iw - 0.1, eh * 0.58, e.value || e.placeholder, { size: fs - 1, color: e.value ? INK : LIGHT, valign: 'middle' });
      } else if (t === 'button') {
        var primary = e.primary !== false;
        R(P, ix, cy + 0.02, iw, eh - 0.04, primary ? ctx.accent : WHITE, primary ? null : LIGHT, { round: true });
        T(P, ix, cy + 0.02, iw, eh - 0.04, e.text, { size: fs, bold: true, color: primary ? WHITE : INK, align: 'center', valign: 'middle' });
      } else if (t === 'card') {
        R(P, ix, cy, iw, eh, hot ? ctx.soft : WHITE, hot ? ctx.accent : RULE, { lineW: hot ? 1.25 : 0.75 });
        T(P, ix + 0.08, cy + 0.04, iw - 0.16, 0.22 * k, e.title, { size: fs, bold: true });
        T(P, ix + 0.08, cy + 0.26 * k, iw - 0.16, eh - 0.28 * k, e.text, { size: fs - 1.5, color: GREY });
      } else if (t === 'banner') {
        R(P, ix, cy, iw, eh, ctx.soft, null);
        R(P, ix, cy, 0.04, eh, ctx.accent, null);
        T(P, ix + 0.1, cy, iw - 0.14, eh, e.text, { size: fs - 1, valign: 'middle' });
      } else if (t === 'image') {
        R(P, ix, cy, iw, eh, PANEL, RULE, { dash: true });
        T(P, ix, cy, iw, eh, e.label || e.text, { size: fs - 1, color: LIGHT, align: 'center', valign: 'middle' });
      } else if (t === 'list' || t === 'checklist') {
        var items = arr(e.items), rh = eh / Math.max(1, items.length);
        items.forEach(function (it, i) {
          var o = typeof it === 'string' ? { text: it } : it, ry = cy + i * rh;
          if (t === 'checklist') {
            R(P, ix, ry + rh / 2 - 0.06, 0.12, 0.12, o.done ? ctx.accent : WHITE, o.done ? null : LIGHT);
            T(P, ix + 0.18, ry, iw - 0.18, rh, o.text, { size: fs - 1, valign: 'middle', color: o.done ? LIGHT : INK });
          } else {
            T(P, ix, ry, iw - (o.right ? 0.6 : 0), rh, o.text, { size: fs - 1, valign: 'middle' });
            if (o.right) T(P, ix + iw - 0.75, ry, 0.75, rh, o.right, { size: fs - 2, valign: 'middle', align: 'right', color: ctx.accent });
            L(P, ix, ry + rh, ix + iw, ry + rh, 'E6E8EA', 0.5);
          }
        });
      } else if (t === 'progress') {
        T(P, ix, cy, iw, eh * 0.5, e.label, { size: fs - 2, color: GREY });
        R(P, ix, cy + eh * 0.58, iw, 0.07, 'E6E8EA', null, { round: true });
        R(P, ix, cy + eh * 0.58, Math.max(0.05, iw * Math.max(0, Math.min(1, +e.value || 0))), 0.07, ctx.accent, null, { round: true });
      } else if (t === 'chips' || t === 'tabs') {
        var its = arr(e.items), cwid = iw / Math.max(1, its.length);
        its.forEach(function (it, i) {
          var o = typeof it === 'string' ? { text: it } : it;
          if (t === 'chips') R(P, ix + i * cwid + 0.02, cy + 0.03, cwid - 0.04, eh - 0.06, o.selected ? ctx.soft : WHITE, o.selected ? ctx.accent : RULE, { round: true });
          else if (o.selected) L(P, ix + i * cwid, cy + eh - 0.02, ix + (i + 1) * cwid, cy + eh - 0.02, ctx.accent, 1.5);
          T(P, ix + i * cwid, cy, cwid, eh, o.text, { size: fs - 2, align: 'center', valign: 'middle', bold: !!o.selected });
        });
      } else if (t === 'divider') L(P, ix, cy + eh / 2, ix + iw, cy + eh / 2, RULE, 0.75);
      if (e.mark) {
        E(P, x + w - 0.13, cy + eh / 2 - 0.13, 0.26, 0.26, ctx.accent, WHITE);
        T(P, x + w - 0.13, cy + eh / 2 - 0.13, 0.26, 0.26, String(e.mark), { size: 10, bold: true, color: WHITE, align: 'center', valign: 'middle' });
      }
      cy += eh + 0.06 * k;
    });
  }

  /* ---------- back end: SVG preview ---------- */

  function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function runsHTML(rs) {
    return rs.map(function (r) {
      var st = (r.bold ? 'font-weight:700;' : '') + (r.color ? 'color:#' + r.color + ';' : '');
      return st ? '<span style="' + st + '">' + esc(r.text) + '</span>' : esc(r.text);
    }).join('');
  }
  function toSVG(slide) {
    var S = 96, o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W * S + ' ' + H * S + '" font-family="Arial, Helvetica, sans-serif">',
      '<rect width="100%" height="100%" fill="#FFFFFF"/>'];
    slide.prims.forEach(function (p) {
      if (p.t === 'rect') {
        o.push('<rect x="' + p.x * S + '" y="' + p.y * S + '" width="' + Math.max(0, p.w) * S + '" height="' + Math.max(0, p.h) * S + '"' +
          (p.round ? ' rx="' + Math.min(p.w, p.h, 0.32) * S * 0.22 + '"' : '') + ' fill="' + (p.fill ? '#' + p.fill : 'none') + '"' +
          (p.line ? ' stroke="#' + p.line + '" stroke-width="' + p.lineW * 1.33 + '"' + (p.dash ? ' stroke-dasharray="5 4"' : '') : '') + '/>');
      } else if (p.t === 'ellipse') {
        o.push('<ellipse cx="' + (p.x + p.w / 2) * S + '" cy="' + (p.y + p.h / 2) * S + '" rx="' + p.w / 2 * S + '" ry="' + p.h / 2 * S + '" fill="' + (p.fill ? '#' + p.fill : 'none') + '"' + (p.line ? ' stroke="#' + p.line + '"' : '') + '/>');
      } else if (p.t === 'line') {
        o.push('<line x1="' + p.x1 * S + '" y1="' + p.y1 * S + '" x2="' + p.x2 * S + '" y2="' + p.y2 * S + '" stroke="#' + p.color + '" stroke-width="' + p.w * 1.33 + '"' + (p.dash ? ' stroke-dasharray="5 4"' : '') + ' stroke-linecap="round"/>');
      } else if (p.t === 'text') {
        var html = p.paras.map(function (pa) {
          var sz = (pa.size || p.size) * 1.333, ind = pa.bullet ? (pa.bullet === 2 ? 34 : 14) : 0;
          var body = runsHTML(pa.runs);
          if (!pa.bullet) return '<div style="font-size:' + sz + 'px">' + body + '</div>';
          return '<div style="font-size:' + sz + 'px;padding-left:' + (ind + 14) + 'px;text-indent:-14px;margin-bottom:' + (pa.bullet === 2 ? 3 : 7) + 'px">' +
            '<span style="display:inline-block;width:14px;text-indent:0;color:#' + (pa.bullet === 2 ? LIGHT : INK) + '">' + (pa.bullet === 2 ? '–' : '•') + '</span>' + body + '</div>';
        }).join('');
        var just = p.valign === 'middle' ? 'center' : p.valign === 'bottom' ? 'flex-end' : 'flex-start';
        o.push('<foreignObject x="' + p.x * S + '" y="' + p.y * S + '" width="' + Math.max(0, p.w) * S + '" height="' + Math.max(0, p.h) * S + '">' +
          '<div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;flex-direction:column;justify-content:' + just + ';overflow:hidden;' +
          'font-family:Arial,Helvetica,sans-serif;line-height:1.25;color:#' + p.color + ';text-align:' + p.align + ';' + (p.bold ? 'font-weight:700;' : '') + (p.italic ? 'font-style:italic;' : '') + '">' + html + '</div></foreignObject>');
      } else if (p.t === 'table') {
        var rowsH = p.rows.map(function (r) {
          return '<tr>' + r.map(function (c, i) {
            return '<td style="width:' + p.colW[i] * S + 'px;height:' + p.rowH * S + 'px;padding:0 8px;border:1px solid #' + p.border + ';background:#' + c.fill + ';color:#' + c.color + ';text-align:' + c.align + ';' + (c.bold ? 'font-weight:700;' : '') + '">' + runsHTML(runs(c.text, null)) + '</td>';
          }).join('') + '</tr>';
        }).join('');
        o.push('<foreignObject x="' + p.x * S + '" y="' + p.y * S + '" width="' + p.w * S + '" height="' + (p.rowH * p.rows.length + 0.05) * S + '">' +
          '<table xmlns="http://www.w3.org/1999/xhtml" style="border-collapse:collapse;table-layout:fixed;width:100%;font-family:Arial,Helvetica,sans-serif;font-size:' + p.size * 1.333 + 'px;line-height:1.2">' + rowsH + '</table></foreignObject>');
      }
    });
    o.push('</svg>');
    return o.join('');
  }

  /* ---------- back end: PowerPoint / Google Slides ---------- */

  function toPptx(PptxGenJS, spec) {
    var pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    var meta = (spec && spec.meta) || {};
    pptx.title = str(meta.title); pptx.author = str(meta.author);
    layoutDeck(spec).forEach(function (sl) {
      var s = pptx.addSlide();
      s.background = { color: WHITE };
      sl.prims.forEach(function (p) {
        if (p.t === 'rect') {
          var o = { x: p.x, y: p.y, w: Math.max(0.01, p.w), h: Math.max(0.01, p.h) };
          o.fill = p.fill ? { color: p.fill } : { type: 'none' };
          o.line = p.line ? { color: p.line, width: p.lineW, dashType: p.dash ? 'dash' : 'solid' } : { type: 'none' };
          if (p.round) o.rectRadius = Math.min(p.w, p.h, 0.32) * 0.22;
          s.addShape(p.round ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, o);
        } else if (p.t === 'ellipse') {
          s.addShape(pptx.ShapeType.ellipse, { x: p.x, y: p.y, w: p.w, h: p.h, fill: p.fill ? { color: p.fill } : { type: 'none' }, line: p.line ? { color: p.line, width: 0.75 } : { type: 'none' } });
        } else if (p.t === 'line') {
          var x = Math.min(p.x1, p.x2), y = Math.min(p.y1, p.y2);
          s.addShape(pptx.ShapeType.line, { x: x, y: y, w: Math.abs(p.x2 - p.x1), h: Math.abs(p.y2 - p.y1), flipV: (p.x2 - p.x1) * (p.y2 - p.y1) < 0,
            line: { color: p.color, width: p.w, dashType: p.dash ? 'dash' : 'solid' } });
        } else if (p.t === 'text') {
          var parts = [];
          p.paras.forEach(function (pa, pi) {
            pa.runs.forEach(function (r, ri) {
              var o = { fontSize: pa.size || p.size, bold: !!(r.bold || p.bold), color: r.color || p.color };
              if (pa.bullet) { o.bullet = pa.bullet === 2 ? { code: '2013', indent: 12 } : { indent: 14 }; o.indentLevel = pa.bullet - 1; o.paraSpaceAfter = pa.bullet === 2 ? 2 : 6; }
              if (ri === pa.runs.length - 1 && pi < p.paras.length - 1) o.breakLine = true;
              parts.push({ text: r.text, options: o });
            });
          });
          if (!parts.length || parts.every(function (q) { return !q.text; })) return;
          s.addText(parts, { x: p.x, y: p.y, w: Math.max(0.05, p.w), h: Math.max(0.05, p.h), fontFace: FONT, fontSize: p.size, color: p.color, bold: p.bold, italic: p.italic,
            align: p.align, valign: p.valign === 'middle' ? 'middle' : p.valign === 'bottom' ? 'bottom' : 'top', margin: 0, fit: 'shrink' });
        } else if (p.t === 'table') {
          s.addTable(p.rows.map(function (r) {
            return r.map(function (c) {
              return { text: c.text.replace(/\*\*/g, ''), options: { bold: c.bold, color: c.color, fill: { color: c.fill }, align: c.align, valign: 'middle' } };
            });
          }), { x: p.x, y: p.y, w: p.w, colW: p.colW, rowH: p.rowH, fontFace: FONT, fontSize: p.size, border: { type: 'solid', pt: 0.75, color: p.border }, margin: 0.07 });
        }
      });
      if (sl.notes) s.addNotes(sl.notes);
    });
    return pptx;
  }

  /* ---------- checks the model's deck must pass ---------- */

  var TYPES = ['title', 'section', 'bullets', 'stats', 'cards', 'steps', 'table', 'chart', 'mockup'];
  function validate(spec) {
    var errs = [];
    if (!spec || typeof spec !== 'object') return ['deck must be an object'];
    if (!spec.meta || !spec.meta.title) errs.push('meta.title is required');
    var sl = arr(spec.slides);
    if (sl.length < 3) errs.push('deck needs at least 3 slides');
    sl.forEach(function (s, i) {
      var at = 'slide ' + (i + 1) + ': ';
      if (TYPES.indexOf(s.type) < 0) errs.push(at + 'unknown type "' + s.type + '". Use one of ' + TYPES.join(', '));
      if (!s.title) errs.push(at + 'title is required');
      if (s.type !== 'title' && s.type !== 'section' && str(s.title).length > 95) errs.push(at + 'title is ' + str(s.title).length + ' characters; keep it under 95 so it fits on two lines');
      if (s.type === 'bullets' && !arr(s.bullets).length && !arr(s.columns).length) errs.push(at + 'bullets slide needs bullets or columns');
      if (s.type === 'bullets' && arr(s.bullets).length > 7) errs.push(at + 'more than 7 bullets; split the slide or move detail to notes');
      if (s.type === 'chart') {
        var c = s.chart || {}, n = arr(c.categories).length;
        if (!n || !arr(c.series).length) errs.push(at + 'chart needs categories and series');
        arr(c.series).forEach(function (se) { if (arr(se.values).length !== n) errs.push(at + 'series "' + se.name + '" has ' + arr(se.values).length + ' values for ' + n + ' categories'); });
        if (c.kind === 'bar' && n * arr(c.series).length > 28) errs.push(at + 'too many bars; aggregate or use a line chart');
      }
      if (s.type === 'table') {
        var nc = arr(s.columns).length;
        if (!nc || !arr(s.rows).length) errs.push(at + 'table needs columns and rows');
        if (arr(s.rows).length > 9) errs.push(at + 'more than 9 table rows; cut or move to the appendix');
        arr(s.rows).forEach(function (r, ri) { if (arr(r).length !== nc) errs.push(at + 'row ' + (ri + 1) + ' has ' + arr(r).length + ' cells for ' + nc + ' columns'); });
      }
      if (s.type === 'cards' && (arr(s.cells).length < 2 || arr(s.cells).length > 6)) errs.push(at + 'cards needs 2 to 6 cells');
      if (s.type === 'steps' && (arr(s.steps).length < 2 || arr(s.steps).length > 6)) errs.push(at + 'steps needs 2 to 6 steps');
      if (s.type === 'mockup' && !arr(s.screens).length) errs.push(at + 'mockup needs at least one screen');
    });
    return errs;
  }

  var api = { layoutDeck: layoutDeck, toSVG: toSVG, toPptx: toPptx, validate: validate, TYPES: TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CSM = api;
})(typeof window !== 'undefined' ? window : this);
