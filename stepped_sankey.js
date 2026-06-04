/*
 * Stepped / Funnel-style Sankey — Looker custom visualization
 *
 * One self-contained IIFE. Vanilla JS + SVG, no dependencies, no build step.
 * Input contract: N dimensions (>= 2, each one ordered "step") + 1 measure (flow weight).
 *
 * Each dimension is a column/step. Distinct values at a step are nodes; bar height is
 * proportional to the summed measure. Ribbons between consecutive steps are sized by the
 * summed measure of rows sharing both values. Percentages are retention vs. the first step.
 * Nodes below a configurable share of their step total are bucketed into "Other".
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var OTHER_LABEL = 'Other';
  var OTHER_COLOR = '#9aa0a6';

  var PALETTES = {
    looker:  ['#1A73E8', '#12B5CB', '#E52592', '#E8710A', '#7CB342', '#9334E6', '#F9AB00', '#80868B', '#188038', '#D93025'],
    cool:    ['#1f4e79', '#2e75b6', '#2596be', '#41b6c4', '#7fcdbb', '#5b8fa8', '#3c6e8f', '#264f73'],
    warm:    ['#7a2048', '#b5341f', '#e8710a', '#f9ab00', '#d96c06', '#a83232', '#c9472b', '#e0922f'],
    mono:    ['#0b3d91', '#1559c0', '#2e75b6', '#5b8fd6', '#86abe0', '#b0c7ea', '#16325c', '#3a5f9e']
  };

  /* ---------- helpers (pure) ---------- */

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (attrs.hasOwnProperty(k)) { el.setAttribute(k, attrs[k]); }
      }
    }
    return el;
  }

  function toNumber(v) {
    if (v === null || v === undefined || v === '') { return 0; }
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function cellString(cell) {
    if (cell === null || cell === undefined) { return ''; }
    if (cell.rendered !== null && cell.rendered !== undefined && cell.rendered !== '') {
      return String(cell.rendered);
    }
    if (cell.value === null || cell.value === undefined) { return ''; }
    return String(cell.value);
  }

  function cellNumber(cell) {
    if (cell === null || cell === undefined) { return 0; }
    return toNumber(cell.value !== null && cell.value !== undefined ? cell.value : cell.rendered);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(n) {
    var x = Math.round(n);
    return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatPct(p) {
    if (p >= 99.95) { return '100%'; }
    if (p < 0.05 && p > 0) { return '<0.1%'; }
    return (Math.round(p * 10) / 10) + '%';
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var ctx = this;
      var args = arguments;
      if (t) { clearTimeout(t); }
      t = setTimeout(function () { t = null; fn.apply(ctx, args); }, wait);
    };
  }

  function readableTextColor(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    var yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? '#202124' : '#ffffff';
  }

  /* ---------- data transform ---------- */

  function buildModel(data, queryResponse, config) {
    var dims = (queryResponse && queryResponse.fields && queryResponse.fields.dimension_like) || [];
    var measures = (queryResponse && queryResponse.fields && queryResponse.fields.measure_like) || [];

    if (dims.length < 2) {
      return { error: 'Stepped Sankey needs at least 2 dimensions (each is a step). Add another dimension.' };
    }
    if (measures.length < 1) {
      return { error: 'Stepped Sankey needs exactly 1 measure (the flow weight). Add a measure.' };
    }
    if (!data || data.length === 0) {
      return { error: 'No data.' };
    }

    var measure = measures[0];
    var measureName = measure.name;
    var measureLabel = measure.label_short || measure.label || measureName;

    var bucketPct = toNumber(config.bucket_pct);
    if (bucketPct < 0) { bucketPct = 0; }

    var nSteps = dims.length;
    var s, i, r;

    // raw node totals per step + raw link totals between consecutive steps
    var rawSteps = [];
    for (s = 0; s < nSteps; s++) {
      rawSteps.push({ index: s, label: dims[s].label_short || dims[s].label || dims[s].name, nodes: {} });
    }
    var rawLinks = {}; // key "s|src|tgt" -> weight

    for (r = 0; r < data.length; r++) {
      var row = data[r];
      var m = cellNumber(row[measureName]);
      if (m === 0) { continue; }
      var vals = [];
      for (s = 0; s < nSteps; s++) {
        vals.push(cellString(row[dims[s].name]));
      }
      for (s = 0; s < nSteps; s++) {
        var v = vals[s];
        if (v === '') { continue; }
        var bucket = rawSteps[s].nodes;
        bucket[v] = (bucket[v] || 0) + m;
        if (s < nSteps - 1) {
          var nv = vals[s + 1];
          if (nv !== '') {
            var lk = s + '|' + v + '|' + nv;
            rawLinks[lk] = (rawLinks[lk] || 0) + m;
          }
        }
      }
    }

    // step totals
    for (s = 0; s < nSteps; s++) {
      var tot = 0;
      var nodesObj = rawSteps[s].nodes;
      for (var key in nodesObj) { if (nodesObj.hasOwnProperty(key)) { tot += nodesObj[key]; } }
      rawSteps[s].total = tot;
    }

    var firstTotal = rawSteps[0].total || 1;

    // bucket small nodes into "Other" per step; build a per-step relabel map
    var relabel = []; // relabel[s] = { originalValue -> displayKey }
    var hiddenCount = 0;
    var resolvedSteps = [];

    for (s = 0; s < nSteps; s++) {
      var stepNodes = rawSteps[s].nodes;
      var stepTotal = rawSteps[s].total || 1;
      var threshold = (bucketPct / 100) * stepTotal;
      var map = {};
      var kept = {}; // displayKey -> total
      var otherTotal = 0;
      for (var nk in stepNodes) {
        if (!stepNodes.hasOwnProperty(nk)) { continue; }
        var val = stepNodes[nk];
        if (bucketPct > 0 && val < threshold) {
          map[nk] = OTHER_LABEL;
          otherTotal += val;
          hiddenCount++;
        } else {
          map[nk] = nk;
          kept[nk] = (kept[nk] || 0) + val;
        }
      }
      if (otherTotal > 0) { kept[OTHER_LABEL] = (kept[OTHER_LABEL] || 0) + otherTotal; }
      relabel.push(map);

      // sort nodes desc by total, Other always last
      var arr = [];
      for (var dk in kept) {
        if (kept.hasOwnProperty(dk)) { arr.push({ key: dk, total: kept[dk] }); }
      }
      arr.sort(function (a, b) {
        if (a.key === OTHER_LABEL) { return 1; }
        if (b.key === OTHER_LABEL) { return -1; }
        return b.total - a.total;
      });
      for (i = 0; i < arr.length; i++) {
        arr[i].pct = (arr[i].total / firstTotal) * 100;
        arr[i].stepIndex = s;
      }
      resolvedSteps.push({ index: s, label: rawSteps[s].label, nodes: arr, total: stepTotal });
    }

    // remap links through the bucket relabel maps and aggregate
    var linkAgg = {}; // "s|dispSrc|dispTgt" -> weight
    for (var rl in rawLinks) {
      if (!rawLinks.hasOwnProperty(rl)) { continue; }
      var parts = rl.split('|');
      var ls = parseInt(parts[0], 10);
      var src = parts.slice(1, parts.length - 1).join('|'); // tolerate '|' in values (unlikely after split, kept simple)
      var tgt = parts[parts.length - 1];
      var dispSrc = relabel[ls][src] || src;
      var dispTgt = relabel[ls + 1][tgt] || tgt;
      var ak = ls + '|' + dispSrc + '|' + dispTgt;
      linkAgg[ak] = (linkAgg[ak] || 0) + rawLinks[rl];
    }
    var links = [];
    for (var la in linkAgg) {
      if (!linkAgg.hasOwnProperty(la)) { continue; }
      var lp = la.split('|');
      links.push({ step: parseInt(lp[0], 10), fromKey: lp[1], toKey: lp[2], weight: linkAgg[la] });
    }

    // assign stable colors by display label (Other fixed grey)
    var palette = PALETTES[config.palette] || PALETTES.looker;
    var colorMap = {};
    var colorIdx = 0;
    for (s = 0; s < resolvedSteps.length; s++) {
      var ns = resolvedSteps[s].nodes;
      for (i = 0; i < ns.length; i++) {
        var lbl = ns[i].key;
        if (lbl === OTHER_LABEL) { ns[i].color = OTHER_COLOR; continue; }
        if (!colorMap[lbl]) { colorMap[lbl] = palette[colorIdx % palette.length]; colorIdx++; }
        ns[i].color = colorMap[lbl];
      }
    }

    return {
      steps: resolvedSteps,
      links: links,
      firstTotal: firstTotal,
      measureLabel: measureLabel,
      hiddenCount: hiddenCount,
      bucketPct: bucketPct
    };
  }

  /* ---------- render ---------- */

  function render(container, tooltip, config, model) {
    while (container.firstChild) { container.removeChild(container.firstChild); }

    var W = container.clientWidth || 800;
    var H = container.clientHeight || 500;
    if (W < 40 || H < 40) { return; }

    var fontSize = toNumber(config.font_size) || 12;
    var nodeWidth = toNumber(config.node_width) || 22;
    var nodeGap = toNumber(config.node_gap);
    if (nodeGap <= 0) { nodeGap = 14; }
    var linkOpacity = toNumber(config.link_opacity);
    if (linkOpacity <= 0) { linkOpacity = 0.4; }
    var showPct = config.show_percentages !== false;
    var showVals = config.show_values !== false;
    var showLabels = config.show_node_labels !== false;

    var padTop = 56;          // room for the header chip + step labels
    var padBottom = 26;       // room for the bottom node's value/pct text
    var padLeft = 8;
    var padRight = 8;

    var steps = model.steps;
    var nSteps = steps.length;

    var usableH = H - padTop - padBottom;
    var usableW = W - padLeft - padRight;
    if (usableH < 20 || usableW < 20) { return; }

    // global px-per-unit so link thickness matches at both ends
    var maxStepTotal = 1;
    var maxGapPx = 0;
    var st;
    for (st = 0; st < nSteps; st++) {
      if (steps[st].total > maxStepTotal) { maxStepTotal = steps[st].total; }
      var g = (steps[st].nodes.length - 1) * nodeGap;
      if (g > maxGapPx) { maxGapPx = g; }
    }
    var pxPerUnit = (usableH - maxGapPx) / maxStepTotal;
    if (pxPerUnit <= 0) { pxPerUnit = 0.0001; }

    // x position per step
    var stepGapX = nSteps > 1 ? (usableW - nodeWidth) / (nSteps - 1) : 0;
    function stepX(s) { return padLeft + s * stepGapX; }

    // lay out nodes: top-aligned column per step, compute y + height
    var nodeIndex = {}; // "s|key" -> node ref (with x,y,h,color,total)
    for (st = 0; st < nSteps; st++) {
      var y = padTop;
      var nodes = steps[st].nodes;
      for (var ni = 0; ni < nodes.length; ni++) {
        var node = nodes[ni];
        node.h = Math.max(1, node.total * pxPerUnit);
        node.x = stepX(st);
        node.y = y;
        node.outOffset = 0;
        node.inOffset = 0;
        nodeIndex[st + '|' + node.key] = node;
        y += node.h + nodeGap;
      }
    }

    var svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
    svg.style.display = 'block';
    svg.style.fontFamily = "'Google Sans','Roboto',Arial,sans-serif";

    // --- links first (under nodes) ---
    // order outgoing links by target node y, incoming by source node y, to reduce crossings
    var linksByStep = {};
    var li;
    for (li = 0; li < model.links.length; li++) {
      var lnk = model.links[li];
      if (!linksByStep[lnk.step]) { linksByStep[lnk.step] = []; }
      linksByStep[lnk.step].push(lnk);
    }
    for (var sKey in linksByStep) {
      if (!linksByStep.hasOwnProperty(sKey)) { continue; }
      var sIdx = parseInt(sKey, 10);
      var arr = linksByStep[sKey];
      arr.sort(function (a, b) {
        var ta = nodeIndex[(sIdx + 1) + '|' + a.toKey];
        var tb = nodeIndex[(sIdx + 1) + '|' + b.toKey];
        var ya = ta ? ta.y : 0;
        var yb = tb ? tb.y : 0;
        if (ya !== yb) { return ya - yb; }
        var sa = nodeIndex[sIdx + '|' + a.fromKey];
        var sb = nodeIndex[sIdx + '|' + b.fromKey];
        return (sa ? sa.y : 0) - (sb ? sb.y : 0);
      });
      for (li = 0; li < arr.length; li++) {
        drawLink(arr[li], sIdx);
      }
    }

    function drawLink(lnk, sIdx) {
      var src = nodeIndex[sIdx + '|' + lnk.fromKey];
      var tgt = nodeIndex[(sIdx + 1) + '|' + lnk.toKey];
      if (!src || !tgt) { return; }
      var thick = Math.max(0.5, lnk.weight * pxPerUnit);
      var x0 = src.x + nodeWidth;
      var x1 = tgt.x;
      var y0 = src.y + src.outOffset + thick / 2;
      var y1 = tgt.y + tgt.inOffset + thick / 2;
      src.outOffset += thick;
      tgt.inOffset += thick;
      var cx = (x0 + x1) / 2;
      var d = 'M' + x0 + ',' + y0 +
        ' C' + cx + ',' + y0 + ' ' + cx + ',' + y1 + ' ' + x1 + ',' + y1;
      var path = svgEl('path', {
        d: d, fill: 'none', stroke: src.color,
        'stroke-width': thick, 'stroke-opacity': linkOpacity
      });
      path.style.cursor = 'pointer';
      var pctOfSrc = src.total > 0 ? (lnk.weight / src.total) * 100 : 0;
      bindTip(path,
        '<b>' + escapeHtml(lnk.fromKey) + '</b> &rarr; <b>' + escapeHtml(lnk.toKey) + '</b>' +
        '<br>' + escapeHtml(model.measureLabel) + ': ' + formatNumber(lnk.weight) +
        '<br>' + formatPct(pctOfSrc) + ' of ' + escapeHtml(lnk.fromKey));
      path.addEventListener('mouseover', function () { this.setAttribute('stroke-opacity', Math.min(1, linkOpacity + 0.35)); });
      path.addEventListener('mouseout', function () { this.setAttribute('stroke-opacity', linkOpacity); });
      svg.appendChild(path);
    }

    // --- nodes + labels on top ---
    for (st = 0; st < nSteps; st++) {
      var stepNodes = steps[st].nodes;
      var isLast = (st === nSteps - 1);
      // last column hugs the right edge, so its text is drawn to the LEFT and end-anchored
      var headerX = isLast ? stepX(st) + nodeWidth : stepX(st);
      var headerAnchor = isLast ? 'end' : 'start';

      // step header label
      var hdr = svgEl('text', {
        x: headerX, y: 30, 'font-size': fontSize,
        'font-weight': 'bold', fill: '#5f6368', 'text-anchor': headerAnchor
      });
      hdr.textContent = 'Step ' + (st + 1);
      svg.appendChild(hdr);
      var hdr2 = svgEl('text', {
        x: headerX, y: 44, 'font-size': fontSize - 1, fill: '#80868b', 'text-anchor': headerAnchor
      });
      hdr2.textContent = truncate(steps[st].label, Math.max(8, Math.floor(stepGapX / (fontSize * 0.6))));
      svg.appendChild(hdr2);

      for (var k = 0; k < stepNodes.length; k++) {
        var nd = stepNodes[k];
        var rect = svgEl('rect', {
          x: nd.x, y: nd.y, width: nodeWidth, height: nd.h,
          fill: nd.color, rx: 1.5, ry: 1.5
        });
        rect.style.cursor = 'pointer';
        bindTip(rect,
          '<b>' + escapeHtml(nd.key) + '</b>' +
          '<br>' + escapeHtml(model.measureLabel) + ': ' + formatNumber(nd.total) +
          '<br>' + formatPct(nd.pct) + ' of Step 1');
        rect.addEventListener('mouseover', function () { this.setAttribute('opacity', '0.82'); });
        rect.addEventListener('mouseout', function () { this.setAttribute('opacity', '1'); });
        svg.appendChild(rect);

        if (showLabels) {
          var tx = isLast ? nd.x - 6 : nd.x + nodeWidth + 6;
          var anchor = isLast ? 'end' : 'start';
          var maxChars = Math.max(6, Math.floor((stepGapX - nodeWidth - 10) / (fontSize * 0.58)));
          // name
          var t1 = svgEl('text', { x: tx, y: nd.y + 12, 'font-size': fontSize, 'font-weight': 'bold', fill: '#202124', 'text-anchor': anchor });
          t1.textContent = truncate(nd.key, maxChars);
          var ttl = svgEl('title'); ttl.textContent = nd.key; t1.appendChild(ttl);
          svg.appendChild(t1);
          // value + pct
          var sub = [];
          if (showVals) { sub.push(formatNumber(nd.total)); }
          if (showPct) { sub.push(formatPct(nd.pct)); }
          if (sub.length) {
            var t2 = svgEl('text', { x: tx, y: nd.y + 12 + fontSize + 2, 'font-size': fontSize - 1, fill: '#5f6368', 'text-anchor': anchor });
            t2.textContent = sub.join('  ·  ');
            svg.appendChild(t2);
          }
        }
      }
    }

    // --- header chip (hidden/bucketed count) ---
    if (model.hiddenCount > 0) {
      var chip = svgEl('text', { x: W - padRight, y: 20, 'font-size': fontSize - 1, fill: '#80868b', 'text-anchor': 'end' });
      chip.textContent = model.hiddenCount + ' node(s) bucketed into "Other" (< ' + model.bucketPct + '% of step)';
      svg.appendChild(chip);
    }

    container.appendChild(svg);

    /* tooltip wiring */
    function bindTip(shape, html) {
      shape.addEventListener('mousemove', function (e) {
        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        var cw = container.clientWidth;
        var left = e.offsetX + 14;
        if (left + 220 > cw) { left = e.offsetX - 230; }
        tooltip.style.left = left + 'px';
        tooltip.style.top = (e.offsetY + 14) + 'px';
      });
      shape.addEventListener('mouseout', function () { tooltip.style.display = 'none'; });
    }
  }

  function truncate(s, n) {
    s = String(s);
    if (s.length <= n) { return s; }
    return s.substring(0, Math.max(1, n - 1)) + '…';
  }

  function renderMessage(container, msg) {
    while (container.firstChild) { container.removeChild(container.firstChild); }
    var div = document.createElement('div');
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.style.height = '100%';
    div.style.width = '100%';
    div.style.color = '#80868b';
    div.style.fontFamily = "'Google Sans','Roboto',Arial,sans-serif";
    div.style.fontSize = '13px';
    div.style.textAlign = 'center';
    div.style.padding = '12px';
    div.textContent = msg;
    container.appendChild(div);
  }

  /* ---------- registration ---------- */

  var VIS = {
    id: 'stepped_sankey',
    label: 'Stepped Funnel Sankey',
    options: {
      bucket_pct: {
        type: 'number', label: 'Bucket below (% of step) into "Other"',
        default: 5, display: 'number', section: 'Data', order: 1
      },
      palette: {
        type: 'string', label: 'Color Palette', display: 'select',
        values: [{ 'Looker': 'looker' }, { 'Cool': 'cool' }, { 'Warm': 'warm' }, { 'Mono Blue': 'mono' }],
        default: 'looker', section: 'Style', order: 1
      },
      show_node_labels: { type: 'boolean', label: 'Show Node Labels', default: true, section: 'Style', order: 2 },
      show_values: { type: 'boolean', label: 'Show Values', default: true, section: 'Style', order: 3 },
      show_percentages: { type: 'boolean', label: 'Show % of Step 1', default: true, section: 'Style', order: 4 },
      node_width: { type: 'number', label: 'Node Width (px)', default: 22, display: 'number', section: 'Style', order: 5 },
      node_gap: { type: 'number', label: 'Node Gap (px)', default: 14, display: 'number', section: 'Style', order: 6 },
      link_opacity: { type: 'number', label: 'Link Opacity (0-1)', default: 0.4, display: 'number', section: 'Style', order: 7 },
      font_size: { type: 'number', label: 'Font Size', default: 12, display: 'number', section: 'Style', order: 8 }
    },

    create: function (element, config) {
      var container = document.createElement('div');
      container.style.position = 'relative';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.overflow = 'hidden';

      var tooltip = document.createElement('div');
      tooltip.style.position = 'absolute';
      tooltip.style.display = 'none';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.background = 'rgba(32,33,36,0.95)';
      tooltip.style.color = '#fff';
      tooltip.style.padding = '6px 9px';
      tooltip.style.borderRadius = '4px';
      tooltip.style.fontSize = '12px';
      tooltip.style.fontFamily = "'Google Sans','Roboto',Arial,sans-serif";
      tooltip.style.lineHeight = '1.35';
      tooltip.style.maxWidth = '240px';
      tooltip.style.zIndex = '10';
      tooltip.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';

      container.appendChild(tooltip);
      element.appendChild(container);

      this._container = container;
      this._tooltip = tooltip;
      this._lastData = null;
      this._lastQR = null;
      this._lastConfig = null;

      var self = this;
      var rerender = debounce(function () {
        if (self._lastData) {
          try {
            var model = buildModel(self._lastData, self._lastQR, self._lastConfig || {});
            if (model.error) { renderMessage(self._container, model.error); }
            else { render(self._container, self._tooltip, self._lastConfig || {}, model); }
          } catch (e) { renderMessage(self._container, 'Render error: ' + e.message); }
        }
      }, 80);

      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(rerender);
        this._ro.observe(container);
      } else {
        this._winResize = rerender;
        window.addEventListener('resize', rerender);
      }
    },

    updateAsync: function (data, element, config, queryResponse, details, done) {
      this._lastData = data;
      this._lastQR = queryResponse;
      this._lastConfig = config || {};
      try {
        var model = buildModel(data, queryResponse, this._lastConfig);
        if (model.error) { renderMessage(this._container, model.error); }
        else { render(this._container, this._tooltip, this._lastConfig, model); }
      } catch (e) {
        renderMessage(this._container, 'Render error: ' + e.message);
      } finally {
        if (typeof done === 'function') { done(); }
      }
    },

    destroy: function () {
      if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
      if (this._winResize) { window.removeEventListener('resize', this._winResize); this._winResize = null; }
      this._container = null;
      this._tooltip = null;
      this._lastData = null;
    }
  };

  if (typeof window !== 'undefined' && window.looker && window.looker.plugins && window.looker.plugins.visualizations) {
    window.looker.plugins.visualizations.add(VIS);
  }

  // exposed for the local synthetic-data harness (no-op inside Looker)
  if (typeof window !== 'undefined') { window.__STEPPED_SANKEY__ = VIS; }
})();
