from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class GenerateAlertTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.project = Path(directory.name)
        (self.project / 'scripts').mkdir()
        self.script = self.project / 'scripts/generate-alert.sh'
        shutil.copyfile(ROOT / 'scripts/generate-alert.sh', self.script)
        # Fix both date formats so the collision test never depends on wall-clock timing.
        bin_dir = self.project / 'bin'
        bin_dir.mkdir()
        date = bin_dir / 'date'
        date.write_text('''#!/bin/bash
if [[ "$1" == +%Y%m%d-%H%M%S ]]; then
  echo 20261029-023000
else
  echo 2026-10-29T02:30:00Z
fi
''')
        date.chmod(0o755)
        self.environment = {'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'WEBHOOK_URL': ''}

    def generate(self, alert_type, message, details):
        result = subprocess.run(['bash', str(self.script), alert_type, message, details],
                                env=self.environment, check=True, capture_output=True, text=True, timeout=10)
        lines = result.stdout.splitlines()
        self.assertEqual(len(lines), 2)
        path = Path(lines[1])
        self.assertEqual(lines[0], f'[INFO] Alert file created: {path}')
        data = json.loads(path.read_text())
        self.assertEqual(path.name, f'alert-{data["id"]}.json')
        self.assertEqual(data, {
            'id': data['id'], 'type': alert_type, 'message': message, 'details': details,
            'timestamp': '2026-10-29T02:30:00Z', 'acknowledged': False})
        return path, data

    def test_multiline_json_and_same_second_alerts_preserve_all_fields(self):
        details = '差分 "quoted"\tタブ\\path\n第二行\r\n最後の行\n'
        paths = []
        for index in range(3):
            path, data = self.generate('test"\ttype', '通知\n"message"', details)
            suffix = '' if index == 0 else f'-{index + 1}'
            self.assertEqual(data['id'], f'20261029-023000{suffix}')
            paths.append(path)
        self.assertEqual(set(paths), set((self.project / 'alerts').glob('alert-*.json')))
        self.assertEqual(len(set(paths)), 3)
        for path in paths:
            self.assertEqual(json.loads(path.read_text())['details'], details)

    def test_simultaneous_alerts_do_not_overwrite_each_other(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda index: self.generate('test', '通知', str(index)), range(4)))
        self.assertEqual(len({data['id'] for _, data in results}), 4)
        files = list((self.project / 'alerts').glob('alert-*.json'))
        self.assertEqual(len(files), 4)
        self.assertEqual({json.loads(path.read_text())['details'] for path in files}, {'0', '1', '2', '3'})


if __name__ == '__main__':
    unittest.main()
