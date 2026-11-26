'use strict';

const assert = require('assert').strict;
const { spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const { Duplex } = require('stream');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { PUBLIC_KEY, createElectronUpdater, createUpdater, fetchBytes, portableBlake2b512 } = require('./updater');

function findCli() {
  const roots = [path.join(__dirname, '..')];
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: __dirname, encoding: 'utf8' });
  if (common.status === 0) roots.push(path.dirname(common.stdout.trim()));
  for (const root of roots) {
    const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');
    if (fs.existsSync(cli)) return cli;
  }
  throw new Error('签名集成测试需要在项目根目录安装 Tauri CLI');
}

function makeCliSignature(dir, artifact, version) {
  const cli = findCli();
  const key = path.join(dir, 'temporary.key');
  const env = { ...process.env };
  for (const name of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PATH',
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD']) delete env[name];
  const node = process.env.npm_node_execpath || 'node';
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = crypto.randomBytes(18).toString('hex');
  const run = args => {
    const proc = spawnSync(node, [cli, 'signer', ...args], { env, stdio: 'ignore' });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) throw new Error('临时密钥的 tauri signer ' + args[0] + ' 失败');
  };
  run(['generate', '--ci', '--password', env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, '--write-keys', key]);
  run(['sign', '--private-key-path', key, '--app-version', version, artifact]);
  return { pub: fs.readFileSync(key + '.pub', 'utf8').trim(), sig: fs.readFileSync(artifact + '.sig', 'utf8').trim() };
}

async function makeNodeSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const id = crypto.randomBytes(8);
  const packet = (algorithm, value) => Buffer.concat([Buffer.from(algorithm), id, value]).toString('base64');
  const envelope = lines => Buffer.from(lines.join('\n') + '\n').toString('base64');
  return {
    pub: envelope(['untrusted comment: temporary public key', packet('Ed', raw)]),
    async sign(bytes, algorithm, version) {
      const comment = 'timestamp:1\tfile:setup.exe' + (version == null ? '' : '\tversion:' + version);
      let data = bytes;
      if (algorithm === 'ED') {
        // Use the system Node's OpenSSL as the independent oracle on Electron/BoringSSL.
        data = crypto.getHashes().includes('blake2b512') ? crypto.createHash('blake2b512').update(bytes).digest() :
          execFileSync(process.env.npm_node_execpath || 'node', ['-e',
            "process.stdout.write(require('crypto').createHash('blake2b512').update(require('fs').readFileSync(0)).digest())"], { input: bytes });
      }
      const sig = crypto.sign(null, data, privateKey);
      const global = crypto.sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey);
      return envelope(['untrusted comment: temporary signature', packet(algorithm, sig),
        'trusted comment: ' + comment, global.toString('base64')]);
    },
  };
}

