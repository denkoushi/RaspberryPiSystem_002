import contextlib
import io
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

    def test_preflight_only_is_public_and_rejects_ignored_execution_options(self):
        base = ("main", "infrastructure/ansible/inventory.yml", "--preflight-only")
        args = parse(*base, "--limit", "raspberrypi5:kiosk-a")
        self.assertTrue(args.preflight_only)
        self.assertEqual(args.limit, "raspberrypi5:kiosk-a")
        for extra in (
            ("--detach",),
            ("--print-plan",),
            ("--full-fleet",),
            ("--reverify-selected", "--limit", "kiosk-a"),
            ("--canary-hold-timeout", "10"),
            ("--emergency-override", "--reason", "incident"),
        ):
            with self.subTest(extra=extra), self.assertRaisesRegex(
                UsageError, "--preflight-only"
            ):
                parse(*base, *extra)

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

    def test_selected_reverification_requires_and_preserves_an_explicit_limit(self):
        args = parse(
            "main",
            "infrastructure/ansible/inventory.yml",
            "--limit",
            "raspberrypi5:stonebase-a",
            "--reverify-selected",
        )
        self.assertTrue(args.reverify_selected)
        self.assertEqual(args.limit, "raspberrypi5:stonebase-a")

        planned = parse(
            "main",
            "infrastructure/ansible/inventory.yml",
            "--limit",
            "stonebase-a",
            "--reverify-selected",
            "--print-plan",
        )
        self.assertTrue(planned.print_plan)
        self.assertTrue(planned.reverify_selected)

        with self.assertRaisesRegex(UsageError, "requires --limit"):
            parse(
                "main",
                "infrastructure/ansible/inventory.yml",
                "--reverify-selected",
            )

    def test_local_ansible_poc_requires_exact_pi5_and_stonebase_scope(self):
        exact_limit = "raspberrypi5:raspi4-kensaku-stonebase01"
        args = parse(
            "main",
            "infrastructure/ansible/inventory.yml",
            "--limit",
            exact_limit,
            "--stonebase-local-ansible-poc",
        )
        self.assertTrue(args.stonebase_local_ansible_poc)
        self.assertEqual(args.limit, exact_limit)
        for unsafe_limit in (
            "",
            "raspi4-kensaku-stonebase01",
            "raspberrypi5:kiosk",
            "raspberrypi5:raspi4-fjv60-80",
            exact_limit + ":raspi4-fjv60-80",
        ):
            arguments = [
                "main",
                "infrastructure/ansible/inventory.yml",
                "--stonebase-local-ansible-poc",
            ]
            if unsafe_limit:
                arguments.extend(["--limit", unsafe_limit])
            with self.subTest(limit=unsafe_limit), self.assertRaisesRegex(
                UsageError, "requires exact --limit"
            ):
                parse(*arguments)

    def test_removed_minimization_alias_exits_two(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                parse(
                    "main",
                    "infrastructure/ansible/inventory.yml",
                    "--auto-minimize",
                )
        self.assertEqual(raised.exception.code, 2)

    def test_help_exposes_only_the_current_public_option_set(self):
        help_text = parser().format_help()
        for retired in (
            "--auto-minimize",
            "--follow",
            "--foreground",
            "--profile",
            "--job",
            "--attach",
            "--client-only-compatible",
        ):
            with self.subTest(retired=retired):
                self.assertNotIn(retired, help_text)

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
            ("--status", "run-42", "--full-fleet"),
            ("--status", "run-42", "--reverify-selected"),
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
