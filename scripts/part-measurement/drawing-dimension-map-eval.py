#!/usr/bin/env python3
"""Replay the inspection-drawing marker candidates (Milestone 4) on production dimension maps.

承認済みテンプレートの項目（丸数字の位置・項目名・基準値・上下限）を正解として、
寸法マップから候補を出す API と同じ並べ方を当てはめ、上位 k 件に正解がある割合と
上下限の案の一致率を出す。画像 AI も DB の書き込みも行わない。

使い方（Pi5 の DB は読み取りだけ。出力の TSV は図面の内容を含むので commit しない）:

  OUT=/tmp/pm-eval; mkdir -p "$OUT"
  python3 scripts/part-measurement/drawing-dimension-map-eval.py --print-sql maps  > "$OUT/maps.sql"
  python3 scripts/part-measurement/drawing-dimension-map-eval.py --print-sql items > "$OUT/items.sql"
  ssh raspi5-tailscale 'docker exec -i docker-db-1 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -q"' < "$OUT/maps.sql"  > "$OUT/maps.tsv"
  ssh raspi5-tailscale 'docker exec -i docker-db-1 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -q"' < "$OUT/items.sql" > "$OUT/items.tsv"
  python3 scripts/part-measurement/drawing-dimension-map-eval.py "$OUT"

並べ方を変えたときは apps/api/src/services/part-measurement/part-measurement-drawing-dimension-map-candidates.ts
と、このファイルの rank() / suggest() を同じに保つ。
"""

from __future__ import annotations

import argparse
import base64
import collections
import gzip
import itertools
import json
import math
import re
import sys
from pathlib import Path

SQL = {
    'maps': r"""\pset format unaligned
\pset fieldsep '\t'
\pset footer off
select "visualTemplateId", "imageWidth", "imageHeight", encode("payloadCompressed",'base64')
from "PartMeasurementDrawingDimensionMap" where status='COMPLETED';
""",
    'items': r"""\pset format unaligned
\pset fieldsep '\t'
\pset footer off
select t."visualTemplateId", t.id, t."isActive", i."measurementLabel", i."nominalValue", i."lowerLimit", i."upperLimit",
       i."markerXRatio", i."markerYRatio", i."calloutTipXRatio", i."calloutTipYRatio", i."depthMode", i."valueKind"
from "PartMeasurementTemplateItem" i join "PartMeasurementTemplate" t on t.id=i."templateId"
where t."visualTemplateId" is not null and i."markerXRatio" is not null;
""",
}

HOLE_LABELS = {'穴径', '内径'}
DEPTH_LABEL = re.compile('深さ|深サ')
UUID = re.compile(r'^[0-9a-f-]{36}$')


def load_maps(path: Path) -> dict:
    maps: dict = {}
    cur = None
    for line in path.read_text(encoding='utf-8').splitlines():
        line = re.sub(r'\(\d+ rows?\)$', '', line)
        parts = line.split('\t')
        if len(parts) == 4 and UUID.match(parts[0]):
            cur = parts[0]
            maps[cur] = {'w': int(parts[1]), 'h': int(parts[2]), 'b64': parts[3]}
        elif cur and len(parts) == 1 and line:
            maps[cur]['b64'] += line  # psql wraps base64 at 76 columns
    for m in maps.values():
        m['dims'] = json.loads(gzip.decompress(base64.b64decode(m['b64'])))['dimensions']
        del m['b64']
    return maps


def load_items(path: Path, maps: dict) -> list:
    items = []
    for line in path.read_text(encoding='utf-8').splitlines():
        parts = re.sub(r'\(\d+ rows?\)$', '', line).split('\t')
        if len(parts) < 13 or not UUID.match(parts[0]):
            continue
        vid, tid, active, label, nominal, lo, up, mx, my, tx, ty, depth_mode, value_kind = parts[:13]
        if vid not in maps or value_kind != 'NUMERIC' or depth_mode == 'THROUGH':
            continue
        try:
            nominal = float(nominal)
        except ValueError:
            continue
        if nominal == 0:
            continue
        opt = lambda s: float(s) if s else None  # noqa: E731
        items.append(dict(vid=vid, tid=tid, active=active == 't', label=label.strip(), nominal=nominal,
                          lo=opt(lo), up=opt(up), mx=float(mx), my=float(my), tx=opt(tx), ty=opt(ty),
                          depth_mode=depth_mode))
    return items


