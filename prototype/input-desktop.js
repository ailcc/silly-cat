// 桌面输入来源（Tauri 外壳）：把 Rust 侧发来的全局键鼠事件翻译成和 input.js 相同的抽象事件，交给 sink（猫）。
// 只在 Tauri 里用；浏览器里不会调用 create，加载本文件本身没有副作用。
//
// - 键盘：macOS 上 Rust 的只读 CGEventTap 发来虚拟键码 { kc, down }，这里映射成 KeyboardEvent.code（keyboard.js 用的键位标识）；
//   Windows 上 Rust 的低级键盘钩子已经按扫描码换好了 code，发来 { code, down }，直接用。
//   不做字符转换，不记录任何输入。桌面模式下不挂 input.js 的 DOM 键盘监听，同一次按键只算一次。
// - 鼠标移动：每 33ms 向 Rust 取一次全局指针位置（不需要输入监控权限），相邻两次的差值就是 pointerMove(dx, dy)。
// - 鼠标按键：Rust 的鼠标 tap 发来；指针正在猫身上时这次点击交给页面（摸头 / 拖动），不算「点鼠标」。
// - 点击穿透：用同一份指针位置做 document.elementFromPoint 命中判断，只有指在有画面的地方时窗口才接收鼠标。
// - 在头上按下是摸头；位置解锁时，在身体、尾巴、键盘、鼠标等其他画面上按下是拖动窗口。
// - 右键有画面的地方会在指针位置弹出和菜单栏（托盘）图标相同的原生菜单。锁定后拖不动，仍可用「重置位置」。
// - 收不到键盘输入（只有 macOS：没授权「输入监控」，或授权记录和当前签名对不上）时，猫左上方冒一个小气泡，
//   点它打开设置窗口（里面有处理办法）。状态每 2 秒向 Rust 问一次（input_status.needs_permission），
//   连续两次「收不到」才显示，一旦正常就收起。Windows 上 Rust 永远报 false，不显示。
(function () {
  'use strict';

  // macOS 虚拟键码 -> KeyboardEvent.code（按物理位置，不随输入法 / 键盘布局变）
  const KEYCODES = {
    0: 'KeyA', 1: 'KeyS', 2: 'KeyD', 3: 'KeyF', 4: 'KeyH', 5: 'KeyG', 6: 'KeyZ', 7: 'KeyX', 8: 'KeyC', 9: 'KeyV',
    10: 'IntlBackslash', 11: 'KeyB', 12: 'KeyQ', 13: 'KeyW', 14: 'KeyE', 15: 'KeyR', 16: 'KeyY', 17: 'KeyT',
    18: 'Digit1', 19: 'Digit2', 20: 'Digit3', 21: 'Digit4', 22: 'Digit6', 23: 'Digit5', 24: 'Equal', 25: 'Digit9',
    26: 'Digit7', 27: 'Minus', 28: 'Digit8', 29: 'Digit0', 30: 'BracketRight', 31: 'KeyO', 32: 'KeyU',
    33: 'BracketLeft', 34: 'KeyI', 35: 'KeyP', 36: 'Enter', 37: 'KeyL', 38: 'KeyJ', 39: 'Quote', 40: 'KeyK',
    41: 'Semicolon', 42: 'Backslash', 43: 'Comma', 44: 'Slash', 45: 'KeyN', 46: 'KeyM', 47: 'Period', 48: 'Tab',
    49: 'Space', 50: 'Backquote', 51: 'Backspace', 53: 'Escape', 54: 'MetaRight', 55: 'MetaLeft', 56: 'ShiftLeft',
    57: 'CapsLock', 58: 'AltLeft', 59: 'ControlLeft', 60: 'ShiftRight', 61: 'AltRight', 62: 'ControlRight', 63: 'Fn',
    64: 'F17', 65: 'NumpadDecimal', 67: 'NumpadMultiply', 69: 'NumpadAdd', 71: 'NumLock', 75: 'NumpadDivide',
    76: 'NumpadEnter', 78: 'NumpadSubtract', 79: 'F18', 80: 'F19', 81: 'NumpadEqual', 82: 'Numpad0', 83: 'Numpad1',
    84: 'Numpad2', 85: 'Numpad3', 86: 'Numpad4', 87: 'Numpad5', 88: 'Numpad6', 89: 'Numpad7', 90: 'F20',
    91: 'Numpad8', 92: 'Numpad9', 93: 'IntlYen', 94: 'IntlRo', 95: 'NumpadComma', 96: 'F5', 97: 'F6', 98: 'F7',
    99: 'F3', 100: 'F8', 101: 'F9', 102: 'Lang2', 103: 'F11', 104: 'Lang1', 105: 'F13', 106: 'F16', 107: 'F14',
    109: 'F10', 110: 'ContextMenu', 111: 'F12', 113: 'F15', 114: 'Insert', 115: 'Home', 116: 'PageUp',
    117: 'Delete', 118: 'F4', 119: 'End', 120: 'F2', 121: 'PageDown', 122: 'F1', 123: 'ArrowLeft',
    124: 'ArrowRight', 125: 'ArrowDown', 126: 'ArrowUp',
  };
  const CAPS_LOCK_KC = 57;
  const HELD_CHECK_MS = 1000;
  const IDLE_RELEASE_MS = 60000;
  const POLL_MS = 33;
  // 桌面窗口里把画面四周放宽：发飙举鼠标过头顶、Zzz、浮起的键名、散落的键帽都不被窗口边缘裁掉
  const DESKTOP_VIEWBOX = '-20 -50 840 690';
  const STATUS_MS = 2000;
  const UPDATE_FAILURE_MS = 10000;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // 「我看不到你打字」气泡：画在猫的左上方（viewBox 坐标 x 6–278、y -34–66），尾巴指向左耳外侧，不挡脸
  function buildPermBubble(sceneEl) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('id', 'perm-bubble');
    g.setAttribute('class', 'perm-bubble');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', '猫看不到你打字，点这里处理');
    g.style.display = 'none';
    g.innerHTML =
      '<path class="perm-bubble-shape" d="M 24 -34 H 228 Q 246 -34 246 -16 V 28 Q 246 46 228 46 H 214 L 278 66 L 190 46 H 24 Q 6 46 6 28 V -16 Q 6 -34 24 -34 Z"/>' +
      '<text class="perm-bubble-text" x="126" y="1">我看不到你打字</text>' +
      '<text class="perm-bubble-sub" x="126" y="32">点这里处理 ›</text>';
    sceneEl.appendChild(g);
    return g;
  }

  const isDesktop = () => !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.window);

  function create(sink, opts = {}) {
    const T = window.__TAURI__;
    const invoke = T.core.invoke;
    const appWin = T.window.getCurrentWindow();
    const sceneEl = opts.sceneEl;
    const headEls = [].concat(opts.headEl || []).filter(Boolean);
    let headEl = headEls[0] || null;

    if (sceneEl) sceneEl.setAttribute('viewBox', DESKTOP_VIEWBOX);

    const heldKeys = new Map();
    const heldButtons = new Map();
    let lastActivity = performance.now();
    let nextHeldCheck = 0;
    let checkingHeld = false;
    let pet = null;           // { id }
    let over = false;         // 指针此刻是否在有画面的地方
    let ignoring = null;      // 窗口当前是否点击穿透
    let clickThrough = null;  // 设置里的鼠标穿透开关：null = 还没读到
    let lastG = null;         // 上一次的全局指针位置
    let lastLocal = null;     // 上一次用于视线的视口位置
    const status = { granted: null, keys: false, mouse: false, keyboard: null, needs_permission: false };
    const permBubble = sceneEl ? buildPermBubble(sceneEl) : null;
    let blockedStreak = 0;
    let updateNotice = null;
    let updateFailureTimer;
    let visibleNotice = null;
    let destroyed = false;
    const permissionNotice = { title: '我看不到你打字', detail: '点这里处理 ›' };
    function refreshBubble() {
      const notice = blockedStreak >= 2 ? permissionNotice : updateNotice;
      if (!permBubble || notice === visibleNotice) return;
      visibleNotice = notice;
      permBubble.style.display = notice ? '' : 'none';
      if (!notice) return;
      permBubble.setAttribute('aria-label', [notice.title, notice.detail].filter(Boolean).join('，'));
      permBubble.setAttribute('role', notice === permissionNotice || notice.installable ? 'button' : 'status');
      const lines = permBubble.querySelectorAll('text');
      [notice.title, notice.detail].forEach((value, i) => {
        const line = lines[i];
        const text = value || '';
        // 设置页显示完整原因。猫旁的窄气泡只留一行，短版本号和进度可完整显示。
        line.textContent = text.length > 20 ? text.slice(0, 19) + '…' : text;
        line.removeAttribute('textLength');
        if (line.getComputedTextLength() > 224) {
          line.setAttribute('lengthAdjust', 'spacingAndGlyphs');
          line.setAttribute('textLength', '224');
        }
      });
    }
    function onUpdate(notice) {
      if (destroyed) return;
      clearTimeout(updateFailureTimer);
      const kind = notice?.kind;
      updateNotice = kind === 'offer' || kind === 'progress' || kind === 'failed' ? notice : null;
      if (kind === 'failed') {
        updateFailureTimer = setTimeout(() => onUpdate(null), UPDATE_FAILURE_MS);
      }
      refreshBubble();
    }
    function updatePermBubble(s) {
      blockedStreak = s && s.needs_permission === true ? blockedStreak + 1 : 0;
      refreshBubble();
    }
    const inPermBubble = (t) => !!permBubble && isNode(t) && permBubble.contains(t);

    const isNode = (t) => typeof Node !== 'undefined' && t instanceof Node;
    const inScene = (t) => isNode(t) && t !== sceneEl && !!sceneEl && sceneEl.contains(t);

    function rel(e) {
      const r = headEl.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 || 1);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2 || 1);
      return [Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny))];
    }

    // ---------- 键盘 ----------
    function onKey({ kc, code: winCode, down }) {
      lastActivity = performance.now();
      const code = winCode || KEYCODES[kc];
      if (!code) return;
      if (!winCode && kc === CAPS_LOCK_KC) { // macOS 的大写锁定只有切换时的一次事件：当作按一下（Windows 有正常的按下 / 抬起）
        if (heldKeys.has(code)) return;
        heldKeys.set(code, { since: lastActivity, kc }); sink.keyDown(code);
        setTimeout(() => { if (heldKeys.delete(code)) sink.keyUp(code); }, 120);
        return;
      }
      if (down) {
        if (heldKeys.has(code)) return;
        heldKeys.set(code, { since: lastActivity, kc }); sink.keyDown(code);
      } else {
        if (!heldKeys.has(code)) return;
        heldKeys.delete(code); sink.keyUp(code);
      }
    }

    // ---------- 鼠标按键（全局） ----------
    // 开着鼠标穿透时窗口收不到点击，按键一律转给页面（猫仍对点击有反应，只是摸不到头）
    function onButton({ button, down }) {
      lastActivity = performance.now();
      const forward = clickThrough === true || !(over || pet);
      if (down) {
        if (!forward) return; // 点在猫身上：交给页面（摸头 / 拖动）
        if (heldButtons.has(button)) return;
        heldButtons.set(button, { since: lastActivity }); sink.pointerDown(button);
      } else {
        if (button === 0) endPet(); // 指针跑出窗口后松开也能结束摸头
        if (!heldButtons.has(button)) return;
        heldButtons.delete(button); sink.pointerUp(button);
      }
    }

    // ---------- 指针位置轮询：pointerMove + 点击穿透 ----------
    function hitAt(x, y) {
      if (!(x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight)) return false;
      return inScene(document.elementFromPoint(x, y));
    }
    function setIgnore(v) {
      if (v === ignoring) return;
      ignoring = v;
      appWin.setIgnoreCursorEvents(v).catch(() => { ignoring = null; });
    }
    async function checkHeld() {
      const now = performance.now();
      if (checkingHeld || now < nextHeldCheck || !(heldKeys.size || heldButtons.size)) return;
      const oldEnough = ([, press]) => now - press.since >= HELD_CHECK_MS;
      const keys = [...heldKeys].filter((entry) => entry[1].kc !== CAPS_LOCK_KC && oldEnough(entry));
      const buttons = [...heldButtons].filter(oldEnough);
      if (!(keys.length || buttons.length)) return;
      nextHeldCheck = now + HELD_CHECK_MS;
      checkingHeld = true;
      let state;
      try {
        state = await invoke('held_input_state', {
          keys: keys.map(([code, { kc }]) => ({ code, kc })),
          buttons: buttons.map(([button]) => button),
        });
      } catch (_) { /* 旧版后端或系统状态不可读时，只使用空闲兜底 */ }
      finally { checkingHeld = false; }

      function reconcile(entries, held, physical, release) {
        for (const [id, press] of entries) {
          // IPC 往返期间可能松开后又按下同一个键。旧快照只能结束当时的那次按下。
          if (held.get(id) !== press) continue;
          const up = Array.isArray(physical)
            ? !physical.includes(id)
            : performance.now() - lastActivity >= IDLE_RELEASE_MS;
          if (up) {
            held.delete(id);
            release(id);
          }
        }
      }
      reconcile(keys, heldKeys, state?.keys, (key) => sink.keyUp(key));
      reconcile(buttons, heldButtons, state?.buttons, (button) => sink.pointerUp(button));
    }

    let polling = false;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const c = await invoke('cursor_local');
        if (c) {
          if (lastG) {
            const dx = c.gx - lastG.x, dy = c.gy - lastG.y;
            if (dx || dy) {
              lastActivity = performance.now();
              if (!pet) sink.pointerMove(dx, dy);
            }
          }
          lastG = { x: c.gx, y: c.gy };
          if (!lastLocal) lastLocal = { x: c.x, y: c.y };
          else if (Math.hypot(c.x - lastLocal.x, c.y - lastLocal.y) >= 0.5) {
            lastLocal = { x: c.x, y: c.y };
            sink.pointerAt(c.x, c.y);
          }
          over = hitAt(c.x, c.y);
          setIgnore(clickThrough === true || !(over || pet));
        }
      } catch (_) { /* 窗口关闭中等 */ } finally { polling = false; void checkHeld(); }
    }

    // ---------- 页面内：摸头、拖动 ----------
    let positionLocked = null;
    function endPet() {
      if (!pet) return;
      pet = null;
      sink.petEnd();
    }
    function onPointerDown(e) {
      // 鼠标穿透期间窗口忽略鼠标事件，页面里的摸头、右键菜单都不该触发
      if (clickThrough === true) return;
      if (e.button === 2) { openMenu(e); return; }
      if (e.button !== 0) return;
      if (inPermBubble(e.target)) {
        e.preventDefault();
        if (visibleNotice === permissionNotice) invoke('open_settings').catch(() => {});
        else if (visibleNotice?.installable) window.SillyUpdater.install(onUpdate);
        else onUpdate(null);
        return;
      }
      const h = headEls.find((n) => isNode(e.target) && n.contains(e.target)) ||
        (e.button === 0 ? opts.retrieveTarget?.(e.target) : null);
      if (h) {
        headEl = h;
        pet = { id: e.pointerId };
        try { h.setPointerCapture(e.pointerId); } catch (_) { /* 某些环境不支持 */ }
        sink.petStart(...rel(e));
        return;
      }
      if (inScene(e.target)) {
        e.preventDefault();
        // 抓尾巴是给 pull-tail.js 的「拉尾巴会生气」，不算拖窗口
        if (isNode(e.target) && e.target.closest && e.target.closest('#tail, #tail-front')) return;
        if (positionLocked === false) appWin.startDragging().catch(() => {});
      }
    }
    function onPointerMove(e) { if (pet && e.pointerId === pet.id) sink.petMove(...rel(e)); }
    function onPointerUp(e) { if (pet && e.pointerId === pet.id) endPet(); }
    // 右键有画面的地方：弹出原生右键菜单（不摸头、不拖动）。pointerdown 和 contextmenu 都可能来，只弹一次：
    // 菜单开着时（invoke 要等菜单关掉才返回）和关掉后 500ms 内再来的右键事件都忽略
    let menuOpen = false;
    let lastMenuAt = -1e9;
    function openMenu(e) {
      if (!inScene(e.target)) return;
      if (menuOpen || performance.now() - lastMenuAt < 500) return;
      menuOpen = true;
      lastMenuAt = performance.now();
      invoke('show_context_menu')
        .catch(() => invoke('open_settings').catch(() => {})) // 弹不出菜单时退回直接打开设置
        .finally(() => { menuOpen = false; lastMenuAt = performance.now(); });
    }
    function onContextMenu(e) { e.preventDefault(); openMenu(e); }

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('contextmenu', onContextMenu);

    const unlisten = [window.SillyUpdater.subscribe(onUpdate)];
    T.event.listen('silly:lock', (ev) => { positionLocked = ev.payload; }).then((u) => {
      if (destroyed) { u(); return; }
      unlisten.push(u);
      // 先监听再读取，读取途中收到的切换事件优先。
      return invoke('position_locked').then((locked) => { positionLocked ??= locked; });
    }).catch(() => { positionLocked ??= false; }); // 读不到锁定状态时按解锁处理，免得猫永远拖不动
    T.event.listen('silly:key', (ev) => onKey(ev.payload)).then((u) => unlisten.push(u));
    T.event.listen('silly:button', (ev) => onButton(ev.payload)).then((u) => unlisten.push(u));
    T.event.listen('silly:click-through', (ev) => {
      clickThrough = ev.payload?.enabled === true;
      if (clickThrough) endPet();
    }).then((u) => {
      if (destroyed) { u(); return; }
      unlisten.push(u);
      // 先监听再读取，读取途中收到的切换事件优先
      return invoke('click_through_status').then((s) => { if (clickThrough === null) clickThrough = s?.enabled === true; });
    }).catch(() => { clickThrough ??= false; });
    const timer = setInterval(poll, POLL_MS);

    function refreshStatus() {
      return invoke('input_status').then((s) => { Object.assign(status, s); updatePermBubble(s); return s; }).catch(() => status);
    }
    refreshStatus();
    const statusTimer = setInterval(refreshStatus, STATUS_MS);

    function releaseAll() {
      for (const c of heldKeys.keys()) { heldKeys.delete(c); sink.keyUp(c); }
      for (const b of heldButtons.keys()) { heldButtons.delete(b); sink.pointerUp(b); }
      endPet();
    }

    return {
      releaseAll,
      debug: Object.freeze({
        get over() { return over; },
        get ignoring() { return ignoring; },
        get clickThrough() { return clickThrough; },
        get input() { return { ...status }; },
        get permBubble() { return !!permBubble && visibleNotice === permissionNotice; },
        get held() { return [...heldKeys.keys()]; },
      }),
      destroy() {
        destroyed = true;
        releaseAll();
        clearInterval(timer); clearInterval(statusTimer);
        clearTimeout(updateFailureTimer);
        if (permBubble) permBubble.remove();
        for (const u of unlisten) u();
        window.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('contextmenu', onContextMenu);
      },
    };
  }

  window.SillyDesktopInput = { isDesktop, create, KEYCODES };
})();
