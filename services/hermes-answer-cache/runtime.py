"""Request-process owner of atomic, prebuilt maintenance activation."""
import json
import re
import subprocess
import sys
from pathlib import Path
from maintenance import atomic_json, digest


def inside(root, relative):
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()) or not candidate.is_file():
        raise ValueError('Invalid private cache file')
    return candidate


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
            atomic_json(job / 'result.json', {'runId': self.run_id, 'status': 'failed', 'activated': False,
                                             'reason': str(error)[:300]})
            return cache, sources
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
