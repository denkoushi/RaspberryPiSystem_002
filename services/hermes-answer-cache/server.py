"""Reviewed business answers: GPTCache suggests questions; the API checks sources.

Operator-reviewed catalogue answers and explicitly endorsed conversation answers
are distinct inputs. Authenticated writes accept server-recorded experiences.
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import unicodedata
from facts import fact_matches, fact_wordings, question_key, valid_question_shape, validate_fact_metadata
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def identifiers(question):
    # Explicit part/case numbers and numeric conditions must survive matching.
    # Similarity cannot distinguish adjacent product numbers reliably.
    text = unicodedata.normalize("NFKC", question).lower()
    return set(re.findall(r"[a-z]*\d+(?:[.-]\d+)*[a-z]*", text))


def read_catalogue(path):
    document = json.loads(Path(path).read_text())
    if document.get("version") != 1 or not isinstance(document.get("cases"), list):
        raise ValueError("Expected a version 1 reviewed catalogue")
    cases = {}
    for case in document["cases"]:
        question, answer = case.get("question"), case.get("answer")
        review, sources = case.get("review", {}), case.get("sources", [])
        if not isinstance(question, str) or not 1 <= len(question) <= 100 or question != question.strip():
            raise ValueError("A complete, bounded canonical question is required")
        if not isinstance(answer, str) or not 1 <= len(answer) <= 4000:
            raise ValueError("A complete reviewed answer is required")
        if review.get("verdict") != "pass" or not all(review.get(k) for k in ("reviewer", "reason", "reviewedAt")):
            raise ValueError("Every answer needs a source-grounded passing review")
        if not 1 <= len(sources) <= 8 or any(
            not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", s.get("kind", ""))
            or not isinstance(s.get("id"), str) or not s["id"]
            or len(s.get("sha256", "")) != 64
            or any(c not in "0123456789abcdef" for c in s["sha256"])
            for s in sources
        ):
            raise ValueError("Every source needs a current detail fingerprint")
        if question in cases:
            raise ValueError("Duplicate canonical question; correct the existing case")
        queries = case.get("queries", [question])
        if not isinstance(queries, list) or not 1 <= len(queries) <= 20 or any(
            not isinstance(q, str) or not 1 <= len(q) <= 4000 for q in queries
        ):
            raise ValueError("Expected bounded, reviewed question wordings")
        cases[question] = {"question": question, "answer": answer, "sources": sources, "queries": queries}
        if "fact" in case:
            validate_fact_metadata(case['fact'])
            if (len(sources) != 1 or queries[0] != question or not fact_matches(question, case['fact'])
                    or any(q != question and not valid_question_shape(q, case['fact']) for q in queries)):
                raise ValueError('Invalid source fact catalogue entry')
            cases[question]['fact'] = case['fact']
    return cases


class QuestionCache:
    def __init__(self, catalogue, data_dir, model_dir, model=None):
        from embedding import create_embedding
        from gptcache import Cache, Config
        from gptcache.adapter.api import init_similar_cache, put
        from gptcache.processor.post import nop

        self.cases = read_catalogue(catalogue)
        self.prepare_fact_index()
        self.model = model or create_embedding(model_dir, data_dir)
        # Catalogue + model identity separates indexes when a question is removed
        # or corrected. The persisted catalogue remains the source of truth.
        identity = hashlib.sha256((MODEL + Path(catalogue).read_text()).encode()).hexdigest()
        self.cache = Cache()
        model = self.model

        class Embedding:
            dimension = 384

            @staticmethod
            def to_embeddings(text, **kwargs):
                return next(model.embed([text]))

        index_dir = Path(data_dir) / identity
        ready = index_dir / "ready"
        init_similar_cache(data_dir=str(index_dir), cache_obj=self.cache,
                           embedding=Embedding(), post_func=nop,
                           config=Config(similarity_threshold=0.90))
        if not ready.exists():
            for question, case in self.cases.items():
                if "fact" in case:
                    continue
                for wording in set([question, *case["queries"]]):
                    put(wording, question, cache_obj=self.cache)
            self.cache.flush()
            ready.touch()
        # Warm the embedding session before announcing readiness.
        # Existing indexes are ready even while DGX is reserved for private use.
        if not hasattr(model, 'background'):
            next(model.embed(["作業の確認方法"]))

    def prepare_fact_index(self):
        self.fact_index = {}
        self.has_ordinary = any('fact' not in c for c in self.cases.values())
        for canonical, case in self.cases.items():
            if 'fact' not in case:
                continue
            for wording in fact_wordings(case):
                key = question_key(wording)
                if key in self.fact_index and self.fact_index[key] != canonical:
                    self.fact_index[key] = None  # Ambiguous normalized identities never pick a record.
                else:
                    self.fact_index[key] = canonical

    def search_fact(self, question):
        if not hasattr(self, 'fact_index'):
            self.prepare_fact_index()
        canonical = self.fact_index.get(question_key(question))
        return {'question': canonical} if canonical else None

    def search(self, question):
        from gptcache.adapter.api import get
        if not self.cases:
            return None
        result = self.search_fact(question)
        if result or question_key(question) in self.fact_index or not self.has_ordinary:
            return result
        matches = get(question, cache_obj=self.cache, top_k=3) or []
        if isinstance(matches, str):
            matches = [matches]
        # This is a suggestion, never an assertion of equivalent conditions.
        required = identifiers(question)
        return next(({"question": q} for q in matches if q in self.cases and "fact" not in self.cases[q]
                     and required.issubset(identifiers(q))), None)

    def lookup(self, question):
        return self.cases.get(question)


def serve(cache, host, port, token, sources=None, experience=None, maintenance=None):
    if len(token) < 24:
        raise ValueError("ANSWER_CACHE_TOKEN must contain at least 24 characters")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not log business questions or credentials.

        def reply(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self.reply(200 if self.path == "/health" else 404,
                       {"ready": self.path == "/health"})

        def do_POST(self):
            nonlocal cache, sources
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                return self.reply(401, {"error": "unauthorized"})
            if maintenance and self.path != '/maintenance/cancel':
                cache, sources = maintenance.refresh(cache, sources)
            if self.path not in ("/maintenance/state", "/maintenance/start", "/maintenance/status", "/maintenance/cancel", "/search", "/lookup", "/candidates", "/source", "/experience", "/feedback"):
                return self.reply(404, {"error": "not found"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 1 <= size <= 64000:
                    raise ValueError("request size")
                payload = json.loads(self.rfile.read(size))
                if self.path == "/experience":
                    return self.reply(200, {"result": experience.remember(payload) if experience else False})
                if self.path == "/feedback":
                    return self.reply(200, {"result": experience.feedback(payload['id'], payload['verdict']) if experience else False})
                if self.path.startswith('/maintenance/'):
                    if not maintenance:
                        return self.reply(404, {'error': 'maintenance disabled'})
                    if self.path == '/maintenance/cancel':
                        return self.reply(200, {'result': maintenance.cancel(payload.get('runId'))})
                    result = maintenance.state(experience) if self.path == '/maintenance/state' else (
                        maintenance.start(payload.get('runId')) if self.path == '/maintenance/start' else maintenance.status(payload.get('runId')))
                    return self.reply(200, {'result': result})
                question = payload["question"]
                if not isinstance(question, str) or not 1 <= len(question) <= 4000:
                    raise ValueError("question")
                if self.path == "/candidates":
                    result = (experience.candidates(question, sources) if experience else sources.search(question)) if sources else []
                elif self.path == "/source":
                    result = sources.lookup(question) if sources else None
                else:
                    if self.path == "/search":
                        result = cache.search_fact(question)
                        if result is None and question_key(question) not in cache.fact_index:
                            result = experience.suggest(question) if experience else None
                        cached = cache.lookup(result['question']) if result else None
                        if cached and 'fact' in cached and not fact_matches(question, cached['fact'], cached['queries']):
                            result = None
                        result = result or cache.search(question)
                        if result and experience and 'fact' not in (cache.lookup(result['question']) or {}) and experience.denied(cache.lookup(result['question'])):
                            result = None
                    else:
                        cached = cache.lookup(question)
                        result = cached if cached and 'fact' in cached else (experience.lookup(question) if experience else None) or cached
                        if experience and 'fact' not in (result or {}) and experience.denied(result):
                            result = None
                self.reply(200, {"result": result})
            except (ValueError, KeyError, TypeError):
                self.reply(400, {"error": "invalid request"})
            except Exception:
                self.reply(503, {"error": "cache unavailable"})

    # Single owner of SQLite/FAISS; the API has a short timeout and falls back.
    HTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalogue", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--sources", default=os.environ.get("ANSWER_CACHE_SOURCES") or None, help="Authorized candidate export; current details are reread by the API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8650)
    args = parser.parse_args()
    maintenance = None
    if os.environ.get('ANSWER_CACHE_MAINTENANCE') == 'true':
        from runtime import MaintenanceRuntime
        maintenance = MaintenanceRuntime(args.data_dir, args.model_dir)
        catalogue, sources_path = maintenance.paths()
        args.catalogue = str(catalogue)
        args.sources = str(sources_path) if sources_path.exists() else None
    cache = QuestionCache(args.catalogue, Path(args.data_dir) / 'index' if maintenance else args.data_dir, args.model_dir)
    from sources import SourceCandidates
    sources = SourceCandidates(args.sources, Path(args.data_dir) / 'index' if maintenance else args.data_dir, cache.model) if args.sources else None
    from experience import ExperienceStore
    experience = ExperienceStore(args.data_dir, cache.model)
    if hasattr(cache.model, 'background'):
        cache.model.background = False
    serve(cache, args.host, args.port, os.environ.get("ANSWER_CACHE_TOKEN", ""), sources, experience, maintenance)
