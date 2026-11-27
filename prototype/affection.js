// 好感度：摸头会攒好感，攒够了头顶冒爱心；够亲了，猫会在你发呆时趴下踩奶。
// 只有用户互动才涨分：摸头、逗猫棒（按住 F）、喂零食；猫自己玩（激光笔等）不涨。
// 100 分之后每天最多再涨 20（按自然日重置）。连戳它、拉它尾巴会掉好感。
// 每只皮肤（毛色）一份好感度，互不共享：A 攒到 200，切到 B 从 0 开始，切回 A 还是 200；
// 成长装扮（围巾/皇冠/铃铛）也跟着各皮肤的好感度走。
// 存在 localStorage 里，设置窗口里展示当前选中皮肤的好感度、可清零。
// 全局 API 在载入即挂到 window.SillyAffection；create(ctx) 是给主画面的模块。
(function () {
  'use strict';

  const KEY = 'sillycat-affection-v2';   // 按皮肤分桶的新格式
  const LEGACY_KEY = 'sillycat-affection-v1'; // 旧版单值存档：迁给迁移那一刻正在用的皮肤
  const AFFECTION_MAX = 300;     // 好感度真封顶：满了数值不再涨
  const CELEBRATE_AT = 200;      // 里程碑不变：200 触发一次性满级庆祝，之后摸头眯眼蹭手；200–300 继续涨
  const DAILY_AFTER = 100;       // 100 分之后开始限额
  const DAILY_MAX = 20;          // 100 之后每天最多再涨 20（摸头/逗猫棒/零食共用额度）
  const HEART_EVERY = 10;        // 每攒 10 点冒一颗爱心
  const KNEAD_AT = 60;           // 好感度到"亲近"才解锁踩奶
  const KNEAD_IDLE = 9000;       // 你停手 9 秒后才踩（别耽误打字）
  const KNEAD_MS = 4200;         // 一次踩奶的时长
  const KNEAD_BEAT = 500;        // 两爪交替的节拍
  const SPOT_L = { x: 424, y: 352 };  // 胸口两侧（画面坐标）
  const SPOT_R = { x: 386, y: 352 };
  const TIERS = [
    { min: 160, name: '命中注定' },
    { min: 100, name: '死忠' },
    { min: 60, name: '亲近' },
    { min: 30, name: '熟悉' },
    { min: 0, name: '陌生' },
  ];
  const DEMOS = ['knead'];

  let store = { coats: {} };
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { /* 坏了就从头攒 */ }
  if (!store.coats || typeof store.coats !== 'object') store.coats = {};

  // 旧版（不按皮肤分）的存档：迁移推迟到主画面 create() 里做——那时才知道
  // 「升级那一刻用的是哪只皮肤」，旧分就归它，其它皮肤从 0 开始
  let legacy = null;
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    if (old && ((old.v || 0) > 0 || old.celebrated)) legacy = old;
  } catch (e) { legacy = null; }

  let activeId = null; // 当前皮肤的 id（主画面逐帧对齐；设置窗口用显式 id 查询）

  function bucket(id) {
    let b = store.coats[id];
    if (!b || typeof b !== 'object') b = store.coats[id] = {};
    b.v = Math.min(AFFECTION_MAX, Math.max(0, b.v || 0));
    return b;
  }
  // 没有显式 id 时按当前皮肤取：主画面走 activeId（create 里逐帧对齐，切换皮肤立刻生效），
  // 还没跑起来的场合（设置窗口直接查）退回 SillyCoats 的当前值
  function idOf(coatId) {
    if (coatId) return coatId;
    if (activeId) return activeId;
    try { return window.SillyCoats.current().id || 'cow'; } catch (e) { return 'cow'; }
  }
  function takeLegacy(id) {
    if (!legacy) return;
    const b = bucket(id);
    if (!b.v && !b.celebrated) { // 只补给还是白纸的皮肤，避免覆盖已经攒出来的进度
      b.v = Math.min(AFFECTION_MAX, legacy.v || 0);
      b.celebrated = !!legacy.celebrated;
      b.day = legacy.day;
      b.gained = legacy.gained;
    }
    legacy = null;
    try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* 迁移过了就行 */ }
    dirty = true;
    save();
  }

  let dirty = false;
  function save() {
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 隐私模式下存不了就算了 */ }
  }
  function add(n) {
    const b = bucket(idOf());
    let gain = +n || 0;
    if (gain > 0 && (b.v || 0) >= DAILY_AFTER) {
      // 100 之后每天限领 20：按自然日重置额度，超了的部分默默不涨（猫不告诉你）
      if (b.day !== todayKey()) { b.day = todayKey(); b.gained = 0; }
      const room = Math.max(0, DAILY_MAX - (b.gained || 0));
      gain = Math.min(gain, room);
      b.gained = (b.gained || 0) + gain;
    }
    b.v = Math.max(0, Math.min(AFFECTION_MAX, (b.v || 0) + gain));
    dirty = true;
    if (!add.timer) add.timer = setTimeout(() => { add.timer = 0; save(); }, 3000);
  }
  window.addEventListener('pagehide', () => { if (dirty) save(); });

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  const tierOf = (v) => TIERS.find((t) => v >= t.min).name;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const api = {
    // coatId 可选：不传按当前皮肤；设置窗口传它表单里选中的皮肤 id
    get: (coatId) => { const b = bucket(idOf(coatId)); return { v: Math.floor(b.v || 0), tier: tierOf(b.v || 0) }; },
    add(n) { add(+n || 0); },
    reset(coatId) { store.coats[idOf(coatId)] = { v: 0 }; dirty = true; save(); },

    // 主画面模块：摸头攒好感、冒爱心；够亲了发呆时踩奶
    create(ctx, opts = {}) {
      const { S, STATES, fx } = ctx;
      const demo = opts.demo && DEMOS.includes(opts.demo.name) ? opts.demo : null;
      const frozen = demo && Number.isFinite(demo.at);

      // 演示模式 0.8 秒就开踩（再晚猫先睡着了）；平时发呆 10–25 秒后随机来一次
      const F = { kneadAt: -1e9, nextKnead: performance.now() + (demo ? 800 : rand(10, 25) * 1000), demoInit: false, tier: tierOf(bucket(idOf()).v || 0), celebrateUntil: -1e9, nextCelebHeart: 0, nextPetHeart: 0 };
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
        // 跟上当前皮肤（coats.apply 不发事件，逐帧对齐 id，变了就切到那份存档）
        const coatId = window.SillyCoats?.current ? window.SillyCoats.current().id : null;
        if (coatId && coatId !== activeId) {
          const was = activeId;
          activeId = coatId;
          takeLegacy(coatId); // 旧版存档：迁给升级那一刻正在用的皮肤，只办一次
          if (was !== null) { // 切皮肤：踩奶立刻收爪（那只皮肤可能还没解锁踩奶）
            if (F.kneadAt > 0) endKnead(now);
            F.tier = tierOf(bucket(coatId).v || 0);
          }
        }

        // 摸头攒好感：每秒 +2，每攒满 10 点头顶冒一颗爱心，升级了报个喜
        if (S.pet && S.state !== STATES.ASLEEP) {
          const b = bucket(activeId);
          const celebrated = (b.v || 0) >= CELEBRATE_AT;
          const before = b.v || 0;
          add(dt * 0.002);
          const after = b.v;
          if (celebrated) {
            // 200 之后摸头：眯眼蹭手，爱心一直冒——摸着更有反馈；数值到 300 前还能继续涨
            P.eyesHappy = true;
            if (now >= F.nextPetHeart) {
              fx.spawn('♥', 400 + rand(-34, 34), 92 + rand(-8, 8), 'hot', now);
              F.nextPetHeart = now + 1400;
            }
          } else if (Math.floor(after / HEART_EVERY) > Math.floor(before / HEART_EVERY)) {
            fx.spawn('♥', 400 + rand(-34, 34), 92 + rand(-8, 8), 'hot', now);
          }
          // 这只皮肤第一次攒到 200：一次性庆祝——爱心雨 + 主动踩奶呼噜（各皮肤各办一次）；
          // 踩奶只属于猫（species.knead !== false），狗的庆祝只有爱心雨和台词
          if (after >= CELEBRATE_AT && !b.celebrated) {
            b.celebrated = true;
            dirty = true;
            F.celebrateUntil = now + 3200;
            F.nextCelebHeart = now;
            if (ctx.species?.knead !== false) startKnead(now);
            fx.spawn(window.SillyLines.get('affectionMaxed'), 400 + rand(-24, 24), 96, 'hot', now);
          }
          if (now < F.celebrateUntil && now >= F.nextCelebHeart) {
            fx.spawn('♥', 400 + rand(-110, 110), 130 + rand(-40, 0), 'hot', now);
            F.nextCelebHeart = now + 200;
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
        if ((demo || bucket(activeId || idOf()).v >= KNEAD_AT) && ctx.species?.knead !== false &&
            now >= F.nextKnead && S.state === STATES.AWAKE && !S.pet &&
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
        debugProps: { affection: () => Math.floor(bucket(idOf()).v || 0) },
      };
    },
  };
  window.SillyAffection = api;
})();
