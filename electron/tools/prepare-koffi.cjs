'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// npm skips Windows optional dependencies on the macOS packaging host.
const packageName = '@koromix/koffi-win32-x64';
const binaryPath = 'win32_x64/koffi.node';
const appDir = path.resolve(__dirname, '..');
const locked = require('../package-lock.json').packages[`node_modules/${packageName}`];
const targetDir = path.join(appDir, 'node_modules', packageName);

function matchesTarget(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return manifest.name === packageName && manifest.version === locked.version &&
      fs.statSync(path.join(dir, binaryPath)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
}

if (!locked?.resolved || !locked.integrity?.startsWith('sha512-')) {
  throw new Error(`Missing registry tarball or SHA-512 integrity for ${packageName}`);
}

if (!matchesTarget(targetDir)) {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  const scratchDir = fs.mkdtempSync(path.join(path.dirname(targetDir), '.koffi-'));
  try {
    const npmArgs = ['pack', locked.resolved, '--ignore-scripts', '--json', '--pack-destination', scratchDir];
    const npmCli = process.env.npm_execpath;
    const packed = npmCli ? execFileSync(process.execPath, [npmCli, ...npmArgs]) : execFileSync('npm', npmArgs);
    const [{ filename }] = JSON.parse(packed);
    const archive = path.join(scratchDir, path.basename(filename));
    const actual = 'sha512-' + createHash('sha512').update(fs.readFileSync(archive)).digest('base64');
    if (actual !== locked.integrity) throw new Error(`Registry tarball integrity mismatch for ${packageName}`);

    execFileSync('tar', ['-xzf', archive, '-C', scratchDir]);
    const unpackedDir = path.join(scratchDir, 'package');
    if (!matchesTarget(unpackedDir)) throw new Error(`Registry tarball is missing ${packageName} ${binaryPath}`);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(unpackedDir, targetDir);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}
