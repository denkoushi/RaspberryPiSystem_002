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
import posixpath
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any

import yaml
from jinja2 import Environment, nodes
from jinja2.meta import find_undeclared_variables

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure" / "ansible"
AGENT_INPUTS = {"nfc_agent_client_id", "barcode_agent_enabled", "torque_agent_enabled"}
IMAGE_INPUTS = {"release_kiosk_nfc_image", "release_kiosk_barcode_image", "release_kiosk_torque_image"}
ALWAYS_LITERAL = AGENT_INPUTS | {"release_kiosk_compose_project"}
# release_kiosk_enabled_agent_services is derived from the three agent inputs; only the role's vars/main.yml defines it.
ENABLED_SERVICES = "release_kiosk_enabled_agent_services"
ROLE_VARS = "infrastructure/ansible/roles/release_kiosk/vars/main.yml"
INPUTS = ALWAYS_LITERAL | IMAGE_INPUTS | {ENABLED_SERVICES}
ROLE_DEFAULTS = "infrastructure/ansible/roles/release_kiosk/defaults/main.yml"
BODY_PLAYBOOK = "infrastructure/ansible/playbooks/deploy-release-standard.yml"
ROLE_MODULES = {
    f"{prefix}{name}" for prefix in ("", "ansible.builtin.", "ansible.legacy.") for name in ("import_role", "include_role")
}
ROLE_DIRECTORIES = {"vars", "defaults", "tasks", "handlers", "meta"}
_STATIC_NO_DEFINITION_FILES = (
    "infrastructure/ansible/roles/release_kiosk/",
    BODY_PLAYBOOK,
    "infrastructure/ansible/playbooks/release-agent-coverage-check.yml",
    "infrastructure/ansible/playbooks/release-agent-images-read.yml",
)
INCLUDE_VARS = {"include_vars", "ansible.builtin.include_vars", "ansible.legacy.include_vars"}
# include_vars calls that are allowed: the task file must contain exactly one include_vars (at any depth,
# block/rescue/always included), and its file expression must match exactly. Value: (expression, loaded file).
ALLOWED_INCLUDE_VARS = {
    "infrastructure/ansible/roles/pi5_storage/tasks/main.yml": (
        "{{ role_path }}/../../vars/pi5-storage-contract.yml",
        "infrastructure/ansible/vars/pi5-storage-contract.yml",
    ),
}
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
    if path.suffix != "":
        return False
    # Ansible also reads extensionless files: group_vars/host_vars, and a role's vars/defaults/tasks/... main.
    return (
        "group_vars" in path.parts or "host_vars" in path.parts
        or ("roles" in path.parts and bool(ROLE_DIRECTORIES & set(path.parts)))
    )


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
            if key_path[-1] == ENABLED_SERVICES and rel == ROLE_VARS:
                continue
            if isinstance(value, bool) or isinstance(value, int):
                continue
            if not isinstance(value, str):
                problems.append(f"{where}: not a plain literal")
            elif "{{" in value or "{%" in value or "{#" in value:
                problems.append(f"{where}: contains Jinja")
    return problems


ANSIBLE_REL = "infrastructure/ansible"
ROLES_REL = f"{ANSIBLE_REL}/roles"
EXTERNAL_TASKS_REL = f"{ANSIBLE_REL}/tasks/"
GUARD_PLAYBOOKS = (
    "infrastructure/ansible/playbooks/release-agent-coverage-check.yml",
    "infrastructure/ansible/playbooks/release-agent-images-read.yml",
)
TASK_INCLUDE_MODULES = {
    f"{prefix}{name}" for prefix in ("", "ansible.builtin.", "ansible.legacy.") for name in ("include_tasks", "import_tasks")
}
ACTION_KEYS = {"action", "local_action"}
SET_FACT = {f"{prefix}set_fact" for prefix in ("", "ansible.builtin.", "ansible.legacy.")}
_JINJA = ("{{", "{%", "{#")
_ROLE_PATH = re.compile(r"^\{\{\s*role_path\s*\}\}/(.+)$")
_PLAYBOOK_DIR = re.compile(r"^\{\{\s*playbook_dir\s*\}\}/(.+)$")


