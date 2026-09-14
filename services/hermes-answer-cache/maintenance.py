"""Bounded background index preparation and protected reference checks."""
import argparse
import hashlib
import json
import os
import unicodedata
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
            text_ok = ((case.get('exactAnswer') is None or answer['answer'] == case['exactAnswer'])
                       and all(fragment in answer['answer'] for fragment in case.get('requiredFragments', []))
                       and not any(fragment in answer['answer'] for fragment in case.get('forbiddenFragments', [])))
            verdict = 'correct' if identity_ok and text_ok else 'wrong'
        rows.append({'id': case['id'], 'verdict': verdict, 'elapsedMs': elapsed, 'answerable': expected is not None})
    times = sorted(row['elapsedMs'] for row in rows)
    return {'correct': sum(r['verdict'] == 'correct' for r in rows),
            'wrong': sum(r['verdict'] == 'wrong' for r in rows), 'total': len(rows),
            'p95Ms': times[min(len(times) - 1, int(len(times) * .95))], 'rows': rows,
            'boundary': 'cache-search-and-lookup-v1',
            'answerable': sum(r['answerable'] for r in rows),
            'answeredCorrectly': sum(r['answerable'] and r['verdict'] == 'correct' for r in rows),
            'abstainedCorrectly': sum(not r['answerable'] and r['verdict'] == 'correct' for r in rows)}


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


def normalize_question(question):
    return ''.join(c for c in unicodedata.normalize('NFKC', question).lower() if c.isalnum())


def overlaps_question(question, protected):
    left = normalize_question(question)
    grams = lambda value: {value[i:i + 3] for i in range(len(value) - 2)}
    a = grams(left)
    for other in protected:
        right = normalize_question(other)
        if left == right or (min(len(left), len(right)) >= 8 and (left in right or right in left)):
            return True
        b = grams(right)
        union = a | b
        if union and len(a & b) / len(union) >= .8:
            return True
    return False


def load_checks(path, holdout=False):
    document = json.loads(Path(path).read_text())
    checks = document.get('cases')
    if document.get('version') != 1 or not isinstance(checks, list) or not 4 <= len(checks) <= 200:
        raise ValueError('Protected evaluation checks are missing or invalid')
    if any(not isinstance(c.get('id'), str) or not c['id'] or not isinstance(c.get('question'), str)
           or not 1 <= len(c['question']) <= 4000 for c in checks):
        raise ValueError('Evaluation identities and questions are required')
    if len({c['id'] for c in checks}) != len(checks) or len({normalize_question(c['question']) for c in checks}) != len(checks):
        raise ValueError('Evaluation identities and questions must be unique')
    for check in checks:
        for field in ('requiredFragments', 'forbiddenFragments'):
            fragments = check.get(field, [])
            if not isinstance(fragments, list) or any(not isinstance(f, str) or not f for f in fragments):
                raise ValueError('Evaluation fragments must be nonempty strings')
        expected = check.get('expectedSource')
        if expected is not None and (not isinstance(expected, dict) or not all(
                isinstance(expected.get(key), str) and expected[key] for key in ('kind', 'id', 'sha256'))):
            raise ValueError('Evaluation source is invalid')
    if holdout:
        if document.get('provenance') != 'human-reviewed-real-questions' or not document.get('reviewedBy') or not document.get('reviewedAt'):
            raise ValueError('Independent holdout needs documented human review of real questions')
        if not any(c.get('expectedSource') for c in checks) or not any(not c.get('expectedSource') for c in checks):
            raise ValueError('Independent holdout needs answerable and abstention cases')
        if any(c.get('expectedSource') and not c.get('requiredFragments') for c in checks):
            raise ValueError('Independent answer checks need required source fragments')
    return checks


def check_question_separation(current, candidate, regression, holdout):
    known = [q for c in current.values() for q in [c['question'], *c['queries']]]
    if any(overlaps_question(c['question'], known + [r['question'] for r in regression]) for c in holdout):
        raise ValueError('Holdout questions overlap the existing catalogue or regression checks')
    protected = [c['question'] for c in regression + holdout]
    for key, case in candidate.items():
        old = current.get(key)
        old_words = [old['question'], *old['queries']] if old else []
        for wording in [case['question'], *case['queries']]:
            if wording not in old_words and overlaps_question(wording, protected):
                raise ValueError('Candidate question leaks protected evaluation')


