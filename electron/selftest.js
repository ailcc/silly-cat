'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const position = ({ x, y }) => ({ x, y });

async function until(description, predicate) {
  const deadline = Date.now() + 1500;
  do {
    if (await predicate()) return;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error('等待超时：' + description);
}

// 打包配置会剔除依赖的 C 源码。保留 1.5.5 头文件的 VC 数值快照，
// 源码自检逐项核对快照；安装包自检使用同一份已核对的基准。
const packedVC = `
ESCAPE=0001 F1=003B F2=003C F3=003D F4=003E F5=003F F6=0040
F7=0041 F8=0042 F9=0043 F10=0044 F11=0057 F12=0058 F13=005B
F14=005C F15=005D F16=0063 F17=0064 F18=0065 F19=0066 F20=0067
F21=0068 F22=0069 F23=006A F24=006B BACKQUOTE=0029 1=0002 2=0003
3=0004 4=0005 5=0006 6=0007 7=0008 8=0009 9=000A
0=000B MINUS=000C EQUALS=000D BACKSPACE=000E TAB=000F CAPS_LOCK=003A A=001E
B=0030 C=002E D=0020 E=0012 F=0021 G=0022 H=0023
I=0017 J=0024 K=0025 L=0026 M=0032 N=0031 O=0018
P=0019 Q=0010 R=0013 S=001F T=0014 U=0016 V=002F
W=0011 X=002D Y=0015 Z=002C OPEN_BRACKET=001A CLOSE_BRACKET=001B BACK_SLASH=002B
SEMICOLON=0027 QUOTE=0028 ENTER=001C COMMA=0033 PERIOD=0034 SLASH=0035 SPACE=0039
PRINTSCREEN=0E37 SCROLL_LOCK=0046 PAUSE=0E45 LESSER_GREATER=0E46 INSERT=0E52 DELETE=0E53 HOME=0E47
END=0E4F PAGE_UP=0E49 PAGE_DOWN=0E51 UP=E048 LEFT=E04B CLEAR=E04C RIGHT=E04D
DOWN=E050 NUM_LOCK=0045 KP_DIVIDE=0E35 KP_MULTIPLY=0037 KP_SUBTRACT=004A KP_EQUALS=0E0D KP_ADD=004E
KP_ENTER=0E1C KP_SEPARATOR=0053 KP_1=004F KP_2=0050 KP_3=0051 KP_4=004B KP_5=004C
KP_6=004D KP_7=0047 KP_8=0048 KP_9=0049 KP_0=0052 KP_END=EE4F KP_DOWN=EE50
KP_PAGE_DOWN=EE51 KP_LEFT=EE4B KP_CLEAR=EE4C KP_RIGHT=EE4D KP_HOME=EE47 KP_UP=EE48 KP_PAGE_UP=EE49
KP_INSERT=EE52 KP_DELETE=EE53 SHIFT_L=002A SHIFT_R=0036 CONTROL_L=001D CONTROL_R=0E1D ALT_L=0038
ALT_R=0E38 META_L=0E5B META_R=0E5C CONTEXT_MENU=0E5D POWER=E05E SLEEP=E05F WAKE=E063
MEDIA_PLAY=E022 MEDIA_STOP=E024 MEDIA_PREVIOUS=E010 MEDIA_NEXT=E019 MEDIA_SELECT=E06D MEDIA_EJECT=E02C VOLUME_MUTE=E020
VOLUME_UP=E030 VOLUME_DOWN=E02E APP_MAIL=E06C APP_CALCULATOR=E021 APP_MUSIC=E03C APP_PICTURES=E064 BROWSER_SEARCH=E065
BROWSER_HOME=E032 BROWSER_BACK=E06A BROWSER_FORWARD=E069 BROWSER_STOP=E068 BROWSER_REFRESH=E067 BROWSER_FAVORITES=E066 KATAKANA=0070
UNDERSCORE=0073 FURIGANA=0077 KANJI=0079 HIRAGANA=007B YEN=007D KP_COMMA=007E SUN_HELP=FF75
SUN_STOP=FF78 SUN_PROPS=FF76 SUN_FRONT=FF77 SUN_OPEN=FF74 SUN_FIND=FF7E SUN_AGAIN=FF79 SUN_UNDO=FF7A
SUN_COPY=FF7C SUN_INSERT=FF7D SUN_CUT=FF7B UNDEFINED=0000
`.trim().split(/\s+/).map(pair => {
  const [name, hex] = pair.split('=');
  return ['VC_' + name, parseInt(hex, 16)];
});

function readVCDefinitions(header) {
  // 除数字定义外，头文件用 0xEE00 | VC_KP_* 表示 NumLock 关闭的小键盘。
  const values = new Map();
  for (const line of header.split(/\r?\n/)) {
    const match = /^#define\s+(VC_\w+)\s+(.+?)(?:\s*\/\/.*)?$/.exec(line);
    if (!match) continue;
    let value = 0;
    for (const token of match[2].trim().split(/\s*\|\s*/)) {
      const part = values.has(token) ? values.get(token) : Number(token);
      assert(Number.isInteger(part), '无法解析头文件 ' + match[1] + ' ' + token);
      value |= part;
    }
    values.set(match[1], value);
  }
  return values;
}

function checkKeycodes() {
  const { codeForKeycode } = require('./input-hook');
  const file = path.join(__dirname, 'node_modules/uiohook-napi/libuiohook/include/uiohook.h');
  let values;
  let source;
  if (fs.existsSync(file)) {
    values = readVCDefinitions(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(new Map(packedVC), values, '安装包自检快照需与实际头文件同步');
    source = '本地头文件';
  } else {
    assert(require('electron').app?.isPackaged, '源码自检缺少 ' + file);
    values = new Map(packedVC);
    source = '打包用 1.5.5 头文件快照';
  }
  const required = {
    A: 'KeyA', 1: 'Digit1', SPACE: 'Space', ENTER: 'Enter', KP_ENTER: 'NumpadEnter',
    KP_7: 'Numpad7', KP_HOME: 'Numpad7', LEFT: 'ArrowLeft', HOME: 'Home',
    PAGE_DOWN: 'PageDown', INSERT: 'Insert', DELETE: 'Delete', CONTROL_L: 'ControlLeft',
    CONTROL_R: 'ControlRight', ALT_L: 'AltLeft', ALT_R: 'AltRight', SHIFT_L: 'ShiftLeft',
    SHIFT_R: 'ShiftRight', META_L: 'MetaLeft', META_R: 'MetaRight', CAPS_LOCK: 'CapsLock',
    PRINTSCREEN: 'PrintScreen', BACKQUOTE: 'Backquote', BACK_SLASH: 'Backslash',
    LESSER_GREATER: 'IntlBackslash',
  };
  for (let i = 1; i <= 12; i++) required['F' + i] = 'F' + i;
  for (const [suffix, code] of Object.entries(required)) {
    const name = 'VC_' + suffix;
    assert(values.has(name), '头文件中缺少 ' + name);
    assert.equal(codeForKeycode(values.get(name)), code, name);
  }
  const unmapped = [...values].filter(([, value]) => !codeForKeycode(value)).map(([name]) => name);
  return source + '，检查 ' + values.size + ' 个 VC 定义。映射不到的 VC 名单：' + (unmapped.join(', ') || '无');
}

async function capture(contents) {
  const image = await contents.capturePage();
  assert(!image.isEmpty(), 'capturePage 返回空图');
  const scaleFactor = image.getScaleFactors()[0] || 1;
  const png = image.toPNG({ scaleFactor });
  // PNG IHDR 是物理像素尺寸；Retina 上不把窗口的 DIP 尺寸当作位图步幅。
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitmap = image.toBitmap({ scaleFactor });
  assert.equal(bitmap.length, width * height * 4, 'BGRA 长度与 PNG 尺寸不符');
  return { png, width, height, bitmap };
}

function composite({ width, height, bitmap }, checker) {
  const { nativeImage } = require('electron');
  const output = Buffer.alloc(bitmap.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const background = checker ? ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 180 : 224) : 127;
      // NativeImage 在这两个 little-endian 平台上返回预乘 alpha 的 BGRA。
      const behind = Math.round(background * (255 - bitmap[i + 3]) / 255);
      for (let c = 0; c < 3; c++) output[i + c] = Math.min(255, bitmap[i + c] + behind);
      output[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(output, { width, height }).toPNG();
}

function verifyTransparency({ width, height, bitmap }) {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map(i => bitmap[4 * i + 3]);
  assert.deepEqual(corners, [0, 0, 0, 0], '四角 alpha 为 ' + corners.join(', '));
  let left = width, top = height, right = -1, bottom = -1, count = 0;
  for (let i = 0; i < width * height; i++) {
    if (!bitmap[4 * i + 3]) continue;
    const x = i % width, y = Math.floor(i / width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    count++;
  }
  assert(count > width * height * 0.01, '非透明像素太少：' + count);
  assert(left >= 0 && top >= 0 && right < width && bottom < height, '猫的包围盒超出位图');
  return width + '×' + height + '；四角透明，非透明像素 ' + count + '，包围盒 ' + [left, top, right, bottom].join(',');
}

function prototypeSource(dir) {
  let source = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) source += prototypeSource(file);
    else if (/\.(?:html|js)$/.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('__TAURI__') || /\b(?:invoke|listen)\(\s*['"]/.test(text)) source += text + '\n';
    }
  }
  return source;
}

function checkContract(prototypeDir, packaged = false) {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const dispatch = main.slice(main.indexOf('function invokeCommand('), main.indexOf('function windowMethod('));
  const commands = new Set([...dispatch.matchAll(/case '([^']+)':/g)].map(match => match[1]));
  const checkCommand = name => {
    if (name === 'open_login_items') assert(!commands.has(name), 'Windows 不注册此命令');
    else assert(commands.has(name), '缺少命令 ' + name);
  };
  const roots = [];
  if (!packaged) {
    const root = path.resolve(__dirname, '..');
    roots.push(root);
    const dotgit = path.join(root, '.git');
    if (fs.existsSync(dotgit) && fs.statSync(dotgit).isFile()) {
      const gitdir = path.resolve(root, fs.readFileSync(dotgit, 'utf8').replace(/^gitdir:\s*/, '').trim());
      const common = fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim();
      const primary = path.resolve(gitdir, common, '..');
      if (primary !== root && fs.existsSync(path.join(primary, 'src-tauri/src/main.rs'))) roots.push(primary);
    }
    for (const checkout of roots) {
      const rust = fs.readFileSync(path.join(checkout, 'src-tauri/src/main.rs'), 'utf8');
      const handler = /generate_handler!\[([\s\S]*?)\]\)/.exec(rust);
      assert(handler, '找不到 generate_handler! 注册表');
      for (const token of handler[1].replace(/#\[.*?\]/g, '').split(',')) {
        const name = token.trim().split('::').pop();
        if (name) checkCommand(name);
      }
      assert.equal(require('./package.json').version, readJSON(path.join(checkout, 'src-tauri/tauri.conf.json')).version);
    }
  }
  const source = prototypeSource(prototypeDir);
  for (const call of source.matchAll(/\binvoke\(\s*['"]([^'"]+)['"]/g)) checkCommand(call[1]);
  for (const call of source.matchAll(/\blisten\(\s*['"]([^'"]+)['"]/g)) {
    assert(main.includes("send('" + call[1] + "'"), '缺少事件 ' + call[1]);
  }
  const properties = [...source.matchAll(/(?:__TAURI__|\bT)\.(\w+)(?:\.(\w+))?/g)]
    .map(m => [m[1], m[2]].filter(Boolean).join('.'));
  const methods = [...source.matchAll(/(?:\bappWin|\bwin|getCurrentWindow\(\))\.(\w+)\(/g)].map(m => m[1]);
  return { properties: [...new Set(properties)], methods: [...new Set(methods)], checkouts: roots.length };
}

async function run(ctx, check) {
  const { win, userData, out } = ctx;
  const win7 = process.platform === 'win32' && /^6\.1(?:\.|$)/.test(require('os').release()) &&
    !require('electron').systemPreferences.isAeroGlassEnabled();
  const contents = win.webContents;
  const page = source => contents.executeJavaScript(source);
  const invoke = (cmd, args = {}) => page('window.__TAURI__.core.invoke(' + JSON.stringify(cmd) + ',' + JSON.stringify(args) + ')');
  const windowCall = (method, ...args) => page('window.__TAURI__.window.getCurrentWindow().' + method + '(' + args.map(arg => JSON.stringify(arg)).join(',') + ')');
  const readState = name => readJSON(path.join(userData, name + '.json'));
  const item = label => ctx.menuTemplate().find(entry => entry.label === label);
  const click = async label => {
    const entry = item(label);
    // Menu.popup 选中 checkbox 后会先切换 checked，再调用 click(menuItem, window, event)。
    if (entry.type === 'checkbox') entry.checked = !entry.checked;
    await entry.click(entry, win, {});
  };
  const lock = async desired => {
    if (await invoke('position_locked') !== desired) await click('锁定位置');
    assert.equal(await invoke('position_locked'), desired);
  };
  const dragEnd = async () => {
    await page("document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))");
    await until('preload 转发松开事件', () => !ctx.isDragging());
  };
  const moveCursorOutside = () => {
    const { x, y } = win.getContentBounds();
    ctx.setCursor({ x: x - 80, y: y - 80 });
  };
  await check('Tauri 命令、事件、窗口契约及版本号', async () => {
    const contract = checkContract(path.dirname(ctx.indexPath), require('electron').app.isPackaged);
    for (const property of contract.properties) {
      assert(await page('typeof window.__TAURI__.' + property + ' !== "undefined"'), '缺少 __TAURI__.' + property);
    }
    for (const method of contract.methods) {
      assert.equal(await page('typeof __TAURI__.window.getCurrentWindow().' + method), 'function', method);
    }
    return JSON.stringify(contract);
  });
  await check('页面与桌面模式', async () => {
    const state = await page(`({
      desktop: document.documentElement.classList.contains('desktop'),
      card: document.documentElement.classList.contains('win7-card'),
      cat: !!window.__cat, input: SillyDesktopInput.isDesktop()
    })`);
    assert.deepEqual(state, { desktop: true, card: win7, cat: true, input: true });
    assert.deepEqual(ctx.consoleErrors, [], '页面加载期间出现 console error：' + ctx.consoleErrors.join(' | '));
    return 'desktop、__cat、桌面输入均已就位，win7-card=' + win7;
  });
  const expectedCommands = {
    platform_flags: { win7 }, load_settings: null, position_locked: false,
    click_through_status: { enabled: false, available: true },
    input_status: { granted: true, keys: false, mouse: false, keyboard: 'unsupported', needs_permission: false },
    update_status: null, updater_configured: true, app_version: require('electron').app.getVersion(),
    autostart_status: { enabled: false, needs_approval: false, platform: 'windows' },
  };
  for (const [cmd, expected] of Object.entries(expectedCommands)) {
    await check('invoke ' + cmd, async () => {
      assert.deepEqual(await invoke(cmd), expected);
      return JSON.stringify(expected);
    });
  }
  for (const cmd of ['show_context_menu', 'install_update']) {
    await check('invoke ' + cmd, async () => {
      await invoke(cmd);
      return '页面调用已返回';
    });
  }
  const rejections = {
    open_input_monitoring: '只有 macOS 需要输入监控授权', reset_input_monitoring: '只有 macOS 需要输入监控授权',
    open_link: '未知链接', open_login_items: 'unknown command: open_login_items',
    selftest_unknown: 'unknown command: selftest_unknown',
  };
  if (process.platform !== 'win32') rejections.held_input_state = 'unsupported';
  for (const [cmd, message] of Object.entries(rejections)) {
    await check('invoke ' + cmd, async () => {
      // 在页面里捕获 reject，避免 executeJavaScript 包装异常并丢失 reason。
      const reason = await page(`__TAURI__.core.invoke(${JSON.stringify(cmd)}).then(() => null, e => String(e))`);
      assert(typeof reason === 'string' && reason.includes(message), '期望 reject ' + message + '，实际 ' + reason);
      return reason;
    });
  }
  await check('开机自启、任务管理器禁用和重新启用（桩）', async () => {
    assert.equal((await invoke('set_autostart', { enabled: true })).enabled, true);
    ctx.systemTest.launchItems[0].enabled = false;
    ctx.systemTest.launchItems.push({ name: 'SillyCat', scope: 'user', enabled: true, args: [] });
    assert.equal((await invoke('autostart_status')).enabled, false);
    assert.equal((await invoke('set_autostart', { enabled: true })).enabled, true);
    assert.equal((await invoke('set_autostart', { enabled: false })).enabled, false);
  });
  await check('已知链接和重启（桩）', async () => {
    for (const target of ['github', 'douyin']) await invoke('open_link', { target });
    assert.deepEqual(ctx.systemTest.openedLinks, ['https://github.com/S0u1/silly-cat',
      'https://www.douyin.com/user/MS4wLjABAAAAgiL6r1k59SPVX7I3Hu2RImPW3Vs5RR2UUEjduDIP3jM']);
    await invoke('restart_app');
    assert.equal(ctx.systemTest.restarts, 1);
  });
  await check('cursor_local', async () => {
    const cb = win.getContentBounds();
    const p = { x: cb.x + 22, y: cb.y + 15 };
    ctx.setCursor(p);
    const c = await invoke('cursor_local');
    assert.deepEqual(c, { gx: p.x, gy: p.y, x: 22, y: 15 });
    return JSON.stringify(c);
  });
  await check('设置窗口的单实例、尺寸、IPC、事件与菜单检查更新', async () => {
    await Promise.all([invoke('open_settings'), invoke('open_settings')]);
    const settings = ctx.getSettingsWindow();
    assert(settings && settings !== win && settings.isVisible());
    const wc = settings.webContents;
    const settingsPage = source => wc.executeJavaScript(source);
    const mainBounds = win.getBounds();
    try {
      await click('设置…');
      assert.equal(ctx.getSettingsWindow(), settings);
      assert.equal(settings.getTitle(), '捣蛋猫 · 设置');
      assert(!settings.isResizable() && !settings.isMaximizable() && !settings.isMinimizable());
      assert.equal(await settingsPage('typeof __TAURI__.window.LogicalSize'), 'function');
      await settingsPage('__TAURI__.window.getCurrentWindow().setSize(new __TAURI__.dpi.LogicalSize(400, 370))');
      assert.deepEqual(settings.getContentSize(), [400, 370]);
      assert.deepEqual(win.getBounds(), mainBounds);
      await settingsPage(`(async () => {
        window.eventsSeen = [];
        for (const name of ['silly:settings','silly:lock','silly:update','silly:key','silly:button'])
          await __TAURI__.event.listen(name, e => eventsSeen.push(e.event));
        await __TAURI__.core.invoke('save_settings', { settings: { size: 1, cat: 'cow' } });
      })()`);
      assert.deepEqual(await settingsPage("__TAURI__.core.invoke('load_settings')"), { size: 1, cat: 'cow' });
      await click('锁定位置');
      await click('锁定位置');
      ctx.send('silly:key', { code: 'KeyA', down: false });
      ctx.send('silly:button', { button: 0, down: false });
      await click('检查更新…');
      assert.equal(ctx.getSettingsWindow(), settings);
      await until('设置窗口收到更新和输入事件', async () =>
        await settingsPage("['silly:key','silly:button','silly:update'].every(e => eventsSeen.includes(e))"));
      assert.equal(await settingsPage("eventsSeen.some(e => e === 'silly:settings' || e === 'silly:lock')"), false);
      assert.equal((await invoke('update_status')).kind, 'result');
      assert.equal(ctx.callerWindow({ sender: wc, senderFrame: wc.mainFrame }), settings);
      assert.equal(ctx.callerWindow({ sender: wc, senderFrame: { url: wc.getURL() } }), null);
      assert.equal(ctx.callerWindow({ sender: contents, senderFrame: wc.mainFrame }), null);
      for (const url of [contents.getURL(), 'https://example.invalid/', 'file:///elsewhere/settings.html']) {
        assert.equal(ctx.isPage(url, ctx.settingsPath), false);
      }
      const { BrowserWindow } = require('electron');
      const other = new BrowserWindow({ show: false, webPreferences: {
        preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false
      } });
      try {
        await other.loadFile(ctx.settingsPath);
        const reason = await other.webContents.executeJavaScript(
          "__TAURI__.core.invoke('load_settings').then(() => '', e => e.message)");
        assert.equal(reason, 'unauthorized IPC sender');
      } finally { other.destroy(); }
      await settingsPage("__TAURI__.window.getCurrentWindow().close(); true");
      await until('设置窗口关闭', () => settings.isDestroyed());
      assert(!win.isDestroyed() && win.isVisible());
    } finally {
      if (!settings.isDestroyed()) settings.destroy();
    }
  });
  await check('preview_cat_size', async () => {
    const before = win.getBounds();
    try {
      await invoke('preview_cat_size', { size: 0.75 });
      const b = win.getBounds();
      assert.equal(b.width, 315);
      assert.equal(b.height, 259);
      assert.equal(b.x + b.width, before.x + before.width);
      assert.equal(b.y + b.height, before.y + before.height);
      return '0.75 倍，右下角固定';
    } finally {
      await invoke('preview_cat_size', { size: 1 });
    }
  });
  await check('close 主窗口', async () => {
    let requested = false;
    win.once('close', event => { requested = true; event.preventDefault(); });
    await windowCall('close');
    await until('主窗口收到 close', () => requested);
    return '已收到关闭请求并由自测截住';
  });

  async function eventRoundtrip(name, first, second, expected) {
    await page(`(async () => {
      window.__selftestEvents = [];
      window.__selftestUnlisten = await __TAURI__.event.listen(${JSON.stringify(name)}, e => __selftestEvents.push(e));
    })()`);
    try {
      await first();
      await until(name, () => page('__selftestEvents.length > 0'));
      const [ev] = await page('__selftestEvents.slice()');
      assert.equal(ev.event, name);
      assert(Number.isInteger(ev.id), '事件 id 缺失');
      assert.deepEqual(ev.payload, expected);
      await page('__selftestUnlisten()');
      await second();
      await delay(100);
      assert.equal(await page('__selftestEvents.length'), 1, '取消订阅后仍然收到事件');
    } finally {
      await page('if (window.__selftestUnlisten) __selftestUnlisten(); delete window.__selftestUnlisten; delete window.__selftestEvents;');
    }
    return '事件名称、数字 id、payload 与取消订阅均通过';
  }
  await check('silly:settings 订阅', async () => {
    const settings = { cat: 'cow', size: 1 };
    return eventRoundtrip('silly:settings', () => invoke('save_settings', { settings }),
      () => invoke('save_settings', { settings }), settings);
  });
  await check('silly:lock 订阅', async () => {
    await lock(false);
    try {
      return await eventRoundtrip('silly:lock', () => click('锁定位置'), () => click('锁定位置'), true);
    } finally {
      await lock(false);
    }
  });
  await check('设置持久化与换猫', async () => {
    const defaults = await page('({...SillySettings.DEFAULTS})');
    await invoke('save_settings', { settings: defaults });
    await until('牛奶猫', () => page("SillyCoats.current().id === 'cow'"));
    const orange = { ...defaults, cat: 'orange', sleep: 240 };
    await invoke('save_settings', { settings: orange });
    assert.deepEqual(readState('settings'), orange);
    assert.deepEqual(await invoke('load_settings'), orange);
    await until('橘猫', () => page("SillyCoats.current().id === 'orange'"));
    return '磁盘、load_settings 一致；页面 SillyCoats.current().id 从 cow 变为 orange';
  });
  await check('设置错误恢复', async () => {
    const file = path.join(userData, 'settings.json');
    for (const raw of ['{broken', '[]', '42']) {
      fs.writeFileSync(file, raw);
      assert.equal(await invoke('load_settings'), null, '未忽略损坏或非对象设置 ' + raw);
    }
    assert.equal(await page("__TAURI__.core.invoke('save_settings',{settings:[]}).then(()=>false,()=>true)"), true);
    return '坏 JSON、数组、数字读为 null，保存数组被拒绝';
  });
  await check('键盘输入通道', async () => {
    assert.equal(await page("__cat.pressed.includes('KeyA')"), false);
    ctx.send('silly:key', { code: 'KeyA', down: true });
    try {
      await delay(150);
      assert.equal(await page("__cat.pressed.includes('KeyA')"), true, '猫未按下测试键');
    } finally {
      ctx.send('silly:key', { code: 'KeyA', down: false });
    }
    await until('猫抬爪', () => page("!__cat.pressed.includes('KeyA')"));
    return '__cat.pressed 随注入事件按下并释放';
  });
  await check('鼠标输入通道', async () => {
    moveCursorOutside();
    await delay(100);
    assert.equal(await page("__desktop.over || document.querySelector('#mouse-btn-l').classList.contains('down')"), false);
    ctx.send('silly:button', { button: 0, down: true });
    try {
      await delay(150);
      assert.equal(await page("document.querySelector('#mouse-btn-l').classList.contains('down')"), true);
      assert(['reaching', 'on-mouse'].includes(await page('__cat.tail')), '尾巴没有伸向鼠标');
    } finally {
      ctx.send('silly:button', { button: 0, down: false });
    }
    await until('左键释放', () => page("!document.querySelector('#mouse-btn-l').classList.contains('down')"));
    return '鼠标左键 SVG 与 __cat.tail 均响应';
  });
  await check('穿透与拖动中推迟穿透', async () => {
    await lock(false);
    moveCursorOutside();
    await delay(100); // 等页面的命中状态稳定，随后使用同一个假光标
    const expectedArgs = v => process.env.SILLYCAT_NO_FORWARD === '1' ? [v] : [v, { forward: true }];
    for (const v of [true, false]) {
      await windowCall('setIgnoreCursorEvents', v);
      assert.equal(ctx.getIgnore().applied, v);
      assert.deepEqual(ctx.getIgnore().lastArgs, expectedArgs(v));
    }
    await windowCall('startDragging');
    try {
      assert(ctx.isDragging(), '拖动未开始');
      await windowCall('setIgnoreCursorEvents', true);
      assert.equal(ctx.getIgnore().desired, true);
      assert.equal(ctx.getIgnore().applied, false);
      assert.deepEqual(ctx.getIgnore().lastArgs, expectedArgs(false));
    } finally {
      await dragEnd();
    }
    assert.equal(ctx.getIgnore().applied, true);
    assert.deepEqual(ctx.getIgnore().lastArgs, expectedArgs(true));
    return '传给 setIgnoreMouseEvents 的实参与模式一致，松开后才恢复穿透';
  });
  await check('开启鼠标穿透立即结束拖动', async () => {
    await lock(false);
    try {
      await windowCall('setIgnoreCursorEvents', false);
      await windowCall('startDragging');
      assert(ctx.isDragging());
      await click('鼠标穿透');
      assert(!ctx.isDragging());
      assert(ctx.getIgnore().applied);
      await windowCall('setIgnoreCursorEvents', false);
      assert(ctx.getIgnore().applied);
      assert.equal(item('鼠标穿透').checked, true);
      assert.deepEqual(readState('click-through'), { enabled: true });
      assert.deepEqual(await invoke('set_click_through', { enabled: false }), { enabled: false, available: true });
      assert.equal(item('鼠标穿透').checked, false);
      assert.equal(await invoke('position_locked'), false);
      return '菜单启用后结束拖动、持续穿透并存盘，设置命令可关闭';
    } finally {
      await invoke('set_click_through', { enabled: false });
      if (ctx.isDragging()) await dragEnd();
    }
  });
  await check('拖动、位置存盘与锁定', async () => {
    await lock(false);
    try {
      // 起点向左挪出余量，避免在屏幕右缘测试时被窗口管理器约束。
      const b = win.getBounds();
      win.setBounds({ ...b, x: b.x - 70 });
      const initial = win.getBounds();
      const p = { x: initial.x + 20, y: initial.y + 20 };
      ctx.setCursor(p);
      await windowCall('startDragging');
      assert(ctx.isDragging(), '未开始拖动');
      ctx.setCursor({ x: p.x + 50, y: p.y - 30 });
      await delay(100);
      const moved = win.getBounds();
      assert(Math.abs(moved.x - initial.x - 50) <= 1 && Math.abs(moved.y - initial.y + 30) <= 1,
        '意外位移 ' + JSON.stringify({ initial, moved }));
      assert.equal(moved.width, initial.width);
      assert.equal(moved.height, initial.height);
      await dragEnd();
      await delay(500);
      assert.deepEqual(readState('window-position'), position(moved));
      await lock(true);
      await windowCall('startDragging');
      ctx.setCursor(p);
      await delay(100);
      assert(!ctx.isDragging(), '锁定时进入拖动');
      assert.deepEqual(win.getBounds(), moved);
      return '实际位移 ' + [moved.x - initial.x, moved.y - initial.y] + ' DIP，落盘坐标与窗口一致';
    } finally {
      if (ctx.isDragging()) await dragEnd();
      await lock(false);
    }
  });
  await check('菜单模板及动作', async () => {
    assert.deepEqual(ctx.menuTemplate().map(entry => entry.label || entry.type),
      ['设置…', '玩法说明…', '检查更新…', '显示/隐藏猫', '锁定位置', '鼠标穿透', '重置位置', '打开日志文件夹', 'separator', '退出']);
    await lock(false);
    win.showInactive();
    try {
      await click('显示/隐藏猫');
      assert.equal(win.isVisible(), false);
      await click('显示/隐藏猫');
      assert(win.isVisible(), '显示猫失败');
      await click('锁定位置');
      assert.equal(await invoke('position_locked'), true);
      assert.equal(item('锁定位置').checked, true);
      assert.deepEqual(readState('window-lock'), { locked: true });
      await click('重置位置');
      assert.deepEqual(position(win.getBounds()), position(ctx.defaultPos()));
      assert.equal(await invoke('position_locked'), true);
      await delay(500);
      assert.deepEqual(readState('window-position'), position(ctx.defaultPos()));
      await click('打开日志文件夹');
      assert.equal(ctx.getOpenedFolder(), userData);
      return '显示、隐藏、锁定、重置和打开日志位置回调通过，退出项仅检查标签';
    } finally {
      win.showInactive();
      await lock(false);
    }
  });
  await check('键位映射', checkKeycodes);
  await check('透明像素及合成截图', async () => {
    if (ctx.debugKey) await contents.removeInsertedCSS(ctx.debugKey);
    await delay(1000);
    const raw = await capture(contents);
    fs.writeFileSync(path.join(out, 'capture-raw.png'), raw.png);
    fs.writeFileSync(path.join(out, 'capture-gray.png'), composite(raw, false));
    fs.writeFileSync(path.join(out, 'capture-checker.png'), composite(raw, true));
    if (!win7) return verifyTransparency(raw);
    const center = Math.floor(raw.height / 2) * raw.width + Math.floor(raw.width / 2);
    assert.equal(raw.bitmap[center * 4 + 3], 255);
    assert.equal(await page('getComputedStyle(document.body).backgroundColor'), 'rgb(239, 230, 214)');
    return 'Win7 无桌面合成，卡片背景色和不透明像素通过';
  });
  await check('调试边框截图', async () => {
    const key = await ctx.applyDebugCSS();
    try {
      await delay(250);
      const shot = await capture(contents);
      fs.writeFileSync(path.join(out, 'capture-debug.png'), composite(shot, true));
      const pseudo = await page("getComputedStyle(document.documentElement, '::after').pointerEvents");
      assert.equal(pseudo, 'none');
      const middleOfTop = Math.floor(shot.width / 2) * 4;
      assert(shot.bitmap[middleOfTop + 3] > 0, '调试边框没有画在窗口上沿');
      return '实际调试 CSS 生效，棋盘背景合成已保存';
    } finally {
      await contents.removeInsertedCSS(key);
    }
  });
  await check('运行日志和错误副本', () => {
    const root = fs.mkdtempSync(path.join(userData, 'log-test-'));
    const desktop = path.join(root, 'Desktop');
    fs.mkdirSync(desktop);
    try {
      assert.equal(ctx.runLog().file, path.join(userData, 'silly-cat.log'));
      const file = path.join(root, 'silly-cat.log');
      ctx.appendLogLine(file, '中文\n第二行');
      assert.equal(fs.readFileSync(file, 'utf8'), '\uFEFF中文\r\n第二行\r\n');
      fs.appendFileSync(file, Buffer.alloc(256 * 1024, 'x'));
      const original = fs.readFileSync(file);
      ctx.appendLogLine(file, 'fatal');
      assert.deepEqual(fs.readFileSync(file + '.old'), original);
      assert.deepEqual(fs.readdirSync(desktop), []);
      assert(ctx.exportFatalLog(desktop, file, 'fallback'));
      const copy = path.join(desktop, '捣蛋猫兼容版-错误日志.txt');
      assert.equal(fs.readFileSync(copy, 'utf8'), '\uFEFFfatal\r\n');
      assert(ctx.exportFatalLog(desktop, null, userData + ' failed'));
      assert.equal(fs.readFileSync(copy, 'utf8'), '\uFEFF<userData> failed');
      assert.equal(ctx.exportFatalLog(file, file, 'failed'), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  await check('日志不记录路径', async () => {
    const os = require('os');
    // 1. scrub：已知目录换成符号，用户名、盘符路径、file:// 网址都不留
    const sample = [
      "EPERM open '" + userData + path.sep + "window-position.json'",
      'at f (' + process.resourcesPath + path.sep + 'app.asar' + path.sep + 'main.js:123:5)',
      'Failed to load file:///C:/Users/%E5%BC%A0%E4%B8%89/prototype/cat.js:12:3',
      'Require stack: - D:\\张三\\soft\\node_modules\\uiohook-napi\\dist\\index.js',
      'home ' + os.homedir() + path.sep + 'Desktop',
    ].map(ctx.scrub).join('\n');
    assert(sample.includes('<userData>') && sample.includes('main.js:123:5') && sample.includes('<file>/cat.js:12:3'), '符号化后丢了定位信息：' + sample);
    assert(sample.includes('index.js') && (sample.includes('<home>') || sample.includes('<desktop>')), sample);
    for (const needle of [userData, process.resourcesPath, os.homedir(), 'file://', '张三', 'D:\\', 'C:/']) {
      assert(!sample.includes(needle), 'scrub 之后仍然有 ' + needle + '：' + sample);
    }
    // 2. describePath：只给特征，不带路径本身
    assert.equal(ctx.describePath('C:\\用户\\a b'), 'drive=C: nonAscii=true spaces=true len=9');
    assert.equal(ctx.describePath('/tmp/x'), 'drive=- nonAscii=false spaces=false len=6');
    // 3. 这次运行真实写出的主日志里没有这些路径
    const text = fs.readFileSync(ctx.runLog().file, 'utf8');
    const forbidden = [userData, process.resourcesPath, process.execPath, os.homedir(), os.tmpdir(), __dirname, 'file://'];
    for (const needle of forbidden) assert(!text.includes(needle), '日志里出现了路径 ' + needle);
    assert(!/[A-Za-z]:[\\/]/.test(text), '日志里出现了盘符路径');
    assert(!/\/(Users|home)\//.test(text), '日志里出现了用户目录');
    assert(text.includes('exeDir[drive=') && text.includes('userData[drive='), '缺少路径特征行');
    return '已知目录、用户名、盘符路径、file:// 都被替换；运行日志' + text.split('\n').length + '行里没有路径，只有盘符/中文/空格/长度特征';
  });
  await check('诊断日志', async () => {
    const log = fs.readFileSync(ctx.runLog().file, 'utf8');
    for (const marker of ['Electron=' + process.versions.electron, 'Chromium=' + process.versions.chrome,
      'Node=' + process.versions.node, 'os.release=', 'GPU feature status', 'window created']) {
      assert(log.includes(marker), '缺少诊断行 ' + marker);
    }
    assert(log.split('GPU feature status').length >= 3, '缺少加载后第二次 GPU 状态');
    assert.deepEqual(ctx.consoleErrors, [], '页面 console error：' + ctx.consoleErrors.join(' | '));
    return '运行时版本、系统、两次 GPU 状态、窗口创建结果齐全';
  });
  ctx.setCursor(null);
}

module.exports = { run, checkKeycodes, checkContract };

if (require.main === module) {
  // 此入口不启动 Electron。系统调用必须由 --selftest 换成桩。
  assert(process.argv.includes('--selftest'));
  const main = require('./main');
  const { pathToFileURL } = require('url');
  const dir = path.resolve(__dirname, '..', 'prototype');
  const contract = checkContract(dir);
  const registered = {};
  let bridge;
  // 使用真实 preload 注册接口，避免两份各自维护的契约列表同时漏掉新 API。
  require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { ipcRenderer: { on: (name, callback) => { registered[name] = callback; } },
        contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, '__TAURI__'); bridge = value; } } };
    },
    document: { addEventListener() {} }, window: { addEventListener() {} }
  });
  for (const property of contract.properties) {
    assert.notEqual(property.split('.').reduce((obj, key) => obj?.[key], bridge), undefined, property);
  }
  for (const method of contract.methods) assert.equal(typeof bridge.window.getCurrentWindow()[method], 'function');
  assert.equal(typeof registered['silly:event'], 'function');
  assert.deepEqual(main.menuTemplate().map(e => e.label || e.type),
    ['设置…', '玩法说明…', '检查更新…', '显示/隐藏猫', '锁定位置', '鼠标穿透', '重置位置', '打开日志文件夹', 'separator', '退出']);
  for (const filename of ['index.html', 'settings.html']) {
    const file = path.join(dir, filename);
    assert(main.isPage(pathToFileURL(file).href, file));
    assert(!main.isPage(pathToFileURL(path.join(dir, 'different.html')).href, file));
    assert(!main.isPage('https://example.invalid/' + filename, file));
  }
  assert.equal(main.invokeCommand('set_autostart', { enabled: true }).enabled, true);
  main.systemTest.launchItems[0].enabled = false;
  assert.equal(main.invokeCommand('autostart_status').enabled, false);
  assert.equal(main.invokeCommand('set_autostart', { enabled: false }).enabled, false);
  main.invokeCommand('open_link', { target: 'github' });
  assert.deepEqual(main.systemTest.openedLinks, ['https://github.com/ailcc/silly-cat']);
  assert.throws(() => main.invokeCommand('open_link', { target: 'other' }), /未知链接/);
  main.invokeCommand('restart_app');
  assert.equal(main.systemTest.restarts, 1);
  console.log('HEADLESS CONTRACT PASS', contract);
}
