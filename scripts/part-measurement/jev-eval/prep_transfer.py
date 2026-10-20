"""Write crops + JEV request manifest for task (2). Usage: prep_transfer.py <out.jsonl> [--ctx] [--only-multi] [--filter GROUP]"""
import json, sys, uuid, os
from crops import *
args = sys.argv[1:]; out = args[0]; ctx = '--ctx' in args
cs = json.load(open(S/'data/transfer_cases.json'))
if '--only-multi' in args: cs = [c for c in cs if len(c['cands']) > 1]
if '--filter' in args: cs = [c for c in cs if c['group'] == args[args.index('--filter') + 1]]
cd = S/'data/crops'; cd.mkdir(exist_ok=True)
def save(im, name):
    p = cd/f'{name}.jpg'
    if not p.exists(): im.save(p, quality=90)
    return str(p)
with open(out, 'w') as f:
    for c in cs:
        mk = (c['src_item']['mx'], c['src_item']['my'])
        sx, sy = (c['src_dim']['x'], c['src_dim']['y']) if c['src_dim'] else mk
        assets = {}; ref = lambda: str(uuid.uuid4())
        r_src = ref(); assets[r_src] = save(crop(c['src'], sx, sy, marker=mk), f"{c['id']}-src")
        state = {'item': f"項目名「{c['label']}」 基準値 {c['nominal']:g}", 'source_detail': r_src}
        if ctx:
            r = ref(); assets[r] = save(crop(c['src'], sx, sy, frac=0.45, ring=0.05, marker=mk), f"{c['id']}-srcctx"); state['source_context'] = r
        crit = {}
        for i, k in enumerate(c['cands']):
            r = ref(); assets[r] = save(crop(c['dst'], k['x'], k['y']), f"{c['dst'][:8]}-{k['x']:.4f}-{k['y']:.4f}")
            if ctx:
                r2 = ref(); assets[r2] = save(crop(c['dst'], k['x'], k['y'], frac=0.45, ring=0.05), f"{c['dst'][:8]}-{k['x']:.4f}-{k['y']:.4f}-ctx")
                crit[f'c{i+1}'] = f'新しい図面の候補{i+1}: 拡大 {r} / 周辺 {r2}'
            else:
                crit[f'c{i+1}'] = f'新しい図面の候補{i+1}: {r}'
        crit['none'] = 'どの候補も、元の図面の赤丸の寸法と同じ箇所の寸法ではない'
        f.write(json.dumps(dict(id=c['id'], gold=[f'c{i+1}' for i, k in enumerate(c['cands']) if k['gold']], n=len(c['cands']), state=state, criteria=crit, assets=assets), ensure_ascii=False) + '\n')
print(len(cs), 'cases ->', out)
