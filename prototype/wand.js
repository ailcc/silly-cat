// 逗猫棒：按住 F 键不放（约 0.7 秒，期间没按别的键——打字带 F 不算），屏幕上方垂下一条
// 晃来晃去的毛线球，猫眼睛盯着看、伸爪去拍；拍到 3 下就开心打滚涨好感。
// 松开 F 球不收回，留着让猫再玩 5–10 秒（随机）；期间一打字（按任何非 F 键）立刻收走。
// 冷却 12 秒，避免打字误触。
// 调试：?demo=wand&loop=1（自动演：举 3.5 秒收 2.5 秒）或 &at=毫秒 冻结在拍击瞬间
(function () {
  'use strict';

  const HOLD_MS = 700;      // 按住 F 这么久才出现毛线球
  const SWAT_MS = 700;      // 两次拍击的间隔
  const HITS_JOY = 3;       // 拍到这么多下开始打滚
  const COOLDOWN = 12000;
  const PLAY_MIN = 5000, PLAY_MAX = 10000; // 松手后猫接着玩多久（随机）
  const MAX_MS = 20000;     // 球最多在场这么久：防止 keyup 丢失时球赖着不走

  const rand = (a, b) => a + Math.random() * (b - a);
  const $ = (id) => document.getElementById(id);

  function create(ctx, opts = {}) {
    const { S, STATES, clamp } = ctx;
    const demo = opts.demo && opts.demo.name === 'wand' ? opts.demo : null;
    const W = {
      holdStart: -1,        // F 按下的时刻（-1 = 没按）
      active: false,        // 毛线球在场
      start: -1e9,          // 球出现时刻（时间轴基准）
      until: -1e9,          // 球收走时刻
      fading: false, fadeAt: -1e9,
      nextSwat: 0, swatPaw: 'L', hits: 0,
      joyUntil: -1e9, joyed: false,
      cooldownUntil: -1e9,
      otherKey: false,      // 按住 F 期间按了别的键
    };

    // 毛线球：一根线从右上角垂下来，末端一个线团
    $('fx-layer').insertAdjacentHTML('beforebegin', `
      <g id="wand-layer" style="opacity:0">
        <path id="wand-string" class="wand-string" d=""/>
        <g id="wand-ball" class="wand-ball">
          <circle r="16"/>
          <path class="wand-yarn" d="M -10 -6 Q 0 -12 10 -6 M -11 2 Q 0 -4 11 2 M -9 9 Q 0 4 9 9"/>
        </g>
      </g>`);
    const E = { layer: $('wand-layer'), string: $('wand-string'), ball: $('wand-ball') };

    // 球心位置：围绕键盘上方晃（线从右上 720,30 垂下）
    function ballPos(now) {
      const x = 400 + 120 * Math.sin(now * 0.0035) + 30 * Math.sin(now * 0.011);
      const y = 318 + 46 * Math.sin(now * 0.0053) + 14 * Math.sin(now * 0.013);
      return { x, y };
    }

    function activate(now) {
      W.active = true; W.fading = false;
      W.start = now;
      W.until = now + MAX_MS; // 兜底：按住 F 期间球最多在场这么久（正常由「打字收球」或兜底计时收走）
      W.nextSwat = now + 500;
      W.swatPaw = Math.random() < 0.5 ? 'L' : 'R';
      W.hits = 0; W.joyed = false; W.joyUntil = -1e9;
      E.layer.style.opacity = 1;
    }
    function deactivate(now, fade) {
      if (!W.active) return;
      W.until = now;
      W.fading = !!fade;
      W.fadeAt = now;
      W.active = false;
      W.holdStart = -1;
      W.cooldownUntil = now + COOLDOWN;
    }

    function afterKeyDown(code, now) {
      if (demo) return;
      // 球在场时按了别的键 → 你在打字，立刻收球（F 本身除外，那是逗猫棒）
      if (W.active && code !== 'KeyF') { deactivate(now, true); return; }
      if (code === 'KeyF' && !W.active && now >= W.cooldownUntil && S.state === STATES.AWAKE && !S.pet) {
        W.holdStart = now; W.otherKey = false;
      } else if (W.holdStart > 0) {
        W.otherKey = true; // 按住 F 期间混了别的键 → 算打字，不算逗猫
      }
    }
    function afterKeyUp(code) {
      if (demo || code !== 'KeyF') return;
      const now = performance.now();
      if (W.holdStart > 0) {
        // 正常松手（举满时长、没混别的键）：球不收回，留 5–10 秒让猫接着玩；
        // 期间按任何别的键照旧立刻收走（afterKeyDown 的打字收球）。球若已被兜底收走就什么都不做。
        if (now - W.holdStart >= HOLD_MS && !W.otherKey && W.active) {
          W.until = now + rand(PLAY_MIN, PLAY_MAX);
        }
        W.holdStart = -1;
      }
    }

    function softPawTarget(paw, now) {
      if (W.joyed && now < W.joyUntil) return null; // 打滚时爪子随身体
      if (!W.active) return null;
      if (paw.side !== W.swatPaw) return null;
      if (now < W.nextSwat) return null;
      const t = now - W.nextSwat;
      if (t >= SWAT_MS - 120) { // 这一下拍完：计数、换边
        W.hits++;
        const b = ballPos(now);
        if (W.hits >= HITS_JOY && !W.joyed) {
          W.joyed = true; W.joyUntil = now + 2200;
          ctx.fx.spawn(window.SillyLines.get('wandFun'), 400, 96, 'hot', performance.now());
          if (window.SillyAffection) window.SillyAffection.add(5);
          if (window.SillySounds) { window.SillySounds.startPurr(); setTimeout(() => window.SillySounds.stopPurr(), 1800); }
        } else if (W.hits < HITS_JOY) {
          ctx.fx.spawn('啪', b.x, b.y - 24, '', performance.now());
        }
        W.nextSwat = now + 120;
        W.swatPaw = W.swatPaw === 'L' ? 'R' : 'L';
        return null;
      }
      // 拍击过程：爪子跟着球走
      const b = ballPos(now);
      return { id: 'wand-swat', x: b.x, y: b.y, tau: 90, pressing: t > SWAT_MS - 160 };
    }

    function pose(now, dt, rm, P) {
      // demo：自动举棒 3.5 秒、收 2.5 秒循环；冻结则锁时间轴
      if (demo) {
        if (Number.isFinite(demo.at)) {
          // 冻结：直接呈现「拍到第二下、正要拍第三下」的瞬间
          if (!W.frozenInit) { W.frozenInit = true; W.active = true; W.start = now - 1600; W.hits = 2; W.joyed = false; W.nextSwat = now + 60; E.layer.style.opacity = 1; }
        } else {
          if (!W.active && !W.joyed && now >= (W.nextDemo || 0)) { activate(now); W.until = now + 3500; W.nextDemo = 1e12; }
          if (W.active && now >= W.until) deactivate(now, true);
          // 一轮演完（无论有没有玩嗨），歇 2.5 秒再来
          if (!W.active && W.nextDemo === 1e12 && (!W.joyed || now >= W.joyUntil)) { W.joyed = false; W.nextDemo = now + 2500; }
        }
      } else if (W.holdStart > 0 && !W.active && now - W.holdStart >= HOLD_MS && !W.otherKey && S.state === STATES.AWAKE && !S.pet) {
        activate(now);
      }
      // 兜底：球在场超时（比如 keyup 没送到）自动收走
      if (W.active && now >= W.until) deactivate(now, true);

      // 打滚姿态
      if (W.joyed && now < W.joyUntil) {
        const k = (W.joyUntil - now) / 2200;
        P.eyesHappy = true;
        P.bodyRot += 14 * k * Math.sin(now / 110);
        P.bodyY += 6 * k * Math.abs(Math.sin(now / 150));
        P.tailAmp = 30; P.tailSpeed = 0.035;
        return;
      }
      if (!W.active) return;

      // 猫盯球：视线跟着球走，耳朵立起来，尾巴兴奋地甩
      const b = ballPos(now);
      P.look = { x: b.x, y: b.y };
      P.earDroop -= 6;
      P.tailAmp = 26; P.tailSpeed = 0.03;
      // demo 自动收棒
      if (demo && !Number.isFinite(demo.at) && now >= W.until) deactivate(now, true);
    }

    function render(now) {
      // 球的位置和线的形态每帧重画；收走时淡出
      let op = 0;
      if (W.active) op = 1;
      else if (W.fading && now - W.fadeAt < 260) op = 1 - (now - W.fadeAt) / 260;
      else { E.layer.style.opacity = 0; return; }
      const b = W.active ? ballPos(now) : ballPos(W.fadeAt);
      const ax = 718, ay = 26;
      const mx = (ax + b.x) / 2 + 24 * Math.sin(now * 0.004);
      E.string.setAttribute('d', `M ${ax} ${ay} Q ${mx.toFixed(1)} ${((ay + b.y) / 2).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
      E.ball.setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${(now * 0.05) % 360})`);
      E.layer.style.opacity = op;
    }

    return {
      afterKeyDown, afterKeyUp, softPawTarget, pose, render,
      debugProps: { wand: () => (W.active ? 'active' : W.joyed && performance.now() < W.joyUntil ? 'joy' : null), wandHits: () => W.hits },
    };
  }

  window.SillyWand = { create };
})();
