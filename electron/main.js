'use strict';

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Tray, nativeImage, shell, screen, systemPreferences, net, session } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fileURLToPath } = require('url');

const selftest = process.argv.includes('--selftest');
const debug = process.env.SILLYCAT_DEBUG === '1';
const indexPath = app?.isPackaged
  ? path.join(process.resourcesPath, 'prototype', 'index.html')
  : path.join(__dirname, '..', 'prototype', 'index.html');
const settingsPath = path.join(path.dirname(indexPath), 'settings.html');
const helpPath = path.join(path.dirname(indexPath), 'help.html');
const iconPath = app?.isPackaged
  ? path.join(process.resourcesPath, 'tray.png')
  : path.join(__dirname, '..', 'src-tauri', 'icons', '32x32.png');
const border = 'html::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483647;outline:2px solid #ff00ff;outline-offset:-2px;box-shadow:inset 0 0 0 4px rgba(0,255,255,.55)}';
let userData, win, settingsWin, settingsLoading, updater, out, watchdog, debugKey;
const hook = require('./input-hook');
let win7Card = false;
// Win7 没有 DirectComposition。Electron 22 开点穿时会给窗口加上 WS_EX_LAYERED 却不设分层属性，
// GPU 画的透明窗口和不透明的底色小窗都会因此停止刷新，只有鼠标在猫身上（关掉点穿）时才刷新。
// 所以 Win7 默认走软件绘制，见 boot() 和 ready()。
const isWin7 = process.platform === 'win32' && /^6\.1(?:\.|$)/.test(os.release());
let softwareRendering = false;
let cardGeometry;
let loaded = false, failed = false, reported = false;
const results = [], consoleErrors = [];

const RUN_LOG_NAME = 'silly-cat.log';
const ERROR_LOG_NAME = '捣蛋猫兼容版-错误日志.txt';
const DEFAULT_PET_TITLE = '捣蛋奶牛猫';

function currentRunLog() {
  return { file: userData && path.join(userData, RUN_LOG_NAME) };
}

function appendLogLine(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let size = 0;
  try { size = fs.statSync(file).size; } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (size > 256 * 1024) {
    fs.renameSync(file, file + '.old');
    size = 0;
  }
  fs.appendFileSync(file, (size ? '' : '\uFEFF') + text.replace(/\r?\n/g, '\r\n') + '\r\n');
}

function exportFatalLog(desktop, file, detail) {
  let body;
  try { body = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch (_) {}
  try {
    fs.writeFileSync(path.join(desktop, ERROR_LOG_NAME), '\uFEFF' + (body || scrub(detail).replace(/\r?\n/g, '\r\n')));
    return true;
  } catch (_) { return false; }
}

// ---- 日志里不记录任何会带用户名的路径 ----
// 做法：所有进日志的文字都过 scrub()。已知的目录（用户目录、数据目录、程序目录、桌面……）换成 <home>、<userData> 这类符号；
// 用户名本身换成 <user>；其余长得像路径的（盘符路径、UNC、file:// 网址）只留最后一个文件名（保留 main.js:123 这类定位信息）。
// 路径对排查有用的特征（盘符、有没有中文/空格）用 describePath() 单独记，不带路径本身。
function knownDirs() {
  const list = [];
  const add = (token, value) => { if (typeof value === 'string' && value.length > 2) list.push([value, token]); };
  const tryPath = (name) => { try { return app.getPath(name); } catch (_) { return undefined; } };
  add('<userData>', userData);
  add('<app>', (() => { try { return app.getAppPath(); } catch (_) { return undefined; } })());
  add('<resources>', process.resourcesPath);
  add('<exe>', process.execPath);
  add('<exeDir>', path.dirname(process.execPath));
  add('<app>', __dirname);
  add('<desktop>', tryPath('desktop'));
  add('<appData>', tryPath('appData'));
  add('<temp>', tryPath('temp'));
  add('<temp>', os.tmpdir());
  add('<home>', os.homedir());
  // 同一个目录的正斜杠写法也要换；长的先换，免得被短的（如用户目录）抢先
  for (const [value, token] of list.slice()) {
    const forward = value.replace(/\\/g, '/');
    if (forward !== value) list.push([forward, token]);
  }
  return list.sort((a, b) => b[0].length - a[0].length);
}

function scrub(text) {
  let out = String(text);
  for (const [value, token] of knownDirs()) out = out.split(value).join(token);
  try {
    const name = os.userInfo().username;
    if (name) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('(?<![\\w])' + escaped + '(?![\\w])', 'gi'), '<user>');
    }
  } catch (_) {}
  // 完整目录分量可以有空格。仅保留文件名，用于定位出错的模块。
  return out
    .replace(/file:\/\/\/?(?:[^\s'")\]]*\/)?([^\/\s'")\]]*)/gi, '<file>/$1')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)(?:[^\\/\r\n'"|*?)\]]+[\\/])*([^\\/\s'"|*?)\]]*)/g, '<path>\\$1');
}

// 只描述路径的特征，不带路径本身：盘符、有没有非 ASCII 字符（中文目录常见问题）、有没有空格、长度
function describePath(p) {
  const text = String(p || '');
  const drive = /^[A-Za-z]:/.exec(text);
  return 'drive=' + (drive ? drive[0] : '-') + ' nonAscii=' + /[^\x00-\x7F]/.test(text) +
    ' spaces=' + /\s/.test(text) + ' len=' + text.length;
}

function log(level, message) {
  const line = new Date().toISOString() + ' [' + level + '] ' + scrub(message);
  try { console.log(line); } catch (_) {}
  try {
    const info = currentRunLog();
    if (info.file) appendLogLine(info.file, line);
  } catch (_) {}
}

function finishTest() {
  if (reported) return;
  reported = true;
  clearTimeout(watchdog);
  try {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'selftest.json'), JSON.stringify(results, null, 2));
  } catch (e) { results.push({ name: '结果写盘', ok: false, detail: e.message }); }
  const ok = results.length > 0 && results.every(item => item.ok);
  console.log(JSON.stringify(results, null, 2));
  console.log('selftest output: ' + out);
  console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL');
  process.exitCode = ok ? 0 : 1;
  app.once('will-quit', () => app.exit(process.exitCode));
  app.quit();
}