async function runUpdaterTests({ inMemory = false } = {}) {
  const conf = require('../src-tauri/tauri.conf.json');
  assert.equal(PUBLIC_KEY, conf.plugins.updater.pubkey);
  assert.equal(require('./package.json').version, conf.version);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillycat-signer-test-'));
  const artifact = path.join(dir, 'SillyCat_2.0.0_electron_x64-setup.exe');
  const bytes = Buffer.alloc(70321, 'inert test bytes only');
  let server;
  try {
    fs.writeFileSync(artifact, bytes);
    const cli = makeCliSignature(dir, artifact, '2.0.0');
    const algorithm = Buffer.from(Buffer.from(cli.sig, 'base64').toString().split('\n')[1], 'base64').toString('ascii', 0, 2);
    assert.ok(['Ed', 'ED'].includes(algorithm));
    const verifier = path.join(__dirname, 'tools/verify-update-signature.cjs');
    const verify = (file, version, ...key) => {
      const result = spawnSync(process.execPath, [verifier, file, artifact + '.sig', version, ...key], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
      });
      if (result.error) throw result.error;
      return result;
    };
    const valid = verify(artifact, '2.0.0', cli.pub);
    assert.equal(valid.status, 0, valid.stderr);
    const wrongKey = verify(artifact, '2.0.0');
    assert.equal(wrongKey.status, 1, wrongKey.stderr);
    assert.match(wrongKey.stderr, /更新签名无效/);
    const wrongVersion = verify(artifact, '2.0.1', cli.pub);
    assert.equal(wrongVersion.status, 1, wrongVersion.stderr);
    assert.match(wrongVersion.stderr, /signed for version 2\.0\.0/);
    const modified = path.join(dir, 'modified.exe');
    const modifiedBytes = Buffer.from(bytes);
    modifiedBytes[0] ^= 1;
    fs.writeFileSync(modified, modifiedBytes);
    const tampered = verify(modified, '2.0.0', cli.pub);
    assert.equal(tampered.status, 1, tampered.stderr);
    assert.match(tampered.stderr, /更新签名无效/);
    console.log('发布验签脚本通过（临时密钥验签、默认公钥拒绝临时签名、版本不符、单字节篡改）');

    const signer = await makeNodeSigner();
    const ed = await signer.sign(bytes, 'Ed', 'v2.0.0');
    const prehashed = await signer.sign(bytes, 'ED', '2.0.0');
    const missing = await signer.sign(bytes, 'Ed', null);
    const mismatch = await signer.sign(bytes, 'ED', '1.9.0');
    const forged = Buffer.from(mismatch, 'base64').toString().replace('version:1.9.0', 'version:2.0.0');
    const packageManifest = path.join(dir, 'latest-electron.json');
    execFileSync(process.env.npm_node_execpath || 'node', [path.join(__dirname, 'tools/make-electron-manifest.mjs'),
      '2.0.0', 'v2.0.0', path.basename(artifact), artifact + '.sig', packageManifest],
    { env: { ...process.env, GITHUB_REPOSITORY: 'S0u1/silly-cat' } });
    const generated = JSON.parse(fs.readFileSync(packageManifest, 'utf8'));
    assert.equal(generated.platforms['windows-x86_64'].signature, cli.sig);
    assert.equal(generated.platforms['windows-x86_64'].url,
      'https://github.com/S0u1/silly-cat/releases/download/v2.0.0/' + path.basename(artifact));
    assert.equal(generated.version, '2.0.0');
    assert.ok(Number.isFinite(Date.parse(generated.pub_date)));

    const sample = [0, 1, 127, 128, 129, 255, 256, 257, 70321, 524289];
    for (const length of sample) {
      const input = Buffer.alloc(length, 'RFC 7693');
      const want = execFileSync(process.env.npm_node_execpath || 'node', ['-e',
        "process.stdout.write(require('crypto').createHash('blake2b512').update(require('fs').readFileSync(0)).digest())"], { input });
      assert.deepEqual(await portableBlake2b512(input), want);
    }

    let manifest, download = bytes, knownLength = true;
    let origin = 'http://127.0.0.1';
    const requests = [];
    function route(pathname) {
      requests.push(pathname);
      if (pathname === '/latest.json') return { status: 200, bytes: Buffer.from(JSON.stringify(manifest)) };
      if (pathname === '/setup.exe') return { status: 200, bytes: download };
      return { status: 404, bytes: Buffer.alloc(0) };
    }
    server = http.createServer((req, res) => {
      const answer = route(req.url);
      res.writeHead(answer.status, knownLength ? { 'Content-Length': answer.bytes.length } : {});
      res.write(answer.bytes.subarray(0, 32));
      res.end(answer.bytes.subarray(32));
    });
    let request;
    if (!inMemory) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      origin += ':' + server.address().port;
      // Exercise the application's net transport when running in the Electron UI process.
      const electron = process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE ? require('electron') : null;
      request = electron ? url => electron.net.request({ url, session: electron.session.fromPartition('updater') }) : url => http.request(url);
    } else {
      // Use the same Node HTTP parser, server and client with paired byte streams.
      // This mode is selected explicitly when the OS sandbox denies TCP listen().
      function connection() {
        function half(peer) {
          return new Duplex({
            read() {},
            write(bytes, encoding, done) { peer().push(Buffer.from(bytes)); done(); },
            final(done) { peer().push(null); done(); },
          });
        }
        const client = half(() => remote);
        const remote = half(() => client);
        server.emit('connection', remote);
        return client;
      }
      request = url => http.request(url, { createConnection: connection });
    }

    function scenario(pub = signer.pub, overrides = {}) {
      const launches = [], browsers = [], notices = [];
      let exits = 0;
      const updater = createUpdater({
        publicKey: pub, currentVersion: '1.0.0', manifestUrl: origin + '/latest.json', tempDir: dir,
        fetch: (url, opts) => fetchBytes(request, url, opts), emit: value => notices.push(value),
        probe: async () => {}, launch: async (file, args) => {
          assert.equal(path.basename(file), 'setup.exe');
          assert.equal(path.dirname(path.dirname(file)), dir);
          assert.deepEqual(fs.readFileSync(file), bytes);
          launches.push(args);
        },
        openRelease: async url => { browsers.push(url); }, quit: () => { exits++; }, schedule: false,
        ...overrides,
      });
      return { updater, launches, browsers, notices, exits: () => exits };
    }
    function serve(version, sig, data = bytes) {
      download = data;
      manifest = { version, notes: 'notes', pub_date: '2026-01-01T00:00:00Z',
        platforms: { 'windows-x86_64': { url: origin + '/setup.exe', signature: sig } } };
    }

    for (const [name, pub, sig, data, ok, detail] of [
      ['Tauri CLI ' + algorithm, cli.pub, cli.sig, bytes, true],
      ['Node Ed', signer.pub, ed, bytes, true], ['Node ED', signer.pub, prehashed, bytes, true],
      ['换钥', signer.pub, cli.sig, bytes, false, '更新签名无效'],
      ['篡改文件', cli.pub, cli.sig, Buffer.from('modified'), false, '更新签名无效'],
      ['缺版本', signer.pub, missing, bytes, false, 'does not specify'],
      ['版本不符', signer.pub, mismatch, bytes, false, 'signed for version 1.9.0'],
      ['篡改受信注释', signer.pub, Buffer.from(forged).toString('base64'), bytes, false, '更新签名无效'],
    ]) {
      const state = scenario(pub);
      serve('2.0.0', sig, data);
      assert.equal(state.updater.configured, true);
      assert.equal(state.updater.status(), null);
      await state.updater.check();
      assert.deepEqual(state.updater.status(), { kind: 'offer', title: '有新版本 v2.0.0', detail: '点这里更新', installable: true });
      await Promise.all([state.updater.install(), ...(ok ? [state.updater.install()] : [])]);
      assert.deepEqual(state.launches, ok ? [['--updated', '/S', '--force-run']] : [], name);
      assert.equal(state.exits(), ok ? 1 : 0, name);
      if (ok) {
        assert.ok(state.notices.some(n => n.detail === '100%'));
      } else {
        assert.equal(state.updater.status().kind, 'failed');
        assert.ok(state.updater.status().detail.includes(detail), name);
      }
    }
    for (const version of ['1.0.0', '0.9.9', '1.0.0-rc.1']) {
      const state = scenario();
      serve(version, ed);
      const start = requests.length;
      await state.updater.check();
      await state.updater.install();
      assert.equal(state.updater.status().title, '已是最新版本');
      assert.deepEqual(requests.slice(start), ['/latest.json']);
      assert.equal(state.launches.length, 0);
    }

    const auto = scenario();
    serve('v2.0.0', ed);
    await auto.updater.check(false);
    await auto.updater.setAuto({ autoUpdate: false });
    assert.equal(auto.updater.status(), null);
    const afterDisable = requests.length;
    await auto.updater.check(false);
    await auto.updater.install();
    assert.equal(requests.length, afterDisable);
    await auto.updater.check(true);
    await auto.updater.setAuto({ autoUpdate: true });
    await auto.updater.setAuto({ autoUpdate: false });
    knownLength = false;
    await auto.updater.install();
    knownLength = true;
    assert.ok(auto.notices.some(n => n && n.detail === '64 KiB'));
    assert.equal(auto.launches.length, 1);

    const blocked = scenario(signer.pub, { probe: async () => { throw Object.assign(new Error(), { code: 'EACCES' }); } });
    await blocked.updater.check();
    await blocked.updater.install();
    assert.equal(blocked.updater.status().title, '安装目录不可写');
    assert.deepEqual(blocked.browsers, ['https://github.com/ailcc/silly-cat/releases']);
    assert.equal(blocked.launches.length, 0);
    // The real factory selects a private session when fetching the release manifest.
    // Only the net factory is redirected to the local test fixture.
    const partitions = [], isolatedSession = {};
    const factory = createElectronUpdater({
      app: { getVersion: () => '1.0.0', getPath: () => dir }, shell: {}, emit() {},
      settings: { autoUpdate: false },
      session: { fromPartition(name) { partitions.push(name); return isolatedSession; } },
      net: { request(options) {
        assert.equal(options.url, 'https://github.com/ailcc/silly-cat/releases/latest/download/latest-electron.json');
        assert.equal(options.session, isolatedSession);
        return request(origin + '/latest.json');
      } },
    });
    await factory.check();
    assert.equal(factory.status().kind, 'offer');
    assert.deepEqual(partitions, ['updater']);
    factory.stop();

    const invalid = scenario('invalid').updater;
    assert.equal(invalid.configured, false);
    await invalid.check();
    assert.equal(invalid.status().detail, '未配置更新密钥');
    console.log(`更新器验收通过（${inMemory ? '显式内存传输，未运行 HTTP 回环' : 'HTTP 回环'}，临时 Tauri CLI ${algorithm} 签名，Ed / ED 正反例）`);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { runUpdaterTests };
if (require.main === module) {
  runUpdaterTests({ inMemory: process.argv.includes('--in-memory') }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
