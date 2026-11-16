#!/bin/sh
# 1つの機能の「変更の多さと広さ」を git の履歴から数える。読むだけで、何も書き換えない。
#
# 使い方: [REV=<SHA か参照>] sh scripts/analysis/feature-reach/change-width.sh <起点の日付 YYYY-MM-DD> <パス> [<パス> ...]
# 例:     REV=83678cbf sh scripts/analysis/feature-reach/change-width.sh 2026-10-17 apps/web/src/features/kiosk/grindingPlanningBoard
#
# 数えるのは REV(既定は origin/main)から辿れるマージ以外のコミットで、起点の日の 00:00 以降に指定したパスを触ったもの。
# 同じ数を後で再現できるよう、記録には REV に SHA を渡す。
# 1つのコミットで触ったファイル数と区画の数は、そのコミット全体で数える(--full-diff)。
# このため、指定したパスではテストだけを触ったコミットも、ほかで本体を触っていれば数に入る。
# 数えないもの: テスト(__tests__/、tests/、test/、.test.、.spec.、.snap)、生成物(generated/)、文書(docs/、.md)、画像、pnpm-lock.yaml。
# 区画は apps/<app>/src/<最上位フォルダ>(例: web/features、api/services)。それ以外は先頭2段(例: packages/shared-types、
# apps/api、scripts/deploy、infrastructure/ansible)で、リポジトリ直下のファイルはまとめて1区画とする。
# 出力: コミット数、ファイル数の中央値(偶数件は中央2つの平均)と75%点(切り上げ)と最大、3区画以上にまたがったコミット数。
set -eu
if [ "$#" -lt 2 ]; then
  echo "使い方: [REV=<SHA>] $0 <起点の日付> <パス> [<パス> ...]" >&2
  exit 2
fi
rev="${REV:-origin/main}"
if ! git rev-parse --verify --quiet "$rev^{commit}" >/dev/null; then
  echo "REV が見つかりません: $rev(origin/main なら先に git fetch origin main)" >&2
  exit 2
fi
since="$1"
shift
for p in "$@"; do
  if ! git cat-file -e "$rev:$p" 2>/dev/null; then
    echo "$rev にパスがありません: $p" >&2
    exit 2
  fi
  log=$(git log "$rev" --since="$since 00:00" --no-merges --full-diff --format='@%h' --name-only -- "$p")
  printf '%s\n' "$log" |
    awk '
      function flush() { if (c != "" && n > 0) { m = 0; for (k in d) m++; print n, m } }
      /^@/ { flush(); c = $0; n = 0; split("", d); next }
      /^$/ { next }
      /generated\/|__tests__\/|(^|\/)tests?\/|\.test\.|\.spec\.|\.snap$|^docs\/|\.md$|\.(png|jpe?g|gif|svg|webp)$|(^|\/)pnpm-lock\.yaml$/ { next }
      {
        n++
        s = split($0, a, "/")
        if (s == 1) k = "(root)"
        else if (a[1] == "apps" && a[3] == "src" && s >= 5) k = a[2] "/" a[4]
        else k = a[1] "/" a[2]
        d[k] = 1
      }
      END { flush() }' |
    sort -n |
    awk -v P="$p" '
      { f[NR] = $1; if ($2 >= 3) w++; t++ }
      END {
        if (t == 0) { print P ": コミット 0"; exit }
        if (t % 2) med = f[(t + 1) / 2]; else med = (f[t / 2] + f[t / 2 + 1]) / 2
        printf "%s: コミット %d、ファイル数 中央値 %g・75%%点 %d・最大 %d、3区画以上 %d\n", P, t, med, f[int(t * 0.75 + 0.999)], f[t], w + 0
      }'
done