function fatal(title, detail) {
  if (failed) return;
  failed = true;
  const reason = title + '\n' + scrub(detail);
  log('FATAL', reason);
  let desktop;
  try { desktop = selftest ? userData : app.getPath('desktop'); } catch (_) {}
  const exported = exportFatalLog(desktop, currentRunLog().file, reason);
  const hint = exported ? '请查看桌面上的 ' + ERROR_LOG_NAME
    : '请到 %APPDATA%\\com.drew.sillycat\\ 找 silly-cat.log';
  const message = reason + '\n\n' + hint;
  if (selftest) {
    results.push({ name: title, ok: false, detail: String(detail) });
    finishTest();
  } else {
    try { dialog.showErrorBox('捣蛋猫 兼容版', message); } finally { app.exit(1); }
  }
}

function send(name, payload) {
  const targets = [loaded && win];
  if (['silly:key', 'silly:button', 'silly:update', 'silly:click-through'].includes(name)) targets.push(settingsWin);
  for (const target of targets) {
    if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
      target.webContents.send('silly:event', name, payload);
    }
  }
}
function applyDebugCSS() { return win.webContents.insertCSS(border); }
function gpuStatus() {
  log('INFO', 'GPU feature status ' + JSON.stringify(app.getGPUFeatureStatus()));
}
function runtimeInfo() {
  log('INFO', '========== 新的一次启动 ==========');
  const v = process.versions;
  const cpus = os.cpus() || [];
  log('INFO', app.getName() + ' ' + app.getVersion() + ' Electron=' + v.electron +
    ' Chromium=' + v.chrome + ' Node=' + v.node + ' V8=' + v.v8);
  log('INFO', process.platform + '/' + process.arch + ' os.release=' + os.release() +
    ' os.version=' + (os.version ? os.version() : '') + ' os.arch=' + os.arch() +
    ' CPU=' + cpus[0]?.model + ' cores=' + cpus.length + ' memory=' + os.totalmem());
  let desktopDir;
  try { desktopDir = app.getPath('desktop'); } catch (_) {}
  log('INFO', 'isPackaged=' + app.isPackaged + ' exeDir[' + describePath(path.dirname(process.execPath)) +
    '] userData[' + describePath(userData) + '] desktop[' + describePath(desktopDir) + ']' +
    ' argvFlags=' + JSON.stringify(process.argv.filter(arg => /^--[\w-]/.test(arg))));
  for (const key of ['SILLYCAT_DEBUG', 'SILLYCAT_NO_FORWARD', 'SILLYCAT_DISABLE_GPU']) {
    log('INFO', key + '=' + (process.env[key] ?? '(unset)'));
  }
  log('INFO', 'setIgnoreMouseEvents forward=' + (process.env.SILLYCAT_NO_FORWARD !== '1'));
}

function isPage(url, expectedPath) {
  try {
    const parsed = new URL(url);
    // Windows 路径不区分大小写：盘符或目录大小写和 Chromium 回报的不一致时，不能把整页 IPC 误拒掉。
    const norm = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    return parsed.protocol === 'file:' && !parsed.host && !parsed.search &&
      norm(fileURLToPath(parsed)) === norm(expectedPath);
  } catch (_) { return false; }
}

function secureWindow(window, pagePath) {
  const wc = window.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event, url) => {
    if (!isPage(url, pagePath)) event.preventDefault();
  });
  wc.once('render-process-gone', (_, details) => fatal('页面进程已退出', JSON.stringify(details)));
  window.on('page-title-updated', event => event.preventDefault());
}

function webPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
    sandbox: true, backgroundThrottling: false, spellcheck: false, devTools: debug || selftest
  };
}

