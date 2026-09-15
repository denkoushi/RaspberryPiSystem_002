import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from maintenance import (decide, evaluate, trend, atomic_json, adoption_outcome, check_question_separation,
                         load_checks, digest, maintain)
from runtime import MaintenanceRuntime, inside


def score(correct=10, wrong=0, ms=30, rows=None):
    return dict(correct=correct, wrong=wrong, p95Ms=ms, rows=rows or [])


class NightCheckerTests(unittest.TestCase):
    def test_gains_cannot_hide_a_new_error(self):
        before = score(rows=[{'id': 'protected', 'verdict': 'correct'}])
        after = score(11, rows=[{'id': 'protected', 'verdict': 'missing'}])
        self.assertEqual(decide(before, after), 'regression')
        self.assertEqual(decide(score(), score(11)), 'improved')
        self.assertEqual(decide(score(), score()), 'plateau')
        self.assertEqual(decide(score(), score(ms=500)), 'slower')
        self.assertEqual(decide(score(), score(11, wrong=1)), 'regression')

    def test_trend_uses_three_comparable_nights(self):
        history = [{'referenceSha256': 'same', 'current': score(n)} for n in (12, 11)]
        self.assertTrue(trend(history, score(10), 'same'))
        self.assertFalse(trend(history, score(10), 'changed'))
        self.assertFalse(trend(history[:1], score(10), 'same'))
        self.assertFalse(trend(history, score(12), 'same'))

    def test_changed_sources_and_omitted_conditions_are_not_correct(self):
        ref = dict(kind='nonconformity', id='one', sha256='a' * 64)
        cache = Mock()
        cache.search.return_value = {'question': 'canonical'}
        cache.lookup.return_value = {'answer': '相談してから加工', 'sources': [ref]}
        checks = [dict(id='one', question='q', expectedSource=ref, requiredFragments=['相談してから'])]
        self.assertEqual(evaluate(cache, checks, {'nonconformity:one': 'a' * 64})['correct'], 1)
        self.assertEqual(evaluate(cache, checks, {'nonconformity:one': 'b' * 64})['correct'], 0)
        cache.lookup.return_value['answer'] = '加工'
        self.assertEqual(evaluate(cache, checks, {'nonconformity:one': 'a' * 64})['wrong'], 1)

    def test_forbidden_actions_and_abstentions_are_reported_separately(self):
        ref = dict(kind='nonconformity', id='one', sha256='a' * 64)
        cache = Mock()
        cache.search.side_effect = [{'question': 'canonical'}, None]
        cache.lookup.return_value = {'answer': '相談してから加工。確認なしで加工してよい。', 'sources': [ref]}
        checks = [dict(id='one', question='q', expectedSource=ref, requiredFragments=['相談してから'],
                       forbiddenFragments=['確認なしで']), dict(id='unknown', question='unsupported')]
        result = evaluate(cache, checks, {'nonconformity:one': 'a' * 64})
        self.assertEqual((result['wrong'], result['answerable'], result['answeredCorrectly'], result['abstainedCorrectly']), (1, 1, 0, 1))

    def test_only_independent_gains_can_authorize_adoption(self):
        self.assertEqual(adoption_outcome(score(), score(11)), 'awaiting_holdout')
        self.assertEqual(adoption_outcome(score(), score(11), score(), score()), 'plateau')
        self.assertEqual(adoption_outcome(score(), score(), score(), score(11)), 'improved')
        self.assertEqual(adoption_outcome(score(), score(), score(), score(11, wrong=1)), 'regression')
        self.assertEqual(adoption_outcome(score(), score(9), score(), score(11)), 'regression')
        self.assertEqual(adoption_outcome(score(), score(), score(), score(11, ms=500)), 'slower')

    def test_protected_wordings_cannot_be_copied_into_new_aliases(self):
        canonical = '加工準備について'
        current = {canonical: {'question': canonical, 'queries': [canonical]}}
        copied = '公開要領の長い接頭辞：ＭＤ００１を加工する前に必要なことは？'
        checks = [{'question': 'MD001を加工する前に必要なことは'}]
        candidate = {canonical: {'question': canonical, 'queries': [canonical, copied]}}
        with self.assertRaisesRegex(ValueError, 'leaks'):
            check_question_separation(current, candidate, checks, [])
        # Existing regression aliases are grandfathered; newly created holdouts cannot overlap them.
        check_question_separation(candidate, candidate, checks, [])
        with self.assertRaisesRegex(ValueError, 'overlap'):
            check_question_separation(candidate, candidate, [], checks)

    def test_holdout_requires_reviewed_positive_and_negative_examples(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'holdout.json'
            data = {'version': 1, 'cases': [dict(id=str(i), question=q) for i, q in enumerate(['加工', '保管', '点検', '未登録'])]}
            atomic_json(path, data)
            with self.assertRaisesRegex(ValueError, 'human review'):
                load_checks(path, holdout=True)
            data.update(provenance='human-reviewed-real-questions', reviewedBy='test-fixture', reviewedAt='2026-09-14')
            data['cases'][0].update(expectedSource={'kind': 'work_instruction', 'id': 'one', 'sha256': 'a' * 64})
            atomic_json(path, data)
            with self.assertRaisesRegex(ValueError, 'required source fragments'):
                load_checks(path, holdout=True)
            data['cases'][0]['requiredFragments'] = ['相談']
            atomic_json(path, data)
            self.assertEqual(len(load_checks(path, holdout=True)), 4)


    def test_private_paths_and_interrupted_worker_preserve_active_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            atomic_json(root / 'reviewed.json', {'version': 1, 'cases': []})
            runtime = MaintenanceRuntime(root, root)
            self.assertEqual(runtime.paths()[0], (root / 'reviewed.json').resolve())
            with self.assertRaises(ValueError):
                inside(root, '../outside.json')
            with self.assertRaises(ValueError):
                runtime.start('../../outside')
            cache, sources = object(), object()
            self.assertEqual(runtime.refresh(cache, sources), (cache, sources))
            self.assertEqual(runtime.status('a' * 36)['status'], 'interrupted')

    def test_cancelled_worker_cannot_activate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = 'a' * 36
            (root / 'jobs' / run).mkdir(parents=True)
            runtime = MaintenanceRuntime(root, root)
            runtime.run_id = run
            runtime.process = Mock()
            runtime.process.poll.return_value = None
            runtime.cancel(run)
            runtime.process.terminate.assert_called_once()
            self.assertTrue((root / 'jobs' / run / 'cancelled').exists())
            self.assertFalse(json.loads((root / 'jobs' / run / 'result.json').read_text())['activated'])


class NightlyAdoptionIntegrationTests(unittest.TestCase):
    """Exercise file identities, the worker and atomic activation without inference/network.

    The cache search mapping is synthetic; these tests do not measure embedding quality.
    """
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.run = 'b' * 36
        self.job = self.root / 'jobs' / self.run
        self.job.mkdir(parents=True)
        self.ref = {'kind': 'work_instruction', 'id': 'one', 'sha256': 'a' * 64}
        self.case = {'question': 'MD001を加工する前に必要なことは？', 'queries': ['MD001を加工する前に必要なことは？'],
                     'answer': '設計へ相談してから加工。', 'sources': [self.ref],
                     'review': {'verdict': 'pass', 'reviewer': 'synthetic', 'reason': 'fixture', 'reviewedAt': '2026-09-14'}}
        atomic_json(self.root / 'reviewed.json', {'version': 1, 'cases': []})
        atomic_json(self.job / 'candidate.json', {'version': 1, 'cases': [self.case]})
        atomic_json(self.job / 'sources.json', {'version': 2, 'records': []})
        atomic_json(self.root / 'checks.json', {'version': 1, 'cases': [
            {'id': str(i), 'question': q} for i, q in enumerate(['工具を捨てたい', '明日の天気', '社員住所', '取引先口座'])]})
        atomic_json(self.root / 'holdout.json', {'version': 1, 'provenance': 'human-reviewed-real-questions',
            'reviewedBy': 'synthetic-test-fixture', 'reviewedAt': '2026-09-14', 'cases': [
                {'id': 'positive', 'question': '設計者の承諾が必要な工程を教えて', 'expectedSource': self.ref, 'requiredFragments': ['相談してから']},
                *[{'id': str(i), 'question': q} for i, q in enumerate(['測定具の校正周期', '保護具を使わない手順', '未登録品の研磨'])]]})
        self.input = {'baseCatalogueRelative': 'reviewed.json', 'baseCatalogueSha256': digest(self.root / 'reviewed.json'),
                      'referenceSha256': digest(self.root / 'checks.json'), 'holdoutSha256': digest(self.root / 'holdout.json'),
                      'sourceFingerprints': {'work_instruction:one': 'a' * 64}}
        atomic_json(self.job / 'input.json', self.input)
        from server import read_catalogue

        class FakeCache:
            def __init__(inner, catalogue, *args):
                inner.cases = read_catalogue(catalogue)
                inner.model = object()

            def search(inner, question):
                if question == '設計者の承諾が必要な工程を教えて' and inner.cases:
                    return {'question': next(iter(inner.cases))}
                return None

            def lookup(inner, question):
                return inner.cases.get(question)

        self.cache_type = FakeCache
        self.cache_patch = patch('server.QuestionCache', FakeCache)
        self.source_patch = patch('sources.SourceCandidates', return_value=Mock(records=[]))
        self.cache_patch.start()
        self.source_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.addCleanup(self.source_patch.stop)

    def runtime(self):
        runtime = MaintenanceRuntime(self.root, self.root)
        runtime.run_id = self.run
        runtime.process = Mock(returncode=0)
        runtime.process.poll.return_value = 0
        runtime.log = Mock()
        return runtime

    def test_remote_completion_waits_for_pi_source_recheck_and_commits_once(self):
        self.input['requireSourceRecheck'] = True
        atomic_json(self.job / 'input.json', self.input)
        maintain(self.root, self.run, self.root)
        runtime = self.runtime()
        cache = self.cache_type(self.root / 'reviewed.json')
        self.assertIs(runtime.refresh(cache, object())[0], cache)
        self.assertEqual(runtime.status(self.run)['status'], 'awaiting_source_recheck')
        self.assertFalse((self.root / 'active.json').exists())
        with self.assertRaises(ValueError):
            runtime.authorize(self.run, 'wrong-generation')
        runtime.authorize(self.run, digest(self.job / 'sources.json'))
        next_cache, sources = runtime.refresh(cache, object())
        pointer = (self.root / 'active.json').read_bytes()
        self.assertEqual(len(next_cache.cases), 1)
        self.assertIs(runtime.refresh(next_cache, sources)[0], next_cache)
        self.assertEqual((self.root / 'active.json').read_bytes(), pointer)

    def test_revoked_or_cancelled_source_recheck_cannot_adopt(self):
        self.input['requireSourceRecheck'] = True
        atomic_json(self.job / 'input.json', self.input)
        maintain(self.root, self.run, self.root)
        runtime = self.runtime()
        cache = self.cache_type(self.root / 'reviewed.json')
        runtime.cancel(self.run)
        with self.assertRaises(ValueError):
            runtime.authorize(self.run, digest(self.job / 'sources.json'))
        self.assertIs(runtime.refresh(cache, object())[0], cache)
        self.assertFalse((self.root / 'active.json').exists())

    def test_verified_independent_gain_activates_the_prepared_catalogue(self):
        report = maintain(self.root, self.run, self.root)
        self.assertEqual(report['status'], 'improved')
        self.assertEqual(report['holdout']['candidate']['answeredCorrectly'], 1)
        runtime = self.runtime()
        cache = self.cache_type(self.root / 'reviewed.json')
        next_cache, _ = runtime.refresh(cache, object())
        self.assertEqual(len(next_cache.cases), 1)
        self.assertEqual(runtime.paths()[0], self.job / 'candidate.json')

    def test_missing_holdout_stages_growth_but_keeps_active_answers(self):
        (self.root / 'holdout.json').unlink()
        self.input['holdoutSha256'] = None
        atomic_json(self.job / 'input.json', self.input)
        report = maintain(self.root, self.run, self.root)
        self.assertEqual(report['status'], 'awaiting_holdout')
        self.assertEqual(report['catalogueGrowth'], 1)
        self.assertIsNone(json.loads((self.job / 'activation.json').read_text())['catalogue'])
        runtime = self.runtime()
        cache = self.cache_type(self.root / 'reviewed.json')
        self.assertIs(runtime.refresh(cache, object())[0], cache)
        self.assertEqual(runtime.paths()[0], self.root / 'reviewed.json')

    def test_changed_holdout_cannot_activate_an_old_comparison(self):
        maintain(self.root, self.run, self.root)
        (self.root / 'holdout.json').write_text('{}')
        runtime = self.runtime()
        cache = self.cache_type(self.root / 'reviewed.json')
        self.assertIs(runtime.refresh(cache, object())[0], cache)
        self.assertFalse((self.root / 'active.json').exists())
        self.assertEqual(json.loads((self.job / 'result.json').read_text())['status'], 'failed')

    def test_changed_evaluation_before_worker_start_is_rejected(self):
        self.input['holdoutSha256'] = 'old-hash'
        atomic_json(self.job / 'input.json', self.input)
        with self.assertRaisesRegex(ValueError, 'Evaluation changed'):
            maintain(self.root, self.run, self.root)



if __name__ == '__main__':
    unittest.main()
