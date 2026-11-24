(() => {
  'use strict';

  // ---------- Config ----------
  const COLORS = [
    { name: 'White',  v: '#FFFFFF' },
    { name: 'Yellow', v: '#FFE066' },
    { name: 'Orange', v: '#FFA94D' },
    { name: 'Red',    v: '#FF6B6B' },
    { name: 'Pink',   v: '#F7A8C8' },
    { name: 'Purple', v: '#B197FC' },
    { name: 'Blue',   v: '#74C0FC' },
    { name: 'Green',  v: '#8CE99A' },
  ];
  const DEFAULT_SIZE = { square: [120, 120], rectangle: [180, 110], circle: [120, 120], triangle: [140, 120] };
  const LOCK_ASPECT = { square: true, circle: true };
  const TYPES = Object.keys(DEFAULT_SIZE);
  const STROKE = 'stroke="#111" stroke-width="2" stroke-linejoin="round"';
  const START_CANVAS = { w: 3000, h: 2000 };
  const MAX_CANVAS_W = 200000;   // 3000 × 2^6 = 192 000 is the largest step
  const MIN_SIZE = 24;
  const FONT = 16;
  const STORE_KEY = 'whiteboard.v1';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const svg = $('board'), bg = $('bg'), connLayer = $('conns'), shapeLayer = $('shapes'), uiLayer = $('ui');
  const scroller = $('scroller'), stage = $('stage'), editor = $('editor');

  // ---------- State ----------
  let state = load() || blank();
  let zoom = 1;
  let selected = null;           // { kind: 'shape' | 'conn', id }
  let currentColor = COLORS[1].v;
  let editingId = null;
  let drag = null;
  let spaceDown = false;
  let history = [JSON.stringify(state)];
  let hIndex = 0;

  function blank() { return { canvas: { ...START_CANVAS }, shapes: [], connectors: [] }; }
  const uid = () => Math.random().toString(36).slice(2, 10);
  const getShape = (id) => state.shapes.find((s) => s.id === id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function valid(d) {
    return d && d.canvas && d.canvas.w > 0 && d.canvas.h > 0 &&
      Array.isArray(d.shapes) && Array.isArray(d.connectors) &&
      d.shapes.every((s) => s && s.id && TYPES.includes(s.type) && [s.x, s.y, s.w, s.h].every(Number.isFinite));
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY));
      return valid(d) ? normalise(d) : null;
    } catch { return null; }
  }
  function normalise(d) {
    const ids = new Set(d.shapes.map((s) => s.id));
    return {
      canvas: { w: d.canvas.w, h: d.canvas.h },
      shapes: d.shapes.map((s) => ({ id: String(s.id), type: s.type, x: s.x, y: s.y, w: s.w, h: s.h,
        color: typeof s.color === 'string' ? s.color : '#FFFFFF', text: typeof s.text === 'string' ? s.text : '' })),
      connectors: d.connectors.filter((c) => ids.has(c.from) && ids.has(c.to) && c.from !== c.to)
        .map((c) => ({ id: String(c.id || uid()), from: c.from, to: c.to })),
    };
  }
  function save(json) { try { localStorage.setItem(STORE_KEY, json); } catch { /* storage unavailable */ } }

  // ---------- History ----------
  function commit() {
    const json = JSON.stringify(state);
    if (json === history[hIndex]) return;
    history = history.slice(0, hIndex + 1);
    history.push(json);
    if (history.length > 200) history.shift();
    hIndex = history.length - 1;
    save(json);
    updateButtons();
  }
  function restore(i) {
    hIndex = i;
    state = JSON.parse(history[i]);
    if (selected && !(selected.kind === 'shape' ? getShape(selected.id) : state.connectors.some((c) => c.id === selected.id))) selected = null;
    save(history[i]);
    render();
  }
  const undo = () => { if (hIndex > 0) restore(hIndex - 1); };
  const redo = () => { if (hIndex < history.length - 1) restore(hIndex + 1); };

  // ---------- Geometry ----------
  const center = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
  const triPoints = (s) => [[s.x + s.w / 2, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];

  function textBox(s) {
    if (s.type === 'triangle') return { x: s.x + s.w * 0.22, y: s.y + s.h * 0.42, w: s.w * 0.56, h: s.h * 0.52 };
    const p = s.type === 'circle' ? Math.min(s.w, s.h) * 0.15 : 8;
    return { x: s.x + p, y: s.y + p, w: Math.max(0, s.w - 2 * p), h: Math.max(0, s.h - 2 * p) };
  }

  // Point where a ray from the shape's centre towards `to` leaves the shape outline.
  function boundaryPoint(s, to) {
    const c = center(s);
    const dx = to.x - c.x, dy = to.y - c.y;
    if (!dx && !dy) return c;
    let t;
    if (s.type === 'circle') {
      t = 1 / Math.hypot(dx / (s.w / 2), dy / (s.h / 2));
    } else if (s.type === 'triangle') {
      const pts = triPoints(s);
      t = Infinity;
      for (let i = 0; i < 3; i++) {
        const [px, py] = pts[i], [qx, qy] = pts[(i + 1) % 3];
        const ex = qx - px, ey = qy - py;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const tt = ((px - c.x) * ey - (py - c.y) * ex) / den;
        const u = ((px - c.x) * dy - (py - c.y) * dx) / den;
        if (tt > 0 && u >= -1e-9 && u <= 1 + 1e-9) t = Math.min(t, tt);
      }
      if (!isFinite(t)) return c;
    } else {
      t = Math.min(dx ? (s.w / 2) / Math.abs(dx) : Infinity, dy ? (s.h / 2) / Math.abs(dy) : Infinity);
    }
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  function clientToCanvas(cx, cy) {
    const r = svg.getBoundingClientRect();
    return { x: (cx - r.left) / zoom, y: (cy - r.top) / zoom };
  }
  function viewCenterClient() {
    const r = scroller.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  // Scroll so canvas point p sits under client point (cx, cy).
  function scrollTo(p, cx, cy) {
    const r = svg.getBoundingClientRect();
    scroller.scrollLeft += r.left + p.x * zoom - cx;
    scroller.scrollTop += r.top + p.y * zoom - cy;
  }

  // ---------- Rendering ----------
  function shapeSVG(s) {
    const fill = `fill="${esc(s.color)}"`;
    let body;
    if (s.type === 'circle') {
      body = `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}" ${fill} ${STROKE}/>`;
    } else if (s.type === 'triangle') {
      body = `<polygon points="${triPoints(s).map((p) => p.join(',')).join(' ')}" ${fill} ${STROKE}/>`;
    } else {
      body = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" ${fill} ${STROKE}/>`;
    }
    let label = '';
    if (s.text && editingId !== s.id) {
      const t = textBox(s);
      label = `<foreignObject x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" pointer-events="none">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" class="label">${esc(s.text)}</div></foreignObject>`;
    }
    return `<g class="shape" data-shape="${s.id}">${body}${label}</g>`;
  }

  function connSVG(c) {
    const a = getShape(c.from), b = getShape(c.to);
    if (!a || !b) return '';
    const p1 = boundaryPoint(a, center(b)), p2 = boundaryPoint(b, center(a));
    const sel = selected && selected.kind === 'conn' && selected.id === c.id;
    const d = `x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"`;
    return `<g data-conn="${c.id}">` +
      `<line ${d} stroke="transparent" stroke-width="${14 / zoom}"/>` +
      `<line ${d} stroke="${sel ? '#2563eb' : '#111'}" stroke-width="2" marker-end="url(#${sel ? 'arrowSel' : 'arrow'})"/></g>`;
  }

  function uiSVG() {
    const k = 1 / zoom;
    let out = '';
    const s = selected && selected.kind === 'shape' ? getShape(selected.id) : null;
    if (s && !(drag && drag.mode === 'move' && drag.moved)) {
      const pad = 4 * k;
      out += `<rect x="${s.x - pad}" y="${s.y - pad}" width="${s.w + 2 * pad}" height="${s.h + 2 * pad}" fill="none" stroke="#2563eb" stroke-width="${1.5 * k}" stroke-dasharray="${5 * k} ${4 * k}" pointer-events="none"/>`;
      const hs = 10 * k;
      const corners = { nw: [s.x, s.y], ne: [s.x + s.w, s.y], sw: [s.x, s.y + s.h], se: [s.x + s.w, s.y + s.h] };
      for (const [name, [x, y]] of Object.entries(corners)) {
        out += `<rect data-handle="${name}" x="${x - hs / 2 - (name.includes('w') ? pad : -pad)}" y="${y - hs / 2 - (name.includes('n') ? pad : -pad)}" width="${hs}" height="${hs}" fill="#fff" stroke="#2563eb" stroke-width="${1.5 * k}" style="cursor:${name === 'nw' || name === 'se' ? 'nwse' : 'nesw'}-resize"/>`;
      }
      if (!drag || drag.mode === 'connect') {
        const off = 22 * k, c = center(s);
        const anchors = { n: [c.x, s.y - off], e: [s.x + s.w + off, c.y], s: [c.x, s.y + s.h + off], w: [s.x - off, c.y] };
        for (const [name, [x, y]] of Object.entries(anchors)) {
          out += `<circle data-anchor="${name}" cx="${x}" cy="${y}" r="${7 * k}" fill="#2563eb" stroke="#fff" stroke-width="${2 * k}" style="cursor:crosshair"><title>Drag to another shape to connect</title></circle>`;
        }
      }
    }
    if (drag && drag.mode === 'connect') {
      const from = getShape(drag.from), target = drag.over ? getShape(drag.over) : null;
      if (from) {
        const end = target ? boundaryPoint(target, center(from)) : drag.p;
        const start = boundaryPoint(from, target ? center(target) : drag.p);
        if (target) {
          out += `<rect x="${target.x - 6 * k}" y="${target.y - 6 * k}" width="${target.w + 12 * k}" height="${target.h + 12 * k}" fill="rgba(37,99,235,.08)" stroke="#2563eb" stroke-width="${2 * k}" rx="${4 * k}" pointer-events="none"/>`;
        }
        out += `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#2563eb" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#arrowSel)" pointer-events="none"/>`;
      }
    }
    return out;
  }

  function render() {
    const { w, h } = state.canvas;
    svg.setAttribute('width', w * zoom);
    svg.setAttribute('height', h * zoom);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    bg.setAttribute('width', w);
    bg.setAttribute('height', h);
    connLayer.innerHTML = state.connectors.map(connSVG).join('');
    shapeLayer.innerHTML = state.shapes.map(shapeSVG).join('');
    uiLayer.innerHTML = uiSVG();
    $('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
    $('sizeLabel').textContent = `${w.toLocaleString()} × ${h.toLocaleString()}`;
    if (editingId) positionEditor();
    updateButtons();
    updateSwatches();
  }

  function updateButtons() {
    $('undo').disabled = hIndex <= 0;
    $('redo').disabled = hIndex >= history.length - 1;
    $('expand').disabled = state.canvas.w * 2 > MAX_CANVAS_W;
  }

  // ---------- Colours ----------
  const swatchBox = $('swatches');
  swatchBox.innerHTML = COLORS.map((c) =>
    `<button class="swatch" data-color="${c.v}" title="${c.name}" aria-label="${c.name}" style="background:${c.v}"></button>`).join('');
  swatchBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    currentColor = b.dataset.color;
    const s = selected && selected.kind === 'shape' && getShape(selected.id);
    if (s) { s.color = currentColor; render(); commit(); } else updateSwatches();
  });
  function updateSwatches() {
    const s = selected && selected.kind === 'shape' && getShape(selected.id);
    const active = s ? s.color : currentColor;
    swatchBox.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === active.toLowerCase()));
    document.documentElement.style.setProperty('--shape-fill', currentColor);
  }

  // ---------- Selection & edits ----------
  function select(sel) { selected = sel; }

  function addShape(type, p) {
    const [w, h] = DEFAULT_SIZE[type];
    const s = {
      id: uid(), type, w, h, color: currentColor, text: '',
      x: clamp(p.x - w / 2, 0, state.canvas.w - w),
      y: clamp(p.y - h / 2, 0, state.canvas.h - h),
    };
    state.shapes.push(s);
    select({ kind: 'shape', id: s.id });
    render();
    commit();
  }

  function deleteSelected() {
    if (!selected) return;
    if (selected.kind === 'shape') {
      state.shapes = state.shapes.filter((s) => s.id !== selected.id);
      state.connectors = state.connectors.filter((c) => c.from !== selected.id && c.to !== selected.id);
    } else {
      state.connectors = state.connectors.filter((c) => c.id !== selected.id);
    }
    selected = null;
    render();
    commit();
  }

  function bringToFront(id) {
    const i = state.shapes.findIndex((s) => s.id === id);
    if (i >= 0 && i < state.shapes.length - 1) state.shapes.push(...state.shapes.splice(i, 1));
  }

  // ---------- Text editing ----------
  function startEdit(id, append = '') {
    const s = getShape(id);
    if (!s) return;
    editingId = id;
    select({ kind: 'shape', id });
    render();
    editor.hidden = false;
    editor.value = s.text + append;
    positionEditor();
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }
  function positionEditor() {
    const s = getShape(editingId);
    if (!s) return finishEdit();
    const t = textBox(s);
    const r = svg.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    Object.assign(editor.style, {
      left: `${r.left - sr.left + t.x * zoom}px`,
      top: `${r.top - sr.top + t.y * zoom}px`,
      width: `${t.w * zoom}px`,
      height: `${t.h * zoom}px`,
      fontSize: `${FONT * zoom}px`,
    });
    centreEditorText();
  }
  function centreEditorText() {
    editor.style.paddingTop = '0px';
    const box = editor.clientHeight;
    const content = editor.scrollHeight;
    editor.style.paddingTop = `${Math.max(0, (box - content) / 2)}px`;
  }
  function finishEdit() {
    if (!editingId) return;
    const s = getShape(editingId);
    if (s) s.text = editor.value.replace(/\s+$/, '');
    editingId = null;
    editor.hidden = true;
    render();
    commit();
  }
  editor.addEventListener('input', centreEditorText);
  editor.addEventListener('blur', finishEdit);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); editor.blur(); }
    e.stopPropagation();
  });

  // ---------- Board pointer interactions ----------
  function shapeIdAt(cx, cy) {
    const el = document.elementFromPoint(cx, cy);
    const g = el && el.closest && el.closest('[data-shape]');
    return g ? g.dataset.shape : null;
  }

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (editingId) finishEdit();
    const t = e.target;
    const handle = t.closest('[data-handle]'), anchor = t.closest('[data-anchor]');
    const conn = t.closest('[data-conn]'), shp = t.closest('[data-shape]');
    const p = clientToCanvas(e.clientX, e.clientY);

    if (e.button === 1 || spaceDown || (!handle && !anchor && !conn && !shp)) {
      if (e.button === 0 && !spaceDown) select(null);
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop };
      svg.classList.add('panning');
    } else if (handle) {
      const s = getShape(selected.id);
      drag = { mode: 'resize', corner: handle.dataset.handle, id: s.id, orig: { ...s } };
    } else if (anchor) {
      drag = { mode: 'connect', from: selected.id, p, over: null };
    } else if (conn) {
      select({ kind: 'conn', id: conn.dataset.conn });
      render();
      return;
    } else {
      const s = getShape(shp.dataset.shape);
      select({ kind: 'shape', id: s.id });
      bringToFront(s.id);
      drag = { mode: 'move', id: s.id, dx: p.x - s.x, dy: p.y - s.y, moved: false };
    }
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    render();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = clientToCanvas(e.clientX, e.clientY);
    const { w: W, h: H } = state.canvas;
    if (drag.mode === 'pan') {
      scroller.scrollLeft = drag.sl - (e.clientX - drag.sx);
      scroller.scrollTop = drag.st - (e.clientY - drag.sy);
      return;
    }
    if (drag.mode === 'move') {
      const s = getShape(drag.id);
      s.x = clamp(p.x - drag.dx, 0, W - s.w);
      s.y = clamp(p.y - drag.dy, 0, H - s.h);
      drag.moved = true;
    } else if (drag.mode === 'resize') {
      const o = drag.orig, c = drag.corner, s = getShape(drag.id);
      const west = c.includes('w'), north = c.includes('n');
      const fx = west ? o.x + o.w : o.x, fy = north ? o.y + o.h : o.y;   // fixed opposite corner
      let nw = Math.max(MIN_SIZE, west ? fx - p.x : p.x - fx);
      let nh = Math.max(MIN_SIZE, north ? fy - p.y : p.y - fy);
      if (LOCK_ASPECT[o.type]) nw = nh = Math.max(nw, nh);
      nw = Math.min(nw, west ? fx : W - fx);
      nh = Math.min(nh, north ? fy : H - fy);
      if (LOCK_ASPECT[o.type]) nw = nh = Math.min(nw, nh);
      Object.assign(s, { w: nw, h: nh, x: west ? fx - nw : fx, y: north ? fy - nh : fy });
    } else if (drag.mode === 'connect') {
      drag.p = p;
      const id = shapeIdAt(e.clientX, e.clientY);
      drag.over = id && id !== drag.from ? id : null;
    }
    render();
  });

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    svg.classList.remove('panning');
    if (d.mode === 'connect' && d.over) {
      const dup = state.connectors.some((c) => (c.from === d.from && c.to === d.over) || (c.from === d.over && c.to === d.from));
      if (!dup) state.connectors.push({ id: uid(), from: d.from, to: d.over });
    }
    render();
    if (d.mode !== 'pan') commit();
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  svg.addEventListener('dblclick', (e) => {
    // Elements are re-rendered on pointerdown, so hit-test rather than trusting e.target.
    const id = shapeIdAt(e.clientX, e.clientY);
    if (id) startEdit(id);
  });

  // ---------- Palette drag & drop ----------
  document.querySelectorAll('[data-new]').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (editingId) finishEdit();
      const type = btn.dataset.new;
      const ghost = btn.querySelector('svg').cloneNode(true);
      ghost.classList.add('ghost');
      ghost.style.display = 'none';
      document.body.appendChild(ghost);
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) { moved = true; ghost.style.display = 'block'; }
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        ghost.remove();
        if (ev.type === 'pointercancel') return;
        if (!moved) {
          const c = viewCenterClient();
          return addShape(type, clientToCanvas(c.x, c.y));
        }
        const r = scroller.getBoundingClientRect(), b = svg.getBoundingClientRect();
        const inside = (x, y, rr) => x >= rr.left && x <= rr.right && y >= rr.top && y <= rr.bottom;
        if (inside(ev.clientX, ev.clientY, r) && inside(ev.clientX, ev.clientY, b)) addShape(type, clientToCanvas(ev.clientX, ev.clientY));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  });

  // ---------- Zoom & canvas size ----------
  function fitZoom() {
    return Math.min((scroller.clientWidth - 80) / state.canvas.w, (scroller.clientHeight - 80) / state.canvas.h);
  }
  function setZoom(z, cx, cy) {
    const c = viewCenterClient();
    cx = cx ?? c.x; cy = cy ?? c.y;
    const p = clientToCanvas(cx, cy);
    zoom = clamp(z, Math.min(0.1, fitZoom()), 4);
    render();
    scrollTo(p, cx, cy);
  }
  $('zoomIn').onclick = () => setZoom(zoom * 1.25);
  $('zoomOut').onclick = () => setZoom(zoom / 1.25);
  $('zoomLabel').onclick = () => setZoom(1);
  $('fit').onclick = () => {
    zoom = fitZoom();
    render();
    const c = viewCenterClient();
    scrollTo({ x: state.canvas.w / 2, y: state.canvas.h / 2 }, c.x, c.y);
  };
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });

  $('expand').onclick = () => {
    const { w, h } = state.canvas;
    if (w * 2 > MAX_CANVAS_W) return;
    if (editingId) finishEdit();
    const c = viewCenterClient();
    const p = clientToCanvas(c.x, c.y);
    const dx = w / 2, dy = h / 2;
    state.shapes.forEach((s) => { s.x += dx; s.y += dy; });   // grow equally in every direction
    state.canvas = { w: w * 2, h: h * 2 };
    render();
    scrollTo({ x: p.x + dx, y: p.y + dy }, c.x, c.y);
    commit();
  };

  // ---------- File actions ----------
  $('undo').onclick = undo;
  $('redo').onclick = redo;
  $('export').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `board-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('import').onclick = () => $('file').click();
  $('file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!valid(d)) throw new Error('bad file');
      state = normalise(d);
      selected = null;
      render();
      commit();
      $('fit').onclick();
    } catch {
      alert('That file is not a valid board.');
    }
  };
  $('clear').onclick = () => {
    if (!state.shapes.length || confirm('Clear the whole board? You can undo this.')) {
      state = blank();
      selected = null;
      render();
      commit();
      centreView();
    }
  };

  // ---------- Keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (editingId || e.target.matches('input, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    if (e.key === 'Escape') { selected = null; render(); return; }
    if (e.key === ' ' && !selected) { spaceDown = true; e.preventDefault(); return; }
    const s = selected && selected.kind === 'shape' && getShape(selected.id);
    if (!s || mod || e.altKey) return;
    if (e.key === 'Enter') { e.preventDefault(); startEdit(s.id); return; }
    if (e.key.length === 1) { e.preventDefault(); startEdit(s.id, e.key); return; }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') s.x = Math.max(0, s.x - step);
      if (e.key === 'ArrowRight') s.x = Math.min(state.canvas.w - s.w, s.x + step);
      if (e.key === 'ArrowUp') s.y = Math.max(0, s.y - step);
      if (e.key === 'ArrowDown') s.y = Math.min(state.canvas.h - s.h, s.y + step);
      render();
      commit();
    }
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
  window.addEventListener('resize', () => { if (editingId) positionEditor(); });

  // ---------- Start ----------
  function centreView() {
    let p = { x: state.canvas.w / 2, y: state.canvas.h / 2 };
    if (state.shapes.length) {
      const xs = state.shapes.flatMap((s) => [s.x, s.x + s.w]), ys = state.shapes.flatMap((s) => [s.y, s.y + s.h]);
      p = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
    const c = viewCenterClient();
    scrollTo(p, c.x, c.y);
  }
  render();
  centreView();
})();
