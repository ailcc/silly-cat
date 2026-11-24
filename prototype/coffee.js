// 偷喝咖啡：没人理了一会儿（犯困前后），猫把旁边的咖啡拉到嘴边偷偷喝一口，
// 喝完精神了（困意重置、疲劳轻一点）；期间你一动，它立刻把杯子放回去、缩爪装没事。
// 杯子本体归 push.js 管，这里只在偷喝期间接管它的位置（模块在 push 之后注册，渲染晚一拍生效）。
// 调试：?demo=coffee&loop=1&at=毫秒（正常喝），?demo=coffee-scare&loop=1（喝到一半被吓到）
(function () {
  'use strict';

  const REACH = 350, PULL = 900, DRINK = 1800, PLACE = 2700, END = 3400; // 时间轴（毫秒）
  const SCARE_MS = 1300;      // 被打断后多久缓过来
  const IDLE_MIN = 5000;      // 至少闲了这么久才偷喝
  const EVERY = [25000, 60000]; // 两次偷喝之间隔多久
  const HOME = { x: 655, y: 410 }; // 和 push.js 的 MUG 一致

  const ease = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
  const rand = (a, b) => a + Math.random() * (b - a);

  function create(ctx, opts = {}) {
    const { S, STATES, paws, clamp } = ctx;
    const $ = (id) => document.getElementById(id);
    const pushMod = opts.push;
    const fatigue = opts.fatigue;
    const demo = opts.demo && (opts.demo.name === 'coffee' || opts.demo.name === 'coffee-scare') ? opts.demo : null;
    const E = { mug: $('mug'), cup: $('mug-cup'), steam: $('mug-steam') };

    const R = { start: -1e9, guilty: -1e9, guiltyPull: 0, next: performance.now() + rand(8000, 15000) };
    const frozen = demo && Number.isFinite(demo.at) ? demo.at : null; // 冻结调试：时间轴锁死在这个值
    const runT = (now) => (frozen ?? now - R.start);

    const cupDir = () => (S.mouseSide === 'left' ? -1 : 1);
    const pawSide = () => (cupDir() === 1 ? 'L' : 'R'); // 杯子在观众哪侧，就伸哪只爪
    const mugHome = (d) => ({ x: 400 + d * (HOME.x - 400), y: HOME.y });

    function cupOK() {
      // push.js 手里的杯子正被推 / 已经摔出去飞着，就先别碰
      return !pushMod || !pushMod.pushPhase || pushMod.pushPhase() === 'idle';
    }
    function free(now) {
      return (S.state === STATES.AWAKE || S.state === STATES.DROWSY) && !S.pet &&
        (demo || now - S.lastInput >= IDLE_MIN) && !S.pressed.size && !S.mouseButtons.size &&
        S.tailReach <= 0.05 && cupOK();
    }

    function start(now) {
      R.start = now;
      R.guilty = -1e9;
    }
    function scare(now, loud) {
      if (R.guilty !== -1e9) return;
      R.guiltyPull = pullP(now - R.start); // 记住杯子此刻拉到哪儿，好放回去
      R.guilty = now;
      if (loud) ctx.fx.spawn('！', 500, 130, 'angry', now);
    }
    function finish(now) {
      R.start = -1e9; R.guilty = -1e9;
      R.next = now + rand(EVERY[0], EVERY[1]) * (demo ? 0.01 : 1);
    }
    function pullP(t) { // 杯子被拉离桌沿的进度 0–1
      return ease((t - PULL) / 700);
    }

    // ---------- 状态推进 ----------
    function afterState(now) {
      if (demo && frozen) { // 冻结调试：第一帧就开演并锁死时间轴
        if (R.start === -1e9) start(now);
        return;
      }
      if (demo) { // demo：到点开演，scare 版喝到一半自己吓自己
        if (R.start === -1e9 && now >= R.next && free(now)) start(now);
        if (R.start !== -1e9 && demo.name === 'coffee-scare' && R.guilty === -1e9 && now - R.start >= 1400) scare(now, false);
        return;
      }
      if (R.start === -1e9) {
        if (now >= R.next && free(now) && !ctx.reducedMotion()) start(now);
        return;
      }
      // 偷喝期间被打断：来键、来点鼠标、摸头、睡着，都算
      const t = now - R.start;
      if (R.guilty === -1e9 && t < PLACE &&
          (now - S.lastInput < 150 || S.pet || S.state === STATES.ASLEEP)) scare(now, S.state !== STATES.ASLEEP);
    }

    function afterKeyDown(code, now) {
      if (demo) return;
      if (R.start !== -1e9 && R.guilty === -1e9 && now - R.start < PLACE) scare(now, true);
    }

    // ---------- 姿态与爪子 ----------
    function paw() { return paws[pawSide()]; }

    function mugPose(now) { // 偷喝期间杯子的位置 / 倾斜
      const d = cupDir();
      const t = R.guilty !== -1e9 ? -1 : runT(now);
      if (t >= 0) {
        const p = t < DRINK ? pullP(t) : t < PLACE ? 1 - ease((t - PLACE) / 600) : 0;
        const home = mugHome(d);
        const m = ctx.headToScene(400, 244);
        const at = { x: m.x + d * 14, y: m.y + 44 };
        let tilt = 0;
        if (t >= DRINK && t < PLACE) tilt = -d * (30 + 8 * Math.sin(now / 130)); // 喝：一仰一仰地舔
        return { x: home.x + (at.x - home.x) * p, y: home.y + (at.y - home.y) * p, tilt, holding: t >= PULL && t < PLACE };
      }
      // 被打断：从当时的进度快速放回桌上
      const g = now - R.guilty;
      const p = R.guiltyPull * (1 - ease(g / 350));
      const d2 = cupDir(), home = mugHome(d2);
      return { x: home.x, y: home.y, tilt: 0, holding: false, pullBack: p, dir: d2 };
    }

    function forcedPawTarget(targetPaw, now) {
      if (R.start === -1e9 || targetPaw !== paw()) return null;
      const t = runT(now);
      if (R.guilty !== -1e9) return null; // 缩手，爪子自己飞回原位
      if (t < REACH || t >= PLACE + 250) return null;
      const d = cupDir();
      if (t < PULL) { // 伸到杯子边上
        const home = mugHome(d), p = ease((t - REACH) / 400);
        return { id: 'coffee', x: home.x - d * 16, y: home.y - 34 * p - 10 * (1 - p), tau: 30 };
      }
      const mp = mugPose(now);
      return { id: 'coffee', x: mp.x - d * 14, y: mp.y - 32, tau: t < PULL + 200 ? 26 : 14, pressing: true };
    }

    function pose(now, dt, rm, P) {
      if (R.start === -1e9) return;
      const t = runT(now);
      const d = cupDir();
      if (R.guilty !== -1e9) {
        // 心虚：耳朵压后、眼睛瞪大看着正前方，装作什么都没发生
        const g = now - R.guilty;
        if (g >= SCARE_MS) { finish(now); return; }
        P.earDroop += 12 * (1 - g / SCARE_MS);
        P.look = { x: 400, y: 190 };
        P.lidMin = Math.max(P.lidMin, 0.3);
        return;
      }
      if (t < REACH) P.look = mugHome(d);                    // 先瞟一眼杯子
      else if (t < PULL) P.look = mugHome(d);
      else if (t < PLACE) {                                  // 喝：低头闭眼
        P.eyesClosed = true;
        P.headY += 5 + 2 * Math.sin(now / 130);
        P.look = mugHome(d);
      } else if (t < END) {                                  // 放回去：左右瞟，装没事
        const g = t - PLACE;
        P.look = g < 260 ? { x: 400 + d * 190, y: 240 } : g < 520 ? { x: 400 - d * 190, y: 240 } : { x: 400, y: 190 };
        P.earDroop += 6 * (1 - (t - PLACE) / (END - PLACE));
      }
      if (t >= END) {
        // 喝完了：精神了。困意重置，疲劳轻一截
        S.lastInput = now;
        if (fatigue && fatigue.bump) fatigue.bump(-0.18);
        P.eyesHappy = true;
        finish(now);
      }
    }

    // ---------- 渲染：只在偷喝期间接管杯子 ----------
    function render(now, dt, rm) {
      if (R.start === -1e9) return;
      const mp = mugPose(now);
      const d = mp.dir ?? cupDir();
      const p = mp.pullBack ?? 1;
      E.mug.setAttribute('transform', `translate(${ctx.f1(mp.x)} ${ctx.f1(mp.y)})`);
      E.cup.setAttribute('transform', `translate(0 0) scale(${d} 1) rotate(${ctx.f1(mp.tilt * p)})`);
      E.steam.style.display = 'none'; // 端起来就别冒热气了
    }

    if (demo) R.next = performance.now() + 800;

    return {
      afterState, afterKeyDown, forcedPawTarget, pose, render,
      debugProps: {
        coffee: () => (R.start !== -1e9 ? (R.guilty !== -1e9 ? 'scare' : 'sipping') : null),
      },
    };
  }

  window.SillyCoffee = { create };
})();
