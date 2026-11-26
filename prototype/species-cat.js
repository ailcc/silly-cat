// 奶牛猫与其他猫品种共用的动画骨架。
(function () {
  'use strict';

  function headPath(b) {
    const r = (v) => Math.round(v * 10) / 10;
    return `M 270 176 C 268 98, 328 70, 400 70 C 472 70, 532 98, 530 176 ` +
      `C ${r(531 + b * 1.25)} ${r(236 + b * 0.5)}, ${r(478 + b * 0.5)} ${r(276 + b * 0.2)}, 400 276 ` +
      `C ${r(322 - b * 0.5)} ${r(276 + b * 0.2)}, ${r(269 - b * 1.25)} ${r(236 + b * 0.5)}, 270 176 Z`;
  }

  function mouseTailPoints({ bx, by, mirrorX, direction, lag, mouse, sway, pressX, press, bounce }) {
    return [
      { x: mirrorX(322) + bx, y: 370 + by },
      { x: mirrorX(290) + bx, y: 366 + by },
      { x: mirrorX(240) + bx * 0.5, y: 352 + by * 0.5 + sway * 0.5 },
      { x: lag.x + direction * 84, y: lag.y - 128 + sway },
      { x: lag.x + direction * 38, y: lag.y - 94 + sway * 0.6 },
      { x: lag.x + direction * 12, y: lag.y - 46 },
      { x: mouse.x + 2 + pressX * press, y: mouse.y + 4 + 5 * press - bounce },
    ];
  }

  window.SillySpecies.register('cat', {
    scene: {
      template: 'parts-cat',
      attributes(rig) {
        const body = 'M 300 412 C 290 352, 318 266, 400 258 C 482 266, 510 352, 500 412';
        const tail = 'M 400 404 C 446 392, 500 378, 556 376 C 598 374, 626 356, 622 326';
        return [
          ['#cat-body > .coat-base, #strike-body > .coat-base, #clip-body path, #clip-back-body path, #mask-tail-body', { d: body + ' Z' }],
          ['#cat-body > .ink-line, #strike-body > .ink-line', { d: body }],
          ['#cat-body > .ink-thin', { d: 'M 312 350 Q 326 372 352 380 M 488 350 Q 474 372 448 380' }],
          ['#strike-tail > path', { d: tail }],
          ['#strike-head-shape > path, #clip-back-head path, #head-fill, #head-line, #clip-head-path', { d: rig.head.backPath }],
          ['.imprint-flush', { cx: '318', cy: '240', rx: '40', ry: '24' }],
          ['#sweat', { d: 'M 502 124 Q 494 138 495 143 A 7.5 7.5 0 0 0 510 143 Q 511 138 502 124 Z' }],
          ['#imprint-tuft', { d: 'M 284 248 L 272 249 M 290 256 L 281 263' }],
        ];
      },
    },
    art: {
      head: { cx: 400, cy: 176, width: 300 },
      imprint: { dx: 0, dy: 0 },
      ear: { x: 278, y: 24, width: 110 },
      body: { cx: 400, y: 246, width: 240 },
      paw: { cx: 0, cy: -2, width: 66 },
      arm: { width: 54, top: 18, bottom: 12, segments: 8 },
      tail: { fringe: 6, segments: 16, scale: 1 },
    },
    coatShape: { bodySX: 1, bodySY: 1, headSX: 1, ear: 1 },
    sleep: {
      droolAnchor: { x: 419, y: 227 },
      wipeAnchor: { x: 410, y: 236 },
      zzzAnchor: { x: 548, y: 84 },
      contactShape: { cx: 400, cy: 173, rx: 130, ry: 103 },
      imprintPivot: { x: 310, y: 240 },
      slump: {
        nod: {
          dip: [58, 110], rebound: [12, 50], finalDip: 56, land: 160, bounce: 9,
          pose: { hx: -4, hr: -3, hsx: 0.03, hsy: -0.04, by: 18, bsy: -0.06, ear: 28 },
        },
        melt: { hy: 190, hx: -2, hr: -5, hsx: 0.2, hsy: -0.2, by: 4, bsx: 0.9, bsy: -0.55, ear: 40 },
      },
    },
    fatigue: {
      sigh: { anchor: { x: 410, y: 236 }, headDip: 6, bodyDip: 3 },
      angry: { symbol: { x: 478, y: 96 }, cheek: 20, cheekPulse: 2.5, tailAmp: 22 },
      rage: {
        standLift: -30,
        lean: { headY: 10, headRot: -5, bodyRot: -3, lift: 6 },
        tailAmp: 26,
        overhead: { x: 128, y: 44 },
        paws: { raised: { x: 100, y: 118 }, smash: { x: 66, y: 440 }, clenched: { x: 92, y: 300 } },
      },
      strike: {
        crossedLift: 40,
        hmph: { l: { x: 286, y: 104 }, r: { x: 514, y: 104 } },
        tail: { pivot: { x: 500, y: 378 }, angle: -14 },
        ears: {
          pivots: { l: { x: 322, y: 110 }, r: { x: 478, y: 110 } },
          rest: 12, peek: 18, flick: 16, narrow: 0.4,
        },
        headTurn: 7,
      },
      repairGhost: {
        L: { paint: 'ghost-white', rx: 20, ry: 14 },
        R: { paint: 'ghost-black', rx: 20, ry: 14 },
      },
    },
    push: {
      lookFront: { x: 400, y: 178 },
      headTilt: 3, watchDip: 6, proudLift: 5,
      tail: { amp: 9, ampBoost: 5, speed: 0.015 },
      paw: {
        hover: { x: -34, y: -30 }, press: { x: 5, y: 5 },
        windup: { x: -16, y: -8 }, shove: { x: 64, y: 7 },
      },
    },
    headphones: {
      fit: { referenceWidth: 260, cupY: 0.52, bandY: 6, noteX: 128, noteY: -31, noteRise: 6 },
      sway: { headRotation: 3.2, headDip: 1.2, tailLift: 4 },
    },
    rig: {
      turnX: 400,
      head: {
        pivot: { x: 400, y: 262 }, backScalePivot: { x: 400, y: 0 },
        restRotation: -4, sleepRotation: -3, sleepY: 8, breathY: 1.5,
        pet: { rotation: 6, wobble: 2.5, x: 7, y: 2 },
        nod: 2, shake: 6,
        cheek: { imagePivot: { x: 400, y: 205 }, scaleX: 0.0055, scaleY: 0.0015 },
        path: headPath,
        backPath: 'M 270 176 C 268 98, 328 70, 400 70 C 472 70, 532 98, 530 176 C 529 240, 476 276, 400 276 C 324 276, 271 240, 270 176 Z',
      },
      body: {
        pivot: { x: 400, y: 410 },
        breathScale: { x: 0.012, y: 0.025 },
      },
      eyes: {
        centers: { L: { x: 345, y: 178 }, R: { x: 455, y: 178 } }, // 画面左右
        radius: 29, irisRadius: 21, irisTravel: 0.6, lidPadding: 2,
        pupil: { rest: 13, excited: 18 },
        shine: { radius: 5, offset: 0.42 },
        gaze: { max: 8, taper: 0.4, restY: 1, keyX: 5, keyY: 4 },
        arcs: {
          closed: { halfWidth: 22, edgeY: 2, controlY: 18 },
          happy: { halfWidth: 22, edgeY: 8, controlY: -14 },
        },
      },
      ears: {
        pivots: { L: { x: 322, y: 110 }, R: { x: 478, y: 110 } }, // 画面左右
        twitch: { degrees: 14, period: 130, duration: 260 },
      },
      paws: {
        shoulders: { L: { x: 446, y: 304 }, R: { x: 354, y: 304 } }, // 角色左右
        restY: -14, keyY: -8, wristY: -8,
        pressScale: { x: 0.13, y: 0.17 }, lift: { y: 4, scale: 0.06 },
        bend: { base: 70, falloff: 0.25, min: 8, max: 45 },
      },
      tail: {
        pivot: { x: 322, y: 372 },
        samples: 34,
        idleCurves: [
          { points: [322, 370, 272, 372, 222, 374, 198, 350], steps: 30 },
          { points: [198, 350, 182, 334, 184, 314, 198, 306], steps: 14 },
        ],
        halfWidth: (s, press) => (13.2 - 2.6 * s * s) * (1 + 0.14 * press * Math.max(0, (s - 0.7) / 0.3)),
        tipLength: 30, markingInset: 2.3, strikeDiameter: 31,
        wag: {
          tau: 60,
          awake: { amp: 9, speed: 0.003 },
          drowsy: { amp: 5, speed: 0.0015 },
          excited: { amp: 16, speed: 0.014 },
          asleep: { amp: 0, speed: 0, base: -22, tau: 500 },
        },
        mouse: {
          extendMs: 380, retractMs: 520, lagMs: 110, pressMs: 22, pressX: 9,
          bounce: { height: 6, duration: 240 }, sway: { height: 2.2, period: 640 },
          reachLift: 42,
          points: mouseTailPoints,
        },
      },
      zzz: { origin: { x: 520, y: 92 } },
    },
  });
})();