def _has_jinja(text: str) -> bool:
    return any(marker in text for marker in _JINJA)


def _action_module(item) -> str | None:
    """The module named by an action:/local_action: value (string form or dict form)."""
    if isinstance(item, str):
        parts = item.split()
        return parts[0] if parts else None
    if isinstance(item, dict) and isinstance(item.get("module"), str):
        return item["module"]
    return None


def _role_entry(entry):
    """(name, None) for a usable role entry, (None, text) for one that cannot be resolved."""
    name = entry if isinstance(entry, str) else (entry.get("role", entry.get("name")) if isinstance(entry, dict) else None)
    if isinstance(name, str) and not _has_jinja(name):
        return name, None
    return None, repr(entry)


def _references(value):
    """Yield ("role", name), ("tasks", expression) or ("bad", text) for every role/task-file reference in a value.

    "bad" is a reference whose target cannot be read statically (variable names, unknown forms)."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ROLE_MODULES:
                name = item.get("name") if isinstance(item, dict) else None
                if isinstance(name, str) and not _has_jinja(name):
                    yield "role", name
                else:
                    yield "bad", f"{key}: {item!r}"
            elif key in TASK_INCLUDE_MODULES:
                expression = item.get("file") if isinstance(item, dict) else item
                if isinstance(expression, str):
                    yield "tasks", expression
                else:
                    yield "bad", f"{key}: {item!r}"
            elif key in ACTION_KEYS and _action_module(item) in (ROLE_MODULES | TASK_INCLUDE_MODULES):
                yield "bad", f"{key}: {item!r}"
            elif key in {"roles", "dependencies"} and isinstance(item, list):
                for entry in item:
                    name, bad = _role_entry(entry)
                    if name is not None:
                        yield "role", name
                    else:
                        yield "bad", f"{key}: {bad}"
            yield from _references(item)
    elif isinstance(value, list):
        for item in value:
            yield from _references(item)


def _role_references(value):
    """Role names used by import_role/include_role/roles/dependencies anywhere in a play or task list."""
    for kind, name in _references(value):
        if kind == "role":
            yield name


def _task_includes(value):
    """File expressions given to include_tasks/import_tasks anywhere in a value."""
    for kind, expression in _references(value):
        if kind == "tasks":
            yield expression


def _role_of(relative: str) -> str | None:
    parts = relative.split("/")
    prefix = ROLES_REL.split("/")
    if parts[: len(prefix)] == prefix and len(parts) > len(prefix) + 1:
        return parts[len(prefix)]
    return None


def _resolve_tasks_file(expression: str, origin: str, root: Path) -> str | None:
    """Repository-relative path of a task file named by an include, or None when it cannot be resolved."""
    role = _role_of(origin)
    candidates: list[str] = []
    if (match := _PLAYBOOK_DIR.match(expression)) and not _has_jinja(match.group(1)):
        candidates = [f"{ANSIBLE_REL}/playbooks/{match.group(1)}"]
    elif (match := _ROLE_PATH.match(expression)) and not _has_jinja(match.group(1)):
        # role_path is the folder of the role that holds the including file.
        candidates = [f"{ROLES_REL}/{role}/{match.group(1)}"] if role else []
    elif not _has_jinja(expression) and not expression.startswith("/"):
        candidates = [f"{posixpath.dirname(origin)}/{expression}"]
        if role:
            candidates.append(f"{ROLES_REL}/{role}/tasks/{expression}")
    for candidate in candidates:
        normalized = posixpath.normpath(candidate)
        if normalized.startswith(ANSIBLE_REL + "/") and (root / normalized).is_file():
            return normalized
    return None


def closure(root: Path = ROOT) -> tuple[list[str], list[str], list[str]]:
    """Roles, task files and unresolved references reached from the body's Pi4 plays and the two guard playbooks.

    Roles and shared task files are followed in both directions (a role loads files, a file calls roles)."""
    roles: list[str] = []
    files: list[str] = []
    problems: list[str] = []
    queue: list[tuple[str, Any]] = []

    def add_file(relative: str) -> None:
        if relative not in files:
            files.append(relative)
            queue.append((relative, _load(root / relative)))

    def add_role(name: str, origin: str) -> None:
        if name in roles:
            return
        directory = root / ROLES_REL / name
        if not directory.is_dir():
            problems.append(f"{origin}: role {name} does not exist")
            return
        roles.append(name)
        for subdirectory in ("meta", "tasks", "handlers"):
            path_list = sorted((directory / subdirectory).rglob("*")) if (directory / subdirectory).is_dir() else []
            for path in path_list:
                if path.is_file() and path.suffix in {"", ".yml", ".yaml"}:
                    add_file(path.relative_to(root).as_posix())

    plays = _load(root / BODY_PLAYBOOK)
    queue += [(BODY_PLAYBOOK, play) for play in plays if isinstance(play, dict) and "kiosk" in str(play.get("hosts", ""))]
    for relative in GUARD_PLAYBOOKS:
        if (root / relative).is_file():
            queue.append((relative, _load(root / relative)))
    while queue:
        origin, document = queue.pop()
        for kind, value in _references(document):
            if kind == "role":
                add_role(value, origin)
            elif kind == "tasks":
                target = _resolve_tasks_file(value, origin, root)
                if target is None:
                    problems.append(f"{origin}: unresolved include {value!r}")
                else:
                    add_file(target)
            else:
                problems.append(f"{origin}: unresolved reference {value}")
    return sorted(roles), sorted(files), sorted(dict.fromkeys(problems))


def body_pi4_role_prefixes(root: Path = ROOT) -> tuple[str, ...]:
    """Roles reached from the body's Pi4 (hosts: kiosk) plays, with role dependencies and included roles."""
    return tuple(f"{ROLES_REL}/{name}/" for name in closure(root)[0])


