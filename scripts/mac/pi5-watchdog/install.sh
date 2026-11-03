#!/usr/bin/env bash
set -euo pipefail
umask 077
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/Library/Application Support/raspi-pi5-watchdog"
PLIST="$HOME/Library/LaunchAgents/com.raspi.pi5-watchdog.plist"
DOMAIN="gui/$(id -u)"
command -v python3 >/dev/null
mkdir -p "$DEST" "$(dirname "$PLIST")"
# Stop a loaded copy before replacing its files; absent jobs need no bootout.
if launchctl print "$DOMAIN/com.raspi.pi5-watchdog" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/com.raspi.pi5-watchdog"
fi
cp "$SOURCE/pi5-watchdog.sh" "$DEST/pi5-watchdog.sh"
python3 - "$SOURCE/com.raspi.pi5-watchdog.plist" "$PLIST" "$DEST/pi5-watchdog.sh" <<'PY'
import plistlib
import sys
from pathlib import Path
source, destination, script = map(Path, sys.argv[1:])
data = plistlib.loads(source.read_bytes())
data['ProgramArguments'][1] = str(script)
destination.write_bytes(plistlib.dumps(data))
PY
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Pi5見張りを登録しました: $PLIST"
