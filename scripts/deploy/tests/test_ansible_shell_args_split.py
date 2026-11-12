"""Ansible must be able to split every free-form shell/command task argument.

Dynamic include_tasks are not parsed by ansible-playbook --syntax-check, so an
unbalanced quote (for example an apostrophe in a heredoc comment) only fails
on the device. This test parses every role task file the same way Ansible does.
"""
from __future__ import annotations

import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
ROLES = ROOT / 'infrastructure/ansible/roles'
FREE_FORM_MODULES = {
    'shell', 'command', 'ansible.builtin.shell', 'ansible.builtin.command',
}


def _free_form_arguments(node, path):
    if isinstance(node, list):
        for item in node:
            yield from _free_form_arguments(item, path)
    elif isinstance(node, dict):
        for key, value in node.items():
            if key in FREE_FORM_MODULES and isinstance(value, str):
                yield path, node.get('name', key), value
            else:
                yield from _free_form_arguments(value, path)


class AnsibleShellArgsSplitTest(unittest.TestCase):
    def test_every_free_form_shell_argument_splits(self):
        from ansible.parsing.splitter import split_args

        checked = 0
        for path in sorted(ROLES.glob('*/tasks/*.yml')):
            tasks = yaml.safe_load(path.read_text())
            for file_path, name, argument in _free_form_arguments(tasks, path):
                checked += 1
                with self.subTest(file=str(file_path.relative_to(ROOT)), task=name):
                    split_args(argument)
        self.assertGreater(checked, 0)


if __name__ == '__main__':
    unittest.main()
