"""Bounded background index preparation and protected reference checks."""
import argparse
import hashlib
import json
import os
import time
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.chmod(0o600)
    temporary.replace(path)


def evaluate(cache, checks, valid_sources):
    rows = []
    for case in checks:
        started = time.perf_counter()
        suggestion = cache.search(case['question'])
        answer = cache.lookup(suggestion['question']) if suggestion else None
        elapsed = (time.perf_counter() - started) * 1000
        expected = case.get('expectedSource')
        if answer and any(valid_sources.get(s['kind'] + ':' + s['id']) != s['sha256'] for s in answer['sources']):
            answer = None
        if expected is None:
            verdict = 'wrong' if answer else 'correct'
        elif not answer:
            verdict = 'missing'
        else:
            references = {(s['kind'], s['id']) for s in answer['sources']}
            identity_ok = (expected['kind'], expected['id']) in references
            text_ok = all(fragment in answer['answer'] for fragment in case.get('requiredFragments', []))
            verdict = 'correct' if identity_ok and text_ok else 'wrong'
        rows.append({'id': case['id'], 'verdict': verdict, 'elapsedMs': elapsed})
    times = sorted(row['elapsedMs'] for row in rows)
    return {'correct': sum(r['verdict'] == 'correct' for r in rows),
            'wrong': sum(r['verdict'] == 'wrong' for r in rows), 'total': len(rows),
            'p95Ms': times[min(len(times) - 1, int(len(times) * .95))], 'rows': rows}


def decide(current, candidate):
    # Aggregate gains may not hide a newly wrong answer or a lost known answer.
    previous = {r['id']: r['verdict'] for r in current.get('rows', [])}
    if any((r['verdict'] == 'wrong' and previous.get(r['id']) != 'wrong') or
           (previous.get(r['id']) == 'correct' and r['verdict'] != 'correct')
           for r in candidate.get('rows', [])):
        return 'regression'
    if candidate['wrong'] > current['wrong']:
        return 'regression'
    if candidate['correct'] < current['correct']:
        return 'regression'
    # Ignore sub-millisecond jitter; sustained slowness is checked separately.
    if candidate['p95Ms'] > max(current['p95Ms'] * 1.3, current['p95Ms'] + 100):
        return 'slower'
    if candidate['correct'] > current['correct'] or candidate['wrong'] < current['wrong']:
        return 'improved'
    return 'plateau'


def trend(history, current, reference):
    comparable = [r for r in history if r.get('referenceSha256') == reference][-2:]
    samples = [r['current'] for r in comparable if isinstance(r.get('current'), dict)] + [current]
    if len(samples) < 3:
        return False
    quality = all(b['correct'] <= a['correct'] and b['wrong'] >= a['wrong'] for a, b in zip(samples, samples[1:]))
    degraded = samples[-1]['correct'] < samples[0]['correct'] or samples[-1]['wrong'] > samples[0]['wrong']
    slower = all(b['p95Ms'] > a['p95Ms'] * 1.1 for a, b in zip(samples, samples[1:]))
    return (quality and degraded) or slower


