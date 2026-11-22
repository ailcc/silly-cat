// 睡眠三阶段：坐着睡 sitting -> 流口水 drool -> 趴在键盘上 slumped。
// 作为 cat.js 的扩展模块：只通过 ctx 和钩子工作，不直接处理输入事件。
(function () {
  'use strict';

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const DRIP_PERIOD = 3200, DRIP_GROW = 2400;
  const ANCHOR = { x: 419, y: 227 };          // 嘴角（头部局部坐标）
  const LIFT_MS = 400, WIPE_MS = 650, IMPRINT_MS = 6000;
  // 趴下时脸贴键盘的那条轮廓（头部局部坐标），用来算哪些键被压住
  const CONTACT = [[300, 236], [325, 256], [355, 270], [385, 276], [415, 275]];
  const SLUMP = { rot: -32, x: -4, y: 172 }; // 趴下时叠加到头上的姿态
  const ARMS_FIRST_MS = 700; // 趴下：先摆好手臂，再压低头
  // 趴下时的手臂：两只前爪向前平伸摊在键盘上（观众右侧白爪在右半边，观众左侧黑爪从脸下方伸出到左下角），
  // 手臂都在头的下面一层，不会横跨脸。
  const SPRAWL = { L: { x: 556, y: 486 }, R: { x: 262, y: 540 } };
  // ?demo= 时间轴（毫秒）
  const SLUMP_IN = { sit: 300, arms: 300 + ARMS_FIRST_MS, head: 2300, hold: 2900, lift: 3300, armsBack: 3900, period: 4300 };

  function create(ctx, opts = {}) {
    const { S, STATES, kb, fx, paws, approach, clamp, f1 } = ctx;
    const $ = (id) => document.getElementById(id);
    const E = {
      head: $('cat-head'), zzz: $('zzz'), above: $('debris-layer'),
      drool: $('drool'), strand: $('drool-strand'), outline: $('drool-outline'), bulb: $('drool-bulb'),
      imprint: $('imprint'), dents: $('imprint-dents'), tuft: $('imprint-tuft'), puddle: $('puddle'), pool: $('puddle-pool'), shine: $('puddle-shine'), drops: $('drops'),
    };
    let droolSec = Number.isFinite(opts.droolSeconds) ? opts.droolSeconds : null;
    let slumpSec = Number.isFinite(opts.slumpSeconds) ? opts.slumpSeconds : null;
    const droolMs = () => (droolSec !== null ? droolSec * 1000 : 2 * S.sleepMs);
    const slumpMs = () => (slumpSec !== null ? slumpSec * 1000 : 3.5 * S.sleepMs);

    const demo = opts.demo && ['drool', 'slumped', 'slump-in', 'wake-marks'].includes(opts.demo.name) ? opts.demo : null;
    const demoT0 = performance.now();
    const demoT = (now) => (demo && Number.isFinite(demo.at) ? demo.at
      : demo && demo.loop ? (now - demoT0) % (demo.name === 'slump-in' ? SLUMP_IN.period : IMPRINT_MS + 800)
        : demo && demo.name === 'wake-marks' ? Math.min(now - demoT0, 800) // 不循环时停在刚醒的样子
          : demo && demo.name === 'slump-in' ? Math.min(now - demoT0, SLUMP_IN.hold - 1) // 停在趴好
            : now - demoT0);

    const M = {
      stage: null, sp: 0, spAtWake: 0,
      liftStart: -1e9, wipeStart: -1e9, imprintStart: -1e9,
      dripStart: 0, lastDrop: -1, drops: [], puddleN: 0, puddleX: 400, puddleY: 398, puddleFade: -1,
      sunk: [], nextPressFx: 0, headOnTop: false, droolShown: false,
      slumpStart: -1e9, armsUntil: -1e9,
    };

    // ---------- 状态 ----------
    // demo：直接给出这一刻应处的阶段（不受计时影响）
    function demoStage(now) {
      if (demo.name === 'drool') return 'drool';
      if (demo.name === 'slumped') return 'slumped';
      if (demo.name === 'wake-marks') return null;
      const t = demoT(now);
      if (t < SLUMP_IN.sit) return 'sitting';
      if (t < SLUMP_IN.hold) return 'slumped';
      return null; // 抬头、收手、清醒
    }
    function overrideState(now) {
      if (!demo) return null;
      return demoStage(now) ? STATES.ASLEEP : STATES.AWAKE;
    }

    function stageAt(now) {
      if (demo) return demoStage(now);
      if (S.state !== STATES.ASLEEP) return null;
      const idle = now - S.lastInput;
      return idle >= slumpMs() ? 'slumped' : idle >= droolMs() ? 'drool' : 'sitting';
    }

    function setSunk(list) {
      for (const c of M.sunk) kb.setSunk(c, false);
      M.sunk = list;
      for (const c of M.sunk) kb.setSunk(c, true);
    }

    function contactKeys() {
      // 按"完全趴下"时的头部姿态算脸压住的键
      const rot = (S.headBaseRot + SLUMP.rot) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
      const tx = SLUMP.x, ty = 8 + SLUMP.y;
      const pts = CONTACT.map(([x, y]) => {
        const vx = x - 400, vy = y - 262;
        return { x: 400 + vx * c - vy * s + tx, y: 262 + vx * s + vy * c + ty };
      });
      const out = [];
      for (const code of kb.codes()) {
        const k = kb.center(code);
        if (!k || k.y < 380) continue;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const t = clamp(((k.x - a.x) * (b.x - a.x) + (k.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2), 0, 1);
          if (Math.hypot(k.x - (a.x + t * (b.x - a.x)), k.y - (a.y + t * (b.y - a.y))) < 17) { out.push(code); break; }
        }
      }
      return out;
    }

    function afterState(now) {
      const stage = stageAt(now);
      if (stage === M.stage) return;
      const prev = M.stage;
      M.stage = stage;
      if (stage === 'slumped') {
        setSunk(contactKeys()); M.nextPressFx = now + 4000 + Math.random() * 4000;
        M.slumpStart = now;
      } else if (prev === 'slumped') {
        setSunk([]);
        if (!demo) onWake(now); // 自然醒不会发生；这里兜底被直接切走的情况
      }
      if ((stage === 'drool' || stage === 'slumped') && !(prev === 'drool' || prev === 'slumped')) {
        M.dripStart = now; M.lastDrop = -1; M.puddleFade = -1;
      }
      if (!stage && (prev === 'drool' || prev === 'slumped')) M.puddleFade = now;
    }

    function onWake(now) {
      const stage = M.stage || stageAt(now);
      if (stage === 'slumped') {
        if (M.liftStart > now - LIFT_MS) return; // 已经在抬头
        M.liftStart = now; M.spAtWake = Math.max(M.sp, 0.01);
        M.armsUntil = now + LIFT_MS;  // 抬头时手臂先不动，抬完再收
        S.shakeStart = now + LIFT_MS; // 先抬头，再甩头
        M.imprintStart = now;
        const letters = M.sunk.map((c) => ctx.keycapText(c, null)).filter((t) => /^[A-Z]$/.test(t));
        $('imprint-letter').textContent = letters.length ? letters[Math.floor(Math.random() * letters.length)] : 'K';
      } else if (stage === 'drool') {
        M.wipeStart = now;
      }
    }

    // ---------- 爪子 ----------
    function softPawTarget(paw, now) {
      const sprawl = (S.state === STATES.ASLEEP && M.stage === 'slumped') || now < M.armsUntil;
      if (sprawl) {
        const p = SPRAWL[paw.side];
        return { id: 'sprawl', x: p.x, y: p.y, tau: 160 };
      }
      const tw = now - M.wipeStart;
      if (tw >= 0 && tw < WIPE_MS && paw === paws.R) {
        const m = ctx.headToScene(410, 236);
        return { id: 'wipe', x: m.x + 12 * Math.sin(tw / WIPE_MS * Math.PI * 4), y: m.y + 10, tau: 30 };
      }
      return null;
    }

    // ---------- 姿态 ----------
    function pose(now, dt, rm, P) {
      const tl = now - M.liftStart;
      if (demo && demo.name === 'slump-in') {
        // 演示：头的高度直接由时间轴决定，方便逐帧检查
        const t = demoT(now);
        if (t < SLUMP_IN.arms) M.sp = 0;
        else if (t < SLUMP_IN.head) M.sp = easeInOut((t - SLUMP_IN.arms) / (SLUMP_IN.head - SLUMP_IN.arms));
        else if (t < SLUMP_IN.hold) M.sp = 1;
        else if (t < SLUMP_IN.lift) M.sp = 1 - easeOut((t - SLUMP_IN.hold) / (SLUMP_IN.lift - SLUMP_IN.hold));
        else M.sp = 0;
        M.armsUntil = t >= SLUMP_IN.hold && t < SLUMP_IN.lift ? now + 50 : -1e9;
      } else if (tl >= 0 && tl < LIFT_MS) M.sp = M.spAtWake * (1 - easeOut(tl / LIFT_MS));
      else {
        // 先摆手臂，再压低头
        const armsReady = now - M.slumpStart > ARMS_FIRST_MS;
        const goal = S.state === STATES.ASLEEP && M.stage === 'slumped' && armsReady ? 1 : 0;
        M.sp = approach(M.sp, goal, dt, goal ? 900 : 90);
      }
      const sp = M.sp;
      P.headRot += SLUMP.rot * sp; P.headX += SLUMP.x * sp; P.headY += SLUMP.y * sp;
      P.bodyRot += -6 * sp; P.bodyY += 16 * sp;
      P.earDroop += 28 * sp;
      P.breath *= 1 + 1.4 * sp;
      P.zzzDx += -50 * sp; P.zzzDy += 130 * sp;
    }

    // ---------- 渲染 ----------
    function spawnDrop(x, y, now) {
      const NS = 'http://www.w3.org/2000/svg';
      const g = document.createElementNS(NS, 'circle');
      g.setAttribute('r', '3.6');
      g.setAttribute('class', 'drool-bulb');
      E.drops.appendChild(g);
      const ground = Math.max(396 + Math.random() * 6, y + 10);
      M.drops.push({ g, x, y, vy: 0, ground });
    }

    function renderDrool(now, dt, rm) {
      const active = S.state === STATES.ASLEEP && (M.stage === 'drool' || M.stage === 'slumped');
      if (active !== M.droolShown) { E.drool.style.display = active ? '' : 'none'; M.droolShown = active; }
      if (active) {
        let L;
        if (rm) L = 14;
        else {
          const t = now - M.dripStart;
          const c = t % DRIP_PERIOD;
          L = c < DRIP_GROW ? 4 + 30 * easeInOut(c / DRIP_GROW) : 4 + 3 * ((c - DRIP_GROW) / (DRIP_PERIOD - DRIP_GROW));
          const k = Math.floor((t - DRIP_GROW) / DRIP_PERIOD);
          if (k > M.lastDrop) {
            M.lastDrop = k;
            const a = ctx.headToScene(ANCHOR.x, ANCHOR.y);
            spawnDrop(a.x, a.y + 34 + 4, now);
          }
        }
        const r = 2.6 + L * 0.07;
        const d = `M ${ANCHOR.x} ${ANCHOR.y} Q ${ANCHOR.x + 1.5} ${f1(ANCHOR.y + L * 0.6)} ${ANCHOR.x} ${f1(ANCHOR.y + L)}`;
        E.strand.setAttribute('d', d);
        E.outline.setAttribute('d', d);
        E.bulb.setAttribute('cx', ANCHOR.x);
        E.bulb.setAttribute('cy', f1(ANCHOR.y + L + r * 0.5));
        E.bulb.setAttribute('r', f1(r));
        // 抵消头部旋转，让口水始终竖直往下垂
        E.drool.setAttribute('transform', `rotate(${(-S.headTf.rot).toFixed(2)} ${ANCHOR.x} ${ANCHOR.y})`);
      }

      // 下落的口水滴
      for (let i = M.drops.length - 1; i >= 0; i--) {
        const d = M.drops[i];
        d.vy += 0.0018 * dt;
        d.y += d.vy * dt;
        if (d.y >= d.ground) {
          d.g.remove(); M.drops.splice(i, 1);
          M.puddleN = Math.min(M.puddleN + 1, 7);
          M.puddleX = M.puddleN === 1 ? d.x : M.puddleX + (d.x - M.puddleX) * 0.4;
          M.puddleY = d.ground + 2;
          continue;
        }
        d.g.setAttribute('cx', f1(d.x));
        d.g.setAttribute('cy', f1(d.y));
      }

      // 键盘上的水渍
      let op = 1;
      if (M.puddleFade >= 0) {
        op = 1 - (now - M.puddleFade - 1500) / 4000;
        if (op <= 0) { M.puddleN = 0; M.puddleFade = -1; }
        op = clamp(op, 0, 1);
      }
      if (M.puddleN > 0 && !rm) {
        E.puddle.style.display = '';
        const n = M.puddleN;
        E.pool.setAttribute('cx', f1(M.puddleX)); E.pool.setAttribute('cy', f1(M.puddleY));
        E.pool.setAttribute('rx', f1(7 + 3.6 * n)); E.pool.setAttribute('ry', f1(2.6 + 1.1 * n));
        E.shine.setAttribute('cx', f1(M.puddleX - 2 - n)); E.shine.setAttribute('cy', f1(M.puddleY - 0.6 - 0.3 * n));
        E.shine.setAttribute('rx', f1(2 + 1.1 * n)); E.shine.setAttribute('ry', f1(0.8 + 0.3 * n));
        E.puddle.setAttribute('opacity', op.toFixed(3));
      } else {
        E.puddle.style.display = 'none';
      }
    }

    function render(now, dt, rm) {
      // 趴下时把头挪到键盘和手臂之上（只移动节点，不重建）
      // 趴下、抬头的整个过程里头都在手臂之上，手臂不会横跨脸
      const onTop = M.sp > 0.005 || (S.state === STATES.ASLEEP && M.stage === 'slumped') || now < M.armsUntil;
      if (onTop !== M.headOnTop) {
        M.headOnTop = onTop;
        if (onTop) E.above.parentNode.insertBefore(E.head, E.above);
        else E.zzz.parentNode.insertBefore(E.head, E.zzz);
      }
      renderDrool(now, dt, rm);

      // 脸颊上的键帽压痕
      if (demo && demo.name === 'wake-marks') M.imprintStart = now - demoT(now);
      const ti = now - M.imprintStart;
      if (ti >= 0 && ti < IMPRINT_MS) {
        // 先保持，再变浅（凹痕缩小、颜色淡），最后消失
        E.imprint.style.display = '';
        E.tuft.style.display = ti < 3500 ? '' : 'none';
        const fade = ti < 2200 ? 0 : (ti - 2200) / (IMPRINT_MS - 2200);
        E.imprint.setAttribute('opacity', (0.42 * (1 - fade * fade)).toFixed(3));
        const k = 1 - 0.18 * fade;
        E.dents.setAttribute('transform', `translate(310 240) scale(${k.toFixed(3)}) translate(-310 -240)`);
      } else { E.imprint.style.display = 'none'; E.tuft.style.display = 'none'; }

      // 脸压出来的字
      if (S.state === STATES.ASLEEP && M.stage === 'slumped' && M.sunk.length && now >= M.nextPressFx) {
        const code = M.sunk[Math.floor(Math.random() * M.sunk.length)];
        const c = kb.center(code);
        fx.spawn(ctx.keycapText(code, null), c.x, c.y, '', now);
        M.nextPressFx = now + 4000 + Math.random() * 4000;
      }
    }

    return {
      afterState, onWake, softPawTarget, pose, render, overrideState,
      setDroolSeconds(v) { droolSec = Number.isFinite(v) ? v : null; },
      setSlumpSeconds(v) { slumpSec = Number.isFinite(v) ? v : null; },
      debugProps: {
        sleepStage: () => (S.state === STATES.ASLEEP ? M.stage : null),
        sunkKeys: () => Object.freeze(M.sunk.slice()),
      },
    };
  }

  window.SillySleep = { create };
})();
