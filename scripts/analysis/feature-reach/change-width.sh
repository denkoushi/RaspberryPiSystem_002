#!/bin/sh
# 1つの機能の「変更の多さと広さ」を git の履歴から数える。読むだけで、何も書き換えない。
#
# 使い方: sh scripts/analysis/feature-reach/change-width.sh <起点の日付 YYYY-MM-DD> <パス> [<パス> ...]
# 例:     sh scripts/analysis/feature-reach/change-width.sh 2026-10-17 apps/web/src/features/kiosk/grindingPlanningBoard
#
# 数えるのは origin/main のマージ以外のコミットで、指定したパスのどれかを触ったもの。
# 1つのコミットで触ったファイル数と区画の数を数える。テスト、生成物、文書、画像は数えない。
# 区画は apps/<app>/src/<最上位フォルダ>(例: web/features、api/services)と packages/<名前> とする。
# 出力: コミット数、ファイル数の中央値と75%点と最大、3区画以上にまたがったコミット数。
set -eu
if [ "$#" -lt 2 ]; then
  echo "使い方: $0 <起点の日付> <パス> [<パス> ...]" >&2
  exit 2
fi
since="$1"
shift
for p in "$@"; do
  git log origin/main --since="$since" --no-merges --full-diff --format='@%h' --name-only -- "$p" |
    awk '
      function flush() { if (c != "" && n > 0) { m = 0; for (k in d) m++; print n, m } }
      /^@/ { flush(); c = $0; n = 0; split("", d); next }
      /^$/ { next }
      /generated\/|__tests__\/|\.test\.|\.spec\.|^docs\/|\.md$|\.png$|\.jpg$/ { next }
      { n++; split($0, a, "/"); k = a[1] "/" a[2]; if (a[1] == "apps" && a[3] == "src") k = a[2] "/" a[4]; d[k] = 1 }
      END { flush() }' |
    sort -n |
    awk -v P="$p" '
      { f[NR] = $1; if ($2 >= 3) w++; t++ }
      END {
        if (t == 0) { print P ": コミット 0"; exit }
        printf "%s: コミット %d、ファイル数 中央値 %d・75%%点 %d・最大 %d、3区画以上 %d\n", P, t, f[int((t + 1) / 2)], f[int(t * 0.75 + 0.999)], f[t], w + 0
      }'
done
