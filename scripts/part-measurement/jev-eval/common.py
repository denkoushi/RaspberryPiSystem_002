"""Shared loaders. EVAL_DIR holds data/{maps,items,tmpl}.tsv and data/img/ copied read-only from Pi5 (never commit them)."""
import importlib.util, os, pathlib, re, collections, math
S = pathlib.Path(os.environ['EVAL_DIR'])
REPO = pathlib.Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('ev', REPO/'scripts/part-measurement/drawing-dimension-map-eval.py')
ev = importlib.util.module_from_spec(spec); spec.loader.exec_module(ev)
maps = ev.load_maps(S/'data/maps.tsv')
items = [i for i in ev.load_items(S/'data/items.tsv', maps) if i['active']]
vt = {}
for line in (S/'data/tmpl.tsv').read_text().splitlines()[1:]:
    p = line.split('\t')
    if len(p) >= 3 and p[0] in maps:
        vt[p[0]] = dict(name=p[1], file=p[2].rsplit('/', 1)[-1])
import unicodedata
def base(name):
    name = unicodedata.normalize('NFKC', name)
    n = re.sub(r'^3351-MD\d+\s*', '', name); n = re.sub(r'^7161', '', n)
    n = re.sub(r'MD\d+', '', n); n = re.sub(r'[(].*?[)]', '', n)
    n = re.sub(r'^(X軸|Y軸|Z軸|本体|Y)', '', n)
    return n.strip()
by_vid = collections.defaultdict(list)
for it in items: by_vid[it['vid']].append(it)
groups = collections.defaultdict(list)
for v in by_vid: groups[base(vt[v]['name'])].append(v)

def asp(m): return m['w'] / m['h']
def d2(m, ax, ay, bx, by): return math.hypot(ax - bx, (ay - by) / asp(m))
def item_dist(m, it, d):
    a = d2(m, d['xRatio'], d['yRatio'], it['mx'], it['my'])
    if it['tx'] is None or it['ty'] is None: return a
    return min(a, d2(m, d['xRatio'], d['yRatio'], it['tx'], it['ty']))
def dedup(m, ds, eps=0.01):
    out = []
    for d in ds:
        if not any(d2(m, d['xRatio'], d['yRatio'], o['xRatio'], o['yRatio']) < eps and d.get('_v') == o.get('_v') for o in out): out.append(d)
    return out
def gold_dim(m, it, near=0.07):
    """dst item's dimension: value-matched dim nearest its marker/tip, if within `near`."""
    w = ev.wanted_kind(it['label'], it['depth_mode'])
    c = [d for d in m['dims'] if ev.value_of(d, w) is not None and abs(ev.value_of(d, w) - it['nominal']) < 1e-6]
    if not c: return None
    c.sort(key=lambda d: item_dist(m, it, d))
    return c[0] if item_dist(m, it, c[0]) <= near else None
