// 节日彩蛋：到了特定日子，猫换上应景的装扮、说应景的话——
// 万圣节桌上摆南瓜灯、圣诞节戴圣诞帽、新年放烟花爱心、情人节飘♥、
// 春节穿红色小马褂、隔几分钟天上放一簇烟花（猫抬头看）、
// 国庆周（10-01~07）身披国旗披风、生日（设置里可填 MM-DD）戴尖角生日帽，
// 生日爱心眼由设置里的开关控制（默认不启用）。
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
      hearts: false,      // 生日爱心眼开关（设置里控制，默认关）
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
    // 装扮的摆放参数按皮肤存放在 decor-fit.js（每套皮肤一套，微调改那个文件）。
    // 帽子/马褂按「原始绘制框」平移缩放（FIT_BASE 是路径当初画的位置）；
    // 披风的肩带/下摆是归一化路径（0,0 起笔，画法同围巾带），按参考框直接摆。
    const FIT_BASE = {
      'holiday-pumpkin': { x: 712, y: 424, w: 60, h: 49 }, // 中心在 742,452
      'holiday-hat':     { x: 308, y: 34,  w: 171, h: 76 },
      'holiday-coat':    { x: 352, y: 289, w: 96,  h: 95 },
      'holiday-bdayhat': { x: 330, y: 2,   w: 116, h: 106 },
    };
    // 披风：U 型肩带（和围巾带同一条归一化路径）+ 左右两片下摆，五颗星挂在肩带上按比例摆
    const CAPE_BAND_D = 'M 8 0 Q 102 42 196 0 Q 204 12 196 22 Q 102 64 8 22 Q 0 12 8 0 Z';
    const CAPE_BAND_BOX = { w: 204, h: 64 };
    const CAPE_DRAPE_D = ['M 4 0 L 0 90 Q 18 100 36 92 L 32 4 Z', 'M 32 0 L 36 90 Q 18 100 0 92 L 4 4 Z'];
    const CAPE_DRAPE_BOX = { w: 36, h: 100 };
    // 星在肩带参考框里的位置（横向比例, 纵向比例, 半径基准）：大星压胸前正中，四颗小星沿右肩拱卫
    const CAPE_STARS = [[0.50, 0.68, 14], [0.63, 0.40, 7], [0.72, 0.27, 7], [0.81, 0.22, 7], [0.90, 0.26, 7]];
    let fitCache = {}; // 各部件上次算出的 transform/d，没变就不重复写属性

    function applyFit() {
      if (!W.mode) return;
      // 披风：肩带 + 左右下摆 + 五颗星
      if (W.mode === 'national') {
        const band = fit('holidayCapeBand');
        const dl = fit('holidayCapeDrapeL');
        const dr = fit('holidayCapeDrapeR');
        if (dl) fitNorm('cape-drapel', dl, CAPE_DRAPE_BOX, CAPE_DRAPE_D[0]);
        if (dr) fitNorm('cape-draper', dr, CAPE_DRAPE_BOX, CAPE_DRAPE_D[1]);
        if (band) {
          fitNorm('cape-band', band, CAPE_BAND_BOX, CAPE_BAND_D);
          const s = band.w / CAPE_BAND_BOX.w;
          CAPE_STARS.forEach(([fx, fy, r], i) => {
            const el = document.getElementById('cape-star' + i);
            if (!el) return;
            const d = starPath(band.x + band.w * fx, band.y + band.h * fy, r * s);
            if (fitCache['star' + i] !== d) { el.setAttribute('d', d); fitCache['star' + i] = d; }
          });
        }
        return;
      }
      // 其余装扮按原始框平移缩放；南瓜是场景物件（x/y = 中心 + scale）
      const item = { halloween: 'holiday-pumpkin', christmas: 'holiday-hat', spring: 'holiday-coat', birthday: 'holiday-bdayhat' }[W.mode];
      if (!item) return;
      const el = document.getElementById(item);
      if (!el) return;
      const cfg = fit(item);
      if (!cfg) return;
      const base = FIT_BASE[item];
      let t;
      if (item === 'holiday-pumpkin') {
        const s = cfg.scale ?? 1;
        t = `translate(${(cfg.x - 742 * s).toFixed(1)} ${(cfg.y - 452 * s).toFixed(1)}) scale(${s})`;
      } else {
        const sx = cfg.w / base.w, sy = cfg.h / base.h;
        t = `translate(${(cfg.x - base.x * sx).toFixed(1)} ${(cfg.y - base.y * sy).toFixed(1)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`;
      }
      if (fitCache[item] !== t) { el.setAttribute('transform', t); fitCache[item] = t; }
    }

    function fitNorm(id, cfg, box, d) {
      const el = document.getElementById(id);
      if (!el) return;
      const t = `translate(${cfg.x} ${cfg.y}) scale(${(cfg.w / box.w).toFixed(4)} ${(cfg.h / box.h).toFixed(4)})`;
      if (fitCache[id] !== t) { el.setAttribute('d', d); el.setAttribute('transform', t); fitCache[id] = t; }
    }

    function fit(item) { return (window.SillyDecorFit && window.SillyDecorFit.get && window.SillyDecorFit.get(item)) || null; }

    function clearDecor() {
      ['#holiday-pumpkin', '#holiday-hat', '#holiday-coat', '#holiday-cape', '#holiday-bdayhat'].forEach((sel) => {
        const el = document.querySelector(sel);
        if (el) el.remove();
      });
      W.domReady = null;
    }

    // 国庆披风会盖住成长小红围巾，但盖不满垂摆，会露出一条像"围巾戴重复了"；
    // 披风出场时把小围巾暂时藏起来（用 visibility，不打架 growth.js 的 display 逻辑），节日结束自动恢复
    function setScarfHidden(hidden) {
      const el = document.getElementById('growth-scarf');
      if (el) el.style.visibility = hidden ? 'hidden' : '';
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
        // 国旗披风：U 型肩带（画法同围巾带，从脖子两侧绕出来）+ 左右两片下摆，
        // 五颗星按肩带比例摆（大星压胸前正中，四颗小星沿右肩拱卫，和国旗一致）
        $('cat-body').insertAdjacentHTML('beforeend', `
          <g id="holiday-cape">
            <path class="hca-drape" id="cape-drapel" d=""/>
            <path class="hca-drape" id="cape-draper" d=""/>
            <path class="hca-band" id="cape-band" d=""/>
            <path class="hca-star" id="cape-star0" d=""/>
            <path class="hca-star" id="cape-star1" d=""/>
            <path class="hca-star" id="cape-star2" d=""/>
            <path class="hca-star" id="cape-star3" d=""/>
            <path class="hca-star" id="cape-star4" d=""/>
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
      fitCache = {}; // 新装扮刚插上，强制下一帧重新按当前皮肤拟合
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
    function setBirthdayHearts(v) { W.hearts = !!v; }

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
        setScarfHidden(mode === 'national'); // 披风出场收起日常围巾，其他节日不冲突
      }
      if (!mode) return;
      applyFit(); // 每帧按当前皮肤拟合（内部有缓存，参数没变不写 DOM）

      // 应景台词：闲下来偶尔说一句
      const idle = S.state === STATES.AWAKE && !S.pet && !S.excited && now - S.lastInput >= IDLE_MIN;
      if (demo && now >= W.next) { say(mode, now); W.next = now + 2500; }
      else if (!demo && idle && now >= W.next) { say(mode, now); W.next = now + rand(EVERY[0], EVERY[1]); }

      // 姿态加成
      if (mode === 'birthday') {
        // 生日爱心眼：只在设置里勾了开关才启用；生日帽不受开关影响
        if (W.hearts) P.eyesHappy = true;
      } else if (mode === 'valentine') {
        P.eyesHappy = true; // 情人节照旧全程爱心眼
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
      pose, setBirthday, setBirthdayHearts,
      debugProps: { holiday: () => W.mode },
    };
  }

  window.SillyHolidays = { create };
})();