function shapeCard() {
  if (!win7Card || !liveWindow()) return;
  const { width, height } = win.getContentBounds();
  // Windows 应用区域后可能再次发同尺寸 resize 消息。
  if (width === cardGeometry?.width && height === cardGeometry?.height) return;
  cardGeometry = { width, height };
  const radius = Math.min(18, Math.floor(Math.min(width, height) / 2));
  const rects = [{ x: 0, y: radius, width, height: height - 2 * radius }];
  for (let y = 0; y < radius; y++) {
    const inset = Math.round(radius - Math.sqrt(radius ** 2 - (radius - y - 0.5) ** 2));
    const row = { x: inset, width: width - 2 * inset, height: 1 };
    rects.push({ ...row, y }, { ...row, y: height - 1 - y });
  }
  try { win.setShape(rects); } catch (error) {
    cardGeometry = undefined;
    log('WARN', '设置卡片圆角失败 ' + error.message);
  }
}

async function showSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    await settingsLoading;
    if (settingsWin && !settingsWin.isDestroyed()) {
      if (settingsWin.isMinimized()) settingsWin.restore();
      settingsWin.show();
      settingsWin.focus();
    }
    return;
  }
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const height = Math.max(1, Math.min(1640, area.height - 40));
  const window = new BrowserWindow({
    width: 400, height, useContentSize: true, title: '捣蛋猫 · 设置',
    show: false, frame: true, skipTaskbar: false, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false, webPreferences: webPreferences()
  });
  settingsWin = window;
  secureWindow(window, settingsPath);
  if (process.platform !== 'darwin') {
    window.removeMenu();
    window.setContentSize(400, height);
  }
  const bounds = window.getBounds();
  window.setPosition(Math.round(area.x + (area.width - bounds.width) / 2),
    Math.round(area.y + (area.height - bounds.height) / 2));
  window.once('closed', () => { if (settingsWin === window) settingsWin = undefined; });
  settingsLoading = window.loadFile(settingsPath);
  try {
    await settingsLoading;
    if (!window.isDestroyed()) { window.show(); window.focus(); }
  } catch (error) {
    if (!window.isDestroyed()) { window.destroy(); throw error; }
  }
}

let helpWin;
async function showHelp() {
  if (helpWin && !helpWin.isDestroyed()) {
    if (helpWin.isMinimized()) helpWin.restore();
    helpWin.show();
    helpWin.focus();
    return;
  }
  const window = new BrowserWindow({
    width: 520, height: 640, useContentSize: true, title: '捣蛋猫 · 玩法说明',
    show: false, frame: true, skipTaskbar: false, resizable: true,
    maximizable: false, minimizable: true, fullscreenable: false, webPreferences: webPreferences()
  });
  helpWin = window;
  secureWindow(window, helpPath);
  if (process.platform !== 'darwin') window.removeMenu();
  window.once('closed', () => { if (helpWin === window) helpWin = undefined; });
  await window.loadFile(helpPath);
  if (!window.isDestroyed()) { window.show(); window.focus(); }
}

