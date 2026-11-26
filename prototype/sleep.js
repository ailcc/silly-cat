// 睡眠三阶段：坐着睡 sitting -> 流口水 drool -> 趴在键盘上 slumped。
// 作为 cat.js 的扩展模块：只通过 ctx 和钩子工作，不直接处理输入事件。
(function () {
  'use strict';

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const DRIP_PERIOD = 3200, DRIP_GROW = 2400;
  const LIFT_MS = 400, WIPE_MS = 650, IMPRINT_MS = 6000;
  const easeIn = (t) => t * t;
  const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));

  // ---------- 趴下方式 ----------
  // 每次进入趴下阶段随机选一种（?slump-style= 可强制指定，调试用）。
  // 每种方式是一个"从开始趴到趴好"的时间函数，返回叠加到猫身上的姿态；t >= 时长 时就是趴好的样子。
  // 爪子都不动（留在睡着时的位置），头始终画在手臂上层。
  const STYLES = ['nod', 'melt'];
  const STYLE_MS = { nod: 3300, melt: 2500 };
  const randomStyle = () => STYLES[Math.random() < 0.5 ? 0 : 1];
  const EAR_FLICK_GAP = 700; // 睡着时移动鼠标：最多这么久抖一次耳朵
  const ZERO = Object.freeze({ hx: 0, hy: 0, hr: 0, hsx: 1, hsy: 1, by: 0, br: 0, bsx: 1, bsy: 1, ear: 0, amt: 0 });
  const ADD = ['hx', 'hy', 'hr', 'by', 'br', 'ear', 'amt'], MUL = ['hsx', 'hsy', 'bsx', 'bsy'];
  const mix = (Q, k) => { const o = {}; for (const f of ADD) o[f] = Q[f] * k; for (const f of MUL) o[f] = 1 + (Q[f] - 1) * k; return o; };

  // nod 点头栽倒：点两次、一次比一次低、每次猛地抬回来一点，第三次直接栽到键盘上，落下小回弹
  function nodPose(t, { dip, rebound, finalDip, land, bounce, pose: P }) {
    let hy;
    if (t < 900) hy = dip[0] * easeIn(t / 900);
    else if (t < 1100) hy = dip[0] - (dip[0] - rebound[0]) * easeOut((t - 900) / 200);
    else if (t < 1400) hy = rebound[0];
    else if (t < 2300) hy = rebound[0] + (dip[1] - rebound[0]) * easeIn((t - 1400) / 900);
    else if (t < 2500) hy = dip[1] - (dip[1] - rebound[1]) * easeOut((t - 2300) / 200);
    else if (t < 2750) hy = rebound[1] + (finalDip - rebound[1]) * (t - 2500) / 250;
    else if (t < 3050) hy = finalDip + (land - finalDip) * easeIn((t - 2750) / 300);
    else if (t < 3300) hy = land - bounce * Math.sin(Math.PI * (t - 3050) / 250);
    else hy = land;
    const k = hy / land;
    return { ...ZERO, hy, hx: P.hx * k, hr: P.hr * k, hsx: 1 + P.hsx * k, hsy: 1 + P.hsy * k,
      by: P.by * k, bsy: 1 + P.bsy * k, ear: P.ear * k, amt: k };
  }
  // melt 融化摊平：身体先慢慢变宽变扁，头稍晚一点顺势滑到键盘上，缓入缓出
  function meltPose(t, P) {
    const pb = easeInOut(seg(t, 0, 2200)), ph = easeInOut(seg(t, 200, 2500));
    // 身体要摊得比头还宽，两侧才看得见"化开"的一圈
    return { ...ZERO, hy: P.hy * ph, hx: P.hx * ph, hr: P.hr * ph, hsx: 1 + P.hsx * ph, hsy: 1 + P.hsy * ph,
      by: P.by * pb, bsx: 1 + P.bsx * pb, bsy: 1 + P.bsy * pb, ear: P.ear * ph, amt: ph };
  }
  const POSES = { nod: nodPose, melt: meltPose };
  const stylePose = (style, t) => POSES[style](Math.max(0, Math.min(t, STYLE_MS[style])),
    window.SillySpecies.current.sleep.slump[style]);

  // ?demo=slump-in 时间轴（毫秒）：坐着睡 -> 趴下过渡 -> 趴好停一会 -> 快速起身 -> 清醒
  const slumpIn = (style) => {
    const sit = 300, land = sit + STYLE_MS[style];
    return { sit, land, hold: land + 900, lift: land + 900 + LIFT_MS, period: land + 900 + LIFT_MS + 500 };
  };

  function create(ctx, opts = {}) {
    const { S, STATES, kb, fx, paws, clamp, f1 } = ctx;
    const $ = (id) => document.getElementById(id);
    const E = {
      head: $('cat-head'), strike: $('cat-strike'), above: $('debris-layer'),
      drool: $('drool'), strand: $('drool-strand'), outline: $('drool-outline'), bulb: $('drool-bulb'),
      imprint: $('imprint'), dents: $('imprint-dents'), tuft: $('imprint-tuft'), puddle: $('puddle'), pool: $('puddle-pool'), shine: $('puddle-shine'), drops: $('drops'),
    };
    let droolSec = Number.isFinite(opts.droolSeconds) ? opts.droolSeconds : null;
    let slumpSec = Number.isFinite(opts.slumpSeconds) ? opts.slumpSeconds : null;
    const droolMs = () => (droolSec !== null ? droolSec * 1000 : 2 * S.sleepMs);
    const slumpMs = () => (slumpSec !== null ? slumpSec * 1000 : 3.5 * S.sleepMs);

    const forcedStyle = STYLES.includes(opts.slumpStyle) ? opts.slumpStyle : null;
    // 当次用的方式：真实流程每次进入趴下时重选；demo 在页面加载时选一次（循环时间轴的长度跟着方式走，不能中途换）
    let style = forcedStyle || randomStyle();
    const demo = opts.demo && ['drool', 'slumped', 'slump-in', 'wake-marks'].includes(opts.demo.name) ? opts.demo : null;
    const demoT0 = performance.now();
    const demoT = (now) => (demo && Number.isFinite(demo.at) ? demo.at
      : demo && demo.loop ? (now - demoT0) % (demo.name === 'slump-in' ? slumpIn(style).period : IMPRINT_MS + 800)
        : demo && demo.name === 'wake-marks' ? Math.min(now - demoT0, 800) // 不循环时停在刚醒的样子
          : demo && demo.name === 'slump-in' ? Math.min(now - demoT0, slumpIn(style).hold - 1) // 停在趴好
            : now - demoT0);

    const M = {
      stage: null, cur: ZERO, wakePose: ZERO, landed: false, sunkOn: false,
      liftStart: -1e9, wipeStart: -1e9, imprintStart: -1e9,
      dripStart: 0, lastDrop: -1, drops: [], puddleN: 0, puddleX: 400, puddleY: 398, puddleFade: -1,
      sunk: [], contactShape: null, nextPressFx: 0, headOnTop: false, droolShown: false,
      slumpStart: -1e9,
    };

    // ---------- 状态 ----------
    // demo：直接给出这一刻应处的阶段（不受计时影响）
    function demoStage(now) {
      if (demo.name === 'drool') return 'drool';
      if (demo.name === 'slumped') return 'slumped';
      if (demo.name === 'wake-marks') return null;
      const t = demoT(now);
      const T = slumpIn(style);
      if (t < T.sit) return 'sitting';
      if (t < T.hold) return 'slumped';
      return null; // 起身、清醒
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

    function contactKeys({ cx, cy, rx, ry }) {
      // 按头此刻的实际位置，落在头形里的键都算被压住
      const out = [];
      for (const code of kb.codes()) {
        const k = kb.center(code);
        if (!k) continue;
        const h = ctx.sceneToHead(k.x, k.y);
        if (((h.x - cx) / rx) ** 2 + ((h.y - cy) / ry) ** 2 <= 1) out.push(code);
      }
      return out;
    }

    function afterState(now) {
      const stage = stageAt(now);
      if (stage === M.stage) return;
      const prev = M.stage;
      M.stage = stage;
      if (stage === 'slumped') {
        M.nextPressFx = now + 4000 + Math.random() * 4000;
        M.slumpStart = now; // 压键等落到键盘上（render 里）再算
        if (!demo) style = forcedStyle || randomStyle();
      } else if (prev === 'slumped') {
        setSunk([]); M.sunkOn = false;
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
        M.liftStart = now; M.wakePose = M.cur; // 从此刻的姿态快速反向起身
        S.shakeStart = now + LIFT_MS; // 先起身，再甩头
        M.imprintStart = now;
        const letters = M.sunk.map((c) => ctx.keycapText(c, null)).filter((t) => /^[A-Z]$/.test(t));
        $('imprint-letter').textContent = letters.length ? letters[Math.floor(Math.random() * letters.length)] : 'K';
      } else if (stage === 'drool') {
        M.wipeStart = now;
      }
    }

    // ---------- 输入 ----------
    // 睡着时（坐着睡、流口水、趴着，含趴下过渡）单纯移动鼠标：不醒、尾巴不去够鼠标、睡眠计时照走，只抖一下耳朵。
    // 按键、鼠标点击、摸头照常叫醒；犯困（drowsy）时不拦。
    function block(kind, arg, now) {
      if (kind !== 'pointerMove' || S.state !== STATES.ASLEEP) return false;
      if (!ctx.reducedMotion() && now - S.twitch.start > EAR_FLICK_GAP) S.twitch = { ear: Math.random() < 0.5 ? 'L' : 'R', start: now };
      return true;
    }

    // ---------- 爪子 ----------
    function softPawTarget(paw, now) {
      const tw = now - M.wipeStart;
      if (tw >= 0 && tw < WIPE_MS && paw === paws.R) {
        const { x, y } = window.SillySpecies.current.sleep.wipeAnchor;
        const m = ctx.headToScene(x, y);
        return { id: 'wipe', x: m.x + 12 * Math.sin(tw / WIPE_MS * Math.PI * 4), y: m.y + 10, tau: 30 };
      }
      return null;
    }

    // ---------- 姿态 ----------
    // 头部局部点在给定姿态下的画面位置（不含呼吸等小动作），用来让 Zzz 跟着头
    function mapHead(p, Q) {
      const rot = (S.headBaseRot + Q.hr) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
      const { x, y } = window.SillySpecies.current.rig.head.pivot;
      const vx = (p.x - x) * Q.hsx, vy = (p.y - y) * Q.hsy;
      return { x: x + vx * c - vy * s + S.headBaseX + Q.hx, y: y + vx * s + vy * c + S.headBaseY + Q.hy };
    }

    function pose(now, dt, rm, P) {
      const D = STYLE_MS[style], full = () => stylePose(style, D);
      let Q = ZERO, landed = false;
      if (demo && demo.name === 'slump-in') {
        // 演示：姿态直接由时间轴决定，方便逐帧检查
        const T = slumpIn(style), t = demoT(now);
        if (t < T.sit) Q = ZERO;
        else if (t < T.land) { Q = rm ? full() : stylePose(style, t - T.sit); landed = rm; }
        else if (t < T.hold) { Q = full(); landed = true; }
        else if (t < T.lift && !rm) Q = mix(full(), 1 - easeOut((t - T.hold) / LIFT_MS));
      } else {
        const tl = now - M.liftStart;
        if (!rm && tl >= 0 && tl < LIFT_MS) Q = mix(M.wakePose, 1 - easeOut(tl / LIFT_MS));
        else if (S.state === STATES.ASLEEP && M.stage === 'slumped') {
          const t = rm || (demo && demo.name === 'slumped') ? D : now - M.slumpStart;
          Q = stylePose(style, t); landed = t >= D;
        }
      }
      M.cur = Q; M.landed = landed;
      P.headRot += Q.hr; P.headX += Q.hx; P.headY += Q.hy; P.headSX *= Q.hsx; P.headSY *= Q.hsy;
      P.bodyRot += Q.br; P.bodyY += Q.by; P.bodySX *= Q.bsx; P.bodySY *= Q.bsy;
      P.earDroop += Q.ear;
      P.breath *= 1 + 1.4 * Q.amt;
      if (Q !== ZERO) {
        const anchor = window.SillySpecies.current.sleep.zzzAnchor;
        const a = mapHead(anchor, Q), b = mapHead(anchor, ZERO);
        P.zzzDx += a.x - b.x; P.zzzDy += a.y - b.y;
      }
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
        const anchor = window.SillySpecies.current.sleep.droolAnchor;
        let L;
        if (rm) L = 14;
        else {
          const t = now - M.dripStart;
          const c = t % DRIP_PERIOD;
          L = c < DRIP_GROW ? 4 + 30 * easeInOut(c / DRIP_GROW) : 4 + 3 * ((c - DRIP_GROW) / (DRIP_PERIOD - DRIP_GROW));
          const k = Math.floor((t - DRIP_GROW) / DRIP_PERIOD);
          if (k > M.lastDrop) {
            M.lastDrop = k;
            const a = ctx.headToScene(anchor.x, anchor.y);
            spawnDrop(a.x, a.y + 34 + 4, now);
          }
        }
        const r = 2.6 + L * 0.07;
        const d = `M ${anchor.x} ${anchor.y} Q ${anchor.x + 1.5} ${f1(anchor.y + L * 0.6)} ${anchor.x} ${f1(anchor.y + L)}`;
        E.strand.setAttribute('d', d);
        E.outline.setAttribute('d', d);
        E.bulb.setAttribute('cx', anchor.x);
        E.bulb.setAttribute('cy', f1(anchor.y + L + r * 0.5));
        E.bulb.setAttribute('r', f1(r));
        // 抵消头部旋转，让口水始终竖直往下垂
        E.drool.setAttribute('transform', `rotate(${(-S.headTf.rot).toFixed(2)} ${anchor.x} ${anchor.y})`);
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
      // 趴下时把头挪到键盘和手臂之上（只移动节点，不重建）；趴下、起身的整个过程里头都在手臂之上
      const asleepSlumped = S.state === STATES.ASLEEP && M.stage === 'slumped';
      const onTop = M.cur.amt > 0.005 || asleepSlumped;
      if (onTop !== M.headOnTop) {
        M.headOnTop = onTop;
        if (onTop) E.above.parentNode.insertBefore(E.head, E.above);
        else E.strike.parentNode.insertBefore(E.head, E.strike);
      }
      // 落到键盘上那一刻按头的实际位置压键
      const wantSunk = asleepSlumped && M.landed;
      const sleep = window.SillySpecies.current.sleep;
      const contactShape = wantSunk ? sleep.contactShape : null;
      if (wantSunk !== M.sunkOn || contactShape !== M.contactShape) {
        M.sunkOn = wantSunk;
        M.contactShape = contactShape;
        setSunk(wantSunk ? contactKeys(contactShape) : []);
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
        const k = kb.heightScale * (1 - 0.18 * fade);
        const { x, y } = sleep.imprintPivot;
        E.dents.setAttribute('transform', `translate(${x} ${y}) scale(${k.toFixed(3)}) translate(${-x} ${-y})`);
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
      afterState, onWake, softPawTarget, pose, render, overrideState, block,
      keyboardChanged() { M.sunkOn = false; M.sunk = []; },
      setDroolSeconds(v) { droolSec = Number.isFinite(v) ? v : null; },
      setSlumpSeconds(v) { slumpSec = Number.isFinite(v) ? v : null; },
      debugProps: {
        sleepStage: () => (S.state === STATES.ASLEEP ? M.stage : null),
        sunkKeys: () => Object.freeze(M.sunk.slice()),
        slumpStyle: () => style,
      },
    };
  }

  window.SillySleep = { create };
})();
