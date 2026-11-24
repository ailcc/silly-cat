#!/usr/bin/env node
// 生成 Win7 版自己的更新清单 latest-win7.json。
// 主线的 latest.json 指向普通 Windows 包，Win7 用户被更新到那个包会打不开，
// 所以 Win7 版的 tauri.win7.conf.json 把更新地址改成这个单独的清单。
//
// 用法：node tools/make-win7-manifest.mjs <版本> <标签> <安装包文件名> <.sig 文件> <输出文件>
import { readFileSync, writeFileSync } from 'node:fs';

const [version, tag, installer, sigFile, out] = process.argv.slice(2);
if (!version || !tag || !installer || !sigFile || !out) {
  console.error('用法: make-win7-manifest.mjs <版本> <标签> <安装包文件名> <.sig 文件> <输出文件>');
  process.exit(2);
}

const repo = process.env.GITHUB_REPOSITORY || 'S0u1/silly-cat';
const url = `https://github.com/${repo}/releases/download/${tag}/${installer}`;
// 清单里的 signature 是 .sig 文件的完整文本，原样放进去
const signature = readFileSync(sigFile, 'utf8').trim();
if (!signature) {
  console.error(`${sigFile} 是空的`);
  process.exit(1);
}

const manifest = {
  version,
  notes: `SillyCat ${version}（Windows 7 / 8 / 8.1 版）`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': { signature, url },
  },
};
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`已写入 ${out}：${version} -> ${url}`);
