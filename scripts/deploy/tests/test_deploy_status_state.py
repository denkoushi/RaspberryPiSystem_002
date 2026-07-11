import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / 'deploy-status-state.py'


class DeployStatusStateTest(unittest.TestCase):
    def test_run_scoped_merge_failure_and_remove(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            def run(*args):
                subprocess.run(['python3', str(SCRIPT), '--file', str(path), *args], check=True)
            run('put', '--run-id', 'a', '--clients', 'one,two')
            run('put', '--run-id', 'b', '--clients', 'three')
            run('set-phase', '--run-id', 'a', '--phase', 'failed')
            data = json.loads(path.read_text())['kioskByClient']
            self.assertEqual(data['one']['phase'], 'failed')
            self.assertEqual(data['three']['phase'], 'preparing')
            run('remove-run', '--run-id', 'a')
            data = json.loads(path.read_text())['kioskByClient']
            self.assertEqual(set(data), {'three'})


if __name__ == '__main__':
    unittest.main()
