#!/usr/bin/env bash
set -euo pipefail

# 運用者が手で流す確認スクリプトは、既定で TLS 検証あり。
# 設定は scripts/lib/verify-curl-tls.sh の1か所にあり、VERIFY_ALLOW_INSECURE_TLS=1 のときだけ -k を付ける。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB="${ROOT_DIR}/scripts/lib/verify-curl-tls.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

SCRIPTS=(
  scripts/deploy/verify-phase12-real.sh
  scripts/deploy/verify-services-real.sh
  scripts/test/verify-signage-layout-config.sh
  scripts/test/verify-signage-display.sh
  scripts/test/security-e2e.sh
)

for rel in "${SCRIPTS[@]}"; do
  path="${ROOT_DIR}/${rel}"
  bash -n "$path"
  grep -Fq '/lib/verify-curl-tls.sh"' "$path" || fail "${rel} does not source scripts/lib/verify-curl-tls.sh"
  # 行の折り返しに関係なく、-k / --insecure の直書きを拒む(コメント行は除く)
  if grep -v '^[[:space:]]*#' "$path" | grep -En '(^|[[:space:]"])(-k|-sk|-ks|--insecure)([[:space:]"]|$)' >&2; then
    fail "${rel} passes -k/--insecure directly"
  fi
done
bash -n "$LIB"

run_lib() {
  bash -c 'set -euo pipefail; source "$1"; printf "[%s]|[%s]" "${VERIFY_CURL_TLS_ARGS[*]-}" "$(verify_curl_tls_remote_opts)"' _ "$LIB"
}

default="$(env -u VERIFY_ALLOW_INSECURE_TLS -u VERIFY_CA_CERT bash -c "$(declare -f run_lib); LIB='$LIB' run_lib")"
[ "$default" = "[]|[]" ] || fail "default adds curl TLS args: ${default}"

optin="$(env -u VERIFY_CA_CERT VERIFY_ALLOW_INSECURE_TLS=1 bash -c "$(declare -f run_lib); LIB='$LIB' run_lib")"
[ "$optin" = "[-k]|[-k]" ] || fail "opt-in result unexpected: ${optin}"

other="$(env -u VERIFY_CA_CERT VERIFY_ALLOW_INSECURE_TLS=true bash -c "$(declare -f run_lib); LIB='$LIB' run_lib")"
[ "$other" = "[]|[]" ] || fail "only the exact value 1 may disable verification: ${other}"

ca="$(env -u VERIFY_ALLOW_INSECURE_TLS VERIFY_CA_CERT='/tmp/my ca.pem' bash -c "$(declare -f run_lib); LIB='$LIB' run_lib")"
[ "$ca" = "[--cacert /tmp/my ca.pem]|[--cacert /tmp/my\\ ca.pem]" ] || fail "CA result unexpected: ${ca}"

printf 'operator scripts TLS default contract passed\n'
