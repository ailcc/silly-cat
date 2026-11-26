'use strict';

const fs = require('node:fs/promises');
const { verifyUpdateSignature } = require('../updater');

async function main() {
  const args = process.argv.slice(2);
  const [installer, sigFile, version, publicKey] = args;
  if (!installer || !sigFile || !version || args.length > 4) {
    console.error('用法: verify-update-signature.cjs <安装包路径> <.sig 路径> <版本> [公钥]');
    process.exitCode = 2;
    return;
  }

  const [bytes, signature] = await Promise.all([
    fs.readFile(installer),
    fs.readFile(sigFile, 'utf8'),
  ]);
  await verifyUpdateSignature(bytes, signature.trim(), version, publicKey);
  console.log('更新签名验证通过');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
