"""Request-process owner of atomic, prebuilt maintenance activation."""
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from maintenance import atomic_json, digest


def inside(root, relative):
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()) or not candidate.is_file():
        raise ValueError('Invalid private cache file')
    return candidate


def close_retired(resource):
    if resource is None:
        return
    try:
        resource.close()
    except Exception as error:
        # Cleanup must never roll back an already committed in-memory version.
        logging.getLogger(__name__).warning('Retired index cleanup failed: %s', type(error).__name__)


# Every nightly attempt leaves a job directory with megabytes of candidate,
# source and input exports. On 2026-09-30 about 11,000 of them held 106 GB of
# the Pi5 SSD. Once a job has finished, only its result and log are kept; after
# a month the directory itself goes. Jobs that active.json or
# previous-active.json point to are never touched, because the live and
# rollback catalogues are read from them.
JOB_KEEP_FILES = frozenset({'result.json', 'worker.log', 'cancelled'})
JOB_TRIM_AFTER_SECONDS = 60 * 60
JOB_ABANDONED_AFTER_SECONDS = 24 * 60 * 60
JOB_REMOVE_AFTER_SECONDS = 30 * 24 * 60 * 60
JOB_PRUNE_LIMIT = 2000
RUN_ID_PATTERN = re.compile(r'[0-9a-f-]{36}')


def referenced_jobs(root):
    """Job ids the live and rollback pointers read files from."""
    jobs = set()
    for name in ('active.json', 'previous-active.json'):
        pointer = root / name
        if not pointer.exists():
            continue
        try:
            value = json.loads(pointer.read_text())
        except (OSError, ValueError):
            # An unreadable pointer means we cannot tell what is live: prune nothing.
            return None
        for relative in (value.get('catalogue'), value.get('sources')):
            parts = Path(relative or '').parts
            if len(parts) >= 2 and parts[0] == 'jobs':
                jobs.add(parts[1])
    return jobs


def prune_jobs(root, protect=(), now=None, limit=JOB_PRUNE_LIMIT):
    """Trim finished job directories to their result and log; remove month-old ones.

    Returns (trimmed, removed). Never follows symlinks and never touches a job
    that is protected, referenced by a pointer, or possibly still running.
    """
    root = Path(root)
    jobs_dir = root / 'jobs'
    keep = referenced_jobs(root)
    if keep is None or not jobs_dir.is_dir():
        return 0, 0
    keep |= {job for job in protect if job}
    now = time.time() if now is None else now
    trimmed = removed = 0
    entries = sorted((e for e in os.scandir(jobs_dir) if e.is_dir(follow_symlinks=False)),
                     key=lambda e: e.stat(follow_symlinks=False).st_mtime)
    for entry in entries:
        if trimmed + removed >= limit:
            break
        if entry.name in keep or not RUN_ID_PATTERN.fullmatch(entry.name):
            continue
        job = Path(entry.path)
        age = now - entry.stat(follow_symlinks=False).st_mtime
        result = job / 'result.json'
        finished = result.is_file() and now - result.stat().st_mtime >= JOB_TRIM_AFTER_SECONDS
        if not finished and age < JOB_ABANDONED_AFTER_SECONDS:
            continue
        if age >= JOB_REMOVE_AFTER_SECONDS:
            shutil.rmtree(job)
            removed += 1
            continue
        extra = [f for f in os.scandir(job) if f.name not in JOB_KEEP_FILES]
        if not extra:
            continue
        for item in extra:
            if item.is_dir(follow_symlinks=False):
                shutil.rmtree(item.path)
            else:
                os.unlink(item.path)
        # Keep the directory's age: trimming is not a new run.
        os.utime(job, (entry.stat(follow_symlinks=False).st_atime, entry.stat(follow_symlinks=False).st_mtime))
        trimmed += 1
    return trimmed, removed


