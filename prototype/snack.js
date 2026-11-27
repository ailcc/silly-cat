// 扔零食：快速连按两下 G，一颗小鱼干从画面右下角抛进来，猫跳起来接住，
// 咀嚼、舔嘴、「香！」一声，好感 +2。2 分钟里喂超过 3 颗它会嫌多，
// 把鱼干扒拉到一边：「吃不下啦」。冷却 8 秒。
// 每天最多吃 5 条（多了它自己管住嘴，扒拉走让你明天再来）；连续 3 天
// 每天都有得吃，它就悄悄圆了起来（鼓腮 + 身体放宽）——断一天就瘦回去。
// 调试：?demo=snack&loop=1（自动抛）&fat=1（演示变胖）或 &at=毫秒 冻结在咀嚼瞬间
(function () {
  'use strict';

  const T_CROUCH = 280;    // 起跳前压低
  const T_FLY = 650;       // 鱼干飞行时长（猫在空中接）
  const T_CHEW = 1000;     // 咀嚼
  const END = 2200;
  const FEED_WIN = 120000; // 喂多判定窗口
  const FEED_MAX = 3;
  const COOLDOWN = 8000;
  const STORE_KEY = 'sillycat-snack-v1';
  const DAY_MAX = 5;       // 每天最多吃这么多条
  const FAT_STREAK = 3;    // 连续这么多天每天都吃，就要圆了
  const DAY_MS = 86400000;

  // 喂食记录：今天吃了几条、最后喂食日期、连喂天数、圆了没有。localStorage 跨重启。
  const dstr = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const TODAY = () => dstr(Date.now());
  const YDAY = () => dstr(Date.now() - DAY_MS);
  let store = {};
  function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 存不了就算了 */ } }
  function ensureDay() {
    if (store.day === TODAY()) return;
    store.day = TODAY();
    store.today = 0;
    // 昨天一根都没喂：连喂记录断了，圆也悄悄瘦回去
    if (store.lastDay !== YDAY()) { store.streak = 0; store.fat = false; }
    saveStore();
  }
  try {
    store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    if (typeof store.today !== 'number') store.today = 0;
    if (typeof store.streak !== 'number') store.streak = 0;
    ensureDay();
  } catch (e) { store = {}; }

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const $ = (id) => document.getElementById(id);

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && opts.demo.name === 'snack' ? opts.demo : null;
    const W = {
      next: 0,               // 冷却截止
      lastG: -1, otherKey: false,
      phase: null, start: 0, // crouch | fly | chew | spit | done
      fish: null, from: { x: 760, y: 556 }, to: { x: 430, y: 386 },
      feedLog: [],
      endUntil: -1e9,
    };

    // 小鱼干：梭形身子 + 三角尾 + 眼点
    $('fx-layer').insertAdjacentHTML('beforebegin', `
      <g id="snack-fish" style="opacity:0">
        <g class="snack-fish">
          <path class="snack-body" d="M -16 0 Q 0 -9 14 0 Q 0 9 -16 0 Z"/>
          <path class="snack-tail" d="M -16 0 L -26 -7 L -23 0 L -26 7 Z"/>
          <circle class="snack-eye" cx="7" cy="-1.5" r="1.6"/>
        </g>
      </g>`);
    const E = { fish: $('snack-fish') };

    // 飞行轨迹：x 线性，y 先抛后落（抛物线）
    function fishPos(k) {
      const x = W.from.x + (W.to.x - W.from.x) * k;
      const y = W.from.y + (W.to.y - W.from.y) * k - 150 * Math.sin(Math.PI * k);
      return { x, y };
    }

    function throwFish(now) {
      if (now < W.next || W.phase || S.state !== STATES.AWAKE || S.pet) return;
      if (!demo) ensureDay();
      const overDaily = !demo && store.today >= DAY_MAX; // 今天吃够了：这条直接拒收
      const recent = W.feedLog.filter((t) => now - t < FEED_WIN).length;
      W.overfed = overDaily || recent >= FEED_MAX;
      W.overDaily = overDaily;
      W.phase = 'crouch'; W.start = now;
      W.feedLog.push(now);
      W.next = now + COOLDOWN;
      W.fish = { ...W.from };
    }

    // 成功吃下一条：记进每天的账，连续吃满 FAT_STREAK 天就圆了
    function feedAccepted(now) {
      if (demo) return;
      ensureDay();
      store.today += 1;
      if (store.lastDay !== store.day) {
        store.streak = store.lastDay === YDAY() ? store.streak + 1 : 1;
        store.lastDay = store.day;
        if (store.streak >= FAT_STREAK && !store.fat) {
          store.fat = true;
          setTimeout(() => ctx.fx.spawn(window.SillyLines.get('snackRound'), 400, 100, 'hot', performance.now(), 2200), 1300);
        }
      }
      saveStore();
    }

    function afterKeyDown(code, now) {
      if (demo || code !== 'KeyG') { if (W.lastG > 0) W.otherKey = true; return; }
      // 双击 G：两下之间没混别的键
      if (W.lastG > 0 && !W.otherKey && now - W.lastG <= 350 && now - W.lastG > 25) {
        W.lastG = -1; W.otherKey = false;
        throwFish(now);
      } else {
        W.lastG = now; W.otherKey = false;
      }
    }

    function softPawTarget(paw, now) {
      if (W.phase !== 'fly' || paw.side !== 'L' || !W.fish) return null;
      const t = now - W.start - T_CROUCH;
      if (t < 0 || t > T_FLY) return null;
      const k = clamp01(t / T_FLY);
      const p = fishPos(k);
      return { id: 'snack-catch', x: p.x + 6, y: p.y + 4, tau: 50, pressing: k > 0.6 };
    }

    function pose(now, dt, rm, P) {
      if (demo) {
        if (Number.isFinite(demo.at)) {
          if (!W.frozenInit) { // 冻结：吃到嘴里正在嚼
            W.frozenInit = true; W.phase = 'chew'; W.start = now - 60; W.fish = null; W.endUntil = now + END - T_CROUCH - T_FLY;
            E.fish.style.opacity = 0;
          }
        } else if (!W.phase && now >= W.next) { throwFish(now); W.next = now + 3500; }
      }
      // 圆了：鼓腮 + 身体放宽（连续 3 天每天都吃到小鱼干；断一天就瘦回去）。
      // 常驻演出，跟当下有没有在吃无关
      const fatOn = !!demo?.fat || (!demo && store.fat);
      if (fatOn) { P.cheek = 18; P.bodySX *= 1.09; P.bodySY *= 1.06; }
      if (!W.phase) return;
      const t = now - W.start;

      if (W.phase === 'crouch') {
        const k = clamp01(t / T_CROUCH);
        P.bodyY += 6 * k; P.headY += 3 * k; P.earDroop -= 5 * k;
        P.look = { x: W.from.x, y: W.from.y };
        if (t >= T_CROUCH) { W.phase = 'fly'; W.start = now; }
      } else if (W.phase === 'fly') {
        const k = clamp01(t / T_FLY);
        W.fish = fishPos(k);
        // 跳起来接：半个正弦的腾空
        const jump = Math.sin(Math.PI * Math.min(1, k * 1.25));
        P.bodyY -= 26 * jump;
        P.headY -= 10 * jump;
        P.earDroop -= 6 * jump;
        P.look = { x: W.fish.x, y: W.fish.y };
        P.tailAmp = 20; P.tailSpeed = 0.03;
        if (t >= T_FLY) {
          if (W.overfed) { W.phase = 'spit'; W.start = now; ctx.fx.spawn(W.overDaily ? window.SillyLines.fmt('snackCap', { cap: DAY_MAX }) : window.SillyLines.get('snackFull'), 400, 100, 'angry', performance.now(), 1800); }
          else {
            W.phase = 'chew'; W.start = now; W.fish = null;
            ctx.fx.spawn(window.SillyLines.get('snackYum'), 460, 100, 'hot', performance.now());
            feedAccepted(now);
            if (window.SillyAffection) window.SillyAffection.add(2);
            if (window.SillySounds) { window.SillySounds.play('tap'); setTimeout(() => window.SillySounds.play('tap'), 220); }
          }
          E.fish.style.opacity = W.overfed ? 1 : 0;
        }
      } else if (W.phase === 'chew') {
        P.eyesHappy = true;
        P.headRot += 3 * Math.sin(now / 90);
        P.bodyY += 2;
        if (now - W.start >= T_CHEW) { W.phase = 'done'; W.start = now; }
      } else if (W.phase === 'spit') {
        // 嫌多：鱼干落地上被扒拉走
        const k = clamp01(t / 900);
        W.fish = { x: W.to.x - 500 * k, y: 500 + 20 * Math.sin(k * 6) };
        P.earDroop += 8;
        P.headRot += 5;
        P.look = { x: W.fish.x, y: W.fish.y };
        if (t >= 900) { W.phase = 'done'; W.start = now; W.fish = null; E.fish.style.opacity = 0; }
      } else if (W.phase === 'done') {
        if (now - W.start >= 400) { W.phase = null; }
      }
    }

    function render(now) {
      if (W.phase === 'spit' && W.fish) E.fish.style.opacity = 1;
      else if (W.phase === 'fly' && W.fish) E.fish.style.opacity = 1;
      else if (W.phase !== 'crouch' && W.phase !== 'done') { /* chew/catch 后隐藏 */ }
      if (!W.fish) { if (W.phase !== 'spit') E.fish.style.opacity = 0; return; }
      E.fish.setAttribute('transform', `translate(${W.fish.x.toFixed(1)} ${W.fish.y.toFixed(1)}) rotate(${(W.phase === 'spit' ? -160 : (now - W.start) * 0.3).toFixed(0)})`);
    }

    return {
      afterKeyDown, softPawTarget, pose, render,
      debugProps: {
        snack: () => W.phase, snackFish: () => W.fish, snackFed: () => W.feedLog.length,
        snackToday: () => store.today, snackStreak: () => store.streak, snackFat: () => !!store.fat,
      },
    };
  }

  window.SillySnack = { create };
})();
