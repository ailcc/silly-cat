// 拍指针：醒着时，鼠标凑得太近又晃来晃去，猫会伸爪拍一下——拍中了原地炸开小星星，
// 拍空了就盯着指针看一会儿（指针够距之外拍过去必定拍空）。连拍换手，拍完有冷却。
// 发飙 / 推杯子 / 摸头 / 打字时不拍；函数式动画只使用画面坐标，真实指针位置由输入源提供。
// 调试：?demo=swat&loop=1（先拍中、再拍一次指针躲开）或 &at=毫秒 冻结
(function () {
  'use strict';

  const MOVE_MS = 250, MOVE_DISTANCE = 12, HIT_DISTANCE = 28;
  const WINDUP = 120, CONTACT = 220, HOLD = 300, END = 600, WATCH = 400;
  const COMBO_WINDOW = 2000, COOLDOWN = 1500, COMBO_COOLDOWN = 3000;
  const IMPACT_MS = 250;
  const DEMO_FIRST = 400, DEMO_SECOND = 2600, DEMO_END = 4000;
  const NS = 'http://www.w3.org/2000/svg';
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const blend = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const ease = (t) => t * t * (3 - 2 * t);

  function withinReach(shoulder, target, max) {
    return blend(shoulder, target, max / Math.max(max, distance(shoulder, target)));
  }

  function create(ctx, opts = {}) {
    const { S, STATES, kb, paws, choosePaw, keyPoint, restPoint, reducedMotion, clamp, f1, shoulders } = ctx;
    // 触发距离比爪子够距更远，远处的指针会让猫拍空。
    const reach = {}, pawReach = {};
    let bottom, keyboardStyle;
    function keyboardChanged() {
      keyboardStyle = kb.codes().length;
      const keys = keyboardStyle && kb.codes();
      for (const side of ['L', 'R']) {
        const points = keys.filter(code => code === 'Space' || choosePaw(code).side === side);
        const farthest = Math.max(...points.map(code => distance(shoulders[side], keyPoint(code, side))));
        reach[side] = 1.15 * farthest;
        pawReach[side] = 0.8 * farthest;
      }
      bottom = kb.bounds.y + kb.bounds.h + 8; // 键盘外壳含下沿
      history = [];
      combo = null;
    }
    const demo = opts.demo?.name === 'swat' ? opts.demo : null;
    const demoStart = performance.now();
    const pinned = demo && Number.isFinite(demo.at);
    let enabled = opts.enabled !== false;
    let run = null, impact = null, watchUntil = -Infinity, next = -Infinity, combo = null;
    let point = null, history = [], fakePointer = null;
    keyboardChanged();
    const layer = document.getElementById('fx-layer');
    function effect(id, markup) {
      const node = document.createElementNS(NS, 'g');
      node.setAttribute('id', id);
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('pointer-events', 'none');
      node.style.display = 'none';
      node.innerHTML = markup;
      layer.appendChild(node);
      return node;
    }
    const spark = effect('swat-impact', `
      <path d="M-21 2l-12 2m17-16-8-9m21 5 1-12m16 14 8-8m-4 21 12 3m-23 12 4 10"
        fill="none" stroke="#eb754f" stroke-width="3" stroke-linecap="round"/>
      <path d="M 0 -13 Q 2 -2 12 0 Q 2 2 0 12 Q -2 2 -12 0 Q -2 -2 0 -13 Z"
        fill="#ffca62" stroke="#b64b37" stroke-width="2"/>`);
    const cursor = effect('swat-demo-pointer',
      '<path d="M 0 0 L 5 22 L 10 15 L 16 15 Z" fill="#fff6e4" stroke="#352c29" stroke-width="2" stroke-linejoin="round"/>');

    function makeRun(side, start, origin, isCombo, anger) {
      const sh = shoulders[side];
      const back = { x: origin.x + (side === 'L' ? -1 : 1) * (7 + 3 * anger), y: origin.y - 20 - 9 * anger };
      return {
        side, start, origin: { x: origin.x, y: origin.y }, back: withinReach(sh, back, pawReach[side]), isCombo,
        cooldown: (isCombo ? COMBO_COOLDOWN : COOLDOWN) * (anger > 0 ? 0.5 : 1),
        goal: null, hit: null,
      };
    }

    function samplePointer(now) {
      point = S.pointer ? { x: S.pointer.x, y: S.pointer.y } : null;
      history = history.filter(entry => entry.at >= now - MOVE_MS);
      if (!point) return false;
      const moved = now - S.pointer.at <= MOVE_MS &&
        history.some(entry => distance(entry, point) >= MOVE_DISTANCE);
      // 静止期间保留最后一帧采样，鼠标再次移动时用它作起点。
      history.push({ x: point.x, y: point.y, at: now });
      return moved;
    }

    function canSwat(now) {
      return (S.state === STATES.AWAKE) && !S.pet && !S.pressed.size && !S.mouseButtons.size &&
        now - S.lastKeyAt >= 1200 && now - S.shakeStart >= 420 &&
        !(opts.isPushing && opts.isPushing(now));
    }

    function cancel(now) {
      if (run) next = now + run.cooldown;
      run = impact = combo = null;
      fakePointer = null;
      watchUntil = -Infinity;
    }

    function demoFrame(now, t) {
      const second = t >= DEMO_SECOND - 300;
      const phase = t - (second ? DEMO_SECOND : DEMO_FIRST);
      const side = second ? 'L' : 'R';
      const sh = shoulders[side];
      const dir = second ? 1 : -1;
      // 第二次起拍时在够距内；挥爪后假指针往外躲。
      const retreat = second ? clamp((phase - 126) / 83, 0, 1) : 0;
      fakePointer = point = {
        x: sh.x + dir * (175 + 153 * retreat + 12 * Math.sin(Math.min(208, phase) / 37)),
        y: 345 + 190 * retreat,
      };
      const tracking = phase >= 0 && phase < END + (second ? WATCH : 0);
      if (tracking) {
        if (!run || run.side !== side || now - run.start > phase + 40) {
          run = makeRun(side, now - phase, restPoint(side), false, 0);
        }
        if (pinned && phase >= CONTACT) settleImpact(now - phase + CONTACT, withinReach(sh, point, pawReach[side]));
      } else {
        run = null;
      }
      watchUntil = second && phase >= END && phase < END + WATCH ? now + 1 : -Infinity;
    }

    function afterState(now) {
      if (!enabled || reducedMotion()) { cancel(now); history = []; return; }
      if (keyboardStyle !== kb.codes().length) keyboardChanged();
      if (demo) {
        const t = pinned ? demo.at : demo.loop ? (now - demoStart) % DEMO_END : now - demoStart;
        if (t < DEMO_END) { demoFrame(now, t); return; }
        if (fakePointer) cancel(now);
      }
      const previous = point;
      const moved = samplePointer(now);
      if (!canSwat(now)) {
        if (run || combo || now < watchUntil) cancel(now);
        history = [];
        return;
      }
      if (run && now - run.start >= END) {
        const ended = run.start + END;
        if (run.hit === false) watchUntil = ended + WATCH;
        next = ended + run.cooldown;
        combo = run.isCombo ? null : { until: ended + COMBO_WINDOW, side: run.side === 'L' ? 'R' : 'L' };
        run = null;
      }
      if (combo && now > combo.until) combo = null;
      if (run && !point) point = previous; // 已挥爪时允许鼠标停住
      if (run || now < next || !moved || point.y > bottom) return;
      const near = ['L', 'R'].filter(side => distance(shoulders[side], point) <= reach[side]);
      if (!near.length) return;
      const preferred = point.x >= 400 ? 'L' : 'R';
      const side = combo?.side ?? (near.includes(preferred) ? preferred : near[0]);
      run = makeRun(side, now, paws[side], !!combo, opts.anger?.() || 0);
    }

    function forcedPawTarget(paw, now) {
      if (!run || run.side !== paw.side) return null;
      const t = now - run.start;
      if (t >= END) return null;
      const sh = shoulders[paw.side], limit = pawReach[paw.side];
      const target = withinReach(sh, point || run.origin, limit);
      let goal;
      if (t < WINDUP) goal = blend(run.origin, run.back, ease(clamp(t / WINDUP, 0, 1)));
      else if (t < CONTACT) goal = blend(run.back, target, 1 - ((CONTACT - t) / (CONTACT - WINDUP)) ** 3);
      else if (t < HOLD) goal = run.goal || target;
      else goal = blend(run.goal || target, restPoint(paw.side), ease((t - HOLD) / (END - HOLD)));
      return { id: 'swat', ...withinReach(sh, goal, limit), tau: t >= WINDUP && t < HOLD ? 6 : 14 };
    }

    function pose(now, dt, rm, P) {
      const looking = !!run || now < watchUntil;
      if (looking && point) P.look = point;
    }

    function settleImpact(at, pawCenter) {
      if (!run || run.hit !== null || !point) return;
      run.goal = withinReach(shoulders[run.side], point, pawReach[run.side]);
      run.hit = distance(pawCenter, point) <= HIT_DISTANCE;
      if (run.hit) impact = { x: point.x, y: point.y, at };
    }

    function render(now) {
      if (run && now - run.start >= CONTACT && run.hit === null) {
        const paw = paws[run.side];
        settleImpact(now, { x: paw.x, y: paw.y - 4 * paw.lift });
      }
      const age = impact ? (pinned ? demo.at - DEMO_FIRST - CONTACT : now - impact.at) : Infinity;
      spark.style.display = age >= 0 && age < IMPACT_MS ? '' : 'none';
      if (spark.style.display === '') {
        spark.setAttribute('opacity', f1(1 - (age / IMPACT_MS) ** 2));
        spark.setAttribute('transform', `translate(${f1(impact.x)} ${f1(impact.y)}) scale(${f1(0.75 + age / IMPACT_MS * 0.45)})`);
      }
      cursor.style.display = fakePointer ? '' : 'none';
      if (fakePointer) cursor.setAttribute('transform', `translate(${f1(fakePointer.x)} ${f1(fakePointer.y)})`);
    }

    return {
      afterState, forcedPawTarget, pose, render,
      afterKeyDown(code, now) { if (run || combo || now < watchUntil) cancel(now); },
      keyboardChanged,
      setEnabled(v) { enabled = !!v; },
      debugProps: {
        swat: () => {
          const now = performance.now();
          return { side: run?.side ?? null, hit: run?.hit ?? null, watching: now < watchUntil };
        },
      },
    };
  }

  window.SillySwat = { create };
})();