async function ready() {
  if (process.platform === 'darwin') app.dock.hide();  gpuStatus();
  app.getGPUInfo('basic').then(info => log('INFO', 'GPU basic ' + JSON.stringify(info).slice(0, 6000)))
    .catch(e => log('WARN', 'GPU basic ' + e.message));
  log('INFO', 'displays ' + JSON.stringify(screen.getAllDisplays().map(
    ({ bounds, workArea, scaleFactor, internal }) => ({ bounds, workArea, scaleFactor, internal }))));
  if (!fs.existsSync(indexPath)) throw new Error('找不到猫页面 ' + indexPath);

  const { bounds, source } = initialBounds();
  const aero = isWin7 ? systemPreferences.isAeroGlassEnabled() : null;
  win7Card = isWin7 && !aero;
  updater = require('./updater').createElectronUpdater({
    app, net, session, shell, emit: notice => send('silly:update', notice), settings: loadSettings(), selftest
  });
  win = new BrowserWindow({
    ...bounds, useContentSize: true, title: DEFAULT_PET_TITLE, frame: false, transparent: !win7Card,
    backgroundColor: win7Card ? '#efe6d6' : '#00000000',
    hasShadow: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false, focusable: false, show: false,
    webPreferences: webPreferences()
  });
  if (isWin7 && softwareRendering) {
    // 先让 Electron 记下窗口已是分层窗口，之后开关点穿只切换 WS_EX_TRANSPARENT，不再拿掉 WS_EX_LAYERED。
    // 底色小窗：setOpacity 同时设好透明度 255 的分层属性，普通绘制照常显示。
    // 透明窗口：Chromium 用 UpdateLayeredWindow 逐像素绘制，不能再设分层属性，
    // 这里借 setContentProtection(false) 只加 WS_EX_LAYERED（Electron 22 源码里的同一处处理）。
    if (win7Card) win.setOpacity(1);
    else win.setContentProtection(false);
  }
  if (win7Card) { shapeCard(); win.on('resize', shapeCard); }
  win.on('move', schedulePosition);
  win.setAlwaysOnTop(true, 'screen-saver');
  log('INFO', 'window created ' + JSON.stringify({ bounds: win.getBounds(),
    contentBounds: win.getContentBounds(), visible: win.isVisible(), source,
    mode: win7Card ? 'win7-card' : 'transparent', aero, softwareRendering }));
  const wc = win.webContents;
  secureWindow(win, indexPath);
  wc.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_, callback) => callback({ cancel: true }));
  wc.on('did-start-loading', () => { loaded = false; });
  wc.on('did-fail-load', (_, code, desc, url, mainFrame) => {
    log('ERROR', 'did-fail-load ' + code + ' ' + desc + ' ' + url);
    if (mainFrame) fatal('猫页面加载失败', code + ' ' + desc + ' ' + url);
  });
  for (const event of ['unresponsive', 'responsive']) win.on(event, () => log('WARN', event));
  let messages = 0;
  wc.on('console-message', (_, level, message) => {
    if (level < 2 || messages >= 50 || message.includes('Electron Security Warning')) return; // 本地页面没有 CSP，这条警告是噪音
    messages++;
    if (level >= 3 && selftest) consoleErrors.push(message.slice(0, 300));
    log(level >= 3 ? 'ERROR' : 'WARN', message.slice(0, 300));
  });
  // 窗口不可聚焦（focusable:false），收不到键盘，所以不提供 DevTools 快捷键，也不注册会抢占系统范围 Ctrl+Shift+I 的全局快捷键。
  wc.on('did-finish-load', () => {
    loaded = true;
    win.showInactive();
    // 兼容版不做 Windows 全屏游戏检测和密码框检测：明确告诉前端「没有游戏 / 隐私状态」，
    // 猫不会误戴耳机，也不会乱捂脸。这两项只在正式版（Tauri）里有。
    send('silly:game-mode', { active: false });
    send('silly:privacy', { active: false });
    log('INFO', 'did-finish-load visible=' + win.isVisible());
    setTimeout(gpuStatus, 2000);
  });
  installIPC();
  installTray();
  applyIgnore();
  await win.loadFile(indexPath);
  if (debug) debugKey = await applyDebugCSS();
  if (process.platform === 'win32' && !selftest) {
    hook.start({ log, onKey: payload => send('silly:key', payload), onButton: payload => {
      if (payload.button === 0 && !payload.down) endDrag();
      send('silly:button', payload);
    } });
  }
  log('INFO', 'hook ' + JSON.stringify(hook.status()));
  if (debug) setInterval(() => {
    const { keys, buttons } = hook.status();
    log('INFO', 'hook counts ' + JSON.stringify({ keys, buttons }));
  }, 10000);
  if (selftest) {
    async function check(name, test) {
      try { results.push({ name, ok: true, detail: (await test()) || '通过' }); }
      catch (e) { results.push({ name, ok: false, detail: e.stack || String(e) }); }
    }
    await require('./selftest').run({ win, out, userData, send, setCursor, menuTemplate, defaultPos,
      getIgnore, isDragging, consoleErrors, applyDebugCSS, debugKey, getOpenedFolder,
      getSettingsWindow: () => settingsWin, callerWindow, isPage, settingsPath, systemTest, indexPath,
      runLog: currentRunLog, exportFatalLog, appendLogLine, RUN_LOG_NAME, scrub, describePath, knownDirs }, check);
    finishTest();
  }
}

function boot() {
  app.setName('SillyCat');
  // 和 Tauri 版共用配置目录（settings.json / window-position.json / window-lock.json 格式一致），
  // 从正式版切到兼容版不需要重新设置。
  userData = selftest ? (process.env.SILLYCAT_SELFTEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'sillycat-profile-')))
    : path.join(app.getPath('appData'), 'com.drew.sillycat');
  app.setPath('userData', userData);
  if (selftest) app.setPath('sessionData', userData);
  if (selftest) {
    if (!process.env.SILLYCAT_SELFTEST_PROFILE) process.once('exit', () => {
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
    });
    const i = process.argv.indexOf('--selftest-out');
    out = i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1])
      : path.join(os.tmpdir(), 'sillycat-selftest-' + Date.now());
    watchdog = setTimeout(() => fatal('自检超时', '55 秒内未完成'), 55000);
    fs.mkdirSync(out, { recursive: true });
  }
  runtimeInfo();
  const gpuSources = [];
  if (process.argv.includes('--disable-gpu')) gpuSources.push('--disable-gpu');
  if (process.env.SILLYCAT_DISABLE_GPU === '1') gpuSources.push('SILLYCAT_DISABLE_GPU');
  // SILLYCAT_WIN7_GPU=1 可在 Win7 上恢复硬件加速，只用于排查。
  if (isWin7 && process.env.SILLYCAT_WIN7_GPU !== '1') gpuSources.push('Windows 7');
  if (gpuSources.length) {
    softwareRendering = true;
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    log('INFO', 'GPU 已关闭 ' + gpuSources.join(', '));
  }
  if (!selftest && !app.requestSingleInstanceLock()) {
    log('INFO', '已有实例运行'); app.quit(); return;
  }
  app.on('second-instance', () => {
    if (!liveWindow()) return;
    win.showInactive();
    if (clickThroughEnabled()) {
      showSettings().catch(error => log('WARN', `Cannot open settings: ${error.message}`));
    }
  });
  app.on('child-process-gone', (_, d) => log('ERROR', 'child-process-gone ' + JSON.stringify(d)));
  app.on('before-quit', () => { stopAudioProbe(); updater?.stop(); hook.stop(); endDrag(); flushPosition(); });
  app.on('window-all-closed', () => app.quit());
  process.on('uncaughtException', e => fatal('桌宠运行异常', e.stack || e.message));
  process.on('unhandledRejection', e => log('ERROR', 'unhandledRejection ' + (e?.stack || String(e))));
  app.whenReady().then(ready).catch(e => fatal('桌宠启动失败', e.stack || e.message));
}
const BASE_W = 420;
const BASE_H = 345;
const MARGIN = 24;
const SIZE_MIN = 0.5;
const SIZE_MAX = 2;
const POSITION_DEBOUNCE_MS = 400;
const DRAG_POLL_MS = 8;
const DRAG_TIMEOUT_MS = 60_000;
const forwardMouse = process.env.SILLYCAT_NO_FORWARD !== '1';

