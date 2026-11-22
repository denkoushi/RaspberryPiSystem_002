"""docker.env.j2 に足したキーが Pi5 標準デプロイで API に届くことを守る。

標準デプロイは docker.env.j2 を描画せず、永続ファイルへ lineinfile で一部のキーだけ書く。
雛形に足して書き込み一覧に足し忘れる事故が過去に3回あった。
"""
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = ROOT / "infrastructure/ansible/templates/docker.env.j2"
TASKS_DIR = ROOT / "infrastructure/ansible/roles/release_pi5/tasks"
ALLOWLIST = Path(__file__).resolve().parent / "fixtures/pi5-env-undelivered-allowlist.txt"

# path がこれらを含む lineinfile を「Pi5 API の環境ファイルへの書き込み」とみなす
ENV_PATH_MARKERS = (
    "release_pi5_chat_env_file",
    "release_pi5_trial_maintenance_env_file",
    "release_pi5_candidate_env_file",
    "release_pi5_compose_environment.PI5_ENV_FILE",
)
KEY_RE = re.compile(r"^([A-Z][A-Z0-9_]+)=")
ITEM_KEY_RE = re.compile(r"^\{\{\s*item\.key\s*\}\}=")

# 過去に届け忘れた3件(3d326524, ce31694e, 13733ae0)
REGRESSION_KEYS = (
    "BACKUP_ENCRYPTION_KEY",
    "PROCEDURE_SPEECH_TO_TEXT_ENABLED",
    "ASSEMBLY_PROCEDURE_MAIL_DOMAIN",
)


def template_keys(text):
    keys = set()
    for line in text.splitlines():
        m = KEY_RE.match(line)
        if m:
            keys.add(m.group(1))
    return keys


def _walk_tasks(tasks):
    for task in tasks or []:
        if not isinstance(task, dict):
            continue
        yield task
        for section in ("block", "rescue", "always"):
            yield from _walk_tasks(task.get(section))


def written_keys_from_yaml(text):
    """YAML 文字列から、Pi5 API 環境ファイルへ書く lineinfile のキーを集める。"""
    keys = set()
    for task in _walk_tasks(yaml.safe_load(text)):
        spec = task.get("ansible.builtin.lineinfile") or task.get("lineinfile")
        if not isinstance(spec, dict):
            continue
        if not any(marker in str(spec.get("path", "")) for marker in ENV_PATH_MARKERS):
            continue
        line = str(spec.get("line", ""))
        regexp = str(spec.get("regexp", ""))
        if ITEM_KEY_RE.match(line) or ITEM_KEY_RE.match(regexp.lstrip("^")):
            loop = task.get("loop")
            if isinstance(loop, list):
                for item in loop:
                    if isinstance(item, dict) and "key" in item:
                        keys.add(str(item["key"]))
            continue
        m = KEY_RE.match(line) or KEY_RE.match(regexp.lstrip("^"))
        if m:
            keys.add(m.group(1))
    return keys


def collect_written_keys():
    keys, files = set(), []
    for path in sorted(TASKS_DIR.glob("*.yml")):
        found = written_keys_from_yaml(path.read_text(encoding="utf-8"))
        if found:
            files.append(path.name)
            keys |= found
    return keys, files


def load_allowlist(text):
    keys = set()
    for raw in text.splitlines():
        entry = raw.split("#", 1)[0].strip()
        if entry:
            keys.add(entry)
    return keys


def check(template, written, allowed):
    errors = []
    missing = sorted(template - written - allowed)
    if missing:
        errors.append(
            "docker.env.j2 に足した次のキーが標準デプロイで Pi5 API に届きません。"
            "business-hermes-chat-prepare.yml の書き込み一覧に足すか、"
            "届けなくてよい理由を除外一覧(%s)に書いてください: %s"
            % (ALLOWLIST.name, ", ".join(missing))
        )
    stale = sorted(allowed - template)
    if stale:
        errors.append("除外一覧にあるが docker.env.j2 に無いキー(一覧から消してください): " + ", ".join(stale))
    delivered = sorted(allowed & written)
    if delivered:
        errors.append("除外一覧にあるが書き込み一覧にもあるキー(一覧から消してください): " + ", ".join(delivered))
    return errors


class Pi5EnvKeyDeliveryTest(unittest.TestCase):
    def test_template_keys_are_delivered_or_allowlisted(self):
        written, _ = collect_written_keys()
        errors = check(
            template_keys(TEMPLATE.read_text(encoding="utf-8")),
            written,
            load_allowlist(ALLOWLIST.read_text(encoding="utf-8")),
        )
        self.assertEqual([], errors, "\n".join(errors))

    def test_past_misses_are_written(self):
        written, files = collect_written_keys()
        self.assertTrue(files)
        for key in REGRESSION_KEYS:
            self.assertIn(key, written)
            self.assertIn(key, template_keys(TEMPLATE.read_text(encoding="utf-8")))

    def test_check_fails_when_past_key_is_removed_from_writes(self):
        yaml_text = """
- name: bind
  ansible.builtin.lineinfile:
    path: "{{ release_pi5_chat_env_file }}"
    regexp: "^{{ item.key }}="
    line: "{{ item.key }}={{ item.value }}"
  loop:
    - { key: OTHER_KEY, value: x }
"""
        written = written_keys_from_yaml(yaml_text)
        errors = check(set(REGRESSION_KEYS) | {"OTHER_KEY"}, written, set())
        self.assertEqual(1, len(errors))
        for key in REGRESSION_KEYS:
            self.assertIn(key, errors[0])
        self.assertNotIn("OTHER_KEY", errors[0])

    def test_parser_reads_nested_blocks_and_single_line_tasks(self):
        yaml_text = """
- block:
    - ansible.builtin.lineinfile:
        path: "{{ release_pi5_chat_env_file }}"
        regexp: '^SINGLE_KEY='
        line: "SINGLE_KEY=1"
      when: true
  rescue:
    - ansible.builtin.lineinfile:
        path: /etc/other.conf
        regexp: '^NOT_ENV='
        line: 'NOT_ENV=1'
"""
        self.assertEqual({"SINGLE_KEY"}, written_keys_from_yaml(yaml_text))

    def test_stale_and_overlapping_allowlist_entries_fail(self):
        errors = check({"A"}, {"A"}, {"A", "GONE"})
        self.assertEqual(2, len(errors))


if __name__ == "__main__":
    unittest.main()
