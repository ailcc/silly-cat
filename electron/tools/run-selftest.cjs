'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cwd = path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sillycat-profile-'));
try {
  // Run signing tests with the same crypto implementation as the installed app.
  const binary = require('electron');
  for (const [executable, args, env] of [
    [process.execPath, ['selftest.js', '--selftest'], {}],
    [process.execPath, ['tools/test-input-hook.cjs'], {}],
    [binary, ['updater-test.js'], { ELECTRON_RUN_AS_NODE: '1' }],
    [binary, ['.', '--selftest', ...process.argv.slice(2)], { SILLYCAT_SELFTEST_PROFILE: profile }],
  ]) {
    const result = spawnSync(executable, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error('自检进程退出', result.signal || result.status);
      process.exitCode = result.status || 1;
    }
  }
} finally {
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
