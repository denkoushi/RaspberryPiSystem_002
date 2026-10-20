"""Build task (2) cases: source item -> sibling drawing; candidates = value-matched dims in target map."""
import json, collections
from common import *
cases = []
for g, vs in groups.items():
    for s in vs:
        for t in vs:
            if s == t: continue
            mt = maps[t]
            for k, it in enumerate(by_vid[s]):
                same = [j for j in by_vid[t] if j['label'] == it['label'] and abs(j['nominal'] - it['nominal']) < 1e-6]
                if not same: continue
                golds = [gd for gd in (gold_dim(mt, j) for j in same) if gd]
                if not golds: continue
                w = ev.wanted_kind(it['label'], it['depth_mode'])
                c = [dict(d, _v=ev.value_of(d, w)) for d in mt['dims'] if ev.value_of(d, w) is not None and abs(ev.value_of(d, w) - it['nominal']) < 1e-6]
                c = dedup(mt, c)
                for d in c:
                    d['_gold'] = any(d2(mt, d['xRatio'], d['yRatio'], gd['xRatio'], gd['yRatio']) < 0.01 for gd in golds)
                # baseline: nearest to the source item's relative position (marker/tip ratio)
                c.sort(key=lambda d: item_dist(mt, it, d))
                sd = gold_dim(maps[s], it)
                cases.append(dict(src_dim=(dict(x=sd['xRatio'], y=sd['yRatio'], text=sd['text']) if sd else None), id=f'{s[:8]}-{t[:8]}-{k}', group=g, src=s, dst=t, label=it['label'], nominal=it['nominal'],
                                  src_item=dict(mx=it['mx'], my=it['my'], tx=it['tx'], ty=it['ty']),
                                  cands=[dict(x=d['xRatio'], y=d['yRatio'], text=d['text'], kind=d['kind'], gold=d['_gold']) for d in c]))
json.dump(cases, open(S/'data/transfer_cases.json', 'w'), ensure_ascii=False)
n = len(cases); multi = [c for c in cases if len(c['cands']) > 1]
base_ok = sum(c['cands'][0]['gold'] for c in cases)
print('cases', n, 'multi-candidate', len(multi), 'baseline nearest-to-old-pos', base_ok, f'{base_ok/n:.1%}',
      'multi baseline', sum(c['cands'][0]['gold'] for c in multi))
print('cand count dist', collections.Counter(min(len(c['cands']), 10) for c in cases))
pairs = collections.Counter((vt[c['src']]['name'], vt[c['dst']]['name']) for c in cases)
print(len(pairs), 'drawing pairs')