let positionLocked = false;
let clickThrough = false;
let tray;
let positionTimer;
let pendingPosition;
let drag;
let cursorOverride;
let ignoreApplied = false;
let ignoreDesired = false;
let lastIgnoreArgs = null;
let openedFolder = null;
const loggedUnknownCommands = new Set();

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(userData, filename), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') log('WARN', `Cannot read ${filename}: ${error.message}`);
    return null;
  }
}

function writeJSON(filename, value) {
  const file = path.join(userData, filename);
  const temp = `${file}.tmp`;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function loadSettings() {
  const settings = readJSON('settings.json');
  return isObject(settings) ? settings : null;
}

function validSize(size) {
  return Number.isFinite(size) && size >= SIZE_MIN && size <= SIZE_MAX;
}

function catSizeOf(settings) {
  return validSize(settings?.size) ? settings.size : 1;
}

function sizeBounds(size) {
  return { width: Math.round(BASE_W * size), height: Math.round(BASE_H * size) };
}

function liveWindow() {
  return win && !win.isDestroyed();
}

function defaultPos({ width, height } = liveWindow() ? win.getBounds() : sizeBounds(1)) {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - width - MARGIN, y: area.y + area.height - height - MARGIN };
}

function initialBounds() {
  positionLocked = readJSON('window-lock.json')?.locked === true;
  clickThrough = readJSON('click-through.json')?.enabled === true;
  const size = sizeBounds(catSizeOf(loadSettings()));
  const position = readJSON('window-position.json');
  if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const cx = x + size.width / 2;
    const cy = y + size.height / 2;
    const onScreen = screen.getAllDisplays().some(({ bounds }) =>
      cx >= bounds.x && cx < bounds.x + bounds.width &&
      cy >= bounds.y && cy < bounds.y + bounds.height);
    if (onScreen) return { bounds: { x, y, ...size }, source: 'saved' };
    log('WARN', 'Saved window position is outside the available displays');
  } else if (position !== null) {
    log('WARN', 'Invalid window-position.json coordinates');
  }
  return { bounds: { ...defaultPos(size), ...size }, source: 'default' };
}

function schedulePosition() {
  if (!liveWindow() || drag) return;
  const { x, y } = win.getBounds();
  pendingPosition = { x, y };
  clearTimeout(positionTimer);
  positionTimer = setTimeout(flushPosition, POSITION_DEBOUNCE_MS);
}

function flushPosition() {
  clearTimeout(positionTimer);
  positionTimer = undefined;
  if (!pendingPosition) return;
  const position = pendingPosition;
  pendingPosition = undefined;
  try {
    writeJSON('window-position.json', position);
  } catch (error) {
    log('WARN', `Cannot save window position: ${error.message}`);
  }
}

function applyCatSize(size) {
  if (!liveWindow()) return;
  const bounds = win.getBounds();
  const { width, height } = sizeBounds(size);
  if (bounds.width === width && bounds.height === height) return;
  endDrag();
  win.setBounds({
    x: bounds.x + bounds.width - width,
    y: bounds.y + bounds.height - height,
    width,
    height,
  });
  schedulePosition();
}

function setCursor(pointOrNull) {
  cursorOverride = pointOrNull;
}

function getCursorPoint() {
  return cursorOverride ?? screen.getCursorScreenPoint();
}

function cursorLocal() {
  if (!liveWindow()) return null;
  try {
    const { x: gx, y: gy } = getCursorPoint();
    const { x, y } = win.getContentBounds();
    return { gx, gy, x: gx - x, y: gy - y };
  } catch {
    return null;
  }
}

function getIgnore() {
  return { applied: ignoreApplied, desired: ignoreDesired, lastArgs: lastIgnoreArgs };
}

function applyIgnore() {
  // Keep accepting mouseup during drag even when the pointer leaves the cat.
  const next = clickThroughEnabled() || (!drag && ignoreDesired);
  if (!liveWindow() || ignoreApplied === next) return;
  const args = forwardMouse ? [next, { forward: true }] : [next];
  win.setIgnoreMouseEvents(...args);
  ignoreApplied = next;
  lastIgnoreArgs = args;
}

function isDragging() {
  return drag !== undefined;
}

function endDrag() {
  if (!drag) return;
  clearInterval(drag.poll);
  clearTimeout(drag.timeout);
  drag = undefined;
  applyIgnore();
  schedulePosition();
}

