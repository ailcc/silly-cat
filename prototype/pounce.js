// 扑鼠标：你快速甩鼠标，猫会压低身子、猛地扑上去抱住鼠标玩一会儿，再得意地放开。
// 作为 cat.js 的扩展模块：只接管爪子和姿态，不改真实的鼠标行为。
(function () {
  'use strict';

  // 时间轴（毫秒，从扑出去那一刻算起）
  const CROUCH = 260;   // 压低身子蓄势
  const LEAP = 620;     // 扑过去
  const HOLD = 2000;    // 抱住鼠标玩
  const END = 2500;     // 松手、得意
  const MISS_END = 1700; // 扑空：懊恼一会儿就收场
  const SWAT_UP = 400;  // 扑空时：爪扬到最高点
  const SWAT_HIT = 740; // 扑空时：爪拍到桌面（鼠标早跑了，拍空）
  const MISS_RATE = 0.2; // 五分之一的概率扑空
  const WINDOW = 280;   // 这么短的时间里甩出足够距离才算“在甩”
  const THRESH = 36;    // 甩动判定：窗口内鼠标位移总和
  const COOLDOWN = [18000, 40000]; // 玩过一次后缓一缓再玩
  const DEMOS = ['pounce'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (p) => { const u = clamp(p, 0, 1); return u * u * (3 - 2 * u); };

  function create(ctx, opts = {}) {
    const { S, STATES, fx, mousePoint, mousePaw, mouseHome } = ctx;
    const demo = opts.demo && DEMOS.includes(opts.demo.name) ? opts.demo : null;
    const frozen = demo && Number.isFinite(demo.at);

    const F = {
      pounceAt: -1e9, nextPounce: performance.now() + (demo ? 800 : rand(6000, 15000)),
      lastM: { x: 0, y: 0 }, moves: [], demoInit: false,
      miss: false, aim: { x: 400, y: 480 }, // 扑空局：爪子认准触发瞬间的鼠标位置，拍下去时鼠标早跑了
    };
    const lean = () => (mouseHome().x < 400 ? -1 : 1); // 鼠标在画面哪一侧，猫就往哪边扑

    function trigger(now) {
      F.pounceAt = now;
      F.aim = mousePoint();
      // 大多数时候扑个正着；偶尔（demo 里更容易遇到）扑空，露出懊恼
      F.miss = opts.demo?.miss ? true : Math.random() < (demo ? 0.5 : MISS_RATE);
      F.oww = false;
      const m = F.aim;
      fx.spawn('扑！', clamp(m.x + lean() * 26, 60, 740), m.y - 46, 'hot', now);
      if (window.SillySounds) window.SillySounds.play('meow');
    }
    function cancel(now) {
      F.pounceAt = -1e9;
      F.nextPounce = now + rand(COOLDOWN[0], COOLDOWN[1]) * (demo ? 0.02 : 1);
    }

    // ---------- 鼠标甩动检测 ----------
    function refresh(now) {
      if (F.pounceAt > 0) {
        if (frozen) return; // 冻结帧永远停在扑住的瞬间
        if (now - F.pounceAt >= (F.miss ? MISS_END : END)) cancel(now);
        return;
      }
      if (demo) {
        if (!frozen && now >= F.nextPounce) trigger(now);
        return;
      }
      const m = mousePoint();
      const d = Math.abs(m.x - F.lastM.x) + Math.abs(m.y - F.lastM.y);
      F.lastM = { x: m.x, y: m.y };
      if (d > 0.4) F.moves.push({ t: now, d });
      while (F.moves.length && now - F.moves[0].t > WINDOW) F.moves.shift();
      const speed = F.moves.reduce((s, e) => s + e.d, 0);
      if (speed >= THRESH && now >= F.nextPounce && !S.pet && !S.pressed.size && !S.mouseButtons.size &&
          (S.state === STATES.AWAKE || S.state === STATES.DROWSY) &&
          !(window.SillyTypeRhythm && window.SillyTypeRhythm.covering && window.SillyTypeRhythm.covering())) {
        trigger(now);
      }
    }

    function afterState(now) {
      // 半路按下鼠标键或开始摸头：还没扑出去就作罢
      if (F.pounceAt > 0 && now - F.pounceAt < LEAP && (S.mouseButtons.size || S.pet)) cancel(now);
    }

    function afterKeyDown(code, now) {
      if (F.pounceAt > 0) cancel(now); // 要打字了，马上松爪回来
    }

    function overrideState() {
      return F.pounceAt > 0 ? STATES.AWAKE : null; // 犯困时被甩鼠标吵到也会醒来玩
    }

    // ---------- 爪子 ----------
    // 扑中：一只按住鼠标顶，一只从旁边搂住。
    // 扑空：复用拍小奶猫那套「扬爪 → 拍下」——爪认准触发瞬间的鼠标位置拍下去，鼠标早跑了。
    function forcedPawTarget(paw, now) {
      if (F.pounceAt <= 0) return null;
      const t = now - F.pounceAt;
      if (F.miss) {
        if (paw !== mousePaw()) return null;             // 只挥鼠标那一侧的爪，另一只留在键盘上
        if (t < SWAT_UP) return null;                    // 蓄势扑出阶段爪子跟着身体走
        if (t < SWAT_HIT) return { id: 'swat-up', x: F.aim.x, y: F.aim.y - 170, tau: 9 }; // 扬起来
        if (t < MISS_END) return { id: 'swat-down', x: F.aim.x + lean() * 26, y: F.aim.y - 2, tau: 45 }; // 拍！拍空
        return null;
      }
      if (t < CROUCH || t >= HOLD) return null; // 蓄势和松手阶段爪子自己安排
      const m = mousePoint();
      const holding = t >= LEAP + 120;
      if (paw === mousePaw()) {
        return { id: 'pounce', x: m.x, y: m.y - 4, tau: holding ? 7 : 9, pressing: holding };
      }
      return { id: 'pounce', x: m.x + lean() * 18, y: m.y + 7, tau: holding ? 8 : 10, pressing: holding };
    }

    // ---------- 姿态：蓄势压低 -> 扑出去 -> 抱着晃 -> 得意（扑空：拍空后懊恼地坐回来） ----------
    function pose(now, dt, rm, P) {
      if (frozen) { // 冻结帧：把扑击钉在时间轴上，方便调试截图
        if (!F.demoInit) { F.demoInit = true; F.miss = !!opts.demo?.miss; F.aim = mousePoint(); }
        F.pounceAt = now - demo.at;
      }
      if (F.pounceAt <= 0) return;
      const t = now - F.pounceAt;
      const d = lean();
      const m = mousePoint();
      if (t < CROUCH) {
        const e = ease(t / CROUCH);
        P.bodyY += 6 * e;                 // 压低身子
        P.headX += d * 5 * e;
        P.look = m;
        P.tailAmp = Math.max(P.tailAmp || 0, 10);
      } else if (t < LEAP) {
        const e = ease((t - CROUCH) / (LEAP - CROUCH));
        P.bodyX += d * 13 * e;            // 扑向鼠标那侧
        P.bodyY += 6 - 10 * e;            // 起身扑出去
        P.headX += d * 5;
        P.headRot += d * 5 * e;
        P.look = m;
        P.tailAmp = Math.max(P.tailAmp || 0, 14);
      } else if (F.miss) {
        // 扑空：拍下去落空，懊恼地坐回来
        const e = ease((t - LEAP) / (MISS_END - LEAP));
        P.bodyX += d * 13 * (1 - e);
        P.headX += d * 5 * (1 - e);
        if (t < SWAT_HIT) {
          P.look = F.aim;                 // 眼睛还死死盯着鼠标刚才在的地方
        } else {
          P.earDroop -= 14 * (1 - e) + 4; // 没拍到，耳朵尴尬地耷下来
          P.lidMin = 0.55;               // 眼皮半耷，写满懊恼
          P.look = m;                    // 目送鼠标扬长而去
          if (!F.oww) {
            F.oww = true;
            fx.spawn('喵？！扑空了', clamp(F.aim.x, 60, 700), F.aim.y - 60, 'angry', now, 1500);
          }
        }
        P.tailAmp = Math.max(P.tailAmp || 0, 10);
      } else if (t < HOLD) {
        P.bodyX += d * 13;
        P.headX += d * 5;
        P.headRot += d * 5;
        P.look = { x: m.x, y: m.y - 30 };
        P.eyesHappy = true;               // 玩得开心
        // 抱着鼠标左右晃（只晃画面里的鼠标，不影响真实鼠标）
        P.mouseX = 2.6 * Math.sin(now * 0.035) * ease((t - LEAP) / 160);
        P.tailAmp = Math.max(P.tailAmp || 0, 22);
        P.tailSpeed = 0.012;
      } else {
        const e = ease((t - HOLD) / (END - HOLD)); // 松手：得意地坐回去
        P.bodyX += d * 13 * (1 - e);
        P.headX += d * 5 * (1 - e);
        P.eyesHappy = true;
        P.headY -= 4 * Math.sin(Math.PI * e);
        P.tailAmp = Math.max(P.tailAmp || 0, 9 + 6 * Math.sin(Math.PI * e));
      }
      S.lastInput = now; // 玩的时候别睡着
    }

    return {
      refresh, afterState, afterKeyDown, overrideState, forcedPawTarget, pose,
      debugProps: { pounce: () => (F.pounceAt > 0 ? Math.floor(performance.now() - F.pounceAt) : null), miss: () => F.miss },
    };
  }

  window.SillyPounce = { create };
})();
