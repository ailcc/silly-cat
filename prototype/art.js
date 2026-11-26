// 图片只替换矢量组的外观。切换毛色时安装节点，姿态更新时复用同一组切片。
(function () {
  'use strict';
  const manifests = new Map();
  const $ = id => document.getElementById(id);
  const added = [], replaced = [];
  let active, head, tailStrip, imprintOffset;
  const frontClip = () => $('clip-head-path');
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
      // 富纹理条带的共边经过两次抗锯齿会露底色，沿切线轻微覆盖前一段。
      const startExtra = first ? top + 2 : (config.overlap || 0);
      const s0 = startExtra ? { x: p.x - d.x * startExtra, y: p.y - d.y * startExtra } : p;
      const s1 = last ? { x: q.x + d.x * (bottom + 2), y: q.y + d.y * (bottom + 2) } : q;
      const m0 = miters[i], m1 = miters[i + 1];
      poly.setAttribute('points', `${f2(s0.x + m0.x * r)},${f2(s0.y + m0.y * r)} ${f2(s1.x + m1.x * r)},${f2(s1.y + m1.y * r)} ` +
        `${f2(s1.x - m1.x * r)},${f2(s1.y - m1.y * r)} ${f2(s0.x - m0.x * r)},${f2(s0.y - m0.y * r)}`);
    });
  }

  function apply(coat) {
    if (active === coat) return;
    const { rig } = window.SillySpecies.current;
    if (coat.art?.headPath || active?.art?.headPath) {
      const clip = frontClip();
      clip.setAttribute('d', coat.art?.headPath ?? $('head-fill').getAttribute('d'));
      clip.removeAttribute('transform');
      $('clip-back-head').firstElementChild.setAttribute('d', coat.art?.headPath ?? rig.head.backPath);
    }
    if (imprintOffset) {
      imprintOffset.replaceWith(...imprintOffset.childNodes);
      imprintOffset = null;
    }
    const offset = coat.art?.imprint;
    if (offset && (offset.dx || offset.dy)) {
      const imprint = $('imprint');
      const contents = [...imprint.childNodes];
      imprintOffset = element('g', { transform: `translate(${offset.dx} ${offset.dy})` }, imprint);
      imprintOffset.append(...contents);
    }
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
    place('back-head', cfg.backHead ?? cfg.head, back, back.querySelectorAll(':scope > path, :scope > #coat-back-head-patterns'));
    // 身体同样只替换猫身本身的节点；成长围巾、节日围巾、铃铛项圈这类挂在身体上的装饰要留在最上层
    const DECOR = new Set(['growth-scarf', 'holiday-scarf', 'love-collar']);
    place('body', cfg.body, $('cat-body'), [...$('cat-body').children].filter((n) => !DECOR.has(n.id)));
    place('back-body', cfg.backBody ?? cfg.body, $('strike-body'));
    const mirrorX = 2 * rig.turnX;
    for (const side of ['l', 'r']) {
      function placeEar(key, parent) {
        const ear = key === 'ear-back' && cfg.earBack ? { ...cfg.ear, ...cfg.earBack } : cfg.ear;
        const rightArt = side === 'r' && sizes[key + '-r'];
        const asset = rightArt ? key + '-r' : key;
        if (!sizes[asset]) return;
        const mirror = side === 'r' && !rightArt;
        const transforms = mirror ? [`translate(${mirrorX} 0) scale(-1 1)`] : [];
        if (ear.rotate) {
          const [w, h] = sizes[asset];
          const { x, y } = ear.pivot ?? { x: ear.x + ear.width / 2, y: ear.y + ear.width * h / w };
          transforms.push(rightArt ? `rotate(${ear.rotate} ${mirrorX - x} ${y})` : `rotate(${-ear.rotate} ${x} ${y})`);
        }
        const box = rightArt ? { ...ear, x: mirrorX - ear.x - ear.width } : ear;
        place(asset, box, parent, undefined, transforms.join(' '));
      }
      placeEar('ear', document.querySelector('#ear-' + side + ' .ear-shape-' + side));
      placeEar('ear-back', $('strike-ear-' + side));
      place('paw-' + side, cfg.paw, $('paw-' + side));
      const key = 'arm-' + side;
      if (sizes[key]) {
        const arm = strip($(key), href(key), sizes[key], cfg.arm);
        if (cfg.arm.maskBody) arm.group.setAttribute('mask', 'url(#mask-tail-front)');
        arms.set(key, arm);
      }
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
      bend(strip(strike, href('tail'), sizes.tail, cfg.tail), points, () => rig.tail.strikeDiameter * (cfg.tail.scale ?? 1));
    }
  }

  window.SillyArt = {
    register: (id, sizes) => manifests.set(id, sizes),
    apply,
    cheek(b) {
      if (!head && !active?.art?.headPath) return;
      const { imagePivot: { x, y }, scaleX, scaleY } = window.SillySpecies.current.rig.head.cheek;
      const transform = `translate(${x} ${y}) scale(${1 + scaleX * b} ${1 + scaleY * b}) translate(${-x} ${-y})`;
      if (head) head.setAttribute('transform', transform);
      if (active?.art?.headPath) frontClip().setAttribute('transform', transform);
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
      bend(tailStrip, points, s => (diameter(s) + tailStrip.config.fringe) * (tailStrip.config.scale ?? 1));
    },
  };
})();
