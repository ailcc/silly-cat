// 网页版调试面板：只在浏览器里出现（桌面客户端 Tauri / Electron 不启用，直接返回）。
// 用法：先在下拉框选皮肤（立即生效，并记进 localStorage，刷新自动恢复），
// 再点状态按钮 → 页面跳到 ?cat=皮肤&demo=状态&loop=1，刷新后仍是这个状态，
// 直到点别的状态或「恢复正常」。按钮复用各模块已有的 ?demo= 调试钩子。
(function () {
  'use strict';
  // 桌面客户端不出现：Tauri 注入 __TAURI__，Electron 的 UA 带 Electron
  if (window.__TAURI__ || /Electron/i.test(navigator.userAgent || '')) return;

  // 分组状态表在 debug-states.js（与桌面版设置窗口的调试栏共用）
  const GROUPS = window.SillyDebugStates || [];

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
  function toggleParam(key) { // 「__xxx」类开关：只切对应 URL 参数，demo/皮肤保持不变
    const p = new URLSearchParams(location.search);
    if (p.has(key)) p.delete(key); else p.set(key, '1');
    location.href = location.pathname + '?' + p.toString();
  }
  function go(spec) {
    if (spec && spec.startsWith('__')) return toggleParam(spec.slice(2));
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
      p.delete('demo'); p.delete('loop'); p.delete('at'); p.delete('nolimbs'); p.delete('nokeys');
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
      const isToggle = demo.startsWith('__');
      const toggleKey = isToggle ? demo.slice(2) : null;
      if (isToggle ? params.has(toggleKey) : currentDemo === demo.split('&')[0]) b.classList.add('on');
      b.title = isToggle ? '开关（可与任意状态叠加）：' + toggleKey
        : label === '听歌戴耳机' ? '戴上耳机听歌，8 秒后自动睡着'
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
