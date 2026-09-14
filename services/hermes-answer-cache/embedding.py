"""Model-only DGX computation; durable vectors and source ownership remain local."""
import hashlib
import http.client
import ipaddress
import json
import os
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

MODEL_SHA = '634d0f66c29dc934c8fa72b8a4fe91dd4d420a22f1d82a241058d4316e659a99'
SCHEMA = 'hermes-search-inference/v1'


class EmbeddingDeferred(RuntimeError):
    pass


class RemoteEmbedding:
    def __init__(self, directory, *, background=True, connection=http.client.HTTPConnection):
        origin = urlparse(os.environ['ANSWER_CACHE_EMBEDDING_ORIGIN'])
        proxy = urlparse(os.environ['ANSWER_CACHE_EMBEDDING_EGRESS'])
        address = ipaddress.ip_address(origin.hostname)
        allowed = address.is_private or address in ipaddress.ip_network('100.64.0.0/10')
        if (origin.scheme != 'http' or not allowed or origin.username or origin.password
                or origin.path not in ('', '/') or origin.query or origin.fragment
                or proxy.scheme != 'http' or proxy.hostname not in ('business-hermes-egress', 'business-hermes-chat-egress')
                or proxy.username or proxy.password or proxy.path not in ('', '/') or proxy.query or proxy.fragment):
            raise ValueError('Invalid private embedding endpoint')
        self.token = os.environ['ANSWER_CACHE_EMBEDDING_TOKEN']
        if len(self.token) < 16 or any(c in self.token for c in '\r\n'):
            raise ValueError('Invalid embedding credential')
        self.target = origin.geturl().rstrip('/') + '/v1/hermes-search/embed'
        self.authority = origin.netloc
        self.proxy = (proxy.hostname, proxy.port or 80)
        self.background, self.connection = background, connection
        Path(directory).mkdir(parents=True, exist_ok=True)
        self.path = Path(directory) / 'dgx-minilm-v1.sqlite'
        with sqlite3.connect(self.path, timeout=5) as db:
            db.execute('CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, value BLOB NOT NULL)')

    def request(self, texts):
        import numpy as np
        body = json.dumps({'schema': SCHEMA, 'embedding_model': 'cache-minilm-v1', 'texts': texts,
                           **({'model': 'dgx-background-preparation'} if self.background else {})})
        conn = self.connection(*self.proxy, timeout=45 if self.background else 0.6)
        try:
            conn.request('POST', self.target, body=body, headers={
                'Host': self.authority, 'Content-Type': 'application/json', 'X-LLM-Token': self.token})
            response = conn.getresponse()
            if response.status != 200:
                raise EmbeddingDeferred('DGX embedding unavailable: HTTP ' + str(response.status))
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError('Oversized embedding response')
            result = json.loads(raw)
            if result.get('schema') != SCHEMA or result.get('models', {}).get('embedding') != MODEL_SHA:
                raise ValueError('Embedding model identity mismatch')
            raw_vectors = result.get('embeddings')
            if not isinstance(raw_vectors, list) or any(not isinstance(v, list) or any(
                    type(x) not in (int, float) for x in v) for v in raw_vectors):
                raise ValueError('Invalid embedding number types')
            vectors = np.asarray(raw_vectors, dtype='float32')
            if vectors.shape != (len(texts), 384) or not np.isfinite(vectors).all():
                raise ValueError('Invalid embedding vectors')
            if not np.all(np.abs(np.linalg.norm(vectors, axis=1) - 1) < 0.01):
                raise ValueError('Unnormalized embedding vectors')
            return vectors
        except (OSError, http.client.HTTPException) as error:
            raise EmbeddingDeferred('DGX embedding temporarily unavailable') from error
        finally:
            conn.close()

    def embed(self, documents, batch_size=8, **kwargs):
        import numpy as np
        texts = [documents] if isinstance(documents, str) else list(documents)
        if any(not isinstance(t, str) or not 1 <= len(t) <= 16000 for t in texts):
            raise ValueError('Invalid embedding text')
        keys = [hashlib.sha256((MODEL_SHA + '\n' + t).encode()).hexdigest() for t in texts]
        values = {}
        with sqlite3.connect(self.path, timeout=5) as db:
            for key in set(keys):
                row = db.execute('SELECT value FROM vectors WHERE key=?', (key,)).fetchone()
                if row:
                    vector = np.frombuffer(row[0], dtype='float32').copy()
                    if vector.shape != (384,) or not np.isfinite(vector).all():
                        raise ValueError('Invalid saved embedding')
                    values[key] = vector
        pending = list(dict.fromkeys(key for key in keys if key not in values))
        by_key = dict(zip(keys, texts))
        # Commit each bounded batch: a private switch never discards earlier work.
        for start in range(0, len(pending), 8):
            batch = pending[start:start + 8]
            vectors = self.request([by_key[key] for key in batch])
            with sqlite3.connect(self.path, timeout=5) as db:
                for key, vector in zip(batch, vectors, strict=True):
                    db.execute('INSERT OR REPLACE INTO vectors VALUES (?,?)', (key, vector.tobytes()))
                    values[key] = vector
        yield from (values[key] for key in keys)


def create_embedding(model_dir, data_dir):
    if os.environ.get('ANSWER_CACHE_EMBEDDING_ORIGIN'):
        return RemoteEmbedding(data_dir)
    # Explicitly retained for offline tools/tests and rollback images.
    from fastembed import TextEmbedding
    return TextEmbedding('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
                         cache_dir=str(model_dir), threads=2)
