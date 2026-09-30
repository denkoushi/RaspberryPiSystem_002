import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[3]
GROUP_VARS = ROOT / "infrastructure/ansible/group_vars/all.yml"
WRAPPER = ROOT / "scripts/server/run-in-active-api.sh"
SERVICE_TEMPLATES = {
    "monthly": ROOT / "infrastructure/ansible/templates/backup-verify-monthly.service.j2",
    "quarterly": ROOT / "infrastructure/ansible/templates/backup-verify-quarterly.service.j2",
}


def group_var(name: str) -> str:
    match = re.search(rf'^{name}:\s*"([^"]+)"\s*$', GROUP_VARS.read_text(encoding="utf-8"), re.M)
    if match is None:
        raise AssertionError(f"{name} is not defined")
    return match.group(1)


class BackupVerifyUnitTests(unittest.TestCase):
    def test_calendars_select_the_first_sunday_not_only_sunday_the_first(self) -> None:
        # "Sun *-*-01" matches only months whose 1st is a Sunday (2-3 times a year).
        self.assertEqual(group_var("backup_verify_monthly_oncalendar"), "Sun *-*-01..07 03:30:00")
        self.assertEqual(
            group_var("backup_verify_quarterly_oncalendar"), "Sun *-01,04,07,10-01..07 04:00:00"
        )

    def test_services_run_inside_the_active_blue_green_api(self) -> None:
        for mode, template in SERVICE_TEMPLATES.items():
            with self.subTest(mode=mode):
                text = template.read_text(encoding="utf-8")
                self.assertNotIn("docker-compose.server.yml exec -T api ", text)
                self.assertIn(
                    "ExecStart={{ project_root }}/scripts/server/run-in-active-api.sh node "
                    "/app/apps/api/dist/scripts/verify-backups.js "
                    f"--mode={mode} ",
                    text,
                )
                self.assertIn("Environment=PROJECT_DIR={{ project_root }}", text)

    def test_wrapper_resolves_the_slot_from_the_canonical_gateway(self) -> None:
        text = WRAPPER.read_text(encoding="utf-8")
        self.assertTrue(WRAPPER.stat().st_mode & 0o111, "wrapper must be executable")
        self.assertIn('ACTIVE_API_RESOLVER="${PROJECT_DIR}/scripts/server/resolve-active-backup-api.py"', text)
        self.assertIn("api-blue|api-green) ;;", text)
        self.assertIn('exec -T "${ACTIVE_API_SERVICE}" "$@"', text)


if __name__ == "__main__":
    unittest.main()
