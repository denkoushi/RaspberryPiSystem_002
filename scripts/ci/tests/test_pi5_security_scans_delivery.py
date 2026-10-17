from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[3]
DELIVERY_PLAYBOOK = ROOT / 'infrastructure/ansible/playbooks/prepare-pi5-security-scans.yml'
SERVER_TASKS = ROOT / 'infrastructure/ansible/roles/server/tasks'


class Pi5SecurityScansDeliveryTest(unittest.TestCase):
    def test_delivery_playbook_applies_only_malware_tasks_to_pi5(self):
        delivery = DELIVERY_PLAYBOOK.read_text()
        self.assertRegex(delivery, r'hosts:\s*raspberrypi5\n')
        self.assertIn('tasks_from: malware.yml', delivery)
        self.assertEqual(delivery.count('tasks_from:'), 1)
        self.assertNotIn('server_release_mode', delivery)

    def test_standard_release_still_skips_malware_tasks(self):
        self.assertRegex(
            (SERVER_TASKS / 'main.yml').read_text(),
            r"import_tasks: malware\.yml\n\s+when: server_release_mode == 'full'")
        self.assertNotIn('server_release_mode', (SERVER_TASKS / 'malware.yml').read_text())


if __name__ == '__main__':
    unittest.main()