function startDragging() {
  if (!liveWindow() || positionLocked || clickThroughEnabled() || drag) return false;
  const start = getCursorPoint();
  const bounds = win.getBounds();
  const dx = start.x - bounds.x;
  const dy = start.y - bounds.y;
  const { width, height } = bounds;
  let { x, y } = bounds;
  drag = {
    poll: setInterval(() => {
      try {
        if (!liveWindow()) {
          endDrag();
          return;
        }
        const point = getCursorPoint();
        const nextX = Math.round(point.x - dx);
        const nextY = Math.round(point.y - dy);
        if (nextX === x && nextY === y) return;
        win.setBounds({ x: nextX, y: nextY, width, height });
        x = nextX;
        y = nextY;
      } catch (error) {
        log('WARN', `Window drag stopped: ${error.message}`);
        endDrag();
      }
    }, DRAG_POLL_MS),
    timeout: setTimeout(endDrag, DRAG_TIMEOUT_MS),
  };
  applyIgnore();
  return true;
}

function showContextMenu() {
  if (selftest || !liveWindow() || clickThroughEnabled()) return;
  const menu = Menu.buildFromTemplate(menuTemplate());
  return new Promise((resolve) => menu.popup({ window: win, callback: resolve }));
}

const LOGIN_NAME = 'SillyCat';
const systemTest = selftest ? { launchItems: [], openedLinks: [], restarts: 0 } : null;

function autostartStatus() {
  if (!selftest && process.platform !== 'win32') {
    return { enabled: false, needs_approval: false, platform: 'other' };
  }
  // Electron 22 以命令行解析 path，必须把可能带空格的路径引起来。
  const { launchItems } = systemTest || app.getLoginItemSettings({ path: '"' + process.execPath + '"' });
  const enabled = launchItems.some(item => item.name === LOGIN_NAME && item.scope === 'user' &&
    item.enabled && item.args.length === 0);
  return { enabled, needs_approval: false, platform: 'windows' };
}

function setAutostart(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
  if (systemTest) {
    systemTest.launchItems = enabled ? [{ name: LOGIN_NAME, scope: 'user', enabled, args: [] }] : [];
  } else {
    if (process.platform !== 'win32') throw new Error('当前平台不支持开机自动启动');
    app.setLoginItemSettings({ name: LOGIN_NAME, path: '"' + process.execPath + '"', openAtLogin: enabled, enabled });
  }
  const status = autostartStatus();
  if (status.enabled !== enabled) throw new Error('系统未能修改登录项');
  return status;
}

function openLink(target) {
  const urls = new Map([
    ['github', 'https://github.com/ailcc/silly-cat'],
    ['gitee', 'https://gitee.com/ailcc/silly-cat'],
    ['origin', 'https://github.com/S0u1/silly-cat'],
  ]);
  const url = urls.get(target);
  if (!url) throw new Error('未知链接');
  if (systemTest) { systemTest.openedLinks.push(url); return; }
  if (process.platform === 'win32') return shell.openExternal(url);
}

const unsupportedAudio = Object.freeze({ supported: false, active: false, via: 'none' });
let audioChild, audioIdleTimer, audioSample;
let audioFailures = [];
let probeUnsupported = false;
let restartWarning = false;

function stopAudioProbe() {
  clearTimeout(audioIdleTimer);
  const child = audioChild;
  audioChild = audioSample = undefined;
  if (child) {
    try { child.stdin.end(); } catch (_) {}
    try { child.kill(); } catch (_) {}
  }
}

function mediaActivity() {
  if (process.platform !== 'win32' || probeUnsupported) return unsupportedAudio;
  const now = performance.now();
  if (!audioChild) {
    const exe = app?.isPackaged
      ? path.join(process.resourcesPath, 'audio-probe', 'silly-audio-probe.exe')
      : path.join(__dirname, '../tools/audio-probe/target/release/silly-audio-probe.exe');
    if (!fs.existsSync(exe)) return unsupportedAudio;
    audioFailures = audioFailures.filter(t => now - t < 600000);
    if (audioFailures.length >= 3) {
      if (!restartWarning) log('WARN', '音频检测程序在 10 分钟内已异常停止 3 次，暂停检测');
      restartWarning = true;
      return { supported: true, active: false, via: 'meter' };
    }
    restartWarning = false;
    const child = require('child_process').spawn(exe, ['--exclude-pid', String(process.pid)], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']
    });
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    audioChild = child;
    const exited = () => {
      if (audioChild !== child) return;
      clearTimeout(audioIdleTimer);
      audioChild = audioSample = undefined;
      if (!probeUnsupported) audioFailures.push(performance.now());
    };
    child.once('error', exited);
    // A clean exit can precede the final stdout line. close follows stdio drainage.
    child.once('exit', code => { if (code !== 0) exited(); });
    child.once('close', exited);
    const lines = require('readline').createInterface({ input: child.stdout, crlfDelay: Infinity });
    // readline 会转发 stdout 的错误。
    lines.on('error', () => {});
    lines.on('line', line => {
      if (audioChild !== child) return;
      try {
        const { supported, active } = JSON.parse(line);
        if (supported === false) probeUnsupported = true;
        if (typeof active === 'boolean') audioSample = { active, time: performance.now() };
      } catch (_) {}
    });
  }
  clearTimeout(audioIdleTimer);
  audioIdleTimer = setTimeout(stopAudioProbe, 10000);
  return { supported: true, active: !!audioSample?.active && now - audioSample.time <= 3000, via: 'meter' };
}

