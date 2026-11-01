"""Committed GitHub identities and independently deployed script consistency."""
from pathlib import Path
import re
import runpy
import shlex
import subprocess
import unittest
from unittest.mock import patch

import yaml

from scripts.deploy import release_artifact_contract as contract

ROOT = Path(__file__).resolve().parents[3]


def _ansible_environment():
    from ansible.plugins.filter.core import FilterModule
    from jinja2 import Environment, StrictUndefined
    environment = Environment(undefined=StrictUndefined)
    environment.filters.update(FilterModule().filters())
    environment.tests["match"] = lambda value, pattern: re.match(pattern, value) is not None
    return environment


class GitHubOwnerConfigTests(unittest.TestCase):
    def test_committed_github_identity(self):
        # Update this one fixed-value test when transferring the repository.
        assert contract.GITHUB_OWNER == "denkoushi"
        assert contract.SOURCE_REPOSITORY == "denkoushi/RaspberryPiSystem_002"
        assert contract.GHCR_NAMESPACE == "ghcr.io/denkoushi"
        assert contract.EXPECTED_IMAGE_REPOSITORIES["api"] == "ghcr.io/denkoushi/raspisys-api"
        assert contract.TORQUE_ADOPTION_PREDICATE_TYPE == (
            "https://github.com/denkoushi/RaspberryPiSystem_002/"
            "attestations/torque-agent-component-adoption/v1"
        )
        assert re.fullmatch(r"[a-z0-9-]+", contract.GITHUB_OWNER)

    def test_standalone_pi4_owner_matches_contract(self):
        source = (ROOT / "scripts/client/pi4-storage-maintenance.sh").read_text()
        assert f"GITHUB_OWNER='{contract.GITHUB_OWNER}'" in source
        owners = re.search(r"^HISTORICAL_GITHUB_OWNERS=\((.*)\)$", source, re.M)[1]
        assert tuple(shlex.split(owners)) == contract.HISTORICAL_GITHUB_OWNERS

    def test_retention_accepts_committed_historical_owners_only(self):
        with patch.object(contract, "HISTORICAL_GITHUB_OWNERS", ("old-company",)):
            model = runpy.run_path(str(ROOT / "scripts/server/docker_image_retention_model.py"))
        assert "ghcr.io/old-company/raspisys-api" in model["API_REPOSITORIES"]
        assert "ghcr.io/old-company/raspisys-web" in model["WEB_REPOSITORIES"]
        assert "ghcr.io/old-company/raspisys-release-set" in model["ALLOWED_REPOSITORIES"]
        assert "ghcr.io/untrusted/raspisys-api" not in model["ALLOWED_REPOSITORIES"]
        sha = "a" * 40
        entry = {"reference": f"ghcr.io/old-company/raspisys-api:{sha}@sha256:" + "b" * 64,
                 "releaseSha": sha, "imageId": "sha256:" + "c" * 64}
        model["parse_retention_entry"](entry, service="api", generation="previous")
        from datetime import datetime, timezone
        from types import SimpleNamespace
        from scripts.server import docker_image_retention_policy as policy
        retained_set = SimpleNamespace(
            image_id="release-set", repositories=frozenset({"ghcr.io/old-company/raspisys-release-set"}),
            release_revisions={sha}, created=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
        obsolete_api = SimpleNamespace(
            image_id="obsolete-api", repositories=frozenset({"ghcr.io/old-company/raspisys-api"}),
            release_revisions={"d" * 40}, created=retained_set.created,
        )
        snapshot = SimpleNamespace(images=(retained_set, obsolete_api), container_image_ids=frozenset())
        state = SimpleNamespace(retained_image_ids=frozenset(), retained_release_shas={sha})
        with patch.object(policy, "ALLOWED_REPOSITORIES", model["ALLOWED_REPOSITORIES"]), patch.object(
            policy, "RELEASE_SET_REPOSITORIES", model["RELEASE_SET_REPOSITORIES"]
        ):
            candidates, excluded = policy._candidate_images(snapshot, state, now=datetime.now(timezone.utc))
        assert [image.image_id for image in candidates] == ["obsolete-api"]
        assert excluded["retainedReleaseSetRevision"] == ["release-set"]

    def test_ansible_owners_match_python_contract(self):
        values = yaml.safe_load((ROOT / "infrastructure/ansible/group_vars/all.yml").read_text())
        assert values["raspisys_github_owner"] == contract.GITHUB_OWNER
        assert tuple(values["raspisys_historical_github_owners"]) == contract.HISTORICAL_GITHUB_OWNERS

    def test_ansible_transfer_retention_and_new_image_boundaries(self):
        environment = _ansible_environment()
        base = ROOT / "infrastructure/ansible/roles"
        values = {"raspisys_github_owner": "new-company",
                  "raspisys_historical_github_owners": ["old-company"]}
        tasks = yaml.safe_load((base / "release_pi5/tasks/retention-state.yml").read_text())
        task = next(task for task in tasks if task["name"] == "Validate every existing Pi5 retention entry")
        sha, digest = "a" * 40, "sha256:" + "b" * 64
        for owner in ("new-company", "old-company", "untrusted"):
            state = {generation: {service: {"reference": f"ghcr.io/{owner}/raspisys-{service}:{sha}@{digest}"}
                                  for service in ("api", "web")}
                     for generation in ("current", "previous")}
            context = dict(values, release_pi5_retention_existing_state=state)
            for expression in task["ansible.builtin.assert"]["that"][:4]:
                assert environment.compile_expression(expression)(**context) == (owner != "untrusted")
        for path, names in (
            ("release_pi5/tasks/prefetch.yml", ("release_pi5_api_image", "release_pi5_web_image")),
            ("release_pi5/tasks/business-hermes-answer-cache.yml", ("release_pi5_answer_cache_image",)),
        ):
            tasks = yaml.safe_load((base / path).read_text())
            for name in names:
                expression = next(item for task in tasks for item in task.get("ansible.builtin.assert", {}).get("that", [])
                                  if item.startswith(name + " is match"))
                service = {"release_pi5_api_image": "api", "release_pi5_web_image": "web",
                           "release_pi5_answer_cache_image": "hermes-answer-cache"}[name]
                tag = sha if "cache" in name else sha + "-" + "c" * 16
                for owner in ("new-company", "old-company", "untrusted"):
                    context = dict(values, **{name: f"ghcr.io/{owner}/raspisys-{service}:{tag}@{digest}"})
                    assert environment.compile_expression(expression)(**context) == (owner == "new-company")

        tasks = yaml.safe_load((base / "release_kiosk/tasks/prepare.yml").read_text())
        expression = next(item for item in tasks[0]["ansible.builtin.assert"]["that"]
                          if "release_kiosk_torque_image is match" in item)
        for owner in ("new-company", "old-company", "untrusted"):
            context = dict(values, release_kiosk_agent_services=["torque-agent"],
                           release_torque_cutover=True, release_sha=sha,
                           release_kiosk_torque_image=f"ghcr.io/{owner}/raspisys-torque-agent@{digest}")
            assert environment.compile_expression(expression)(**context) == (owner == "new-company")

    def test_pi4_ansible_copy_embeds_committed_owners(self):
        environment = _ansible_environment()
        source = (ROOT / "scripts/client/pi4-storage-maintenance.sh").read_text()
        environment.globals["lookup"] = lambda *args: source
        tasks = yaml.safe_load((ROOT / "infrastructure/ansible/roles/release_kiosk/tasks/prepare.yml").read_text())
        task = next(task for task in tasks if task["name"] == "Stage the Pi4 storage maintenance script")
        rendered = environment.from_string(task["ansible.builtin.copy"]["content"]).render(
            playbook_dir="unused", raspisys_github_owner="new-company",
            raspisys_historical_github_owners=["old-company"],
        )
        assert "GITHUB_OWNER=new-company" in rendered
        assert "HISTORICAL_GITHUB_OWNERS=(old-company)" in rendered
        prefix = rendered.split("ROLLBACK_REPOSITORY_PATTERN=", 1)[0]
        check = prefix + r'''
    [[ ghcr.io/new-company/raspisys-nfc-agent =~ ${RELEASE_REPOSITORY_PATTERN} ]] || exit 1
    [[ ghcr.io/old-company/raspisys-nfc-agent =~ ${RELEASE_REPOSITORY_PATTERN} ]] || exit 2
    [[ ghcr.io/untrusted/raspisys-nfc-agent =~ ${RELEASE_REPOSITORY_PATTERN} ]] && exit 3
    exit 0
    '''
        subprocess.run(["bash", "-c", check], check=True)

    def test_workflow_attestation_identities_match_verifiers(self):
        from scripts.deploy.rolling_release import signage_artifact_stage as signage
        for name in ("ci", "torque-release"):
            source = (ROOT / f".github/workflows/{name}.yml").read_text()
            document = yaml.safe_load(source)
            for job in document["jobs"].values():
                steps = job.get("steps", [])
                if "steps.ghcr.outputs.owner" in str(steps):
                    owner_step = next(step for step in steps if step.get("id") == "ghcr")
                    assert owner_step["shell"] == "bash"
                    assert '${GITHUB_REPOSITORY_OWNER,,}' in owner_step["run"]
            resolved = source.replace("${{ steps.ghcr.outputs.owner }}", contract.GITHUB_OWNER).replace(
                "${{ github.repository }}", contract.SOURCE_REPOSITORY)
            if name == "ci":
                assert f"subject-name: {signage.ARTIFACT_REPOSITORY}" in resolved
                assert f"predicate-type: {signage.PREDICATE_TYPE}" in resolved
                assert f'--exact-reference "{signage.ARTIFACT_REPOSITORY}@' in resolved
                assert signage.SOURCE_REPOSITORY == contract.SOURCE_REPOSITORY
                assert signage.SIGNER_IDENTITY == contract.SOURCE_REPOSITORY_URL + "/.github/workflows/ci.yml@refs/heads/main"
            else:
                assert f"subject-name: {contract.TORQUE_AGENT_REPOSITORY}" in resolved
                assert f"predicate_type={contract.TORQUE_ADOPTION_PREDICATE_TYPE}" in resolved
                assert f"EXACT_REFERENCE: {contract.TORQUE_AGENT_REPOSITORY}@" in resolved

