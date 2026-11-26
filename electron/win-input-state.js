'use strict';

// The addon only exposes a libuiohook VC, so invert its Windows VK mapping.
// Keep sided modifiers and the keypad navigation VK observed at keydown.
const VIRTUAL_KEYS = Object.freeze({
  Backspace: 0x08, Tab: 0x09, Enter: 0x0D, NumpadEnter: 0x0D,
  Pause: 0x13, CapsLock: 0x14, KanaMode: 0x15, Convert: 0x19, Escape: 0x1B,
  NonConvert: 0x1D, Space: 0x20, PageUp: 0x21, PageDown: 0x22,
  End: 0x23, Home: 0x24, ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  PrintScreen: 0x2C, Insert: 0x2D, Delete: 0x2E,
  MetaLeft: 0x5B, MetaRight: 0x5C, ContextMenu: 0x5D, Sleep: 0x5F,
  NumpadMultiply: 0x6A, NumpadAdd: 0x6B, NumpadComma: 0x6C,
  NumpadSubtract: 0x6D, NumpadDecimal: 0x6E, NumpadDivide: 0x6F,
  NumLock: 0x90, ScrollLock: 0x91, NumpadEqual: 0x92,
  ShiftLeft: 0xA0, ShiftRight: 0xA1, ControlLeft: 0xA2, ControlRight: 0xA3,
  AltLeft: 0xA4, AltRight: 0xA5,
  BrowserBack: 0xA6, BrowserForward: 0xA7, BrowserRefresh: 0xA8, BrowserStop: 0xA9,
  BrowserSearch: 0xAA, BrowserFavorites: 0xAB, BrowserHome: 0xAC,
  AudioVolumeMute: 0xAD, AudioVolumeDown: 0xAE, AudioVolumeUp: 0xAF,
  MediaTrackNext: 0xB0, MediaTrackPrevious: 0xB1, MediaStop: 0xB2, MediaPlayPause: 0xB3,
  MediaSelect: 0xB5, LaunchApp1: 0xB6, LaunchApp2: 0xB7,
  Semicolon: 0xBA, Equal: 0xBB, Comma: 0xBC, Minus: 0xBD, Period: 0xBE, Slash: 0xBF,
  Backquote: 0xC0, BracketLeft: 0xDB, Backslash: 0xDC, BracketRight: 0xDD,
  Quote: 0xDE, IntlYen: 0xDF, IntlBackslash: 0xE2,
});
const KEYPAD_NAVIGATION = {
  Numpad0: 0x2D, Numpad1: 0x23, Numpad2: 0x28, Numpad3: 0x22, Numpad4: 0x25,
  Numpad5: 0x0C, Numpad6: 0x27, Numpad7: 0x24, Numpad8: 0x26, Numpad9: 0x21,
  NumpadDecimal: 0x2E,
};

function virtualKeyFor(code, keycode) {
  const prefix = keycode >> 8;
  if (prefix === 0xEE || (code === 'Numpad5' && (prefix === 0xE0 || prefix === 0x0E))) {
    return KEYPAD_NAVIGATION[code];
  }
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(code)) return 0x60 + Number(code.slice(6));
  if (/^F[0-9]+$/.test(code)) return 0x6F + Number(code.slice(1));
  return VIRTUAL_KEYS[code];
}

const SM_SWAPBUTTON = 23;
const VK_LBUTTON = 0x01;
const VK_RBUTTON = 0x02;
const VK_MBUTTON = 0x04;
const BUTTON_VKS = [VK_LBUTTON, VK_MBUTTON, VK_RBUTTON];
let api;

function loadApi() {
  try {
    const user32 = require('koffi').load('user32.dll');
    const getCursorPos = user32.func('int GetCursorPos(void *point)');
    const getAsyncKeyState = user32.func('short GetAsyncKeyState(int vk)');
    const getSystemMetrics = user32.func('int GetSystemMetrics(int index)');
    const point = Buffer.alloc(8); // Two Win32 LONG fields.
    return {
      desktopAvailable: () => getCursorPos(point) !== 0,
      pressed: vk => getAsyncKeyState(vk) < 0,
      swapped: () => getSystemMetrics(SM_SWAPBUTTON) !== 0,
    };
  } catch (_) {
    // The input hooks can still run when the optional state reader is unavailable.
    return false;
  }
}

function readHeldState(heldKeys, keys, buttons) {
  if (process.platform !== 'win32') throw new Error('unsupported platform');
  api ??= loadApi();
  if (!api) throw new Error('input state unavailable');
  if (!Array.isArray(keys) || !Array.isArray(buttons) || keys.some(key => typeof key?.code !== 'string') ||
      buttons.some(button => !Number.isInteger(button) || button < 0 || button > 255)) {
    throw new Error('invalid held input state arguments');
  }

  let desktopAvailable;
  const released = [];
  let pressedKeys, pressedButtons;
  try {
    // GetAsyncKeyState returns zero on another input desktop, including lock and UAC.
    desktopAvailable = api.desktopAvailable();
    if (desktopAvailable) {
      pressedKeys = keys.map(({ code }) => code).filter(code => {
        const vk = heldKeys.get(code);
        if (vk && api.pressed(vk)) return true;
        released.push(code);
        return false;
      });
      const swapped = api.swapped();
      pressedButtons = buttons.filter(button => {
        if (swapped && (button === 0 || button === 2)) return api.pressed(VK_LBUTTON) || api.pressed(VK_RBUTTON);
        const vk = BUTTON_VKS[button];
        return vk === undefined || api.pressed(vk);
      });
    }
  } catch (_) {
    throw new Error('input state unavailable');
  }
  if (!desktopAvailable) throw new Error('input desktop unavailable');

  // A missed keyup must also clear the hook's repeat suppression for that key.
  for (const code of released) heldKeys.delete(code);
  return { keys: pressedKeys, buttons: pressedButtons };
}

module.exports = { virtualKeyFor, readHeldState };