// —— 用户听歌（电脑真正出声才戴耳机）：每秒采样，出声连续 3 秒戴上，静音连续 8 秒摘下 ——
let musicEnabled = false, musicOn = false, musicTimer, musicOnSince = 0, musicOffSince = 0;
function musicSample() {
  const sample = mediaActivity();
  const active = !!(sample && sample.active);
  const now = performance.now();
  if (active) {
    musicOffSince = 0;
    if (!musicOn) {
      if (!musicOnSince) musicOnSince = now;
      else if (now - musicOnSince >= 3000) { musicOn = true; send('silly:user-music', { active: true }); }
    }
  } else {
    musicOnSince = 0;
    if (musicOn) {
      if (!musicOffSince) musicOffSince = now;
      else if (now - musicOffSince >= 8000) { musicOn = false; send('silly:user-music', { active: false }); }
    }
  }
}
function applyMusicEnabled(enabled) {
  musicEnabled = !!enabled;
  musicOnSince = musicOffSince = 0;
  if (musicTimer) { clearInterval(musicTimer); musicTimer = undefined; }
  if (musicEnabled) {
    musicTimer = setInterval(musicSample, 1000);
    if (musicTimer.unref) musicTimer.unref();
  } else if (musicOn) {
    musicOn = false;
    send('silly:user-music', { active: false });
  }
}

function invokeCommand(command, args, caller) {
  switch (command) {
    case 'media_activity': return mediaActivity();
    case 'user_music_active': return musicOn;
    case 'set_user_music_enabled': applyMusicEnabled(args?.enabled); return;
    case 'copy_snapshot': {
      const data = args?.data;
      if (typeof data !== 'string' || !data) throw new Error('图片数据无效');
      const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
      if (image.isEmpty()) throw new Error('图片数据无效');
      clipboard.writeImage(image);
      return;
    }
    case 'platform_flags': return { win7: win7Card };
    case 'load_settings': return loadSettings();
    case 'set_pet_title': {
      if (caller !== win || !liveWindow()) throw new Error('unauthorized IPC sender');
      const title = args?.title;
      if (typeof title !== 'string' || !title.startsWith('捣蛋')) throw new Error('桌宠标题无效');
      win.setTitle(title);
      updateTrayTooltip(title);
      return;
    }
    case 'save_settings': {
      const settings = args?.settings;
      if (!isObject(settings)) throw new Error('settings 必须是对象');
      writeJSON('settings.json', settings);
      updater.setAuto(settings);
      applyCatSize(catSizeOf(settings));
      send('silly:settings', settings);
      return;
    }
    case 'preview_cat_size':
      if (validSize(args?.size)) applyCatSize(args.size);
      return;
    case 'cursor_local': return cursorLocal();
    case 'position_locked': return positionLocked;
    case 'click_through_status': return clickThroughStatus();
    case 'set_click_through': return setClickThrough(args?.enabled);
    case 'show_context_menu': return showContextMenu();
    case 'input_status': return hook.inputStatus();
    case 'held_input_state': return hook.heldInputState(args?.keys, args?.buttons);
    case 'update_status': return updater.status();
    case 'check_update': updater.check(true).catch(() => {}); return;
    case 'install_update': return updater.install();
    case 'open_settings': return showSettings();
    case 'open_help': return showHelp();
    case 'updater_configured': return updater.configured;
    case 'app_version': return app.getVersion();
    case 'autostart_status': return autostartStatus();
    case 'set_autostart': return setAutostart(args?.enabled);
    case 'open_input_monitoring':
    case 'reset_input_monitoring': throw new Error('只有 macOS 需要输入监控授权');
    case 'restart_app':
      if (systemTest) { systemTest.restarts++; return; }
      app.relaunch();
      app.quit();
      return;
    case 'open_link': return openLink(args?.target);
    default: {
      const name = typeof command === 'string' ? command : '<invalid>';
      const error = `unknown command: ${name}`;
      if (!loggedUnknownCommands.has(name)) {
        loggedUnknownCommands.add(name);
        log('WARN', error);
      }
      throw new Error(error);
    }
  }
}

function windowMethod(caller, method, arg) {
  switch (method) {
    case 'setIgnoreCursorEvents':
      if (caller !== win) return;
      if (typeof arg !== 'boolean') throw new Error('setIgnoreCursorEvents requires a boolean');
      ignoreDesired = arg;
      applyIgnore();
      return;
    case 'startDragging': if (caller === win) startDragging(); return;
    case 'close': setImmediate(() => { if (!caller.isDestroyed()) caller.close(); }); return;
    case 'setSize': {
      if (!Number.isFinite(arg?.width) || !Number.isFinite(arg?.height) ||
          arg.width < 1 || arg.height < 1 || arg.width > 16384 || arg.height > 16384) {
        throw new Error('窗口尺寸无效');
      }
      caller.setContentSize(Math.round(arg.width), Math.round(arg.height));
      return;
    }
    default: throw new Error('unknown window method');
  }
}

