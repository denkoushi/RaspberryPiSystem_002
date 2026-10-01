import pathlib
import unittest

import yaml


ROOT = pathlib.Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"
ASSERT_MODULES = ("ansible.builtin.assert", "assert")
BLOCK_KEYS = ("block", "rescue", "always", "tasks", "pre_tasks", "post_tasks", "handlers")


def iter_tasks(node):
    if isinstance(node, list):
        for item in node:
            yield from iter_tasks(item)
    elif isinstance(node, dict):
        yield node
        for key in BLOCK_KEYS:
            if key in node:
                yield from iter_tasks(node[key])


def task_files():
    for pattern in ("playbooks/*.yml", "tasks/*.yml", "roles/*/tasks/*.yml", "roles/*/handlers/*.yml"):
        yield from sorted(ANSIBLE.glob(pattern))


class TaskKeywordPlacementTests(unittest.TestCase):
    def test_no_log_is_a_task_keyword_not_an_assert_argument(self) -> None:
        # ansible-core 2.19 rejects unknown module arguments, so `no_log` indented
        # under `assert:` stops the play at that task instead of hiding output.
        offenders = []
        for path in task_files():
            try:
                document = yaml.safe_load(path.read_text(encoding="utf-8"))
            except yaml.YAMLError:
                continue  # vault-tagged or templated files are covered by ansible syntax checks
            for task in iter_tasks(document):
                for module in ASSERT_MODULES:
                    arguments = task.get(module)
                    if isinstance(arguments, dict) and "no_log" in arguments:
                        offenders.append(f"{path.relative_to(ROOT)}: {task.get('name', '<unnamed>')}")
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
