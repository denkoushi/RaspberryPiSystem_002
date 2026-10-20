"""Task (3): rerank the production top-5 marker candidates with JEV. Gold = candidate whose value equals the item's nominal."""
import json, uuid
from crops import *
from common import *
cd = S/'data/crops3'; cd.mkdir(exist_ok=True)
out = open(S/'data/m_rerank.jsonl', 'w'); n = 0
for vid in sorted(by_vid):
    for k, it in enumerate(by_vid[vid]):
        m = maps[vid]; w, top = ev.rank(m, it, limit=5)
        if not top: continue
        gold = [f'c{i+1}' for i, (v, d, _) in enumerate(top) if abs(v - it['nominal']) < 1e-6]
        cid = f'{vid[:8]}-{k}'; assets = {}
        r = str(uuid.uuid4()); p = cd/f'{cid}-src.jpg'
        mk = (it['mx'], it['my'])
        crop(vid, it['mx'], it['my'], frac=0.2, ring=0.0, marker=mk).save(p, quality=90); assets[r] = str(p)
        crit = {}
        for i, (v, d, _) in enumerate(top):
            rr = str(uuid.uuid4()); p = cd/f'{cid}-c{i+1}.jpg'
            crop(vid, d['xRatio'], d['yRatio'], marker=mk).save(p, quality=90); assets[rr] = str(p)
            crit[f'c{i+1}'] = f'候補{i+1}: {rr}'
        crit['none'] = 'どの候補も、この検査項目が測る寸法ではない'
        out.write(json.dumps(dict(id=cid, gold=gold, n=len(top), state={'item': f"項目名「{it['label']}」", 'marker_area': r},
                                  criteria=crit, assets=assets), ensure_ascii=False) + '\n'); n += 1
print(n)