function callerWindow(event) {
  for (const [window, pagePath] of [[win, indexPath], [settingsWin, settingsPath]]) {
    if (!window || window.isDestroyed() || event.sender !== window.webContents) continue;
    const frame = event.senderFrame;
    if (frame && frame === event.sender.mainFrame && isPage(frame.url, pagePath)) return window;
  }
  return null;
}

function installIPC() {
  const handle = (handler) => async (event, ...args) => {
    try {
      const caller = callerWindow(event);
      if (!caller) throw new Error('unauthorized IPC sender');
      return { value: await handler(caller, ...args) };
    } catch (error) {
      return { error: error.message ?? String(error) };
    }
  };
  ipcMain.handle('silly:invoke', handle((caller, command, args) => invokeCommand(command, args, caller)));
  ipcMain.handle('silly:window', handle(windowMethod));
  ipcMain.on('silly:drag-end', (event) => {
    if (callerWindow(event) === win) endDrag();
  });
  log('INFO', `Mouse forwarding ${forwardMouse ? 'enabled' : 'disabled (SILLYCAT_NO_FORWARD=1)'}`);
}

function trayAvailable() {
  return !!tray && !tray.isDestroyed();
}

function updateTrayTooltip(title) {
  if (trayAvailable()) tray.setToolTip(`捣蛋猫 兼容版 · ${title}`);
}

function refreshTrayMenu() {
  if (!trayAvailable()) return;
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function clickThroughAvailable() {
  return selftest || trayAvailable();
}

function clickThroughEnabled() {
  return clickThrough && clickThroughAvailable();
}

function clickThroughStatus() {
  return { enabled: clickThroughEnabled(), available: clickThroughAvailable() };
}

function setClickThrough(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
  const changed = clickThroughAvailable() && enabled !== clickThrough;
  if (changed) {
    clickThrough = enabled;
    if (enabled) endDrag();
    applyIgnore();
  }
  const status = clickThroughStatus();
  send('silly:click-through', status);
  refreshTrayMenu();
  if (changed) {
    try {
      writeJSON('click-through.json', { enabled });
    } catch (error) {
      throw new Error(`保存鼠标穿透失败：${error.message}`);
    }
  }
  return status;
}

function toggleClickThrough() {
  try {
    setClickThrough(!clickThroughEnabled());
  } catch (error) {
    log('WARN', error.message);
  }
}

function toggleVisibility() {
  if (!liveWindow()) return;
  if (!win.isVisible()) win.showInactive();
  else if (selftest || trayAvailable()) {
    endDrag();
    win.hide();
  }
}

function togglePositionLock() {
  positionLocked = !positionLocked;
  if (positionLocked) endDrag();
  try {
    writeJSON('window-lock.json', { locked: positionLocked });
  } catch (error) {
    log('WARN', `Cannot save window lock: ${error.message}`);
  }
  send('silly:lock', positionLocked);
  refreshTrayMenu();
}

function resetPosition() {
  if (!liveWindow()) return;
  endDrag();
  const { width, height } = win.getBounds();
  win.setBounds({ ...defaultPos({ width, height }), width, height });
  schedulePosition();
  win.showInactive();
}

async function openLogFolder() {
  openedFolder = userData;
  if (selftest) return;
  try {
    const error = await shell.openPath(userData);
    if (error) log('WARN', `Cannot open log folder: ${error}`);
  } catch (error) {
    log('WARN', `Cannot open log folder: ${error.message}`);
  }
}

function getOpenedFolder() {
  return openedFolder;
}

function menuTemplate() {
  return [
    { label: '设置…', click: showSettings },
    { label: '玩法说明…', click: showHelp },
    { label: '检查更新…', click: async () => { await showSettings(); await updater.check(true); } },
    { label: '显示/隐藏猫', enabled: selftest || trayAvailable(), click: toggleVisibility },
    { label: '锁定位置', type: 'checkbox', checked: positionLocked, click: togglePositionLock },
    { label: '鼠标穿透', type: 'checkbox', checked: clickThroughEnabled(),
      enabled: clickThroughAvailable(), click: toggleClickThrough },
    { label: '重置位置', click: resetPosition },
    { label: '打开日志文件夹', click: openLogFolder },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ];
}

function installTray() {
  if (selftest) return;
  try {
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) throw new Error(`Cannot load tray icon: ${iconPath}`);
    tray = new Tray(image);
    updateTrayTooltip(DEFAULT_PET_TITLE);
    refreshTrayMenu();
    if (process.platform === 'win32') {
      tray.on('right-click', refreshTrayMenu);
      tray.on('click', () => {
        refreshTrayMenu();
        tray.popUpContextMenu();
      });
    }
    log('INFO', 'Tray created');
  } catch (error) {
    if (trayAvailable()) tray.destroy();
    tray = undefined;
    log('WARN', `Cannot create tray: ${error.message}`);
  }
}

if (process.type === 'browser') {
  try { boot(); }
  catch (error) { fatal('桌宠初始化失败', error.stack || error.message); }
}

// 同一组命令与菜单可在没有窗口服务器的构建机上配合系统桩自检。
module.exports = { invokeCommand, menuTemplate, isPage, systemTest, appendLogLine, exportFatalLog, scrub, describePath };
