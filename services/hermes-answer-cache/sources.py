"""Candidate records from an authorized export; never a source of final answers."""
import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path


def source_text(record):
    return record['text']


def source_option(record):
    return 'この資料で回答：' + record['title']


class SourceCandidates:
    def __init__(self, path, data_dir, model, previous=None):
        import faiss
        import numpy as np
        raw = Path(path).read_text()
        document = json.loads(raw)
        if document.get('version') != 2 or not isinstance(document.get('records'), list):
            raise ValueError('Expected a version 2 authorized source export')
        self.records = document['records']
        if not self.records or len(self.records) > 100_000:
            raise ValueError('Invalid source catalogue size')
        if any(not re.fullmatch(r'[a-z][a-z0-9_]{0,63}', r.get('kind', '')) or not r.get('id')
               or not isinstance(r.get('text'), str) or not isinstance(r.get('title'), str)
               or not 1 <= len(r['title']) <= 100 or not isinstance(r.get('identifiers'), list) for r in self.records):
            raise ValueError('Invalid source identity')
        self.options = {source_option(r): r for r in self.records}
        if len(self.options) != len(self.records):
            raise ValueError('Source choices must identify exactly one record')
        self.model = model
        self.texts = [source_text(r) for r in self.records]
        identity = hashlib.sha256(('multilingual-MiniLM-L12-v2-fastembed-0.8.0\n' + json.dumps(self.records, ensure_ascii=False, sort_keys=True)).encode()).hexdigest()
        directory = Path(data_dir) / ('sources-' + identity)
        directory.mkdir(parents=True, exist_ok=True)
        index_path = directory / 'index.faiss'
        if index_path.exists():
            self.index = faiss.read_index(str(index_path))
        else:
            self.index = faiss.IndexFlatIP(384)
            known = {(r['kind'], r['id']): i for i, r in enumerate(previous.records)} if previous else {}
            for start in range(0, len(self.records), 128):
                batch = self.records[start:start + 128]
                vectors = np.zeros((len(batch), 384), dtype='float32')
                changed = []
                for position, record in enumerate(batch):
                    old = known.get((record['kind'], record['id']))
                    if old is not None and previous.texts[old] == record['text']:
                        vectors[position] = previous.index.reconstruct(old)
                    else:
                        changed.append(position)
                if changed:
                    fresh = np.asarray(list(model.embed([batch[i]['text'] for i in changed], batch_size=8)), dtype='float32')
                    faiss.normalize_L2(fresh)
                    vectors[changed] = fresh
                self.index.add(vectors)
            temporary = directory / 'index.tmp'
            faiss.write_index(self.index, str(temporary))
            temporary.replace(index_path)
        self.lexical = sqlite3.connect(str(directory / 'terms.sqlite'))
        self.lexical.execute("CREATE VIRTUAL TABLE IF NOT EXISTS records USING fts5(body, tokenize='trigram')")
        if self.lexical.execute('SELECT count(*) FROM records').fetchone()[0] != len(self.records):
            self.lexical.execute('DELETE FROM records')
            self.lexical.executemany('INSERT INTO records(rowid,body) VALUES (?,?)', enumerate(self.texts, 1))
            self.lexical.commit()
        if self.index.ntotal != len(self.records) or self.index.d != 384:
            raise ValueError('Source index identity mismatch')

    def search(self, question):
        import faiss
        import numpy as np
        normalized = unicodedata.normalize('NFKC', question).lower()
        # Explicit product/case identifiers are filters, not embedding similarity.
        parts = set(re.findall(r'(?<![a-z0-9])[a-z]{2,}\d{5,}(?![a-z0-9])', normalized))
        numbers = set(re.findall(r'(?:不適合|記録)(?:番号)?\s*(\d{8})(?!\d)', normalized))
        vector = np.asarray(list(self.model.embed([question])), dtype='float32')
        faiss.normalize_L2(vector)
        scores, ids = self.index.search(vector, len(self.records))
        # SQLite's standard FTS5 trigram index handles Japanese without an LLM
        # tokenizer. Reciprocal-rank fusion combines exact wording with meaning.
        grams = sorted({span[i:i + 3] for span in re.findall(r'[\w]+', normalized)
                        for i in range(len(span) - 2)})
        lexical = self.lexical.execute('SELECT rowid FROM records WHERE records MATCH ? ORDER BY rank LIMIT 100',
            (' OR '.join('"' + gram + '"' for gram in grams),)).fetchall() if grams else []
        fused = {int(index): 1 / (10 + rank) for rank, index in enumerate(ids[0], 1)}
        for rank, (rowid,) in enumerate(lexical, 1):
            fused[rowid - 1] = fused.get(rowid - 1, 0) + 1 / (10 + rank)
        semantic = {int(index): float(score) for score, index in zip(scores[0], ids[0])}
        order = ids[0] if parts or numbers else sorted(fused, key=lambda index: fused[index], reverse=True)
        found = []
        for index in order:
            score = semantic[int(index)]
            record = self.records[int(index)]
            record_ids = {unicodedata.normalize('NFKC', str(v)).lower() for v in record['identifiers']}
            if parts and not parts.issubset(record_ids):
                continue
            if numbers and not numbers.issubset(record_ids):
                continue
            if not parts and not numbers and float(score) < 0.45:
                continue
            found.append({'option': source_option(record)})
            if len(found) == 3:
                break
        return found

    def lookup(self, option):
        record = self.options.get(option)
        return {'kind': record['kind'], 'id': record['id']} if record else None
