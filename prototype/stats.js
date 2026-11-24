// 小账本：累计按了多少个键、发飙几次、推了几次杯子。存在 localStorage 里，
// 网页版和桌面版（WebView）都适用；设置窗口里展示、可清零。
// 全局 API 在载入即挂到 window.SillyStats；create(ctx) 是给主画面的计数模块。
(function () {
  'use strict';

  const KEY = 'sillycat-stats-v1';
  let data = { keys: 0, rage: 0, push: 0 };
  try { data = Object.assign(data, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 坏了就从头记 */ }

  let dirty = false;
  function save() {
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式下存不了就算了 */ }
  }
  function add(name, n) {
    data[name] = (data[name] || 0) + n;
    dirty = true;
    // 节流：连续打字时不每键都写盘，3 秒写一次
    if (!add.timer) add.timer = setTimeout(() => { add.timer = 0; save(); }, 3000);
  }
  window.addEventListener('pagehide', () => { if (dirty) save(); });

  const api = {
    get: () => ({ keys: data.keys || 0, rage: data.rage || 0, push: data.push || 0 }),
    addKey(n = 1) { add('keys', n); },
    addRage() { add('rage', 1); },
    addPush() { add('push', 1); },
    reset() { data = { keys: 0, rage: 0, push: 0 }; save(); },

    // 主画面模块：每个落下的键计一次
    create(ctx) {
      return {
        afterKeyDown(code, now) { api.addKey(); },
        debugProps: { stats: () => api.get().keys },
      };
    },
  };
  window.SillyStats = api;
})();
