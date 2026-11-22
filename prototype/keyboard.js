// 画面里的键盘：布局数据 + SVG 生成 + 键位查询。
// 不处理任何输入事件，只提供 center(code) / edgePoint(code, side) / setDown(code, on)。
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const U = 30;          // 1u 键宽
  const X0 = 175;        // 主键区左边
  const Y0 = 414;        // 数字行顶边
  const PITCH = 32;      // 行距
  const KH = 28;         // 键高
  const GAP = 3;

  const letters = (s) => s.split('').map((c) => ['Key' + c, c]);
  const digits = '1234567890'.split('').map((c) => ['Digit' + c, c]);

  const ROWS = [
    [['Backquote', '`'], ...digits, ['Minus', '-'], ['Equal', '='], ['Backspace', 'Back', 2]],
    [['Tab', 'Tab', 1.5], ...letters('QWERTYUIOP'), ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\', 1.5]],
    [['CapsLock', 'Caps', 1.75], ...letters('ASDFGHJKL'), ['Semicolon', ';'], ['Quote', "'"], ['Enter', 'Enter', 2.25]],
    [['ShiftLeft', 'Shift', 2.25], ...letters('ZXCVBNM'), ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', 'Shift', 2.75]],
    [['ControlLeft', 'Ctrl', 1.25], ['MetaLeft', '⌘', 1.25], ['AltLeft', 'Alt', 1.25], ['Space', '', 6.25],
      ['AltRight', 'Alt', 1.25], ['MetaRight', '⌘', 1.25], ['ContextMenu', 'Menu', 1.25], ['ControlRight', 'Ctrl', 1.25]],
  ];

  const CASE = { x: 163, y: 374, w: 474, h: 206 };
  const PIVOT = { x: CASE.x + CASE.w / 2, y: CASE.y + CASE.h / 2 };
  // 键盘本地坐标（用户视角布局）-> 画面坐标（转 180°）
  const toScreen = (p) => ({ x: 2 * PIVOT.x - p.x, y: 2 * PIVOT.y - p.y });

  function mk(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function build(group) {
    const keys = new Map(); // code -> { el, cx, cy }

    mk('rect', { x: CASE.x, y: CASE.y + 8, width: CASE.w, height: CASE.h, rx: 16, class: 'kb-lip' }, group);
    mk('rect', { x: CASE.x, y: CASE.y, width: CASE.w, height: CASE.h, rx: 16, class: 'kb-case' }, group);
    // 键盘朝向猫：键区整体相对观众转 180°（空格行靠猫，数字行靠观众，字是倒的）
    const keysG = mk('g', { class: 'kb-keys', transform: `rotate(180 ${PIVOT.x} ${PIVOT.y})` }, group);

    function addKey(code, label, w, x, y, h) {
      const g = mk('g', { class: 'key', 'data-code': code }, keysG);
      const rx = x + GAP / 2, kw = w * U - GAP;
      mk('rect', { x: rx, y, width: kw, height: h, rx: 5, class: 'key-cap' }, g);
      if (label) {
        const t = mk('text', { x: rx + kw / 2, y: y + h / 2 + 3.2, class: 'key-label' }, g);
        t.textContent = label;
      }
      keys.set(code, { el: g, cx: rx + kw / 2, cy: y + h / 2 });
    }

    // 独立的 Esc 小键
    addKey('Escape', 'Esc', 1, X0, 383, 24);

    ROWS.forEach((row, r) => {
      let off = 0;
      const y = Y0 + r * PITCH;
      for (const [code, label, w = 1] of row) {
        addKey(code, label, w, X0 + off * U, y, KH);
        off += w;
      }
    });

    const left = CASE.x + 4, right = CASE.x + CASE.w - 4;
    const top = CASE.y + 4, bottom = CASE.y + CASE.h - 6;

    return {
      has: (code) => keys.has(code),
      // 返回画面坐标
      center(code) {
        const k = keys.get(code);
        return k ? toScreen({ x: k.cx, y: k.cy }) : null;
      },
      // 画面里没有的键：在该爪所在一侧的键盘边缘找一个就近的点（画面坐标）。
      // side 是猫自己的左右：'L' = 猫的左爪 = 观众右侧。
      edgePoint(code, side) {
        // 先在键盘本地坐标里找物理位置（F 键在数字行外侧、方向键在右下角……）
        const local = localEdge(code, side === 'L' ? 'left' : 'right');
        const p = toScreen(local);
        // 再限制在这只爪所在的画面半边
        p.x = side === 'L' ? Math.max(p.x, 408) : Math.min(p.x, 392);
        return p;
      },
      setDown(code, on) {
        const k = keys.get(code);
        if (k) k.el.classList.toggle('down', !!on);
      },
      bounds: { ...CASE },
    };

    function localEdge(code, physSide) {
        let x, y;
        const f = /^F(\d+)$/.exec(code || '');
        if (f) {
          const n = clampN(parseInt(f[1], 10), 1, 12);
          x = left + 30 + ((n - 1) / 11) * (right - left - 60);
          y = top;
        } else if (/^Arrow/.test(code)) {
          x = right - 18; y = bottom;
        } else if (/^(Home|End|PageUp|PageDown|Insert|Delete|PrintScreen|ScrollLock|Pause)$/.test(code)) {
          x = right; y = top + 40;
        } else if (/^Numpad|^NumLock$/.test(code)) {
          x = right; y = (top + bottom) / 2;
        } else {
          x = physSide === 'left' ? left : right;
          y = (top + bottom) / 2;
        }
        return { x, y };
    }
  }

  function clampN(v, a, b) { return Math.max(a, Math.min(b, v)); }

  window.SillyKeyboard = { build };
})();
