/*
 * Stepped / Funnel-style Sankey — Looker custom visualization
 *
 * One self-contained IIFE. Vanilla JS + SVG, no dependencies, no build step.
 *
 * Two input modes (option "Input Mode"):
 *   - "stepped": N dimensions (>= 2, each an ordered step) + 1 measure (flow weight).
 *       Distinct values at a step are nodes; ribbons connect consecutive steps.
 *   - "edges":   2 dimensions (source node, target node) + 1 measure (edge weight).
 *       Renders an edge-list Sankey; node columns are placed by longest-path depth,
 *       so skipped stages and branches (e.g. Failed / Cancelled) render naturally.
 *
 * Nodes below a configurable share of their column total are bucketed into "Other".
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

  function truncate(s, n) {
    s = String(s);
    if (s.length <= n) { return s; }
    return s.substring(0, Math.max(1, n - 1)) + '…';
  }

  function assignColors(columns, palette) {
    var colorMap = {};
    var idx = 0;
    for (var c = 0; c < columns.length; c++) {
      var nodes = columns[c].nodes;
      for (var i = 0; i < nodes.length; i++) {
        var lbl = nodes[i].key;
        if (lbl === OTHER_LABEL) { nodes[i].color = OTHER_COLOR; continue; }
        if (!colorMap[lbl]) { colorMap[lbl] = palette[idx % palette.length]; idx++; }
        nodes[i].color = colorMap[lbl];
      }
    }
  }

  /* ---------- data transform: STEPPED mode ---------- */

  function buildSteppedModel(data, queryResponse, config) {
    var dims = (queryResponse && queryResponse.fields && queryResponse.fields.dimension_like) || [];
    var measures = (queryResponse && queryResponse.fields && queryResponse.fields.measure_like) || [];

    if (dims.length < 2) {
      return { error: 'Stepped mode needs at least 2 dimensions (each is a step). Add another dimension.' };
    }
    if (measures.length < 1) {
      return { error: 'Stepped mode needs 1 measure (the flow weight). Add a measure.' };
    }
    if (!data || data.length === 0) { return { error: 'No data.' }; }

    var measure = measures[0];
    var measureName = measure.name;
    var measureLabel = measure.label_short || measure.label || measureName;
    var bucketPct = Math.max(0, toNumber(config.bucket_pct));
    var nSteps = dims.length;
    var s, i, r;

    var rawSteps = [];
    for (s = 0; s < nSteps; s++) {
      rawSteps.push({ index: s, label: dims[s].label_short || dims[s].label || dims[s].name, nodes: {} });
    }
    var rawLinks = {};

    for (r = 0; r < data.length; r++) {
      var row = data[r];
      var m = cellNumber(row[measureName]);
      if (m === 0) { continue; }
      var vals = [];
      for (s = 0; s < nSteps; s++) { vals.push(cellString(row[dims[s].name])); }
      for (s = 0; s < nSteps; s++) {
        var v = vals[s];
        if (v === '') { continue; }
        rawSteps[s].nodes[v] = (rawSteps[s].nodes[v] || 0) + m;
        if (s < nSteps - 1 && vals[s + 1] !== '') {
          var lk = s + '' + v + '' + vals[s + 1];
          rawLinks[lk] = (rawLinks[lk] || 0) + m;
        }
      }
    }

    for (s = 0; s < nSteps; s++) {
      var tot = 0, no = rawSteps[s].nodes;
      for (var key in no) { if (no.hasOwnProperty(key)) { tot += no[key]; } }
      rawSteps[s].total = tot;
    }
    var firstTotal = rawSteps[0].total || 1;

    var relabel = [];
    var hiddenCount = 0;
    var columns = [];
    for (s = 0; s < nSteps; s++) {
      var stepNodes = rawSteps[s].nodes;
      var stepTotal = rawSteps[s].total || 1;
      var threshold = (bucketPct / 100) * stepTotal;
      var map = {}, kept = {}, otherTotal = 0;
      for (var nk in stepNodes) {
        if (!stepNodes.hasOwnProperty(nk)) { continue; }
        if (bucketPct > 0 && stepNodes[nk] < threshold) {
          map[nk] = OTHER_LABEL; otherTotal += stepNodes[nk]; hiddenCount++;
        } else {
          map[nk] = nk; kept[nk] = (kept[nk] || 0) + stepNodes[nk];
        }
      }
      if (otherTotal > 0) { kept[OTHER_LABEL] = (kept[OTHER_LABEL] || 0) + otherTotal; }
      relabel.push(map);
      var arr = [];
      for (var dk in kept) { if (kept.hasOwnProperty(dk)) { arr.push({ key: dk, total: kept[dk] }); } }
      arr.sort(function (a, b) {
        if (a.key === OTHER_LABEL) { return 1; }
        if (b.key === OTHER_LABEL) { return -1; }
        return b.total - a.total;
      });
      for (i = 0; i < arr.length; i++) { arr[i].pct = (arr[i].total / firstTotal) * 100; arr[i].col = s; }
      columns.push({ index: s, label: rawSteps[s].label, nodes: arr });
    }

    var linkAgg = {};
    for (var rl in rawLinks) {
      if (!rawLinks.hasOwnProperty(rl)) { continue; }
      var parts = rl.split('');
      var ls = parseInt(parts[0], 10);
      var dispSrc = relabel[ls][parts[1]] || parts[1];
      var dispTgt = relabel[ls + 1][parts[2]] || parts[2];
      var ak = ls + '' + dispSrc + '' + dispTgt;
      linkAgg[ak] = (linkAgg[ak] || 0) + rawLinks[rl];
    }
    var links = [];
    for (var la in linkAgg) {
      if (!linkAgg.hasOwnProperty(la)) { continue; }
      var lp = la.split('');
      var fc = parseInt(lp[0], 10);
      links.push({ fromCol: fc, toCol: fc + 1, fromKey: lp[1], toKey: lp[2], weight: linkAgg[la] });
    }

    assignColors(columns, PALETTES[config.palette] || PALETTES.looker);
    return {
      columns: columns, links: links, measureLabel: measureLabel,
      hiddenCount: hiddenCount, bucketPct: bucketPct, pctRef: firstTotal,
      showHeaders: true, showPct: true
    };
  }

  /* ---------- data transform: EDGES mode ---------- */

  function buildEdgeModel(data, queryResponse, config) {
    var dims = (queryResponse && queryResponse.fields && queryResponse.fields.dimension_like) || [];
    var measures = (queryResponse && queryResponse.fields && queryResponse.fields.measure_like) || [];

    if (dims.length < 2) {
      return { error: 'Edges mode needs 2 dimensions: source then target. Add the target dimension.' };
    }
    if (measures.length < 1) {
      return { error: 'Edges mode needs 1 measure (the edge weight). Add a measure.' };
    }
    if (!data || data.length === 0) { return { error: 'No data.' }; }

    var srcName = dims[0].name, tgtName = dims[1].name;
    var measure = measures[0];
    var measureName = measure.name;
    var measureLabel = measure.label_short || measure.label || measureName;

    var edgeAgg = {};
    var outSum = {}, inSum = {}, adj = {};
    var r;
    for (r = 0; r < data.length; r++) {
      var row = data[r];
      var w = cellNumber(row[measureName]);
      if (w === 0) { continue; }
      var src = cellString(row[srcName]);
      var tgt = cellString(row[tgtName]);
      if (src === '' || tgt === '' || src === tgt) { continue; }
      var ek = src + '' + tgt;
      edgeAgg[ek] = (edgeAgg[ek] || 0) + w;
      outSum[src] = (outSum[src] || 0) + w;
      inSum[tgt] = (inSum[tgt] || 0) + w;
      if (!inSum[src]) { inSum[src] = inSum[src] || 0; }
      if (!outSum[tgt]) { outSum[tgt] = outSum[tgt] || 0; }
      if (!adj[src]) { adj[src] = []; }
      adj[src].push(tgt);
    }

    var nodeKeys = {};
    var n;
    for (n in outSum) { if (outSum.hasOwnProperty(n)) { nodeKeys[n] = true; } }
    for (n in inSum) { if (inSum.hasOwnProperty(n)) { nodeKeys[n] = true; } }
    var allNodes = [];
    for (n in nodeKeys) { if (nodeKeys.hasOwnProperty(n)) { allNodes.push(n); } }

    // Detect back-edges with a DFS so the layout uses only the acyclic (forward) edges.
    // The lifecycle can contain cycles (e.g. Shipped -> Tracking synced -> Printed); without
    // this, longest-path relaxation inflates depths to the node count and ribbons span the
    // whole chart.
    var stateMap = {}; // 0 unvisited, 1 on-stack, 2 done
    var backEdge = {};
    for (var z = 0; z < allNodes.length; z++) { stateMap[allNodes[z]] = 0; }
    function visit(u) {
      stateMap[u] = 1;
      var nbrs = adj[u] || [];
      for (var j = 0; j < nbrs.length; j++) {
        var v = nbrs[j];
        if (stateMap[v] === 1) { backEdge[u + '' + v] = true; }
        else if (stateMap[v] === 0) { visit(v); }
      }
      stateMap[u] = 2;
    }
    // start from roots (no incoming) first, then any remaining nodes
    for (var rn = 0; rn < allNodes.length; rn++) {
      if (!(inSum[allNodes[rn]] > 0) && stateMap[allNodes[rn]] === 0) { visit(allNodes[rn]); }
    }
    for (var rn2 = 0; rn2 < allNodes.length; rn2++) {
      if (stateMap[allNodes[rn2]] === 0) { visit(allNodes[rn2]); }
    }

    // longest-path depth over forward (non-back) edges only — acyclic, converges cleanly
    var depth = {};
    for (var a = 0; a < allNodes.length; a++) { depth[allNodes[a]] = 0; }
    var iterations = allNodes.length;
    for (var it = 0; it < iterations; it++) {
      var changed = false;
      for (var u2 in adj) {
        if (!adj.hasOwnProperty(u2)) { continue; }
        var nb = adj[u2];
        for (var jj = 0; jj < nb.length; jj++) {
          var v2 = nb[jj];
          if (backEdge[u2 + '' + v2]) { continue; }
          if (depth[v2] < depth[u2] + 1) { depth[v2] = depth[u2] + 1; changed = true; }
        }
      }
      if (!changed) { break; }
    }

    var maxDepth = 0;
    for (n in depth) { if (depth.hasOwnProperty(n) && depth[n] > maxDepth) { maxDepth = depth[n]; } }

    var columns = [];
    for (var c = 0; c <= maxDepth; c++) { columns.push({ index: c, label: '', nodes: [] }); }
    var firstColTotal = 0;
    for (var b = 0; b < allNodes.length; b++) {
      var key = allNodes[b];
      var total = Math.max(outSum[key] || 0, inSum[key] || 0);
      var node = { key: key, total: total, col: depth[key] };
      columns[depth[key]].nodes.push(node);
      if (depth[key] === 0) { firstColTotal += total; }
    }
    if (firstColTotal === 0) { firstColTotal = 1; }
    for (c = 0; c < columns.length; c++) {
      columns[c].nodes.sort(function (a2, b2) { return b2.total - a2.total; });
      for (var k = 0; k < columns[c].nodes.length; k++) {
        columns[c].nodes[k].pct = (columns[c].nodes[k].total / firstColTotal) * 100;
      }
    }

    var links = [];
    for (var ek2 in edgeAgg) {
      if (!edgeAgg.hasOwnProperty(ek2)) { continue; }
      var pp = ek2.split('');
      links.push({ fromCol: depth[pp[0]], toCol: depth[pp[1]], fromKey: pp[0], toKey: pp[1], weight: edgeAgg[ek2] });
    }

    assignColors(columns, PALETTES[config.palette] || PALETTES.looker);
    return {
      columns: columns, links: links, measureLabel: measureLabel,
      hiddenCount: 0, pctRef: firstColTotal, showHeaders: false, showPct: false
    };
  }

  /* ---------- render (shared by both modes) ---------- */

  function render(container, tooltip, config, model) {
    while (container.firstChild) { container.removeChild(container.firstChild); }

    var W = container.clientWidth || 800;
    var H = container.clientHeight || 500;
    if (W < 40 || H < 40) { return; }

    var fontSize = toNumber(config.font_size) || 12;
    var nodeWidth = toNumber(config.node_width) || 22;
    var nodeGap = toNumber(config.node_gap); if (nodeGap <= 0) { nodeGap = 14; }
    var linkOpacity = toNumber(config.link_opacity); if (linkOpacity <= 0) { linkOpacity = 0.4; }
    var showPct = config.show_percentages !== false && model.showPct;
    var showVals = config.show_values !== false;
    var showLabels = config.show_node_labels !== false;

    var padTop = model.showHeaders ? 56 : 36;
    var padBottom = 26;
    var padLeft = 8;
    var padRight = 8;

    var columns = model.columns;
    var nCols = columns.length;
    if (nCols === 0) { renderMessage(container, 'No nodes to display.'); return; }

    var usableH = H - padTop - padBottom;
    var usableW = W - padLeft - padRight;
    if (usableH < 20 || usableW < 20) { return; }

    var maxColTotal = 1, maxGapPx = 0, c, nodes, i;
    for (c = 0; c < nCols; c++) {
      var colTotal = 0;
      for (i = 0; i < columns[c].nodes.length; i++) { colTotal += columns[c].nodes[i].total; }
      if (colTotal > maxColTotal) { maxColTotal = colTotal; }
      var g = (columns[c].nodes.length - 1) * nodeGap;
      if (g > maxGapPx) { maxGapPx = g; }
    }
    var pxPerUnit = (usableH - maxGapPx) / maxColTotal;
    if (pxPerUnit <= 0) { pxPerUnit = 0.0001; }

    var stepGapX = nCols > 1 ? (usableW - nodeWidth) / (nCols - 1) : 0;
    function colX(c2) { return padLeft + c2 * stepGapX; }

    var nodeIndex = {};
    for (c = 0; c < nCols; c++) {
      var y = padTop;
      nodes = columns[c].nodes;
      for (i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        node.h = Math.max(1, node.total * pxPerUnit);
        node.x = colX(c); node.y = y; node.outOffset = 0; node.inOffset = 0;
        nodeIndex[c + '|' + node.key] = node;
        y += node.h + nodeGap;
      }
    }

    var svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
    svg.style.display = 'block';
    svg.style.fontFamily = "'Google Sans','Roboto',Arial,sans-serif";

    function bindTip(shape, html) {
      shape.addEventListener('mousemove', function (e) {
        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        var left = e.offsetX + 14;
        if (left + 220 > container.clientWidth) { left = e.offsetX - 230; }
        tooltip.style.left = left + 'px';
        tooltip.style.top = (e.offsetY + 14) + 'px';
      });
      shape.addEventListener('mouseout', function () { tooltip.style.display = 'none'; });
    }

    // links first
    var byCol = {};
    var li;
    for (li = 0; li < model.links.length; li++) {
      var lnk = model.links[li];
      if (!byCol[lnk.fromCol]) { byCol[lnk.fromCol] = []; }
      byCol[lnk.fromCol].push(lnk);
    }
    for (var sk in byCol) {
      if (!byCol.hasOwnProperty(sk)) { continue; }
      var arr = byCol[sk];
      arr.sort(function (a, b) {
        var ta = nodeIndex[a.toCol + '|' + a.toKey], tb = nodeIndex[b.toCol + '|' + b.toKey];
        return (ta ? ta.y : 0) - (tb ? tb.y : 0);
      });
      for (li = 0; li < arr.length; li++) { drawLink(arr[li]); }
    }

    function drawLink(lnk) {
      var src = nodeIndex[lnk.fromCol + '|' + lnk.fromKey];
      var tgt = nodeIndex[lnk.toCol + '|' + lnk.toKey];
      if (!src || !tgt) { return; }
      var thick = Math.max(0.5, lnk.weight * pxPerUnit);
      var x0 = src.x + nodeWidth, x1 = tgt.x;
      var y0 = src.y + src.outOffset + thick / 2;
      var y1 = tgt.y + tgt.inOffset + thick / 2;
      src.outOffset += thick; tgt.inOffset += thick;
      var cx = (x0 + x1) / 2;
      var path = svgEl('path', {
        d: 'M' + x0 + ',' + y0 + ' C' + cx + ',' + y0 + ' ' + cx + ',' + y1 + ' ' + x1 + ',' + y1,
        fill: 'none', stroke: src.color, 'stroke-width': thick, 'stroke-opacity': linkOpacity
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

    // nodes + labels
    for (c = 0; c < nCols; c++) {
      var isLast = (c === nCols - 1);
      nodes = columns[c].nodes;

      if (model.showHeaders) {
        var hx = isLast ? colX(c) + nodeWidth : colX(c);
        var ha = isLast ? 'end' : 'start';
        var hdr = svgEl('text', { x: hx, y: 30, 'font-size': fontSize, 'font-weight': 'bold', fill: '#5f6368', 'text-anchor': ha });
        hdr.textContent = 'Step ' + (c + 1);
        svg.appendChild(hdr);
        var hdr2 = svgEl('text', { x: hx, y: 44, 'font-size': fontSize - 1, fill: '#80868b', 'text-anchor': ha });
        hdr2.textContent = truncate(columns[c].label, Math.max(8, Math.floor(stepGapX / (fontSize * 0.6))));
        svg.appendChild(hdr2);
      }

      for (var kk = 0; kk < nodes.length; kk++) {
        var nd = nodes[kk];
        var rect = svgEl('rect', { x: nd.x, y: nd.y, width: nodeWidth, height: nd.h, fill: nd.color, rx: 1.5, ry: 1.5 });
        rect.style.cursor = 'pointer';
        var tip = '<b>' + escapeHtml(nd.key) + '</b><br>' + escapeHtml(model.measureLabel) + ': ' + formatNumber(nd.total);
        if (model.showPct) { tip += '<br>' + formatPct(nd.pct) + ' of start'; }
        bindTip(rect, tip);
        rect.addEventListener('mouseover', function () { this.setAttribute('opacity', '0.82'); });
        rect.addEventListener('mouseout', function () { this.setAttribute('opacity', '1'); });
        svg.appendChild(rect);

        if (showLabels) {
          var tx = isLast ? nd.x - 6 : nd.x + nodeWidth + 6;
          var anchor = isLast ? 'end' : 'start';
          var maxChars = Math.max(6, Math.floor((stepGapX - nodeWidth - 10) / (fontSize * 0.58)));
          var t1 = svgEl('text', { x: tx, y: nd.y + 12, 'font-size': fontSize, 'font-weight': 'bold', fill: '#202124', 'text-anchor': anchor });
          t1.textContent = truncate(nd.key, maxChars);
          var ttl = svgEl('title'); ttl.textContent = nd.key; t1.appendChild(ttl);
          svg.appendChild(t1);
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

    if (model.hiddenCount > 0) {
      var chip = svgEl('text', { x: W - padRight, y: 20, 'font-size': fontSize - 1, fill: '#80868b', 'text-anchor': 'end' });
      chip.textContent = model.hiddenCount + ' node(s) bucketed into "Other" (< ' + model.bucketPct + '% of step)';
      svg.appendChild(chip);
    }

    container.appendChild(svg);
  }

  function renderMessage(container, msg) {
    while (container.firstChild) { container.removeChild(container.firstChild); }
    var div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;width:100%;' +
      "color:#80868b;font-family:'Google Sans','Roboto',Arial,sans-serif;font-size:13px;text-align:center;padding:12px;";
    div.textContent = msg;
    container.appendChild(div);
  }

  function buildModel(data, queryResponse, config) {
    if (config && config.input_mode === 'edges') { return buildEdgeModel(data, queryResponse, config); }
    return buildSteppedModel(data, queryResponse, config);
  }

  /* ---------- registration ---------- */

  var VIS = {
    id: 'stepped_sankey',
    label: 'Stepped Funnel Sankey',
    options: {
      input_mode: {
        type: 'string', label: 'Input Mode', display: 'select',
        values: [{ 'Stepped (N dims = steps)': 'stepped' }, { 'Edges (source, target)': 'edges' }],
        default: 'stepped', section: 'Data', order: 0
      },
      bucket_pct: {
        type: 'number', label: 'Bucket below (% of step) into "Other" [stepped]',
        default: 5, display: 'number', section: 'Data', order: 1
      },
      palette: {
        type: 'string', label: 'Color Palette', display: 'select',
        values: [{ 'Looker': 'looker' }, { 'Cool': 'cool' }, { 'Warm': 'warm' }, { 'Mono Blue': 'mono' }],
        default: 'looker', section: 'Style', order: 1
      },
      show_node_labels: { type: 'boolean', label: 'Show Node Labels', default: true, section: 'Style', order: 2 },
      show_values: { type: 'boolean', label: 'Show Values', default: true, section: 'Style', order: 3 },
      show_percentages: { type: 'boolean', label: 'Show % (stepped)', default: true, section: 'Style', order: 4 },
      node_width: { type: 'number', label: 'Node Width (px)', default: 22, display: 'number', section: 'Style', order: 5 },
      node_gap: { type: 'number', label: 'Node Gap (px)', default: 14, display: 'number', section: 'Style', order: 6 },
      link_opacity: { type: 'number', label: 'Link Opacity (0-1)', default: 0.4, display: 'number', section: 'Style', order: 7 },
      font_size: { type: 'number', label: 'Font Size', default: 12, display: 'number', section: 'Style', order: 8 }
    },

    create: function (element, config) {
      var container = document.createElement('div');
      container.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;';
      var tooltip = document.createElement('div');
      tooltip.style.cssText = 'position:absolute;display:none;pointer-events:none;background:rgba(32,33,36,0.95);' +
        "color:#fff;padding:6px 9px;border-radius:4px;font-size:12px;font-family:'Google Sans','Roboto',Arial,sans-serif;" +
        'line-height:1.35;max-width:240px;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,0.3);';
      container.appendChild(tooltip);
      element.appendChild(container);

      this._container = container;
      this._tooltip = tooltip;
      this._lastData = null; this._lastQR = null; this._lastConfig = null;

      var self = this;
      var rerender = debounce(function () {
        if (!self._lastData) { return; }
        try {
          var model = buildModel(self._lastData, self._lastQR, self._lastConfig || {});
          if (model.error) { renderMessage(self._container, model.error); }
          else { render(self._container, self._tooltip, self._lastConfig || {}, model); }
        } catch (e) { renderMessage(self._container, 'Render error: ' + e.message); }
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
      this._lastData = data; this._lastQR = queryResponse; this._lastConfig = config || {};
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
      this._container = null; this._tooltip = null; this._lastData = null;
    }
  };

  if (typeof window !== 'undefined' && window.looker && window.looker.plugins && window.looker.plugins.visualizations) {
    window.looker.plugins.visualizations.add(VIS);
  }
  if (typeof window !== 'undefined') { window.__STEPPED_SANKEY__ = VIS; }
})();
