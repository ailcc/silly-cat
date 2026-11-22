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
    function onContextMenu(e) { if (isNode(e.target) && stageEl.contains(e.target)) e.preventDefault(); }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('contextmenu', onContextMenu);

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
      },
    };
  }

  window.SillyInput = { createBrowserInput };
})();
