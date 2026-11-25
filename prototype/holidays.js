// 节日彩蛋：到了特定日子，猫换上应景的装扮、说应景的话——
// 万圣节桌上摆南瓜灯、圣诞节戴圣诞帽、新年放烟花爱心、情人节飘♥、
// 春节围红围巾讨红包、生日（设置里可填 MM-DD）全程爱心眼。
// 调试：?demo=halloween|christmas|newyear|valentine|spring|birthday 直接看某一节的装扮
(function () {
  'use strict';

  const EVERY = [30000, 60000]; // 应景台词之间的间隔
  const IDLE_MIN = 8000;

  // 固定公历节日（MM-DD → 模式）
  const FIXED = {
    '10-31': 'halloween',
    '12-24': 'christmas', '12-25': 'christmas',
    '01-01': 'newyear',
    '02-14': 'valentine',
  };
  // 春节是农历，按年份硬编码近几年的公历日期（YYYY-MM-DD → spring）
  const SPRING = { '2026-02-17': 1, '2027-02-06': 1, '2028-01-26': 1, '2029-02-13': 1 };

  const LINES = {
    halloween: ['不给小鱼干就捣蛋！', '今晚我是南瓜猫'],
    christmas: ['喵诞快乐！', '袜子挂在键盘上了'],
    newyear: ['新年快乐！', '新的一年也要多摸鱼'],
    valentine: ['♥', '铲屎的，我的心里只有你'],
    spring: ['新年快乐！红包呢？', '年夜饭有小鱼干吗'],
    birthday: ['今天是本喵生日！', '蛋糕呢？要小鱼干味的'],
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const $ = (id) => document.getElementById(id);

  function create(ctx, opts = {}) {
    const { S, STATES } = ctx;
    const demo = opts.demo && LINES[opts.demo.name] ? opts.demo.name : null;
    const W = {
      birthday: '',
      next: performance.now() + (demo ? 900 : rand(EVERY[0], EVERY[1])),
      mode: null,
      domReady: null,   // 记住已经给哪种模式插过 DOM，切模式时撤掉旧的
    };

    // ---------- 各节日的装扮 DOM ----------
    function clearDecor() {
      ['#holiday-pumpkin', '#holiday-hat', '#holiday-scarf'].forEach((sel) => {
        const el = document.querySelector(sel);
        if (el) el.remove();
      });
      W.domReady = null;
    }
    function buildDecor(mode) {
      if (W.domReady === mode) return;
      clearDecor();
      if (mode === 'halloween') {
        // 南瓜灯：放在杯子右边的桌角
        $('fx-layer').insertAdjacentHTML('beforebegin', `
          <g id="holiday-pumpkin">
            <ellipse class="hp-body" cx="742" cy="452" rx="26" ry="21"/>
            <path class="hp-rib" d="M 742 431 Q 736 452 742 473 M 742 431 Q 748 452 742 473" fill="none"/>
            <rect class="hp-stem" x="738" y="424" width="8" height="10" rx="3"/>
            <path class="hp-face" d="M 730 450 L 736 456 L 742 450 L 748 456 L 754 450 M 732 461 L 737 464 L 732 467 M 752 461 L 747 464 L 752 467 M 739 464 L 742 469 L 745 464" fill="none"/>
          </g>`);
      } else if (mode === 'christmas') {
        // 圣诞帽：挂在头部组里跟着头动
        $('cat-head').insertAdjacentHTML('beforeend', `
          <g id="holiday-hat">
            <path class="hh-cone" d="M 322 96 Q 330 34 418 44 Q 452 48 470 72 Q 448 66 424 76 Q 430 88 424 98 Z"/>
            <circle class="hh-pompom" cx="470" cy="72" r="9"/>
            <rect class="hh-brim" x="308" y="88" width="122" height="22" rx="11"/>
          </g>`);
      } else if (mode === 'spring') {
        // 红围巾：挂在身体组里跟着身子动
        $('cat-body').insertAdjacentHTML('beforeend', `
          <g id="holiday-scarf">
            <path class="hs-band" d="M 340 292 Q 400 316 462 292 Q 468 306 462 314 Q 400 338 340 314 Q 334 306 340 292 Z"/>
            <path class="hs-tail" d="M 448 308 L 470 344 L 454 346 L 446 322 Z"/>
          </g>`);
      }
      W.domReady = mode;
    }

    // 今天是哪个节日（demo 优先；生日也可覆盖固定节日——自己的日子最大）
    function todayMode() {
      if (demo) return demo;
      const d = new Date();
      const y = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      if (W.birthday && W.birthday !== '0-0') {
        const [bm, bd] = W.birthday.split('-').map((v) => String(Number(v)));
        if (bm === String(Number(mm)) && bd === String(Number(dd))) return 'birthday';
      }
      if (SPRING[`${y}-${mm}-${dd}`]) return 'spring';
      return FIXED[`${mm}-${dd}`] || null;
    }

    function setBirthday(v) { W.birthday = typeof v === 'string' ? v : ''; }

    function say(mode, now) {
      const line = pick(LINES[mode]);
      if (mode === 'valentine' || mode === 'newyear') {
        ctx.fx.spawn(line, 400 + rand(-30, 30), 104, 'hot', performance.now());
        if (mode === 'valentine') ctx.fx.spawn('♥', 470 + rand(-24, 24), 140, 'hot', performance.now());
        else ctx.fx.spawn('✦', 340 + rand(-24, 24), 150, 'hot', performance.now());
      } else {
        ctx.fx.spawn(line, 400 + rand(-36, 36), 100, '', performance.now());
      }
      if (window.SillySounds) window.SillySounds.play('meow');
    }

    function pose(now, dt, rm, P) {
      const mode = todayMode();
      // 模式变化时换装
      if (mode !== W.mode) {
        W.mode = mode;
        if (mode) buildDecor(mode); else clearDecor();
      }
      if (!mode) return;

      // 应景台词：闲下来偶尔说一句
      const idle = S.state === STATES.AWAKE && !S.pet && !S.excited && now - S.lastInput >= IDLE_MIN;
      if (demo && now >= W.next) { say(mode, now); W.next = now + 2500; }
      else if (!demo && idle && now >= W.next) { say(mode, now); W.next = now + rand(EVERY[0], EVERY[1]); }

      // 姿态加成
      if (mode === 'birthday' || mode === 'valentine') {
        if (idle || demo) P.eyesHappy = true;
      } else if (mode === 'christmas' || mode === 'spring') {
        P.earDroop -= 2; // 戴帽子/围巾，精神一点
      } else if (mode === 'halloween') {
        P.look = { x: 742, y: 440 }; // 偷瞄自己的南瓜灯
      }
    }

    return {
      pose, setBirthday,
      debugProps: { holiday: () => W.mode },
    };
  }

  window.SillyHolidays = { create };
})();
