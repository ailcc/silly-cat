#!/bin/bash
set -euo pipefail

die() { printf '错误：%s\n' "$*" >&2; exit 1; }

allow_single_arch=false
if [[ ${1:-} == --allow-single-arch ]]; then
  allow_single_arch=true
  shift
fi
[[ $# -ge 1 && $# -le 2 ]] || die "用法：$0 [--allow-single-arch] <.app | .dmg | .app.tar.gz> [期望SHA-1]"
artifact=$1
[[ $artifact == /* ]] || artifact=$PWD/$artifact
expected=$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]')
if [[ $# == 2 && ! $expected =~ ^[0-9a-f]{40}$ ]]; then
  die '期望 SHA-1 必须为 40 位无冒号的十六进制指纹。'
fi

temp=$(mktemp -d "${TMPDIR:-/tmp}/sillycat-verify.XXXXXXXX")
mountpoint=
cleanup() {
  local status=$?
  if [[ -n $mountpoint && $(stat -f %d "$mountpoint") != "$(stat -f %d "$temp")" ]]; then
    if ! hdiutil detach "$mountpoint" >/dev/null && ! hdiutil detach -force "$mountpoint" >/dev/null; then
      printf '错误：无法卸载 %s。\n' "$mountpoint" >&2
      exit 1
    fi
  fi
  rm -rf -- "$temp" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

case $artifact in
  *.app)
    app=$artifact
    ;;
  *.dmg|*.app.tar.gz)
    mkdir "$temp/bundle"
    if [[ $artifact == *.dmg ]]; then
      mountpoint=$temp/bundle
      hdiutil attach -readonly -nobrowse -mountpoint "$mountpoint" "$artifact" >/dev/null
    else
      tar -xzf "$artifact" -C "$temp/bundle"
    fi
    shopt -s nullglob
    apps=("$temp/bundle"/*.app)
    [[ ${#apps[@]} == 1 && ! -L ${apps[0]} ]] || die '安装包根目录必须包含且仅包含一个 .app。'
    app=${apps[0]}
    ;;
  *) die '支持的产物类型为 .app、.dmg 和 .app.tar.gz。' ;;
esac

[[ -d $app ]] || die "找不到应用 $app"
test_requirement='identifier "com.drew.sillycat"'
requirements=$(codesign -d -r- "$app" 2>&1) || die '无法读取签名要求。'
requirement=$(printf '%s\n' "$requirements" | sed -n 's/^\(# \)\{0,1\}designated => //p')
details=$(codesign -dv "$app" 2>&1) || die '无法读取签名详情。'
printf '%s\n' "$details" | /usr/bin/grep -Fx 'Identifier=com.drew.sillycat' >/dev/null || die '签名标识必须为 com.drew.sillycat。'
if printf '%s\n' "$details" | /usr/bin/grep -Fx 'Signature=adhoc' >/dev/null; then
  [[ -z $expected ]] || die '应用使用 ad-hoc 签名，与期望的证书签名不符。'
  # Native ad-hoc signatures synthesize a per-architecture cdhash requirement.
  adhoc='^cdhash H"[0-9a-f]{40}"( or cdhash H"[0-9a-f]{40}")*$'
  [[ $requirement =~ $adhoc ]] || die 'ad-hoc 签名缺少预期的 cdhash 要求。'
  warning='产物使用 ad-hoc 签名。用户升级后需要重新授权输入监控。'
  if [[ ${GITHUB_ACTIONS:-} == true ]]; then
    printf '::warning::%s\n' "$warning" >&2
  else
    printf '警告：%s\n' "$warning" >&2
  fi
else
  identifier='(^|[[:space:](])identifier "com\.drew\.sillycat"($|[[:space:])])'
  [[ $requirement =~ $identifier ]] || die '证书签名要求缺少 identifier "com.drew.sillycat"。'
  leaf='(^|[[:space:](])certificate leaf = H"([0-9a-f]{40})"($|[[:space:])])'
  cdhash='(^|[[:space:](])cdhash([[:space:]]|$)'
  [[ $requirement =~ $leaf ]] || die '签名要求缺少小写 SHA-1 的 certificate leaf 条件。'
  required_hash=${BASH_REMATCH[2]}
  [[ ! $requirement =~ $cdhash ]] || die '证书签名要求含有随构建变化的 cdhash。'
  codesign -d --extract-certificates="$temp/cert-" "$app" >/dev/null 2>&1 ||
    die '无法提取应用签名证书。'
  actual=$(/usr/bin/openssl dgst -sha1 "$temp/cert-0" | awk '{print tolower($NF)}') ||
    die '无法读取应用签名证书的 SHA-1。'
  [[ $actual == "$required_hash" ]] || die '签名要求与应用签名证书的 SHA-1 不一致。'
  [[ -z $expected || $actual == "$expected" ]] || die '应用签名证书与期望 SHA-1 不一致。'
  test_requirement="$test_requirement and certificate leaf = H\"$actual\""
fi
codesign --verify --strict --all-architectures --test-requirement "=$test_requirement" "$app"

executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
[[ -n $executable && $executable != */* ]] || die 'CFBundleExecutable 无效。'
archs=$(lipo -archs "$app/Contents/MacOS/$executable")
if [[ " $archs " != *' x86_64 '* || " $archs " != *' arm64 '* ]]; then
  if ! $allow_single_arch || [[ $archs != x86_64 && $archs != arm64 ]]; then
    die "预期同时包含 x86_64 和 arm64，实际为 ${archs}。"
  fi
fi

printf 'designated => %s\n' "$requirement"
printf 'Architectures: %s\n' "$archs"
