// 疲劳与情绪：打字太久 -> 累了 -> 生气 -> 发飙砸键盘、砸鼠标 -> 罢工 -> 休息够了消气 -> 自己动手修好。
// 作为 cat.js 的扩展模块：通过钩子拦截输入（只影响画面，不碰真实的浏览器事件）。
(function () {
  'use strict';

  const TYPING_WINDOW = 3000;        // 距上一次按键不超过 3 秒算"正在打字"
  // ---- 发飙时间轴（毫秒，从发飙开始算） ----
  const RAGE_MS = 3000;
  const STAND_MS = 300;
  const SMASH_T0 = 300, SMASH_CYCLE = 400, IMPACTS = [560, 960, 1360]; // 三次砸键盘落下
  const MOUSE_T0 = 1500;             // 砸鼠标：伸手 0-110，举过头顶 110-360，砸下 360-480，
  const M_REACH = 110, M_LIFT = 360, M_HIT = 480, M_SPLIT = 530, M_PAT0 = 620, M_PAT1 = 760, M_END = 900; // 压扁回弹，裂开，补一爪
  const SIT_T0 = 2400;
  // ---- 修理时间轴（从消气开始算） ----
  const REPAIR_MS = 2150;
  const TURN_MS = 260;
  const CAP_T0 = 260, CAP_GAP = 35, CAP_FLY = 170;
  const WIPE_T0 = 1100, WIPE_MID = 1325, WIPE_T1 = 1550;
  const FIX_T0 = 1550, FIX_SNAP = 1740, FIX_PAT0 = 1830, FIX_PAT1 = 1950;
  const SPARKLE_T0 = 1950;
  const MOUSE_BANDAGE_MS = 60000;

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const DEMOS = ['tired', 'sigh', 'angry', 'rage', 'strike', 'repair'];

  function create(ctx, opts = {}) {
    const { S, STATES, kb, paws, clamp, f1 } = ctx;
    const $ = (id) => document.getElementById(id);
    let workSec = opts.workSeconds || 90;
    let restSec = opts.restSeconds || 20;
    const demo = opts.demo && DEMOS.includes(opts.demo.name) ? opts.demo : null;
    const pinnedV = demo ? { tired: 0.72, sigh: 0.72, angry: 0.93 }[demo.name] : undefined;

    // 键盘上的裂纹（带"擦掉"用的遮罩）
    $('keyboard').insertAdjacentHTML('beforeend', `
      <mask id="crack-mask" maskUnits="userSpaceOnUse" x="140" y="350" width="520" height="260">
        <rect x="140" y="350" width="520" height="260" fill="#fff"/>
        <rect id="crack-wiped-top" x="140" y="350" width="0" height="127" fill="#000"/>
        <rect id="crack-wiped-bottom" x="660" y="477" width="0" height="133" fill="#000"/>
      </mask>
      <g id="kb-crack" style="display:none" mask="url(#crack-mask)">
        <path class="crack-gap" d="M 392 378 L 404 402 L 396 424 L 414 448 L 404 476 L 420 506 L 410 540"/>
        <path class="crack" d="M 392 378 L 404 402 L 396 424 L 414 448 L 404 476 L 420 506 L 410 540
          M 404 402 L 440 412 L 452 436 M 414 448 L 372 466 L 356 492 M 420 506 L 470 520 L 486 546
          M 250 388 L 262 404 L 254 418 M 560 540 L 548 556 L 556 572"/>
      </g>`);

    const E = {
      scene: $('scene'), keyboard: $('keyboard'), crack: $('kb-crack'),
      wipedTop: $('crack-wiped-top'), wipedBottom: $('crack-wiped-bottom'),
      mouseBandage: $('mouse-bandage'),
      brows: $('brows'), sweat: $('sweat'), anger: $('anger'),
      sigh: $('sigh'), sighC: [$('sigh-a'), $('sigh-b'), $('sigh-c')],
      strike: $('cat-strike'), strikeHead: $('strike-head'), strikeTail: $('strike-tail'), peekEye: $('peek-eye'),
      strikeEar: { l: $('strike-ear-l'), r: $('strike-ear-r') },
      debris: $('debris-layer'), bubbles: $('bubble-layer'),
      hint: $('rest-hint'), bar: $('fatigue-bar'),
    };

    const F = {
      v: 0, lastT: performance.now(),
      rage: null, strike: null, repair: null, demoHoldUntil: 0,
      broken: false, shattered: false, impactsDone: 0, mouseHitDone: false, splitDone: false,
      kbRot: 0, kbTy: 0, mouseBandageUntil: 0,
      kbShakeStart: -1e9, shakeUntil: 0, shakeAmp: 0,
      nextSigh: performance.now() + 2500, sighStart: -1e9, earFlick: -1e9, earSide: 'l',
      debris: [], bubbles: [], effects: [], shown: {}, ghosts: null, cloth: null, hist: { L: [], R: [] },
    };

    const moodOf = (v) => (v < 0.6 ? 'fine' : v < 0.85 ? 'tired' : 'angry');
    const mood = () => (F.rage || F.strike ? 'angry' : F.repair ? 'fine' : moodOf(F.v));
    const mouseDir = () => (ctx.mouseHome().x < 400 ? -1 : 1); // 鼠标在画面哪一侧

    // ---------- 状态推进（读取调试信息时也会调用，保证后台节流时也准） ----------
    function refresh(now) {
      let t = F.lastT;
      if (now <= t) return;
      F.lastT = now;
      if (demo) { demoRefresh(now); if (pinnedV !== undefined) return; }
      if (!F.rage && !F.strike && !F.repair) {
        const W = workSec * 1000, dt = now - t;
        const typing = clamp(Math.min(now, S.lastKeyAt + TYPING_WINDOW) - t, 0, dt);
        const idle = dt - typing;
        if (typing > 0) {
          const need = (1 - F.v) * W;
          if (typing >= need) { F.v = 1; t += need; startRage(t); }
          else F.v += typing / W;
        }
        if (!F.rage) {
          F.v -= idle * 3 / W;                 // 没在打字：3 倍速回落
          if (S.pet) F.v -= dt * 0.0001;       // 摸头：额外每秒 0.1
          F.v = clamp(F.v, 0, 1);
          return;
        }
      }
      if (F.rage) {
        const end = F.rage.start + RAGE_MS;
        if (now < end) return;
        if (demo && demo.name === 'rage' && demo.loop) { resetScene(); startRage(end); return; }
        enterStrike(end);
        t = end;
      }
      if (F.strike) {
        if (demo && demo.name === 'strike') return; // 演示：一直罢工
        F.strike.restMs += (now - Math.max(t, F.strike.start)) * (S.pet ? 2 : 1); // 摸头：休息快一倍
        if (F.strike.restMs >= restSec * 1000) endStrike(now);
        t = now;
      }
      if (F.repair && now >= F.repair.start + REPAIR_MS) finishRepair(F.repair.start + REPAIR_MS);
    }

    function startRage(t) {
      F.rage = { start: t };
      F.impactsDone = 0; F.mouseHitDone = false; F.splitDone = false; F.patDone = false;
      ctx.releaseAll();
      S.excited = false;
      if (ctx.reducedMotion()) { brokenStatic(t, false); F.impactsDone = IMPACTS.length; F.mouseHitDone = F.splitDone = true; }
    }
    function enterStrike(t) {
      F.rage = null;
      F.broken = true;
      F.strike = { start: t, restMs: 0, count: 0, hmphAt: 5 + Math.floor(Math.random() * 5), nextPeek: t + rand(2500, 4500), peek: -1e9 };
    }
    function endStrike(now) {
      F.strike = null;
      F.v = 0;
      if (ctx.reducedMotion()) { finishRepair(now); return; }
      startRepair(now);
    }
    function startRepair(now) {
      F.repair = { start: now };
      // 给每个散落的键帽排好飞回的顺序
      const caps = F.debris.filter((d) => d.kind === 'cap');
      caps.forEach((d, i) => { d.order = i; d.from = null; });
      F.repair.caps = caps;
    }
    function finishRepair(t) {
      F.repair = null;
      F.v = 0;
      resetScene();
      F.mouseBandageUntil = t + MOUSE_BANDAGE_MS;
      S.lastInput = t; // 之后的无输入计时从这里重新走向犯困和睡觉
      if (demo && demo.name === 'repair' && demo.loop) F.demoHoldUntil = t + 800;
    }
    function resetScene() {
      for (const d of F.debris) d.g.remove();
      F.debris.length = 0;
      for (const c of kb.codes()) kb.setGone(c, false);
      F.broken = false; F.shattered = false;
      E.wipedTop.setAttribute('width', 0); E.wipedBottom.setAttribute('x', 660); E.wipedBottom.setAttribute('width', 0);
    }

    // ---------- 演示 ----------
    function demoRefresh(now) {
      if (pinnedV !== undefined) { F.v = pinnedV; return; }
      if (F.v === 0 && !F.rage && !F.strike && !F.repair && !F.demoStarted) {
        F.demoStarted = true;
        if (demo.name === 'rage') { F.v = 1; startRage(now); }
        else if (demo.name === 'strike') { F.v = 1; brokenStatic(now, true); enterStrike(now - 400); }
        else if (demo.name === 'repair') { brokenStatic(now, true); startRepair(now); }
      }
      if (demo.name === 'repair' && !F.repair && F.demoHoldUntil && now >= F.demoHoldUntil) {
        F.demoHoldUntil = 0; brokenStatic(now, true); startRepair(now);
      }
      if (Number.isFinite(demo.at)) { // 冻结在时间轴上的某一刻
        if (F.rage) F.rage.start = now - demo.at;
        if (F.repair) F.repair.start = now - demo.at;
      }
      if (demo.name === 'strike' && F.strike) F.strike.restMs = 0;
    }
    // 直接摆出"砸烂了"的样子：键帽散在桌上、鼠标碎成两半
    function brokenStatic(now, withCaps) {
      resetScene();
      F.broken = true; F.shattered = true;
      if (withCaps) {
        const pool = kb.codes();
        for (let k = 0; k < 18; k++) {
          const code = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
          kb.setGone(code, true);
          const d = makeCap(code, rand(40, 760), rand(590, 610));
          d.rest = true; d.r = rand(-180, 180);
          placeDebris(d);
        }
      }
      const H = ctx.mouseHome(), T = slamPoint();
      for (const side of [-1, 1]) {
        const d = makeHalf(side, T.x + side * rand(26, 40), T.y + rand(6, 14));
        d.rest = true; d.r = side * rand(60, 110);
        placeDebris(d);
      }
      const w = makeWheel(T.x - mouseDir() * 60, T.y + 16); w.rest = true; w.r = 90; placeDebris(w);
      void H;
    }

    function overrideState() {
      if (F.rage) return STATES.RAGE;
      if (F.strike) return STATES.STRIKE;
      if (F.repair) return STATES.REPAIR;
      return null;
    }

    // ---------- 输入拦截：只是猫不理人，真实输入照常 ----------
    function block(kind, arg, now) {
      if (F.rage || F.repair) return !(kind === 'petEnd' || kind === 'keyUp' || kind === 'pointerUp');
      if (F.strike) {
        if (kind === 'petStart' || kind === 'petMove' || kind === 'petEnd') return false; // 摸头不算输入
        F.strike.restMs = 0;
        if (kind === 'keyDown') {
          F.earFlick = now; F.earSide = Math.random() < 0.5 ? 'l' : 'r';
          if (++F.strike.count >= F.strike.hmphAt) {
            F.strike.count = 0; F.strike.hmphAt = 5 + Math.floor(Math.random() * 5);
            spawnHmph(now);
          }
        }
        return true;
      }
      return false;
    }

    function keycapStyle() { return mood() === 'angry' ? 'angry' : null; }
    function afterKeyDown(code, now) { if (mood() === 'angry') F.kbShakeStart = now; }

    // ---------- 几何 ----------
    function kbToScene(p) { // 键盘本地点 -> 画面点（键盘歪斜时）
      const a = F.kbRot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const vx = p.x - 400, vy = p.y - 477;
      return { x: 400 + vx * c - vy * s, y: 477 + vx * s + vy * c + F.kbTy };
    }
    function slamPoint() { const H = ctx.mouseHome(); return { x: H.x + (mouseDir() < 0 ? 12 : -12), y: 566 }; }
    function overheadPoint() { return { x: 400 + mouseDir() * 128, y: 44 }; }

    // 发飙时鼠标的位置（被抓起、举高、砸下、压扁）
    function rageMousePose(tm) {
      const H = ctx.mouseHome(), O = overheadPoint(), T = slamPoint(), dir = mouseDir();
      if (tm < M_REACH) return { x: H.x, y: H.y };
      if (tm < M_LIFT) {
        const p = easeOut((tm - M_REACH) / (M_LIFT - M_REACH));
        return { x: lerp(H.x, O.x, p), y: lerp(H.y, O.y, p) - 30 * Math.sin(Math.PI * p), rot: dir * -28 * p };
      }
      if (tm < M_HIT) {
        const p = easeIn((tm - M_LIFT) / (M_HIT - M_LIFT));
        return { x: lerp(O.x, T.x, p), y: lerp(O.y, T.y, p), rot: dir * lerp(-28, 12, p), sx: 1 - 0.08 * p, sy: 1 + 0.12 * p };
      }
      const q = clamp((tm - M_HIT) / (M_SPLIT - M_HIT), 0, 1); // 压扁再回弹
      return { x: T.x, y: T.y + 10 * (1 - q), rot: dir * 12, sx: 1.42 - 0.3 * q, sy: 0.55 + 0.3 * q };
    }

    // ---------- 爪子 ----------
    function forcedPawTarget(paw, now) {
      if (F.strike) { const r = ctx.restPoint(paw.side); return { id: 'crossed', x: r.x, y: r.y - 40, tau: 200 }; }
      if (F.repair && !ctx.reducedMotion()) return repairPaw(paw, now - F.repair.start);
      if (!F.rage || ctx.reducedMotion()) return null;
      const t = now - F.rage.start;
      const sx = paw.side === 'L' ? 1 : -1; // 猫的左爪在观众右侧
      if (t < SMASH_T0) return { id: 'rage', x: 400 + sx * 100, y: 118, tau: 70 };
      if (t < MOUSE_T0) {
        const c = ((t - SMASH_T0) % SMASH_CYCLE) / SMASH_CYCLE, up = c < 0.6;
        return up ? { id: 'rage', x: 400 + sx * 100, y: 118, tau: 45 }
          : { id: 'rage', x: 400 + sx * 66, y: 440, tau: 12, pressing: true };
      }
      const tm = t - MOUSE_T0;
      if (tm < M_END) {
        if (paw === ctx.mousePaw()) {
          if (tm < M_SPLIT) { const m = rageMousePose(tm); return { id: 'rage', x: m.x, y: m.y - 16, tau: tm < M_REACH ? 40 : 7, pressing: tm >= M_HIT }; }
          const T = slamPoint();
          if (tm < M_PAT0) return { id: 'rage', x: T.x + 6, y: T.y - 70, tau: 40 };
          if (tm < M_PAT1) return { id: 'rage', x: T.x + 6, y: T.y - 12, tau: 10, pressing: true }; // 补一爪拍扁
          return { id: 'rage', x: T.x + 6, y: T.y - 40, tau: 60 };
        }
        return { id: 'rage', x: 400 + sx * 92, y: 300, tau: 80 }; // 另一只爪握拳在胸前
      }
      return null;
    }

    function repairPaw(paw, t) {
      if (t < CAP_T0) return { id: 'repair', ...ctx.restPoint(paw.side), tau: 60 };
      if (t < WIPE_T0) {
        // 找这只爪负责的、最近开始飞的那个键帽，爪子去它的键位按一下
        let best = null;
        for (const d of F.repair.caps) {
          const st = CAP_T0 + d.order * CAP_GAP;
          if (st > t || d.side !== paw.side) continue;
          if (!best || st > best.st) best = { d, st };
        }
        if (best) {
          const k = kbToScene(kb.center(best.d.code));
          const arrive = best.st + CAP_FLY;
          return { id: 'repair', x: k.x, y: k.y - 8, tau: 9, pressing: t >= arrive - 20 && t < arrive + 50 };
        }
        return { id: 'repair', ...ctx.restPoint(paw.side), tau: 40 };
      }
      if (t < WIPE_T1) {
        if (paw.side === 'L') { const c = clothPoint(t); return { id: 'repair', x: c.x, y: c.y - 4, tau: 10, pressing: true }; }
        return { id: 'repair', ...ctx.restPoint(paw.side), tau: 60 };
      }
      if (paw === ctx.mousePaw() && t < SPARKLE_T0) {
        const H = ctx.mouseHome();
        if (t < FIX_PAT0) return { id: 'repair', x: H.x, y: H.y - 60, tau: 40 };
        const p = (t - FIX_PAT0) / (FIX_PAT1 - FIX_PAT0);
        return p < 0.4 ? { id: 'repair', x: H.x, y: H.y - 56, tau: 20 } : { id: 'repair', x: H.x, y: H.y - 14, tau: 9, pressing: true };
      }
      return { id: 'repair', ...ctx.restPoint(paw.side), tau: 50 };
    }
    function clothPoint(t) { // 抹布：上半横擦一趟、下半擦回来
      if (t < WIPE_MID) { const p = (t - WIPE_T0) / (WIPE_MID - WIPE_T0); return kbToScene({ x: lerp(200, 604, p), y: 430 + 6 * Math.sin(p * Math.PI * 6) }); }
      const p = (t - WIPE_MID) / (WIPE_T1 - WIPE_MID);
      return kbToScene({ x: lerp(604, 200, p), y: 524 + 6 * Math.sin(p * Math.PI * 6) });
    }

    // ---------- 特效对象 ----------
    function addSvg(parent, html) {
      parent.insertAdjacentHTML('beforeend', html);
      return parent.lastElementChild;
    }
    function placeDebris(d) { d.g.setAttribute('transform', `translate(${f1(d.x)} ${f1(d.y)}) rotate(${d.r.toFixed(1)})`); }
    function makeCap(code, x, y) {
      const g = addSvg(E.debris, '<g class="debris-cap"><rect x="-13" y="-12" width="26" height="24" rx="5"/><text x="0" y="4"></text></g>');
      g.querySelector('text').textContent = ctx.keycapText(code, null);
      const k = kb.center(code);
      const d = { kind: 'cap', code, side: k && k.x > 400 ? 'L' : 'R', g, x, y, vx: 0, vy: 0, r: 0, vr: 0, floor: rand(588, 610), rest: false };
      F.debris.push(d);
      return d;
    }
    function makeHalf(side, x, y) { // 半个鼠标壳，断口是锯齿
      const path = side < 0
        ? 'M 2 -42 A 28 28 0 0 0 -26 -14 L -26 14 A 28 28 0 0 0 2 42 L 6 30 L -2 18 L 5 4 L -3 -10 L 5 -24 Z'
        : 'M 2 -42 A 28 28 0 0 1 28 -14 L 28 14 A 28 28 0 0 1 2 42 L 6 30 L -2 18 L 5 4 L -3 -10 L 5 -24 Z';
      const g = addSvg(E.debris, `<g class="debris-half"><path d="${path}"/><path class="half-btn" d="${side < 0 ? 'M -26 14 L 2 14' : 'M 28 14 L 2 14'}"/></g>`);
      const d = { kind: 'half', side, g, x, y, vx: 0, vy: 0, r: 0, vr: 0, floor: y, rest: false };
      F.debris.push(d);
      return d;
    }
    function makeWheel(x, y) {
      const g = addSvg(E.debris, '<g class="debris-wheel"><rect x="-4" y="-7.5" width="8" height="15" rx="4"/><path d="M -4 0 L 4 0"/></g>');
      const d = { kind: 'wheel', g, x, y, vx: 0, vy: 0, r: 0, vr: 0, floor: y, rest: false, roll: true };
      F.debris.push(d);
      return d;
    }
    function makePart(x, y, i) {
      const g = addSvg(E.debris, i ? '<g class="debris-part"><path d="M -6 0 Q -4 -5 -2 0 Q 0 5 2 0 Q 4 -5 6 0"/></g>' : '<g class="debris-part"><circle r="3.4"/><path d="M -2 0 L 2 0"/></g>');
      const d = { kind: 'part', g, x, y, vx: 0, vy: 0, r: 0, vr: 0, floor: y, rest: false };
      F.debris.push(d);
      return d;
    }
    function launch(d, vx, vy, vr, floor) { Object.assign(d, { vx, vy, vr, floor, rest: false }); }

    function spawnCaps(i, now) {
      const pool = kb.codes().filter((c) => !kb.isGone(c));
      const n = i === IMPACTS.length - 1 ? 6 + Math.floor(Math.random() * 3) : 6;
      for (let k = 0; k < n && pool.length; k++) {
        const code = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        const c = kbToScene(kb.center(code));
        kb.setGone(code, true);
        const d = makeCap(code, c.x, c.y);
        launch(d, rand(-0.35, 0.35) + (c.x - 400) * 0.0009, rand(-1.0, -0.55), rand(-0.7, 0.7), rand(588, 610));
        d.r = rand(-30, 30);
      }
    }
    function shatterMouse(now) {
      F.shattered = true;
      const T = slamPoint(), dir = mouseDir();
      for (const side of [-1, 1]) {
        const d = makeHalf(side, T.x + side * 8, T.y);
        launch(d, side * rand(0.1, 0.16), rand(-0.75, -0.55), side * rand(0.5, 0.8), T.y + rand(6, 14));
      }
      const w = makeWheel(T.x, T.y - 10);
      launch(w, -dir * 0.2, -0.95, 1.2, T.y + 16);          // 滚轮弹出来滚到一边
      for (let i = 0; i < 2; i++) {
        const p = makePart(T.x, T.y - 6, i);
        launch(p, rand(-0.3, 0.3), rand(-1.1, -0.8), rand(-1, 1), T.y + rand(8, 20));
      }
    }
    function shake(now, ms, amp) { F.shakeUntil = now + ms; F.shakeAmp = amp; }
    function impactLines(x, y, now) {
      const g = addSvg(E.bubbles, '<g class="impact"><path d="M -18 -6 L -34 -14 M -12 -16 L -20 -32 M 0 -18 L 0 -36 M 12 -16 L 20 -32 M 18 -6 L 34 -14 M -20 4 L -38 6 M 20 4 L 38 6"/></g>');
      F.effects.push({ g, start: now, life: 240, x, y, kind: 'impact' });
    }
    function sparkle(x, y, now, delay) {
      const g = addSvg(E.bubbles, '<g class="sparkle"><path d="M 0 -11 Q 2 -2 11 0 Q 2 2 0 11 Q -2 2 -11 0 Q -2 -2 0 -11 Z"/></g>');
      g.setAttribute('opacity', '0');
      F.effects.push({ g, start: now + delay, life: 420, x, y, kind: 'sparkle' });
    }
    function spawnHmph(now) {
      const g = addSvg(E.bubbles, '<g class="hmph"><path class="hmph-bubble" d="M -26 -14 Q -26 -30 0 -30 Q 26 -30 26 -14 Q 26 2 4 2 L -6 12 L -4 2 Q -26 2 -26 -14 Z"/><text x="0" y="-8">哼</text></g>');
      F.bubbles.push({ g, start: now, x: 286 + rand(-10, 10), y: 104 });
    }

    // ---------- 姿态 ----------
    function sighPhase(now) {
      const ts = now - F.sighStart;
      return ts >= 0 && ts < 900 ? ts / 900 : -1;
    }
    function pose(now, dt, rm, P) {
      const m = mood();
      if (!F.rage && !F.strike && !F.repair) {
        if (m === 'tired') { P.lidMin = Math.max(P.lidMin, 0.45); P.pawTau *= 1.9; P.pressBoost += 0.08; }
        else if (m === 'angry') { P.lidMin = Math.max(P.lidMin, 0.32); P.pawTau *= 1.3; P.tailAmp = 22; P.tailSpeed = 0.024; }
        // 叹气：头和肩膀沉一下，眼睛闭一下
        if (m === 'tired' && !rm && now >= F.nextSigh) {
          F.sighStart = now;
          F.nextSigh = now + (demo && demo.name === 'sigh' ? 1600 : rand(3500, 6500));
        }
        const p = m === 'tired' ? sighPhase(now) : -1;
        if (p >= 0) {
          const s = Math.sin(Math.PI * p);
          P.headY += 6 * s; P.bodyY += 3 * s;
          if (p > 0.12 && p < 0.7) P.eyesClosed = true;
        }
      }
      if (m === 'angry' && !F.strike) P.cheek = 20 + (rm ? 0 : 2.5 * Math.sin(now / 260));

      if (F.rage) {
        const t = now - F.rage.start;
        P.lidMin = Math.max(P.lidMin, 0.3);
        P.tailAmp = 26; P.tailSpeed = 0.03;
        if (!rm) {
          P.lift = t < STAND_MS ? -30 * easeOut(t / STAND_MS) : t < SIT_T0 ? -30 : -30 * (1 - (t - SIT_T0) / (RAGE_MS - SIT_T0));
          const tm = t - MOUSE_T0;
          if (tm >= M_REACH && tm < M_HIT) { // 举起鼠标时身体后仰
            const p = tm < M_LIFT ? easeOut((tm - M_REACH) / (M_LIFT - M_REACH)) : 1 - easeIn((tm - M_LIFT) / (M_HIT - M_LIFT));
            P.headY -= 10 * p; P.headRot += mouseDir() * -5 * p; P.bodyRot += mouseDir() * -3 * p; P.lift -= 6 * p;
          }
          if (tm >= 0 && tm < M_SPLIT) P.mouseAbs = rageMousePose(tm);
        }
      }
      if (F.shattered) P.mouseHidden = true;

      // 转身：正面 <-> 背影，横向挤压到很窄再展开
      if (F.strike) {
        const ts = now - F.strike.start;
        if (!rm && ts < TURN_MS / 2) P.turnSX = 1 - ts / (TURN_MS / 2);
        else P.hideCat = true;
      }
      if (F.repair) {
        const tr = now - F.repair.start;
        if (!rm && tr < TURN_MS / 2) P.hideCat = true;
        else if (!rm && tr < TURN_MS) P.turnSX = (tr - TURN_MS / 2) / (TURN_MS / 2);
        // 修鼠标：壳合上之后鼠标回来，啪一下
        if (tr >= FIX_SNAP) {
          P.mouseHidden = false;
          const q = clamp((tr - FIX_SNAP) / 90, 0, 1);
          const H = ctx.mouseHome();
          P.mouseAbs = { x: H.x, y: H.y, sx: 1 + 0.18 * (1 - q), sy: 1 - 0.18 * (1 - q) };
          if (tr >= FIX_PAT1 - 40 && tr < FIX_PAT1 + 40) P.mouseAbs.sy = 0.9;
        } else P.mouseHidden = true;
      }
    }

    // ---------- 渲染 ----------
    function show(node, key, on) {
      if (F.shown[key] === on) return;
      F.shown[key] = on;
      node.style.display = on ? '' : 'none';
    }

    function stepDebris(d, dt) {
      if (d.fly) return;
      if (!d.rest) {
        d.vy += 0.0024 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.r += d.vr * dt;
        if (d.x < 20 || d.x > 780) { d.vx = -d.vx * 0.6; d.x = clamp(d.x, 20, 780); }
        if (d.y >= d.floor) {
          d.y = d.floor;
          if (d.vy < 0.12) { d.rest = true; d.vy = 0; if (!d.roll) d.vr = 0; }
          else { d.vy = -d.vy * 0.38; d.vx *= 0.7; d.vr *= 0.5; }
        }
      } else if (d.roll && Math.abs(d.vx) > 0.01) { // 滚轮在桌上滚一段
        d.x += d.vx * dt; d.r += d.vx * dt * 7;
        d.vx *= Math.max(0, 1 - 0.005 * dt);
        if (d.x < 20 || d.x > 780) d.vx = -d.vx;
      }
    }

    function renderRepair(now, dt, tr) {
      const H = ctx.mouseHome(), dir = mouseDir();
      // 键帽依次飞回键位，到位时弹一下
      for (const d of F.repair.caps) {
        const st = CAP_T0 + d.order * CAP_GAP;
        if (tr < st) continue;
        if (!d.from) { d.from = { x: d.x, y: d.y, r: d.r }; d.fly = true; }
        const p = clamp((tr - st) / CAP_FLY, 0, 1);
        if (p >= 1) {
          if (!d.done) { d.done = true; kb.setGone(d.code, false); kb.pop(d.code); d.g.remove(); }
          continue;
        }
        const k = kbToScene(kb.center(d.code)), e = easeOut(p);
        d.x = lerp(d.from.x, k.x, e); d.y = lerp(d.from.y, k.y, e) - 60 * Math.sin(Math.PI * p);
        d.r = lerp(d.from.r, F.kbRot, e);
        placeDebris(d);
      }
      // 两只爪的残影
      if (!F.ghosts) {
        F.ghosts = ['L', 'R'].flatMap((s) => [0, 1].map((i) => {
          const g = addSvg(E.debris, `<ellipse class="ghost ${s === 'L' ? 'ghost-white' : 'ghost-black'}" rx="20" ry="14"/>`);
          return { s, i, g };
        }));
      }
      for (const s of ['L', 'R']) { F.hist[s].push({ x: paws[s].x, y: paws[s].y }); if (F.hist[s].length > 8) F.hist[s].shift(); }
      const ghostOn = tr >= CAP_T0 && tr < WIPE_T0 + 80;
      for (const gh of F.ghosts) {
        const h = F.hist[gh.s], q = h[Math.max(0, h.length - 1 - (gh.i ? 6 : 3))];
        const moving = h.length > 3 && Math.hypot(h[h.length - 1].x - q.x, h[h.length - 1].y - q.y) > 6;
        gh.g.style.display = ghostOn && moving ? '' : 'none';
        if (q) { gh.g.setAttribute('cx', f1(q.x)); gh.g.setAttribute('cy', f1(q.y)); }
        gh.g.setAttribute('opacity', gh.i ? '0.14' : '0.28');
      }
      // 擦裂缝：抹布擦过的地方裂纹消失；键盘随之摆正
      if (!F.cloth) F.cloth = addSvg(E.bubbles, '<g class="cloth" style="display:none"><path d="M -16 -9 Q -6 -14 6 -10 Q 16 -8 17 2 Q 12 12 0 10 Q -12 13 -17 4 Q -20 -4 -16 -9 Z"/><path class="cloth-fold" d="M -9 -4 Q 0 0 9 -3 M -6 4 Q 2 7 10 4"/></g>');
      if (tr >= WIPE_T0 && tr < WIPE_T1) {
        const c = clothPoint(tr);
        show(F.cloth, 'cloth', true);
        F.cloth.setAttribute('transform', `translate(${f1(c.x)} ${f1(c.y + 4)}) rotate(${(8 * Math.sin(tr / 30)).toFixed(1)})`);
        const lc = { x: lerp(200, 604, clamp((tr - WIPE_T0) / (WIPE_MID - WIPE_T0), 0, 1)) };
        E.wipedTop.setAttribute('width', f1(Math.max(0, lc.x + 14 - 140)));
        if (tr >= WIPE_MID) {
          const x2 = lerp(604, 200, clamp((tr - WIPE_MID) / (WIPE_T1 - WIPE_MID), 0, 1)) - 14;
          E.wipedBottom.setAttribute('x', f1(x2)); E.wipedBottom.setAttribute('width', f1(660 - x2));
        }
      } else show(F.cloth, 'cloth', false);
      if (tr >= WIPE_T1) { E.wipedTop.setAttribute('width', 520); E.wipedBottom.setAttribute('x', 140); E.wipedBottom.setAttribute('width', 520); }
      // 修鼠标：两半飞回来对上，滚轮塞回去
      if (tr >= FIX_T0) {
        for (const d of F.debris) {
          if (d.kind === 'cap') continue;
          if (!d.from) { d.from = { x: d.x, y: d.y, r: d.r }; d.fly = true; }
          let tx = H.x, ty = H.y, t0 = FIX_T0, t1 = FIX_SNAP;
          if (d.kind === 'half') tx = H.x + d.side * 2;
          if (d.kind === 'wheel' || d.kind === 'part') { t0 = FIX_SNAP - 40; t1 = FIX_SNAP + 90; }
          const p = clamp((tr - t0) / (t1 - t0), 0, 1);
          if (d.kind === 'half' && tr < FIX_SNAP - 60) tx += d.side * 18; // 先停在两边，再"啪"地合上
          if (p >= 1) { if (!d.done) { d.done = true; d.g.remove(); } continue; }
          const e = easeOut(p);
          d.x = lerp(d.from.x, tx, e); d.y = lerp(d.from.y, ty, e) - 40 * Math.sin(Math.PI * p);
          d.r = lerp(d.from.r, 180 * (d.kind === 'half' ? 0 : 1), e);
          placeDebris(d);
        }
      }
      if (tr >= SPARKLE_T0 && !F.repair.sparkled) {
        F.repair.sparkled = true;
        sparkle(262, 404, now, 0); sparkle(548, 446, now, 60); sparkle(404, 536, now, 120); sparkle(610, 392, now, 170);
      }
      void dir; void dt;
    }

    function render(now, dt, rm) {
      const m = mood();
      const raging = !!F.rage;
      show(E.brows, 'brows', m !== 'fine');
      show(E.sweat, 'sweat', m === 'tired' && !raging);
      show(E.anger, 'anger', m === 'angry');
      if (m === 'angry') {
        const s = rm ? 1 : 1 + 0.12 * Math.sin(now / 90);
        E.anger.setAttribute('transform', `translate(478 96) scale(${s.toFixed(3)})`);
      }

      // 叹气：气团从嘴角出来，往斜下方飘出、散开、变淡（都在头部组内）
      const sp = m === 'tired' ? sighPhase(now) : -1;
      if (sp >= 0) {
        show(E.sigh, 'sigh', true);
        const A = { x: 410, y: 236 }, base = [[0, 0, 6], [7, -3, 4.5], [3, 6, 4]];
        base.forEach(([ox, oy, r], i) => {
          const c = E.sighC[i], k = 1 + 1.6 * sp;
          c.setAttribute('cx', f1(A.x + 26 * sp + ox * k));
          c.setAttribute('cy', f1(A.y + 20 * sp + oy * k));
          c.setAttribute('r', f1(r * (0.45 + 0.9 * sp)));
        });
        E.sigh.setAttribute('opacity', (sp < 0.12 ? sp / 0.12 : 1 - (sp - 0.12) / 0.88).toFixed(3));
      } else show(E.sigh, 'sigh', false);

      // 发飙：三次砸键盘 + 砸鼠标
      if (raging && !rm) {
        const t = now - F.rage.start;
        while (F.impactsDone < IMPACTS.length && t >= IMPACTS[F.impactsDone]) {
          F.broken = true;
          spawnCaps(F.impactsDone, now);
          shake(now, 180, 7);
          F.impactsDone++;
        }
        const tm = t - MOUSE_T0;
        if (tm >= M_HIT && !F.mouseHitDone) {
          F.mouseHitDone = true;
          const T = slamPoint();
          shake(now, 170, 9); impactLines(T.x, T.y + 18, now);
        }
        if (tm >= M_SPLIT && !F.splitDone) { F.splitDone = true; shatterMouse(now); }
        if (tm >= M_PAT1 - 20 && !F.patDone) { F.patDone = true; shake(now, 90, 4); }
      }
      if (F.strike && F.impactsDone < IMPACTS.length) { // 后台被节流时补上没来得及砸的
        while (F.impactsDone < IMPACTS.length) { if (!rm) spawnCaps(F.impactsDone, now); F.impactsDone++; }
        if (!F.splitDone) { F.splitDone = true; if (!rm) shatterMouse(now); else F.shattered = true; }
      }

      // 罢工的猫：背影 + 转身展开 + 偷偷回头
      const strikeOn = !!F.strike && (rm || now - F.strike.start >= TURN_MS / 2);
      const repairBack = !!F.repair && !rm && now - F.repair.start < TURN_MS / 2;
      show(E.strike, 'strike', strikeOn || repairBack);
      if (strikeOn || repairBack) {
        let sx = 1;
        if (F.strike && !rm) sx = clamp((now - F.strike.start - TURN_MS / 2) / (TURN_MS / 2), 0.02, 1);
        if (repairBack) sx = clamp(1 - (now - F.repair.start) / (TURN_MS / 2), 0.02, 1);
        E.strike.setAttribute('transform', `translate(400 0) scale(${sx.toFixed(3)} 1) translate(-400 0)`);
      }
      if (F.strike) {
        const t = now - F.strike.start;
        let a = 0;
        if (!rm) { const p = (t % 1100) / 1100; a = p < 0.75 ? -16 * easeOut(p / 0.75) : -16 * (1 - (p - 0.75) / 0.25); }
        E.strikeTail.setAttribute('transform', `rotate(${a.toFixed(2)} 400 402)`);
        const te = now - F.earFlick;
        for (const s of ['l', 'r']) {
          let ea = 0;
          if (s === F.earSide && te >= 0 && te < 240) ea = 16 * Math.sin(2 * Math.PI * te / 120) * (1 - te / 240);
          E.strikeEar[s].setAttribute('transform', `rotate(${(s === 'l' ? -ea : ea).toFixed(2)} ${s === 'l' ? '322 110' : '478 110'})`);
        }
        // 每隔几秒偷偷回头瞥一眼，被看见就"哼"地转回去
        if (!rm && now >= F.strike.nextPeek && now - F.strike.peek > 1200) { F.strike.peek = now; F.strike.nextPeek = now + rand(3000, 6000); }
        const tp = now - F.strike.peek;
        let turn = 0;
        if (tp >= 0 && tp < 1000) {
          turn = tp < 150 ? tp / 150 : tp < 850 ? 1 : 1 - (tp - 850) / 100;
          if (tp >= 850 && !F.strike.hmphed) { F.strike.hmphed = true; spawnHmph(now); }
        } else F.strike.hmphed = false;
        show(E.peekEye, 'peek', turn > 0.6);
        E.strikeHead.setAttribute('transform', `translate(${f1(-8 * turn)} 0) rotate(${(5 - 9 * turn).toFixed(2)} 400 262)`);
      }

      if (F.repair) renderRepair(now, dt, now - F.repair.start);
      else if (F.ghosts) for (const gh of F.ghosts) gh.g.style.display = 'none';

      // 键盘：砸烂歪斜 / 生气时按键震动 / 修理时摆正
      let kr = 0, ky = 0, kx = 0;
      if (F.broken) {
        kr = -5; ky = 6;
        if (F.repair) {
          const p = clamp((now - F.repair.start - WIPE_T0) / (WIPE_T1 - WIPE_T0), 0, 1);
          kr = -5 * (1 - p); ky = 6 * (1 - p);
        }
      }
      F.kbRot = kr; F.kbTy = ky;
      if (!rm && now - F.kbShakeStart < 140) { kx += rand(-1.5, 1.5); ky += rand(-1.5, 1.5); }
      E.keyboard.setAttribute('transform', `translate(${f1(kx)} ${f1(ky)}) rotate(${kr.toFixed(2)} 400 477)`);
      show(E.crack, 'crack', F.broken);
      const bLeft = F.mouseBandageUntil - now;
      show(E.mouseBandage, 'mbandage', bLeft > 0 && !F.shattered);
      if (bLeft > 0) E.mouseBandage.setAttribute('opacity', clamp(bLeft / 1000, 0, 1).toFixed(3));

      // 画面短促震动
      if (!rm && now < F.shakeUntil) {
        E.scene.style.transform = `translate(${f1(rand(-1, 1) * F.shakeAmp * 0.5)}px, ${f1(rand(-1, 1) * F.shakeAmp * 0.5)}px)`;
      } else if (E.scene.style.transform) E.scene.style.transform = '';

      // 散落物：重力、旋转、弹跳，停在桌面上
      for (const d of F.debris) { if (d.done) continue; stepDebris(d, dt); if (!d.fly) placeDebris(d); }
      if (!F.repair) F.debris = F.debris.filter((d) => !d.done);

      // 冲击线、星光
      for (let i = F.effects.length - 1; i >= 0; i--) {
        const fx = F.effects[i], p = (now - fx.start) / fx.life;
        if (p < 0) continue;
        if (p >= 1) { fx.g.remove(); F.effects.splice(i, 1); continue; }
        const s = fx.kind === 'impact' ? 0.7 + 0.8 * p : Math.sin(Math.PI * p) * 1.9;
        fx.g.setAttribute('transform', `translate(${f1(fx.x)} ${f1(fx.y)}) scale(${s.toFixed(3)})${fx.kind === 'sparkle' ? ` rotate(${(p * 90).toFixed(1)})` : ''}`);
        fx.g.setAttribute('opacity', (fx.kind === 'impact' ? 1 - p : 1).toFixed(3));
      }

      // "哼"气泡
      for (let i = F.bubbles.length - 1; i >= 0; i--) {
        const b = F.bubbles[i], p = (now - b.start) / 1100;
        if (p >= 1 || !F.strike) { b.g.remove(); F.bubbles.splice(i, 1); continue; }
        const dy = rm ? 0 : -24 * easeOut(p);
        b.g.setAttribute('transform', `translate(${f1(b.x)} ${f1(b.y + dy)})`);
        b.g.setAttribute('opacity', (p < 0.15 ? p / 0.15 : p > 0.7 ? (1 - p) / 0.3 : 1).toFixed(3));
      }

      // 页面上的疲劳条和消气倒计时
      if (E.bar) {
        E.bar.style.width = (F.v * 100).toFixed(1) + '%';
        E.bar.dataset.mood = m;
      }
      if (E.hint) {
        if (F.strike) {
          const left = Math.max(0, Math.ceil(restSec - F.strike.restMs / 1000));
          E.hint.textContent = `让它歇 ${left} 秒就消气`;
          E.hint.style.display = '';
        } else if (E.hint.style.display !== 'none') E.hint.style.display = 'none';
      }
    }

    return {
      refresh, overrideState, block, keycapStyle, afterKeyDown, forcedPawTarget, pose, render,
      setWorkSeconds(v) { workSec = clamp(+v || 90, 1, 36000); },
      setRestSeconds(v) { restSec = clamp(+v || 20, 1, 36000); },
      debugProps: {
        mood: () => mood(),
        fatigue: () => F.v,
        strikeRestLeft: () => (F.strike ? Math.max(0, restSec - F.strike.restMs / 1000) : null),
        workSeconds: () => workSec,
        restSeconds: () => restSec,
      },
    };
  }

  window.SillyFatigue = { create };
})();
