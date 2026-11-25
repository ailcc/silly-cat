// 节日彩蛋：到了特定日子，猫换上应景的装扮、说应景的话——
// 万圣节桌上摆南瓜灯、圣诞节戴圣诞帽、新年放烟花爱心、情人节飘♥、
// 春节穿红色小马褂、隔几分钟天上放一簇烟花（猫抬头看）、
// 国庆周（10-01~07）身披国旗披风、生日（设置里可填 MM-DD）戴尖角生日帽全程爱心眼。
// 调试：?demo=halloween|christmas|newyear|valentine|spring|national|birthday 直接看某一节的装扮
(function () {
  'use strict';

  const EVERY = [30000, 60000]; // 应景台词之间的间隔
  const FW_EVERY = [180000, 360000]; // 春节烟花间隔：3–6 分钟
  const IDLE_MIN = 8000;

  // 固定公历节日（MM-DD → 模式）
  const FIXED = {
    '10-31': 'halloween',
    '12-24': 'christmas', '12-25': 'christmas',
    '01-01': 'newyear',
    '02-14': 'valentine',
    '10-01': 'national', '10-02': 'national', '10-03': 'national', '10-04': 'national',
    '10-05': 'national', '10-06': 'national', '10-07': 'national',
  };
  // 春节是农历，按年份硬编码近几年的公历日期（YYYY-MM-DD → spring）
  const SPRING = { '2026-02-17': 1, '2027-02-06': 1, '2028-01-26': 1, '2029-02-13': 1 };

  const LINES = {
    halloween: ['不给小鱼干就捣蛋！', '今晚我是南瓜猫'],
    christmas: ['喵诞快乐！', '袜子挂在键盘上了'],
    newyear: ['新年快乐！', '新的一年也要多摸鱼'],
    valentine: ['♥', '铲屎的，我的心里只有你'],
    spring: ['新年快乐！红包呢？', '年夜饭有小鱼干吗'],
    national: ['祖国生日快乐！', '红旗飘飘，小鱼干飘香'],
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
      nextFw: 0,          // 下一簇烟花的时刻
      fwLook: null,       // 刚放烟花时猫抬头看的位置
      mode: null,
      domReady: null,   // 记住已经给哪种模式插过 DOM，切模式时撤掉旧的
    };

    // 五角星路径（国旗上的黄星用）
    function starPath(cx, cy, r, rot = -90) {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? r * 0.42 : r;
        const a = ((rot + i * 36) * Math.PI) / 180;
        pts.push((cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1));
      }
      return 'M ' + pts.join(' L ') + ' Z';
    }

    // ---------- 各节日的装扮 DOM ----------
    function clearDecor() {
      ['#holiday-pumpkin', '#holiday-hat', '#holiday-coat', '#holiday-cape', '#holiday-bdayhat'].forEach((sel) => {
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
        // 红色小马褂：前身一块红布 + 深色领口 + 三颗盘扣，挂在身体组里跟着身子动
        $('cat-body').insertAdjacentHTML('beforeend', `
          <g id="holiday-coat">
            <path class="hco-panel" d="M 358 302 Q 400 292 442 302 L 448 372 Q 400 384 352 372 Z"/>
            <path class="hco-collar" d="M 358 302 Q 400 318 442 302 Q 436 291 424 289 Q 400 300 376 289 Q 364 291 358 302 Z"/>
            <circle class="hco-knot" cx="400" cy="326" r="4.5"/>
            <circle class="hco-knot" cx="400" cy="348" r="4.5"/>
            <circle class="hco-knot" cx="400" cy="370" r="4.5"/>
          </g>`);
      } else if (mode === 'national') {
        // 国旗披风：红披风搭在肩上、两边垂下来，左襟一颗大黄星、右襟四颗小星拱卫
        $('cat-body').insertAdjacentHTML('beforeend', `
          <g id="holiday-cape">
            <path class="hca-band" d="M 322 296 Q 400 274 478 296 Q 486 308 478 318 Q 400 296 322 318 Q 314 308 322 296 Z"/>
            <path class="hca-drape" d="M 322 306 L 318 396 Q 336 406 354 398 L 350 310 Z"/>
            <path class="hca-drape" d="M 444 306 L 448 396 Q 430 406 412 398 L 416 310 Z"/>
            <path class="hca-star" d="${starPath(400, 304, 14)}"/>
            <path class="hca-star" d="${starPath(424, 292, 7)}"/>
            <path class="hca-star" d="${starPath(438, 304, 7)}"/>
            <path class="hca-star" d="${starPath(438, 320, 7)}"/>
            <path class="hca-star" d="${starPath(424, 330, 7)}"/>
          </g>`);
      } else if (mode === 'birthday') {
        // 尖角生日帽：条纹圆锥 + 顶上一个小球，歪戴着，挂在头部组里跟着头动
        $('cat-head').insertAdjacentHTML('beforeend', `
          <g id="holiday-bdayhat">
            <path class="hbd-cone" d="M 330 100 Q 360 48 400 10 Q 436 46 446 92 Q 390 108 330 100 Z"/>
            <path class="hbd-stripe" d="M 344 74 Q 388 54 434 66" fill="none"/>
            <path class="hbd-stripe" d="M 334 92 Q 388 74 442 84" fill="none"/>
            <circle class="hbd-pom" cx="400" cy="10" r="8"/>
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

    // 一簇烟花：天上随机一点炸开 8 颗彩星（fx 粒子），「嘭！」一声，猫抬头看
    function firework(now) {
      const cx = rand(240, 560), cy = rand(70, 170);
      W.fwLook = { x: cx, y: cy, until: now + 1200 };
      const glyphs = ['✦', '✧', '＊'];
      ctx.fx.spawn('嘭！', cx, cy - 48, 'hot', performance.now());
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + rand(-0.2, 0.2);
        const r = rand(16, 44);
        setTimeout(() => ctx.fx.spawn(pick(glyphs), cx + Math.cos(a) * r, cy + Math.sin(a) * r, 'hot', performance.now()), i * 45);
      }
    }

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
      } else if (mode === 'christmas' || mode === 'spring' || mode === 'national') {
        P.earDroop -= 2; // 戴帽子/马褂/披风，精神一点
      } else if (mode === 'halloween') {
        P.look = { x: 742, y: 440 }; // 偷瞄自己的南瓜灯
      }

      // 春节烟花：隔几分钟放一簇，放完的 1.2 秒里猫抬头看
      if (mode === 'spring' && (idle || demo) && now >= W.nextFw) {
        firework(now);
        W.nextFw = now + (demo ? 2600 : rand(FW_EVERY[0], FW_EVERY[1]));
      }
      if (W.fwLook && now < W.fwLook.until) P.look = { x: W.fwLook.x, y: W.fwLook.y };
    }

    return {
      pose, setBirthday,
      debugProps: { holiday: () => W.mode },
    };
  }

  window.SillyHolidays = { create };
})();
