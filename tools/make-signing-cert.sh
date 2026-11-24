#!/bin/bash
set +x
set -euo pipefail
umask 077

die() { printf '错误：%s\n' "$*" >&2; exit 1; }

[[ $# == 1 && -n $1 ]] || die "用法：$0 <仓库外的输出目录>"

# 先检查最近的现存父目录，避免在工作区内创建输出目录。
output=$1
[[ $output == /* ]] || output=$PWD/$output
parent=$output
while [[ ! -d $parent ]]; do
  parent=$(dirname "$parent")
done
parent=$(cd -P -- "$parent" && pwd -P)
if git -C "$parent" rev-parse --git-dir >/dev/null 2>&1; then
  die '输出目录在 Git 仓库内。请指定仓库外的目录。'
fi
mkdir -p -- "$output"
output=$(cd -P -- "$output" && pwd -P)
if git -C "$output" rev-parse --git-dir >/dev/null 2>&1; then
  die '输出目录在 Git 仓库内。请指定仓库外的目录。'
fi

files=(sillycat-signing.p12 sillycat-signing.p12.base64 sillycat-signing.password sillycat-signing.crt)
for file in "${files[@]}"; do
  [[ ! -e $output/$file && ! -L $output/$file ]] || die "已有同名文件 $output/${file}。请使用新的目录。"
done

temp=$(mktemp -d "$output/.sillycat-cert.XXXXXXXX")
published=0
cleanup() {
  local status=$?
  if (( status != 0 && published > 0 )); then
    local i
    for (( i=0; i<published; i++ )); do
      rm -f -- "$output/${files[i]}"
    done
  fi
  rm -rf -- "$temp" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cat > "$temp/cert.cnf" <<'CONF'
[req]
prompt = no
distinguished_name = subject
x509_extensions = signing

[subject]
CN = SillyCat Code Signing

[signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CONF

openssl=/usr/bin/openssl
pkcs12=("$openssl" pkcs12 -export)
if [[ $("$openssl" version) == 'OpenSSL 3.'* ]]; then
  pkcs12+=(-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1)
fi
"$openssl" req -x509 -newkey rsa:2048 -nodes -sha256 -days 7300 \
  -config "$temp/cert.cnf" -keyout "$temp/key.pem" -out "$temp/sillycat-signing.crt" 2>/dev/null \
  || die '生成证书失败。'
password=$("$openssl" rand -hex 32)
printf '%s' "$password" > "$temp/sillycat-signing.password"
unset password
"${pkcs12[@]}" -inkey "$temp/key.pem" -in "$temp/sillycat-signing.crt" \
  -name 'SillyCat Code Signing' -out "$temp/sillycat-signing.p12" \
  -passout "file:$temp/sillycat-signing.password" 2>/dev/null || die '导出 .p12 失败。'
/usr/bin/base64 -i "$temp/sillycat-signing.p12" -o "$temp/sillycat-signing.p12.base64"

sha1=$("$openssl" x509 -in "$temp/sillycat-signing.crt" -noout -fingerprint -sha1 |
  sed 's/.*=//; s/://g' | tr '[:lower:]' '[:upper:]')
[[ $sha1 =~ ^[0-9A-F]{40}$ ]] || die '读取证书 SHA-1 失败。'
for file in "${files[@]}"; do
  ln -- "$temp/$file" "$output/" || die "无法创建 $output/${file}。请检查目录权限和同名文件。"
  published=$((published + 1))
done

printf '证书 SHA-1：%s\n' "$sha1"
printf 'gh secret set MACOS_SIGNING_CERT_P12_BASE64 < %q\n' "$output/sillycat-signing.p12.base64"
printf 'gh secret set MACOS_SIGNING_CERT_PASSWORD < %q\n' "$output/sillycat-signing.password"
printf "gh variable set MACOS_SIGNING_CERT_SHA1 < <(printf '%%s' %q)\n" "$sha1"
