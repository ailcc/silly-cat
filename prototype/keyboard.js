// 画面里的键盘：布局数据 + SVG 生成 + 键位查询。
// 不处理任何输入事件，只提供 center(code) / edgePoint(code, side) / setDown(code, on)。
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COMPACT = {
    unit: 30, x: 175, y: 414, pitch: 32, height: 28, gap: 3, radius: 5, labelDy: 3.2,
    bounds: { x: 163, y: 374, w: 474, h: 206 },
  };
  const FULL = {
    unit: 22, x: 152.5, y: 413.5, pitch: 23.5, height: 20.5, gap: 2.5, radius: 4, labelDy: 2.5,
    bounds: { x: 140.5, y: 374, w: 519, h: 170 },
  };
  const isStyle = (style) => style === 'compact' || style === 'full';

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

  function mk(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // 接口保持同一个对象，模块继续查询当前布局。只替换键盘节点，保留裂纹等效果层。
  function build(group, initialStyle = 'compact') {
    let nodes = [];
    const keyboard = { setStyle };
    function setStyle(style) {
      if (!isStyle(style) || style === keyboard.style) return;
      const layout = buildLayout(style);
      for (const node of layout.nodes) {
        if (nodes.length) group.insertBefore(node, nodes[0]);
        else group.appendChild(node);
      }
      for (const node of nodes) node.remove();
      nodes = layout.nodes;
      Object.assign(keyboard, layout.api);
      group.classList.toggle('kb-full', style === 'full');
    }
    setStyle(isStyle(initialStyle) ? initialStyle : 'compact');
    return keyboard;
  }

  function buildLayout(style) {
    const full = style === 'full';
    const { unit: U, x: X0, y: Y0, pitch: PITCH, height: KH, gap: GAP, radius, labelDy, bounds } = full ? FULL : COMPACT;
    const pivot = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    const toScreen = (p) => ({ x: 2 * pivot.x - p.x, y: 2 * pivot.y - p.y });
    const keys = new Map(); // code -> { el, cx, cy }

    const lip = mk('rect', { x: bounds.x, y: bounds.y + 8, width: bounds.w, height: bounds.h, rx: 16, class: 'kb-lip' });
    const shell = mk('rect', { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, rx: 16, class: 'kb-case' });
    // 键盘朝向猫：键区整体相对观众转 180°（空格行靠猫，数字行靠观众，字是倒的）
    const keysG = mk('g', { class: 'kb-keys', transform: `rotate(180 ${pivot.x} ${pivot.y})` });

    function addKey(code, label, w, x, y, h) {
      const g = mk('g', { class: 'key', 'data-code': code }, keysG);
      const rx = x + GAP / 2, kw = w * U - GAP;
      mk('rect', { x: rx, y, width: kw, height: h, rx: radius, class: 'key-cap' }, g);
      if (label) {
        const t = mk('text', { x: rx + kw / 2, y: y + h / 2 + labelDy, class: 'key-label' }, g);
        t.textContent = label;
      }
      keys.set(code, { el: g, cx: rx + kw / 2, cy: y + h / 2 });
    }

    if (full) addFullKeys();
    else addKey('Escape', 'Esc', 1, X0, 383, 24);

    function addFullKeys() {
      const fy = 386, nav = X0 + 15.25 * U, pad = X0 + 18.5 * U;
      const rowY = (row) => Y0 + row * PITCH;
      const tall = KH + PITCH;
      function addRow(caps, x, y) {
        caps.forEach(([code, label], i) => addKey(code, label, 1, x + i * U, y, KH));
      }

      addKey('Escape', 'Esc', 1, X0, fy, KH);
      for (let i = 0; i < 12; i++) {
        const code = 'F' + (i + 1);
        addKey(code, code, 1, X0 + (2 + i + Math.floor(i / 4) * 0.5) * U, fy, KH);
      }

      addRow([['PrintScreen', 'Prt'], ['ScrollLock', 'Scr'], ['Pause', 'Pau']], nav, fy);
      addRow([['Insert', 'Ins'], ['Home', 'Hm'], ['PageUp', 'PU']], nav, rowY(0));
      addRow([['Delete', 'Del'], ['End', 'End'], ['PageDown', 'PD']], nav, rowY(1));
      addKey('ArrowUp', '↑', 1, nav + U, rowY(3), KH);
      addRow([['ArrowLeft', '←'], ['ArrowDown', '↓'], ['ArrowRight', '→']], nav, rowY(4));

      addRow([['Power', 'Pwr'], ['Sleep', 'Slp'], ['WakeUp', 'Wk'], ['LaunchApp2', 'Calc']], pad, fy);
      addRow([['NumLock', 'Num'], ['NumpadDivide', '/'], ['NumpadMultiply', '*'], ['NumpadSubtract', '-']], pad, rowY(0));
      for (const [row, digits] of [[1, '789'], [2, '456'], [3, '123']]) {
        addRow([...digits].map((digit) => ['Numpad' + digit, digit]), pad, rowY(row));
      }
      addKey('NumpadAdd', '+', 1, pad + 3 * U, rowY(1), tall);
      addKey('NumpadEnter', 'Ent', 1, pad + 3 * U, rowY(3), tall);
      addKey('Numpad0', '0', 2, pad, rowY(4), KH);
      addKey('NumpadDecimal', '.', 1, pad + 2 * U, rowY(4), KH);
    }

    ROWS.forEach((row, r) => {
      let off = 0;
      const y = Y0 + r * PITCH;
      for (const [code, label, w = 1] of row) {
        addKey(code, label, w, X0 + off * U, y, KH);
        off += w;
      }
    });

    const left = bounds.x + 4, right = bounds.x + bounds.w - 4;
    const top = bounds.y + 4, bottom = bounds.y + bounds.h - 6;

    const api = {
      style,
      pivot,
      heightScale: KH / COMPACT.height,
      caseScale: { x: bounds.w / COMPACT.bounds.w, y: bounds.h / COMPACT.bounds.h },
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
      // 被脸压住：下沉但不高亮
      setSunk(code, on) {
        const k = keys.get(code);
        if (k) k.el.classList.toggle('sunk', !!on);
      },
      // 键帽被砸飞：只剩键座
      setGone(code, on) {
        const k = keys.get(code);
        if (k) k.el.classList.toggle('gone', !!on);
      },
      // 键帽被按回去时弹一下
      pop(code) {
        const k = keys.get(code);
        if (!k) return;
        k.el.classList.remove('pop');
        void k.el.getBoundingClientRect();
        k.el.classList.add('pop');
        setTimeout(() => k.el.classList.remove('pop'), 260);
      },
      isGone: (code) => { const k = keys.get(code); return !!(k && k.el.classList.contains('gone')); },
      codes: () => [...keys.keys()],
      bounds: { ...bounds },
    };
    return { api, nodes: [lip, shell, keysG] };

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

  window.SillyKeyboard = { build, isStyle };
})();
