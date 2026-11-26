'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

const RELEASES = 'https://github.com/ailcc/silly-cat/releases';
const MANIFEST = RELEASES + '/latest/download/latest-electron.json';
const PUBLIC_KEY = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFEODk0RjVGOUE1NTk2MUEKUldRYWxsV2FYMCtKcmRtbFFoSzRHUUhHaEtwN3U5M0xOUVpzdUpldVJyMERiTEFmU1MxaSsyekMK';
const INVALID_SIGNATURE = '更新签名无效';
const BAD_MANIFEST = '更新清单格式错误';
const NETWORK = '网络请求失败';
const INSTALL_ARGS = ['--updated', '/S', '--force-run'];

function decode64(value) {
  if (typeof value !== 'string' || !value.length) throw new Error(INVALID_SIGNATURE);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error(INVALID_SIGNATURE);
  return bytes;
}

function packetLines(encoded) {
  return new TextDecoder('utf-8', { fatal: true }).decode(decode64(encoded)).split(/\r?\n/);
}

function readKey(encoded) {
  const packet = decode64(packetLines(encoded)[1]);
  if (packet.length !== 42 || !['Ed', 'ED'].includes(packet.toString('latin1', 0, 2))) {
    throw new Error(INVALID_SIGNATURE);
  }
  // RFC 8410 SubjectPublicKeyInfo prefix for a 32-byte Ed25519 key.
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), packet.subarray(10)]);
  return { id: packet.subarray(2, 10), key: crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }) };
}

// Electron 22 uses BoringSSL, whose crypto.getHashes() omits BLAKE2b. RFC 7693
// unkeyed BLAKE2b-512, using 32-bit halves so that large installers stay practical.
const IV = Uint32Array.of(
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
);
const SIGMA = [
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],
  [11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4], [7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],
  [9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13], [2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],
  [12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11], [13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],
  [6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5], [10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0],
];

function add64(state, dest, lo, hi) {
  const sum = state[dest] + lo;
  state[dest] = sum;
  state[dest + 1] += hi + (sum >= 0x100000000 ? 1 : 0);
}

function xorRotate(state, dest, src, bits) {
  const lo = state[dest] ^ state[src];
  const hi = state[dest + 1] ^ state[src + 1];
  if (bits === 32) {
    state[dest] = hi;
    state[dest + 1] = lo;
  } else if (bits === 63) {
    state[dest] = (lo << 1) | (hi >>> 31);
    state[dest + 1] = (hi << 1) | (lo >>> 31);
  } else {
    state[dest] = (lo >>> bits) | (hi << (32 - bits));
    state[dest + 1] = (hi >>> bits) | (lo << (32 - bits));
  }
}

function mix(v, m, a, b, c, d, x, y) {
  add64(v, a, v[b], v[b + 1]);
  add64(v, a, m[2*x], m[2*x + 1]);
  xorRotate(v, d, a, 32);
  add64(v, c, v[d], v[d + 1]);
  xorRotate(v, b, c, 24);
  add64(v, a, v[b], v[b + 1]);
  add64(v, a, m[2*y], m[2*y + 1]);
  xorRotate(v, d, a, 16);
  add64(v, c, v[d], v[d + 1]);
  xorRotate(v, b, c, 63);
}

