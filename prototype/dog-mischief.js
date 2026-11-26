// 狗的牵引绳、拆键帽、啃键盘和修理动作。动画由疲劳状态的时间轴驱动。
(function () {
  'use strict';

  const PULLS = [
    { code: 'KeyB', time: 400, x: 545, y: 603, roll: 34 },
    { code: 'KeyN', time: 720, x: 209, y: 601, roll: -32 },
    { code: 'KeyM', time: 1040, x: 114, y: 560, roll: -39 },
    { code: 'KeyH', time: 1360, x: 660, y: 530, roll: 60 },
  ];
  const MOUTH = { x: 400, y: 244 };
  const CHEW_MARK = 1850;
  const MARK_LIFE = 60000;
  const REPAIR_FIRST = 320, REPAIR_GAP = 345, REPAIR_FLIGHT = 290;
  const SCRAPS = [
    [187, 573, 174, 125], [275, 602, 198, -155], [95, 532, 208, 190],
    [345, 590, 149, -80], [745, 563, 162, 112], [560, 614, 108, -54],
    [508, 565, 188, 224], [688, 597, 119, -145], [64, 600, 233, -220],
    [780, 540, 152, 69], [442, 601, 138, 182], [704, 511, 179, -230],
  ];
  const mix = (a, b, p) => a + (b - a) * p;
  const limit = (p) => Math.min(1, Math.max(0, p));
  const smooth = (p) => { const q = limit(p); return q * q * (3 - 2 * q); };
  const chewAt = (t) => smooth((t - 1505) / 295) * (1 - smooth((t - 2340) / 460));
  const pullDepth = (age) => age < 0 ? smooth(1 + age / 230) : 1 - smooth(age / 106);
  const pullTurn = (key, age) => Math.sign(key.x - key.home.x) * 12 * smooth(age / 85) * (1 - smooth((age - 60) / 60));

  function create(ctx) {
    const { S, STATES, kb, f1 } = ctx;
    const $ = (id) => document.getElementById(id);
    const capsLayer = $('debris-layer');
    const face = $('face-dog');
    const scene = $('scene'), head = $('cat-head'), rear = $('cat-strike');
    const openMouth = $('dog-mouth-open'), closedMouth = $('dog-mouth-closed');
    const shown = new Map();

    function show(node, on) {
      if (shown.get(node) === on) return;
      shown.set(node, on);
      node.style.display = on ? '' : 'none';
    }
    function position(node, x, y, angle = 0, size = 1) {
      node.setAttribute('transform', `translate(${f1(x)} ${f1(y)}) rotate(${f1(angle)}) scale(${size.toFixed(3)})`);
    }
    function alpha(node, opacity) {
      node.setAttribute('opacity', limit(opacity).toFixed(3));
    }

    const webbing = 'M -2 5 C -20 34 -16 80 7 102 C 28 123 54 111 50 91 C 46 68 18 15 2 4 ' +
      'C 18 24 39 66 58 91 C 80 117 106 124 119 162 C 131 200 67 206 65 242 ' +
      'C 63 271 111 275 122 298 Q 129 310 119 328';
    capsLayer.insertAdjacentHTML('beforeend', `
      <g id="dog-leash" style="display:none" aria-hidden="true">
        <path d="${webbing}" fill="none" stroke="#6e262c" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${webbing}" fill="none" stroke="#c63242" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${webbing}" fill="none" stroke="#ed6570" stroke-width="1.6" stroke-dasharray="1.1 2.4" stroke-linecap="round" opacity=".9"/>
        <g transform="translate(119 328) rotate(112)" stroke-linejoin="round">
          <path d="M -7 -7 H 1 Q 7 -7 7 -2 V 3 Q 7 7 1 7 H -7 Z" fill="#a5b4bc" stroke="#4e555f" stroke-width="2"/>
          <path d="M -8 -4 H 0 Q 4 -4 4 0 Q 4 4 0 4 H -8 Z" fill="#bb2f3c"/>
          <path d="M 7 -3 H 13 Q 13 -7 20 -8 L 29 -7 Q 36 -6 35 1 Q 34 7 27 8 H 18 Q 13 7 13 3 H 7 Z"
            fill="#bbc8ce" stroke="#4e555f" stroke-width="2.3"/>
          <path d="M 19 -3 L 28 -3 Q 33 -3 31 1 Q 30 4 27 4 H 20 Q 17 4 17 1 Z" fill="#f3f1ed" stroke="#67717a" stroke-width="1.4"/>
          <path d="M 15 -4 L 19 -6 H 28 M 22 7 L 25 2 L 24 -1" fill="none" stroke="#edf7fa" stroke-width="1.6" stroke-linecap="round"/>
        </g>
      </g>
      <g id="dog-paper" style="display:none" aria-hidden="true">
        ${SCRAPS.map((_, i) => `
          <g id="dog-scrap-${i}">
            <path d="M -9 -5 L -4 -7 L -1 -6 L 6 -9 L 9 -4 L 7 -1 L 9 5 L 3 4 L 1 8 L -3 6 L -7 8 L -8 2 Z"
              fill="${['#f7ead6', '#e5efec', '#fff8e7'][i % 3]}" stroke="#8e8074" stroke-width="1.1" stroke-linejoin="round"/>
            <path d="M -4 -2 L 3 -4 M -3 1 L 4 0" stroke="#b3a697" stroke-width=".85" fill="none" stroke-linecap="round"/>
          </g>`).join('')}
      </g>
      <g id="dog-caps" style="display:none" aria-hidden="true">
        ${PULLS.map(({ code }) => `<g id="dog-cap-${code}" transform="translate(-50 -50)">
          <rect class="key-cap" x="-13.5" y="-14" width="27" height="28" rx="5"/>
          <text class="key-label" x="0" y="3.2" transform="rotate(180)">${ctx.keycapText(code, null)}</text>
        </g>`).join('')}
      </g>`);
    $('keyboard').insertAdjacentHTML('beforeend', `
      <g id="dog-sockets" style="display:none" aria-hidden="true">
        ${PULLS.map(({ code }) => `
          <g id="dog-socket-${code}">
            <rect x="-10" y="-10.5" width="20" height="21" rx="3" fill="#26232b" stroke="#625a63" stroke-width="1.15"/>
            <path d="M -2.2 -6 H 2.2 V -2.2 H 6 V 2.2 H 2.2 V 6 H -2.2 V 2.2 H -6 V -2.2 H -2.2 Z"
              fill="#b29a83" stroke="#786a60" stroke-width=".8"/>
            <path d="M -1 -5 H 1.8 M -4.5 -1 H -2.3" fill="none" stroke="#ddc2a2" stroke-width=".9" stroke-linecap="round"/>
          </g>`).join('')}
      </g>
      <g id="dog-toothmarks" style="display:none" aria-hidden="true" fill="none" stroke-linecap="round">
        <path d="M -19 7 Q -16 16 -10 14 M -10 6 Q -8 15 -3 13 M 2 11 Q 0 19 6 20
          M 7 21 Q 5 30 12 30 M 10 31 Q 6 38 12 39" stroke="#795943" stroke-width="3"/>
        <path d="M -19 10 Q -16 18 -10 16 M -8 10 Q -6 16 -2 15 M 1 15 Q 1 21 6 22
          M 8 25 Q 6 31 11 32" stroke="#fff0d4" stroke-width="1.6"/>
      </g>`);
    face.insertAdjacentHTML('afterbegin', `
      <g id="dog-bite-mouth" style="display:none" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
        <path d="M 400 218 V 229 M 373 229 Q 380 236 389 231 Q 400 229 412 231 Q 420 236 427 229"
          fill="none" stroke="#442e25" stroke-width="2.8"/>
        <g id="dog-jaw">
          <path d="M 378 232 Q 390 227 400 230 Q 411 227 422 232 Q 419 246 400 246 Q 381 246 378 232 Z"
            fill="#58382e" stroke="#442e25" stroke-width="2.2"/>
          <path d="M 382 232 Q 391 230 398 232 Q 398 238 394 238 Q 391 238 390 235 Q 387 238 384 236 Z
            M 402 232 Q 411 230 418 232 L 416 236 Q 413 238 410 235 Q 408 238 405 238 Q 402 237 402 232 Z"
            fill="#fff1da"/>
        </g>
      </g>`);

    const leash = $('dog-leash'), bite = $('dog-bite-mouth'), jaw = $('dog-jaw');
    const paper = $('dog-paper'), caps = $('dog-caps'), sockets = $('dog-sockets'), marks = $('dog-toothmarks');
    const scraps = SCRAPS.map((_, i) => $('dog-scrap-' + i));
    const keys = PULLS.map((pull) => ({
      ...pull, cap: $('dog-cap-' + pull.code), socket: $('dog-socket-' + pull.code),
      gone: false,
    }));
    let corner;
    let marksUntil = 0;
    let biteShown = false, headForward = false;

    function keyboardChanged() {
      const { x, y, w } = kb.bounds;
      corner = { x: x + w - 16, y: y + 1 };
      marks.setAttribute('transform', `translate(${corner.x} ${corner.y})`);
      for (const key of keys) {
        key.home = kb.center(key.code);
        position(key.socket, key.home.x, key.home.y, 0, kb.heightScale);
      }
    }
    keyboardChanged();

    function placeCap(key, x, y, angle, size = 1) {
      position(key.cap, x, y, angle, size * kb.heightScale);
    }

    function setBite(on, gape = 1) {
      if (on !== biteShown) {
        biteShown = on;
        openMouth.style.visibility = closedMouth.style.visibility = on ? 'hidden' : '';
        show(bite, on);
      }
      if (on) jaw.setAttribute('transform', `translate(0 232) scale(1 ${gape.toFixed(3)}) translate(0 -232)`);
    }

    function setHole(key, on, pop = false) {
      if (key.gone !== on) {
        key.gone = on;
        kb.setGone(key.code, on);
        if (pop) kb.pop(key.code);
      }
      show(key.socket, on);
      show(key.cap, on);
    }

    function resetDamage() {
      for (const key of keys) setHole(key, false);
      show(caps, false);
      show(sockets, false);
      show(paper, false);
      putHeadForward(false);
    }
    function hide() {
      resetDamage();
      setBite(false);
      show(leash, false);
      show(marks, false);
    }
    function repairFinished(now) {
      marksUntil = now + MARK_LIFE;
    }
    function onWake(now) {
      marksUntil = Math.min(marksUntil, now + 1000);
    }
    const holeCount = () => keys.filter((key) => key.gone).length;

    function putHeadForward(on) {
      if (headForward === on) return;
      headForward = on;
      // 拔键帽时，嘴越过键盘上沿到键面。
      scene.insertBefore(head, on ? capsLayer : rear);
    }

    function ragePaw(paw, t) {
      const rest = ctx.restPoint(paw.side);
      const chew = chewAt(t);
      const nearCorner = paw.side === 'L';
      return {
        id: 'rage', x: mix(rest.x, corner.x - (nearCorner ? 16 : 132), chew),
        y: mix(rest.y, corner.y + (nearCorner ? 27 : 46), chew), tau: 38,
      };
    }

    function pose(phase, mood, rm, P) {
      if (phase.rage !== null) {
        const t = phase.rage;
        P.earDroop -= 6;
        if (rm) return;
        P.tailAmp = 19;
        P.tailSpeed = 0.031;
        let tx = 0, ty = 0, turn = 0, crouch = 0;
        for (const key of keys) {
          const age = t - key.time;
          if (age < -230 || age > 106) continue;
          const dip = pullDepth(age);
          tx += (key.home.x - MOUTH.x) * dip;
          ty += (key.home.y - MOUTH.y - 2) * dip;
          turn += pullTurn(key, age);
          crouch = Math.max(crouch, dip);
          if (dip > 0.05) P.look = key.home;
        }
        const chew = chewAt(t);
        if (chew > 0) {
          const nibble = Math.sin((t - 1820) / 17);
          tx += (corner.x - MOUTH.x - 12) * chew;
          ty += (corner.y - MOUTH.y + nibble * 3) * chew;
          turn += (16 + nibble * 2.6) * chew;
          P.look = corner;
        }
        P.headX += tx;
        P.headY += ty;
        P.headRot += turn;
        P.bodyX += 104 * chew + tx * 0.21;
        P.bodyY += ty * 0.12 + 60 * crouch + 45 * chew;
        P.bodySY *= 1 - 0.34 * crouch - 0.24 * chew;
        P.bodyRot += turn * 0.24;
        P.tailTipLift += 32 * (crouch + chew);
        return;
      }
      if (phase.repair !== null) {
        if (phase.repair >= 130 || rm) P.eyesHappy = true;
        P.earDroop -= 7;
        if (!rm) {
          const age = phase.repair - REPAIR_FIRST;
          const hop = keys.some((_, i) => age >= i * REPAIR_GAP && age < i * REPAIR_GAP + 110)
            ? Math.sin(Math.PI * (age % REPAIR_GAP) / 110) : 0;
          P.headY -= 8 * hop;
          P.bodyY -= 4 * hop;
          P.tailAmp = 24; P.tailSpeed = 0.03;
        }
        return;
      }
      if (!phase.strike && mood !== 'fine' && S.state !== STATES.ASLEEP) {
        P.earDroop -= 8;
        if (!rm) { P.tailAmp = 17; P.tailSpeed = 0.024; }
      }
    }

    function scatterCaps(t) {
      for (const key of keys) {
        const age = t - key.time;
        setHole(key, age >= 0);
        if (age < 0) continue;
        alpha(key.cap, 1);
        if (age >= 505) {
          placeCap(key, key.x, key.y, key.roll);
          continue;
        }
        if (age < 92) {
          const pull = smooth(age / 92);
          const mouth = ctx.headToScene(MOUTH.x, MOUTH.y);
          placeCap(key, mix(key.home.x, mouth.x, pull), mix(key.home.y, mouth.y, pull) - 7 * Math.sin(Math.PI * pull), key.roll * 0.25 * pull);
          continue;
        }
        const depth = pullDepth(92);
        const angle = pullTurn(key, 92) * Math.PI / 180;
        const neck = ctx.rig.head.pivot.y - MOUTH.y;
        const fromX = mix(MOUTH.x, key.home.x, depth) + neck * Math.sin(angle);
        const fromY = mix(MOUTH.y, key.home.y - 2, depth) + neck * (1 - Math.cos(angle));
        const p = limit((age - 92) / 325);
        const bounce = Math.sin(Math.PI * limit((age - 417) / 88)) * 12;
        placeCap(key, mix(fromX, key.x, 1 - (1 - p) ** 1.5),
          mix(fromY, key.y, p) - 100 * Math.sin(Math.PI * p) - bounce, mix(key.roll * 0.25, key.roll, p));
      }
    }

    function repairCaps(t, rm) {
      for (const [i, key] of keys.entries()) {
        const age = t - REPAIR_FIRST - i * REPAIR_GAP;
        setHole(key, age < REPAIR_FLIGHT, !rm && age >= REPAIR_FLIGHT);
        if (age >= REPAIR_FLIGHT) continue;
        if (rm || age < 0) {
          placeCap(key, key.x, key.y, key.roll);
          alpha(key.cap, rm ? 1 : 1 - smooth((age + 110) / 110));
          continue;
        }
        const mouth = ctx.headToScene(MOUTH.x, MOUTH.y);
        const p = limit(age / REPAIR_FLIGHT);
        const e = smooth(p);
        alpha(key.cap, 1);
        placeCap(key, mix(mouth.x, key.home.x, e),
          mix(mouth.y, key.home.y, e) - 38 * Math.sin(Math.PI * p),
          mix(key.roll, 0, p), mix(0.58, 1, smooth(p * 2.8)));
      }
    }

    function flyPaper(t) {
      for (const [i, [x, y, loft, rotation]] of SCRAPS.entries()) {
        const age = t - 1810 - 37 * i;
        const g = scraps[i];
        show(g, age >= 0);
        if (age < 0) continue;
        const p = limit(age / (560 + 31 * (i % 4)));
        const size = 0.7 + 0.34 * (i % 3);
        position(g, mix(corner.x - 9, x, 1 - (1 - p) ** 1.55),
          mix(corner.y - 6, y, p) - loft * Math.sin(Math.PI * p), rotation * p, mix(0.55, size, smooth(p * 4)));
      }
    }

    function render(now, rm, phase, mood) {
      const { rage, strike, repair } = phase;
      const damaged = rage !== null || strike || repair !== null;
      const growl = !rm && rage !== null && rage >= 1780 && rage < 2380;
      const holding = !damaged && mood !== 'fine' && S.state !== STATES.ASLEEP;
      const drop = !rm && rage !== null && rage < 310;
      // 啃角时下颚被键盘上沿挡住，露出上排牙和鼻头。
      putHeadForward(!rm && rage !== null && rage < 1530);
      setBite(holding || growl || (drop && rage < 60), growl ? 0.64 + 0.50 * (0.5 + 0.5 * Math.sin(rage / 17)) : 0.63);
      show(leash, holding || drop);
      if (holding || drop) {
        const mouth = ctx.headToScene(MOUTH.x, MOUTH.y);
        const p = drop ? smooth((rage - 45) / 265) : 0;
        const sway = rm ? 0 : 2.8 * Math.sin((drop ? rage : phase.time) / 170);
        position(leash, mix(mouth.x, 512, p), mix(mouth.y, 344, p), mix(sway, -38, p), 1 - 0.38 * p);
        alpha(leash, 1 - smooth((p - 0.68) / 0.32));
      }
      if (damaged) {
        show(caps, true);
        show(sockets, true);
        if (repair !== null) repairCaps(repair, rm);
        else scatterCaps(strike || rm ? 3000 : rage);
        const debrisTime = strike || repair !== null || rm ? 3000 : rage;
        show(paper, debrisTime >= 1810);
        if (debrisTime >= 1810) {
          flyPaper(debrisTime);
          alpha(paper, repair === null ? 1 : 1 - smooth((repair - 680) / 1190));
        }
      }
      const lingering = phase.fixedFinishedRepair || now < marksUntil;
      const fresh = damaged && (strike || repair !== null || rm || rage >= CHEW_MARK);
      show(marks, fresh || lingering);
      if (fresh || lingering) alpha(marks, fresh || phase.fixedFinishedRepair ? 1 : (marksUntil - now) / 1000);
    }

    return { pose, ragePaw, render, hide, resetDamage, repairFinished, onWake, holeCount, keyboardChanged };
  }

  window.SillyDogMischief = { create };
})();
