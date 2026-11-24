// 两个桌面窗口共用更新状态。设置窗口可能在事件发出之后才加载。
(function () {
  'use strict';

  function subscribe(render) {
    const T = window.__TAURI__;
    if (!T) return () => {};
    let closed = false, received = false, unlisten;
    T.event.listen('silly:update', ({ payload }) => {
      received = true;
      if (!closed) render(payload);
    }).then(async (stop) => {
      if (closed) { stop(); return; }
      unlisten = stop;
      const snapshot = await T.core.invoke('update_status');
      if (!closed && !received) render(snapshot);
    }).catch(() => {});
    return () => {
      closed = true;
      if (unlisten) unlisten();
    };
  }

  function install(render) {
    const T = window.__TAURI__;
    if (T) T.core.invoke('install_update').catch((error) => {
      render({ kind: 'failed', title: '更新失败', detail: String(error), installable: false });
    });
  }

  window.SillyUpdater = { subscribe, install };
})();
