// 小奶猫串门：你发呆一阵后（12 秒没键鼠），一只毛色随机的小奶猫从画面左边
// 走进来，跳上键盘走到中间趴下打个盹；打盹时长随机 6–18 秒（你越久没动
// 电脑它睡得越安稳，一打字它就会被吓跑），然后起身从画面右边走出去。
// 四条腿对角步态、走路身体一颠一颠、尾巴摆动、偶尔眨眼，趴下时带呼吸起伏。
// 小猫趴着时你一打字会吓到它：随机被大猫一巴掌拍飞出画面（肉掌扬起来拍
// 下去），或者它自己爬起来慌忙走掉。大猫全程盯着它看，小猫趴下时大猫
// 打一会儿呼噜。冷却 30–60 分钟，一次一只。
// 调试：?demo=visitor&loop=1（自动循环演出）或 &at=毫秒 冻结在时间轴某刻
(function () {
  'use strict';

  const Y_DESK = 556;   // 桌面地面（脚底）
  const Y_KEYS = 512;   // 键帽顶面（脚底）
  const PH_MS = 300;    // 一步的周期（一个完整步态循环 = 两拍）
  const SCALE = 1.25;   // 整体放大倍率（小奶猫要看得清）
  const LIE_MIN = 6;    // 打盹最短秒数
  const LIE_MAX = 18;   // 打盹最长秒数（没人动电脑就让它多睡会儿）
  const AFF_BUDDY = 120;    // 好感度到「死忠」之后，小奶猫偶尔肯留下来当跟班
  const BUDDY_CHANCE = 0.5; // 每次串门有多大概率留下（一半一半）
  const BUDDY_LIE_MIN = 60; // 跟班打盹最短秒数（赖着不走，睡个够）
  const BUDDY_LIE_MAX = 150;

  // 时间轴：走进来 → 跳上键盘 → 走到中间 → 趴下打盹（时长每次随机）→ 起身 → 走到右边 → 跳下 → 走出画面
  const SEG = [
    { name: 'walk1',   t: 2600, x0: -80, x1: 170, y: Y_DESK },
    { name: 'step1',   t: 500, x0: 170, x1: 230, y0: Y_DESK, y1: Y_KEYS, leap: true },
    { name: 'walk2',   t: 1200, x0: 230, x1: 400, y: Y_KEYS },
    { name: 'lie',     t: 6300, x: 400, y: Y_KEYS },
    { name: 'stand',   t: 400, x: 400, y: Y_KEYS },
    { name: 'walk3',   t: 1200, x0: 400, x1: 570, y: Y_KEYS },
    { name: 'step2',   t: 500, x0: 570, x1: 630, y0: Y_KEYS, y1: Y_DESK, leap: true },
    { name: 'walk4',   t: 2500, x0: 630, x1: 880, y: Y_DESK },
  ];
  // 重新累计各段的起始时刻（趴下段改成随机时长后要重算后面的段）
  function rebuildTimeline() {
    let total = 0, walkClock = 0;
    for (const s of SEG) {
      s.start = total;
      total += s.t;
      s.walkBefore = walkClock;
      if (s.x0 !== undefined) walkClock += s.t; // 走路/跳跃才累积步态时间，停留段不算
    }
  }
  rebuildTimeline();
  const segOf = (name) => SEG.find((s) => s.name === name);

  const COAT = [               // 小奶猫毛色：橘 / 灰 / 黑
    { fur: '#e8a25b', line: '#5c3a1e' },
    { fur: '#9aa0a6', line: '#3d4045' },
    { fur: '#3a3a3a', line: '#111' },
  ];

  function create(ctx, opts = {}) {
    const { S, STATES, fx, clamp } = ctx;
    const demo = opts.demo && opts.demo.name === 'visitor' ? opts.demo : null;
    const V = { phase: null, start: -1e9, next: 20e3, coat: 0, purrTimer: null, flags: {}, tNow: 0 };

    const rand = (a, b) => a + Math.random() * (b - a);
    const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

    // 局部坐标原点 = 脚底中心，前进方向 +x。腿旋转中心在髋部（y=-22）
    document.getElementById('fx-layer').insertAdjacentHTML('beforebegin', `
      <g id="visitor-layer" style="display:none">
        <ellipse id="visitor-shadow" class="visitor-shadow" rx="38" ry="6"/>
        <g id="visitor-root">
          <path id="visitor-tail" class="visitor-tail" d=""/>
          <rect id="visitor-leg-br" class="visitor-leg" x="-14.5" y="-22" width="9" height="22" rx="4.5"/>
          <rect id="visitor-leg-bl" class="visitor-leg" x="-26.5" y="-22" width="9" height="22" rx="4.5"/>
          <path id="visitor-body" class="visitor-body" d="M -34 -14 Q -41 -30 -27 -46 Q -9 -60 10 -58 Q 31 -56 37 -40 Q 43 -26 34 -14 Q 16 -8 0 -8 Q -17 -8 -34 -14 Z"/>
          <g id="visitor-upper">
            <g id="visitor-head">
              <path class="visitor-ear" d="M -17 -9 L -21 -29 L -3 -18 Z"/>
              <path class="visitor-ear" d="M 17 -9 L 21 -29 L 3 -18 Z"/>
              <circle class="visitor-head" cx="0" cy="0" r="19"/>
              <g id="visitor-eyes-open">
                <circle class="visitor-eye-dot" cx="-8" cy="-2" r="2.6"/>
                <circle class="visitor-eye-dot" cx="8" cy="-2" r="2.6"/>
              </g>
              <g id="visitor-eyes-closed" style="display:none">
                <path class="visitor-eye" d="M -11 -2 Q -8 1 -5 -2"/>
                <path class="visitor-eye" d="M 5 -2 Q 8 1 11 -2"/>
              </g>
              <path class="visitor-nose" d="M -2.5 4 L 2.5 4 L 0 7 Z"/>
            </g>
          </g>
          <rect id="visitor-leg-fr" class="visitor-leg" x="5.5" y="-22" width="9" height="22" rx="4.5"/>
          <rect id="visitor-leg-fl" class="visitor-leg" x="17.5" y="-22" width="9" height="22" rx="4.5"/>
        </g>
      </g>`);
    const E = {
      layer: document.getElementById('visitor-layer'),
      root: document.getElementById('visitor-root'),
      upper: document.getElementById('visitor-upper'),
      head: document.getElementById('visitor-head'),
      body: document.getElementById('visitor-body'),
      tail: document.getElementById('visitor-tail'),
      shadow: document.getElementById('visitor-shadow'),
      legs: {
        fl: document.getElementById('visitor-leg-fl'), fr: document.getElementById('visitor-leg-fr'),
        bl: document.getElementById('visitor-leg-bl'), br: document.getElementById('visitor-leg-br'),
      },
      eyesOpen: document.getElementById('visitor-eyes-open'),
      eyesClosed: document.getElementById('visitor-eyes-closed'),
    };
    // 髋部位置（x）：腿绕这点旋转
    const HIP = { fl: 22, fr: 10, bl: -22, br: -10 };

    function coatEls() {
      const els = [E.head.querySelector('.visitor-head'), ...E.head.querySelectorAll('.visitor-ear'), E.body, ...Object.values(E.legs)];
      els.forEach((el) => { el.style.fill = COAT[V.coat].fur; el.style.stroke = COAT[V.coat].line; });
      E.tail.style.stroke = COAT[V.coat].line;
    }

    function startVisit(now) {
      V.phase = 'play'; V.start = now; V.flags = {};
      V.coat = Math.floor(Math.random() * COAT.length);
      coatEls();
      // 趴下打盹的时长每次随机：没人动电脑就让它睡得久一点
      segOf('lie').t = rand(LIE_MIN, LIE_MAX) * 1000;
      // 死忠粉（好感 120+）面前它才敢撒欢：偶尔这一趟留下来当跟班——睡个够，打字也不跑
      V.buddy = !!demo.buddy || (!demo && !!window.SillyAffection
        && window.SillyAffection.get().v >= AFF_BUDDY && Math.random() < BUDDY_CHANCE);
      if (V.buddy) segOf('lie').t = rand(BUDDY_LIE_MIN, BUDDY_LIE_MAX) * 1000;
      V.lookUntil = -1e9;
      rebuildTimeline();
      E.layer.style.display = '';
    }
    function stopPurr() {
      if (V.purrTimer) { clearTimeout(V.purrTimer); V.purrTimer = null; }
      if (window.SillySounds) window.SillySounds.stopPurr();
    }
    function endVisit(now) {
      V.phase = null;
      E.layer.style.display = 'none';
      V.next = now + rand(30, 60) * 60000;
      stopPurr();
    }
    // 被打字吓到的两种结局（随机二选一）：
    // 拍飞——接管大猫两只爪中随机一只（forcedPawTarget）：先扬起来，再拍到小猫身上，
    //       然后松手让爪子自己回到打字位；小奶猫转圈飞出画面右边
    // 吓跑——自己起身，从键盘上下来往右边走掉
    const FLEE = { freeze: 300, slap: 430, fly: 740, end: 1300 };
    function scareOff(now) {
      V.phase = 'flee';
      V.start = now;
      V.flags.lie = false;
      V.slapPaw = Math.random() < 0.5 ? 'L' : 'R';
      stopPurr();
    }
    // 拍飞期间接管大猫那只爪：扬起 → 拍下 → 松手归位
    function forcedPawTarget(paw, now) {
      if (V.phase !== 'flee' || !V.slapPaw || paw.side !== V.slapPaw) return null;
      const t = now - V.start;
      if (t < FLEE.freeze) return { id: 'slap-up', x: 400 + (paw.side === 'L' ? 40 : -40), y: 310, tau: 90 };
      if (t < FLEE.slap) return { id: 'slap-down', x: 400, y: 485, tau: 45 };
      return null; // 拍完松手，爪子自己回到原来的位置
    }
    function runOff(now) {
      V.start = now - segOf('stand').start; // 从起身段开始播，趴着先爬起来再走
      V.flags.lie = false;
      stopPurr();
      fx.spawn('喵！？', 400, 250, '', now);
    }

    function afterState(now) {
      if (demo || V.phase) return;
      if (S.state !== STATES.AWAKE || S.pet) return;
      if (now < V.next) return;
      const idle = (now - (S.lastKeyAt || 0) > 12000) && (now - (S.lastInputAt || 0) > 12000);
      if (idle) startVisit(now);
    }

    // 小猫上了键盘之后（趴着 / 正要起身），一打字就吓到：随机被拍飞或自己跑掉。
    // 当了跟班就不怕了：抬头看你一眼，接着睡。
    function afterKeyDown(code, now) {
      if (demo || !V.phase) return;
      const t = now - V.start;
      if (t >= segOf('lie').start && t < segOf('walk3').start) {
        if (V.buddy) {
          V.lookUntil = now + 1500;
          if (Math.random() < 0.25) fx.spawn('喵～', 440, 455, '', now);
          return;
        }
        (Math.random() < 0.5 ? scareOff : runOff)(now);
      }
    }

    // 按时间轴算出此刻小猫该怎么摆：x / 地面高度 / 段名 / 步态相位 / 段内进度
    function layout(t) {
      for (const s of SEG) {
        if (t < s.start + s.t) {
          const p = clamp((t - s.start) / s.t, 0, 1);
          if (s.x0 === undefined) return { seg: s, x: s.x, gy: s.y, p };
          const e = ease(p);
          return {
            seg: s,
            x: s.x0 + (s.x1 - s.x0) * e,
            gy: s.y0 !== undefined ? s.y0 + (s.y1 - s.y0) * e : s.y,
            ph: ((s.walkBefore + (t - s.start)) / PH_MS) * Math.PI * 2,
            p,
          };
        }
      }
      return null; // 演出结束
    }

    // 拍飞阶段：大猫的爪扬起拍下（forcedPawTarget 接管），小奶猫僵住、被拍中 → 抛物线转圈飞出画面右边
    function poseFlee(now, P) {
      const t = now - V.start;
      V.tNow = t;
      let x = 400, y = Y_KEYS, rot = 0;
      // 小奶猫：先吓得一缩，被拍中后飞出去
      if (t < FLEE.slap) {
        x -= Math.sin(clamp(t / FLEE.slap, 0, 1) * Math.PI) * 6;
      } else {
        const fp = clamp((t - FLEE.slap) / FLEE.fly, 0, 1);
        x = 400 + 560 * fp;
        y = Y_KEYS - Math.sin(fp * Math.PI) * 300 + 60 * fp * fp;
        rot = 720 * fp;
        if (!V.flags.oww) {
          V.flags.oww = true;
          fx.spawn('啪！！', 420, 430, 'angry', now);
          fx.spawn('喵嗷——！', 580, 350, 'angry', now);
          if (window.SillySounds) window.SillySounds.play('meow');
        }
      }
      E.root.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${SCALE}) rotate(${rot.toFixed(0)} 0 -30)`);
      // 挨拍时四脚乱蹬、眼睛圆睁、尾巴竖起；影子留在地面跟着走
      for (const k of Object.keys(E.legs)) E.legs[k].setAttribute('transform', `rotate(${k[0] === 'f' ? -30 : 30} ${HIP[k]} -22)`);
      E.body.setAttribute('transform', 'scale(1 1)');
      E.head.setAttribute('transform', 'translate(30 -62)');
      E.upper.setAttribute('transform', 'translate(0 0)');
      E.eyesOpen.style.display = '';
      E.eyesClosed.style.display = 'none';
      E.tail.setAttribute('d', 'M -34 -36 Q -50 -52 -44 -68');
      E.shadow.setAttribute('cx', x.toFixed(1));
      E.shadow.setAttribute('cy', (Y_KEYS + 5).toFixed(1));
      if (t >= FLEE.end) { endVisit(now); return; }
      // 大猫目送它飞出去
      P.look = { x, y: y - 30 };
      P.earDroop -= 3;
      S.lastInput = now;
    }

    function pose(now, dt, rm, P) {
      if (demo) {
        if (Number.isFinite(demo.at)) {
          // 冻结协议：每帧把时间轴重新锚定在 demo.at（和其他模块一致）
          if (!V.frozenInit) {
            V.frozenInit = true; V.coat = 0; coatEls(); V.phase = 'play';
            // &buddy=1：演示跟班局，趴下段拉长到 150 秒，冻结时刻能稳定落在打盹里
            if (demo.buddy) { V.buddy = true; segOf('lie').t = 150000; rebuildTimeline(); }
            E.layer.style.display = '';
          }
          V.start = now - demo.at;
        } else if (!V.phase) {
          startVisit(now); // 循环演出：上一轮结束立刻重来
        }
      }
      if (!V.phase) return;
      if (V.phase === 'flee') { poseFlee(now, P); return; }
      const t = now - V.start;
      V.tNow = t;
      const L = layout(t);
      if (!L) { endVisit(now); return; }

      const { seg, x, gy, ph, p } = L;
      // demo 循环模式：趴下一会儿后自动吓到，拍飞/跑掉轮流演示
      if (demo && !Number.isFinite(demo.at) && seg.name === 'lie' && t > seg.start + 800) {
        (V.demoCount = (V.demoCount || 0) + 1) % 2 ? scareOff(now) : runOff(now);
        return;
      }
      const lieK = seg.name === 'lie' ? 1 : seg.name === 'stand' ? 1 - ease(p) : 0; // 1 = 完全趴下

      // 到位的小剧场：跳上键盘时打招呼，趴下时大猫打呼噜
      if (seg.name === 'step1' && !V.flags.greet) {
        V.flags.greet = true;
        fx.spawn('喵呜~ 小家伙', 430, 240, '', now);
      }
      if (seg.name === 'lie' && !V.flags.lie) {
        V.flags.lie = true;
        fx.spawn('呼噜呼噜…', 400, 250, '', now);
        if (window.SillySounds) {
          window.SillySounds.startPurr();
          V.purrTimer = setTimeout(stopPurr, Math.max(0, seg.start + seg.t - t) | 0);
        }
      }

      // 走路：身体上下颠（对角两步各颠一拍）；跳跃：额外一个抛物线小弧
      const bob = ph !== undefined && !seg.leap ? Math.abs(Math.sin(ph)) * 2.2 : 0;
      const hop = seg.leap ? -Math.sin(p * Math.PI) * 8 : 0;
      E.root.setAttribute('transform', `translate(${x.toFixed(1)} ${(gy + hop).toFixed(1)}) scale(${SCALE})`);
      E.upper.setAttribute('transform', `translate(0 ${(-bob).toFixed(2)})`);

      // 腿：对角步态（左前+右后一组，右前+左后一组）；跳跃前伸后蹬；趴下收起来
      const a1 = Math.sin(ph || 0) * 22, a2 = Math.sin((ph || 0) + Math.PI) * 22;
      const ang = {
        fl: seg.leap ? -24 : a1,
        fr: seg.leap ? -24 : a2,
        bl: seg.leap ? 24 : a2,
        br: seg.leap ? 24 : a1,
      };
      for (const k of Object.keys(E.legs)) {
        E.legs[k].style.opacity = 1 - lieK;
        E.legs[k].setAttribute('transform', `rotate(${ang[k].toFixed(1)} ${HIP[k]} -22)`);
      }

      // 身体：趴下时压扁 + 轻微呼吸起伏
      const breath = lieK > 0.9 ? Math.sin(now / 420) * 0.025 : 0;
      E.body.setAttribute('transform', `scale(1 ${(1 - 0.38 * lieK + breath).toFixed(3)})`);

      // 头：趴下时贴低（跟班被敲键盘吵到会抬头看你一眼）；眼睛：趴下闭眼，平时偶尔眨眼
      const looking = V.buddy && seg.name === 'lie' && now < V.lookUntil;
      E.head.setAttribute('transform', `translate(30 ${(-62 + 34 * lieK - (looking ? 6 : 0)).toFixed(1)})`);
      const blink = lieK < 0.3 && (t % 2400) < 130;
      E.eyesOpen.style.display = blink || (lieK > 0.5 && !looking) ? 'none' : '';
      E.eyesClosed.style.display = blink || (lieK > 0.5 && !looking) ? '' : 'none';

      // 尾巴：走路翘着左右摆，趴下时顺着身后斜垂到地面（带呼吸轻轻晃）
      const walkTail = 35 + Math.sin((ph || 0) * 0.5 + 1) * 8;
      const tailAng = walkTail * (1 - lieK) + (-55 + Math.sin(now / 420) * 2.5) * lieK;
      const rad = tailAng * Math.PI / 180, tl = 30 + 12 * lieK; // 趴下时尾巴变长才够到地面
      const ex = -34 - tl * Math.cos(rad), ey = -36 - tl * Math.sin(rad);
      const mx = -34 - tl * 0.55 * Math.cos(rad), my = -36 - tl * 0.55 * Math.sin(rad) - 4;
      E.tail.setAttribute('d', `M -34 -36 Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);

      // 影子垫在脚下（趴下时略摊大）
      E.shadow.setAttribute('cx', x.toFixed(1));
      E.shadow.setAttribute('cy', (gy + 5).toFixed(1));
      E.shadow.setAttribute('rx', ((38 + 6 * lieK) * SCALE).toFixed(1));

      // 大猫的反应：盯着小家伙看，耳朵放松；做客期间算「有事发生」别让它睡着
      P.look = { x, y: gy - 30 };
      P.earDroop -= 3;
      S.lastInput = now;
    }

    return {
      afterState, afterKeyDown, forcedPawTarget, pose,
      debugProps: { visitor: () => (V.phase ? V.phase + '@' + Math.round(V.tNow) : null), buddy: () => !!V.buddy },
    };
  }

  window.SillyVisitor = { create };
})();
