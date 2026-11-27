// 节日/季节背景特效：底色微调（只网页版；桌面版窗口透明、露出用户桌面，只叠粒子层）
// + 粒子层（花瓣/萤光/枫叶/细雪/暖光/彩带），画在猫和键盘后面。
// 场景由 holidays.js 每帧推送（节日优先：生日彩带、春节暖红、圣诞雪夜；平时按月份走四季），
// 本模块只管渲染，同名不重播。系统开了「减弱动态效果」时不放粒子，底色保留。
// 调试：URL 加 ?bg=spring|summer|autumn|winter|festival|christmas|birthday|off 强制指定；
// 网页调试面板/客户端调试栏的「背景」组按钮也是切这个参数（__bg=xxx）。
(function () {
  'use strict';

  const SCENES = {
    spring: { kind: 'petal', density: 1.6, tint: 'linear-gradient(180deg, #fde9ef 0%, #fdf5f7 60%, var(--bg) 100%)' },
    summer: { kind: 'glow', density: 0.9, tint: 'linear-gradient(180deg, #e4f5ef 0%, #f2fbf8 60%, var(--bg) 100%)' },
    autumn: { kind: 'leaf', density: 1.2, tint: 'linear-gradient(180deg, #fbe9d6 0%, #fdf4e8 60%, var(--bg) 100%)' },
    winter: { kind: 'snow', density: 3, tint: 'linear-gradient(180deg, #e9eff7 0%, #f4f8fc 60%, var(--bg) 100%)' },
    festival: { kind: 'spark', density: 1.6, tint: 'linear-gradient(180deg, #f9e0d2 0%, #fdeedd 55%, var(--bg) 100%)' }, // 春节：暖红金调，金光上浮
    christmas: { kind: 'snow', density: 3.6, tint: 'linear-gradient(180deg, #e2ebf6 0%, #eef4fb 55%, var(--bg) 100%)' },
    birthday: { kind: 'confetti', density: 1.6, tint: null }, // 生日：底色不变，彩带庆祝
  };
  const ALIAS = { 'spring-festival': 'festival' };

  const desktop = document.documentElement.classList.contains('desktop');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // URL 强制指定（调试）：设置了就盖过 holidays 的推送，直到参数删掉
  const raw = new URLSearchParams(location.search).get('bg');
  const forced = raw ? (ALIAS[raw] || raw) : null;
  const forceValid = forced && (forced === 'off' || SCENES[forced]);

  const fx = document.createElement('div');
  fx.id = 'bg-fx';
  const tint = document.createElement('div');
  tint.className = 'bg-tint';
  if (!desktop) fx.appendChild(tint); // 桌面透明窗口不染底色
  const layer = document.createElement('div');
  layer.className = 'bg-particles';
  fx.appendChild(layer);
  document.body.appendChild(fx); // CSS 里 z-index 压在 .hint/#stage 之下

  let current = null;
  let timer = 0;
  // 用户开关（设置页「背景特效」五个勾）：四季各一个 + 节日一组共用一个。
  // 缺省全开；设置广播来的时候整表更新。调试 URL ?bg= 不受开关限制。
  const enabled = { spring: true, summer: true, autumn: true, winter: true, festival: true };
  const GROUP = { spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter', festival: 'festival', christmas: 'festival', birthday: 'festival' };
  // 粒子密度上限（设置页滑块 0–100%，100 = 原始满密度）。原来每秒只加不减，
  // 粒子越积越多、最后满屏都是——现在有硬上限，满了挤掉最老的。
  let densityPct = 100;

  function stop() {
    if (timer) { clearInterval(timer); timer = 0; }
    layer.textContent = '';
  }
  function start(kind, density) {
    stop();
    if (reduced || densityPct <= 0) return; // 减弱动态 / 密度 0：不放粒子
    const cap = Math.round(density * 16 * densityPct / 100);
    const spawn = () => {
      // 上限之内才放：满了挤掉最老的一颗（新的一颗带着新的随机延迟补上）
      if (layer.childElementCount >= cap) layer.firstElementChild?.remove();
      const el = document.createElement('div');
      const dur = 6 + Math.random() * 6;
      el.className = 'bgp ' + kind + (Math.random() < 0.4 ? ' b' : ''); // CSS 是 .bgp.snow 这类双类选择器，kind 不带前缀
      if (kind === 'confetti') el.classList.add('c' + Math.floor(Math.random() * 5));
      el.style.left = (Math.random() * 100) + '%';
      // 负延迟预铺：开场就是满天飞的状态，不用等第一批落完
      el.style.animation = (kind === 'spark' ? 'bg-rise-spark' : 'bg-fall-' + kind) + ' ' + dur.toFixed(1) + 's linear ' + (-Math.random() * dur).toFixed(1) + 's infinite';
      layer.appendChild(el);
    };
    for (let i = 0; i < cap; i++) spawn();
    timer = setInterval(spawn, 1000 / density);
  }

  window.SillyBgFx = {
    // holidays.js 每帧推：'spring'|'summer'|'autumn'|'winter'|'festival'|'christmas'|'birthday'
    setScene(name) {
      if (forceValid) name = forced === 'off' ? null : forced; // 调试参数优先
      if (name && !enabled[GROUP[name]]) name = null; // 用户关掉的季节/节日不放
      if (name === current) return;
      current = name;
      const scene = name && SCENES[name];
      tint.style.background = (scene && scene.tint) || '';
      if (!scene) { stop(); return; }
      start(scene.kind, scene.density);
    },
    // 设置页「背景特效」五个开关（settings.bgFx），主窗口 applySettings 每次广播
    setEnabled(map) {
      if (!map || typeof map !== 'object') return;
      for (const k of Object.keys(enabled)) if (typeof map[k] === 'boolean') enabled[k] = map[k];
      if (current && !enabled[GROUP[current]]) this.setScene(null); // 正在放的关掉了，立刻收
    },
    // 设置页「特效密度」滑块（settings.bgDensity 0–100）；0 = 完全不放，改完立刻生效
    setDensity(pct) {
      const v = Math.max(0, Math.min(100, Math.round(+pct || 0)));
      if (v === densityPct) return;
      densityPct = v;
      const scene = current && SCENES[current];
      if (scene) start(scene.kind, scene.density); // 按新上限重铺一遍
    },
  };
})();
