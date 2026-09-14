import json
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from embedding import RemoteEmbedding, EmbeddingDeferred, MODEL_SHA, SCHEMA


class RemoteEmbeddingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            'ANSWER_CACHE_EMBEDDING_ORIGIN': 'http://100.100.100.100:38081',
            'ANSWER_CACHE_EMBEDDING_EGRESS': 'http://business-hermes-egress:3128',
            'ANSWER_CACHE_EMBEDDING_TOKEN': 'synthetic-business-token',
        })
        self.env.start()
        self.connections = []

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def response(self, count=1, status=200, **overrides):
        response = Mock(status=status)
        response.read.return_value = json.dumps({
            'schema': SCHEMA, 'models': {'embedding': MODEL_SHA},
            'embeddings': [[1.0] + [0.0] * 383 for _ in range(count)], **overrides,
        }).encode()
        return response

    def connection(self, *args, **kwargs):
        connection = Mock()
        connection.getresponse.return_value = self.responses.pop(0)
        self.connections.append((connection, kwargs))
        return connection

    def test_restart_reuses_completed_batches_and_defers_private_use(self):
        texts = ['synthetic-' + str(i) for i in range(10)]
        self.responses = [self.response(8), self.response(status=429)]
        model = RemoteEmbedding(self.tmp.name, connection=self.connection)
        with self.assertRaises(EmbeddingDeferred):
            list(model.embed(texts))
        sent = json.loads(self.connections[0][0].request.call_args.kwargs['body'])
        self.assertEqual(sent['model'], 'dgx-background-preparation')
        self.assertEqual(sent['embedding_model'], 'cache-minilm-v1')
        self.responses = [self.response(2)]
        resumed = RemoteEmbedding(self.tmp.name, connection=self.connection)
        self.assertEqual(len(list(resumed.embed(texts))), 10)
        sent = json.loads(self.connections[-1][0].request.call_args.kwargs['body'])
        self.assertEqual(sent['texts'], texts[8:])
        count = len(self.connections)
        list(resumed.embed(reversed(texts)))
        self.assertEqual(len(self.connections), count)

    def test_interactive_compute_has_a_short_deadline_and_no_background_alias(self):
        self.responses = [self.response()]
        model = RemoteEmbedding(self.tmp.name, background=False, connection=self.connection)
        list(model.embed(['synthetic']))
        conn, kwargs = self.connections[0]
        self.assertLess(kwargs['timeout'], 0.8)
        self.assertNotIn('model', json.loads(conn.request.call_args.kwargs['body']))

    def test_incompatible_or_invalid_vectors_are_never_persisted(self):
        model = RemoteEmbedding(self.tmp.name, connection=self.connection)
        for payload in [{'models': {'embedding': 'wrong'}}, {'embeddings': [[0.0]*384]},
                        {'embeddings': [[1.0]*768]}, {'embeddings': [[float('nan')]*384]}]:
            self.responses = [self.response(**payload)]
            with self.assertRaises(ValueError):
                list(model.embed(['synthetic']))
        self.responses = [self.response()]
        self.assertEqual(len(list(model.embed(['synthetic']))), 1)

    def test_unavailable_dgx_does_not_load_a_local_model(self):
        self.responses = [self.response(status=503)]
        with patch.dict('sys.modules', {'fastembed': None}):
            with self.assertRaises(EmbeddingDeferred):
                list(RemoteEmbedding(self.tmp.name, connection=self.connection).embed(['synthetic']))

    def test_raw_minilm_magnitudes_are_preserved_for_existing_distance_thresholds(self):
        self.responses = [self.response(embeddings=[[3.5] + [0.0] * 383])]
        model = RemoteEmbedding(self.tmp.name, connection=self.connection)
        first = list(model.embed(['synthetic']))[0]
        saved = list(model.embed(['synthetic']))[0]
        self.assertEqual(float(first[0]), 3.5)
        self.assertEqual(float(saved[0]), 3.5)


if __name__ == '__main__':
    unittest.main()