def external_task_files(root: Path = ROOT) -> tuple[str, ...]:
    """Task files outside the roles (infrastructure/ansible/tasks) that the Pi4 plays or roles load."""
    return tuple(name for name in closure(root)[1] if name.startswith(EXTERNAL_TASKS_REL))


def closure_problems(root: Path = ROOT) -> list[str]:
    """Include/import expressions in the Pi4 closure that cannot be resolved statically."""
    return closure(root)[2]


def no_definition_prefixes(root: Path = ROOT) -> tuple[str, ...]:
    roles, files, _problems = closure(root)
    return tuple(dict.fromkeys((
        *_STATIC_NO_DEFINITION_FILES, *(f"{ROLES_REL}/{name}/" for name in roles),
        *(name for name in files if _role_of(name) not in roles),
    )))


def include_vars_files(document) -> list:
    """The file argument of every include_vars at any depth (block, rescue, always included).

    action:/local_action: forms count too, as a ("action", text) value that never equals an allowed expression."""
    found: list = []
    if isinstance(document, dict):
        for key, item in document.items():
            if key in INCLUDE_VARS:
                found.append(item.get("file") if isinstance(item, dict) else item)
            elif key in ACTION_KEYS and _action_module(item) in INCLUDE_VARS:
                found.append(("action", item if isinstance(item, str) else json.dumps(item, sort_keys=True, default=str)))
            found += include_vars_files(item)
    elif isinstance(document, list):
        for item in document:
            found += include_vars_files(item)
    return found


def string_set_facts(document) -> int:
    """Count set_fact calls in the "name=value" string form (also through action:/local_action:)."""
    count = 0
    if isinstance(document, dict):
        for key, item in document.items():
            if key in SET_FACT and isinstance(item, str):
                count += 1
            elif key in ACTION_KEYS and isinstance(item, str) and _action_module(item) in SET_FACT:
                count += 1
            count += string_set_facts(item)
    elif isinstance(document, list):
        for item in document:
            count += string_set_facts(item)
    return count


