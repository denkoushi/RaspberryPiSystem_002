import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import learning as l


class LearningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = l.connect(self.root / 'learning.db')
        self.skill = self.root / 'baseline.md'
        self.skill.write_text('---\nname: business-consultation\ndescription: business consultation\n---\nKeep the subject.\n')
        self.candidate = self.root / 'candidate.md'
        self.candidate.write_text(self.skill.read_text() + 'Distinguish operations before choosing evidence.\n')
        self.base = l.skill_hash(self.skill)
        self.next = l.skill_hash(self.candidate)

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def item(self, id, question='drilling bulge', latency=2000, inference=4000, status='ready'):
        return {'schemaVersion': 1, 'id': id, 'consultationId': 'conversation-' + id,
                'measurement': {'kind': 'business-hermes-learning-v1', 'timingBoundary': 'server-through-response-assembly-v1', 'question': question,
                                'purpose': 'cause', 'phase': 'answer', 'recipeId': 'record-cause',
                                'recipeVersion': '1', 'contextFingerprint': 'same-context-' + question, 'status': status, 'needsClarification': False,
                                'elapsedMs': latency, 'questionToAnswerMs': latency + 1000 if latency is not None else None, 'prefetch': 'adopted',
                                'inferences': [{'elapsedMs': inference, 'searches': [{}]}]},
                'answer': {'id': 'a-' + id, 'content': 'synthetic answer',
                           'evidence': {'items': [{'kind': 'record', 'id': 'source', 'title': 'synthetic source'}]}} if status == 'ready' else None}

    def add(self, item, revision=None, runtime='same-runtime'):
        path = self.root / 'import.jsonl'
        path.write_text(l.encoded(item) + '\n')
        return l.import_observations(self.db, path, revision or self.base, runtime)

    def mark(self, id, split='train', verdict='pass', source='corpus-v1'):
        l.grade(self.db, id, split, verdict, 'source reviewer', source, 'record:source:v1', 'Checked the original conditions and answer')

    def paired(self):
        for i, split in enumerate(['train', 'holdout']):
            for prefix, revision, latency in [('b', self.base, 2000), ('c', self.next, 1000)]:
                id = prefix + str(i)
                self.add(self.item(id, 'question-' + str(i), latency), revision)
                self.mark(id, split)

    def test_import_idempotence_and_transaction(self):
        item = self.item('a')
        self.assertEqual(self.add(item), 1)
        self.assertEqual(self.add(item), 0)
        changed = {**item, 'answer': {'content': 'tampered'}}
        path = self.root / 'batch.jsonl'
        path.write_text(l.encoded(self.item('new')) + '\n' + l.encoded(changed))
        with self.assertRaisesRegex(ValueError, 'changed'):
            l.import_observations(self.db, path, self.base, 'same-runtime')
        self.assertEqual(self.db.execute('SELECT count(*) FROM observations').fetchone()[0], 1)

    def test_pending_observation_can_complete_once_without_losing_its_identity(self):
        pending = self.item('a', status='pending')
        self.add(pending)
        self.assertEqual(self.add(self.item('a')), 1)
        self.mark('a')
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.add(self.item('a', latency=100))

    def test_unreviewed_is_unknown_not_success_and_links_sources(self):
        self.add(self.item('a'))
        report = l.report(self.db)
        group = next(iter(report['groups'].values()))
        self.assertIsNone(group['reviewedAccuracy'])
        self.assertEqual(group['reviewCoverage'], 0)
        self.assertEqual(group['unreviewed'], 1)
        self.assertTrue(any(n['kind'] == 'source' for n in report['graph']['nodes']))

    def test_failed_or_missing_answers_cannot_be_marked_correct(self):
        self.add(self.item('a', status='unavailable'))
        with self.assertRaisesRegex(ValueError, 'cannot pass'):
            self.mark('a')
        self.mark('a', verdict='fail')
        self.assertEqual(next(iter(l.report(self.db)['groups'].values()))['unavailable'], 1)

    def test_held_out_data_never_enters_review(self):
        self.add(self.item('train', question='TRAINING_QUESTION'))
        self.add(self.item('hold', question='SECRET_HELD_OUT_QUESTION'))
        self.mark('train')
        self.mark('hold', split='holdout')
        output = l.prepare_review(self.db, self.skill, self.root / 'review')
        prompt = (output / 'review.txt').read_text()
        self.assertIn('TRAINING_QUESTION', prompt)
        self.assertNotIn('SECRET_HELD_OUT_QUESTION', prompt)
        with self.assertRaisesRegex(ValueError, 'immutable'):
            self.mark('train', split='holdout')
        with self.assertRaises(FileExistsError):
            l.prepare_review(self.db, self.skill, output)

    def test_review_does_not_leak_other_retrieved_record_bodies(self):
        item = self.item('train', question='TRAINING_QUESTION')
        item['answer']['evidence']['items'].append({
            'kind': 'record', 'id': 'other-case', 'text': 'HELD_OUT_RECORD_BODY',
            'displayFields': {'detail': [{'value': 'HELD_OUT_CORRECTION'}]}})
        self.add(item)
        self.mark('train')
        output = l.prepare_review(self.db, self.skill, self.root / 'review')
        prompt = (output / 'review.txt').read_text()
        self.assertIn('synthetic answer', prompt)
        self.assertIn('Checked the original conditions and answer', prompt)
        self.assertNotIn('HELD_OUT_RECORD_BODY', prompt)
        self.assertNotIn('HELD_OUT_CORRECTION', prompt)
        # Keep the full observation locally for source review and graph reporting.
        self.assertIn('HELD_OUT_RECORD_BODY', self.db.execute(
            'SELECT payload FROM observations WHERE id=?', ('train',)).fetchone()[0])

    def test_same_question_cannot_switch_to_heldout_in_new_revision(self):
        self.add(self.item('a'))
        self.mark('a')
        self.add(self.item('b'), self.next)
        with self.assertRaisesRegex(ValueError, 'immutable'):
            self.mark('b', split='holdout')

    def test_complete_correct_faster_comparison_and_minimum(self):
        self.paired()
        result = l.compare(self.db, self.base, self.next, minimum=1)
        self.assertTrue(result['eligible'], result['reasons'])
        self.assertFalse(l.compare(self.db, self.base, self.next)['eligible'])

    def test_faster_but_wrong_candidate_is_blocked(self):
        self.paired()
        self.mark('c1', split='holdout', verdict='fail')
        result = l.compare(self.db, self.base, self.next, 1)
        self.assertFalse(result['eligible'])
        self.assertTrue(any('regression' in r for r in result['reasons']))

    def test_source_drift_and_missing_cases_are_blocked(self):
        self.paired()
        self.mark('c1', split='holdout', source='corpus-v2')
        self.add(self.item('unpaired', question='new'), self.next)
        result = l.compare(self.db, self.base, self.next, 1)
        self.assertFalse(result['eligible'])
        self.assertTrue(any('Source revision' in r for r in result['reasons']))
        self.assertTrue(any('case sets differ' in r for r in result['reasons']))

    def test_waiting_longer_for_prefetch_does_not_hide_slower_inference(self):
        self.paired()
        row = self.db.execute("SELECT payload FROM observations WHERE id='c1'").fetchone()
        item = json.loads(row['payload'])
        item['measurement']['inferences'][0]['elapsedMs'] = 99999
        self.db.execute("UPDATE observations SET payload=? WHERE id='c1'", (l.encoded(item),))
        result = l.compare(self.db, self.base, self.next, 1)
        self.assertFalse(result['eligible'])
        self.assertTrue(any('Inference became slower' in r for r in result['reasons']))

    def test_changed_conversation_context_cannot_count_as_a_skill_improvement(self):
        self.paired()
        row = self.db.execute("SELECT payload FROM observations WHERE id='c1'").fetchone()
        item = json.loads(row['payload'])
        item['measurement']['contextFingerprint'] = 'different prior facts'
        self.db.execute("UPDATE observations SET payload=? WHERE id='c1'", (l.encoded(item),))
        result = l.compare(self.db, self.base, self.next, 1)
        self.assertFalse(result['eligible'])
        self.assertTrue(any('context changed' in r for r in result['reasons']))

    def test_longer_choice_waiting_alone_cannot_pass(self):
        self.paired()
        row = self.db.execute("SELECT payload FROM observations WHERE id='c1'").fetchone()
        item = json.loads(row['payload'])
        item['measurement']['questionToAnswerMs'] = 30000
        self.db.execute("UPDATE observations SET payload=? WHERE id='c1'", (l.encoded(item),))
        result = l.compare(self.db, self.base, self.next, 1)
        self.assertFalse(result['eligible'])
        self.assertTrue(any('Total elapsed time' in r for r in result['reasons']))

    def test_unknown_timing_and_runtime_changes_block_promotion(self):
        self.paired()
        self.add(self.item('extra', question='extra', latency=None), self.next, 'different-runtime')
        self.mark('extra')
        result = l.compare(self.db, self.base, self.next, 1)
        self.assertFalse(result['eligible'])
        self.assertTrue(any('missing timing' in r for r in result['reasons']))

    def test_native_review_isolated_staged_and_finite_without_shell(self):
        self.add(self.item('a'))
        self.mark('a')
        output = l.prepare_review(self.db, self.skill, self.root / 'review')
        config = self.root / 'live-config.yaml'
        config.write_text('model:\n  default: current-local-model\n  provider: custom:dgx\nmcp_servers:\n  production: {}\n')
        original = config.read_bytes()

        def native(command, **kwargs):
            self.assertEqual(command[:2], ['hermes', 'chat'])
            self.assertIn('--query-file', command)
            self.assertNotIn('shell', kwargs)
            self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
            profile = Path(kwargs['env']['HERMES_HOME'])
            generated = json.loads((profile / 'config.yaml').read_text())
            self.assertTrue(generated['skills']['write_approval'])
            self.assertNotIn('mcp_servers', generated)
            self.assertFalse(generated['auxiliary']['background_review']['enabled'])
            pending = profile / 'pending' / 'skills'
            pending.mkdir(parents=True)
            (pending / 'test.json').write_text(l.encoded({'payload': {'name': 'business-consultation', 'action': 'patch'}}))
            return subprocess.CompletedProcess(command, 0)

        with patch('learning.subprocess.run', side_effect=native):
            self.assertEqual(l.execute_review(output, config), 1)
        self.assertEqual(config.read_bytes(), original)
        self.assertEqual((output / 'profile/skills/business-consultation/SKILL.md').read_text(), self.skill.read_text())

    def test_native_batch_accepts_only_scoped_skill_patches(self):
        self.add(self.item('a'))
        self.mark('a')
        config = self.root / 'config.yaml'
        config.write_text('model: {default: current-local-model}')
        safe = {'name': 'business-consultation', 'action': 'patch', 'file_path': 'SKILL.md'}
        batches = [[safe, safe], [safe, {**safe, 'name': 'another-skill'}],
                   [safe, {**safe, 'action': 'delete'}], [safe, {**safe, 'file_path': '../SOUL.md'}],
                   [safe, {'action': 'batch', 'operations': [safe]}], [], None]
        for index, operations in enumerate(batches):
            with self.subTest(index=index):
                output = l.prepare_review(self.db, self.skill, self.root / f'review-{index}')
                def native(command, **kwargs):
                    pending = Path(kwargs['env']['HERMES_HOME']) / 'pending/skills'
                    pending.mkdir(parents=True)
                    (pending / 'batch.json').write_text(l.encoded({'payload': {
                        'action': 'batch', 'operations': operations}}))
                    return subprocess.CompletedProcess(command, 0)
                with patch('learning.subprocess.run', side_effect=native):
                    if index == 0:
                        self.assertEqual(l.execute_review(output, config), 1)
                    else:
                        with self.assertRaises(ValueError):
                            l.execute_review(output, config)
                self.assertEqual((output / 'profile/skills/business-consultation/SKILL.md').read_bytes(),
                                 self.skill.read_bytes())

    def test_native_success_without_staged_change_is_not_reported_as_learning(self):
        self.add(self.item('a'))
        self.mark('a')
        output = l.prepare_review(self.db, self.skill, self.root / 'review')
        config = self.root / 'config.yaml'
        config.write_text('model: {default: current-local-model}')
        with patch('learning.subprocess.run', return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaisesRegex(ValueError, 'No staged'):
                l.execute_review(output, config)

    def test_native_direct_write_is_rejected_even_with_pending_files(self):
        self.add(self.item('a'))
        self.mark('a')
        output = l.prepare_review(self.db, self.skill, self.root / 'review')
        config = self.root / 'config.yaml'
        config.write_text('model: {default: current-local-model}')
        def native(command, **kwargs):
            profile = Path(kwargs['env']['HERMES_HOME'])
            (profile / 'skills/business-consultation/SKILL.md').write_text('unexpected direct edit')
            pending = profile / 'pending/skills'
            pending.mkdir(parents=True)
            (pending / 'test.json').write_text(l.encoded({'payload': {'name': 'business-consultation', 'action': 'patch'}}))
            return subprocess.CompletedProcess(command, 0)
        with patch('learning.subprocess.run', side_effect=native):
            with self.assertRaisesRegex(ValueError, 'directly'):
                l.execute_review(output, config)

    def test_cli_export_is_bound_to_tested_skill_hash(self):
        self.paired()
        self.db.commit()
        out = self.root / 'approved.md'
        args = ['learning.py', '--db', str(self.root / 'learning.db'), 'compare', '--baseline-skill', str(self.skill),
                '--candidate-skill', str(self.candidate), '--minimum', '1', '--out', str(out)]
        with patch('sys.argv', args), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(l.main(), 0)
        self.assertEqual(out.read_bytes(), self.candidate.read_bytes())
        self.candidate.write_text('unmeasured subsequent edit')
        args[-1] = str(self.root / 'unmeasured.md')
        with patch('sys.argv', args), self.assertRaisesRegex(ValueError, 'blocked'):
            l.main()
        self.assertFalse((self.root / 'unmeasured.md').exists())


if __name__ == '__main__':
    unittest.main()
