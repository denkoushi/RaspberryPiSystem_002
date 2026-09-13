import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from maintenance import decide, evaluate, trend, atomic_json
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


if __name__ == '__main__':
    unittest.main()
