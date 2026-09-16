"""Use the pinned real SQLite/FAISS stack to catch retired-index descriptor leaks."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from server import QuestionCache
from sources import SourceCandidates
from test_experience import Embedding


class IndexResourcesTests(unittest.TestCase):
    @unittest.skipUnless(Path('/proc/self/fd').exists(), 'Linux descriptor accounting')
    def test_repeated_index_replacement_releases_sqlite_descriptors(self):
        def descriptors(root):
            total = 0
            for descriptor in Path('/proc/self/fd').iterdir():
                try:
                    total += os.readlink(descriptor).startswith(str(root))
                except FileNotFoundError:
                    pass
            return total

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            retired = []  # Keep objects alive, as GPTCache's atexit callback does.
            model = Embedding()
            for number in range(24):
                catalogue = root / 'catalogue.json'
                catalogue.write_text(json.dumps({'version': 1, 'cases': [], 'generation': number}))
                sources = root / 'sources.json'
                sources.write_text(json.dumps({'version': 2, 'records': [
                    {'kind': 'work_instruction', 'id': str(number), 'title': 'fixture',
                     'text': 'synthetic source', 'identifiers': []}]}))
                cache = QuestionCache(catalogue, root / 'index', root, model)
                candidates = SourceCandidates(sources, root / 'index', model)
                self.assertGreater(descriptors(root), 0)
                cache.close()
                candidates.close()
                # Avoid writing retired FAISS files after the temporary directory is removed.
                cache.cache.data_manager.close = lambda: None
                retired.append((cache, candidates))
                self.assertEqual(descriptors(root), 0, f'leaked after generation {number}')