async function portableBlake2b512(bytes) {
  const h = IV.slice();
  h[0] ^= 0x01010040; // digest length 64, key length 0, fanout and depth 1
  const v = new Uint32Array(32);
  const m = new Uint32Array(32);
  const tail = Buffer.alloc(128);
  let offset = 0;
  do {
    const end = Math.min(offset + 128, bytes.length);
    const final = end === bytes.length;
    let block = bytes;
    let start = offset;
    if (end - offset < 128) {
      bytes.copy(tail, 0, offset, end);
      block = tail;
      start = 0;
    }
    for (let i = 0; i < 32; i++) m[i] = block.readUInt32LE(start + 4*i);
    v.set(h);
    v.set(IV, 16);
    v[24] ^= end;
    v[25] ^= Math.floor(end / 0x100000000);
    if (final) { v[28] = ~v[28]; v[29] = ~v[29]; }
    for (let r = 0; r < 12; r++) {
      const s = SIGMA[r % 10];
      mix(v,m,0,8,16,24,s[0],s[1]);  mix(v,m,2,10,18,26,s[2],s[3]);
      mix(v,m,4,12,20,28,s[4],s[5]); mix(v,m,6,14,22,30,s[6],s[7]);
      mix(v,m,0,10,20,30,s[8],s[9]); mix(v,m,2,12,22,24,s[10],s[11]);
      mix(v,m,4,14,16,26,s[12],s[13]); mix(v,m,6,8,18,28,s[14],s[15]);
    }
    for (let i = 0; i < 16; i++) h[i] ^= v[i] ^ v[i + 16];
    offset = end;
    if (!final && offset % 524288 === 0) await new Promise(resolve => setImmediate(resolve));
  } while (offset < bytes.length);
  const digest = Buffer.alloc(64);
  for (let i = 0; i < 16; i++) digest.writeUInt32LE(h[i], 4*i);
  return digest;
}

async function verifySignature(bytes, signature, publicKey, version) {
  let comment;
  try {
    const lines = packetLines(signature);
    const packet = decode64(lines[1]);
    const algorithm = packet.toString('latin1', 0, 2);
    const global = decode64(lines[3]);
    if (packet.length !== 74 || !['Ed', 'ED'].includes(algorithm) || global.length !== 64 ||
        !packet.subarray(2, 10).equals(publicKey.id) || !lines[2].startsWith('trusted comment: ')) {
      throw new Error(INVALID_SIGNATURE);
    }
    const sig = packet.subarray(10);
    comment = lines[2].slice('trusted comment: '.length);
    const signedComment = Buffer.concat([sig, Buffer.from(comment)]);
    if (!crypto.verify(null, signedComment, publicKey.key, global)) throw new Error(INVALID_SIGNATURE);
    let message = bytes;
    if (algorithm === 'ED') {
      message = crypto.getHashes().includes('blake2b512')
        ? crypto.createHash('blake2b512').update(bytes).digest() : await portableBlake2b512(bytes);
    }
    if (!crypto.verify(null, message, publicKey.key, sig)) throw new Error(INVALID_SIGNATURE);
  } catch { throw new Error(INVALID_SIGNATURE); }

  const field = comment.split('\t').find(item => item.startsWith('version:'));
  if (field === undefined) throw new Error('The update signature does not specify the version it was signed for');
  const signed = field.slice('version:'.length);
  if (signed.replace(/^v+/, '') !== version) {
    throw new Error(`The update was signed for version ${signed} but the update endpoint announced version ${version}.`);
  }
}

function verifyUpdateSignature(bytes, signature, version, publicKey = PUBLIC_KEY) {
  return verifySignature(bytes, signature, readKey(publicKey), version);
}

