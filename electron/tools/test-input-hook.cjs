'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function inputHarness(platform) {
  const native = new EventEmitter();
  const state = {
    starts: 0, stops: 0, loads: 0, desktop: true, swapped: false,
    loadFailure: false, metricsFailure: false, down: new Map(), queries: [], now: 1_000_000,
  };
  native.start = () => { state.starts += 1; };
  native.stop = () => { state.stops += 1; };
  const functions = {
    'int GetCursorPos(void *point)': point => {
      assert.equal(point.length, 8);
      return Number(state.desktop);
    },
    'short GetAsyncKeyState(int vk)': vk => {
      state.queries.push(vk);
      return state.down.get(vk) ?? 0;
    },
    'int GetSystemMetrics(int index)': index => {
      assert.equal(index, 23);
      if (state.metricsFailure) throw new Error('metrics unavailable');
      return Number(state.swapped);
    },
  };

  function load(file) {
    const module = { exports: {} };
    const requireStub = name => {
      if (name === './win-input-state') return load('win-input-state.js');
      if (name === 'uiohook-napi') return { uIOhook: native };
      assert.equal(name, 'koffi');
      state.loads += 1;
      if (state.loadFailure) throw new Error('native addon unavailable');
      return { load: library => {
        assert.equal(library, 'user32.dll');
        return { func: signature => functions[signature] };
      } };
    };
    const filename = path.join(__dirname, '..', file);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, Buffer, process: { platform }, require: requireStub, setTimeout, clearTimeout,
      Date: { now: () => state.now },
    }, { filename });
    return module.exports;
  }
  return { hook: load('input-hook.js'), native, state };
}

const toLocalObject = value => JSON.parse(JSON.stringify(value));
const read = (hook, keys, buttons = []) => toLocalObject(hook.heldInputState(keys.map(code => ({ code })), buttons));
const inactive = { granted: true, keys: false, mouse: false, keyboard: 'unsupported', needs_permission: false };

const { hook, native, state } = inputHarness('win32');
const emitted = [];
assert.deepEqual(toLocalObject(hook.inputStatus()), inactive);
hook.start({ onKey: event => emitted.push(toLocalObject(event)) });
assert.deepEqual(toLocalObject(hook.inputStatus()), { ...inactive, keys: true, mouse: true });
assert.equal(state.loads, 0);

for (const keycode of [0x1E, 0x1E, 0x36, 0xEE50]) native.emit('keydown', { keycode });
assert.deepEqual(emitted, [
  { code: 'KeyA', down: true }, { code: 'ShiftRight', down: true }, { code: 'Numpad2', down: true },
]);
state.down = new Map([[0x41, 1], [0xA1, -32768], [0x28, -32767], [0x02, -32768]]);
state.desktop = false;
assert.throws(() => read(hook, ['KeyA'], [0]), /input desktop unavailable/);
assert.deepEqual(state.queries, []);
state.desktop = true;
state.metricsFailure = true;
assert.throws(() => read(hook, ['KeyA'], [0]), /input state unavailable/);
native.emit('keydown', { keycode: 0x1E });
assert.equal(emitted.length, 3);
state.metricsFailure = false;
state.swapped = true;
assert.deepEqual(read(hook, ['KeyA', 'ShiftRight', 'Numpad2', 'KeyB'], [0, 1, 2, 3]), {
  keys: ['ShiftRight', 'Numpad2'], buttons: [0, 2, 3],
});
assert.deepEqual(state.queries, [0x41, 0x41, 0xA1, 0x28, 0x01, 0x02, 0x04, 0x01, 0x02]);
assert.equal(state.loads, 1);
native.emit('keydown', { keycode: 0x1E });
assert.deepEqual(emitted.at(-1), { code: 'KeyA', down: true });
state.swapped = false;
assert.deepEqual(read(hook, [], [0, 1, 2]), { keys: [], buttons: [2] });
state.swapped = true;
state.down.delete(0x02);
assert.deepEqual(read(hook, [], [0, 2]), { keys: [], buttons: [] });
// 锁屏 / UAC 期间漏掉抬起：页面读不到键态，5 秒后自行松爪；钩子里的记录不能让之后的第一次按下被吞掉。
const KEY_L = 0x26;
emitted.length = 0;
native.emit('keydown', { keycode: KEY_L });
assert.deepEqual(emitted, [{ code: 'KeyL', down: true }]);
state.desktop = false;
for (let second = 0; second < 6; second += 1) {
  state.now += 1000;
  assert.throws(() => read(hook, ['KeyL']), /input desktop unavailable/);
}
state.desktop = true;
native.emit('keydown', { keycode: KEY_L });
assert.deepEqual(emitted, [{ code: 'KeyL', down: true }, { code: 'KeyL', down: true }]);

// 真正的长按重复（首次延迟最长约 1 秒，之后约 30 毫秒一次）仍只算一次按下，持续再久也不会过期。
emitted.length = 0;
native.emit('keydown', { keycode: 0x1E });
state.now += 1000;
native.emit('keydown', { keycode: 0x1E });
for (let tick = 0; tick < 400; tick += 1) {
  state.now += 30;
  native.emit('keydown', { keycode: 0x1E });
}
assert.deepEqual(emitted, [{ code: 'KeyA', down: true }]);
native.emit('keyup', { keycode: 0x1E });
native.emit('keydown', { keycode: 0x1E });
assert.deepEqual(emitted.slice(1), [{ code: 'KeyA', down: false }, { code: 'KeyA', down: true }]);

// 系统时钟被往回调时，同样当成新的一次按下，而不是一直吞到时钟追上。
emitted.length = 0;
native.emit('keydown', { keycode: KEY_L });
state.now -= 3_600_000;
native.emit('keydown', { keycode: KEY_L });
assert.equal(emitted.length, 2);
hook.stop();
assert.deepEqual(toLocalObject(hook.inputStatus()), inactive);
assert.equal(state.stops, 1);

const unavailable = inputHarness('win32');
unavailable.state.loadFailure = true;
unavailable.hook.start();
assert.throws(() => read(unavailable.hook, []), /input state unavailable/);
assert.equal(unavailable.hook.inputStatus().keys, true);
unavailable.hook.stop();

const mac = inputHarness('darwin');
mac.hook.start();
assert.throws(() => read(mac.hook, []), /unsupported platform/);
assert.deepEqual([mac.state.starts, mac.state.loads], [0, 0]);
console.log('Input hook selftest passed');
