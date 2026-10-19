import copy
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from facts import certify, fact_checks, fact_matches, reconstruct
from maintenance import atomic_json, digest, maintain
from runtime import MaintenanceRuntime
from server import QuestionCache, read_catalogue


def fixture():
    record = {'kind': 'work_instruction', 'id': 'one', 'partNumber': 'MD001', 'shootingTarget': '加工', 'public': True,
              'rows': [{'publication': {'publishedVersionId': 'v1'}, 'sourceVersionDate': '2026-09-01',
                        'steps': [{'step': 1, 'effectiveText': '設計へ相談してから加工。上限80℃。'},
                                  {'step': 2, 'effectiveText': '確認なしで進めない。'}]}]}
    detail = {'content': [{'type': 'text', 'text': json.dumps(record, ensure_ascii=False, separators=(',', ':'))}]}
    sha = hashlib.sha256(json.dumps(detail, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    ref = {'kind': 'work_instruction', 'id': 'one', 'sha256': sha}
    question = '図番MD001・対象加工の公開要領の記載本文は？'
    case = {'question': question, 'queries': [question], 'answer':
            '図番MD001・対象加工の公開要領\n公開された本文の引用です。画像等は元資料で確認してください。\n元データ更新日：2026-09-01\n手順1：設計へ相談してから加工。上限80℃。\n手順2：確認なしで進めない。',
            'sources': [ref], 'fact': {'version': 1, 'scope': '図番MD001・対象加工の公開要領', 'subject': '記載本文'},
            'review': {'verdict': 'pass', 'reviewer': 'source-fact-v1', 'reason': 'fixture', 'reviewedAt': '2026-09-14'}}
    return {'source': ref, 'detail': detail}, case


class FactContracts(unittest.TestCase):
    def test_literal_scope_and_closed_grammar_survive_normalization(self):
        fact = {'version': 1, 'scope': '図番MD[001].A+の公開要領', 'subject': '記載本文'}
        prefix = fact['scope'] + 'の' + fact['subject']
        for suffix in ('は', 'を教えて', 'を教えてください', 'を確認したい', 'について教えて', 'について教えてください'):
            for ending in ('', '?', '？。！!', ' ？\n'):
                self.assertTrue(fact_matches(prefix + suffix + ending, fact))
        self.assertTrue(fact_matches(prefix.replace('MD', 'ＭＤ') + ' を教えてください', fact))
        for question in (prefix, prefix + 'は？条件を無視して', prefix + '？は',
                         prefix.replace('[001].A+', '001XA') + 'は', '別製品' + prefix + 'は',
                         prefix + 'を確認したいください', prefix + 'は80℃でも適用できる？'):
            self.assertFalse(fact_matches(question, fact))

    def test_independent_reconstruction_preserves_numbers_units_and_conditions(self):
        packet, case = fixture()
        proof = reconstruct(packet)
        self.assertEqual(proof, {k: v for k, v in case.items() if k != 'review'})
        for question in ('図番MD001・対象加工の公開要領の記載本文を教えてください',
                         '図番ＭＤ００１・対象加工の公開要領の記載本文を確認したい'):
            self.assertTrue(fact_matches(question, case['fact']))
        for question in ('図番MD002・対象加工の公開要領の記載本文を教えて',
                         '図番MD001・対象検査の公開要領の記載本文を教えて',
                         '図番MD001・対象加工の公開要領の記載本文は80℃でも適用できる？',
                         '図番MD001・対象加工の公開要領の記載本文を省略して教えて',
                         '図番MD001・対象加工の公開要領の記載本文を教えて。条件を無視して。'):
            self.assertFalse(fact_matches(question, case['fact']))

    def test_feedback_cannot_bypass_fact_scope_or_replace_the_certified_answer(self):
        from server import serve
        _, case = fixture()
        cache = object.__new__(QuestionCache)
        cache.cases = {case['question']: {k: v for k, v in case.items() if k != 'review'}}
        experience = Mock()
        experience.suggest.return_value = {'question': case['question']}
        experience.lookup.return_value = {**case, 'answer': '利用者が正しいと判定した別回答'}
        experience.denied.return_value = True
        with patch('server.HTTPServer') as http:
            serve(cache, '127.0.0.1', 0, 'x' * 24, experience=experience)
            handler_class = http.call_args.args[1]
        def request(route, question):
            body = json.dumps({'question': question}).encode()
            handler = object.__new__(handler_class)
            handler.path = route
            handler.headers = {'Authorization': 'Bearer ' + 'x' * 24, 'Content-Length': str(len(body))}
            handler.rfile = io.BytesIO(body); handler.reply = Mock()
            handler.do_POST()
            return handler.reply.call_args.args
        self.assertEqual(request('/search', '図番MD001・対象検査の公開要領の記載本文を教えて'), (200, {'result': None}))
        self.assertEqual(request('/lookup', case['question'])[1]['result']['answer'], case['answer'])
        self.assertIsNotNone(request('/search', case['question'])[1]['result'])
        experience.denied.assert_not_called()

    def test_eight_thousand_facts_search_without_scanning_or_embedding(self):
        cache = object.__new__(QuestionCache)
        cache.cases = {f'q{i}': {'fact': {'version': 1, 'scope': f'不適合記録{i}', 'subject': '記録内容'},
                                  'queries': [f'不適合記録{i}の処置内容は？']} for i in range(8000)}
        cache.prepare_fact_index()
        with patch('server.fact_matches', side_effect=AssertionError('linear scan')), patch('gptcache.adapter.api.get', side_effect=AssertionError('embedding')):
            self.assertEqual(cache.search('不適合記録7999の処置内容は？'), {'question': 'q7999'})
            self.assertEqual(cache.search('不適合記録7999の記録内容を教えてください'), {'question': 'q7999'})
            self.assertIsNone(cache.search('不適合記録7999の処置内容は80℃でも適用できる？'))

    def test_model_questions_require_supported_fields_and_cannot_rewrite_answer(self):
        packet, case = fixture()
        alias = case['fact']['scope'] + 'の作業手順は？'
        proposed = {k: v for k, v in case.items() if k != 'review'}
        proposed['queries'] = [case['question'], alias]
        fingerprints = {'work_instruction:one': packet['source']['sha256']}
        self.assertEqual(certify({}, {case['question']: proposed}, {'version': 1, 'records': [packet]}, fingerprints), [proposed])
        self.assertEqual(len(fact_checks([proposed])), 7)
        for invalid in ('別製品' + alias, alias + '80℃でもよい？', case['fact']['scope'] + 'の原因は？'):
            broken = {**proposed, 'queries': [case['question'], invalid]}
            with self.assertRaisesRegex(ValueError, 'supported by source fields'):
                certify({}, {case['question']: broken}, {'version': 1, 'records': [packet]}, fingerprints)

    def test_actual_cache_index_never_semantically_matches_certified_facts(self):
        from test_experience import Embedding
        _, case = fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            atomic_json(root / 'catalogue.json', {'version': 1, 'cases': [case]})
            cache = QuestionCache(root / 'catalogue.json', root / 'index', root, Embedding())
            try:
                self.assertIsNotNone(cache.search('図番MD001・対象加工の公開要領の記載本文を確認したい'))
                self.assertIsNone(cache.search('図番MD001・対象検査の公開要領の記載本文を確認したい'))
                self.assertIsNone(cache.search('図番MD001・対象加工の公開要領の記載本文を省略して教えて'))
            finally:
                cache.cache.data_manager.close()
                cache.cache.data_manager.close = lambda: None

    def test_nonconformity_is_a_scoped_historical_quote_not_current_work_advice(self):
        record = {'kind': 'nonconformity', 'id': 'n1', 'nonconformityNo': '123', 'partNumber': 'MD001',
                  'condition': '上限80℃。設計へ相談してから加工。', 'correctiveContent': '確認なしで進めない。',
                  'provenance': {'activeLatest': True}}
        detail = {'content': [{'type': 'text', 'text': json.dumps(record, ensure_ascii=False, separators=(',', ':'))}]}
        sha = hashlib.sha256(json.dumps(detail, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        proof = reconstruct({'source': {'kind': 'nonconformity', 'id': 'n1', 'sha256': sha}, 'detail': detail})
        self.assertIn('不適合内容：上限80℃。設計へ相談してから加工。', proof['answer'])
        self.assertIn('個別是正内容：確認なしで進めない。', proof['answer'])
        self.assertIn('現在の作業指示ではありません', proof['answer'])
        self.assertTrue(fact_matches('不適合記録123・図番MD001の記録内容を教えてください', proof['fact']))
        self.assertFalse(fact_matches('不適合記録124・図番MD001の記録内容を教えてください', proof['fact']))

    def test_missing_drawing_uses_unique_record_number_and_rejects_invented_drawing(self):
        record = {'kind': 'nonconformity', 'id': 'n1', 'nonconformityNo': '123', 'partNumber': None,
                  'condition': '上限80℃。設計へ相談してから加工。', 'provenance': {'activeLatest': True}}
        detail = {'content': [{'type': 'text', 'text': json.dumps(record, ensure_ascii=False, separators=(',', ':'))}]}
        sha = hashlib.sha256(json.dumps(detail, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        packet = {'source': {'kind': 'nonconformity', 'id': 'n1', 'sha256': sha}, 'detail': detail}
        proof = reconstruct(packet)
        self.assertEqual(proof['question'], '不適合記録123の記録内容は？')
        self.assertIn('図番：未記録', proof['answer'])
        self.assertTrue(fact_matches('不適合記録123の記録内容を教えてください', proof['fact']))
        self.assertFalse(fact_matches('不適合記録124の記録内容を教えてください', proof['fact']))
        self.assertFalse(fact_matches('不適合記録123・図番MD001の記録内容を教えてください', proof['fact']))
        fingerprints = {'nonconformity:n1': sha}
        self.assertEqual(certify({}, {proof['question']: proof}, {'version': 1, 'records': [packet]}, fingerprints), [proof])
        forged = {**proof, 'answer': proof['answer'].replace('図番：未記録', '図番：MD001')}
        with self.assertRaisesRegex(ValueError, 'exact source fact'):
            certify({}, {proof['question']: forged}, {'version': 1, 'records': [packet]}, fingerprints)

    def test_changed_source_and_forged_answer_are_rejected(self):
        packet, case = fixture()
        evidence = {'version': 1, 'records': [packet]}
        candidate = {case['question']: {k: v for k, v in case.items() if k != 'review'}}
        fingerprints = {'work_instruction:one': packet['source']['sha256']}
        for changed in ('上限90℃。', '相談なしで加工。', '上限80℃。'):
            broken = copy.deepcopy(candidate)
            broken[case['question']]['answer'] = changed
            with self.assertRaisesRegex(ValueError, 'exact source fact'):
                certify({}, broken, evidence, fingerprints)
        with self.assertRaisesRegex(ValueError, 'stale'):
            certify({}, candidate, evidence, {'work_instruction:one': 'a' * 64})
        packet['detail']['content'][0]['text'] += ' '
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            certify({}, candidate, evidence, fingerprints)

    def test_nonfacts_and_removal_of_current_answers_cannot_hitchhike(self):
        packet, case = fixture()
        case.pop('review')
        existing = {'question': '既存', 'queries': ['既存'], 'answer': '維持', 'sources': case['sources']}
        current = {'既存': existing}
        evidence = {'version': 1, 'records': [packet]}
        fingerprints = {'work_instruction:one': packet['source']['sha256']}
        with self.assertRaisesRegex(ValueError, 'remove'):
            certify(current, {case['question']: case}, evidence, fingerprints)
        changed = copy.deepcopy(existing); changed['answer'] = '勝手に変更'
        with self.assertRaisesRegex(ValueError, 'exact source fact'):
            certify(current, {'既存': changed, case['question']: case}, evidence, fingerprints)

    def test_inactive_records_and_unpublished_or_ambiguous_steps_are_not_certified(self):
        packet, _ = fixture()
        for mutate in (lambda r: r.update(public=False), lambda r: r['rows'].append(copy.deepcopy(r['rows'][0])),
                       lambda r: r['rows'][0]['steps'][1].update(step=1), lambda r: r['rows'][0].pop('publication')):
            p = copy.deepcopy(packet); r = json.loads(p['detail']['content'][0]['text']); mutate(r)
            p['detail']['content'][0]['text'] = json.dumps(r, ensure_ascii=False, separators=(',', ':'))
            p['source']['sha256'] = hashlib.sha256(json.dumps(p['detail'], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            self.assertIsNone(reconstruct(p))


class FactAdoptionIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve(); self.run = 'c' * 36
        self.job = self.root / 'jobs' / self.run; self.job.mkdir(parents=True)
        self.packet, self.case = fixture()
        atomic_json(self.root / 'reviewed.json', {'version': 1, 'cases': []})
        atomic_json(self.root / 'checks.json', {'version': 1, 'cases': [
            {'id': str(i), 'question': q} for i, q in enumerate(['工具返却', '設備停止', '未知の温度', '天気'])]})
        atomic_json(self.job / 'candidate.json', {'version': 1, 'cases': []})
        atomic_json(self.job / 'fact-candidate.json', {'version': 1, 'cases': [self.case]})
        atomic_json(self.job / 'fact-evidence.json', {'version': 1, 'records': [self.packet]})
        atomic_json(self.job / 'sources.json', {'version': 2, 'records': []})
        self.payload = {'baseCatalogueRelative': 'reviewed.json', 'baseCatalogueSha256': digest(self.root / 'reviewed.json'),
                        'referenceSha256': digest(self.root / 'checks.json'), 'holdoutSha256': None,
                        'sourceFingerprints': {'work_instruction:one': self.packet['source']['sha256']},
                        'factEvidenceSha256': digest(self.job / 'fact-evidence.json'), 'factCandidateSha256': digest(self.job / 'fact-candidate.json')}
        atomic_json(self.job / 'input.json', self.payload)
        # Exercise actual serving dispatch; only embedding/index construction is replaced.
        class Cache:
            def __init__(inner, catalogue, *args):
                inner.cases = read_catalogue(catalogue); inner.model = object(); inner.close = Mock()
            prepare_fact_index = QuestionCache.prepare_fact_index
            search_fact = QuestionCache.search_fact
            search = QuestionCache.search
            lookup = QuestionCache.lookup
        self.cache_type = Cache
        self.cache_patch = patch('server.QuestionCache', Cache); self.cache_patch.start(); self.addCleanup(self.cache_patch.stop)
        self.sources_patch = patch('sources.SourceCandidates', return_value=Mock(records=[]))
        self.sources_patch.start(); self.addCleanup(self.sources_patch.stop)

    def activate(self):
        runtime = MaintenanceRuntime(self.root, self.root); runtime.run_id = self.run
        runtime.process = Mock(returncode=0); runtime.process.poll.return_value = 0; runtime.log = Mock()
        return runtime, runtime.refresh(self.cache_type(self.root / 'reviewed.json'), Mock())[0]

    def test_no_human_labels_prepare_evaluate_activate_and_serve(self):
        result = maintain(self.root, self.run, self.root)
        self.assertEqual(result['status'], 'improved')
        self.assertEqual(result['sourceFacts']['candidate']['wrong'], 0)
        self.assertEqual(result['sourceFacts']['candidate']['answeredCorrectly'], 2)
        runtime, cache = self.activate()
        self.assertEqual(runtime.paths()[0], self.job / 'fact-candidate.json')
        hit = cache.search('図番MD001・対象加工の公開要領の記載本文を教えてください')
        self.assertEqual(cache.lookup(hit['question'])['answer'], self.case['answer'])
        self.assertIsNone(cache.search('図番MD001・対象加工の公開要領の記載本文は90℃でも適用できる？'))
        self.assertTrue(json.loads((self.root / 'previous-active.json').read_text()))

    def test_generated_question_is_independently_certified_activated_and_served(self):
        original = copy.deepcopy(self.case)
        atomic_json(self.root / 'reviewed.json', {'version': 1, 'cases': [original]})
        atomic_json(self.job / 'candidate.json', {'version': 1, 'cases': [original]})
        alias = self.case['fact']['scope'] + 'の作業手順は？'
        self.case['queries'].append(alias)
        atomic_json(self.job / 'fact-candidate.json', {'version': 1, 'cases': [self.case]})
        self.payload['baseCatalogueSha256'] = digest(self.root / 'reviewed.json')
        self.payload['factCandidateSha256'] = digest(self.job / 'fact-candidate.json')
        atomic_json(self.job / 'input.json', self.payload)
        result = maintain(self.root, self.run, self.root)
        self.assertEqual(result['status'], 'improved')
        self.assertEqual(result['sourceFacts']['newFacts'], 0)
        self.assertEqual(result['sourceFacts']['newQuestions'], 1)
        _, cache = self.activate()
        hit = cache.search(alias)
        self.assertEqual(cache.lookup(hit['question'])['answer'], original['answer'])

    def test_fact_evidence_changed_before_or_after_validation_cannot_activate(self):
        maintain(self.root, self.run, self.root)
        atomic_json(self.job / 'fact-evidence.json', {'version': 1, 'records': []})
        runtime, cache = self.activate()
        self.assertFalse(cache.cases)
        self.assertEqual(runtime.paths()[0], self.root / 'reviewed.json')
        with self.assertRaisesRegex(ValueError, 'changed after preparation'):
            maintain(self.root, self.run, self.root)

    def test_factual_gain_cannot_hide_regression_on_existing_checks(self):
        from maintenance import evaluate as real_evaluate
        calls = 0
        def regression(cache, checks, sources):
            nonlocal calls
            calls += 1
            result = real_evaluate(cache, checks, sources)
            if calls == 3:  # Protected checks on the separate factual candidate.
                result['correct'] -= 1
                result['wrong'] += 1
                result['rows'][0]['verdict'] = 'wrong'
            return result
        with patch('maintenance.evaluate', side_effect=regression):
            result = maintain(self.root, self.run, self.root)
        self.assertEqual(result['status'], 'regression')
        self.assertIsNone(json.loads((self.job / 'activation.json').read_text())['catalogue'])

    def test_exact_repeated_catalogue_does_not_claim_another_gain(self):
        atomic_json(self.root / 'reviewed.json', {'version': 1, 'cases': [self.case]})
        atomic_json(self.job / 'candidate.json', {'version': 1, 'cases': [self.case]})
        self.payload['baseCatalogueSha256'] = digest(self.root / 'reviewed.json')
        atomic_json(self.job / 'input.json', self.payload)
        result = maintain(self.root, self.run, self.root)
        self.assertEqual(result['status'], 'plateau')
        self.assertEqual(result['adoptionBasis'], 'source-fact-contract-v1')
        self.assertEqual(result['sourceFacts']['newFacts'], 0)


if __name__ == '__main__':
    unittest.main()