function parseVersion(raw) {
  if (typeof raw !== 'string') throw new Error(BAD_MANIFEST);
  const value = raw.replace(/^v+/, '');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?(?:\+([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.exec(value);
  if (!match || match[0] !== value) throw new Error(BAD_MANIFEST);
  const core = match.slice(1, 4);
  if (core.some(n => n.length > 20 || BigInt(n) > 0xffffffffffffffffn)) throw new Error(BAD_MANIFEST);
  const pre = match[4]?.split('.') || [];
  if (pre.some(n => /^0\d+$/.test(n))) throw new Error(BAD_MANIFEST);
  return { value, core, pre, build: match[5]?.split('.') || [] };
}

function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function compareParts(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    const numericA = /^\d+$/.test(a[i]), numericB = /^\d+$/.test(b[i]);
    if (numericA && numericB) {
      const x = a[i].replace(/^0+/, ''), y = b[i].replace(/^0+/, '');
      return compare(x.length, y.length) || compare(x, y) || compare(a[i].length, b[i].length);
    }
    if (numericA !== numericB) return numericA ? -1 : 1;
    return compare(a[i], b[i]);
  }
  return compare(a.length, b.length);
}

// Rust semver::Version derives Ord, including its build metadata tie-breaker.
function compareVersion(a, b) {
  const core = compareParts(a.core, b.core);
  if (core) return core;
  if (!a.pre.length !== !b.pre.length) return a.pre.length ? -1 : 1;
  return compareParts(a.pre, b.pre) || compareParts(a.build, b.build);
}

function readManifest(bytes, current) {
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(BAD_MANIFEST); }
  if (!data || typeof data !== 'object') throw new Error(BAD_MANIFEST);
  const version = parseVersion(data.version ?? data.name);
  if (data.notes != null && typeof data.notes !== 'string') throw new Error(BAD_MANIFEST);
  if (data.pub_date != null && (typeof data.pub_date !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(data.pub_date) ||
      !Number.isFinite(Date.parse(data.pub_date)))) throw new Error(BAD_MANIFEST);
  if (data.platforms != null && (typeof data.platforms !== 'object' || Array.isArray(data.platforms))) {
    throw new Error(BAD_MANIFEST);
  }
  const artifacts = data.platforms == null ? [data] : Object.values(data.platforms);
  for (const item of artifacts) {
    if (!item || typeof item.signature !== 'string' || typeof item.url !== 'string') throw new Error(BAD_MANIFEST);
    let url;
    try { url = new URL(item.url); } catch { throw new Error(BAD_MANIFEST); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error(BAD_MANIFEST);
  }
  if (compareVersion(version, current) <= 0) return null;
  const asset = data.platforms == null ? data : data.platforms['windows-x86_64-nsis'] || data.platforms['windows-x86_64'];
  if (!asset) throw new Error('没有适用此平台的更新包');
  return { version: version.value, url: asset.url, signature: asset.signature };
}

// The same response reader works with Electron net and the loopback HTTP test.
function fetchBytes(makeRequest, url, { manifest, progress }) {
  return new Promise((resolve, reject) => {
    const request = makeRequest(url);
    let done = false;
    const limit = manifest ? 2 * 1024 ** 2 : 512 * 1024 ** 2;
    const timeout = setTimeout(() => fail('网络超时'), manifest ? 30000 : 600000);
    function fail(message) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      reject(new Error(message));
      request.abort();
    }
    request.once('error', () => fail(NETWORK));
    request.once('response', response => {
      response.once('error', () => fail(NETWORK));
      response.once('aborted', () => fail(NETWORK));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return fail(manifest ? '未找到更新清单' : NETWORK);
      }
      const chunks = [];
      let received = 0;
      const total = Number(response.headers['content-length']) || 0;
      if (total > limit) return fail('更新文件过大');
      response.once('end', () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(manifest && response.statusCode === 204 ? null : Buffer.concat(chunks, received));
      });
      response.on('data', chunk => {
        if (done) return;
        received += chunk.length;
        if (received > limit) return fail('更新文件过大');
        chunks.push(chunk);
        if (progress) progress(received, total);
      });
    });
    request.end();
  });
}

function unwritable(error) { return ['EACCES', 'EROFS', 'EPERM'].includes(error.code); }

async function probeInstallDir(exe) {
  const probe = path.join(path.dirname(exe), '.sillycat-write-' + crypto.randomBytes(16).toString('hex'));
  const file = await fs.open(probe, 'wx', 0o600);
  try { await file.close(); } finally { await fs.unlink(probe); }
}

