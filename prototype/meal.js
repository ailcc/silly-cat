// 饭点要吃的：午饭点和晚饭点，桌上会出现一盆猫粮；你闲着时猫会伸爪敲碗催你喂饭。
// 猫粮盆常驻饭点时段（11-13 点、17-19 点），每个时段催一次；敲碗只是画面，不打扰你。
(function () {
  'use strict';

  // 时间轴（毫秒，从开始催饭算起）
  const LOOK = 700, REACH = 1100, TAP = 2300, END = 3000;
  const TAP_MS = (TAP - REACH) / 3, TAPS = 3;
  const MEALS = [            // 饭点时段（24 小时制的小时数，含头不含尾）
    { key: 'lunch', from: 11, to: 13, label: '午饭' },
    { key: 'dinner', from: 17, to: 19, label: '晚饭' },
  ];
  const RECHECK = [90, 150]; // 催完后在这个区间（秒）后再看一眼还到不到饭点
  const BOWL = { x: 700, y: 470 }; // 猫粮盆：桌子右下角，杯子右下方，猫伸同侧的爪就够得着
  const DEMOS = ['meal'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (p) => { const u = clamp(p, 0, 1); return u * u * (3 - 2 * u); };

  function create(ctx, opts = {}) {
    const { S, STATES, kb, fx, paws, restPoint, mousePaw } = ctx;
    const demo = opts.demo && DEMOS.includes(opts.demo.name) ? opts.demo : null;
    const frozen = demo && Number.isFinite(demo.at);

    const F = {
      runAt: -1e9, nextCheck: performance.now() + (demo ? 800 : rand(8, 20) * 1000),
      doneKey: null, bowlOp: 0, lastBeat: -1, demoInit: false,
    };
    const $ = (id) => document.getElementById(id);
    // 画在键盘后面的那层：盆被键盘挡住下半截，只露出碗口，和杯子一个画法
    $('keyboard').insertAdjacentHTML('beforebegin', `
      <g id="meal-bowl" class="mug" style="display:none">
        <ellipse class="shadow" cy="2" rx="24" ry="5"/>
        <g id="meal-bowl-body">
          <path class="mug-body" d="M -24 -20 Q -23 0 0 2 Q 23 0 24 -20 Z"/>
          <ellipse class="mug-rim" cy="-20" rx="24" ry="8"/>
          <path class="mug-coffee" d="M -17 -20 Q -8 -27 0 -22 Q 10 -27 17 -20 Q 8 -15 0 -17 Q -10 -15 -17 -20 Z"/>
        </g>
      </g>`);
    const E = { bowl: $('meal-bowl') };

    const mealNow = () => {
      const d = new Date();
      const h = d.getHours() + d.getMinutes() / 60;
      return { meal: MEALS.find((m) => h >= m.from && h < m.to) || null, key: d.toDateString() };
    };
    // 盆那侧的爪被鼠标占着时（默认鼠标就在左下角），就伸另一只爪过去敲
    const bowlPaw = () => {
      const side = BOWL.x < 400 ? paws.R : paws.L;
      return mousePaw() === side ? (side === paws.R ? paws.L : paws.R) : side;
    };

    function startRun(now, meal) {
      F.runAt = now;
      F.doneKey = `${meal.key}@${mealNow().key}`;
      F.lastBeat = -1;
      fx.spawn(`${meal.label}点到啦！`, clamp(BOWL.x - 70, 90, 710), BOWL.y - 80, 'hot', now);
      if (window.SillySounds) window.SillySounds.play('meow');
    }
    function endRun(now) {
      F.runAt = -1e9;
      F.nextCheck = now + rand(RECHECK[0], RECHECK[1]) * 1000 * (demo ? 0.02 : 1);
    }

    function afterState(now) {
      if (frozen) return; // 冻结帧由 pose 钉住
      if (F.runAt > 0) {
        if (now - F.runAt >= END) endRun(now);
        return;
      }
      const { meal } = mealNow();
      if (!meal) return;
      const key = `${meal.key}@${mealNow().key}`;
      if (F.doneKey === key || now < F.nextCheck) return;
      if (S.state === STATES.AWAKE && !S.pet && !S.pressed.size && !S.mouseButtons.size &&
          (demo || (now - S.lastKeyAt >= 6000 && now - S.lastInput >= 8000))) {
        startRun(now, meal);
      }
    }

    function afterKeyDown(code, now) {
      if (F.runAt > 0) endRun(now); // 开始打字就回去干活
    }

    function overrideState() {
      return F.runAt > 0 ? STATES.AWAKE : null;
    }

    // ---------- 爪子：伸到碗沿上叩三下 ----------
    function bowlPoint(press) {
      return { x: BOWL.x - 16, y: BOWL.y - 26 - 2 * press };
    }
    function forcedPawTarget(paw, now) {
      if (F.runAt <= 0 || paw !== bowlPaw()) return null;
      const t = now - F.runAt;
      if (t < REACH || t >= TAP) return null; // 伸出来叩三下，叩完自己收回去
      const beat = ((t - REACH) / TAP_MS) % 1;
      const press = beat >= 0.43 && beat < 0.7 ? 1 : 0;
      return { id: 'meal', ...bowlPoint(press), tau: 11, pressing: !!press };
    }

    // ---------- 姿态与盆的显隐 ----------
    function render(now, dt, rm) {
      if (frozen) { // 冻结帧：盆常驻，别被饭点判断藏掉
        E.bowl.style.display = '';
        E.bowl.style.opacity = 1;
        E.bowl.setAttribute('transform', `translate(${BOWL.x} ${BOWL.y}) scale(1.6)`);
        return;
      }
      // 盆：饭点时段淡入，过了饭点淡出
      const want = !!demo || !!mealNow().meal;
      F.bowlOp = approach(F.bowlOp, want ? 1 : 0, dt, 260);
      E.bowl.style.display = F.bowlOp > 0.01 ? '' : 'none';
      E.bowl.style.opacity = F.bowlOp.toFixed(3);
      const t = now - F.runAt;
      const press = F.runAt > 0 && t >= REACH && t < TAP && (((t - REACH) / TAP_MS) % 1) >= 0.43 && (((t - REACH) / TAP_MS) % 1) < 0.7 ? 1 : 0;
      E.bowl.setAttribute('transform', `translate(${BOWL.x} ${BOWL.y - press * 1.5}) scale(1.6)`);
      // 每一叩冒一个小「叩」
      if (F.runAt > 0 && t >= REACH && t < TAP) {
        const beat = Math.floor((t - REACH) / TAP_MS);
        if (beat !== F.lastBeat) { F.lastBeat = beat; fx.spawn('叩', BOWL.x + rand(-30, -2), BOWL.y - 52, '', now); if (window.SillySounds) window.SillySounds.play('tap'); }
      }
    }

    function pose(now, dt, rm, P) {
      if (frozen) { // 冻结帧：把敲碗钉在时间轴上，方便调试截图
        if (!F.demoInit) F.demoInit = true;
        F.runAt = now - demo.at;
        E.bowl.style.display = '';
        E.bowl.style.opacity = 1;
        F.bowlOp = 1;
        E.bowl.setAttribute('transform', `translate(${BOWL.x} ${BOWL.y}) scale(1.6)`);
      }
      if (F.runAt <= 0) return;
      const t = now - F.runAt;
      const bowl = { x: BOWL.x, y: BOWL.y - 34 };
      const front = { x: 400, y: 178 };
      if (t < LOOK) P.look = front;
      else if (t < REACH) P.look = { x: lerp(front.x, bowl.x, ease((t - LOOK) / (REACH - LOOK))), y: lerp(front.y, bowl.y, ease((t - LOOK) / (REACH - LOOK))) };
      else if (t < TAP) P.look = bowl;
      else {
        P.eyesHappy = true; // 催完饭美滋滋
        P.tailAmp = Math.max(P.tailAmp || 0, 9 + 5 * Math.sin(Math.PI * clamp((t - TAP) / (END - TAP), 0, 1)));
      }
      S.lastInput = now; // 催饭期间别睡着
    }

    function approach(cur, target, dt, tau) { return cur + (target - cur) * (1 - Math.exp(-dt / tau)); }

    return {
      afterState, afterKeyDown, overrideState, forcedPawTarget, render, pose,
      debugProps: { meal: () => (F.runAt > 0 ? Math.floor(performance.now() - F.runAt) : mealNow().meal ? mealNow().meal.key : null) },
    };
  }

  window.SillyMeal = { create };
})();
