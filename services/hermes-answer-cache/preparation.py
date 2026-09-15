"""Pi-owned, verified installation of disposable DGX index artifacts."""
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from embedding import EmbeddingDeferred, MODEL_SHA, SCHEMA

PREPARATION_SCHEMA = 'hermes-index-preparation/v1'
CHUNK_BYTES = 512 * 1024
MAX_BYTES = 256 * 1024 * 1024
FILES = {'sources': {'index.faiss', 'terms.sqlite'}, 'questions': {'faiss.index', 'sqlite.db'}}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class RemotePreparation:
    def __init__(self, model):
        self.model = model

    def request(self, value):
        model = self.model
        conn = model.connection(*model.proxy, timeout=45)
        try:
            conn.request('POST', model.target.removesuffix('/embed') + '/prepare',
                body=encoded({'schema': SCHEMA, 'preparationSchema': PREPARATION_SCHEMA,
                              'model': 'dgx-background-preparation', **value}),
                headers={'Host': model.authority, 'Content-Type': 'application/json', 'X-LLM-Token': model.token})
            response = conn.getresponse()
            if response.status != 200:
                raise EmbeddingDeferred('DGX preparation unavailable: HTTP ' + str(response.status))
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError('Oversized preparation response')
            result = json.loads(raw)
            if (result.get('schema') != SCHEMA or result.get('models', {}).get('embedding') != MODEL_SHA
                    or (result.get('state') != 'busy' and result.get('jobId') != value['jobId'])):
                raise ValueError('Preparation identity mismatch')
            if result.get('state') in ('busy', 'missing'):
                raise EmbeddingDeferred('DGX preparation must resume')
            return result
        except (OSError, http.client.HTTPException) as error:
            raise EmbeddingDeferred('DGX preparation temporarily unavailable') from error
        finally:
            conn.close()

    def build(self, kind, rows, directory):
        """Only semantic text/vector pairs leave Pi; no answers or source credentials."""
        if kind not in FILES:
            raise ValueError('Unknown index kind')
        directory = Path(directory)
        directory.parent.mkdir(parents=True, exist_ok=True)
        # Inputs and partial downloads remain private and never mark an index ready.
        with TemporaryDirectory(prefix='.preparation-', dir=directory.parent) as temporary:
            scratch = Path(temporary)
            chunks, batch, count, size, batch_bytes = [], [], 0, 0, 2
            def save():
                nonlocal batch, size, batch_bytes
                raw = encoded(batch)
                size += len(raw)
                if size > MAX_BYTES or len(chunks) >= 4096:
                    raise ValueError('Preparation input limit')
                (scratch / str(len(chunks))).write_bytes(raw)
                chunks.append(digest(raw))
                batch = []
                batch_bytes = 2
            for row in rows:
                row_bytes = len(encoded(row)) + 1
                if batch and (len(batch) >= 128 or batch_bytes + row_bytes > CHUNK_BYTES):
                    save()
                if row_bytes + 2 > CHUNK_BYTES:
                    raise ValueError('Preparation row limit')
                batch.append(row)
                batch_bytes += row_bytes
                count += 1
            if batch:
                save()
            if not 1 <= count <= (1000 if kind == 'questions' else 100_000):
                raise ValueError('Preparation row count')
            manifest = {'kind': kind, 'count': count, 'chunks': chunks}
            identity = digest(encoded(manifest))
            try:
                state = self.request({'action': 'begin', 'jobId': identity, 'manifest': manifest})
                # Replaying every hash-checked page also validates an untrusted nextChunk.
                for number in range(len(chunks)):
                    state = self.request({'action': 'chunk', 'jobId': identity, 'chunk': number,
                                          'rows': json.loads((scratch / str(number)).read_bytes())})
                state = self.request({'action': 'finish', 'jobId': identity})
                artifacts = state.get('artifacts')
                if (state.get('state') != 'complete' or state.get('count') != count
                        or state.get('nextChunk') != len(chunks) or not isinstance(artifacts, dict)
                        or set(artifacts) != FILES[kind]):
                    raise ValueError('Invalid preparation manifest')
                total = 0
                for name, info in artifacts.items():
                    length = info.get('bytes')
                    if type(length) is not int or not 1 <= length <= MAX_BYTES:
                        raise ValueError('Invalid artifact size')
                    total += length
                    if total > MAX_BYTES:
                        raise ValueError('Preparation output limit')
                    with (scratch / name).open('wb') as stream:
                        offset = 0
                        while offset < length:
                            result = self.request({'action': 'artifact', 'jobId': identity, 'file': name, 'offset': offset})
                            raw = base64.b64decode(result.get('data', ''), validate=True)
                            if (result.get('state') != 'artifact' or result.get('file') != name or result.get('offset') != offset
                                    or len(raw) != min(CHUNK_BYTES, length - offset) or digest(raw) != result.get('sha256')):
                                raise ValueError('Invalid artifact chunk')
                            stream.write(raw)
                            offset += len(raw)
                    if digest((scratch / name).read_bytes()) != info.get('sha256'):
                        raise ValueError('Invalid artifact digest')
                directory.mkdir(parents=True, exist_ok=True)
                for name in FILES[kind]:
                    os.replace(scratch / name, directory / name)
                (directory / 'remote-ready').write_bytes(encoded({'jobId': identity, 'artifacts': artifacts}))
            finally:
                # Best effort only: no remote failure can remove a verified local index.
                # Private unload or the worker's 60-second idle expiry clears the scratch.
                try:
                    self.request({'action': 'release', 'jobId': identity})
                except (EmbeddingDeferred, ValueError):
                    pass


def index_rows(records, model):
    import numpy as np
    for start in range(0, len(records), 8):
        batch = records[start:start + 8]
        for row, vector in zip(batch, model.embed([r['text'] for r in batch]), strict=True):
            yield {**row, 'vector': base64.b64encode(np.asarray(vector, dtype='<f4').tobytes()).decode()}


def remote_preparation(model):
    if os.environ.get('ANSWER_CACHE_REMOTE_PREPARATION') != 'true':
        return None
    if not hasattr(model, 'connection'):
        raise EmbeddingDeferred('Remote preparation requires the DGX embedding boundary')
    return RemotePreparation(model)
