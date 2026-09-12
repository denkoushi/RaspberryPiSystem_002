#!/usr/bin/env python3
"""Copy an authorized trial index without rebuilding vectors or changing sources."""
import argparse
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

MODEL = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf'
MODEL_SHA = 'b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fingerprint(model):
    return hashlib.sha256('\n'.join([
        f'model:{model}',
        'query:task: search result | query: __qmd_embedding_query_probe__',
        'doc:title: __qmd_embedding_title_probe__ | text: __qmd_embedding_document_probe__',
        'chunk_tokens:900', 'chunk_overlap_tokens:135',
    ]).encode()).hexdigest()[:6]


def vector_digest(connection):
    # Hash vec0 shadow bytes without needing a platform-specific SQLite extension.
    result = hashlib.sha256()
    for table in ('vectors_vec_vector_chunks00', 'vectors_vec_rowids', 'vectors_vec_chunks'):
        for row in connection.execute(f'SELECT * FROM {table} ORDER BY rowid'):
            for value in row:
                data = value if isinstance(value, bytes) else str(value).encode()
                result.update(len(data).to_bytes(8, 'big'))
                result.update(data)
    return result.hexdigest()


def prepare(args):
    if digest(args.model) != MODEL_SHA:
        raise ValueError('approved embedding model checksum required')
    target = Path(args.output)
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    with sqlite3.connect(f'file:{Path(args.index).resolve()}?mode=ro', uri=True) as source:
        with sqlite3.connect(target / 'qmd-index.sqlite') as destination:
            # SQLite backup includes committed WAL state and keeps the source untouched.
            source.backup(destination)
            prior = destination.execute('SELECT DISTINCT model,embed_fingerprint FROM content_vectors').fetchall()
            if len(prior) != 1 or prior[0][1] != fingerprint(prior[0][0]):
                raise ValueError('unsupported embedding fingerprint')
            if Path(prior[0][0]).name != Path(args.model).name:
                raise ValueError('index/model identity mismatch')
            before = vector_digest(destination)
            destination.execute('UPDATE content_vectors SET model=?,embed_fingerprint=?', (MODEL,fingerprint(MODEL)))
            destination.execute('DELETE FROM llm_cache')
            destination.commit()
            after = vector_digest(destination)
            if before != after:
                raise ValueError('vector data changed')
            counts = dict(destination.execute('SELECT collection,count(*) FROM documents WHERE active=1 GROUP BY collection'))
            chunks = destination.execute('SELECT count(*) FROM content_vectors').fetchone()[0]
    files = {'snapshot.json':args.snapshot, 'reviewed.json':args.reviewed}
    for name, source in files.items():
        shutil.copyfile(source, target / name)
        (target / name).chmod(0o600)
    snapshot = json.loads((target/'snapshot.json').read_text())
    reviewed = json.loads((target/'reviewed.json').read_text())
    if reviewed.get('snapshotDigest') != snapshot.get('digest'):
        raise ValueError('snapshot/reviewed manifest mismatch')
    if counts.get('hermes') != snapshot.get('recordCount') or counts.get('organized') != len(reviewed.get('records',[])):
        raise ValueError('index/source count mismatch')
    proof = {'schema':'hermes-device-index/v1', 'model':MODEL, 'modelSha256':MODEL_SHA,
        'vectorBytesSha256':after, 'vectorChunks':chunks, 'documentCounts':counts,
        'snapshotDigest':snapshot['digest'], 'files':{name:digest(target/name)
            for name in ('qmd-index.sqlite','snapshot.json','reviewed.json')}}
    (target/'artifact.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(proof,ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('index','model','snapshot','reviewed','output'):
        parser.add_argument('--'+name, required=True)
    prepare(parser.parse_args())
