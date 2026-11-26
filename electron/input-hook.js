'use strict';

const { virtualKeyFor, readHeldState } = require('./win-input-state');

// libuiohook derives these VC values from Windows virtual keys. The addon
// discards the native VK, physical scan code and hook flags, so aliased or
// layout-dependent labels, unmapped JIS/Korean keys, and
// AltGr's synthetic left Ctrl carry through.
const KEY_CODES = {
  0x01: 'Escape',
  0x02: 'Digit1', 0x03: 'Digit2', 0x04: 'Digit3', 0x05: 'Digit4', 0x06: 'Digit5',
  0x07: 'Digit6', 0x08: 'Digit7', 0x09: 'Digit8', 0x0A: 'Digit9', 0x0B: 'Digit0',
  0x0C: 'Minus', 0x0D: 'Equal', 0x0E: 'Backspace', 0x0F: 'Tab',
  0x10: 'KeyQ', 0x11: 'KeyW', 0x12: 'KeyE', 0x13: 'KeyR', 0x14: 'KeyT',
  0x15: 'KeyY', 0x16: 'KeyU', 0x17: 'KeyI', 0x18: 'KeyO', 0x19: 'KeyP',
  0x1A: 'BracketLeft', 0x1B: 'BracketRight', 0x1C: 'Enter', 0x1D: 'ControlLeft',
  0x1E: 'KeyA', 0x1F: 'KeyS', 0x20: 'KeyD', 0x21: 'KeyF', 0x22: 'KeyG',
  0x23: 'KeyH', 0x24: 'KeyJ', 0x25: 'KeyK', 0x26: 'KeyL',
  0x27: 'Semicolon', 0x28: 'Quote', 0x29: 'Backquote',
  0x2A: 'ShiftLeft', 0x2B: 'Backslash',
  0x2C: 'KeyZ', 0x2D: 'KeyX', 0x2E: 'KeyC', 0x2F: 'KeyV',
  0x30: 'KeyB', 0x31: 'KeyN', 0x32: 'KeyM',
  0x33: 'Comma', 0x34: 'Period', 0x35: 'Slash', 0x36: 'ShiftRight',
  0x37: 'NumpadMultiply', 0x38: 'AltLeft', 0x39: 'Space', 0x3A: 'CapsLock',
  0x3B: 'F1', 0x3C: 'F2', 0x3D: 'F3', 0x3E: 'F4', 0x3F: 'F5',
  0x40: 'F6', 0x41: 'F7', 0x42: 'F8', 0x43: 'F9', 0x44: 'F10',
  0x45: 'NumLock', 0x46: 'ScrollLock',
  0x4A: 'NumpadSubtract', 0x4E: 'NumpadAdd',
  0x56: 'IntlBackslash', 0x57: 'F11', 0x58: 'F12',
  0x5B: 'F13', 0x5C: 'F14', 0x5D: 'F15',
  0x63: 'F16', 0x64: 'F17', 0x65: 'F18', 0x66: 'F19', 0x67: 'F20',
  0x68: 'F21', 0x69: 'F22', 0x6A: 'F23', 0x6B: 'F24',
  0x70: 'KanaMode', 0x73: 'IntlRo', 0x79: 'Convert', 0x7B: 'NonConvert',
  0x7D: 'IntlYen', 0x7E: 'NumpadComma',
};

const NUMPAD_DIGITS = {
  0x47: 'Numpad7', 0x48: 'Numpad8', 0x49: 'Numpad9',
  0x4B: 'Numpad4', 0x4C: 'Numpad5', 0x4D: 'Numpad6',
  0x4F: 'Numpad1', 0x50: 'Numpad2', 0x51: 'Numpad3',
  0x52: 'Numpad0', 0x53: 'NumpadDecimal',
};

// The VC header uses both 0x0E and 0xE0 prefixes for extended keys.
const EXTENDED_CODES = {
  0x0D: 'NumpadEqual',
  0x10: 'MediaTrackPrevious', 0x19: 'MediaTrackNext',
  0x1C: 'NumpadEnter', 0x1D: 'ControlRight',
  0x20: 'AudioVolumeMute', 0x21: 'LaunchApp2', 0x22: 'MediaPlayPause',
  0x24: 'MediaStop', 0x2C: 'Eject', 0x2E: 'AudioVolumeDown', 0x30: 'AudioVolumeUp',
  0x32: 'BrowserHome', 0x35: 'NumpadDivide', 0x37: 'PrintScreen', 0x38: 'AltRight',
  0x45: 'Pause', 0x46: 'IntlBackslash',
  0x47: 'Home', 0x48: 'ArrowUp', 0x49: 'PageUp',
  0x4B: 'ArrowLeft', 0x4C: 'Numpad5', 0x4D: 'ArrowRight',
  0x4F: 'End', 0x50: 'ArrowDown', 0x51: 'PageDown', 0x52: 'Insert', 0x53: 'Delete',
  0x5B: 'MetaLeft', 0x5C: 'MetaRight', 0x5D: 'ContextMenu',
  0x5E: 'Power', 0x5F: 'Sleep', 0x63: 'WakeUp',
  0x65: 'BrowserSearch', 0x66: 'BrowserFavorites', 0x67: 'BrowserRefresh',
  0x68: 'BrowserStop', 0x69: 'BrowserForward', 0x6A: 'BrowserBack',
  0x6C: 'LaunchApp1', 0x6D: 'MediaSelect',
};