# --- same rules as part-measurement-drawing-dimension-map-candidates.ts ---

def wanted_kind(label: str, depth_mode: str) -> str:
    if not label:
        return 'len'
    if DEPTH_LABEL.search(label) and depth_mode != 'THROUGH':
        return 'depth'
    if label in HOLE_LABELS:
        return 'hole'
    if '度' in label:
        return 'gdt'
    return 'len'


def kind_ok(d: dict, w: str) -> bool:
    if w == 'depth':
        return d['depth'] is not None
    if w == 'hole':
        return d['kind'] == 'hole' or 'φ' in d['text']
    if w == 'gdt':
        return d['kind'] == 'gdt'
    return d['kind'] in ('len', 'ref', 'basic')


def value_of(d: dict, w: str):
    v = d['depth'] if w == 'depth' else d['nominal']
    return v if v is not None and math.isfinite(v) else None


def general_tolerance(n: float):
    for lo, hi, t in ((0.5, 6, 0.1), (6, 30, 0.2), (30, 120, 0.3), (120, 400, 0.5),
                      (400, 1000, 0.8), (1000, 2000, 1.2), (2000, 4000, 2.0)):
        if lo <= n <= hi:
            return t
    return None


def suggest(d: dict, w: str, v: float):
    if w == 'depth':
        return (None, 0.0)
    if w == 'gdt' or d['kind'] == 'gdt':
        return (0.0, -v)
    if d['upperTolerance'] is not None and d['lowerTolerance'] is not None:
        return (d['upperTolerance'], d['lowerTolerance'])
    g = general_tolerance(v)
    return (g, -g) if g is not None else (None, None)


def rank(m: dict, it: dict, limit: int = 5):
    w = wanted_kind(it['label'], it['depth_mode'])
    asp = m['w'] / m['h'] if m['w'] and m['h'] else 1

    def dist(d):
        a = math.hypot(d['xRatio'] - it['mx'], (d['yRatio'] - it['my']) / asp)
        if it['tx'] is None or it['ty'] is None:
            return a
        return min(a, math.hypot(d['xRatio'] - it['tx'], (d['yRatio'] - it['ty']) / asp))

    scored = [(dist(d), value_of(d, w), d) for d in m['dims'] if value_of(d, w) is not None]
    scored.sort(key=lambda e: (e[0], e[1]))
    preferred = [e for e in scored if kind_ok(e[2], w)]
    ordered = preferred if len(preferred) >= limit else preferred + [e for e in scored if e not in preferred]
    seen: set = set()
    out = []
    for dd, v, d in ordered:
        if v in seen:
            continue
        seen.add(v)
        out.append((v, d, dd))
        if len(out) >= limit:
            break
    return w, out


