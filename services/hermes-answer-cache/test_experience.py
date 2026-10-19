import tempfile
import unittest
from experience import ExperienceStore
from sources import SourceCandidates


class Embedding:
    # Deliberately identical similarities: hard conditions must still prevent
    # crossing part numbers, and current feedback must defeat old vector hits.
    def embed(self, texts, **kwargs):
        import numpy as np
        for _ in texts:
            yield np.asarray([1.0] + [0.0] * 383, dtype='float32')


class ExperienceTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.store = ExperienceStore(self.root.name, Embedding())
        self.event = {'id': 'answer-1', 'canonicalQuestion': '設備MD100001：確認方法は？', 'question': 'MD100001の確認方法は？', 'answer': '原文の条件を確認する。',
                      'sources': [{'kind': 'equipment_manual', 'id': 'same-id', 'sha256': 'a' * 64}]}

    def close_store(self):
        self.store.cache.data_manager.close()
        # GPTCache also registers a process-exit close; the temporary directory
        # has already been removed then. Explicit close has flushed the index.
        self.store.cache.data_manager.close = lambda: None
        self.store.db.close()

    def tearDown(self):
        self.close_store()
        self.root.cleanup()

    def test_selection_learns_a_source_without_approving_an_answer_and_survives_restart(self):
        from pathlib import Path
        import json
        path = Path(self.root.name) / 'sources.json'
        records = [{'kind': kind, 'id': 'same-id', 'title': kind, 'text': '確認方法', 'identifiers': ['MD100001']}
                   for kind in ['nonconformity', 'work_instruction', 'equipment_manual']]
        path.write_text(json.dumps({'version': 2, 'records': records}))
        sources = SourceCandidates(path, self.root.name, Embedding())
        self.store.remember(self.event)
        self.assertIsNone(self.store.lookup(self.event['canonicalQuestion']))
        self.assertEqual(self.store.candidates(self.event['question'], sources)[0]['option'], 'この資料で回答：equipment_manual')
        self.store.feedback('answer-1', 'helpful')
        self.assertEqual(self.store.suggest(self.event['question']), {'question': self.event['canonicalQuestion']})
        self.close_store()
        self.store = ExperienceStore(self.root.name, Embedding())
        self.assertEqual(self.store.lookup(self.event['canonicalQuestion'])['answer'], self.event['answer'])
        self.assertIsNone(self.store.suggest('MD100002の確認方法は？'))
        self.store.remember(dict(self.event, id='wording-2', question='MD100001の点検を教えて'))
        # Exact new wording can reuse an already endorsed canonical answer;
        # the new selected wording is not itself an endorsement of correctness.
        from unittest.mock import patch
        alias = self.store.db.execute('SELECT * FROM events WHERE id=?', ('wording-2',)).fetchone()
        with patch.object(self.store, 'matches', return_value=[alias]):
            self.assertEqual(self.store.suggest(alias['question']), {'question': self.event['canonicalQuestion']})
        self.store.remember(dict(self.event, id='reuse-2', question=self.event['canonicalQuestion']))
        self.store.feedback('reuse-2', 'unhelpful')
        self.assertNotIn('この資料で回答：equipment_manual', [r['option'] for r in self.store.candidates(self.event['question'], sources)])
        sources.lexical.close()

    def test_retry_does_not_reset_feedback_and_negative_feedback_blocks_duplicate_answers(self):
        self.store.remember(self.event)
        self.store.feedback('answer-1', 'helpful')
        self.store.remember(dict(self.event, id='answer-2'))
        self.store.feedback('answer-2', 'unhelpful')
        self.store.remember(dict(self.event, id='answer-2'))
        self.assertIsNone(self.store.lookup(self.event['canonicalQuestion']))
        self.assertTrue(self.store.denied(self.event))
        self.assertFalse(self.store.feedback('unknown', 'helpful'))
        self.store.feedback('answer-2', 'helpful')
        self.assertIsNotNone(self.store.lookup(self.event['canonicalQuestion']))

    def test_invalid_or_client_supplied_verdict_cannot_admit_an_answer(self):
        for event in [dict(self.event, verdict='helpful'), dict(self.event, sources=[]), dict(self.event, sources=[{'kind': '../private', 'id': 'x', 'sha256': 'a' * 64}])]:
            with self.assertRaises(ValueError):
                self.store.remember(event)

    def test_nightly_source_refresh_embeds_only_changed_records(self):
        from pathlib import Path
        from unittest.mock import Mock
        import json
        path = Path(self.root.name) / 'sources.json'
        records = [{'kind': 'equipment_manual', 'id': str(i), 'title': str(i), 'text': 'original-' + str(i), 'identifiers': []} for i in range(3)]
        path.write_text(json.dumps({'version': 2, 'records': records}))
        model = Mock(wraps=Embedding())
        previous = SourceCandidates(path, self.root.name, model)
        model.reset_mock()
        records[1]['text'] = 'revised'
        records[2]['title'] = 'new title, same text'
        path.write_text(json.dumps({'version': 2, 'records': list(reversed(records))}))
        refreshed = SourceCandidates(path, self.root.name, model, previous=previous)
        self.assertEqual(model.embed.call_args.args[0], ['revised'])
        self.assertEqual(refreshed.index.ntotal, 3)
        self.assertEqual(refreshed.records[0]['id'], '2')
        previous.lexical.close()
        refreshed.lexical.close()


if __name__ == '__main__':
    unittest.main()
