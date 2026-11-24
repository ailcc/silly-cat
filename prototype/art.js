// 图片只替换矢量组的外观。切猫时安装节点，姿态更新时复用同一组切片。
(function () {
  'use strict';
  const manifests = new Map();
  const $ = id => document.getElementById(id);
  const added = [], replaced = [];
  let active, head, tailStrip;
  const arms = new Map();

  function element(tag, attrs, parent, before = null) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    parent.insertBefore(node, before);
    return node;
  }

  function replace(nodes) {
    for (const node of nodes) {
      node.classList.add('art-replaced');
      replaced.push(node);
    }
  }

  let clipSeq = 0;
  function strip(parent, href, size, config) {
    replace(parent.children);
    const group = element('g', {}, parent);
    added.push(group);
    const slices = [];
    const [w, h] = size;
    for (let i = 0; i < config.segments; i++) {
      // 每段用多边形裁出两头的斜切线，相邻两段正好拼在角平分线上：弯的时候外侧不裂缝、内侧不叠出深色边
      const id = 'art-clip-' + (clipSeq++);
      const clip = element('clipPath', { id, clipPathUnits: 'userSpaceOnUse' }, group);
      const poly = element('polygon', { points: '' }, clip);
      const outer = element('g', { 'clip-path': `url(#${id})` }, group);
      const frame = element('g', {}, outer);
      const crop = element('svg', { preserveAspectRatio: 'none', overflow: 'hidden' }, frame);
      element('image', { href, width: w, height: h }, crop);
      slices.push({ frame, crop, poly });
    }
    return { group, slices, w, h, config };
  }

  const EXT = 10; // 每段图在两头各多画一截，留给斜切裁掉
  const f2 = v => Math.round(v * 100) / 100;
  function bend(strip, points, widthAt) {
    const { slices, w, h, config } = strip;
    const n = slices.length, top = config.top || 0, bottom = config.bottom || 0;
    const lengths = [], dirs = [];
    for (let i = 0; i < n; i++) {
      const dx = points[i + 1].x - points[i].x, dy = points[i + 1].y - points[i].y, l = Math.hypot(dx, dy);
      lengths.push(l);
      dirs.push(l > 1e-6 ? { x: dx / l, y: dy / l } : (dirs[i - 1] || { x: 0, y: 1 }));
    }
    // 接点 k 的斜切方向：前后两段切线平均后的法线；两端就用本段的法线
    const miters = [];
    for (let k = 0; k <= n; k++) {
      const a = dirs[Math.max(0, k - 1)], b = dirs[Math.min(n - 1, k)];
      let mx = a.x + b.x, my = a.y + b.y;
      const l = Math.hypot(mx, my) || 1;
      miters.push({ x: -my / l, y: mx / l });
    }
    const total = lengths.reduce((sum, length) => sum + length, top + bottom);
    let offset = 0;
    slices.forEach(({ frame, crop, poly }, i) => {
      const p = points[i], q = points[i + 1], d = dirs[i];
      const first = i === 0, last = i === n - 1;
      const width = widthAt((i + 0.5) / n);
      const length = lengths[i] + (first ? top : 0) + (last ? bottom : 0);
      const angle = Math.atan2(d.y, d.x) * 180 / Math.PI - 90;
      frame.setAttribute('transform', `translate(${f2(p.x)} ${f2(p.y)}) rotate(${f2(angle)})`);
      crop.setAttribute('x', f2(-width / 2));
      crop.setAttribute('y', f2((first ? -top : 0) - EXT));
      crop.setAttribute('width', f2(width));
      crop.setAttribute('height', f2(length + 2 * EXT));
      crop.setAttribute('viewBox', `0 ${f2((offset - EXT) * h / total)} ${w} ${f2((length + 2 * EXT) * h / total)}`);
      offset += length;
      // 裁切多边形：两条斜切线围出这一段；第一段往根部、最后一段往末端各延长，半宽留一点余量
      const r = width * 0.55 + 1;
      const s0 = first ? { x: p.x - d.x * (top + 2), y: p.y - d.y * (top + 2) } : p;
      const s1 = last ? { x: q.x + d.x * (bottom + 2), y: q.y + d.y * (bottom + 2) } : q;
      const m0 = miters[i], m1 = miters[i + 1];
      poly.setAttribute('points', `${f2(s0.x + m0.x * r)},${f2(s0.y + m0.y * r)} ${f2(s1.x + m1.x * r)},${f2(s1.y + m1.y * r)} ` +
        `${f2(s1.x - m1.x * r)},${f2(s1.y - m1.y * r)} ${f2(s0.x - m0.x * r)},${f2(s0.y - m0.y * r)}`);
    });
  }

  function apply(coat) {
    if (active === coat) return;
    active = coat;
    for (const node of added.splice(0)) node.remove();
    for (const node of replaced.splice(0)) node.classList.remove('art-replaced');
    arms.clear();
    head = tailStrip = null;
    const cfg = coat.art, sizes = manifests.get(coat.id);
    if (!cfg || !sizes) return;
    const href = key => cfg.base + key + '.webp';
    function place(key, box, parent, originals = parent.children, transform) {
      if (!sizes[key]) return null;
      const [w, h] = sizes[key], width = box.width, height = width * h / w;
      const attrs = { href: href(key), width, height, x: box.x ?? box.cx - width / 2, y: box.y ?? box.cy - height / 2 };
      if (transform) attrs.transform = transform;
      replace(originals);
      const node = element('image', attrs, parent, originals[0]);
      added.push(node);
      return node;
    }

    head = place('head', cfg.head, $('cat-head'), ['head-fill', 'coat-head-patterns', 'head-line'].map($));
    const back = $('strike-head-shape');
    place('back-head', cfg.head, back, back.querySelectorAll(':scope > path, :scope > #coat-back-head-patterns'));
    place('body', cfg.body, $('cat-body'));
    place('back-body', cfg.body, $('strike-body'));
    for (const side of ['l', 'r']) {
      const mirror = side === 'r' ? 'translate(800 0) scale(-1 1)' : '';
      place('ear', cfg.ear, document.querySelector('#ear-' + side + ' .ear-shape-' + side), undefined, mirror);
      place('ear-back', cfg.ear, $('strike-ear-' + side), undefined, mirror);
      place('paw-' + side, cfg.paw, $('paw-' + side));
      const key = 'arm-' + side;
      if (sizes[key]) arms.set(key, strip($(key), href(key), sizes[key], cfg.arm));
    }
    if (sizes.tail) {
      tailStrip = strip($('tail'), href('tail'), sizes.tail, cfg.tail);
      tailStrip.group.id = 'art-tail-slices';
      const front = $('tail-front');
      replace(front.children);
      added.push(element('use', { href: '#art-tail-slices' }, front));

      const strike = $('strike-tail');
      const path = strike.querySelector('.tail-outline');
      // Measure in the visible SVG, even when the strike pose is display:none.
      const guide = element('path', { d: path.getAttribute('d'), visibility: 'hidden' }, $('scene'));
      const length = guide.getTotalLength();
      const points = Array.from({ length: cfg.tail.segments + 1 }, (_, i) => guide.getPointAtLength(length * i / cfg.tail.segments));
      guide.remove();
      bend(strip(strike, href('tail'), sizes.tail, cfg.tail), points, () => 31);
    }
  }

  window.SillyArt = {
    register: (id, sizes) => manifests.set(id, sizes),
    apply,
    cheek(b) {
      if (head) head.setAttribute('transform', `translate(400 205) scale(${1 + 0.0055 * b} ${1 + 0.0015 * b}) translate(-400 -205)`);
    },
    arm(key, shoulder, cx, cy, ex, ey) {
      const strip = arms.get(key);
      if (!strip) return;
      const count = strip.slices.length;
      const points = Array.from({ length: count + 1 }, (_, i) => {
        const t = i / count, u = 1 - t;
        return { x: u * u * shoulder.x + 2 * u * t * cx + t * t * ex, y: u * u * shoulder.y + 2 * u * t * cy + t * t * ey };
      });
      bend(strip, points, () => strip.config.width);
    },
    get tailSegments() { return tailStrip?.slices.length || 0; },
    tail(points, diameter) {
      bend(tailStrip, points, s => diameter(s) + tailStrip.config.fringe);
    },
  };
})();