def evaluate(maps: dict, items: list, title: str) -> None:
    hit = collections.Counter()
    by_kind: dict = collections.defaultdict(collections.Counter)
    tol = collections.Counter()
    miss_labels = collections.Counter()
    miss_rank = collections.Counter()
    tol_mismatch = []
    for it in items:
        m = maps[it['vid']]
        n = it['nominal']
        w, out = rank(m, it, limit=50)
        hits = [abs(v - n) < 1e-6 for v, _, _ in out]
        by_kind[w]['n'] += 1
        for k in (1, 3, 5):
            hit[f'top{k}'] += any(hits[:k])
            by_kind[w][f'top{k}'] += any(hits[:k])
        in_map = any(abs((value_of(d, w) or 1e18) - n) < 1e-6 for d in m['dims'])
        hit['in_map'] += in_map
        by_kind[w]['in_map'] += in_map
        if not any(hits[:3]):
            miss_labels['ピッチ系' if 'ピッチ' in it['label'] else it['label']] += 1
            r = hits.index(True) + 1 if any(hits) else None
            miss_rank['none' if r is None else (r if r <= 8 else '9+')] += 1
        if any(hits[:5]) and it['lo'] is not None and it['up'] is not None:
            v, d, _ = out[hits.index(True)]
            su, sl = suggest(d, w, v)
            au, al = round(it['up'] - n, 4), round(it['lo'] - n, 4)
            tol[f'{w}_n'] += 1
            if w == 'depth':
                tol[f'{w}_lower_ok'] += sl is not None and abs(sl - al) < 1e-6
            else:
                ok = su is not None and sl is not None and abs(su - au) < 1e-6 and abs(sl - al) < 1e-6
                tol[f'{w}_ok'] += ok
                explicit = d['upperTolerance'] is not None and d['lowerTolerance'] is not None
                if not ok and explicit:
                    tol_mismatch.append((it['vid'][:8], it['tid'][:8], it['label'], n, d['text'],
                                         f'+{d["upperTolerance"]:g}/{d["lowerTolerance"]:g}', f'+{au:g}/{al:g}'))
    n_items = len(items)
    print(f'== {title}: items {n_items}, drawings {len({it["vid"] for it in items})}')
    print('  in_map {:.1f}%  top1 {:.1f}%  top3 {:.1f}%  top5 {:.1f}%'.format(
        *(100 * hit[k] / n_items for k in ('in_map', 'top1', 'top3', 'top5'))))
    for w, c in sorted(by_kind.items()):
        print(f'  {w:5s} n={c["n"]:4d} in_map {100 * c["in_map"] / c["n"]:5.1f}%  top1 {100 * c["top1"] / c["n"]:5.1f}%'
              f'  top3 {100 * c["top3"] / c["n"]:5.1f}%  top5 {100 * c["top5"] / c["n"]:5.1f}%')
    print('  tolerance suggestion on hits with limits:', dict(sorted(tol.items())))
    print('  top3 miss labels:', miss_labels.most_common(10))
    print('  rank of correct value among top3 misses:', dict(sorted(miss_rank.items(), key=lambda kv: str(kv[0]))))
    if tol_mismatch:
        print(f'  drawing has explicit tolerance but template differs ({len(tol_mismatch)}): visual | template | label | nominal | drawing | suggested | template')
        for row in sorted(tol_mismatch):
            print('   ', ' | '.join(map(str, row)))


def pitch_sum_check(maps: dict, items: list) -> None:
    pitch = [it for it in items if 'ピッチ' in it['label']]
    c = collections.Counter()
    for it in pitch:
        vals = [d['nominal'] for d in maps[it['vid']]['dims'] if d['nominal'] is not None]
        n = it['nominal']
        in_map = any(abs(v - n) < 1e-6 for v in vals)
        as_sum = any(abs(a + b - n) < 1e-6 for a, b in itertools.combinations(vals, 2))
        c[('in_map' if in_map else 'not_in_map', 'sum_exists' if as_sum else 'no_sum')] += 1
    print(f'== pitch items {len(pitch)}: correct value', dict(c))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dump_dir', nargs='?', help='directory holding maps.tsv and items.tsv')
    ap.add_argument('--print-sql', choices=sorted(SQL), help='print the psql script for one dump and exit')
    args = ap.parse_args()
    if args.print_sql:
        sys.stdout.write(SQL[args.print_sql])
        return 0
    if not args.dump_dir:
        ap.error('dump_dir is required')
    root = Path(args.dump_dir)
    maps = load_maps(root / 'maps.tsv')
    items = load_items(root / 'items.tsv', maps)
    active = [it for it in items if it['active']]
    evaluate(maps, active, 'active templates')
    evaluate(maps, items, 'all templates (incl. inactive)')
    pitch_sum_check(maps, active)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
