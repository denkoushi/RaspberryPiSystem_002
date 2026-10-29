#!/usr/bin/env bash
set -euo pipefail

app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host="${1:-${PI5_SSH_HOST:-raspi5-tailscale}}"
remote_dir="${2:-${PI5_APP_DIR:-/opt/RaspberryPiSystem_002/storage/haizen-app}}"
if [[ ! "$host" =~ ^[A-Za-z0-9_@.:-]+$ || "$host" == -* || ! "$remote_dir" =~ ^/[A-Za-z0-9_./-]+$ ]]; then
  echo 'Invalid SSH host or remote directory.' >&2
  exit 1
fi
cd "$app_dir"
./gradlew assembleDebug
apk="$app_dir/app/build/outputs/apk/debug/app-debug.apk"

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
build_tools="$(python3 - "$sdk/build-tools" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
versions = [p for p in root.iterdir() if p.is_dir() and (p / 'aapt2').is_file() and (p / 'apksigner').is_file()]
if not versions:
    sys.exit('No Android build-tools with aapt2 and apksigner found')
print(max(versions, key=lambda p: tuple(int(n) for n in re.findall(r'\d+', p.name))))
PY
)"
package_line="$("$build_tools/aapt2" dump badging "$apk" | sed -n '/^package: /p')"
version_fields="$(python3 - "$package_line" <<'PY'
import shlex, sys
fields = dict(token.split('=', 1) for token in shlex.split(sys.argv[1]) if '=' in token)
code = int(fields['versionCode'])
if code <= 0:
    sys.exit('Invalid versionCode')
print(code)
print(fields['versionName'])
PY
)"
version_code="${version_fields%%$'\n'*}"
version_name="${version_fields#*$'\n'}"
cert_output="$("$build_tools/apksigner" verify --print-certs "$apk")"
digest="$(printf '%s\n' "$cert_output" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | tr '[:upper:]' '[:lower:]')"
if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Cannot read signing certificate digest.' >&2
  exit 1
fi
cert_file="$app_dir/signing-cert.sha256"
if [[ ! -f "$cert_file" ]]; then
  printf 'Signing certificate SHA-256: %s\n' "$digest" >&2
  echo 'Confirm this is the existing app signing certificate, then create signing-cert.sha256 with that lowercase digest on one line.' >&2
  exit 1
fi
expected="$(cat "$cert_file")"
if [[ ! "$expected" =~ ^[0-9a-f]{64}$ || "$digest" != "$expected" ]]; then
  echo 'Signing certificate does not match signing-cert.sha256.' >&2
  exit 1
fi

remote_json="$(ssh "$host" "if [ -f '$remote_dir/version.json' ]; then cat '$remote_dir/version.json'; else printf '%s' '{}'; fi")"
python3 - "$version_code" "$remote_json" <<'PY'
import json, sys
remote = json.loads(sys.argv[2])
code = remote.get('versionCode', 0)
if type(code) is not int or code < 0:
    sys.exit('Invalid remote versionCode')
if code >= int(sys.argv[1]):
    sys.exit('Remote versionCode is already greater than or equal to this build')
PY

sha256="$(shasum -a 256 "$apk" | awk '{print $1}')"
size="$(wc -c < "$apk" | tr -d '[:space:]')"
file_name="haizen-$version_code.apk"
temporary="$(mktemp -d)"
trap 'rm -f "$temporary/version.json"; rmdir "$temporary"' EXIT
python3 - "$temporary/version.json" "$version_code" "$version_name" "$file_name" "$sha256" "$size" <<'PY'
import json, sys
with open(sys.argv[1], 'w') as output:
    json.dump(dict(versionCode=int(sys.argv[2]), versionName=sys.argv[3], fileName=sys.argv[4], sha256=sys.argv[5], size=int(sys.argv[6])), output)
    output.write('\n')
PY
ssh "$host" "mkdir -p '$remote_dir'"
scp "$apk" "$host:$remote_dir/.$file_name.tmp"
ssh "$host" "mv '$remote_dir/.$file_name.tmp' '$remote_dir/$file_name'"
scp "$temporary/version.json" "$host:$remote_dir/.version.json.tmp"
ssh "$host" "mv '$remote_dir/.version.json.tmp' '$remote_dir/version.json'"
ssh "$host" "find '$remote_dir' -maxdepth 1 -name 'haizen-*.apk' ! -name '$file_name' -delete"
printf 'Published %s (%s) to %s:%s\n' "$version_name" "$version_code" "$host" "$remote_dir"
