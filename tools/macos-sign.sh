#!/bin/bash
set +x
set -euo pipefail
umask 077

die() { printf '错误：%s\n' "$*" >&2; exit 1; }

[[ $# == 2 && $1 == sign && $2 == *.app && -d $2 ]] || die "用法：$0 sign <SillyCat.app>"
app=$(cd -P -- "$2" && pwd -P)
identifier=com.drew.sillycat
if [[ -z ${MACOS_SIGNING_CERT_P12_BASE64:-} && -z ${MACOS_SIGNING_CERT_PASSWORD:-} ]]; then
  warning='未配置 macOS 签名证书，使用 ad-hoc 签名。用户升级后需要重新授权输入监控。'
  if [[ ${GITHUB_ACTIONS:-} == true ]]; then
    printf '::warning::%s\n' "$warning"
  else
    printf '警告：%s\n' "$warning" >&2
  fi
  codesign --force --sign - --identifier "$identifier" "$app"
  exit
fi

[[ -n ${MACOS_SIGNING_CERT_P12_BASE64:-} && -n ${MACOS_SIGNING_CERT_PASSWORD:-} ]] ||
  die '请同时设置 MACOS_SIGNING_CERT_P12_BASE64 和 MACOS_SIGNING_CERT_PASSWORD，或同时清除两者以使用 ad-hoc 签名。'
expected=$(printf '%s' "${MACOS_SIGNING_CERT_SHA1:-}" | tr '[:upper:]' '[:lower:]')
[[ -z $expected || $expected =~ ^[0-9a-f]{40}$ ]] || die 'MACOS_SIGNING_CERT_SHA1 必须为 40 位无冒号的十六进制指纹。'

temp=$(mktemp -d "${TMPDIR:-/tmp}/sillycat-sign.XXXXXXXX")
keychain="$temp/signing.keychain-db"
p12="$temp/signing.p12"
search_list=()
restore_search_list=false
cleanup() {
  local status=$?
  if $restore_search_list && ! security list-keychains -d user -s ${search_list[@]+"${search_list[@]}"} >/dev/null 2>&1; then
    printf '错误：无法还原用户钥匙串搜索列表。\n' >&2
    status=1
  fi
  if [[ -e $keychain ]] && ! security delete-keychain "$keychain" >/dev/null 2>&1; then
    printf '错误：无法从钥匙串服务删除临时钥匙串。\n' >&2
    status=1
  fi
  rm -rf -- "$temp" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s' "$MACOS_SIGNING_CERT_P12_BASE64" | /usr/bin/base64 -D > "$p12" 2>/dev/null ||
  die '无法解码 .p12。请用 make-signing-cert.sh 输出的 .p12.base64 文件更新 Secret。'
unset MACOS_SIGNING_CERT_P12_BASE64
original=$(security list-keychains -d user) || die '无法读取用户钥匙串搜索列表。'
entry='^[[:space:]]*"(.+)"[[:space:]]*$'
while IFS= read -r line; do
  [[ -n $line ]] || continue
  [[ $line =~ $entry ]] || die '无法解析用户钥匙串搜索列表。'
  search_list+=("${BASH_REMATCH[1]}")
done <<< "$original"

password=$(/usr/bin/openssl rand -hex 32)
# create-keychain may itself modify the search list.
restore_search_list=true
security create-keychain -p "$password" "$keychain" >/dev/null 2>&1 || die '无法创建临时钥匙串。'
security set-keychain-settings "$keychain" >/dev/null 2>&1 ||
  die '无法配置临时钥匙串。'
security unlock-keychain -p "$password" "$keychain" >/dev/null 2>&1 ||
  die '无法解锁临时钥匙串。'
security import "$p12" -k "$keychain" -P "$MACOS_SIGNING_CERT_PASSWORD" -T /usr/bin/codesign >/dev/null 2>&1 ||
  die '导入 .p12 失败。请确认两个签名 Secrets 来自同一次证书生成，或同时清除两者以使用 ad-hoc 签名。'
unset MACOS_SIGNING_CERT_PASSWORD
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null 2>&1 ||
  die '无法授予 codesign 访问临时钥匙串私钥的权限。'
unset password

hash=$(security find-certificate -a -Z "$keychain" | awk '/^SHA-1 hash: / {print $3}') ||
  die '无法读取临时钥匙串中的证书。'
[[ $hash =~ ^[0-9A-Fa-f]{40}$ ]] || die '.p12 必须只包含一张签名证书。'
# An untrusted self-signed identity needs to be in the user search list.
security list-keychains -d user -s ${search_list[@]+"${search_list[@]}"} "$keychain" >/dev/null ||
  die '无法将临时钥匙串加入用户搜索列表。'
codesign --force --sign "$hash" --keychain "$keychain" --identifier "$identifier" \
  --options runtime --timestamp=none "$app" || die 'macOS 证书签名失败。'

if [[ -n $expected ]]; then
  codesign -d --extract-certificates="$temp/signed-cert-" "$app" >/dev/null 2>&1 ||
    die '无法提取应用签名证书。'
  actual=$(/usr/bin/openssl dgst -sha1 "$temp/signed-cert-0" | awk '{print tolower($NF)}') ||
    die '无法读取应用签名证书的 SHA-1。'
  [[ $actual == "$expected" ]] || die '应用签名证书与 MACOS_SIGNING_CERT_SHA1 不一致。请核对 Variable 和 Secrets。'
fi
