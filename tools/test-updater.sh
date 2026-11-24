#!/bin/bash
# 在 macOS 上用当前架构测试；--build-only 只检查产物，随后清理。
set +x
set -euo pipefail
umask 077
[[ $(uname -s) == Darwin ]] || { echo '需要 macOS。' >&2; exit 1; }
if [[ $# -gt 1 || (${1:-} != '' && ${1:-} != --build-only) ]]; then
  echo "用法：$0 [--build-only]" >&2; exit 2
fi
cd "$(dirname "$0")/.."
cli="$PWD/node_modules/.bin/tauri"
[[ -x $cli ]] || { echo '先运行 npm ci 安装 Tauri CLI。' >&2; exit 1; }
# 只用当前工程的编译缓存及一次性密钥，忽略调用方的发布设置。
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PATH TAURI_SIGNING_PRIVATE_KEY_PASSWORD
unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
export CARGO_TARGET_DIR="$PWD/src-tauri/target"
export APPLE_SIGNING_IDENTITY="${UPDATER_TEST_IDENTITY:--}"
port=${UPDATER_TEST_PORT:-18741}
[[ $port =~ ^[1-9][0-9]{0,4}$ && $port -le 65535 ]] || { echo '端口无效' >&2; exit 1; }
base="http://127.0.0.1:$port"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/sillycat-updater.XXXXXXXX")
bundle="$CARGO_TARGET_DIR/release/bundle/macos"
app=SillyCat.app
archive="$app.tar.gz"
# CLI 会把测试产物写入标准 bundle 目录。先移开已有的同名产物，结束后还原。
saved=()
restore_build() {
  local path name
  for path in ${saved[@]+"${saved[@]}"}; do
    name=${path##*/}
    rm -rf -- "$path"
    if [[ -e "$tmp/original/$name" ]]; then mv "$tmp/original/$name" "$path"; fi
  done
  saved=()
}
cleanup() {
  restore_build
  rm -rf -- "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$tmp"/{keys,www,install,original} "$bundle"
for path in "$CARGO_TARGET_DIR/release/silly-cat" "$bundle/$app" "$bundle/$archive" "$bundle/$archive.sig"; do
  if [[ -e $path ]]; then mv "$path" "$tmp/original/"; fi
  saved+=("$path")
done

export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(openssl rand -hex 24)
for key in valid other; do
  "$cli" signer generate --ci --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
    --write-keys "$tmp/keys/$key" >/dev/null
done
id=com.drew.sillycat.updatertest
for version in 0.0.4 0.0.5; do
  python3 - "$tmp" "$id" "$version" "$base" <<'PY'
import json, sys
from pathlib import Path
tmp, identifier, version, base = sys.argv[1:]
root = Path(tmp)
config = {
    "identifier": identifier, "version": version,
    "bundle": {"createUpdaterArtifacts": version == "0.0.5"},
    "plugins": {"updater": {
        "pubkey": (root / "keys/valid.pub").read_text().strip(),
        "endpoints": [base + "/latest.json"], "dangerousInsecureTransportProtocol": True,
    }},
}
(root / "overlay.json").write_text(json.dumps(config))
PY
  TAURI_SIGNING_PRIVATE_KEY="$tmp/keys/valid" "$cli" build --ci --bundles app --config "$tmp/overlay.json"
  plist="$bundle/$app/Contents/Info.plist"
  [[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist") == "$id" ]]
  [[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist") == "$version" ]]
  if [[ $version == 0.0.4 ]]; then mv "$bundle/$app" "$tmp/install/"; fi
done
test -s "$bundle/$archive.sig"
mv "$bundle/$archive" "$tmp/www/"
mv "$bundle/$archive.sig" "$tmp/good.sig"
restore_build
TAURI_SIGNING_PRIVATE_KEY_PATH="$tmp/keys/other" "$cli" signer sign --app-version 0.0.5 "$tmp/www/$archive" >/dev/null
mv "$tmp/www/$archive.sig" "$tmp/bad.sig"
rm -rf -- "$tmp/keys"
unset TAURI_SIGNING_PRIVATE_KEY_PASSWORD

arch=$(rustc -vV | awk '/^host:/{split($2,a,"-"); print a[1]}')
python3 - "$tmp" "$base" "$archive" "$arch" <<'PY'
import json, sys
from pathlib import Path
tmp, base, archive, arch = sys.argv[1:]
tmp = Path(tmp)
assert (tmp / "bad.sig").read_bytes() != (tmp / "good.sig").read_bytes()
for case in ("bad", "good"):
    asset = {"url": base + "/" + archive, "signature": (tmp / (case + ".sig")).read_text().strip()}
    platforms = {key: asset for key in ("darwin-" + arch, "darwin-" + arch + "-app")}
    (tmp / (case + ".json")).write_text(json.dumps({"version": "0.0.5", "platforms": platforms}))
PY
cp "$tmp/bad.json" "$tmp/www/latest.json"
if [[ ${1:-} == --build-only ]]; then
  echo '两版测试 app、更新归档和正反两份签名清单均已生成；退出时自动清理。'
  exit
fi
cat <<STEPS

旧版已装到临时目录。保持本终端运行，另开一个终端按以下顺序测试。
1. open -n "$tmp/install/$app"
   若上次关闭过「自动检查更新」，先在测试版设置里打开并保存。
   若授权气泡优先显示，先给测试版授权并重启。记录测试进程的 PID 和路径：
   lsappinfo info "$id"
   约 10 秒出现 v0.0.5 气泡。
   点气泡，当前清单用另一把测试密钥签名，应拒绝安装并停在 0.0.4。
2. cp "$tmp/good.json" "$tmp/www/latest.json"
   托盘点「检查更新…」，再点气泡。应看到进度，替换并自动重启。查安装版本：
   /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$tmp/install/$app/Contents/Info.plist"
   再执行 lsappinfo info "$id"，确认新的 PID 对应同一临时安装路径。
   盘上版本应为 0.0.5，在重启后的猫上手动再查 0.0.5 清单应提示已是最新版本。
3. mv "$tmp/www/latest.json" "$tmp/www/missing.json"
   手动检查应提示失败。设置里关闭自动检查，退出并重启测试版，
   观察本终端至少 15 秒，没有新的 GET；手动点检查才会出现 GET。
4. 下次测试前可以在测试版设置里重新开启自动检查并保存。退出测试版，按 Ctrl+C 停止服务并清理临时目录。
   若要清理测试版设置和输入监控授权，可执行：
   rm -f "$HOME/Library/Application Support/$id/settings.json"
   tccutil reset ListenEvent $id

STEPS
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$tmp/www"
