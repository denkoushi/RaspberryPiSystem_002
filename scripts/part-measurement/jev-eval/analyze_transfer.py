import json, sys
from common import S
cases = {c['id']: c for c in json.load(open(S/'data/transfer_cases.json'))}
for fn in sys.argv[1:]:
    rs = [json.loads(l) for l in open(fn)]; rs = [r for r in rs if not r.get('error')]
    def stats(sub, title):
        n = len(sub)
        if not n: return
        jev = sum(r['answer']['choice'] in r['gold'] for r in sub)
        base = sum(cases[r['id']]['cands'][0]['gold'] for r in sub)
        none = sum(r['answer']['choice'] == 'none' for r in sub)
        # JEV ranking excluding none: top choice among candidates
        def top(r, k):
            p = {kk: v for kk, v in r['answer']['probabilities'].items() if kk != 'none'}
            return sorted(p, key=p.get, reverse=True)[:k]
        t1 = sum(top(r, 1)[0] in r['gold'] for r in sub); t3 = sum(any(x in r['gold'] for x in top(r, 3)) for r in sub)
        b3 = sum(any(c['gold'] for c in cases[r['id']]['cands'][:3]) for r in sub)
        hi = [r for r in sub if r['answer']['choice'] != 'none' and r['answer']['probabilities'][r['answer']['choice']] >= 0.7]
        hio = sum(r['answer']['choice'] in r['gold'] for r in hi)
        comb = sum((r['answer']['choice'] in r['gold']) if r in hi else cases[r['id']]['cands'][0]['gold'] for r in sub)
        tok = sum(r['usage']['input_tokens'] for r in sub) / n
        print(f"  {title}: n={n} 位置の近さ {base} ({base/n:.1%}) / JEV選択 {jev} ({jev/n:.1%}, none {none}) / JEV候補内1位 {t1} ({t1/n:.1%}) 上位3 {t3} ({t3/n:.1%}) vs 位置上位3 {b3} ({b3/n:.1%})"
              f" / 確信0.7以上 {len(hi)}件中正解 {hio} / 確信時JEV・他は位置 {comb} ({comb/n:.1%}) / 平均入力 {tok:.0f} tok")
    print(fn.split('/')[-1], len(rs))
    stats(rs, '全件'); stats([r for r in rs if r['n'] > 1], '候補2件以上'); stats([r for r in rs if r['n'] >= 3], '候補3件以上')