async function launchInstaller(file, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function createUpdater({ publicKey = PUBLIC_KEY, currentVersion, manifestUrl = MANIFEST, fetch,
  probe, openRelease, launch, quit, tempDir, emit, schedule = true, settings = {} }) {
  let key = null;
  try { key = readKey(publicKey); } catch { /* Manual checks explain missing or invalid keys. */ }
  const current = parseVersion(currentVersion);
  let enabled = settings?.autoUpdate !== false;
  let notice = null, offer = null, timer = null;
  let queue = Promise.resolve();
  let generation = 0;
  let stopped = false;

  function serial(work) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }
  function publish(value) { notice = value; emit(value); }
  function notify(kind, title, detail, installable = false) { publish({ kind, title, detail, installable }); }
  function reason(error) { return Array.from(error.message).slice(0, 60).join(''); }

  function check(manual = true) {
    return serial(async () => {
      if (stopped) return;
      if (!key) {
        if (manual) notify('result', '检查失败', '未配置更新密钥');
        return;
      }
      if (manual) notify('checking', '正在检查更新…', '');
      else if (!enabled) return;
      const started = generation;
      try {
        const bytes = await fetch(manifestUrl, { manifest: true });
        const candidate = bytes == null ? null : readManifest(bytes, current);
        if (stopped || (!manual && started !== generation)) return;
        if (candidate) {
          offer = { ...candidate, manual };
          notify('offer', '有新版本 v' + offer.version, '点这里更新', true);
        } else {
          const previous = offer;
          offer = null;
          if (manual || previous) notify('result', '已是最新版本', '');
        }
      } catch (error) {
        if (manual && !stopped) {
          offer = null;
          notify('result', '检查失败', reason(error));
        }
      }
    });
  }

  async function fallback() {
    let detail = '请到发布页下载安装包';
    try { await openRelease(RELEASES); } catch { detail = RELEASES; }
    notify('failed', '安装目录不可写', detail);
  }

  function install() {
    return serial(async () => {
      if (!offer || stopped) return;
      const candidate = offer;
      offer = null;
      if (!candidate.manual && !enabled) { publish(null); return; }
      try { await probe(); } catch (error) {
        if (unwritable(error)) return fallback();
        offer = candidate;
        notify('failed', '无法开始安装', reason(error), true);
        return;
      }
      notify('progress', '正在下载更新', '准备下载…');
      let dir;
      try {
        let last;
        const progress = (count, total) => {
          const detail = total > 0 ? Math.floor(100 * count / total) + '%' : (64 * Math.floor(count / 65536)) + ' KiB';
          if (last !== detail) { last = detail; notify('progress', '正在下载更新', detail); }
        };
        const bytes = await fetch(candidate.url, { manifest: false, progress });
        notify('progress', '正在校验并安装', '完成后自动重启');
        await verifySignature(bytes, candidate.signature, key, candidate.version);
        if (stopped) return;
        dir = await fs.mkdtemp(path.join(tempDir, 'sillycat-update-'));
        const file = path.join(dir, 'setup.exe');
        await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
        await launch(file, [...INSTALL_ARGS]);
        // The detached NSIS process still needs this file after the old app exits.
        dir = null;
        quit();
      } catch (error) {
        if (unwritable(error)) return fallback();
        offer = candidate;
        notify('failed', '更新失败', reason(error), true);
      } finally {
        if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    });
  }

  function arm(delay) {
    if (!schedule || !key || !enabled || stopped) return;
    const started = generation;
    timer = setTimeout(async () => {
      await check(false);
      if (started === generation) arm(24 * 3600000);
    }, delay);
    timer.unref();
  }
  function setAuto(next) {
    const value = next?.autoUpdate !== false;
    if (enabled === value) return queue;
    enabled = value;
    generation++;
    clearTimeout(timer);
    if (enabled) { arm(10000); return queue; }
    return serial(() => {
      if (!enabled && offer && !offer.manual) { offer = null; publish(null); }
    });
  }
  arm(10000);
  return {
    configured: Boolean(key), status: () => notice, check, install, setAuto,
    stop() { stopped = true; generation++; clearTimeout(timer); },
  };
}

function createElectronUpdater({ app, net, session, shell, emit, settings, selftest = false }) {
  const windows = process.platform === 'win32' && process.arch === 'x64';
  const get = url => net.request({ url, session: session.fromPartition('updater'), redirect: 'follow' });
  return createUpdater({
    currentVersion: app.getVersion(), settings, emit, tempDir: app.getPath('temp'),
    schedule: windows && !selftest,
    fetch: selftest ? async () => null : (url, opts) => fetchBytes(get, url, opts),
    probe: async () => {
      if (!windows || selftest) throw new Error('仅支持 Windows x64 安装');
      await probeInstallDir(process.execPath);
    },
    openRelease: url => shell.openExternal(url), launch: launchInstaller, quit: () => app.quit(),
  });
}

module.exports = { PUBLIC_KEY, createElectronUpdater, createUpdater, fetchBytes, portableBlake2b512, verifyUpdateSignature };