def adoption_outcome(before, after, holdout_before=None, holdout_after=None):
    regression = decide(before, after)
    if regression in ('regression', 'slower'):
        return regression
    if holdout_before is None or holdout_after is None:
        return 'awaiting_holdout'
    independent = decide(holdout_before, holdout_after)
    if independent in ('regression', 'slower'):
        return independent
    return 'improved' if independent == 'improved' else 'plateau'


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
    checks = load_checks(reference_path)
    holdout_path = root / 'holdout.json'
    holdout_hash = digest(holdout_path) if holdout_path.exists() else None
    holdout = load_checks(holdout_path, holdout=True) if holdout_hash else []
    if payload.get('referenceSha256') != reference_hash or payload.get('holdoutSha256') != holdout_hash:
        raise ValueError('Evaluation changed after candidate preparation began')
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
    check_question_separation(current.cases, candidate.cases, checks, holdout)
    for check in checks + holdout:
        expected = check.get('expectedSource')
        if expected and valid_sources.get(expected['kind'] + ':' + expected['id']) != expected['sha256']:
            raise ValueError('Protected reference source changed or unavailable; review required')
    before = evaluate(current, checks, valid_sources)
    after = evaluate(candidate, checks, valid_sources)
    holdout_before = evaluate(current, holdout, valid_sources) if holdout else None
    holdout_after = evaluate(candidate, holdout, valid_sources) if holdout else None
    outcome = adoption_outcome(before, after, holdout_before, holdout_after)
    fact_report = None
    fact_hash = payload.get('factEvidenceSha256')
    if not holdout and fact_hash:
        from facts import certify, fact_checks
        fact_evidence_path = job / 'fact-evidence.json'
        fact_candidate_path = job / 'fact-candidate.json'
        if digest(fact_evidence_path) != fact_hash or digest(fact_candidate_path) != payload.get('factCandidateSha256'):
            raise ValueError('Source facts changed after preparation')
        factual_cases = read_catalogue(fact_candidate_path)
        proofs = certify(current.cases, factual_cases, json.loads(fact_evidence_path.read_text()), valid_sources)
        check_question_separation(current.cases, factual_cases, checks, [])
        fact_report = {'boundary': 'source-fact-contract-v1', 'newFacts': sum(p['question'] not in current.cases for p in proofs),
                       'newQuestions': sum(len(set(p['queries']) - set(current.cases.get(p['question'], {}).get('queries', [p['question']]))) for p in proofs),
                       'status': 'no_eligible_facts'}
        if not proofs and outcome == 'awaiting_holdout':
            outcome = 'plateau'
        if proofs:
            factual = QuestionCache(fact_candidate_path, root / 'index', model_dir, current.model)
            protected_after = evaluate(factual, checks, valid_sources)
            contract = fact_checks(proofs)
            contract_before = evaluate(current, contract, valid_sources)
            contract_after = evaluate(factual, contract, valid_sources)
            decision = adoption_outcome(before, protected_after, contract_before, contract_after)
            # Every new fact must work; aggregate gains cannot certify an untested/broken addition.
            if contract_after['correct'] != contract_after['total']:
                decision = 'regression'
            fact_report.update({'status': decision, 'current': contract_before, 'candidate': contract_after})
            outcome = decision
            candidate_path, candidate, after = fact_candidate_path, factual, protected_after
    history_path = root / 'history.json'
    history = json.loads(history_path.read_text()) if history_path.exists() else []
    baseline = next((r['current'] for r in history if r.get('referenceSha256') == reference_hash), before)
    baseline_regression = before['correct'] < baseline['correct'] or before['wrong'] > baseline['wrong']
    report = {'runId': run_id, 'finishedAt': time.time(), 'status': outcome,
              'referenceSha256': reference_hash, 'holdoutSha256': holdout_hash,
              'holdout': {'current': holdout_before, 'candidate': holdout_after},
              'sourceFacts': fact_report,
              'adoptionBasis': 'source-fact-contract-v1' if fact_report else 'independent-holdout',
              'catalogueGrowth': len(candidate.cases) - len(current.cases), 'current': before, 'candidate': after,
              'baselineRegression': baseline_regression, 'deterioratingTrend': trend(history, before, reference_hash),
              'sourceCount': len(sources.records), 'activated': False}
    report['candidateDecisions'] = payload.get('decisions', [])
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
    activation = {'factEvidenceSha256': fact_hash if fact_report else None,
                  'factCandidateSha256': payload.get('factCandidateSha256') if fact_report else None,
                  'baseCatalogueSha256': baseline_hash, 'referenceSha256': reference_hash, 'holdoutSha256': holdout_hash,
                  'sources': str(source_path.relative_to(root)), 'sourceSha256': digest(source_path),
                  'catalogue': str(candidate_path.relative_to(root)) if outcome == 'improved' else None,
                  'catalogueSha256': digest(candidate_path) if outcome == 'improved' else None}
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
            from embedding import EmbeddingDeferred
            atomic_json(root / 'jobs' / args.run_id / 'result.json',
                        {'runId': args.run_id, 'status': 'deferred' if isinstance(error, EmbeddingDeferred) else 'failed', 'finishedAt': time.time(),
                         'reason': str(error)[:300], 'activated': False})
            raise