function codeForKeycode(keycode) {
  if (!Number.isInteger(keycode) || keycode < 0 || keycode > 0xFFFF) return undefined;

  const prefix = keycode >> 8;
  const value = keycode & 0xFF;
  if (prefix === 0xEE) return NUMPAD_DIGITS[value]; // Navigation VKs on the keypad with NumLock off.
  if (prefix === 0x0E || prefix === 0xE0) return EXTENDED_CODES[value];
  if (prefix === 0) return KEY_CODES[value] ?? NUMPAD_DIGITS[value];
  return undefined;
}

const BUTTONS = new Map([[1, 0], [2, 2], [3, 1]]); // libuiohook left/right/middle to DOM buttons.
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 5;

let hook;
let callbacks;
let started = false;
let retryTimer;
let error = null;
let keys = 0;
let buttons = 0;
const heldKeys = new Map();
// 锁屏或 UAC 期间松开的键，钩子收不到抬起事件，页面读不到键态时 5 秒后会自己松爪，
// 但这里的「已按下」记录不会跟着清，之后该键的第一次按下会被当成长按重复吞掉。
// 系统长按重复的间隔最长约 1 秒，同一个键超过 2 秒没再收到按下事件，就当成新的一次按下。
const REPEAT_WINDOW_MS = 2000;
const downAt = new Map();

function handleKey(keycode, down) {
  if (!started) return;
  const code = codeForKeycode(keycode);
  if (!code) return;
  if (down) {
    const now = Date.now();
    const gap = now - downAt.get(code);
    downAt.set(code, now); // 长按重复事件也刷新，持续长按不会过期
    // 系统时钟被往回调时 gap 为负，同样当成新的一次按下，页面对已按住的键会忽略。
    if (heldKeys.has(code) && gap >= 0 && gap < REPEAT_WINDOW_MS) return;
    heldKeys.set(code, virtualKeyFor(code, keycode));
  } else {
    heldKeys.delete(code);
    downAt.delete(code);
  }
  keys += 1;
  callbacks.onKey?.({ code, down });
}

function handleButton(nativeButton, down) {
  if (!started) return;
  const button = BUTTONS.get(nativeButton);
  if (button === undefined) return;
  buttons += 1;
  callbacks.onButton?.({ button, down });
}

const listeners = {
  keydown: ({ keycode }) => handleKey(keycode, true),
  keyup: ({ keycode }) => handleKey(keycode, false),
  mousedown: ({ button }) => handleButton(button, true),
  mouseup: ({ button }) => handleButton(button, false),
};

function removeListeners() {
  for (const [event, listener] of Object.entries(listeners)) hook.removeListener(event, listener);
}

function reportFailure(log, action, failure) {
  const code = failure?.code || `UIOHOOK_${action.toUpperCase()}_FAILED`;
  error = `${code}: ${failure?.message || String(failure)}`;
  log?.('WARN', `Input hook ${action} failed (${error})`);
}

function attemptStart(current, retriesLeft) {
  try {
    hook ??= require('uiohook-napi').uIOhook;
    for (const [event, listener] of Object.entries(listeners)) hook.on(event, listener);
    hook.start();
    started = true;
    error = null;
    current.log?.('INFO', 'Windows input hook started');
  } catch (failure) {
    if (hook) removeListeners();
    reportFailure(current.log, hook ? 'start' : 'load', failure);

    if (callbacks === current && retriesLeft > 0) {
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        attemptStart(current, retriesLeft - 1);
      }, RETRY_DELAY_MS);
    }
  }
}

function start({ onKey, onButton, log } = {}) {
  if (process.platform !== 'win32' || callbacks) return;
  callbacks = { onKey, onButton, log };
  keys = 0;
  buttons = 0;
  error = null;
  attemptStart(callbacks, MAX_RETRIES);
}

function stop() {
  const current = callbacks;
  callbacks = undefined;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  heldKeys.clear();
  downAt.clear();

  if (!started) return;
  started = false;
  removeListeners();
  try {
    hook.stop();
  } catch (failure) {
    reportFailure(current.log, 'stop', failure);
  }
}

function status() {
  return { loaded: !!hook, started, error, keys, buttons };
}

function inputStatus() {
  // libuiohook on Windows starts both low-level hooks together or fails startup.
  return { granted: true, keys: started, mouse: started, keyboard: 'unsupported', needs_permission: false };
}

function heldInputState(keys, buttons) {
  return readHeldState(heldKeys, keys, buttons);
}

module.exports = { start, stop, status, codeForKeycode, inputStatus, heldInputState };
