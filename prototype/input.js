// 浏览器输入来源：把 DOM 键鼠事件翻译成抽象事件，交给 sink（猫）。
// sink 需要实现：keyDown(code) keyUp(code) pointerMove(dx, dy) pointerDown(button) pointerUp(button)
//               petStart(nx, ny) petMove(nx, ny) petEnd()
// 将来换成系统级全局键鼠监听时，只需写一个发出同样事件的输入来源。
(function () {
  'use strict';

  const PREVENT = new Set(['Tab', 'Space', 'Backspace', 'Slash', 'Quote',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock']);
  // e.buttons 位 -> 抽象按键号（0 左 / 1 中 / 2 右）
  const BUTTON_BITS = [[1, 0], [2, 2], [4, 1]];

  function createBrowserInput(sink, opts = {}) {
    // headEl 可以是一个元素或元素数组（正面的头、罢工时背对观众的头）
    const headEls = [].concat(opts.headEl || []).filter(Boolean);
    let headEl = headEls[0] || null; // 当前正在摸的那个
    const ignoreEl = opts.ignoreEl || null;
    const stageEl = opts.stageEl || document.body;

    const heldKeys = new Set();
    const heldButtons = new Set();
    let prevBits = 0;
    let pet = null;       // { id, viaMouse }
    let touchDown = null; // 非鼠标指针按下（当作左键）
    let lastPt = null;

    const isNode = (t) => typeof Node !== 'undefined' && t instanceof Node;
    const inIgnored = (t) => !!(ignoreEl && isNode(t) && ignoreEl.contains(t));
    const onHead = (t) => {
      if (!isNode(t)) return false;
      const h = headEls.find((n) => n.contains(t));
      if (h) headEl = h;
      return !!h;
    };

    function rel(e) {
      const r = headEl.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 || 1);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2 || 1);
      return [Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny))];
    }

    function onKeyDown(e) {
      if (!e.code) return;
      if (PREVENT.has(e.code) && !e.metaKey && !e.ctrlKey) e.preventDefault();
      if (e.repeat || heldKeys.has(e.code)) return;
      heldKeys.add(e.code);
      sink.keyDown(e.code);
    }

    function onKeyUp(e) {
      const code = e.code;
      if (!heldKeys.has(code)) return;
      heldKeys.delete(code);
      sink.keyUp(code);
      // macOS 上按着 Cmd 时其他键的 keyup 常常丢失：松开 Cmd 时一起释放
      if (code === 'MetaLeft' || code === 'MetaRight') {
        for (const c of [...heldKeys]) {
          if (!MODIFIERS.has(c)) { heldKeys.delete(c); sink.keyUp(c); }
        }
      }
    }

    function syncMouseButtons(e, allowDown) {
      if (e.pointerType !== 'mouse') return;
      let bits = e.buttons | 0;
      if (pet && pet.viaMouse) bits &= ~1; // 摸头占用的左键不算鼠标点击
      for (const [bit, btn] of BUTTON_BITS) {
        const was = prevBits & bit, is = bits & bit;
        if (is && !was && allowDown) { heldButtons.add(btn); sink.pointerDown(btn); }
        else if (!is && was && heldButtons.has(btn)) { heldButtons.delete(btn); sink.pointerUp(btn); }
      }
      // 只记录真正发出过 pointerDown 的按键，避免在控件上按下后漏发/多发
      let kept = 0;
      for (const [bit, btn] of BUTTON_BITS) if (heldButtons.has(btn)) kept |= bit;
      prevBits = kept;
    }

    function onPointerDown(e) {
      lastPt = { x: e.clientX, y: e.clientY };
      if (inIgnored(e.target)) return;
      if (!pet && e.button === 0 && onHead(e.target)) {
        pet = { id: e.pointerId, viaMouse: e.pointerType === 'mouse' };
        try { headEl.setPointerCapture(e.pointerId); } catch (_) { /* 某些环境不支持 */ }
        if (e.pointerType !== 'mouse') e.preventDefault();
        sink.petStart(...rel(e));
        syncMouseButtons(e, true);
        return;
      }
      if (e.pointerType === 'mouse') { syncMouseButtons(e, true); return; }
      if (!touchDown) {
        touchDown = e.pointerId;
        e.preventDefault();
        sink.pointerDown(0);
      }
    }

    function onPointerMove(e) {
      sink.pointerAt(e.clientX, e.clientY);
      const dx = lastPt ? e.clientX - lastPt.x : 0;
      const dy = lastPt ? e.clientY - lastPt.y : 0;
      lastPt = { x: e.clientX, y: e.clientY };
      if (pet && e.pointerId === pet.id) { sink.petMove(...rel(e)); syncMouseButtons(e, !inIgnored(e.target)); return; }
      syncMouseButtons(e, !inIgnored(e.target));
      sink.pointerMove(dx, dy);
    }

    function onPointerUp(e) {
      if (pet && e.pointerId === pet.id) {
        pet = null;
        sink.petEnd();
      }
      if (e.pointerType === 'mouse') { syncMouseButtons(e, false); return; }
      if (touchDown === e.pointerId) { touchDown = null; sink.pointerUp(0); }
    }

    function releaseAll() {
      for (const c of [...heldKeys]) { heldKeys.delete(c); sink.keyUp(c); }
      for (const b of [...heldButtons]) { heldButtons.delete(b); sink.pointerUp(b); }
      prevBits = 0;
      if (touchDown !== null) { touchDown = null; sink.pointerUp(0); }
      if (pet) { pet = null; sink.petEnd(); }
    }

    function onVisibility() { if (document.hidden) releaseAll(); }
    // 右键猫：弹自制的「玩法说明」入口菜单（桌面版右键走原生菜单，见 input-desktop.js）。
    // 菜单和说明窗都按项目配色画：奶油底、描边、硬阴影
    let ctxMenu = null, helpModal = null, helpStyle = null;

    function ensureHelpStyle() {
      if (helpStyle) return;
      helpStyle = document.createElement('style');
      helpStyle.textContent = [
        '.silly-ctx{position:fixed;z-index:9990;min-width:128px;padding:4px;background:#fffdf8;',
        'border:2px solid #1d1b22;border-radius:12px;box-shadow:3px 3px 0 rgba(29,27,34,.15)}',
        '.silly-ctx[hidden]{display:none}',
        '.silly-ctx button{display:block;width:100%;padding:7px 14px;border:0;border-radius:8px;',
        'background:none;color:#1d1b22;font-family:inherit;font-size:13px;font-weight:600;line-height:1.4;',
        'text-align:left;cursor:pointer}',
        '.silly-ctx button:hover{background:#fbf6ea}',
        '.silly-modal{position:fixed;inset:0;z-index:9991;display:flex;align-items:center;justify-content:center;',
        'padding:24px;background:rgba(29,27,34,.45)}',
        '.silly-modal[hidden]{display:none}',
        '.silly-modal .box{position:relative;width:min(560px,100%);height:min(660px,100%);',
        'background:#dfe6f5;border:2px solid #1d1b22;border-radius:16px;overflow:hidden;',
        'box-shadow:4px 4px 0 rgba(29,27,34,.25)}',
        '.silly-modal iframe{display:block;width:100%;height:100%;border:0}',
        '.silly-modal .close{position:absolute;top:10px;right:12px;width:30px;height:30px;',
        'border:2px solid #1d1b22;border-radius:50%;background:#fffdf8;color:#1d1b22;',
        'font-family:inherit;font-size:15px;font-weight:700;line-height:1;cursor:pointer}',
      ].join('');
      document.head.appendChild(helpStyle);
    }

    function closeCtxMenu() { if (ctxMenu) ctxMenu.hidden = true; }
    function closeHelpModal() { if (helpModal) helpModal.hidden = true; }

    function openHelpModal() {
      ensureHelpStyle();
      if (!helpModal) {
        helpModal = document.createElement('div');
        helpModal.className = 'silly-modal';
        helpModal.hidden = true;
        const box = document.createElement('div');
        box.className = 'box';
        const frame = document.createElement('iframe');
        frame.src = 'help.html';
        frame.title = '玩法说明';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'close';
        close.textContent = '×';
        close.setAttribute('aria-label', '关闭玩法说明');
        close.addEventListener('click', closeHelpModal);
        box.appendChild(frame);
        box.appendChild(close);
        helpModal.appendChild(box);
        // 点弹窗外的暗处关闭
        helpModal.addEventListener('pointerdown', (e) => { if (e.target === helpModal) closeHelpModal(); });
        document.body.appendChild(helpModal);
      }
      helpModal.hidden = false;
    }

    function openHelpMenu(x, y) {
      ensureHelpStyle();
      if (!ctxMenu) {
        ctxMenu = document.createElement('div');
        ctxMenu.className = 'silly-ctx';
        ctxMenu.hidden = true;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '玩法说明';
        btn.addEventListener('click', () => { closeCtxMenu(); openHelpModal(); });
        ctxMenu.appendChild(btn);
        document.body.appendChild(ctxMenu);
      }
      ctxMenu.hidden = false;
      const r = ctxMenu.getBoundingClientRect();
      ctxMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
      ctxMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    }

    function onContextMenu(e) {
      if (!(isNode(e.target) && stageEl.contains(e.target))) return;
      e.preventDefault();
      openHelpMenu(e.clientX, e.clientY);
    }

    // 点别处 / Esc / 切走窗口时收起菜单和弹窗
    function onGlobalPointerDown(e) {
      if (ctxMenu && !ctxMenu.hidden && !(isNode(e.target) && ctxMenu.contains(e.target))) closeCtxMenu();
    }
    function onGlobalKeyDown(e) { if (e.key === 'Escape') { closeCtxMenu(); closeHelpModal(); } }
    function onWindowBlur2() { closeCtxMenu(); }


    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerdown', onGlobalPointerDown, true);
    window.addEventListener('keydown', onGlobalKeyDown, true);
    window.addEventListener('blur', onWindowBlur2);

    return {
      releaseAll,
      destroy() {
        releaseAll();
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('blur', releaseAll);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('pointerdown', onGlobalPointerDown, true);
        window.removeEventListener('keydown', onGlobalKeyDown, true);
        window.removeEventListener('blur', onWindowBlur2);
        if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
        if (helpModal) { helpModal.remove(); helpModal = null; }
        if (helpStyle) { helpStyle.remove(); helpStyle = null; }
      },
    };
  }

  window.SillyInput = { createBrowserInput };
})();
