"""The agent coverage guard runs before the release body, so its inputs must not depend on later facts.

The enabled-agent expression (release_kiosk_enabled_agent_services) reads three
variables, and the image re-read reads the Compose project and image names.
If any file the launcher or Ansible can load computed them with Jinja, the guard
and the body could disagree. This test covers:

* every git-tracked .yml/.yaml/.json under infrastructure/ansible (the launcher
  accepts any such .yml as an inventory), plus extensionless files in
  group_vars/host_vars; vault files are never opened and an unreadable file is
  a failure, not a skip;
* the three agent inputs and the Compose project name are Jinja-free literals
  wherever they appear (role defaults included); the release_kiosk_*_image
  names are literals everywhere except the role defaults;
* the release role, the release playbook and the two guard playbooks never
  define those inputs (set_fact, vars, include_vars);
* the enabled-agent expression reads exactly the three inputs (parsed with
  jinja2, not a regex), and the image re-read reads only allowed names.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml
from jinja2 import Environment, nodes
from jinja2.meta import find_undeclared_variables

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure" / "ansible"
AGENT_INPUTS = {"nfc_agent_client_id", "barcode_agent_enabled", "torque_agent_enabled"}
IMAGE_INPUTS = {"release_kiosk_nfc_image", "release_kiosk_barcode_image", "release_kiosk_torque_image"}
ALWAYS_LITERAL = AGENT_INPUTS | {"release_kiosk_compose_project"}
INPUTS = ALWAYS_LITERAL | IMAGE_INPUTS
ROLE_DEFAULTS = "infrastructure/ansible/roles/release_kiosk/defaults/main.yml"
NO_DEFINITION_FILES = (
    "infrastructure/ansible/roles/release_kiosk/",
    "infrastructure/ansible/playbooks/deploy-release-standard.yml",
    "infrastructure/ansible/playbooks/release-agent-coverage-check.yml",
    "infrastructure/ansible/playbooks/release-agent-images-read.yml",
)
INCLUDE_VARS = {"include_vars", "ansible.builtin.include_vars", "ansible.legacy.include_vars"}
# Names that Jinja or Ansible provide without any variable file.
BUILTINS = {"inventory_hostname", "ansible_playbook_python", "namespace", "range", "dict", "lipsum", "cycler", "joiner"}


class _Tagged:
    """A value with a YAML tag (for example !vault): not a literal."""


class _Loader(yaml.SafeLoader):
    pass


_Loader.add_multi_constructor("!", lambda loader, suffix, node: _Tagged())
_ENV = Environment()


def _is_variable_file(path: Path) -> bool:
    if "vault" in path.name:
        return False
    if path.suffix in {".yml", ".yaml", ".json"}:
        return True
    return path.suffix == "" and ("group_vars" in path.parts or "host_vars" in path.parts)


def _tracked_files() -> list[Path]:
    listed = subprocess.run(
        ["git", "ls-files", "--", "infrastructure/ansible"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout.splitlines()
    return [ROOT / name for name in sorted(listed) if _is_variable_file(Path(name))]


def _load(path: Path):
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        return json.loads(text)
    return yaml.load(text, Loader=_Loader)


def _walk(value, path, found):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in INPUTS:
                found.append((path + [key], item))
            _walk(item, path + [str(key)], found)
    elif isinstance(value, list):
        for item in value:
            _walk(item, path, found)


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _strings(key)
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _keys(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from _keys(item)
    elif isinstance(value, list):
        for item in value:
            yield from _keys(item)


def jinja_names(value) -> set[str]:
    """Variable names read by every Jinja expression in a YAML/JSON value."""
    names: set[str] = set()
    for text in _strings(value):
        if "{{" in text or "{%" in text or "{#" in text:
            tree = _ENV.parse(text)
            # Ansible's own filters and tests are unknown to plain jinja2; only the variable names matter here.
            for node in tree.find_all(nodes.Filter):
                _ENV.filters.setdefault(node.name, lambda value, *a, **k: value)
            for node in tree.find_all(nodes.Test):
                _ENV.tests.setdefault(node.name, lambda value, *a, **k: True)
            names |= find_undeclared_variables(tree)
    return names


def literal_problems(files: list[Path], root: Path) -> list[str]:
    """Return one message per input that is not a Jinja-free literal, or that cannot be read."""
    problems: list[str] = []
    for path in files:
        rel = path.relative_to(root).as_posix()
        try:
            document = _load(path)
        except Exception as error:  # an unreadable variable file is a failure, never a skip
            problems.append(f"{rel}: cannot be parsed ({type(error).__name__})")
            continue
        found: list = []
        _walk(document, [], found)
        for key_path, value in found:
            where = f"{rel}:{'.'.join(key_path)}"
            if key_path[-1] in IMAGE_INPUTS and rel == ROLE_DEFAULTS:
                continue
            if isinstance(value, bool) or isinstance(value, int):
                continue
            if not isinstance(value, str):
                problems.append(f"{where}: not a plain literal")
            elif "{{" in value or "{%" in value or "{#" in value:
                problems.append(f"{where}: contains Jinja")
    return problems


def definition_problems(files: list[Path], root: Path) -> list[str]:
    """The release role and guard playbooks must not define the inputs (role defaults excepted)."""
    problems: list[str] = []
    for path in files:
        rel = path.relative_to(root).as_posix()
        if rel == ROLE_DEFAULTS or not rel.startswith(NO_DEFINITION_FILES):
            continue
        document = _load(path)
        keys = set(map(str, _keys(document)))
        for name in sorted(keys & INPUTS):
            problems.append(f"{rel}: defines {name}")
        for name in sorted(keys & INCLUDE_VARS):
            problems.append(f"{rel}: uses {name}")
    return problems


class AgentGuardInputsAreLiteral(unittest.TestCase):
    def test_tracked_files_are_found(self) -> None:
        names = {path.relative_to(ROOT).as_posix() for path in _tracked_files()}
        self.assertIn("infrastructure/ansible/inventory.yml", names)
        self.assertIn("infrastructure/ansible/group_vars/staging.yml", names)
        self.assertIn(ROLE_DEFAULTS, names)
        self.assertFalse([name for name in names if "vault" in name])

    def test_inputs_have_no_jinja(self) -> None:
        self.assertEqual(literal_problems(_tracked_files(), ROOT), [])

    def test_inputs_are_not_defined_by_the_release_role_or_guard_playbooks(self) -> None:
        self.assertEqual(definition_problems(_tracked_files(), ROOT), [])

    def test_enabled_agent_expression_reads_only_the_three_inputs(self) -> None:
        text = (ANSIBLE / "roles/release_kiosk/vars/main.yml").read_text(encoding="utf-8")
        self.assertIn("scripts/ci/tests/test_agent_guard_inputs_literal.py", text)
        expression = yaml.safe_load(text)["release_kiosk_enabled_agent_services"]
        self.assertEqual(jinja_names(expression), AGENT_INPUTS)

    def test_image_read_inputs_do_not_depend_on_release_variables(self) -> None:
        defaults = yaml.safe_load((ANSIBLE / "roles/release_kiosk/defaults/main.yml").read_text(encoding="utf-8"))
        self.assertEqual(defaults["release_kiosk_compose_project"], "docker")
        self.assertEqual(defaults["release_sha"], "")
        # The image names may use only release_sha and the owner, never anything the release computes later.
        self.assertEqual(
            jinja_names([defaults[name] for name in sorted(IMAGE_INPUTS)]),
            {"raspisys_github_owner", "release_sha"},
        )
        allowed = set(defaults) | BUILTINS | {"release_agent_guard_out_dir"}
        for relative in ("roles/release_kiosk/tasks/agent_images.yml", "playbooks/release-agent-images-read.yml"):
            document = yaml.safe_load((ANSIBLE / relative).read_text(encoding="utf-8"))
            registered = {item for item in _registered(document)}
            unexpected = jinja_names(document) - allowed - registered
            self.assertEqual(unexpected, set(), relative)
            # Only the project and image names (not the release or its derived values) feed the read.
            read = jinja_names(document) & {name for name in defaults if name.startswith("release_")}
            self.assertLessEqual(read, ALWAYS_LITERAL | IMAGE_INPUTS | {"release_agent_guard_out_dir"}, relative)


def _registered(document) -> list[str]:
    found: list[str] = []
    if isinstance(document, dict):
        for key, item in document.items():
            if key == "register" and isinstance(item, str):
                found.append(item)
            found += _registered(item)
    elif isinstance(document, list):
        for item in document:
            found += _registered(item)
    return found


class TheChecksActuallyFail(unittest.TestCase):
    def _problems(self, relative: str, content: str, checker) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / relative
            path.parent.mkdir(parents=True)
            path.write_text(content, encoding="utf-8")
            return checker([path], root)

    def test_jinja_in_an_inventory_is_rejected(self) -> None:
        problems = self._problems(
            "infrastructure/ansible/inventory-x.yml",
            'all:\n  hosts:\n    h:\n      nfc_agent_client_id: "{{ inventory_hostname }}-kiosk1"\n',
            literal_problems,
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("contains Jinja", problems[0])

    def test_jinja_in_an_extensionless_host_vars_file_is_rejected(self) -> None:
        relative = "infrastructure/ansible/host_vars/h/main"
        self.assertTrue(_is_variable_file(Path(relative)))
        problems = self._problems(relative, "torque_agent_enabled: '{{ x }}'\n", literal_problems)
        self.assertEqual(len(problems), 1)

    def test_a_vault_file_is_never_opened(self) -> None:
        self.assertFalse(_is_variable_file(Path("infrastructure/ansible/host_vars/h/vault.yml")))

    def test_an_unparseable_file_is_a_failure(self) -> None:
        problems = self._problems("infrastructure/ansible/group_vars/all.yml", "a: [unclosed\n", literal_problems)
        self.assertEqual(len(problems), 1)
        self.assertIn("cannot be parsed", problems[0])

    def test_an_image_input_is_only_allowed_in_role_defaults(self) -> None:
        text = 'release_kiosk_nfc_image: "x:{{ release_sha }}"\n'
        self.assertEqual(len(self._problems("infrastructure/ansible/group_vars/all.yml", text, literal_problems)), 1)
        self.assertEqual(self._problems(ROLE_DEFAULTS, text, literal_problems), [])

    def test_defining_an_input_in_the_release_role_is_rejected(self) -> None:
        text = "- ansible.builtin.set_fact:\n    torque_agent_enabled: true\n"
        problems = self._problems("infrastructure/ansible/roles/release_kiosk/tasks/x.yml", text, definition_problems)
        self.assertEqual(problems, ["infrastructure/ansible/roles/release_kiosk/tasks/x.yml: defines torque_agent_enabled"])
        text = "- ansible.builtin.include_vars: other.yml\n"
        self.assertEqual(
            len(self._problems("infrastructure/ansible/playbooks/release-agent-coverage-check.yml", text, definition_problems)), 1
        )

    def test_jinja_names_are_parsed_not_matched(self) -> None:
        self.assertEqual(jinja_names("{{ a | default(b) }} {% if c %}{{ d }}{% endif %}"), {"a", "b", "c", "d"})
        self.assertEqual(jinja_names("{% set x = 1 %}{{ x }}"), set())


if __name__ == "__main__":
    unittest.main()