class MaintenanceRuntime:
    def __init__(self, root, model_dir):
        self.root = Path(root).resolve()
        self.model_dir = Path(model_dir)
        self.process = None
        self.run_id = None
        self.log = None

    def paths(self):
        pointer = self.root / 'active.json'
        active = json.loads(pointer.read_text()) if pointer.exists() else {'catalogue': 'reviewed.json', 'sources': 'sources.json'}
        catalogue = inside(self.root, active['catalogue'])
        sources = self.root / active['sources']
        if sources.exists():
            sources = inside(self.root, active['sources'])
        elif active['sources'] != 'sources.json':
            raise ValueError('Active source export is missing')
        return catalogue, sources

    def start(self, run_id):
        if not re.fullmatch(r'[0-9a-f-]{36}', run_id or ''):
            raise ValueError('Invalid maintenance identity')
        if self.busy():
            return {'started': False, 'runId': self.run_id}
        job = self.root / 'jobs' / run_id
        inside(self.root, str((job / 'input.json').relative_to(self.root)))
        inside(self.root, str((job / 'candidate.json').relative_to(self.root)))
        inside(self.root, str((job / 'sources.json').relative_to(self.root)))
        if (job / 'result.json').exists():
            return {'started': False, 'runId': run_id, 'completed': True}
        try:
            trimmed, removed = prune_jobs(self.root, protect=(run_id, self.run_id))
            if trimmed or removed:
                logging.getLogger(__name__).info('Pruned %d finished and %d old maintenance jobs', trimmed, removed)
        except OSError as error:
            # Housekeeping must never block a maintenance run.
            logging.getLogger(__name__).warning('Maintenance job pruning failed: %s', type(error).__name__)
        self.run_id = run_id
        self.log = (job / 'worker.log').open('w')
        self.process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('maintenance.py')),
            '--root', str(self.root), '--run-id', run_id, '--model-dir', str(self.model_dir)],
            stdout=self.log, stderr=subprocess.STDOUT)
        return {'started': True, 'runId': run_id}

    def refresh(self, cache, sources):
        if not self.process or self.process.poll() is None:
            return cache, sources
        job = self.root / 'jobs' / self.run_id
        code = self.process.returncode
        if code == 0 and not (job / 'cancelled').exists() and self.awaiting_source_recheck(job):
            return cache, sources
        self.process = None
        self.log.close()
        if code != 0 or (job / 'cancelled').exists():
            return cache, sources
        new_sources = None
        next_cache = cache
        try:
            from server import QuestionCache
            from sources import SourceCandidates
            activation = json.loads((job / 'activation.json').read_text())
            if json.loads((job / 'input.json').read_text()).get('requireSourceRecheck'):
                checked = json.loads((job / 'source-recheck.json').read_text())
                if checked != {'runId': self.run_id, 'sourceSha256': activation['sourceSha256']}:
                    raise ValueError('Source recheck identity mismatch')
            current, _ = self.paths()
            if digest(current) != activation['baseCatalogueSha256'] or digest(self.root / 'checks.json') != activation['referenceSha256']:
                raise ValueError('Current catalogue or protected checks changed during maintenance')
            holdout_path = self.root / 'holdout.json'
            holdout_hash = digest(holdout_path) if holdout_path.exists() else None
            if holdout_hash != activation.get('holdoutSha256'):
                raise ValueError('Independent holdout changed during maintenance')
            if activation.get('factEvidenceSha256'):
                if (digest(inside(self.root, str((job / 'fact-evidence.json').relative_to(self.root)))) != activation['factEvidenceSha256']
                        or digest(inside(self.root, str((job / 'fact-candidate.json').relative_to(self.root)))) != activation['factCandidateSha256']):
                    raise ValueError('Source fact preparation changed during maintenance')
            source_path = inside(self.root, activation['sources'])
            if source_path.parent != job or digest(source_path) != activation['sourceSha256']:
                raise ValueError('Prepared source identity mismatch')
            new_sources = SourceCandidates(source_path, self.root / 'index', cache.model)
            next_path = current
            next_cache = cache
            if activation['catalogue']:
                next_path = inside(self.root, activation['catalogue'])
                if next_path.parent != job or digest(next_path) != activation['catalogueSha256']:
                    raise ValueError('Prepared catalogue identity mismatch')
                next_cache = QuestionCache(next_path, self.root / 'index', self.model_dir, cache.model)
            # One pointer switches both immutable files and survives a process restart.
            active = self.root / 'active.json'
            if active.exists():
                atomic_json(self.root / 'previous-active.json', json.loads(active.read_text()))
            else:
                atomic_json(self.root / 'previous-active.json', {'catalogue': 'reviewed.json', 'sources': 'sources.json'})
            report_path = job / 'result.json'
            report = json.loads(report_path.read_text())
            atomic_json(active, {'catalogue': str(next_path.relative_to(self.root)), 'sources': str(source_path.relative_to(self.root))})
        except Exception as error:
            close_retired(new_sources)
            if next_cache is not cache:
                close_retired(next_cache)
            atomic_json(job / 'result.json', {'runId': self.run_id, 'status': 'failed', 'activated': False,
                                             'reason': str(error)[:300]})
            return cache, sources
        close_retired(sources)
        if next_cache is not cache:
            close_retired(cache)
        # Nothing after the commit point may return the old in-memory version.
        try:
            report.update({'activated': bool(activation['catalogue']), 'sourcesRefreshed': True})
            atomic_json(report_path, report)
        except OSError:
            pass
        return next_cache, new_sources

    def busy(self):
        return bool(self.process and (self.process.poll() is None or
                    (self.process.returncode == 0 and self.awaiting_source_recheck(self.root / 'jobs' / self.run_id))))

    def awaiting_source_recheck(self, job):
        if (not (job / 'activation.json').exists() or not (job / 'result.json').exists()
                or (job / 'cancelled').exists()):
            return False
        report = json.loads((job / 'result.json').read_text())
        return (report.get('status') in ('improved', 'plateau', 'regression', 'slower', 'awaiting_holdout')
                and json.loads((job / 'input.json').read_text()).get('requireSourceRecheck') is True
                and not (job / 'source-recheck.json').exists())

    def authorize(self, run_id, source_sha256):
        if (run_id != self.run_id or self.process is None or self.process.poll() != 0):
            raise ValueError('Preparation is not ready for source recheck')
        job = self.root / 'jobs' / run_id
        if (job / 'cancelled').exists():
            raise ValueError('Preparation was cancelled')
        activation = json.loads((job / 'activation.json').read_text())
        if source_sha256 != activation['sourceSha256'] or digest(job / 'sources.json') != source_sha256:
            raise ValueError('Rechecked source identity mismatch')
        atomic_json(job / 'source-recheck.json', {'runId': run_id, 'sourceSha256': source_sha256})
        return {'runId': run_id, 'status': 'source_rechecked'}

    def cancel(self, run_id):
        if self.process and self.run_id == run_id:
            (self.root / 'jobs' / run_id / 'cancelled').touch()
            if self.process.poll() is None:
                self.process.terminate()
            atomic_json(self.root / 'jobs' / run_id / 'result.json',
                        {'runId': run_id, 'status': 'interrupted', 'activated': False})
        return {'runId': run_id, 'status': 'interrupted'}

    def state(self, experience):
        path, _ = self.paths()
        events = []
        if experience:
            for row in experience.db.execute('SELECT * FROM events ORDER BY updated DESC LIMIT 50').fetchall():
                events.append({'id': row['id'], 'question': row['question'], 'canonical': row['canonical'],
                    'answer': row['answer'], 'verdict': row['verdict'], 'sources': json.loads(row['sources'])})
        return {'baseCatalogueRelative': str(path.relative_to(self.root)), 'baseCatalogueSha256': digest(path),
                'catalogue': json.loads(path.read_text()), 'events': events,
                'running': self.busy(),
                'referenceSha256': digest(self.root / 'checks.json') if (self.root / 'checks.json').exists() else None}

    def status(self, run_id):
        if not re.fullmatch(r'[0-9a-f-]{36}', run_id or ''):
            raise ValueError('Invalid maintenance identity')
        if self.process and self.run_id == run_id and self.process.poll() is None:
            return {'runId': run_id, 'status': 'running'}
        job = self.root / 'jobs' / run_id
        if self.awaiting_source_recheck(job):
            return {'runId': run_id, 'status': 'awaiting_source_recheck'}
        path = self.root / 'jobs' / run_id / 'result.json'
        return json.loads(path.read_text()) if path.exists() else {'runId': run_id, 'status': 'interrupted'}
