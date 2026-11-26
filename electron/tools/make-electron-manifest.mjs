#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const [version, tag, installer, sigFile, output] = process.argv.slice(2);
if (!version || !tag || !installer || !sigFile || !output) {
  console.error('用法: make-electron-manifest.mjs <版本> <标签> <安装包文件名> <.sig 文件> <输出文件>');
  process.exit(2);
}

const signature = readFileSync(sigFile, 'utf8').trim();
if (!signature) throw new Error('签名文件为空');
const repository = process.env.GITHUB_REPOSITORY || 'S0u1/silly-cat';
const url = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(installer)}`;
const manifest = {
  version,
  notes: `捣蛋猫 兼容版 ${version}（Windows x64）`,
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature, url } },
};
writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
console.log(`已写入 ${output}`);
