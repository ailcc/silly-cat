// 网页版调试面板：只在浏览器里出现（桌面客户端 Tauri / Electron 不启用，直接返回）。
// 用法：先在下拉框选皮肤（立即生效，并记进 localStorage，刷新自动恢复），
// 再点状态按钮 → 页面跳到 ?cat=皮肤&demo=状态&loop=1，刷新后仍是这个状态，
// 直到点别的状态或「恢复正常」。按钮复用各模块已有的 ?demo= 调试钩子。
(function () {
  'use strict';
  // 桌面客户端不出现：Tauri 注入 __TAURI__，Electron 的 UA 带 Electron
  if (window.__TAURI__ || /Electron/i.test(navigator.userAgent || '')) return;

  // 分组状态表：[组名, [[按钮文字, demo 名], ...]]（demo 名与各模块的 ?demo= 调试钩子一致）
  const GROUPS = [
    ['睡眠与听歌', [
      ['趴着睡觉', 'slumped'],
      ['趴下入睡', 'slump-in'],
      ['说梦话', 'slumped'], // 真睡着才说梦话（和趴睡同一状态，梦里 0.8 秒后开始冒梦话）
      ['流口水', 'drool'],
      ['刚醒压痕', 'wake-marks'],
      ['听歌戴耳机', 'listen'], // 听 8 秒后自动睡着
      ['听歌睡着', 'listen&doze=1'], // 戴着耳机直接睡着（&doze=1 跳过 8 秒等待）
      ['踩奶', 'knead&at=800'], // knead 演示必须带 at 才会进入踩奶冻结帧
    ]],
    ['情绪与疲劳', [
      ['起床气', 'rage'],
      ['罢工', 'strike'],
      ['修复中', 'repair'],
      ['叹气', 'sigh'],
    ]],
    ['鼠标演出', [
      ['摸头开心', 'pet'],
      ['爪子按鼠标', 'paw-mouse'],
      ['尾巴按鼠标', 'tail-mouse'],
      ['歪头看指针', 'tilt'],
    ]],
    ['互动与彩蛋', [
      ['打字飞快', 'fasttype'],
      ['拍指针', 'swat'],
      ['戳一戳', 'poke'],
      ['拉尾巴', 'pull'],
      ['尾巴拍键盘', 'tailslap'],
      ['推杯子', 'push'],
      ['杯子推回来', 'push-back'],
      ['毛线球', 'wand'],
      ['激光笔', 'laser'],
      ['键盘彩蛋', 'keyeggs'],
      ['键盘流水', 'kbdflow'],
      ['转头看', 'headturn'],
      ['后脚打拍', 'hindpaws'],
      ['彩蛋词', 'catword'],
      ['语录', 'quote'],
    ]],
    ['饮食与提醒', [
      ['喝咖啡', 'coffee'],
      ['咖啡心虚', 'coffee-scare'],
      ['零食', 'snack'],
      ['喝水', 'water'],
      ['番茄钟', 'pomo'],
      ['久坐提醒', 'sit'],
    ]],
    ['其他', [
      ['游戏模式', 'game'],
      ['老板键', 'boss'],
      ['隐私模式', 'privacy'],
      ['掉毛', 'shed'],
      ['访客', 'visitor'],
      ['装扮全戴', 'growth'],
    ]],
  ];

  const CAT_KEY = 'debug-cat';
  const params = new URLSearchParams(location.search);
  const style = document.createElement('style');
  style.textContent = `
    #debug-panel { position: fixed; top: 10px; right: 10px; z-index: 9999; width: 232px;
      background: rgba(28, 30, 40, 0.93); color: #e8e8f0; border-radius: 10px;
      font: 12px/1.5 system-ui, sans-serif; user-select: none; box-shadow: 0 4px 14px rgba(0,0,0,.3); }
    #debug-panel-head { padding: 7px 10px; cursor: pointer; font-weight: 600; display: flex; justify-content: space-between; }
    #debug-panel-body { padding: 0 10px 10px; max-height: 72vh; overflow: auto; }
    #debug-panel-folded #debug-panel-body { display: none; }
    #debug-panel label { display: flex; align-items: center; gap: 6px; margin: 2px 0 6px; }
    #debug-cat { flex: 1; font: inherit; }
    #debug-panel h4 { margin: 7px 0 3px; font-size: 11px; color: #9aa0b5; font-weight: 600; }
    #debug-panel .dbg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    #debug-panel button { font: inherit; padding: 3px 4px; border: 0; border-radius: 6px; cursor: pointer;
      background: #3c4157; color: #e8e8f0; }
    #debug-panel button:hover { background: #4c5273; }
    #debug-panel button.on { background: #c2572f; }
    #debug-reset { width: 100%; margin-top: 8px; background: #6e2740 !important; }`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'debug-panel';
  root.innerHTML = `
    <div id="debug-panel-head"><span>调试面板</span><span id="debug-fold-tag">收起</span></div>
    <div id="debug-panel-body">
      <label>皮肤 <select id="debug-cat"></select></label>
      <div id="debug-groups"></div>
      <button id="debug-reset">恢复正常</button>
    </div>`;
  document.body.appendChild(root);

  const select = root.querySelector('#debug-cat');
  for (const { id, name } of window.SillyCoats.list()) select.add(new Option(name, id));
  const saved = localStorage.getItem(CAT_KEY);
  if (saved && !params.get('cat')) window.SillyCoats.apply(saved); // 刷新恢复上次选的皮肤
  select.value = window.SillyCoats.current().id;
  select.addEventListener('change', () => {
    window.SillyCoats.apply(select.value);
    localStorage.setItem(CAT_KEY, select.value);
    go(params.get('demo')); // 同步改 URL 里的 cat，刷新也一致
    select.blur();
  });

  // 现有 URL 里的 demo 名（高亮当前状态按钮用）：含附加参数的项（如 knead&at=800）
  // 按主名匹配高亮
  const currentDemo = params.get('demo');
  function go(spec) {
    const p = new URLSearchParams(location.search);
    p.set('cat', select.value);
    if (spec) {
      const [name, ...extra] = spec.split('&');
      p.set('demo', name);
      p.set('loop', '1');
      for (const kv of extra) {
        const eq = kv.indexOf('=');
        p.set(eq === -1 ? kv : kv.slice(0, eq), eq === -1 ? '1' : kv.slice(eq + 1));
      }
    } else {
      p.delete('demo'); p.delete('loop'); p.delete('at');
    }
    location.href = location.pathname + '?' + p.toString();
  }

  const groupsBox = root.querySelector('#debug-groups');
  for (const [title, items] of GROUPS) {
    const h = document.createElement('h4');
    h.textContent = title;
    groupsBox.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'dbg-grid';
    for (const [label, demo] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      if (currentDemo === demo.split('&')[0]) b.classList.add('on');
      b.title = label === '听歌戴耳机' ? '戴上耳机听歌，8 秒后自动睡着'
        : label === '听歌睡着' ? '戴着耳机直接睡着，不听点头的' : demo;
      b.addEventListener('click', () => go(demo));
      grid.appendChild(b);
    }
    groupsBox.appendChild(grid);
  }
  root.querySelector('#debug-reset').addEventListener('click', () => go(null));

  const head = root.querySelector('#debug-panel-head');
  head.addEventListener('click', () => {
    const folded = root.classList.toggle('debug-panel-folded');
    root.querySelector('#debug-fold-tag').textContent = folded ? '展开' : '收起';
  });
})();
