import sys
import unittest
from pathlib import Path


DEPLOY_DIRECTORY = Path(__file__).parents[1]
if str(DEPLOY_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIRECTORY))

from rolling_release.cli import UsageError, normalize_arguments, parser


def parse(*arguments: str):
    return normalize_arguments(parser().parse_args(list(arguments)))


class RollingReleaseCliContractTest(unittest.TestCase):
    def test_retained_release_and_control_commands(self):
        release = parse(
            "main",
            "infrastructure/ansible/inventory.yml",
            "--limit",
            "kiosk:&site_a",
            "--detach",
        )
        self.assertEqual(release.branch, "main")
        self.assertTrue(release.detach)
        self.assertEqual(release.limit, "kiosk:&site_a")

        self.assertEqual(parse("--status", "run-42").status, "run-42")
        self.assertEqual(parse("--approve", "run-42").approve, "run-42")
        cancelled = parse("--cancel", "run-42", "--reason", "operator requested safe stop")
        self.assertEqual(cancelled.reason, "operator requested safe stop")

    def test_dry_run_remains_a_print_plan_alias(self):
        args = parse("main", "infrastructure/ansible/inventory.yml", "--dry-run")
        self.assertTrue(args.print_plan)

    def test_full_fleet_is_explicit_and_excludes_narrowing_options(self):
        args = parse("main", "infrastructure/ansible/inventory.yml", "--full-fleet")
        self.assertTrue(args.full_fleet)
        with self.assertRaisesRegex(UsageError, "--limit"):
            parse(
                "main",
                "infrastructure/ansible/inventory.yml",
                "--full-fleet",
                "--limit",
                "kiosk",
            )
        with self.assertRaisesRegex(UsageError, "auto-minimize"):
            parse(
                "main",
                "infrastructure/ansible/inventory.yml",
                "--full-fleet",
                "--auto-minimize",
            )

    def test_retired_options_exit_contract_names_a_replacement(self):
        cases = (
            (("--follow",), "--status RUN_ID"),
            (("--foreground",), "omit it"),
            (("--profile",), "systemd timing"),
            (("--job",), "--detach"),
            (("--attach", "run-42"), "--status RUN_ID"),
            (("--client-only-compatible",), "--limit PATTERN"),
        )
        for option, replacement in cases:
            with self.subTest(option=option):
                with self.assertRaisesRegex(UsageError, replacement):
                    parse("main", "infrastructure/ansible/inventory.yml", *option)

    def test_skip_canary_hold_requires_a_reasoned_emergency_override(self):
        base = ("main", "infrastructure/ansible/inventory.yml", "--skip-canary-hold")
        with self.assertRaisesRegex(UsageError, "requires --emergency-override --reason"):
            parse(*base)
        with self.assertRaisesRegex(UsageError, "requires --reason"):
            parse(*base, "--emergency-override")

        args = parse(
            *base,
            "--emergency-override",
            "--reason",
            "approved incident response",
        )
        self.assertTrue(args.skip_canary_hold)

    def test_control_actions_are_exclusive_and_do_not_accept_release_args(self):
        with self.assertRaisesRegex(UsageError, "mutually exclusive"):
            parse("--status", "run-42", "--cancel", "run-42", "--reason", "stop")
        with self.assertRaisesRegex(UsageError, "cannot be combined"):
            parse("main", "inventory.yml", "--status", "run-42")
        cases = (
            ("--status", "run-42", "--limit", "kiosk"),
            ("--status", "run-42", "--sha", "a" * 40),
            ("--approve", "run-42", "--auto-minimize"),
            ("--status", "run-42", "--full-fleet"),
            ("--status", "run-42", "--canary-hold-timeout", "1800"),
            (
                "--cancel",
                "run-42",
                "--reason",
                "safe stop",
                "--emergency-override",
            ),
        )
        for arguments in cases:
            with self.subTest(arguments=arguments), self.assertRaisesRegex(
                UsageError, "cannot be combined"
            ):
                parse(*arguments)

    def test_print_plan_rejects_execution_modes_it_would_ignore(self):
        base = ("main", "infrastructure/ansible/inventory.yml", "--print-plan")
        with self.assertRaisesRegex(UsageError, "--detach"):
            parse(*base, "--detach")
        with self.assertRaisesRegex(UsageError, "execution override"):
            parse(*base, "--emergency-override", "--reason", "incident")

    def test_run_id_and_untrusted_text_are_rejected_before_execution(self):
        invalid = ("../run", "run.service", "run/other", "a", "run;shutdown")
        for run_id in invalid:
            with self.subTest(run_id=run_id):
                with self.assertRaisesRegex(UsageError, "run ID"):
                    parse("--status", run_id)
        with self.assertRaisesRegex(UsageError, "control characters"):
            parse("--cancel", "run-42", "--reason", "stop\nnow")

    def test_remote_run_requires_immutable_identity(self):
        with self.assertRaisesRegex(UsageError, "full lowercase release SHA"):
            parse(
                "--remote-run",
                "--branch",
                "main",
                "--inventory",
                "inventory.yml",
                "--sha",
                "main",
                "--run-id",
                "run-42",
            )
        args = parse(
            "--remote-run",
            "--branch",
            "main",
            "--inventory",
            "inventory.yml",
            "--sha",
            "a" * 40,
            "--run-id",
            "run-42",
            "--expected-server-client-id",
            "raspberrypi5-server",
        )
        self.assertTrue(args.remote_run)


if __name__ == "__main__":
    unittest.main()
