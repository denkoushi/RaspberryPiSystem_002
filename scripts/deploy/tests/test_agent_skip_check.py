from __future__ import annotations

import importlib.util
import io
import json
import subprocess
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("agent_skip_check", ROOT / "scripts/deploy/agent_skip_check.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

S = "a" * 40
T = "b" * 40
INV = "infrastructure/ansible/inventory.yml"


def report(host: str, agent: str = "barcode-agent", tag: str = T, status: str = "running", count: int = 1) -> dict:
    image = f"ghcr.io/o/raspisys-{agent}:{tag}"
    containers = {name: [] for name in MODULE.AGENTS}
    containers[agent] = [{"image": image, "status": status}] * count
    return {
        "host": host, "project": "docker", "containers": containers,
        "expectedImages": {name: f"ghcr.io/o/raspisys-{name}" for name in MODULE.AGENTS},
    }


class Fake:
    def __init__(self, **overrides: object) -> None:
        self.o = overrides
        self.commands: list[list[str]] = []

    def __call__(self, command):
        command = list(command)
        self.commands.append(command)
        # git diff --name-only -z separates paths with NUL; the tests write them one per line.
        nul = "-z" in command
        done = lambda out="", code=0: subprocess.CompletedProcess(  # noqa: E731
            command, code, out.replace("\n", "\0") if nul else out, ""
        )
        if command[:2] == ["git", "rev-parse"]:
            return done(self.o.get("head", S) + "\n")
        if command[:2] == ["git", "status"]:
            return done(self.o.get("status", ""))
        if command[0].endswith("update-all-clients.sh"):
            return done(
                self.o.get("images", json.dumps({"hosts": [report("pi4-a"), report("pi4-b", "nfc-agent")]})),
                self.o.get("images_code", 0),
            )
        if command[:3] == ["git", "cat-file", "-e"]:
            return done(code=1 if command[3].split(":")[0] in self.o.get("untracked_at", ()) else 0)
        if command[:2] == ["git", "merge-base"]:
            return done(code=self.o.get("ancestor", 0))
        if command[1].endswith("classify_event_changes.py"):
            base = {"pi4AgentServices": [], "failClosedReasons": [], "torqueComposition": False}
            merged = {**base, **self.o.get("classify", {})}
            return done(json.dumps({k: v for k, v in merged.items() if k not in self.o.get("drop", ())}))
        if command[:3] == ["git", "diff", "--name-only"] and "--" in command:
            return done(self.o.get("config", ""), self.o.get("config_code", 0))
        if command[:3] == ["git", "diff", "--name-only"]:
            if self.o.get("changed_code"):
                return done("", self.o["changed_code"])
            return done(self.o.get("changed", "apps/web/src/barcode/useBarcode.ts\napps/web/src/nfc/x.ts\nREADME.md\n"))
        raise AssertionError(command)


def run_main(fake: Fake, *pairs: str) -> tuple[int, str]:
    out = io.StringIO()
    with redirect_stdout(out), redirect_stderr(io.StringIO()):
        code = MODULE.main(["--sha", S, "--inventory", INV, *pairs], fake)
    return code, out.getvalue()


class AgentSkipCheckTests(unittest.TestCase):
    def test_pass_lists_candidates_and_one_spec_line_for_all_pairs(self) -> None:
        code, text = run_main(Fake(), "pi4-a:barcode-agent", "pi4-b:nfc-agent")
        self.assertEqual(code, 0)
        self.assertIn("steps 5 and 6 await a human", text)
        self.assertIn("step 5 candidate: apps/web/src/barcode/useBarcode.ts", text)
        self.assertNotIn("README.md", text)
        self.assertEqual(
            text.splitlines()[-1],
            f"--allow-agent-skip-sha {S} --allow-agent-skip pi4-a:barcode-agent:{T}:docker,pi4-b:nfc-agent:{T}:docker",
        )

    def _assert_refused(self, fake: Fake, *pairs: str, expect_pairs_only: bool = False) -> str:
        code, text = run_main(fake, *(pairs or ("pi4-a:barcode-agent",)))
        self.assertNotEqual(code, 0)
        self.assertNotIn("--allow-agent-skip", text)
        return text

    def test_checkout_must_be_the_release_sha_and_clean(self) -> None:
        self.assertIn("not judged", self._assert_refused(Fake(head="c" * 40)))
        text = self._assert_refused(Fake(status=" M scripts/x.py\n?? stray.txt\n"))
        self.assertIn("scripts/x.py", text)
        self.assertIn("stray.txt", text)

    def test_unreadable_or_unusable_containers_are_refused(self) -> None:
        for images in (
            "not json",
            json.dumps({"hosts": [{"host": "pi4-a", "readable": False}]}),
            json.dumps({"hosts": [report("pi4-a", count=2)]}),
            json.dumps({"hosts": [report("pi4-a", count=0)]}),
            json.dumps({"hosts": [report("pi4-a", status="exited")]}),
            json.dumps({"hosts": [report("pi4-a", tag="latest")]}),
        ):
            self.assertIn("付けてはいけない", self._assert_refused(Fake(images=images)))

    def test_a_non_zero_image_read_is_refused_even_with_complete_json(self) -> None:
        text = self._assert_refused(Fake(images_code=3))
        self.assertIn("付けてはいけない", text)
        self.assertIn("exited with code 3", text)

    def test_history_and_classification_failures_are_refused(self) -> None:
        for fake in (
            Fake(ancestor=1),
            Fake(classify={"pi4AgentServices": ["barcode-agent"]}),
            Fake(classify={"failClosedReasons": ["ci.yml changed"]}),
            Fake(config="infrastructure/ansible/group_vars/all.yml\n"),
            Fake(config_code=128),
        ):
            self.assertIn("付けてはいけない", self._assert_refused(fake))

    def test_inventory_is_normalized_like_the_launcher_and_must_be_tracked_at_both_versions(self) -> None:
        fake = Fake()
        code, _ = run_main(fake, "pi4-a:barcode-agent")
        self.assertEqual(code, 0)
        self.assertIn(["git", "cat-file", "-e", f"{T}:{INV}"], fake.commands)
        self.assertIn(["git", "cat-file", "-e", f"{S}:{INV}"], fake.commands)
        for missing in ({T}, {S}):
            self.assertIn("付けてはいけない", self._assert_refused(Fake(untracked_at=missing)))
        # An absolute path and a relative one name the same file; others are refused before any judgment.
        fake = Fake()
        out = io.StringIO()
        with redirect_stdout(out), redirect_stderr(io.StringIO()):
            self.assertEqual(MODULE.main(["--sha", S, "--inventory", str(ROOT / INV), "pi4-a:barcode-agent"], fake), 0)
        self.assertIn(INV, next(c for c in fake.commands if c[0].endswith("update-all-clients.sh")))
        for bad in ("README.md", "infrastructure/ansible/missing.yml", "../etc/passwd.yml"):
            fake = Fake()
            with redirect_stdout(out), redirect_stderr(io.StringIO()):
                self.assertEqual(MODULE.main(["--sha", S, "--inventory", bad, "pi4-a:barcode-agent"], fake), 2)
            self.assertEqual(fake.commands, [])

    def test_nested_inventory_directory_config_is_part_of_the_diff(self) -> None:
        nested = "infrastructure/ansible/staging/inventory.yml"
        fake = Fake()
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            MODULE.main(["--sha", S, "--inventory", str(ROOT / INV), "pi4-a:barcode-agent"], fake)
        plain = next(c for c in fake.commands if c[:3] == ["git", "diff", "--name-only"] and "--" in c)
        self.assertEqual(plain[plain.index("--") + 1:], [INV, *MODULE.CONFIG_PATHS])
        class NestedOnly(Fake):
            """Report a changed file only when the diff names the nested group_vars directory."""

            def __call__(self, command):
                command = list(command)
                if command[:3] == ["git", "diff", "--name-only"] and "--" in command:
                    self.commands.append(command)
                    hit = "infrastructure/ansible/staging/group_vars" in command
                    return subprocess.CompletedProcess(
                        command, 0, "infrastructure/ansible/staging/group_vars/staging.yml\0" if hit else "", ""
                    )
                return super().__call__(command)

        fake = NestedOnly()
        verdict = MODULE.judge(MODULE.Pair("pi4-a", "barcode-agent"), T, "docker", S, nested, fake)
        diff = next(c for c in fake.commands if c[:3] == ["git", "diff", "--name-only"] and "--" in c)
        self.assertIn("infrastructure/ansible/staging/group_vars", diff)
        self.assertIn("infrastructure/ansible/staging/host_vars", diff)
        self.assertFalse(verdict.ok)
        self.assertIn("configuration changed", verdict.reason)

    def test_playbook_directory_variables_are_part_of_the_config_diff(self) -> None:
        for directory in ("group_vars", "host_vars"):
            changed = f"infrastructure/ansible/playbooks/{directory}/all.yml"

            class OnlyThisDirectory(Fake):
                def __call__(self, command):
                    command = list(command)
                    if command[:3] == ["git", "diff", "--name-only"] and "--" in command:
                        self.commands.append(command)
                        hit = f"infrastructure/ansible/playbooks/{directory}" in command
                        return subprocess.CompletedProcess(command, 0, changed + "\0" if hit else "", "")
                    return super().__call__(command)

            code, text = run_main(OnlyThisDirectory(), "pi4-a:barcode-agent")
            self.assertEqual(code, 1, directory)
            self.assertIn("configuration changed", text)
            self.assertIn(changed, text)

    def test_container_entries_that_are_not_objects_are_unreadable_not_an_exception(self) -> None:
        for bad in ("text", 3, None, ["x"]):
            document = report("pi4-a")
            document["containers"]["barcode-agent"] = [bad]
            self.assertIn("付けてはいけない", self._assert_refused(Fake(images=json.dumps({"hosts": [document]}))))
        document = report("pi4-a")
        document["containers"]["barcode-agent"] = 5
        self.assertIn("付けてはいけない", self._assert_refused(Fake(images=json.dumps({"hosts": [document]}))))

    def test_paths_with_spaces_are_kept_whole(self) -> None:
        changed = "apps/web/src/barcode/my scanner.ts\nREADME.md\n"
        code, text = run_main(Fake(changed=changed), "pi4-a:barcode-agent")
        self.assertEqual(code, 0)
        self.assertIn("step 5 candidate: apps/web/src/barcode/my scanner.ts", text)
        text = self._assert_refused(Fake(config="infrastructure/ansible/group_vars/my file.yml\n"))
        self.assertIn("infrastructure/ansible/group_vars/my file.yml", text)
        self.assertEqual(MODULE.split_nul("a b\0c\0"), ["a b", "c"])

    def test_step5_candidates_ignore_case_and_a_failed_diff_fails_the_pair(self) -> None:
        code, text = run_main(Fake(changed="apps/web/src/Barcode/Scanner.ts\nNFC.md\n"), "pi4-a:barcode-agent")
        self.assertEqual(code, 0)
        self.assertIn("step 5 candidate: apps/web/src/Barcode/Scanner.ts", text)
        self.assertNotIn("NFC.md", text)
        self.assertIn("差分が取れない", self._assert_refused(Fake(changed_code=128)))

    def test_torque_composition_only_blocks_torque(self) -> None:
        images = json.dumps({"hosts": [report("pi4-a", "torque-agent")]})
        self.assertIn("torque", self._assert_refused(Fake(images=images, classify={"torqueComposition": True}), "pi4-a:torque-agent"))
        code, _ = run_main(Fake(classify={"torqueComposition": True}), "pi4-a:barcode-agent")
        self.assertEqual(code, 0)

    def test_a_classification_missing_a_key_is_refused_as_unreadable(self) -> None:
        for key in ("torqueComposition", "failClosedReasons", "pi4AgentServices"):
            text = self._assert_refused(Fake(drop=(key,)))
            self.assertIn("付けてはいけない", text, key)
            self.assertIn("could not be read", text, key)

    def test_a_classification_value_of_the_wrong_type_is_refused_as_unreadable(self) -> None:
        for key, value in (("failClosedReasons", None), ("pi4AgentServices", 3), ("torqueComposition", "false")):
            text = self._assert_refused(Fake(classify={key: value}))
            self.assertIn("付けてはいけない", text, key)
            self.assertIn("could not be read", text, key)

    def test_a_command_that_does_not_return_in_time_counts_as_failed(self) -> None:
        original = MODULE.COMMAND_TIMEOUT_SECONDS
        MODULE.COMMAND_TIMEOUT_SECONDS = 0.2
        self.addCleanup(setattr, MODULE, "COMMAND_TIMEOUT_SECONDS", original)
        result = MODULE.default_runner(["sleep", "5"])
        self.assertEqual(result.returncode, 124)
        self.assertEqual(result.stdout, "")

    def test_one_failing_pair_withholds_the_spec_line(self) -> None:
        images = json.dumps({"hosts": [report("pi4-a"), report("pi4-b", "nfc-agent", status="exited")]})
        text = self._assert_refused(Fake(images=images), "pi4-a:barcode-agent", "pi4-b:nfc-agent")
        self.assertIn("pi4-a:barcode-agent: steps 1-4 pass", text)
        self.assertIn("pi4-b:nfc-agent: 付けてはいけない", text)

    def test_bad_input_is_rejected(self) -> None:
        for argv in (["--sha", "abc", "--inventory", INV, "pi4-a:nfc-agent"], ["--sha", S, "--inventory", INV, "pi4-a:other"]):
            out = io.StringIO()
            with redirect_stdout(out), redirect_stderr(io.StringIO()):
                self.assertEqual(MODULE.main(argv, Fake()), 2)


if __name__ == "__main__":
    unittest.main()
