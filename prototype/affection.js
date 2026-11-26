// 好感度：摸头会攒好感，攒够了头顶冒爱心；够亲了，猫会在你发呆时趴下踩奶。
// 连戳它、拉它尾巴会掉好感。存在 localStorage 里，设置窗口里展示、可清零。
// 全局 API 在载入即挂到 window.SillyAffection；create(ctx) 是给主画面的模块。
(function () {
  'use strict';

  const KEY = 'sillycat-affection-v1';
  const HEART_EVERY = 10;        // 每攒 10 点冒一颗爱心
  const KNEAD_AT = 60;           // 好感度到"亲近"才解锁踩奶
  const KNEAD_IDLE = 9000;       // 你停手 9 秒后才踩（别耽误打字）
  const KNEAD_MS = 4200;         // 一次踩奶的时长
  const KNEAD_BEAT = 500;        // 两爪交替的节拍
  const SPOT_L = { x: 424, y: 352 };  // 胸口两侧（画面坐标）
  const SPOT_R = { x: 386, y: 352 };
  const TIERS = [
    { min: 100, name: '死忠' },
    { min: 60, name: '亲近' },
    { min: 30, name: '熟悉' },
    { min: 0, name: '陌生' },
  ];
  const DEMOS = ['knead'];

  let data = { v: 0 };
  try { data = Object.assign(data, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 坏了就从头攒 */ }

  let dirty = false;
  function save() {
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式下存不了就算了 */ }
  }
  function add(n) {
    data.v = Math.max(0, Math.min(999, (data.v || 0) + n));
    dirty = true;
    if (!add.timer) add.timer = setTimeout(() => { add.timer = 0; save(); }, 3000);
  }
  window.addEventListener('pagehide', () => { if (dirty) save(); });

  const tierOf = (v) => TIERS.find((t) => v >= t.min).name;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const api = {
    get: () => ({ v: Math.floor(data.v || 0), tier: tierOf(data.v || 0) }),
    add(n) { add(+n || 0); },
    reset() { data = { v: 0 }; save(); },

    // 主画面模块：摸头攒好感、冒爱心；够亲了发呆时踩奶
    create(ctx, opts = {}) {
      const { S, STATES, fx } = ctx;
      const demo = opts.demo && DEMOS.includes(opts.demo.name) ? opts.demo : null;
      const frozen = demo && Number.isFinite(demo.at);

      const F = { kneadAt: -1e9, nextKnead: performance.now() + rand(10, 25) * 1000, demoInit: false, tier: tierOf(data.v || 0) };
      // 暴露踩奶状态和节拍进度给 hindpaws 等模块（后脚要跟前爪对角同步蹬）
      window.SillyAffection.kneading = () => F.kneadAt > 0;
      window.SillyAffection.kneadT = (now) => (F.kneadAt > 0 ? now - F.kneadAt : -1);

      function startKnead(now) {
        F.kneadAt = now;
        S.lastInput = now; // 踩奶期间别犯困
        if (window.SillySounds) window.SillySounds.startPurr(); // 呼噜呼噜
      }
      function endKnead(now) {
        F.kneadAt = -1e9;
        F.nextKnead = now + (demo ? 1200 : rand(25, 55) * 1000);
        S.lastInput = now;
        if (window.SillySounds) window.SillySounds.stopPurr();
      }

      function pose(now, dt, rm, P) {
        // 摸头攒好感：每秒 +2，每攒满 10 点头顶冒一颗爱心，升级了报个喜
        if (S.pet && S.state !== STATES.ASLEEP) {
          const before = data.v || 0;
          add(dt * 0.002);
          const after = data.v;
          if (Math.floor(after / HEART_EVERY) > Math.floor(before / HEART_EVERY)) {
            fx.spawn('♥', 400 + rand(-34, 34), 92 + rand(-8, 8), 'hot', now);
          }
          const tier = tierOf(after);
          if (tier !== F.tier) {
            F.tier = tier;
            fx.spawn(`${tier}！`, 400 + rand(-24, 24), 96, 'hot', now);
          }
        }
        // 踩奶：两爪交替按胸口，眯眼开心，尾巴慢慢摇
        if (F.kneadAt > 0) {
          if (now - F.kneadAt >= KNEAD_MS) { endKnead(now); return; }
          P.eyesHappy = true;
          P.headY += 1.6 * Math.sin(now * 0.012); // 呼噜似的轻轻晃
          P.tailAmp = Math.max(P.tailAmp || 0, 18);
          P.tailSpeed = 0.008;
          S.lastInput = now;
        }
        if (frozen) { // 冻结帧：把踩奶钉在时间轴上，方便调试截图
          if (!F.demoInit) { F.demoInit = true; F.kneadAt = now - demo.at; }
          else F.kneadAt = now - demo.at;
        }
      }

      function softPawTarget(paw, now) {
        if (F.kneadAt <= 0) return null;
        const t = now - F.kneadAt;
        const spot = paw.side === 'L' ? SPOT_L : SPOT_R;
        const pressing = (Math.floor(t / KNEAD_BEAT) % 2 === 0) === (paw.side === 'L');
        return {
          id: 'knead',
          x: spot.x + (pressing ? 0 : 7),
          y: spot.y + (pressing ? 2 : -8),
          tau: pressing ? 10 : 13,
          pressing,
        };
      }

      function afterState(now) {
        if (frozen && F.kneadAt > 0) return; // 冻结帧永远踩着
        if (F.kneadAt > 0) {
          if (S.pressed.size || S.mouseButtons.size) endKnead(now); // 你回来了，先不踩了
          return;
        }
        if (data.v >= KNEAD_AT && now >= F.nextKnead && S.state === STATES.AWAKE && !S.pet &&
            !S.pressed.size && !S.mouseButtons.size &&
            // 听歌时不踩奶：踩奶会把 lastInput 拉到当前，听歌就被当成"用户有输入"掐断了
            !(window.SillyListenMusic && window.SillyListenMusic.listening && window.SillyListenMusic.listening()) &&
            (demo || now - S.lastInput >= KNEAD_IDLE)) {
          startKnead(now);
        }
      }

      function afterKeyDown(code, now) {
        if (F.kneadAt > 0) endKnead(now); // 开始打字就收爪
      }

      function overrideState() {
        return F.kneadAt > 0 ? STATES.AWAKE : null;
      }

      return {
        pose, softPawTarget, afterState, afterKeyDown, overrideState,
        debugProps: { affection: () => Math.floor(data.v || 0) },
      };
    },
  };
  window.SillyAffection = api;
})();
