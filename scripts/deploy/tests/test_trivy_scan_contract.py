from pathlib import Path
import re
import subprocess
import unittest

from jinja2 import Environment, StrictUndefined
import yaml


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"
TEMPLATES = ("trivy-scan.sh.j2", "trivy-image-scan.sh.j2")


def render_script(name: str, staging: bool = False) -> str:
    variables = yaml.safe_load((ANSIBLE / "group_vars/all.yml").read_text())
    if staging:
        variables.update(yaml.safe_load((ANSIBLE / "group_vars/staging.yml").read_text()))
    environment = Environment(undefined=StrictUndefined)
    # Resolve the nested group-var references used by these templates.
    for key in ("security_review_data_dir", "trivy_skip_dirs", "trivy_alert_ignore_patterns"):
        value = variables[key]
        if isinstance(value, list):
            variables[key] = [environment.from_string(item).render(variables) for item in value]
        else:
            variables[key] = environment.from_string(value).render(variables)
    return environment.from_string((ANSIBLE / "templates" / name).read_text()).render(variables)


class TrivyScanContractTests(unittest.TestCase):
    def test_storage_is_skipped_for_each_target(self) -> None:
        for staging in (False, True):
            with self.subTest(staging=staging):
                script = render_script(TEMPLATES[0], staging)
                target = "/opt/RaspberryPiSystem_002" + ("-staging" if staging else "")
                self.assertIn(f'--skip-dirs "{target}/storage"', script)
                self.assertIn(f'--skip-dirs "{target}/secrets"', script)
                self.assertNotIn(f'--skip-dirs "{target}/storage/security-review"', script)

    def test_timeout_and_exit_code_branches(self) -> None:
        for name in TEMPLATES:
            with self.subTest(template=name):
                script = render_script(name)
                self.assertIn('--timeout "30m"', script)
                findings_code = int(re.search(r"--exit-code (\d+)", script)[1])
                self.assertNotIn(findings_code, (0, 1))
                conditions = re.findall(r"(?:if|elif) (\[\[ \$\{TRIVY_EXIT\} .*?\]\]); then", script)
                self.assertEqual(len(conditions), 2)
                conditions = [re.sub(r'-x "[^"]+"', '-x /bin/sh', item) for item in conditions]
                for code, expected in ((0, "ok"), (findings_code, "findings"), (1, "error"), (2, "error"), (124, "error")):
                    result = subprocess.run(
                        ["bash", "-c", f'TRIVY_EXIT={code}; if {conditions[0]}; then echo findings; '
                         f'elif {conditions[1]}; then echo error; else echo ok; fi'],
                        capture_output=True, text=True, check=True, timeout=10,
                    )
                    self.assertEqual(result.stdout.strip(), expected)
                self.assertIn('"trivy-' + ('image-' if 'image' in name else '') + 'scan-error"', script)

    def test_running_image_lookup_and_guards(self) -> None:
        script = render_script(TEMPLATES[1])
        self.assertIn('for image_type in api web; do', script)
        self.assertIn('for service in "${image_type}-blue" "${image_type}-green" "${image_type}"; do', script)
        self.assertIn('docker ps --quiet --filter "label=com.docker.compose.service=${service}"', script)
        self.assertIn("docker inspect --format '{{.Image}}'", script)
        self.assertNotIn('docker compose', script)
        self.assertNotIn('jq ', script)
        self.assertIn('[[ -z "${image}" || "${image}" == ":" ]]', script)
        self.assertLess(script.index('continue'), script.index('IMAGES+=("${image}")'))
        self.assertIn('${SEEN_IMAGES[${image}]:-}', script)
        self.assertIn('SEEN_IMAGES["${image}"]=1', script)
        self.assertIn('No Docker images found. Skipping image scan.', script)
        self.assertIn('scan_image "${IMAGES[${index}]}" "${IMAGE_TYPES[${index}]}"', script)


if __name__ == "__main__":
    unittest.main()
