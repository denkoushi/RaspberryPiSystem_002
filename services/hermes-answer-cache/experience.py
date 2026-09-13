"""Persist conversation outcomes; GPTCache indexes their question meanings.

Selection improves source suggestions. Only explicit helpful feedback enables
answer reuse; it is a user endorsement, not independent proof of correctness.
The business API always rechecks current source identity/visibility/revision.
"""
import json
import re
import sqlite3
import time
from pathlib import Path


class ExperienceStore:
    def __init__(self, data_dir, model):
        from gptcache import Cache, Config
        from gptcache.adapter.api import init_similar_cache
        from gptcache.processor.post import nop
        root = Path(data_dir) / 'business-experience-v1'
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        root.chmod(0o700)
        self.db = sqlite3.connect(str(root / 'events.sqlite'))
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, sources TEXT NOT NULL, verdict TEXT NOT NULL, updated REAL NOT NULL, indexed INTEGER NOT NULL DEFAULT 0)')
        if 'canonical' not in {r['name'] for r in self.db.execute('PRAGMA table_info(events)')}:
            self.db.execute('ALTER TABLE events ADD COLUMN canonical TEXT')
            self.db.commit()
        self.db.execute('CREATE INDEX IF NOT EXISTS events_question ON events(question, updated)')
        self.cache = Cache()

        class Embedding:
            dimension = 384

            @staticmethod
            def to_embeddings(text, **kwargs):
                return next(model.embed([text]))

        init_similar_cache(data_dir=str(root / 'meaning'), cache_obj=self.cache, embedding=Embedding(),
                           post_func=nop, config=Config(similarity_threshold=0.90))
        self._index_pending()

    def _index_pending(self):
        from gptcache.adapter.api import put
        # Index question strings, not individual repeated conversations. SQL
        # resolves all their current verdicts, including later withdrawals.
        for row in self.db.execute('SELECT DISTINCT question FROM events WHERE indexed=0').fetchall():
            put(row['question'], row['question'], cache_obj=self.cache)
            self.cache.flush()
            self.db.execute('UPDATE events SET indexed=1 WHERE question=?', (row['question'],))
            self.db.commit()

    def remember(self, event):
        if not isinstance(event, dict) or set(event) != {'id', 'question', 'canonicalQuestion', 'answer', 'sources'}:
            raise ValueError('event')
        for key, maximum in [('id', 200), ('question', 4000), ('answer', 4000)]:
            if not isinstance(event[key], str) or not 1 <= len(event[key]) <= maximum:
                raise ValueError(key)
        canonical = event['canonicalQuestion']
        if canonical is not None and (not isinstance(canonical, str) or not 1 <= len(canonical) <= 100):
            raise ValueError('canonical question')
        refs = event['sources']
        if not isinstance(refs, list) or not 1 <= len(refs) <= 8 or any(
            not isinstance(s, dict) or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}', s.get('kind', ''))
            or not isinstance(s.get('id'), str) or not 1 <= len(s['id']) <= 200
            or not re.fullmatch(r'[0-9a-f]{64}', s.get('sha256', '')) for s in refs):
            raise ValueError('source')
        # An HTTP retry cannot replace the answer or reset withdrawn feedback.
        self.db.execute('INSERT OR IGNORE INTO events(id,question,answer,sources,verdict,updated,canonical) VALUES (?,?,?,?,?,?,?)',
                        (event['id'], event['question'].strip(), event['answer'], json.dumps(refs, sort_keys=True), 'selected', time.time(), canonical))
        # Complete an older local record without changing its text or feedback.
        self.db.execute('UPDATE events SET canonical=? WHERE id=? AND canonical IS NULL AND question=? AND answer=? AND sources=?',
                        (canonical, event['id'], event['question'].strip(), event['answer'], json.dumps(refs, sort_keys=True)))
        self.db.commit()
        self._index_pending()
        return True

    def feedback(self, event_id, verdict):
        if not isinstance(event_id, str) or verdict not in ('helpful', 'unhelpful'):
            raise ValueError('feedback')
        count = self.db.execute('UPDATE events SET verdict=?, updated=? WHERE id=?', (verdict, time.time(), event_id)).rowcount
        self.db.commit()
        return count == 1

    def matches(self, question):
        from gptcache.adapter.api import get
        from server import identifiers
        matches = get(question, cache_obj=self.cache, top_k=12) or []
        if isinstance(matches, str):
            matches = [matches]
        # Exact lookups survive index failures/restarts and avoid embedding ties.
        questions = list(dict.fromkeys([question, *matches]))
        required = identifiers(question)
        result = []
        for q in questions:
            if not isinstance(q, str) or not required.issubset(identifiers(q)):
                continue
            result.extend(self.db.execute('SELECT * FROM events WHERE question=? OR (canonical IS NOT NULL AND canonical IN (SELECT canonical FROM events WHERE question=?)) ORDER BY updated DESC LIMIT 50', (q, q)).fetchall())
        return result

    def blocked(self, row):
        # One reported bad answer must not reappear via another conversation.
        return self.db.execute("SELECT 1 FROM events WHERE answer=? AND sources=? AND verdict='unhelpful' LIMIT 1",
                               (row['answer'], row['sources'])).fetchone() is not None

    def denied(self, answer):
        if not answer:
            return False
        return self.db.execute("SELECT 1 FROM events WHERE answer=? AND sources=? AND verdict='unhelpful' LIMIT 1",
                               (answer['answer'], json.dumps(answer['sources'], sort_keys=True))).fetchone() is not None

    def lookup(self, question):
        for row in self.db.execute("SELECT * FROM events WHERE canonical=? AND verdict='helpful' ORDER BY updated DESC", (question,)):
            if len(question) <= 100 and not self.blocked(row):
                return {'question': question, 'answer': row['answer'], 'sources': json.loads(row['sources'])}
        return None

    def suggest(self, question):
        for row in self.matches(question):
            if row['verdict'] != 'unhelpful' and row['canonical'] and self.lookup(row['canonical']):
                return {'question': row['canonical']}
        return None

    def candidates(self, question, sources):
        rows = self.matches(question)
        rejected = {s['kind'] + ':' + s['id'] for row in rows if row['verdict'] == 'unhelpful' for s in json.loads(row['sources'])}
        preferred = []
        for row in sorted(rows, key=lambda r: r['verdict'] == 'helpful', reverse=True):
            for ref in json.loads(row['sources']):
                key = ref['kind'] + ':' + ref['id']
                if key not in rejected and key not in preferred:
                    preferred.append(key)
        by_key = {r['kind'] + ':' + r['id']: option for option, r in sources.options.items()}
        # A remembered source removed from the latest export cannot be revived.
        candidates = [{'option': by_key[key]} for key in preferred if key in by_key]
        candidates += [r for r in sources.search(question)
                       if (lambda s: s['kind'] + ':' + s['id'] not in rejected)(sources.lookup(r['option']))]
        return list({r['option']: r for r in candidates}.values())[:3]
