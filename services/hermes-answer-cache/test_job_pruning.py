import json
import os
import tempfile
import time
import unittest
from pathlib import Path

from runtime import JOB_REMOVE_AFTER_SECONDS, prune_jobs

DAY = 24 * 60 * 60


def make_job(root, run_id, *, age, result=True):
    job = root / 'jobs' / run_id
    job.mkdir(parents=True)
    for name in ('candidate.json', 'fact-candidate.json', 'sources.json', 'input.json'):
        (job / name).write_text('x' * 1000)
    (job / 'worker.log').write_text('log')
    stamp = time.time() - age
    if result:
        (job / 'result.json').write_text(json.dumps({'runId': run_id, 'status': 'failed'}))
        os.utime(job / 'result.json', (stamp, stamp))
    os.utime(job, (stamp, stamp))
    return job


def run_id(char):
    return (char * 8) + '-' + (char * 4) + '-' + (char * 4) + '-' + (char * 4) + '-' + (char * 12)


class JobPruningTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)

    def tearDown(self):
        self._temp.cleanup()

    def names(self, job):
        return sorted(p.name for p in job.iterdir())

    def test_finished_jobs_keep_only_result_and_log(self):
        old = make_job(self.root, run_id('a'), age=2 * DAY)
        self.assertEqual(prune_jobs(self.root), (1, 0))
        self.assertEqual(self.names(old), ['result.json', 'worker.log'])
        self.assertLess(time.time() - old.stat().st_mtime - 2 * DAY, 60)

    def test_live_rollback_running_and_recent_jobs_are_untouched(self):
        live = make_job(self.root, run_id('a'), age=10 * DAY)
        rollback = make_job(self.root, run_id('b'), age=40 * DAY)
        running = make_job(self.root, run_id('c'), age=2 * DAY, result=False)
        just_finished = make_job(self.root, run_id('d'), age=60)
        unfinished_today = make_job(self.root, run_id('e'), age=60 * 60, result=False)
        (self.root / 'active.json').write_text(json.dumps(
            {'catalogue': f'jobs/{run_id("a")}/fact-candidate.json', 'sources': f'jobs/{run_id("a")}/sources.json'}))
        (self.root / 'previous-active.json').write_text(json.dumps(
            {'catalogue': 'reviewed.json', 'sources': f'jobs/{run_id("b")}/sources.json'}))

        self.assertEqual(prune_jobs(self.root, protect=(run_id('c'),)), (0, 0))
        for job in (live, rollback, running, just_finished, unfinished_today):
            self.assertIn('candidate.json', self.names(job))

    def test_abandoned_jobs_are_trimmed_after_a_day(self):
        abandoned = make_job(self.root, run_id('a'), age=2 * DAY, result=False)
        self.assertEqual(prune_jobs(self.root), (1, 0))
        self.assertEqual(self.names(abandoned), ['worker.log'])

    def test_month_old_jobs_are_removed(self):
        ancient = make_job(self.root, run_id('a'), age=JOB_REMOVE_AFTER_SECONDS + DAY)
        self.assertEqual(prune_jobs(self.root), (0, 1))
        self.assertFalse(ancient.exists())

    def test_unreadable_pointer_prunes_nothing(self):
        job = make_job(self.root, run_id('a'), age=2 * DAY)
        (self.root / 'active.json').write_text('{broken')
        self.assertEqual(prune_jobs(self.root), (0, 0))
        self.assertIn('candidate.json', self.names(job))

    def test_limit_and_foreign_names(self):
        for char in 'abc':
            make_job(self.root, run_id(char), age=2 * DAY)
        (self.root / 'jobs' / 'not-a-run').mkdir()
        (self.root / 'jobs' / 'not-a-run' / 'keep.json').write_text('{}')
        self.assertEqual(prune_jobs(self.root, limit=2), (2, 0))
        self.assertEqual(prune_jobs(self.root, limit=2), (1, 0))
        self.assertTrue((self.root / 'jobs' / 'not-a-run' / 'keep.json').exists())

    def test_symlinked_job_contents_are_not_followed(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'precious.json').write_text('{}')
        job = make_job(self.root, run_id('a'), age=2 * DAY)
        (job / 'link').symlink_to(outside, target_is_directory=True)
        prune_jobs(self.root)
        self.assertTrue((outside / 'precious.json').exists())


if __name__ == '__main__':
    unittest.main()