def maintain(root, run_id, model_dir):
    from server import QuestionCache, read_catalogue
    from sources import SourceCandidates
    root = Path(root).resolve()
    job = root / 'jobs' / run_id
    payload = json.loads((job / 'input.json').read_text())
    from runtime import inside
    current_path = inside(root, payload['baseCatalogueRelative'])
    baseline_hash = digest(current_path)
    if payload['baseCatalogueSha256'] != baseline_hash:
        raise ValueError('Catalogue changed before maintenance')
    reference_path = root / 'checks.json'
    reference_hash = digest(reference_path)
    reference = json.loads(reference_path.read_text())
    checks = reference['cases']
    if reference.get('version') != 1 or not 4 <= len(checks) <= 200:
        raise ValueError('Protected reference checks are missing or invalid')
    if len({c['id'] for c in checks}) != len(checks):
        raise ValueError('Reference identities must be unique')
    current = QuestionCache(current_path, root / 'index', model_dir)
    # API writes source-only version 2 exports; prepare them away from chat requests.
    source_path = job / 'sources.json'
    from runtime import MaintenanceRuntime
    _, previous_sources = MaintenanceRuntime(root, model_dir).paths()
    previous = SourceCandidates(previous_sources, root / 'index', current.model)
    sources = SourceCandidates(source_path, root / 'index', current.model, previous=previous)
    candidate_path = job / 'candidate.json'
    candidate = QuestionCache(candidate_path, root / 'index', model_dir, current.model)
    valid_sources = payload['sourceFingerprints']
    for record in read_catalogue(candidate_path).values():
        if any(valid_sources.get(s['kind'] + ':' + s['id']) != s['sha256'] for s in record['sources']):
            raise ValueError('Candidate has changed or unverified sources')
    # References themselves cannot silently become invalid or be used as training aliases.
    for check in checks:
        expected = check.get('expectedSource')
        if expected and valid_sources.get(expected['kind'] + ':' + expected['id']) != expected['sha256']:
            raise ValueError('Protected reference source changed or unavailable; review required')
    before = evaluate(current, checks, valid_sources)
    after = evaluate(candidate, checks, valid_sources)
    outcome = decide(before, after)
    if outcome == 'plateau' and len(candidate.cases) > len(current.cases):
        outcome = 'coverage_added'
    history_path = root / 'history.json'
    history = json.loads(history_path.read_text()) if history_path.exists() else []
    baseline = next((r['current'] for r in history if r.get('referenceSha256') == reference_hash), before)
    baseline_regression = before['correct'] < baseline['correct'] or before['wrong'] > baseline['wrong']
    report = {'runId': run_id, 'finishedAt': time.time(), 'status': outcome,
              'referenceSha256': reference_hash, 'current': before, 'candidate': after,
              'baselineRegression': baseline_regression, 'deterioratingTrend': trend(history, before, reference_hash),
              'sourceCount': len(sources.records), 'activated': False}
    report['preparationFailed'] = sum(d.get('verdict') == 'failed' for d in payload.get('decisions', []))
    live = payload.get('livePerformance', {})
    previous_live = next((r['livePerformance'] for r in reversed(history)
                          if r.get('livePerformance', {}).get('count', 0) >= 5), None)
    report['livePerformance'] = live
    report['liveSlower'] = bool(live.get('count', 0) >= 5 and previous_live and
                               (live['p95Ms'] > max(previous_live['p95Ms'] * 1.3, previous_live['p95Ms'] + 1000)
                                or live['over10sRate'] > previous_live['over10sRate'] + .1))
    # Record the exact files to switch. The request process applies this manifest
    # only after the worker exits successfully and verifies its current catalogue.
    activation = {'baseCatalogueSha256': baseline_hash, 'referenceSha256': reference_hash,
                  'sources': str(source_path.relative_to(root)), 'sourceSha256': digest(source_path),
                  'catalogue': str(candidate_path.relative_to(root)) if outcome in ('improved', 'coverage_added') else None,
                  'catalogueSha256': digest(candidate_path) if outcome in ('improved', 'coverage_added') else None}
    atomic_json(job / 'activation.json', activation)
    atomic_json(job / 'result.json', report)
    atomic_json(history_path, (history + [report])[-90:])
    return report


if __name__ == '__main__':
    import fcntl
    import re
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--model-dir', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f-]{36}', args.run_id):
        raise ValueError('Invalid maintenance identity')
    root = Path(args.root)
    with (root / 'maintenance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            print(json.dumps(maintain(root, args.run_id, args.model_dir)))
        except Exception as error:
            atomic_json(root / 'jobs' / args.run_id / 'result.json',
                        {'runId': args.run_id, 'status': 'failed', 'finishedAt': time.time(),
                         'reason': str(error)[:300], 'activated': False})
            raise