def definition_problems(files: list[Path], root: Path, prefixes: tuple[str, ...] | None = None) -> list[str]:
    """The release role, the body's Pi4 roles and guard playbooks must not define the inputs (role defaults excepted)."""
    prefixes = prefixes if prefixes is not None else no_definition_prefixes()
    problems: list[str] = []
    for path in files:
        rel = path.relative_to(root).as_posix()
        if rel == ROLE_DEFAULTS or not rel.startswith(prefixes):
            continue
        document = _load(path)
        keys = set(map(str, _keys(document)))
        for name in sorted(keys & INPUTS):
            if name == ENABLED_SERVICES and rel == ROLE_VARS:
                continue
            problems.append(f"{rel}: defines {name}")
        for name in sorted(set(_registered(document)) & INPUTS):
            problems.append(f"{rel}: registers {name}")
        occurrences = include_vars_files(document)
        if occurrences:
            allowed = ALLOWED_INCLUDE_VARS.get(rel)
            if allowed is None or occurrences != [allowed[0]]:
                problems.append(f"{rel}: uses include_vars")
        if "vars_files" in keys:
            problems.append(f"{rel}: uses vars_files")
        if string_set_facts(document):
            problems.append(f"{rel}: uses string-form set_fact")
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

    def test_allowed_include_vars_load_only_files_without_the_inputs(self) -> None:
        for task_file, (expression, loaded) in ALLOWED_INCLUDE_VARS.items():
            self.assertEqual(include_vars_files(_load(ROOT / task_file)), [expression], task_file)
            role_path = (ROOT / task_file).parents[1]
            resolved = (Path(expression.replace("{{ role_path }}", str(role_path)))).resolve()
            self.assertEqual(resolved, (ROOT / loaded).resolve(), task_file)
            self.assertEqual(set(map(str, _keys(_load(ROOT / loaded)))) & INPUTS, set(), loaded)

    def test_every_include_in_the_pi4_closure_is_resolved(self) -> None:
        self.assertEqual(closure_problems(), [])
        # Loaded through {{ role_path }}/../client/... from release_kiosk.
        _roles, files, _problems = closure()
        self.assertIn("infrastructure/ansible/roles/client/tasks/agents_hardened_group.yml", files)
        self.assertIn("infrastructure/ansible/roles/client/tasks/torque_guard_running.yml", files)

    def test_the_body_pi4_roles_are_discovered_from_the_playbook(self) -> None:
        prefixes = body_pi4_role_prefixes()
        self.assertIn("infrastructure/ansible/roles/common/", prefixes)
        self.assertIn("infrastructure/ansible/roles/release_kiosk/", prefixes)
        # Signage-only roles are not part of the Pi4 plays.
        self.assertNotIn("infrastructure/ansible/roles/release_signage/", prefixes)
        # Included from release_kiosk's prepare.yml, not from the play or meta.
        self.assertIn("infrastructure/ansible/roles/client_server_cert_pin/", prefixes)
        covered = {
            path.relative_to(ROOT).as_posix() for path in _tracked_files()
            if path.relative_to(ROOT).as_posix().startswith(prefixes)
        }
        self.assertTrue(any(name.startswith("infrastructure/ansible/roles/common/") for name in covered))

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

    def test_the_allowed_include_vars_must_be_exactly_one_with_the_exact_expression(self) -> None:
        relative = next(iter(ALLOWED_INCLUDE_VARS))
        expression = ALLOWED_INCLUDE_VARS[relative][0]
        exact = f"- ansible.builtin.include_vars:\n    file: \"{expression}\"\n"
        self.assertEqual(self._problems(relative, exact, definition_problems), [])
        second = exact + "- block:\n    - ansible.builtin.include_vars:\n        file: other.yml\n"
        self.assertEqual(self._problems(relative, second, definition_problems), [f"{relative}: uses include_vars"])
        rescue = exact + "- block: []\n  rescue:\n    - include_vars: {file: other.yml}\n"
        self.assertEqual(self._problems(relative, rescue, definition_problems), [f"{relative}: uses include_vars"])
        other = f"- ansible.builtin.include_vars:\n    file: \"{expression}.evil.yml\"\n"
        self.assertEqual(self._problems(relative, other, definition_problems), [f"{relative}: uses include_vars"])
        nested = f"- block:\n    - ansible.builtin.include_vars:\n        file: \"{expression}\"\n"
        self.assertEqual(self._problems(relative, nested, definition_problems), [])

    def test_enabled_services_is_defined_only_in_the_role_vars(self) -> None:
        text = "release_kiosk_enabled_agent_services: []\n"
        self.assertEqual(self._problems(ROLE_VARS, text, definition_problems), [])
        problems = self._problems("infrastructure/ansible/roles/release_kiosk/tasks/x.yml", text, definition_problems)
        self.assertEqual(problems, ["infrastructure/ansible/roles/release_kiosk/tasks/x.yml: defines release_kiosk_enabled_agent_services"])

    def test_task_files_outside_the_roles_are_found_and_checked(self) -> None:
        found = external_task_files()
        self.assertIn("infrastructure/ansible/tasks/kiosk-gui-session-config.yml", found)
        self.assertNotIn("infrastructure/ansible/tasks/preflight-signage.yml", found)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "infrastructure/ansible/playbooks").mkdir(parents=True)
            (root / "infrastructure/ansible/tasks").mkdir(parents=True)
            (root / BODY_PLAYBOOK).write_text(
                "- hosts: kiosk\n  tasks:\n    - ansible.builtin.import_tasks: \"{{ playbook_dir }}/../tasks/a.yml\"\n", encoding="utf-8"
            )
            (root / "infrastructure/ansible/tasks/a.yml").write_text(
                "- ansible.builtin.include_tasks: \"{{ playbook_dir }}/../tasks/b.yml\"\n", encoding="utf-8"
            )
            bad = root / "infrastructure/ansible/tasks/b.yml"
            bad.write_text("- ansible.builtin.set_fact:\n    torque_agent_enabled: true\n", encoding="utf-8")
            self.assertEqual(
                definition_problems([bad], root, no_definition_prefixes(root)),
                ["infrastructure/ansible/tasks/b.yml: defines torque_agent_enabled"],
            )

    def test_registering_an_input_name_is_rejected(self) -> None:
        text = "- ansible.builtin.command: id\n  register: barcode_agent_enabled\n"
        problems = self._problems("infrastructure/ansible/roles/release_kiosk/tasks/x.yml", text, definition_problems)
        self.assertEqual(problems, ["infrastructure/ansible/roles/release_kiosk/tasks/x.yml: registers barcode_agent_enabled"])

    def test_defining_an_input_in_a_role_of_the_body_pi4_play_is_rejected(self) -> None:
        text = "- ansible.builtin.set_fact:\n    nfc_agent_client_id: x\n"
        problems = self._problems("infrastructure/ansible/roles/common/tasks/x.yml", text, definition_problems)
        self.assertEqual(problems, ["infrastructure/ansible/roles/common/tasks/x.yml: defines nfc_agent_client_id"])
        # A role that no Pi4 play reads is outside the check.
        self.assertEqual(self._problems("infrastructure/ansible/roles/release_signage/tasks/x.yml", text, definition_problems), [])

    def test_extensionless_role_variable_files_are_checked(self) -> None:
        for relative in (
            "infrastructure/ansible/roles/common/vars/main", "infrastructure/ansible/roles/common/defaults/main",
        ):
            self.assertTrue(_is_variable_file(Path(relative)), relative)
            problems = self._problems(relative, "torque_agent_enabled: true\n", definition_problems)
            self.assertEqual(problems, [f"{relative}: defines torque_agent_enabled"])
            self.assertEqual(len(self._problems(relative, "torque_agent_enabled: '{{ x }}'\n", literal_problems)), 1)
        self.assertFalse(_is_variable_file(Path("infrastructure/ansible/roles/common/templates/x")))

    def test_role_references_are_found_in_every_form(self) -> None:
        document = yaml.safe_load(
            "- hosts: kiosk\n  roles:\n    - a\n    - role: b\n  tasks:\n    - block:\n"
            "        - ansible.builtin.include_role: {name: c}\n        - import_role: {name: d}\n"
        )
        self.assertEqual(set(_role_references(document)), {"a", "b", "c", "d"})

    def test_roles_included_from_role_tasks_are_followed_recursively(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "infrastructure/ansible/playbooks").mkdir(parents=True)
            (root / BODY_PLAYBOOK).write_text("- hosts: kiosk\n  roles:\n    - top\n", encoding="utf-8")
            roles = root / "infrastructure/ansible/roles"
            (roles / "top/tasks/sub").mkdir(parents=True)
            (roles / "top/tasks/main.yml").write_text("- ansible.builtin.include_tasks: sub/x.yml\n", encoding="utf-8")
            (roles / "top/tasks/sub/x.yml").write_text("- ansible.builtin.import_role:\n    name: middle\n", encoding="utf-8")
            (roles / "middle/tasks").mkdir(parents=True)
            (roles / "middle/tasks/main.yml").write_text("- block:\n    - include_role: {name: leaf}\n", encoding="utf-8")
            (roles / "leaf/tasks").mkdir(parents=True)
            (roles / "leaf/tasks/main.yml").write_text("- ansible.builtin.debug: {msg: x}\n", encoding="utf-8")
            self.assertEqual(
                body_pi4_role_prefixes(root),
                tuple(f"infrastructure/ansible/roles/{name}/" for name in ("leaf", "middle", "top")),
            )
            leaf = roles / "leaf/tasks/main.yml"
            leaf.write_text("- ansible.builtin.set_fact:\n    torque_agent_enabled: true\n", encoding="utf-8")
            self.assertEqual(
                definition_problems([leaf], root, no_definition_prefixes(root)),
                ["infrastructure/ansible/roles/leaf/tasks/main.yml: defines torque_agent_enabled"],
            )

    def _tree(self, root: Path, files: dict[str, str]) -> None:
        (root / "infrastructure/ansible/playbooks").mkdir(parents=True, exist_ok=True)
        for relative, text in files.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")

    def test_a_file_loaded_through_role_path_is_checked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            roles = "infrastructure/ansible/roles"
            self._tree(root, {
                BODY_PLAYBOOK: "- hosts: kiosk\n  roles:\n    - top\n",
                f"{roles}/top/tasks/main.yml": '- ansible.builtin.include_tasks: "{{ role_path }}/../other/tasks/x.yml"\n',
                f"{roles}/other/tasks/x.yml": "- ansible.builtin.set_fact:\n    torque_agent_enabled: true\n",
            })
            self.assertEqual(closure_problems(root), [])
            bad = root / f"{roles}/other/tasks/x.yml"
            self.assertEqual(
                definition_problems([bad], root, no_definition_prefixes(root)),
                [f"{roles}/other/tasks/x.yml: defines torque_agent_enabled"],
            )

    def test_a_role_called_from_a_shared_task_file_is_checked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            roles = "infrastructure/ansible/roles"
            self._tree(root, {
                BODY_PLAYBOOK: '- hosts: kiosk\n  tasks:\n    - ansible.builtin.import_tasks: "{{ playbook_dir }}/../tasks/a.yml"\n',
                "infrastructure/ansible/tasks/a.yml": "- ansible.builtin.include_role:\n    name: called\n",
                f"{roles}/called/tasks/main.yml": "- ansible.builtin.set_fact:\n    torque_agent_enabled: true\n",
            })
            self.assertEqual(closure_problems(root), [])
            bad = root / f"{roles}/called/tasks/main.yml"
            self.assertEqual(
                definition_problems([bad], root, no_definition_prefixes(root)),
                [f"{roles}/called/tasks/main.yml: defines torque_agent_enabled"],
            )

    def test_an_include_that_cannot_be_resolved_is_rejected(self) -> None:
        bodies = (
            '- ansible.builtin.include_tasks: "{{ some_dir }}/x.yml"\n',
            '- ansible.builtin.import_tasks: "{{ item }}.yml"\n',
            "- ansible.builtin.include_tasks: missing.yml\n",
            '- ansible.builtin.include_tasks: "{{ role_path }}/../nowhere/tasks/x.yml"\n',
            "- ansible.builtin.include_role:\n    name: \"{{ which }}\"\n",
            "- ansible.builtin.import_role:\n    name: nowhere\n",
            "- ansible.builtin.include_tasks: [a.yml]\n",
            "- action: include_tasks x.yml\n",
            "- local_action: {module: include_role, name: top}\n",
        )
        for body in bodies:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self._tree(root, {
                    BODY_PLAYBOOK: "- hosts: kiosk\n  roles:\n    - top\n",
                    "infrastructure/ansible/roles/top/tasks/main.yml": body,
                })
                self.assertEqual(len(closure_problems(root)), 1, body)

    def test_a_role_path_include_from_a_shared_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._tree(root, {
                BODY_PLAYBOOK: '- hosts: kiosk\n  tasks:\n    - ansible.builtin.import_tasks: "{{ playbook_dir }}/../tasks/a.yml"\n',
                "infrastructure/ansible/tasks/a.yml": '- ansible.builtin.include_tasks: "{{ role_path }}/tasks/x.yml"\n',
            })
            self.assertEqual(len(closure_problems(root)), 1)

    def test_every_include_vars_spelling_is_counted(self) -> None:
        relative = next(iter(ALLOWED_INCLUDE_VARS))
        expression = ALLOWED_INCLUDE_VARS[relative][0]
        exact = f"- ansible.builtin.include_vars:\n    file: \"{expression}\"\n"
        extras = (
            "- action: include_vars other.yml\n",
            "- action: ansible.builtin.include_vars file=other.yml\n",
            "- local_action: include_vars other.yml\n",
            "- action:\n    module: ansible.legacy.include_vars\n    file: other.yml\n",
            "- local_action: {module: include_vars, file: other.yml}\n",
            "- ansible.legacy.include_vars: other.yml\n",
            "- ansible.builtin.include_vars: {dir: other}\n",
        )
        for extra in extras:
            self.assertEqual(self._problems(relative, exact + extra, definition_problems), [f"{relative}: uses include_vars"], extra)
        self.assertEqual(self._problems(relative, exact, definition_problems), [])

    def test_string_form_set_fact_and_vars_files_are_rejected(self) -> None:
        path = "infrastructure/ansible/roles/release_kiosk/tasks/x.yml"
        for text in (
            "- ansible.builtin.set_fact: torque_agent_enabled=true\n",
            "- set_fact: a=b\n",
            "- action: set_fact a=b\n",
            "- local_action: ansible.builtin.set_fact a=b\n",
        ):
            self.assertEqual(self._problems(path, text, definition_problems), [f"{path}: uses string-form set_fact"], text)
        self.assertEqual(self._problems(path, "- ansible.builtin.set_fact:\n    other_name: 1\n", definition_problems), [])
        for relative in (BODY_PLAYBOOK, GUARD_PLAYBOOKS[0], GUARD_PLAYBOOKS[1]):
            problems = self._problems(relative, "- hosts: kiosk\n  vars_files:\n    - x.yml\n", definition_problems)
            self.assertEqual(problems, [f"{relative}: uses vars_files"], relative)

    def test_jinja_names_are_parsed_not_matched(self) -> None:
        self.assertEqual(jinja_names("{{ a | default(b) }} {% if c %}{{ d }}{% endif %}"), {"a", "b", "c", "d"})
        self.assertEqual(jinja_names("{% set x = 1 %}{{ x }}"), set())


if __name__ == "__main__":
    unittest.main()
