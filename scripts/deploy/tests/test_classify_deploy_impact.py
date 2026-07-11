import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / 'classify-deploy-impact.py'
spec = importlib.util.spec_from_file_location('impact', SCRIPT)
impact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(impact)


class ClassifyDeployImpactTest(unittest.TestCase):
    def test_server_and_migration(self):
        result = impact.classify(['apps/api/src/index.ts', 'apps/api/prisma/migrations/x/migration.sql'])
        self.assertTrue(result['server'])
        self.assertTrue(result['migration'])

    def test_client_only(self):
        result = impact.classify(['clients/nfc-agent/src/index.ts'])
        self.assertFalse(result['server'])
        self.assertTrue(result['kiosk'])


if __name__ == '__main__':
    unittest.main()
