import base64
import json
import tempfile
import unittest
from pathlib import Path
from preparation import RemotePreparation, digest, encoded
from embedding import EmbeddingDeferred


class FixtureTransport(RemotePreparation):
    def __init__(self, corrupt=None):
        self.actions = []
        self.corrupt = corrupt
        self.files = {'index.faiss': b'index-fixture', 'terms.sqlite': b'sqlite-fixture'}

    def request(self, value):
        self.actions.append(value['action'])
        if value['action'] == 'begin':
            self.manifest = value['manifest']
            assert digest(encoded(self.manifest)) == value['jobId']
        if value['action'] == 'chunk':
            assert digest(encoded(value['rows'])) == self.manifest['chunks'][value['chunk']]
        if value['action'] == 'finish':
            return {'state': 'complete', 'count': self.manifest['count'], 'nextChunk': len(self.manifest['chunks']),
                    'artifacts': {name: {'bytes': len(raw), 'sha256': digest(raw)} for name, raw in self.files.items()}}
        if value['action'] == 'artifact':
            if self.corrupt == 'disconnect':
                raise EmbeddingDeferred('lost response')
            raw = self.files[value['file']]
            return {'state': 'artifact', 'file': value['file'], 'offset': value['offset'],
                    'data': base64.b64encode(raw).decode(), 'sha256': 'bad' if self.corrupt else digest(raw)}
        return {'state': 'building'}


class RemotePreparationTest(unittest.TestCase):
    def test_completed_files_are_verified_before_installing(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'index'
            worker = FixtureTransport()
            worker.build('sources', [{'text': str(i), 'vector': 'fixture'} for i in range(129)], target)
            self.assertEqual(worker.actions.count('chunk'), 2)
            self.assertEqual((target / 'index.faiss').read_bytes(), b'index-fixture')
            self.assertEqual(set(json.loads((target / 'remote-ready').read_text())['artifacts']), set(worker.files))
            self.assertEqual(worker.actions[-1], 'release')
            self.assertFalse(list(Path(temporary).glob('.preparation-*')))

    def test_corruption_or_disconnect_never_install_partial_artifacts(self):
        for failure, error in [('corrupt', ValueError), ('disconnect', EmbeddingDeferred)]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                target = Path(temporary) / 'index'
                worker = FixtureTransport(failure)
                with self.assertRaises(error):
                    worker.build('sources', [{'text': 'synthetic', 'vector': 'fixture'}], target)
                self.assertFalse(target.exists())
                self.assertEqual(worker.actions[-1], 'release')

    def test_unknown_kind_and_oversized_row_never_submit(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = FixtureTransport()
            for kind, row in [('unknown', {}), ('sources', {'text': 'x' * 600000})]:
                with self.assertRaises(ValueError):
                    worker.build(kind, [row], Path(temporary) / 'index')
            self.assertEqual(worker.actions, [])


if __name__ == '__main__':
    unittest.main()
