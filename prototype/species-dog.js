// 中华田园犬的坐姿、五官和动作锚点沿用 800 × 620 舞台坐标。
(function () {
  'use strict';

  const cat = window.SillySpecies.get('cat');
  const { rig } = cat;
  function smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function midScale(y) {
    return 1 - 0.10 * smoothstep((268 - y) / 43);
  }

  // Match the v5 crown warp and the v6 cheek warp baked into the art.
  function narrowScale(y) {
    return (1 - 0.15 * smoothstep((250 - y) / 170)) * midScale(y);
  }

  // The source geometry predates the 12-unit downward shift of the head.
  function narrowPoint(x, y) {
    return { x: Number((400 + (x - 400) * narrowScale(y)).toFixed(3)), y: y + 12 };
  }

  function narrowOutline(x, y, curves) {
    const point = (x, y) => `${narrowPoint(x, y).x} ${Number((y + 12).toFixed(3))}`;
    let d = `M ${point(x, y)}`;
    for (const [ax, ay, bx, by, endX, endY] of curves) {
      if (Math.min(y, ay, by, endY) >= 268) {
        d += ` C ${ax} ${ay + 12} ${bx} ${by + 12} ${endX} ${endY + 12}`;
      } else {
        // A row-dependent warp does not preserve cubic control points.
        for (let i = 1; i <= 24; i++) {
          const t = i / 24, u = 1 - t;
          const sample = (p, a, b, q) => u ** 3 * p + 3 * u * u * t * a + 3 * u * t * t * b + t ** 3 * q;
          d += ` L ${point(sample(x, ax, bx, endX), sample(y, ay, by, endY))}`;
        }
      }
      x = endX;
      y = endY;
    }
    return d;
  }

  const closedMouthCorner = { x: 428, y: 242 };
  const imprintPivot = { x: 309.227, y: 237 };
  // The dents are authored in the shared, unshifted SVG coordinate system.
  const imprintOffset = { dx: 28.52, dy: -6 };
  // The flush and dents share this translation. Their pivot is in group coordinates.
  const paintedImprintX = imprintPivot.x + imprintOffset.dx;
  imprintOffset.dx += (paintedImprintX - 400) * (midScale(imprintPivot.y + imprintOffset.dy) - 1);
  imprintOffset.dy += 12;
  const earPivots = { L: narrowPoint(327, 102), R: narrowPoint(473, 102) };
  const headPath = narrowOutline(400, 80, [
    [470, 80, 528, 108, 532, 168], [536, 214, 500, 246, 458, 270],
    [440, 282, 424, 292, 400, 292], [376, 292, 360, 282, 342, 270],
    [300, 246, 264, 214, 268, 168], [272, 108, 330, 80, 400, 80],
  ]) + ' Z';
  const earOutline = narrowOutline(295, 119, [
    [286, 98, 291, 53, 305, 42], [321, 28, 346, 60, 365, 85],
    [371, 98, 365, 120, 350, 133],
  ]) + ` L ${narrowPoint(306, 132).x} 144 Z`;
  const innerEarPath = narrowOutline(302, 110, [
    [299, 90, 302, 58, 310, 53],
    [310 + 32 / 3, 53 - 10 / 3, 334, 88 - 80 / 3, 350, 88],
    [334, 88 + 22 / 3, 318, 110 - 22 / 3, 302, 110],
  ]) + ' Z';
  const muzzlePath = narrowOutline(400, 182, [
    [424, 182, 446, 214, 452, 246], [458, 274, 432, 292, 400, 292],
    [368, 292, 342, 274, 348, 246], [354, 214, 376, 182, 400, 182],
  ]) + ' Z';
  const cheek = { ...rig.head.cheek, imagePivot: { x: 400, y: 239 } };
  const strikeTail = 'M 489 376 C 513 374 540 365 550 346 C 564 325 559 307 542 300 Q 528 292 510 294';

  function frontHeadPath(amount) {
    if (!amount) return headPath;
    const { imagePivot: { x, y }, scaleX, scaleY } = cheek;
    // Match the head image's cheek transform for the vector outline and clip.
    return headPath.replace(/([\d.]+) ([\d.]+)/g, (_, px, py) => {
      const sx = x + (Number(px) - x) * (1 + scaleX * amount);
      const sy = y + (Number(py) - y) * (1 + scaleY * amount);
      return `${sx.toFixed(2)} ${sy.toFixed(2)}`;
    });
  }

  window.SillySpecies.register('dog', {
    scene: {
      template: 'parts-dog',
      attributes(dogRig) {
        const body = 'M 358 196 Q 390 193 431 194 Q 444 194 451 204 ' +
          'C 480 253 514 312 514 350 Q 514 390 468 398 Q 400 410 333 398 ' +
          'Q 286 389 286 350 C 286 316 321 248 347 206 Q 352 197 358 196';
        return [
          ['#cat-body > .coat-base, #strike-body > .coat-base, #clip-body path, #clip-back-body path, #mask-tail-body', { d: body + ' Z' }],
          ['#cat-body > .ink-line, #strike-body > .ink-line', { d: body }],
          ['#cat-body > .ink-thin', { d: 'M 293 362 Q 302 379 318 386 M 507 362 Q 498 379 482 386' }],
          ['#strike-tail > path', { d: strikeTail }],
          ['#strike-head-shape > path, #clip-back-head path, #head-fill, #head-line, #clip-head-path', { d: dogRig.head.backPath }],
          ['#scene .dog-ear-outline', { d: dogRig.ears.outline }],
          ['#scene .coat-inner-ear', { d: dogRig.ears.innerPath }],
          ['.imprint-flush', { cx: imprintPivot.x, cy: imprintPivot.y, rx: '34.913', ry: '22' }],
          ['#sweat', { d: 'M 469.315 139 Q 463.572 153 464.968 158 C 465.391 168 478.973 168 478.472 158 Q 478.772 153 469.315 139 Z' }],
          ['#imprint-tuft', { d: 'M 311.898 254 L 303.959 252 M 319.809 261 L 312.808 264' }],
        ];
      },
    },
    art: {
      // prepare_art crops the source alpha bounds and adds 6 px on each side.
      head: { cx: 400, cy: 196.5, width: 227 },
      backHead: { cx: 400, cy: 196, width: 234 },
      imprint: imprintOffset,
      ear: { x: 309.5, y: 55.5, width: 72.5, pivot: earPivots.L },
      earBack: { x: 313, y: 49.5, width: 63.5 },
      body: { cx: 400, y: 192.5, width: 231 },
      backBody: { cx: 400, y: 192.5, width: 231 },
      paw: { cx: 0, cy: 2, width: 71 },
      arm: { width: 59, top: 34, bottom: 7, segments: 8, overlap: 0.25 },
      tail: { fringe: 4, top: 3, bottom: 2, segments: 24, overlap: 1.35, scale: 0.94 },
    },
    coatShape: { ...cat.coatShape },
    // 狗不伸爪碰鼠标（爪子跟指针、身体倾斜够鼠标都是猫的戏）：鼠标跟狗的互动只有
    // 嘴——叼走鼠标（dog-snatch）。眼睛仍会跟着指针看。
    // mouseReach 只保留鼠标摆放位置（inset/rise）和演示模式的倾斜参数：
    // mousePaw 为 false 时真实使用中 lean 恒为 0，狗不会朝鼠标倾身。
    mousePaw: false,
    mouseReach: {
      inset: 23, rise: 79, degrees: 8, slide: 8, shoulderX: 2, shoulderY: -15,
      stretch: 3, bend: 17, tau: 85,
    },
    idleTilt: true,
    tailTyping: true,
    petTongue: true,
    swat: false,
    purr: false,
    grump: { look: { x: 400, y: 182 }, effect: { x: 520, y: 121 } },
    push: { snatch: true },
    sleep: {
      ...cat.sleep,
      droolAnchor: closedMouthCorner,
      wipeAnchor: { x: 419, y: 247 },
      zzzAnchor: narrowPoint(530, 76),
      contactShape: { cx: 400, cy: 197, rx: 126 * narrowScale(185), ry: 104 },
      imprintPivot,
      slump: {
        nod: {
          ...cat.sleep.slump.nod, dip: [52, 98], finalDip: 50, land: 138,
          // Lower the long neck with the head, keeping the paws planted.
          pose: { ...cat.sleep.slump.nod.pose, by: 8, bsy: -0.46 },
        },
        melt: { ...cat.sleep.slump.melt, hy: 169, bsx: 0.14, bsy: -0.65, by: 0 },
      },
    },
    fatigue: {
      ...cat.fatigue,
      mischief: true,
      status: { annoyed: '想遛弯', rage: '拆家中', strike: '闹脾气', calmAt: 0.6 },
      browMoods: ['angry'],
      sigh: { ...cat.fatigue.sigh, anchor: { x: 431, y: 239 }, closedAnchor: closedMouthCorner },
      angry: { ...cat.fatigue.angry, symbol: narrowPoint(474, 93), cheek: 15 },
      strike: {
        ...cat.fatigue.strike,
        hmph: { l: narrowPoint(292, 94), r: narrowPoint(508, 94) },
        tail: { pivot: { x: 489, y: 376 }, angle: -4 },
        ears: { ...cat.fatigue.strike.ears, pivots: { l: earPivots.L, r: earPivots.R }, rest: 4 },
      },
      repairGhost: {
        L: { paint: 'ghost-white', rx: 25, ry: 16 },
        R: { paint: 'ghost-white', rx: 25, ry: 16 },
      },
    },
    headphones: {
      fit: { ...cat.headphones.fit, cupsInFront: true, referenceWidth: 290, cupGap: -22, cupY: 0.40, bandY: 10, noteY: -42 },
      sway: { ...cat.headphones.sway, tailLift: 2 },
    },
    rig: {
      ...rig,
      head: {
        ...rig.head,
        pivot: { x: 400, y: 293 },
        restRotation: 0,
        sleepRotation: -4,
        cheek,
        path: frontHeadPath,
        backPath: headPath,
        muzzlePath,
      },
      eyes: {
        style: 'puppy',
        centers: { L: { x: 363.108, y: 182 }, R: { x: 436.892, y: 182 } },
        radius: 15, lidPadding: 2, restLid: 0,
        pupil: { rest: 15, excited: 15 },
        shine: { x: -5, y: -5.4, radius: 4.4 },
        glint: { x: 5.2, y: 5.6, radius: 1.7 },
        dot: { radius: 7.5, lead: 0.3 },
        gaze: { max: 5, taper: 0, restY: 0, keyX: 4, keyY: 2, pointerParallax: false },
        arcs: {
          closed: { halfWidth: 13, edgeY: 2, controlY: 10 },
          happy: { halfWidth: 13, edgeY: 4, controlY: -9 },
        },
      },
      ears: {
        ...rig.ears,
        pivots: earPivots,
        outline: earOutline,
        innerPath: innerEarPath,
        twitch: { ...rig.ears.twitch, degrees: 10 },
      },
      paws: {
        ...rig.paws,
        restKeys: { L: 'KeyF', R: 'KeyL' },
        restY: -49,
        shoulders: { L: { x: 476, y: 342 }, R: { x: 324, y: 342 } },
        bend: { base: 11, falloff: 0.24, min: 1, max: 11 },
      },
      tail: {
        ...rig.tail,
        pivot: { x: 304, y: 367 },
        idleCurves: [
          { points: [304, 367, 272, 378, 249, 365, 238, 342], steps: 26 },
          { points: [238, 342, 225, 316, 247, 304, 260, 298], steps: 24 },
          { points: [260, 298, 266, 296, 273, 291, 278, 290], steps: 8 },
        ],
        halfWidth: (s) => 21 + 9 * s + 8 * Math.max(0, 1 - ((s - 0.63) / 0.22) ** 2) ** 2,
        tipLength: 25,
        strikeDiameter: 62,
        wag: {
          ...rig.tail.wag,
          awake: { amp: 5, speed: 0.005 },
          drowsy: { amp: 2, speed: 0.003 },
          excited: { amp: 18, speed: 0.025 },
          asleep: { amp: 0, speed: 0, base: 0, tau: 380 },
        },
      },
      zzz: { origin: narrowPoint(522, 76) },
    },
  });
})();
