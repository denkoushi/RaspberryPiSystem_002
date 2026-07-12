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
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertEqual(result['components'], ['migration', 'server-app'])

    def test_client_only(self):
        result = impact.classify(['clients/nfc-agent/src/index.ts'])
        self.assertFalse(result['server'])
        self.assertTrue(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertEqual(result['components'], ['nfc-agent'])

    def test_web_only_is_server(self):
        result = impact.classify(['apps/web/src/pages/kiosk/KioskReturnPage.tsx'])
        self.assertTrue(result['server'])
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertFalse(result['migration'])
        self.assertEqual(result['components'], ['server-app'])

    def test_api_signage_path_is_server_only(self):
        result = impact.classify(['apps/api/src/routes/signage.ts'])
        self.assertTrue(result['server'])
        self.assertFalse(result['signage'])
        self.assertFalse(result['kiosk'])
        self.assertEqual(result['components'], ['server-app'])

    def test_barcode_agent_is_kiosk(self):
        result = impact.classify(['clients/barcode-agent/barcode_agent/main.py'])
        self.assertTrue(result['kiosk'])
        self.assertFalse(result['server'])
        self.assertFalse(result['signage'])
        self.assertEqual(result['components'], ['barcode-agent'])

    def test_status_agent_is_kiosk_and_signage(self):
        result = impact.classify(['clients/status-agent/status-agent.py'])
        self.assertTrue(result['kiosk'])
        self.assertTrue(result['signage'])
        self.assertFalse(result['server'])
        self.assertEqual(result['components'], ['status-agent'])

    def test_signage_role_is_signage_only(self):
        result = impact.classify(['infrastructure/ansible/roles/signage/tasks/main.yml'])
        self.assertTrue(result['signage'])
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['server'])
        self.assertEqual(result['components'], ['signage-role'])

    def test_unknown_path_fail_closed(self):
        result = impact.classify(['totally/unknown/path.txt'])
        self.assertTrue(result['server'])
        self.assertTrue(result['kiosk'])
        self.assertTrue(result['signage'])
        self.assertEqual(result['components'], ['unknown'])

    def test_prisma_migrations(self):
        result = impact.classify(['apps/api/prisma/migrations/20260106155657_add_signage_layout_config/migration.sql'])
        self.assertTrue(result['migration'])
        self.assertTrue(result['server'])
        self.assertFalse(result['signage'])
        self.assertEqual(result['components'], ['migration'])


if __name__ == '__main__':
    unittest.main()
