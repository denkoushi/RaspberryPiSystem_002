from __future__ import annotations

import hashlib
import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml
from jinja2 import Environment, StrictUndefined


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"
TASK_FILE = ANSIBLE / "roles/common/tasks/distrusted-intermediates.yml"
POLICY = yaml.safe_load(TASK_FILE.read_text())[0]
TASKS = POLICY["block"]
PINS = {
    "dv": "42c4accd12c4f59597925e1a08a7a90102608543809308d50ec427e118ba1493",
    "ov": "98b896625c0c230adeec3eb2cf6aad5001ecf9156a68644e82374ce5833bc25b",
    "ev": "e7568fe6e12331f4fd7de61da4c7559d0f8eb192a218d4741a3ba75184333838",
}


def task_with(module: str) -> dict:
    return next(task for task in TASKS if module in task)


class DistrustedIntermediatesTests(unittest.TestCase):
    def test_exact_three_pinned_certificates_and_common_names(self) -> None:
        certificates = POLICY["vars"]["distrusted_intermediates"]
        self.assertEqual(len(certificates), 3)
        for cert, (kind, fingerprint) in zip(certificates, PINS.items()):
            with self.subTest(kind=kind):
                self.assertEqual(cert["filename"], f"emudhra-{kind}-tls-ca-g3b.pem")
                self.assertEqual(cert["nickname"], f"EM {kind.upper()} TLS CA - G3B")
                self.assertEqual(cert["fingerprint"].replace(":", "").lower(), fingerprint)
                source = ANSIBLE / "files/distrusted-intermediates" / cert["filename"]
                der = ssl.PEM_cert_to_DER_cert(source.read_text())
                self.assertEqual(hashlib.sha256(der).hexdigest(), fingerprint)
                subject = subprocess.check_output(
                    ["openssl", "x509", "-in", str(source), "-noout", "-subject"], text=True
                )
                self.assertIn(cert["nickname"], subject)

    def test_fingerprint_assertion_precedes_all_mutations_and_rejects_wrong_pem(self) -> None:
        read, assertion = TASKS[:2]
        self.assertEqual(read["delegate_to"], "localhost")
        self.assertFalse(read["become"])
        self.assertFalse(read["check_mode"])
        self.assertIn("-sha256", read["ansible.builtin.command"]["argv"])
        self.assertIn("-fingerprint", read["ansible.builtin.command"]["argv"])
        condition = Environment(undefined=StrictUndefined).compile_expression(
            assertion["ansible.builtin.assert"]["that"][0]
        )
        for cert in POLICY["vars"]["distrusted_intermediates"]:
            self.assertTrue(condition(item={"stdout": "sha256 Fingerprint=" + cert["fingerprint"], "item": cert}))
            self.assertFalse(condition(item={"stdout": "sha256 Fingerprint=" + "00:" * 31 + "00", "item": cert}))

    def test_root_deselection_is_exact_absence_safe_and_idempotent(self) -> None:
        task = task_with("ansible.builtin.lineinfile")
        arguments = task["ansible.builtin.lineinfile"]
        root = "mozilla/emSign_ECC_Root_CA_-_G3.crt"
        preserved = "mozilla/Other_Root.crt\nlocal/raspi-system-local-ca.crt\n"
        self.assertEqual(arguments["path"], "/etc/ca-certificates.conf")
        self.assertEqual(arguments["line"], "!" + root)
        self.assertTrue(arguments["backrefs"])
        self.assertIn("stat.exists", task["when"])
        for initial, expected, changed in (
            (root + "\n" + preserved, "!" + root + "\n" + preserved, True),
            ("!" + root + "\n" + preserved, "!" + root + "\n" + preserved, False),
            (preserved, preserved, False),
            ("mozilla/emSign_Root_CA_-_G1.crt\n" + preserved,
             "mozilla/emSign_Root_CA_-_G1.crt\n" + preserved, False),
        ):
            with self.subTest(initial=initial), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "ca-certificates.conf"
                path.write_text(initial)
                for expected_change in (changed, False):
                    result = subprocess.run(
                        [sys.executable, "-m", "ansible.modules.lineinfile"],
                        input=json.dumps({"ANSIBLE_MODULE_ARGS": {**arguments, "path": str(path)}}),
                        text=True, capture_output=True, check=True,
                        env={**os.environ, "ANSIBLE_LOCAL_TEMP": directory},
                    )
                    self.assertEqual(json.loads(result.stdout)["changed"], expected_change)
                    self.assertEqual(path.read_text(), expected)
        refresh = next(t for t in TASKS if t.get("ansible.builtin.command", {}).get("argv") == ["/usr/sbin/update-ca-certificates"])
        self.assertEqual(refresh["when"], "distrusted_ca_selection is changed")
        self.assertNotIn("/usr/local/share/ca-certificates", TASK_FILE.read_text())

    def test_nss_uses_session_owner_and_preserves_existing_database(self) -> None:
        self.assertEqual(task_with("ansible.builtin.apt")["ansible.builtin.apt"], {"name": "libnss3-tools", "state": "present"})
        self.assertEqual(task_with("ansible.builtin.getent")["ansible.builtin.getent"]["key"], "{{ ansible_user }}")
        directories = next(t for t in TASKS if t.get("loop") == [".pki", ".pki/nssdb"])
        self.assertEqual(directories["ansible.builtin.file"]["owner"], "{{ ansible_user }}")
        init = next(t for t in TASKS if "-N" in t.get("ansible.builtin.command", {}).get("argv", []))
        self.assertTrue(init["ansible.builtin.command"]["creates"].endswith("/.pki/nssdb/cert9.db"))
        self.assertIn("--empty-password", init["ansible.builtin.command"]["argv"])
        for task in TASKS:
            if "certutil" in task.get("ansible.builtin.command", {}).get("argv", []):
                self.assertEqual(task["become_user"], "{{ ansible_user }}")
        self.assertEqual(POLICY["vars"]["distrusted_nss_home"], "{{ getent_passwd[ansible_user][4] }}")

    def test_nss_listing_skips_only_explicitly_prohibited_nicknames(self) -> None:
        listing, install = TASKS[-2:]
        self.assertIn("-L", listing["ansible.builtin.command"]["argv"])
        argv = install["ansible.builtin.command"]["argv"]
        self.assertIn("-A", argv)
        self.assertEqual(argv[argv.index("-t") + 1], "p,p,p")
        environment = Environment(undefined=StrictUndefined)
        environment.filters["regex_escape"] = re.escape
        environment.tests["search"] = lambda value, pattern: re.search(pattern, value) is not None
        condition = environment.compile_expression(install["when"][1])
        for cert in POLICY["vars"]["distrusted_intermediates"]:
            for suffix, expected in (("", True), (" C,C,C", True), (" p,p,p", False), (" P,P,P", True)):
                self.assertEqual(condition(item=cert, distrusted_nss_listing={"stdout": cert["nickname"] + suffix + "\n"}), expected)

    def test_standard_profiles_and_common_run_without_full_mode_gate(self) -> None:
        plays = yaml.safe_load((ANSIBLE / "playbooks/deploy-release-standard.yml").read_text())
        for tag, hosts in (("pi5", "server"), ("pi4", "kiosk"), ("pi3", "signage")):
            play = next(play for play in plays if tag in play["tags"])
            self.assertEqual(play["hosts"], hosts)
            task = play["pre_tasks"][0]
            self.assertEqual(task["ansible.builtin.import_role"], {"name": "common", "tasks_from": "distrusted-intermediates"})
            self.assertNotIn("when", task)
        common = yaml.safe_load((ANSIBLE / "roles/common/tasks/main.yml").read_text())
        include = next(t for t in common if t.get("ansible.builtin.import_tasks") == "distrusted-intermediates.yml")
        self.assertNotIn("when", include)
        self.assertNotIn("when", POLICY)


if __name__ == "__main__":
    unittest.main()
