# Compare JEV image boundary judgments with the current bundle rule.
import json, sys
d = sys.argv[1]
pages = json.load(open(f'{d}/dataset.json'))
byid = {p['id']: p for p in pages}
PRICE_PER_TOKEN = 0.042 / 1e6  # USD, jev-1.13/1.14 input; output free (docs.typesafe.ai/models)


def load(path):
    rows = {}
    for line in open(path):
        r = json.loads(line)
        if 'error' not in r: rows[r['pair']] = r
    return rows


pairs = [(a['id'], b['id']) for a, b in zip(pages, pages[1:])]
truth = {f'{a}>{b}': byid[b]['start'] for a, b in pairs}  # True = new document starts
near_blank = {f'{a}>{b}' for a, b in pairs if (byid[a]['page'] >= 6 or byid[b]['page'] >= 6)}


def metrics(pred, keys):
    tp = sum(pred[k] and truth[k] for k in keys); fn = sum((not pred[k]) and truth[k] for k in keys)
    fp = sum(pred[k] and not truth[k] for k in keys); tn = sum((not pred[k]) and not truth[k] for k in keys)
    return {'n': len(keys), 'acc': (tp + tn) / len(keys), 'merge_err': fn, 'split_err': fp, 'boundaries': tp + fn, 'cont': fp + tn}


def bundles(pred):
    # chain pages; count documents that come out as exactly one bundle with nothing else in it
    groups, cur = [], [pages[0]['id']]
    for a, b in pairs:
        if pred[f'{a}>{b}']: groups.append(cur); cur = [b]
        else: cur.append(b)
    groups.append(cur)
    docs = {}
    for p in pages: docs.setdefault(p['doc'], set()).add(p['id'])
    exact = sum(any(set(g) == ids for g in groups) for ids in docs.values())
    return {'bundles': len(groups), 'docs': len(docs), 'exact_docs': exact}


def tokens_rule(a, b):
    ta, tb = set(byid[a]['docTokens']), set(byid[b]['docTokens'])
    return bool(ta and tb and not (ta & tb))


keys = list(truth)
rules = {
    '現行ルール(1枚ずつ撮った写真・ヒントなし: 1枚1束)': {k: True for k in keys},
    '現行ルール(複数書類を1つのPDFで送る: 全ページ1束)': {k: False for k in keys},
    '参考: PDF文字層の文書番号が変わったら区切る': {f'{a}>{b}': tokens_rule(a, b) for a, b in pairs},
}
results = {}
for path in sys.argv[2:]:
    rows = load(path)
    model = next(iter(rows.values()))['model']
    miss = [k for k in keys if k not in rows]
    if miss: print(model, 'missing', len(miss), miss[:5])
    p_new = {k: rows[k]['answer']['probabilities']['new_document'] for k in keys if k in rows}
    rules[f'JEV {model} 画像(p≥0.5で区切る)'] = {k: p_new.get(k, 0) >= 0.5 for k in keys}
    ms = sorted(r['ms'] for r in rows.values()); tok = [r['usage']['input_tokens'] for r in rows.values()]
    results[model] = {'median_ms': ms[len(ms) // 2], 'p90_ms': ms[int(len(ms) * 0.9)], 'mean_tokens': sum(tok) / len(tok),
                      'usd_per_pair': sum(tok) / len(tok) * PRICE_PER_TOKEN, 'calls': len(rows)}
    # threshold sweep and per-pair detail
    for t in (0.3, 0.5, 0.7):
        m = metrics({k: p_new.get(k, 0) >= t for k in keys}, keys)
        print(f'  {model} t={t}: acc={m["acc"]:.3f} merge_err={m["merge_err"]} split_err={m["split_err"]}')
    wrong = [(k, round(p_new[k], 2), 'B' if truth[k] else 'C', byid[k.split('>')[0]]['source'][:12], byid[k.split('>')[1]]['source'][:12]) for k in keys if k in p_new and (p_new[k] >= 0.5) != truth[k]]
    print('  wrong:', wrong)
    # separation: mean p_new on boundaries vs continuations
    pb = [p_new[k] for k in keys if truth[k] and k in p_new]; pc = [p_new[k] for k in keys if not truth[k] and k in p_new]
    auc = sum((x > y) + 0.5 * (x == y) for x in pb for y in pc) / (len(pb) * len(pc))
    results[model]['auc'] = auc

print('\n| 方式 | 正解率(全80組) | 誤結合(別の書類を同じ束に) | 取りこぼし(同じ書類が別の束に) | 正解率(白紙ページを含む組を除く) | 1冊がちょうど1束になった数 |')
print('|---|---|---|---|---|---|')
nb_keys = [k for k in keys if k not in near_blank]
for name, pred in rules.items():
    m = metrics(pred, keys); m2 = metrics(pred, nb_keys); b = bundles(pred)
    print(f'| {name} | {m["acc"]:.0%} ({round(m["acc"]*m["n"])}/{m["n"]}) | {m["merge_err"]}/{m["boundaries"]} | {m["split_err"]}/{m["cont"]} | {m2["acc"]:.0%} ({m2["n"]}組) | {b["exact_docs"]}/{b["docs"]} |')
print()
for model, r in results.items():
    print(f'{model}: calls={r["calls"]} median={r["median_ms"]}ms p90={r["p90_ms"]}ms tokens/pair={r["mean_tokens"]:.0f} usd/pair={r["usd_per_pair"]:.6f} AUC={r["auc"]:.3f}')
