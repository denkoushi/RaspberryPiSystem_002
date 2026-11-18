#!/bin/bash
set -euo pipefail
export LC_ALL=C

log_dir=${OFFLINE_DR_LOG_DIR:-/root/offline-dr}
max_days=${OFFLINE_DR_MAX_DAYS:-30}
alert_script=${OFFLINE_DR_ALERT_SCRIPT:-/opt/RaspberryPiSystem_002/scripts/generate-alert.sh}
now=${OFFLINE_DR_NOW_EPOCH:-$(date +%s)}

last_ok=none
days=-1 # No elapsed time is available without a successful copy.
seconds_per_day=86400
logs=("$log_dir"/copy-*.log)
# Under LC_ALL=C the filename order matches the order of the copy start times.
for ((i = ${#logs[@]} - 1; i >= 0; i--)); do
  log=${logs[i]}
  [[ -f "$log" && ${log##*/} =~ ^copy-([0-9]{8}-[0-9]{6})\.log$ ]] || continue
  stamp=${BASH_REMATCH[1]}
  last_line=$(tail -n 1 "$log")
  [[ "$last_line" == RESULT=OK ]] || continue
  # The copy script records the filename in the host's local time.
  if ! last_epoch=$(python3 -c '
from datetime import datetime
import sys

try:
    print(int(datetime.strptime(sys.argv[1], "%Y%m%d-%H%M%S").timestamp()))
except ValueError:
    sys.exit(1)
' "$stamp"); then
    continue
  fi
  last_ok="${stamp:0:4}-${stamp:4:2}-${stamp:6:2}"
  elapsed=$((now - last_epoch))
  days=$((elapsed / seconds_per_day))
  if ((elapsed <= 10#$max_days * seconds_per_day)); then
    printf 'Offline DR copy is current (lastOk=%s;days=%s)\n' "$last_ok" "$days"
    exit 0
  fi
  break
done

/bin/bash "$alert_script" offline-dr-copy-overdue "USBメモリに控えを写してください。" "lastOk=$last_ok;days=$days"
