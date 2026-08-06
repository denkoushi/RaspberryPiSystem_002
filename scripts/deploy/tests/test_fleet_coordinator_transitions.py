import argparse
import base64
import copy
import json
import sys
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace


DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from rolling_release import coordinator  # noqa: E402
from rolling_release import planner as release_planner  # noqa: E402
from rolling_release import policy as release_policy  # noqa: E402
from rolling_release import readiness_policy  # noqa: E402
from rolling_release.adapter_registry import adapter_for_profile  # noqa: E402
from rolling_release.backends import ansible as ansible_backend  # noqa: E402
from rolling_release.activation import ActivationUncertainError  # noqa: E402
from rolling_release.cancellation import CancellationRequested  # noqa: E402
from rolling_release.errors import (  # noqa: E402
    TerminalManifestCapturePreMutationError,
)
from rolling_release.release_claims import (  # noqa: E402
    ClaimAuthority,
    ClaimKind,
    validate_host_claim_compatibility,
)
from rolling_release.terminal_adapters import GenericSystemdAdapter  # noqa: E402
from terminal_profile_registry import load_registry  # noqa: E402


OLD_SHA = "1" * 40
NEW_SHA = "2" * 40
ORCHESTRATOR_SHA = "3" * 40
FORWARD_VERIFICATION_ID = "a" * 32
ROLLBACK_VERIFICATION_ID = "b" * 32
ARTIFACT_DIGEST = "9" * 64
MANIFEST_DIGEST = "7" * 64
PAYLOAD_DIGEST = "6" * 64
OCI_DIGEST = "sha256:" + "5" * 64
PI3_SIGNAGE_SCOPE = "pi3-signage-artifact"
NEW_ARTIFACT_IDENTITY = f"git:{NEW_SHA}@sha256:{ARTIFACT_DIGEST}"
OLD_ARTIFACT_IDENTITY = f"git:{OLD_SHA}@sha256:{ARTIFACT_DIGEST}"
UNSET = object()
PRODUCTION_SIGNAGE_SCENARIOS = {
    "first-artifact-deploy": (
        "test_production_signage_first_artifact_deploy_transaction",
        {1, 2, 4, 8, 9, 10, 11, 12, 13},
    ),
    "historical-active-run-recovery": (
        "test_production_signage_historical_active_run_recovery_transaction",
        {2, 3, 4, 5, 6, 7, 8, 13},
    ),
    "rollback-to-legacy": (
        "test_production_signage_post_mutation_rollback_to_legacy_transaction",
        {4, 8, 9, 10, 11, 13},
    ),
    "rollback-to-artifact": (
        "test_production_signage_post_mutation_rollback_to_previous_artifact_transaction",
        {4, 8, 9, 10, 11, 13},
    ),
}


def _result_marker(prefix, value):
    encoded = base64.urlsafe_b64encode(
        json.dumps(value, sort_keys=True).encode("utf-8")
    ).decode("ascii")
    return prefix + encoded


class ProductionSignageFixture:
    """One production-shaped authority for the four Pi3 transactions."""

    host = "raspberrypi3"
    client_id = "raspberrypi3-signage1"
    file_digest = (
        "e3a8456179fa30d952ac3eff3022652fc38bc54979e642637d44f222a03d4f36"
    )
    runtime_digest = (
        "34243d39b555fc489f61d48fc78cde1456932e60338fd7baeaece15401852562"
    )
    pi4_hosts = (
        "raspi4-kensaku-stonebase01",
        "raspberrypi4",
        "raspi4-robodrill01",
        "raspi4-fjv60-80",
        "raspi4-sessaku-01",
        "raspi4-assembly-01",
    )

    def terminal(self):
        return {
            "host": self.host,
            "role": "signage",
            "terminalType": "signage",
            "clientId": self.client_id,
        }

    def inventory(self):
        return {
            "server": {"hosts": ["pi5"]},
            "clients": {"children": ["kiosk", "signage"]},
            "kiosk": {"hosts": list(self.pi4_hosts)},
            "signage": {"hosts": [self.host]},
            "kiosk_canary": {"hosts": [self.pi4_hosts[0]]},
            "signage_canary": {"hosts": [self.host]},
            "_meta": {
                "hostvars": {
                    "pi5": {"status_agent_client_id": "raspberrypi5-server"},
                    **{
                        host: {
                            "manage_kiosk_browser": True,
                            "status_agent_client_id": f"{host}-kiosk1",
                        }
                        for host in self.pi4_hosts
                    },
                    self.host: {"status_agent_client_id": self.client_id},
                }
            },
        }

    def file_paths(self, run_id):
        paths = ansible_backend._terminal_manifest_paths(
            "signage", "signageras3", "/home/signageras3", run_id
        )
        if len(paths) != 40:
            raise AssertionError("production signage manifest is not 40 paths")
        return paths

    def manifest_reference(self, run_id):
        units, docker_services = ansible_backend._terminal_runtime_contract(
            "signage"
        )
        return {
            "path": (
                "/var/lib/raspi-release/rollback-manifests/"
                f"{run_id}/{self.host}/manifest.json"
            ),
            "manifestSha256": self.file_digest,
            "count": len(self.file_paths(run_id)),
            "runtime": {
                "path": (
                    "/var/lib/raspi-release/rollback-runtime/"
                    f"{run_id}/{self.host}/manifest.json"
                ),
                "manifestSha256": self.runtime_digest,
                "unitCount": len(units),
                "dockerCount": len(docker_services),
            },
        }

    def capture_envelope(self, run_id):
        reference = self.manifest_reference(run_id)
        paths = self.file_paths(run_id)
        return {
            "version": 1,
            "remoteUser": "signageras3",
            "remoteHome": "/home/signageras3",
            "fileManifest": {
                "captured": True,
                "manifest": reference["path"],
                "manifestSha256": reference["manifestSha256"],
                "count": len(paths),
                "destinations": paths,
                "repository": None,
            },
            "runtimeManifest": {
                "captured": True,
                "manifest": reference["runtime"]["path"],
                "manifestSha256": reference["runtime"]["manifestSha256"],
                "unitCount": reference["runtime"]["unitCount"],
                "dockerCount": reference["runtime"]["dockerCount"],
                "rollbackTags": [],
            },
        }

    def file_preflight(self, run_id):
        reference = self.manifest_reference(run_id)
        return {
            "ready": True,
            "manifest": reference["path"],
            "manifestSha256": reference["manifestSha256"],
            "count": reference["count"],
            "repository": None,
            "issues": [],
        }

    def file_restore(self, run_id):
        reference = self.manifest_reference(run_id)
        paths = self.file_paths(run_id)
        run_paths = list(
            adapter_for_profile(
                "signage", runtime=None
            ).run_scoped_rollback_paths(run_id)
        )
        return {
            "restored": True,
            "manifest": reference["path"],
            "manifestSha256": reference["manifestSha256"],
            "count": len(paths),
            "destinations": paths,
            "absentDestinations": run_paths,
            "repository": None,
        }

    def runtime_preflight(self, run_id):
        reference = self.manifest_reference(run_id)["runtime"]
        return {
            "ready": True,
            "manifestSha256": reference["manifestSha256"],
            "unitCount": reference["unitCount"],
            "dockerCount": reference["dockerCount"],
            "runtimeHealth": rollback_runtime_health("signage"),
            "restoredReceipt": False,
            "requiresRuntimeReconciliation": True,
            "issues": [],
        }

    def runtime_restore(self, run_id):
        reference = self.manifest_reference(run_id)["runtime"]
        return {
            "restored": True,
            "manifestSha256": reference["manifestSha256"],
            "unitCount": reference["unitCount"],
            "dockerCount": reference["dockerCount"],
            "runtimeHealth": rollback_runtime_health("signage"),
        }

    def baseline(self, artifact_state="absent"):
        if artifact_state == "absent":
            return {
                "head": OLD_SHA,
                "artifactState": "absent",
                "artifactIdentity": None,
                "artifactSha256": None,
                "legacyRepositorySha": OLD_SHA,
            }
        if artifact_state == "installed":
            return {
                "head": OLD_SHA,
                "artifactState": "installed",
                "artifactIdentity": OLD_ARTIFACT_IDENTITY,
                "artifactSha256": ARTIFACT_DIGEST,
                "legacyRepositorySha": None,
            }
        raise AssertionError("unsupported production signage baseline")

    def kiosk_record(self):
        record = host_record("kiosk", OLD_SHA)
        record["releaseClaims"] = {
            "controlPlaneWeb": verified_claim(
                OLD_SHA,
                "kiosk-compiled-web-ready",
                verification_id=FORWARD_VERIFICATION_ID,
            ),
            "terminalRepository": verified_claim(
                OLD_SHA, "terminal-repository-probe"
            ),
        }
        return record

    def scope(self, fleet_state):
        inventory = self.inventory()
        terminals = release_policy.release_targets(inventory)
        targets = [
            {"host": "pi5", "role": "server"},
            *[
                {**target, "role": target["terminalType"]}
                for target in terminals
            ],
        ]
        classification = {
            "server": False,
            "kiosk": False,
            "signage": True,
            "migration": False,
            "affectedProfiles": ["signage"],
            "paths": [],
            "components": ["signage-role"],
        }
        classifications = {
            record["currentSha"]: classification
            for record in (fleet_state.get("fleet") or {}).values()
            if isinstance(record, dict)
            and record.get("evidence") == "verified"
            and isinstance(record.get("currentSha"), str)
        }
        decisions = release_policy.plan_target_decisions(
            targets,
            fleet_state.get("fleet") or {},
            NEW_SHA,
            classifications,
            inventory,
        )
        plan = release_planner.build_fleet_plan_payload(
            release_sha=NEW_SHA,
            decisions=decisions,
            full_fleet=False,
            limit="",
            canary_hold_policy=lambda *_args, **_kwargs: False,
            fleet_records=fleet_state.get("fleet") or {},
            typed_target_planning=True,
            activation_execution_enabled=True,
            verification_only_execution_enabled=True,
            executor_preflight_passed=True,
            release_claim_identities={NEW_SHA: NEW_ARTIFACT_IDENTITY},
        )
        terminal_by_host = {
            target["host"]: target
            for target in targets
            if target["role"] != "server"
        }
        executable = {
            work["host"]
            for work in plan["terminalWork"]
            if work["mutationRequired"]
            or work["activationRequired"]
            or work["verificationRequired"]
        }
        terminal_targets = [
            terminal_by_host[decision["host"]]
            for decision in decisions
            if decision["host"] in executable and decision["role"] != "server"
        ]
        plan["terminalTargets"] = terminal_targets
        plan["affectedProfiles"] = ["signage"]
        plan["classificationComponents"] = ["signage-role"]
        return plan, terminal_targets, classifications, []

    def scoped_release_authority(self):
        return {
            "releaseScope": PI3_SIGNAGE_SCOPE,
            "sourceSha": NEW_SHA,
            "exactReference": (
                f"{ansible_backend.signage_artifact_stage.ARTIFACT_REPOSITORY}"
                f"@{OCI_DIGEST}"
            ),
            "ociDigest": OCI_DIGEST,
            "artifactSha256": ARTIFACT_DIGEST,
            "manifestSha256": MANIFEST_DIGEST,
            "payloadDigest": PAYLOAD_DIGEST,
            "claimIdentity": NEW_ARTIFACT_IDENTITY,
        }

    def typed_scope(self, fleet_state):
        plan, targets, _classifications, _warnings = self.scope(fleet_state)
        plan["hosts"] = [
            decision
            for decision in plan["hosts"]
            if decision["role"] in {"server", "signage"}
        ]
        plan.update(
            {
                "releaseScope": PI3_SIGNAGE_SCOPE,
                "desiredRelease": self.scoped_release_authority(),
                "coordinator": {
                    "host": "pi5",
                    "role": "acquisition-relay",
                    "runtimeMutationRequired": False,
                },
            }
        )
        return plan, targets, {}, []

    def runtime(self, *, artifact_state="absent"):
        terminal = self.terminal()
        fleet_records = {
            "pi5": host_record("server", OLD_SHA),
            **{
                host: self.kiosk_record()
                for host in self.pi4_hosts
            },
            self.host: host_record("signage", OLD_SHA),
        }
        plan, targets, _classifications, _warnings = self.scope(
            {"fleet": fleet_records}
        )
        runtime = FakeRuntime(
            fleet=fleet_records,
            hosts=[
                {"host": "pi5", "role": "server"},
                *[
                    {
                        "host": host,
                        "role": "kiosk",
                        "terminalType": "kiosk",
                        "clientId": f"{host}-kiosk1",
                    }
                    for host in self.pi4_hosts
                ],
                terminal,
            ],
            plan=plan,
            targets=targets,
        )
        runtime.signage_release_baseline_result = self.baseline(artifact_state)
        runtime.inventory_json = lambda _inventory: self.inventory()
        runtime.build_fleet_scope = lambda **keywords: self.scope(
            keywords["fleet_state"]
        )
        return runtime

    def typed_runtime(self, *, artifact_state="absent"):
        runtime = self.runtime(artifact_state=artifact_state)
        runtime.plan, runtime.targets, _classifications, _warnings = (
            self.typed_scope(runtime.fleet)
        )

        def build_scope(**keywords):
            if (
                keywords.get("release_scope") != PI3_SIGNAGE_SCOPE
                or keywords.get("signage_oci_digest") != OCI_DIGEST
                or keywords.get("sha") != NEW_SHA
                or keywords.get("signage_artifact_sha256") != ARTIFACT_DIGEST
                or keywords.get("signage_manifest_sha256") != MANIFEST_DIGEST
                or keywords.get("signage_payload_digest") != PAYLOAD_DIGEST
                or keywords.get("selected") is not None
                or keywords.get("limit") != ""
                or keywords.get("full_fleet") is not False
            ):
                raise AssertionError("typed Signage scope input changed")
            return self.typed_scope(keywords["fleet_state"])

        runtime.build_fleet_scope = build_scope
        return runtime


class ProductionSignageTransport:
    """Isolate Ansible transport while preserving every structured boundary."""

    PROJECT = DEPLOY_DIR.parents[1]
    ANSIBLE_DIRECTORY = Path("/ansible")

    def __init__(self, fixture, events):
        self.fixture = fixture
        self.events = events
        self.calls = []

    @staticmethod
    def _option(action, name):
        values = action.split()
        return values[values.index(name) + 1]

    def run(self, command, **kwargs):
        self.calls.append((command, kwargs))
        action = command[-1]
        run_id = self._option(action, "--run-id")
        if "--file-root" in action and "--runtime-root" in action:
            self.events.append(f"producer:capture:{run_id}")
            return _result_marker(
                "TERMINAL_MANIFEST_CAPTURE_RESULT:",
                self.fixture.capture_envelope(run_id),
            )
        if "terminal-ready-probe.py" in action:
            self.events.append(f"producer:ready:{run_id}")
            if "--identity-mode" not in action:
                raise RuntimeError("signage ready identity mode is absent")
            mode = self._option(action, "--identity-mode")
            if mode == "artifact":
                if (
                    "--repo" in action
                    or self._option(action, "--artifact-sha256")
                    != ARTIFACT_DIGEST
                    or self._option(action, "--artifact-path")
                    != "/opt/raspisystem-signage/current/SIGNAGE-RELEASE.json"
                ):
                    raise RuntimeError("signage artifact ready binding is invalid")
            elif mode == "legacy-repository":
                if (
                    "--artifact-path" in action
                    or "--artifact-sha256" in action
                    or self._option(action, "--repo")
                    != "/opt/RaspberryPiSystem_002"
                ):
                    raise RuntimeError("legacy signage ready binding is invalid")
            else:
                raise RuntimeError("signage ready identity mode is invalid")
            self.events.append(f"producer:ready-mode:{run_id}:{mode}")
            return "TERMINAL_READY_OK:" + self._option(action, "--release-sha")
        is_runtime = "/rollback-runtime" in action
        if "preflight-restore" in action:
            self.events.append(
                f"producer:{'runtime' if is_runtime else 'file'}-preflight:{run_id}"
            )
            value = (
                self.fixture.runtime_preflight(run_id)
                if is_runtime
                else self.fixture.file_preflight(run_id)
            )
            prefix = (
                "TERMINAL_RUNTIME_MANIFEST_RESULT:"
                if is_runtime
                else "ROLLBACK_MANIFEST_RESULT:"
            )
            return _result_marker(prefix, value)
        if " restore " in f" {action} ":
            self.events.append(
                f"producer:{'runtime' if is_runtime else 'file'}-restore:{run_id}"
            )
            value = (
                self.fixture.runtime_restore(run_id)
                if is_runtime
                else self.fixture.file_restore(run_id)
            )
            prefix = (
                "TERMINAL_RUNTIME_MANIFEST_RESULT:"
                if is_runtime
                else "ROLLBACK_MANIFEST_RESULT:"
            )
            return _result_marker(prefix, value)
        raise AssertionError(f"unexpected production transport command: {action}")


def bind_production_signage_boundaries(runtime, fixture):
    transport = ProductionSignageTransport(fixture, runtime.events)

    def capture(inventory, target_spec, run_id, previous_sha):
        runtime.events.append(
            f"manifest:capture:{target_spec['host']}:{previous_sha}"
        )
        return ansible_backend.capture_terminal_manifest(
            inventory,
            target_spec,
            run_id,
            previous_sha,
            runtime=transport,
        )

    def preflight(inventory, target_spec, target, run_id):
        runtime.events.append(f"rollback:preflight:{target_spec['host']}")
        return ansible_backend.preflight_terminal_rollback(
            inventory, target_spec, target, run_id, runtime=transport
        )

    def rollback(inventory, target_spec, target, run_id):
        runtime.events.append(f"rollback:{target_spec['host']}")
        return ansible_backend.rollback_terminal(
            inventory, target_spec, target, run_id, runtime=transport
        )

    def prove_ready(*arguments, **keywords):
        return ansible_backend.prove_signage_ready(
            *arguments, runtime=transport, **keywords
        )

    runtime.capture_terminal_manifest = capture
    runtime.preflight_terminal_rollback = preflight
    runtime.rollback_terminal = rollback
    runtime.prove_signage_ready = prove_ready
    return transport


def host_record(role, sha):
    record = {
        "role": role,
        "desiredSha": sha,
        "currentSha": sha,
        "previousSha": None,
        "evidence": "verified",
        "verifiedAt": "2026-07-15T00:00:00Z",
        "lastRunId": "prior-run",
    }
    if role == "server":
        record.update(
            {
                "activeSlot": "blue",
                "apiImage": f"api:{sha}-aaaaaaaaaaaa",
                "webImage": f"web:{sha}-bbbbbbbbbbbb",
                "configDigest": "sha256:" + "a" * 64,
                "migrationDigest": "sha256:" + "b" * 64,
            }
        )
    return record


def verified_claim(sha, authority, *, verification_id=None):
    return {
        "expectedIdentity": sha,
        "observedIdentity": sha,
        "authority": authority,
        "verificationId": verification_id,
        "state": "verified",
        "observedAt": "2026-07-15T00:00:00Z",
        "lastRunId": "prior-run",
    }


def decision(host, role, *, current=OLD_SHA, targeted=True, reason="role impact"):
    return {
        "host": host,
        "role": role,
        "desiredSha": NEW_SHA if targeted else current,
        "currentSha": current,
        "evidence": "verified",
        "targetReason": reason,
        "targeted": targeted,
    }


def rollback_manifest(run_id, host, terminal_type="kiosk"):
    return {
        "path": (
            "/var/lib/raspi-release/rollback-manifests/"
            f"{run_id}/{host}/manifest.json"
        ),
        "manifestSha256": "c" * 64,
        "count": 12,
        "runtime": {
            "path": (
                "/var/lib/raspi-release/rollback-runtime/"
                f"{run_id}/{host}/manifest.json"
            ),
            "manifestSha256": "d" * 64,
            "unitCount": 5 if terminal_type == "kiosk" else 11,
            "dockerCount": 2 if terminal_type == "kiosk" else 0,
        },
    }


def rollback_runtime_health(terminal_type="kiosk"):
    if terminal_type == "signage":
        return {
            "activeSystemdUnits": [
                "lightdm.service",
                "status-agent.timer",
                "signage-lite.service",
                "signage-lite-update.timer",
                "signage-lite-watchdog.timer",
                "signage-daily-reboot.timer",
            ],
            "runningDockerServices": [],
        }
    return {
        "activeSystemdUnits": [
            "lightdm.service",
            "status-agent.timer",
            "kiosk-browser.service",
        ],
        "runningDockerServices": ["nfc-agent", "barcode-agent"],
    }


def synthetic_terminal_profile():
    base = load_registry().profile("kiosk")
    return replace(
        base,
        id="inspection-panel",
        inventory_group="inspection_panels",
        impact_component="inspection-panel-role",
        canary_group="inspection_panel_canary",
        playbook="playbooks/deploy-terminal-profile.yml",
        adapter_options=replace(
            base.adapter_options,
            ready_authority="terminal",
            required_claims=("terminalRepository",),
            activation_strategy_id=None,
        ),
    )


def server_config_manifest(run_id, host="pi5"):
    return {
        "path": (
            "/var/lib/raspi-release/rollback-manifests/"
            f"{run_id}/{host}/manifest.json"
        ),
        "manifestSha256": "e" * 64,
        "count": 3,
    }


class FakeToken:
    def __init__(self, events, cancel_at=None):
        self.events = events
        self.cancel_at = cancel_at

    def checkpoint(self, name):
        self.events.append(f"checkpoint:{name}")
        if name == self.cancel_at:
            raise CancellationRequested("operator stop", name)


class FakeReleaseState:
    def __init__(self, runtime, _path, payload):
        self.runtime = runtime
        self.payload = payload

    def save(self, *, before_terminal_persist=None):
        effective_state = self.payload.get("state")
        if effective_state == "success" and self.runtime.cancel_at_finish:
            effective_state = "cancelled"
        if before_terminal_persist is not None:
            self.payload.update(before_terminal_persist(effective_state) or {})
        self.payload["state"] = effective_state
        targets = ",".join(
            f"{target['host']}={target['state']}"
            for target in self.payload.get("targets") or []
        )
        self.runtime.events.append(
            "legacy:save:"
            f"{self.payload.get('state')}:{self.payload.get('phase')}:{targets}"
        )

    def target(self, host):
        return next(
            target for target in self.payload["targets"] if target["host"] == host
        )


class FakeRuntime:
    ANSIBLE_DIRECTORY = Path("/ansible")
    READY_ACK_TIMEOUT_SECONDS = 90

    def __init__(self, *, fleet, hosts, plan, targets):
        self.events = []
        self.os = SimpleNamespace(environ={})
        self.fleet = {
            "generation": 0,
            "activeRun": None,
            "lastRun": None,
            "fleet": copy.deepcopy(fleet),
        }
        self.hosts = hosts
        self.plan = plan
        self.targets = targets
        self.states = []
        self.scope_kwargs = None
        self.playbook_error = None
        self.rollback_ok = True
        self.rollback_preflight_by_host = {}
        self.terminal_observation_error = None
        self.terminal_observation_failures = None
        self.host_config_error = None
        self.server_config_capture_error = None
        self.server_config_restore_error = None
        self.deployed_sha = {}
        self.pi5_release_sha = None
        self.cancel_at_finish = False
        self.ready_acknowledgements = {}
        self.ready_ack_error = None
        self.ready_ack_release_override = None
        self.ready_ack_verification_override = None
        self.active_verification_ids = {}
        self.fleet_verified_error_host = None
        self.terminal_pipelining_preflight_error = None
        self.manifest_capture_error = None
        self.repository_baseline_result = None
        self.signage_release_baseline_result = None
        self.repository_baseline_strict = []
        self.source_stage_error = None
        self.source_cleanup_error = None
        self.runtime_cleanup_error = None
        self.pi5_reconcile_error = None
        self.prestage_error = None
        self.signage_refresh_error = None
        self.maintenance_ack = True
        self.state_command_error_once_action = None
        self.abandoned_run_id = None
        self.prior_runs = {}
        self.observed_runtime_health = []
        self.activation_error = None
        self.activation_reconciliation_state = "succeeded"
        self.staged_release_override = {}

    def _snapshot(self):
        return copy.deepcopy(self.fleet)

    def _bump(self):
        self.fleet["generation"] += 1
        return self._snapshot()

    def fleet_begin_run(
        self, run_id, sha, inventory, *, release_scope=None
    ):
        self.events.append("fleet:begin")
        self.fleet["activeRun"] = {
            "runId": run_id,
            "desiredSha": sha,
            "inventory": inventory,
            **({"kind": release_scope} if release_scope is not None else {}),
        }
        return self._bump(), self.abandoned_run_id

    def fleet_finish_run(self, run_id, status):
        self.events.append(f"fleet:finish:{status}")
        self.fleet["lastRun"] = {"runId": run_id, "status": status}
        self.fleet["activeRun"] = None
        return self._bump()

    def fleet_mark_unknown(
        self, host, role, desired_sha, run_id, *, release_claims=None
    ):
        self.events.append(f"fleet:unknown:{host}")
        prior = self.fleet["fleet"].get(host) or {}
        prior_current = prior.get("currentSha")
        self.fleet["fleet"][host] = {
            "role": role,
            "desiredSha": desired_sha,
            "currentSha": None,
            "previousSha": (
                prior_current
                if prior_current and prior_current != desired_sha
                else prior.get("previousSha")
            ),
            "evidence": "unknown",
            "verifiedAt": None,
            "lastRunId": run_id,
            **(
                {"releaseClaims": copy.deepcopy(release_claims)}
                if release_claims is not None
                else {}
            ),
            **(
                {
                    "activationCapabilities": copy.deepcopy(
                        prior["activationCapabilities"]
                    )
                }
                if "activationCapabilities" in prior
                else {}
            ),
        }
        return self._bump()

    def fleet_mark_verified(
        self,
        host,
        role,
        desired_sha,
        current_sha,
        run_id,
        *,
        previous_sha=UNSET,
        observation=None,
    ):
        self.events.append(f"fleet:verified:{host}:{current_sha}")
        if host == self.fleet_verified_error_host:
            raise RuntimeError("fleet persistence unavailable")
        prior = self.fleet["fleet"].get(host) or {}
        if previous_sha is UNSET:
            previous_sha = prior.get("currentSha") or prior.get("previousSha")
        self.fleet["fleet"][host] = {
            "role": role,
            "desiredSha": desired_sha,
            "currentSha": current_sha,
            "previousSha": previous_sha,
            "evidence": "verified",
            "verifiedAt": "2026-07-15T00:00:00Z",
            "lastRunId": run_id,
            **(
                {
                    "activeSlot": observation.get("activeSlot"),
                    "apiImage": observation.get("apiImage"),
                    "webImage": observation.get("webImage"),
                    "configDigest": observation.get("configDigest"),
                    "migrationDigest": observation.get("migrationDigest"),
                }
                if role == "server"
                else {}
            ),
            **(
                {
                    "activationCapabilities": copy.deepcopy(
                        observation["activationCapabilities"]
                    )
                }
                if isinstance(observation, dict)
                and "activationCapabilities" in observation
                else (
                    {
                        "activationCapabilities": copy.deepcopy(
                            prior["activationCapabilities"]
                        )
                    }
                    if "activationCapabilities" in prior
                    else {}
                )
            ),
            **(
                {
                    "releaseClaims": copy.deepcopy(
                        observation["releaseClaims"]
                    )
                }
                if isinstance(observation, dict)
                and "releaseClaims" in observation
                else (
                    {"releaseClaims": copy.deepcopy(prior["releaseClaims"])}
                    if "releaseClaims" in prior
                    else {}
                )
            ),
        }
        return self._bump()

    def ReleaseState(self, path, payload):
        state = FakeReleaseState(self, path, payload)
        self.states.append(state)
        return state

    def status_file(self, run_id):
        return Path("/unused") / f"{run_id}.json"

    def read_release_run(self, run_id):
        self.events.append(f"legacy:read:{run_id}")
        return copy.deepcopy(self.prior_runs.get(run_id))

    def utc_now(self):
        return "2026-07-15T00:00:00Z"

    def inventory_json(self, inventory):
        self.events.append(f"inventory:{inventory}")
        return {"inventory": True}

    def inventory_server_identity(self, _inventory):
        return {"host": "pi5", "clientId": "raspberrypi5-server"}

    def selected_hosts(self, _inventory, _limit):
        return None

    def release_hosts(self, _inventory):
        return copy.deepcopy(self.hosts)

    def reconcile_pi5_candidate_workload(self):
        self.events.append("pi5:reconcile-candidate")
        if self.pi5_reconcile_error is not None:
            raise self.pi5_reconcile_error

    def build_fleet_scope(self, **kwargs):
        self.scope_kwargs = kwargs
        return copy.deepcopy(self.plan), copy.deepcopy(self.targets), {}, []

    def observe_pi5_evidence(self, expected_sha):
        self.events.append(f"observe:server:{expected_sha}")
        sha = expected_sha if expected_sha is not None else OLD_SHA
        return {
            "currentSha": sha,
            "activeSlot": "green",
            "apiImage": f"api:{sha}-aaaaaaaaaaaa",
            "webImage": f"web:{sha}-bbbbbbbbbbbb",
            "configDigest": "sha256:" + "c" * 64,
            "migrationDigest": "sha256:" + "d" * 64,
        }

    def observe_terminal_evidence(
        self,
        _inventory,
        host,
        _role,
        client_id,
        *,
        runtime_health=None,
    ):
        self.events.append(f"observe:terminal:{host}")
        self.observed_runtime_health.append(
            (host, copy.deepcopy(runtime_health))
        )
        if (
            self.terminal_observation_error is not None
            and self.terminal_observation_failures is not None
            and self.terminal_observation_failures > 0
        ):
            self.terminal_observation_failures -= 1
            raise self.terminal_observation_error
        if (
            self.terminal_observation_error is not None
            and self.terminal_observation_failures is None
        ):
            raise self.terminal_observation_error
        current = (
            OLD_SHA
            if any(event == f"rollback:{host}" for event in self.events)
            else self.deployed_sha.get(host, NEW_SHA)
        )
        result = {
            "currentSha": current,
            "services": ["required.service"],
            "authenticatedEndpoint": True,
            "statusClientId": client_id,
        }
        if _role == "signage":
            result.update(
                {
                    "artifactSha256": ARTIFACT_DIGEST,
                    "releaseArtifactIdentity": (
                        f"git:{current}@sha256:{ARTIFACT_DIGEST}"
                    ),
                }
            )
        return result

    def capture_server_config_manifest(self, _inventory, host, run_id):
        self.events.append(f"pi5:config-capture:{host}:{run_id}")
        if self.server_config_capture_error is not None:
            raise self.server_config_capture_error
        return server_config_manifest(run_id, host)

    def restore_server_config_manifest(self, _inventory, host, run_id, manifest):
        self.events.append(f"pi5:config-restore:{host}:{run_id}")
        if self.server_config_restore_error is not None:
            raise self.server_config_restore_error
        return {
            "restored": True,
            "manifest": manifest["path"],
            "manifestSha256": manifest["manifestSha256"],
            "count": manifest["count"],
        }

    def converge_server_config(self, _inventory, host, sha, _run_id, manifest):
        if manifest != server_config_manifest(_run_id, host):
            raise AssertionError("server config convergence lacks sealed manifest")
        self.events.append(f"pi5:host-config:{host}:{sha}")
        if self.host_config_error is not None:
            raise self.host_config_error

    def ensure_pi5_release(self, sha, state):
        self.events.append("pi5:ensure")
        self.pi5_release_sha = sha
        state.payload["pi5"] = {
            "state": "stable",
            "candidate": {
                "api": f"api:{sha}-aaaaaaaaaaaa",
                "web": f"web:{sha}-bbbbbbbbbbbb",
            },
        }

    def remote_previous_sha(self, _inventory, host):
        self.events.append(f"terminal:previous:{host}")
        return OLD_SHA

    def preflight_terminal_ansible_pipelining(self, _inventory, host):
        self.events.append(f"terminal:pipelining-preflight:{host}")
        if self.terminal_pipelining_preflight_error is not None:
            raise self.terminal_pipelining_preflight_error

    def prepare_terminal_repository(
        self, _inventory, host, *, strict_read_only=False
    ):
        self.events.append(f"terminal:baseline:{host}")
        self.repository_baseline_strict.append((host, strict_read_only))
        return copy.deepcopy(
            self.repository_baseline_result
            or {"head": OLD_SHA, "repairedLegacyDocs": False, "count": 0}
        )

    def prepare_signage_release_identity(self, _inventory, host):
        self.events.append(f"signage:baseline:{host}")
        self.repository_baseline_strict.append((host, True))
        return copy.deepcopy(
            self.signage_release_baseline_result
            or {
                "head": OLD_SHA,
                "artifactState": "absent",
                "artifactIdentity": None,
                "artifactSha256": None,
                "legacyRepositorySha": OLD_SHA,
            }
        )

    def signage_release_artifact_identity(self, revision):
        return f"git:{revision}@sha256:{ARTIFACT_DIGEST}"

    def capture_signage_artifact_baseline(
        self, _inventory, target_spec, run_id, previous_sha
    ):
        if self.manifest_capture_error is not None:
            raise self.manifest_capture_error
        self.events.append(f"stage3:capture:{target_spec['host']}:{run_id}")
        installed = (
            isinstance(self.signage_release_baseline_result, dict)
            and self.signage_release_baseline_result.get("artifactState") == "installed"
        )
        health = rollback_runtime_health("signage")
        return {
            "schemaVersion": 1,
            "kind": "signage-artifact-baseline",
            "pointerWasPresent": installed,
            "previousRelease": ARTIFACT_DIGEST if installed else "legacy-" + "8" * 64,
            "previousReleaseKind": "artifact" if installed else "legacy",
            "previousReleaseManifestSha256": "6" * 64,
            "previousSourceSha": previous_sha,
            "previousArtifactSha256": ARTIFACT_DIGEST if installed else None,
            "legacyRepositorySha": None if installed else previous_sha,
            "runtimeHealth": health,
            "runtime": {
                "manifestSha256": "5" * 64,
                "unitCount": len(health["activeSystemdUnits"]),
                "dockerCount": 0,
            },
            "requireRootOwner": True,
        }

    def stage_signage_artifact_candidate(
        self,
        _inventory,
        host,
        revision,
        previous_sha,
        run_id,
        *,
        release_authority=None,
    ):
        self.events.append(f"stage3:stage:{host}:{run_id}")
        if self.source_stage_error is not None:
            self.events.append(f"stage3:internal-cleanup:{host}:{run_id}")
            raise self.source_stage_error
        reference = {
            "schemaVersion": 1,
            "runId": run_id,
            "host": host,
            "previousSha": previous_sha,
            "sourceSha": revision,
            "artifactSha256": ARTIFACT_DIGEST,
            "manifestSha256": MANIFEST_DIGEST,
            "payloadDigest": PAYLOAD_DIGEST,
            "ociDigest": OCI_DIGEST,
            "release": ARTIFACT_DIGEST,
            "releaseKind": "artifact",
            "releaseManifestSha256": "4" * 64,
            "stageRunPath": f"/var/tmp/raspisystem-signage-stage/{run_id}",
            "readyPath": f"/var/tmp/raspisystem-signage-stage/{run_id}/ready",
        }
        reference.update(self.staged_release_override)
        if release_authority is not None:
            self.events.append(f"stage3:scoped-authority:{host}:{run_id}")
            if release_authority.get("releaseScope") != PI3_SIGNAGE_SCOPE:
                raise AssertionError("typed Signage stage lacks release authority")
        return reference

    def cleanup_signage_artifact_candidate(self, _inventory, host, reference):
        self.events.append(f"stage3:candidate-cleanup:{host}:{reference['runId']}")
        if self.source_cleanup_error is not None:
            raise self.source_cleanup_error
        return {
            "schemaVersion": 1,
            "status": "passed",
            "removedPaths": [reference["stageRunPath"]],
            "stageResidue": False,
            "currentRelease": None,
        }

    def apply_signage_artifact_candidate(
        self, _inventory, host, revision, run_id, reference, baseline
    ):
        if baseline.get("kind") != "signage-artifact-baseline":
            raise AssertionError("stage3 apply lacks pointer baseline")
        if reference.get("runId") != run_id:
            raise AssertionError("stage3 apply lacks staged identity")
        self.events.append(f"playbook:{host}")
        if self.playbook_error is not None:
            raise self.playbook_error
        self.deployed_sha[host] = revision

    def preflight_signage_artifact_rollback(
        self, _inventory, target_spec, target, run_id
    ):
        host = target_spec["host"]
        self.events.append(f"stage3:rollback-preflight:{host}:{run_id}")
        selected = self.rollback_preflight_by_host.get(host)
        if isinstance(selected, Exception):
            raise selected
        if selected is not None:
            return copy.deepcopy(selected)
        return {
            "ready": True,
            "issues": [],
            "runtimeHealth": copy.deepcopy(target["rollbackManifest"]["runtimeHealth"]),
            "fileManifestReady": True,
            "runtimeManifestReady": True,
            "restoredReceipt": False,
            "requiresRuntimeReconciliation": False,
        }

    def rollback_signage_artifact(self, _inventory, target_spec, target, run_id):
        host = target_spec["host"]
        self.events.append(f"stage3:rollback:{host}:{run_id}")
        if not self.rollback_ok:
            target["rollback"] = "failed: injected rollback failure"
            return False
        target["rollbackRuntimeHealth"] = copy.deepcopy(
            target["rollbackManifest"]["runtimeHealth"]
        )
        target["rollback"] = "success"
        self.deployed_sha[host] = target["previousSha"]
        return True

    def cleanup_signage_artifact_release(
        self, _inventory, target_spec, target, run_id, outcome
    ):
        host = target_spec["host"]
        self.events.append(f"stage3:cleanup:{host}:{run_id}:{outcome}")
        if self.runtime_cleanup_error is not None:
            raise self.runtime_cleanup_error
        return {
            "cleaned": True,
            "alreadyClean": False,
            "manifestSha256": target["rollbackManifest"]["runtime"]["manifestSha256"],
            "tagCount": 0,
            "outcome": outcome,
        }

    def stage_terminal_candidate_source(
        self, _inventory, host, revision, previous_sha, run_id
    ):
        self.events.append(f"source:stage:{host}")
        if self.source_stage_error is not None:
            self.events.append(f"source:internal-cleanup:{host}:{run_id}")
            raise self.source_stage_error
        return {
            "schemaVersion": 1,
            "runId": run_id,
            "host": host,
            "previousSha": previous_sha,
            "profile": "signage",
            "sourceSha": revision,
            "artifactSha256": ARTIFACT_DIGEST,
            "pathManifestSha256": "7" * 64,
            "pathCount": 6,
            "size": 1024,
            "finalPath": f"/var/tmp/raspi-pi3-signage-{run_id}.pyz",
            "installPath": "/usr/local/bin/raspi-signage-status-agent.pyz",
        }

    def cleanup_terminal_candidate_source(
        self,
        _inventory,
        host,
        reference,
    ):
        run_id = reference["runId"]
        self.events.append(f"source:cleanup:{host}:{run_id}")
        if self.source_cleanup_error is not None:
            raise self.source_cleanup_error
        return {"state": "clean", "residue": False}

    def probe_terminal_release_evidence(
        self,
        _inventory,
        host,
        client_id,
        services,
        *,
        expected_agents=(),
        check_status_agent_result=True,
        signage_artifact=False,
    ):
        del check_status_agent_result
        self.events.append(f"observe:terminal:{host}")
        self.observed_runtime_health.append((host, None))
        if (
            self.terminal_observation_error is not None
            and self.terminal_observation_failures is not None
            and self.terminal_observation_failures > 0
        ):
            self.terminal_observation_failures -= 1
            raise self.terminal_observation_error
        if (
            self.terminal_observation_error is not None
            and self.terminal_observation_failures is None
        ):
            raise self.terminal_observation_error
        current = OLD_SHA if any(
            event == f"rollback:{host}" for event in self.events
        ) else self.deployed_sha.get(host, NEW_SHA)
        result = {
            "currentSha": current,
            "services": services,
            "oneshotServices": ["status-agent.service"],
            "authenticatedEndpoint": True,
            "statusClientId": client_id,
            "agentContainers": list(expected_agents),
            "authenticatedAgentEndpoints": [],
            "pcscdRequired": False,
        }
        if signage_artifact:
            baseline = self.signage_release_baseline_result or {}
            identity = (
                baseline.get("artifactIdentity")
                if any(event == f"rollback:{host}" for event in self.events)
                else f"git:{current}@sha256:{ARTIFACT_DIGEST}"
            )
            if not isinstance(identity, str):
                raise RuntimeError("signage artifact is absent")
            result["artifactSha256"] = identity.rsplit(":", 1)[1]
            result["releaseArtifactIdentity"] = identity
        return result

    def probe_signage_endpoints(self, _inventory, host):
        self.events.append(f"signage:endpoints:{host}")
        return {
            "signageEndpointAuthenticated": True,
            "signageImageSha256": "e" * 64,
        }

    def capture_terminal_manifest(
        self, _inventory, target_spec, run_id, previous_sha
    ):
        host = target_spec["host"]
        self.events.append(f"manifest:capture:{host}:{previous_sha}")
        if self.manifest_capture_error is not None:
            raise self.manifest_capture_error
        return rollback_manifest(run_id, host, target_spec.get("terminalType"))

    def should_issue_terminal_notice(self, **_kwargs):
        return False

    def terminal_notice_skip_reason(self, **_kwargs):
        return "test"

    def state_command(self, *arguments):
        self.events.append("status:" + ":".join(arguments))
        if arguments[0] == self.state_command_error_once_action:
            self.state_command_error_once_action = None
            raise RuntimeError(f"status {arguments[0]} unavailable")

    def prestage_signage_maintenance(self, *_args):
        self.events.append("signage:prestage")
        if self.prestage_error is not None:
            raise self.prestage_error

    def prove_signage_ready(
        self,
        _inventory,
        host,
        run_id,
        client_id,
        release_sha,
        verification_id,
        *,
        identity_mode,
        artifact_sha256=None,
    ):
        if identity_mode == "artifact":
            if artifact_sha256 != ARTIFACT_DIGEST:
                raise AssertionError("signage artifact ready digest is not exact")
        elif identity_mode != "legacy-repository" or artifact_sha256 is not None:
            raise AssertionError("signage ready identity mode is malformed")
        self.events.append(
            "signage:ready-proof:"
            f"{host}:{run_id}:{client_id}:{release_sha}:{verification_id}"
        )

    def refresh_signage_after_maintenance(self, _inventory, host, run_id):
        self.events.append(f"signage:refresh:{host}:{run_id}")
        if self.signage_refresh_error is not None:
            raise self.signage_refresh_error
        return {
            "signageEndpointAuthenticated": True,
            "signageImageSha256": "e" * 64,
            "maintenanceArtifactReplaced": True,
        }

    def active_verification_id(
        self, run_id, client_id, *, release_sha, rollback
    ):
        verification_id = (
            ROLLBACK_VERIFICATION_ID if rollback else FORWARD_VERIFICATION_ID
        )
        self.active_verification_ids[(run_id, client_id)] = verification_id
        self.events.append(
            f"status:verification:{client_id}:{release_sha}:{verification_id}"
        )
        return verification_id

    def wait_for_ack(self, run_id, client_id, *_args, **kwargs):
        if kwargs.get("phase") == "ready":
            if (
                self.ready_ack_error is not None
                and kwargs.get("cancellable", True)
            ):
                raise self.ready_ack_error
            self.ready_acknowledgements[(run_id, client_id)] = {
                "ready": {
                    "acknowledgedAt": "2026-07-15T00:00:00Z",
                    "releaseSha": (
                        self.ready_ack_release_override
                        or kwargs["release_sha"]
                    ),
                    "verificationId": (
                        self.ready_ack_verification_override
                        or kwargs["verification_id"]
                    ),
                }
            }
        elif kwargs.get("phase") == "maintenance":
            return self.maintenance_ack
        return True

    def acknowledgement_record(self, run_id, client_id):
        return copy.deepcopy(
            self.ready_acknowledgements.get((run_id, client_id))
        )

    def playbook(self, _inventory, host, sha, _run_id):
        self.events.append(f"playbook:{host}")
        if self.playbook_error is not None:
            raise self.playbook_error
        self.deployed_sha[host] = sha

    def apply_terminal_profile(
        self,
        inventory,
        host,
        revision,
        run_id,
        profile,
        *,
        staged_source=None,
    ):
        if profile.id == "signage" and staged_source is None:
            raise AssertionError("signage apply lacks staged source")
        if profile.id != "signage" and staged_source is not None:
            raise AssertionError("non-signage apply received staged source")
        self.playbook(inventory, host, revision, run_id)

    def activate_kiosk_web(self, _inventory, target_spec, _target, run_id):
        host = target_spec["host"]
        self.events.append(f"activation:submit:{host}:{run_id}")
        if self.activation_error is not None:
            raise self.activation_error
        return {
            "strategyId": "kiosk-web-activation-v1",
            "operationUnit": "raspi-kiosk-web-test.service",
            "targetUnit": "kiosk-browser.service",
            "state": "succeeded",
            "activeState": "active",
            "result": "success",
            "execMainStatus": 0,
        }

    def reconcile_kiosk_web_activation(
        self, _inventory, target_spec, _target, run_id
    ):
        host = target_spec["host"]
        self.events.append(f"activation:reconcile:{host}:{run_id}")
        state = self.activation_reconciliation_state
        return {
            "strategyId": "kiosk-web-activation-v1",
            "operationUnit": "raspi-kiosk-web-test.service",
            "targetUnit": "kiosk-browser.service",
            "state": state,
            "activeState": "activating" if state == "running" else "active",
            "result": "success" if state == "succeeded" else "exit-code",
            "execMainStatus": 0 if state == "succeeded" else 1,
        }

    def cleanup_kiosk_web_activation(
        self, _inventory, target_spec, _target, run_id
    ):
        host = target_spec["host"]
        self.events.append(f"activation:cleanup:{host}:{run_id}")
        return {
            "cleaned": True,
            "alreadyClean": False,
            "strategyId": "kiosk-web-activation-v1",
            "operationUnit": "raspi-kiosk-web-test.service",
            "manifestSha256": "d" * 64,
        }

    def rollback_terminal(self, _inventory, target_spec, target, _run_id):
        self.events.append(f"rollback:{target_spec['host']}")
        if self.rollback_ok:
            target["rollbackRuntimeHealth"] = rollback_runtime_health(
                target_spec.get("terminalType")
            )
            if target_spec.get("terminalType") == "signage":
                cleanup_paths = adapter_for_profile(
                    "signage", runtime=None
                ).run_scoped_rollback_paths(_run_id)
                target["stagedSourceCleanup"] = {
                    "state": "clean",
                    "residue": False,
                    "authority": "rollback-manifest",
                    "manifestSha256": "d" * 64,
                    "paths": list(cleanup_paths),
                }
        return self.rollback_ok

    def preflight_terminal_rollback(
        self, _inventory, target_spec, _target, _run_id
    ):
        host = target_spec["host"]
        self.events.append(f"rollback:preflight:{host}")
        selected = self.rollback_preflight_by_host.get(host)
        if isinstance(selected, Exception):
            raise selected
        if selected is not None:
            return copy.deepcopy(selected)
        return {
            "ready": True,
            "issues": [],
            "fileManifestReady": True,
            "runtimeManifestReady": True,
            "runtimeHealth": rollback_runtime_health(
                target_spec.get("terminalType")
            ),
            "restoredReceipt": False,
            "requiresRuntimeReconciliation": True,
        }

    def cleanup_terminal_rollback(
        self, _inventory, target_spec, _target, run_id, outcome
    ):
        host = target_spec["host"]
        self.events.append(f"manifest:cleanup:{host}:{run_id}:{outcome}")
        if self.runtime_cleanup_error is not None:
            raise self.runtime_cleanup_error
        return {
            "cleaned": True,
            "alreadyClean": False,
            "manifestSha256": "d" * 64,
            "tagCount": 2 if target_spec.get("terminalType") == "kiosk" else 0,
            "outcome": outcome,
        }

    def should_hold_after_canary(self, *_args, **_kwargs):
        return False

    def wait_for_canary_hold(self, *_args):
        raise AssertionError("unexpected canary hold")


def args(**overrides):
    values = {
        "inventory": "inventory.yml",
        "limit": "",
        "run_id": "run-1",
        "branch": "main",
        "sha": NEW_SHA,
        "emergency_override": False,
        "reason": None,
        "skip_canary_hold": True,
        "canary_hold_timeout": 60,
        "full_fleet": False,
        "reverify_selected": False,
        "expected_server_client_id": "raspberrypi5-server",
        "release_scope": None,
        "signage_oci_digest": None,
    }
    if overrides.get("release_scope") == PI3_SIGNAGE_SCOPE:
        overrides.setdefault("signage_source_sha", NEW_SHA)
        overrides.setdefault("signage_artifact_sha256", ARTIFACT_DIGEST)
        overrides.setdefault("signage_manifest_sha256", MANIFEST_DIGEST)
        overrides.setdefault("signage_payload_digest", PAYLOAD_DIGEST)
    values.update(overrides)
    return argparse.Namespace(**values)


class FleetCoordinatorTransitionTest(unittest.TestCase):
    def _readiness_plan(self, runtime, *, terminal_work=None):
        return {
            **runtime.plan,
            "desiredSha": NEW_SHA,
            "classificationComponents": ["client-role"],
            "fullFleet": False,
            "reverifySelected": False,
            "typedTargetPlanningEnabled": True,
            **(
                {"terminalWork": terminal_work}
                if terminal_work is not None
                else {}
            ),
        }

    def test_production_signage_transaction_matrix_covers_all_13_boundaries(self):
        covered = set()
        for _scenario, (test_name, boundaries) in (
            PRODUCTION_SIGNAGE_SCENARIOS.items()
        ):
            self.assertTrue(hasattr(type(self), test_name), test_name)
            self.assertTrue(boundaries)
            self.assertTrue(boundaries <= set(range(1, 14)))
            covered.update(boundaries)
        self.assertEqual(covered, set(range(1, 14)))

    def test_production_signage_first_artifact_deploy_transaction(self):
        fixture = ProductionSignageFixture()
        runtime = fixture.typed_runtime(artifact_state="absent")
        bind_production_signage_boundaries(runtime, fixture)
        non_pi3_before = copy.deepcopy(
            {
                host: runtime.fleet["fleet"][host]
                for host in ("pi5", *fixture.pi4_hosts)
            }
        )

        self.assertEqual(
            coordinator.execute(
                args(
                    sha=ORCHESTRATOR_SHA,
                    release_scope=PI3_SIGNAGE_SCOPE,
                    signage_oci_digest=OCI_DIGEST,
                ),
                runtime=runtime,
                token=FakeToken(runtime.events),
            ),
            0,
        )

        capture = runtime.events.index("stage3:capture:raspberrypi3:run-1")
        maintenance = runtime.events.index(
            "status:put:--run-id:run-1:--clients:raspberrypi3-signage1:"
            "--terminal-type:signage"
        )
        apply = runtime.events.index("playbook:raspberrypi3")
        ready = runtime.events.index("producer:ready:run-1")
        finish = runtime.events.index("fleet:finish:success")
        self.assertLess(capture, maintenance)
        self.assertLess(maintenance, apply)
        self.assertLess(apply, ready)
        self.assertLess(ready, finish)
        claim = runtime.fleet["fleet"][fixture.host]["releaseClaims"][
            "signageReleaseArtifact"
        ]
        self.assertEqual(claim["expectedIdentity"], NEW_ARTIFACT_IDENTITY)
        self.assertEqual(claim["observedIdentity"], NEW_ARTIFACT_IDENTITY)
        self.assertIsNone(runtime.fleet["activeRun"])
        self.assertIn(
            "stage3:scoped-authority:raspberrypi3:run-1", runtime.events
        )
        self.assertNotIn("pi5:reconcile-candidate", runtime.events)
        self.assertFalse(
            any(
                event.startswith(("observe:server:", "pi5:config-", "pi5:ensure"))
                for event in runtime.events
            )
        )
        state = runtime.states[-1].payload
        self.assertEqual(state["releaseScope"], PI3_SIGNAGE_SCOPE)
        self.assertEqual(state["releaseSha"], NEW_SHA)
        self.assertEqual(state["orchestratorSha"], ORCHESTRATOR_SHA)
        self.assertEqual(
            state["desiredRelease"], fixture.scoped_release_authority()
        )
        self.assertEqual([target["host"] for target in state["targets"]], [fixture.host])
        self.assertEqual(
            non_pi3_before,
            {
                host: runtime.fleet["fleet"][host]
                for host in ("pi5", *fixture.pi4_hosts)
            },
        )

    def test_production_signage_historical_active_run_recovery_transaction(self):
        fixture = ProductionSignageFixture()
        runtime = fixture.typed_runtime(artifact_state="absent")
        bind_production_signage_boundaries(runtime, fixture)
        authority_run_id = "20260806-013842-e81a9a"
        record = runtime.fleet["fleet"][fixture.host]
        record.update(
            {
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": authority_run_id,
            }
        )
        runtime.abandoned_run_id = authority_run_id
        runtime.deployed_sha[fixture.host] = OLD_SHA
        runtime.prior_runs[authority_run_id] = {
            "version": 1,
            "runId": authority_run_id,
            "state": "failed",
            "phase": "completed",
            "targets": [
                {
                    **fixture.terminal(),
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "currentSha": None,
                    "evidence": "unknown",
                    "state": "pending",
                    "repositoryBaseline": fixture.baseline("absent"),
                    "claimRequirements": [
                        {
                            "kind": "signageReleaseArtifact",
                            "expectedIdentity": NEW_ARTIFACT_IDENTITY,
                            "status": "missing",
                        }
                    ],
                }
            ],
        }
        original_scope = runtime.build_fleet_scope

        def replan(**keywords):
            runtime.events.append("scope:replan")
            recovered = keywords["fleet_state"]["fleet"][fixture.host]
            self.assertEqual(recovered["evidence"], "verified")
            self.assertEqual(recovered["currentSha"], OLD_SHA)
            self.assertEqual(
                set(recovered["releaseClaims"]), {"terminalRepository"}
            )
            return original_scope(**keywords)

        runtime.build_fleet_scope = replan

        self.assertEqual(
            coordinator.execute(
                args(
                    release_scope=PI3_SIGNAGE_SCOPE,
                    signage_oci_digest=OCI_DIGEST,
                ),
                runtime=runtime,
                token=FakeToken(runtime.events),
            ),
            0,
        )

        recapture = runtime.events.index(f"producer:capture:{authority_run_id}")
        file_preflight = runtime.events.index(
            f"producer:file-preflight:{authority_run_id}"
        )
        runtime_preflight = runtime.events.index(
            f"producer:runtime-preflight:{authority_run_id}"
        )
        replan_index = runtime.events.index("scope:replan")
        maintenance = runtime.events.index(
            "status:put:--run-id:run-1:--clients:raspberrypi3-signage1:"
            "--terminal-type:signage"
        )
        self.assertLess(recapture, file_preflight)
        self.assertLess(file_preflight, runtime_preflight)
        self.assertLess(runtime_preflight, replan_index)
        self.assertLess(replan_index, maintenance)
        self.assertIsNone(runtime.fleet["activeRun"])

    def test_production_signage_post_mutation_rollback_to_legacy_transaction(self):
        fixture = ProductionSignageFixture()
        runtime = fixture.typed_runtime(artifact_state="absent")
        bind_production_signage_boundaries(runtime, fixture)
        runtime.playbook_error = RuntimeError("production apply failure")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(
                    release_scope=PI3_SIGNAGE_SCOPE,
                    signage_oci_digest=OCI_DIGEST,
                ),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )

        capture = runtime.events.index("stage3:capture:raspberrypi3:run-1")
        maintenance = runtime.events.index(
            "status:put:--run-id:run-1:--clients:raspberrypi3-signage1:"
            "--terminal-type:signage"
        )
        restore = runtime.events.index("stage3:rollback:raspberrypi3:run-1")
        ready = runtime.events.index("producer:ready:run-1")
        self.assertLess(capture, maintenance)
        self.assertLess(maintenance, restore)
        self.assertLess(restore, ready)
        self.assertIn(
            "producer:ready-mode:run-1:legacy-repository", runtime.events
        )
        target = runtime.states[-1].target(fixture.host)
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertEqual(
            set(runtime.fleet["fleet"][fixture.host]["releaseClaims"]),
            {"terminalRepository"},
        )

    def test_production_signage_post_mutation_rollback_to_previous_artifact_transaction(self):
        fixture = ProductionSignageFixture()
        runtime = fixture.typed_runtime(artifact_state="installed")
        bind_production_signage_boundaries(runtime, fixture)
        non_pi3_before = copy.deepcopy(
            {
                host: runtime.fleet["fleet"][host]
                for host in ("pi5", *fixture.pi4_hosts)
            }
        )
        runtime.playbook_error = RuntimeError("production apply failure")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(
                    release_scope=PI3_SIGNAGE_SCOPE,
                    signage_oci_digest=OCI_DIGEST,
                ),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )

        self.assertIn("stage3:rollback:raspberrypi3:run-1", runtime.events)
        self.assertIn(
            "stage3:cleanup:raspberrypi3:run-1:restored", runtime.events
        )
        self.assertIn("producer:ready:run-1", runtime.events)
        self.assertIn("producer:ready-mode:run-1:artifact", runtime.events)
        target = runtime.states[-1].target(fixture.host)
        self.assertEqual(target["rollbackEvidence"], "verified")
        claim = runtime.fleet["fleet"][fixture.host]["releaseClaims"][
            "signageReleaseArtifact"
        ]
        self.assertEqual(claim["expectedIdentity"], OLD_ARTIFACT_IDENTITY)
        self.assertEqual(claim["observedIdentity"], OLD_ARTIFACT_IDENTITY)
        self.assertEqual(claim["verificationId"], ROLLBACK_VERIFICATION_ID)
        self.assertEqual(
            non_pi3_before,
            {
                host: runtime.fleet["fleet"][host]
                for host in ("pi5", *fixture.pi4_hosts)
            },
        )

    def test_scoped_signage_staged_identity_mismatch_fails_before_maintenance(self):
        fixture = ProductionSignageFixture()
        runtime = fixture.typed_runtime(artifact_state="absent")
        bind_production_signage_boundaries(runtime, fixture)
        runtime.staged_release_override = {"manifestSha256": "0" * 64}
        non_pi3_before = copy.deepcopy(
            {
                host: runtime.fleet["fleet"][host]
                for host in ("pi5", *fixture.pi4_hosts)
            }
        )

        with self.assertRaisesRegex(
            RuntimeError, "scoped release authority"
        ):
            coordinator.execute(
                args(
                    release_scope=PI3_SIGNAGE_SCOPE,
                    signage_oci_digest=OCI_DIGEST,
                ),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )

        self.assertIn("stage3:candidate-cleanup:raspberrypi3:run-1", runtime.events)
        self.assertFalse(
            any(event.startswith("status:put:") for event in runtime.events)
        )
        self.assertNotIn("playbook:raspberrypi3", runtime.events)
        self.assertEqual(
            non_pi3_before,
            {
                host: runtime.fleet["fleet"][host]
                for host in ("pi5", *fixture.pi4_hosts)
            },
        )

    def test_scoped_signage_rejects_foreign_locked_work_before_device_mutation(self):
        fixture = ProductionSignageFixture()
        runtime = fixture.typed_runtime(artifact_state="absent")
        original_scope = runtime.build_fleet_scope

        def foreign_scope(**keywords):
            plan, targets, classifications, warnings = original_scope(**keywords)
            plan["hosts"].append(
                decision(fixture.pi4_hosts[0], "kiosk", targeted=False)
            )
            return plan, targets, classifications, warnings

        runtime.build_fleet_scope = foreign_scope
        non_pi3_before = copy.deepcopy(
            {
                host: runtime.fleet["fleet"][host]
                for host in ("pi5", *fixture.pi4_hosts)
            }
        )

        with self.assertRaisesRegex(
            RuntimeError, "locked Pi3 artifact release scope"
        ):
            coordinator.execute(
                args(
                    release_scope=PI3_SIGNAGE_SCOPE,
                    signage_oci_digest=OCI_DIGEST,
                ),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )

        self.assertFalse(
            any(
                event.startswith(
                    (
                        "terminal:pipelining-preflight:",
                        "stage3:",
                        "status:",
                        "playbook:",
                        "observe:server:",
                        "pi5:config-",
                    )
                )
                for event in runtime.events
            )
        )
        self.assertEqual(
            non_pi3_before,
            {
                host: runtime.fleet["fleet"][host]
                for host in ("pi5", *fixture.pi4_hosts)
            },
        )

    def test_production_signage_unverified_pointer_rollback_retains_authority(self):
        fixture = ProductionSignageFixture()
        runtime = fixture.runtime(artifact_state="installed")
        bind_production_signage_boundaries(runtime, fixture)
        runtime.playbook_error = RuntimeError("post-switch health failed")
        runtime.rollback_ok = False

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("stage3:rollback:raspberrypi3:run-1", runtime.events)
        self.assertEqual(runtime.fleet["activeRun"]["runId"], "run-1")
        self.assertNotIn(
            "status:remove-client:--run-id:run-1:--client:raspberrypi3-signage1",
            runtime.events,
        )
        self.assertFalse(
            any(event.startswith("stage3:cleanup:raspberrypi3") for event in runtime.events)
        )
        target = runtime.states[-1].target(fixture.host)
        self.assertEqual(target["state"], "failed")
        self.assertIn("injected rollback failure", target["rollback"])

    def _admission_payload(self, plan):
        registry = readiness_policy.load_registry()
        selection = readiness_policy.select_readiness(
            registry, readiness_policy.facts_from_plan(plan)
        )
        evidence = tuple(
            readiness_policy.ProbeEvidence(
                capability=request.capability,
                status="passed",
                hosts=request.hosts,
            )
            for request in selection.probes
        )
        decision = readiness_policy.evaluate_readiness(
            registry, selection, evidence
        )
        return readiness_policy.make_admission(
            selection, decision
        ).as_payload()

    def _synthetic_runtime(self):
        profile = synthetic_terminal_profile()
        terminal = {
            "host": "inspection-a",
            "role": profile.id,
            "terminalType": profile.id,
            "clientId": "inspection-a-client",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                terminal["host"]: host_record(profile.id, OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "activationExecutionEnabled": True,
                "verificationOnlyExecutionEnabled": True,
                "mutationTargets": [{"host": terminal["host"]}],
                "activationTargets": [],
                "verificationTargets": [{"host": terminal["host"]}],
                "terminalWork": [
                    {
                        "host": terminal["host"],
                        "role": profile.id,
                        "mutationRequired": True,
                        "activationRequired": False,
                        "verificationRequired": True,
                        "activationStrategyId": None,
                        "activationMode": None,
                        "claimRequirements": [
                            {
                                "kind": "terminalRepository",
                                "expectedIdentity": NEW_SHA,
                                "status": "stale-or-unverified",
                            }
                        ],
                    }
                ],
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision(terminal["host"], profile.id),
                ],
            },
            targets=[terminal],
        )
        runtime.terminal_adapter = lambda profile_id: GenericSystemdAdapter(
            profile if profile_id == profile.id else load_registry().profile(profile_id),
            runtime,
        )
        return runtime

    def test_locked_plan_matching_admission_is_saved_before_new_release_work(self):
        runtime = self._kiosk_web_activation_runtime()
        runtime.plan = self._readiness_plan(runtime)
        admission = self._admission_payload(runtime.plan)

        result = coordinator.execute(
            args(readiness_admission_json=json.dumps(admission)),
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(result, 0)
        saved = runtime.states[-1].payload["readinessAdmission"]
        self.assertEqual(saved["scopeMatch"], "passed")
        self.assertEqual(saved["scopeDigest"], admission["scopeDigest"])
        self.assertLess(
            runtime.events.index("fleet:begin"),
            runtime.events.index("activation:submit:kiosk-a:run-1"),
        )

    def test_locked_plan_scope_expansion_stops_before_candidate_mutation(self):
        runtime = self._kiosk_web_activation_runtime()
        runtime.plan = self._readiness_plan(runtime)
        admitted_plan = self._readiness_plan(runtime, terminal_work=[])
        admitted_plan["mutationTargets"] = []
        admitted_plan["verificationTargets"] = []
        admission = self._admission_payload(admitted_plan)

        with self.assertRaisesRegex(
            RuntimeError, "scope exceeds readiness admission"
        ):
            coordinator.execute(
                args(readiness_admission_json=json.dumps(admission)),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )

        saved = runtime.states[-1].payload["readinessAdmission"]
        self.assertEqual(saved["scopeMatch"], "blocked")
        self.assertTrue(
            any("host-added:kiosk-a" in issue for issue in saved["scopeIssues"])
        )
        self.assertFalse(
            any(event.startswith("activation:submit:") for event in runtime.events)
        )

    def _kiosk_web_activation_runtime(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "kiosk-a-client",
        }
        work = {
            "host": terminal["host"],
            "role": "kiosk",
            "mutationRequired": False,
            "activationRequired": True,
            "verificationRequired": True,
            "activationStrategyId": "kiosk-web-activation-v1",
            "activationMode": "one-time-service-activation",
            "claimRequirements": [
                {
                    "kind": "controlPlaneWeb",
                    "expectedIdentity": NEW_SHA,
                    "status": "stale-or-unverified",
                },
                {
                    "kind": "terminalRepository",
                    "expectedIdentity": OLD_SHA,
                    "status": "current",
                },
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                terminal["host"]: host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "activationExecutionEnabled": True,
                "verificationOnlyExecutionEnabled": False,
                "mutationTargets": [],
                "activationTargets": [{"host": terminal["host"]}],
                "verificationTargets": [{"host": terminal["host"]}],
                "terminalWork": [work],
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision(
                        terminal["host"],
                        "kiosk",
                        current=OLD_SHA,
                        targeted=False,
                        reason="Web consumer activation",
                    ),
                ],
            },
            targets=[terminal],
        )
        runtime.deployed_sha[terminal["host"]] = OLD_SHA
        return runtime

    def test_kiosk_web_activation_skips_ansible_and_persists_capability_after_exact_ack(self):
        runtime = self._kiosk_web_activation_runtime()
        runtime.maintenance_ack = False

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 0)
        self.assertNotIn("playbook:kiosk-a", runtime.events)
        self.assertNotIn("terminal:pipelining-preflight:kiosk-a", runtime.events)
        self.assertIn("activation:submit:kiosk-a:run-1", runtime.events)
        self.assertIn("activation:cleanup:kiosk-a:run-1", runtime.events)
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["maintenance"]["state"], "unconfirmed")
        self.assertEqual(target["warnings"][0]["phase"], "maintenance")
        self.assertEqual(target["readyReleaseSha"], NEW_SHA)
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(target["activation"]["state"], "verified")
        claims = runtime.fleet["fleet"]["kiosk-a"]["releaseClaims"]
        self.assertEqual(
            claims["controlPlaneWeb"]["authority"],
            "kiosk-compiled-web-ready",
        )
        self.assertEqual(
            claims["controlPlaneWeb"]["verificationId"],
            target["readyVerificationId"],
        )
        self.assertEqual(
            claims["controlPlaneWeb"]["observedIdentity"], NEW_SHA
        )
        self.assertEqual(
            claims["terminalRepository"]["authority"],
            "terminal-repository-probe",
        )
        self.assertEqual(
            claims["terminalRepository"]["observedIdentity"], OLD_SHA
        )
        capability = runtime.fleet["fleet"]["kiosk-a"][
            "activationCapabilities"
        ]["kiosk-web-activation-v1"]
        self.assertEqual(capability["releaseSha"], NEW_SHA)
        self.assertEqual(
            capability["verificationId"], target["readyVerificationId"]
        )
        self.assertLess(
            runtime.events.index("activation:cleanup:kiosk-a:run-1"),
            runtime.events.index("status:remove-client:--run-id:run-1:--client:kiosk-a-client"),
        )

    def test_uncertain_kiosk_web_activation_retains_maintenance_without_rollback(self):
        runtime = self._kiosk_web_activation_runtime()
        runtime.activation_error = ActivationUncertainError("response lost")

        with self.assertRaisesRegex(RuntimeError, "unresolved activation"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["state"], "activation-uncertain")
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertFalse(
            any(event.startswith("status:remove-client") for event in runtime.events)
        )
        self.assertIsNotNone(runtime.fleet["activeRun"])

    def test_quiescent_activation_failure_uses_sealed_rollback(self):
        runtime = self._kiosk_web_activation_runtime()
        runtime.activation_error = RuntimeError("submission response lost")
        runtime.activation_reconciliation_state = "failed"

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("activation:reconcile:kiosk-a:run-1", runtime.events)
        self.assertIn("rollback:kiosk-a", runtime.events)
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertEqual(
            target["rollbackActivationCapabilityProof"]["releaseSha"], NEW_SHA
        )
        capability = runtime.fleet["fleet"]["kiosk-a"][
            "activationCapabilities"
        ]["kiosk-web-activation-v1"]
        self.assertEqual(capability["releaseSha"], NEW_SHA)
        self.assertEqual(
            capability["verificationId"], target["rollbackReadyVerificationId"]
        )

    def test_forward_web_claim_survives_typed_kiosk_repository_rollback(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "kiosk-a-client",
        }
        kiosk = host_record("kiosk", OLD_SHA)
        kiosk["releaseClaims"] = {
            "controlPlaneWeb": verified_claim(
                NEW_SHA,
                "kiosk-compiled-web-ready",
                verification_id="c" * 32,
            ),
            "terminalRepository": verified_claim(
                OLD_SHA, "terminal-repository-probe"
            ),
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                terminal["host"]: kiosk,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "activationExecutionEnabled": True,
                "verificationOnlyExecutionEnabled": True,
                "mutationTargets": [{"host": terminal["host"]}],
                "activationTargets": [],
                "verificationTargets": [{"host": terminal["host"]}],
                "terminalWork": [
                    {
                        "host": terminal["host"],
                        "role": "kiosk",
                        "mutationRequired": True,
                        "activationRequired": False,
                        "verificationRequired": True,
                        "activationStrategyId": "kiosk-web-activation-v1",
                        "activationMode": None,
                        "claimRequirements": [
                            {
                                "kind": "controlPlaneWeb",
                                "expectedIdentity": NEW_SHA,
                                "status": "current",
                            },
                            {
                                "kind": "terminalRepository",
                                "expectedIdentity": NEW_SHA,
                                "status": "stale-or-unverified",
                            },
                        ],
                    }
                ],
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision(terminal["host"], "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.playbook_error = RuntimeError("candidate apply failed")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        record = runtime.fleet["fleet"][terminal["host"]]
        self.assertEqual(record["desiredSha"], NEW_SHA)
        self.assertEqual(record["currentSha"], OLD_SHA)
        claims = record["releaseClaims"]
        self.assertEqual(set(claims), {"controlPlaneWeb", "terminalRepository"})
        self.assertEqual(
            claims["controlPlaneWeb"]["expectedIdentity"], NEW_SHA
        )
        self.assertEqual(
            claims["controlPlaneWeb"]["observedIdentity"], NEW_SHA
        )
        self.assertEqual(
            claims["controlPlaneWeb"]["verificationId"],
            ROLLBACK_VERIFICATION_ID,
        )
        self.assertEqual(
            claims["terminalRepository"]["expectedIdentity"], OLD_SHA
        )
        self.assertEqual(
            claims["terminalRepository"]["observedIdentity"], OLD_SHA
        )
        self.assertTrue(
            all(claim["state"] == "verified" for claim in claims.values())
        )
        target = runtime.states[-1].target(terminal["host"])
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertIn("maintenanceClearedAt", target)

    def test_typed_requirements_must_equal_the_profile_claim_set(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "kiosk-a-client",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                terminal["host"]: host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "activationExecutionEnabled": True,
                "verificationOnlyExecutionEnabled": True,
                "mutationTargets": [{"host": terminal["host"]}],
                "activationTargets": [],
                "verificationTargets": [{"host": terminal["host"]}],
                "terminalWork": [
                    {
                        "host": terminal["host"],
                        "role": "kiosk",
                        "mutationRequired": True,
                        "activationRequired": False,
                        "verificationRequired": True,
                        "activationStrategyId": "kiosk-web-activation-v1",
                        "activationMode": None,
                        "claimRequirements": [
                            {
                                "kind": "terminalRepository",
                                "expectedIdentity": NEW_SHA,
                                "status": "stale-or-unverified",
                            }
                        ],
                    }
                ],
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision(terminal["host"], "kiosk"),
                ],
            },
            targets=[terminal],
        )

        with self.assertRaisesRegex(RuntimeError, "profile contract"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertNotIn("fleet:unknown:kiosk-a", runtime.events)
        self.assertFalse(
            any(event.startswith("terminal:") for event in runtime.events)
        )
        self.assertFalse(any(event.startswith("status:") for event in runtime.events))

    def test_synthetic_profile_runs_through_generic_coordinator(self):
        runtime = self._synthetic_runtime()

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 0)
        self.assertIn("playbook:inspection-a", runtime.events)
        self.assertIn("observe:terminal:inspection-a", runtime.events)
        self.assertIn(
            f"fleet:verified:inspection-a:{NEW_SHA}", runtime.events
        )

    def test_synthetic_profile_cancel_uses_exact_adapter_rollback(self):
        runtime = self._synthetic_runtime()
        runtime.ready_ack_error = CancellationRequested(
            "operator stop", "wait-ready-ack:inspection-a-client"
        )

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 130)
        target = runtime.states[-1].target("inspection-a")
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(target["rollbackReadyReleaseSha"], OLD_SHA)
        self.assertLess(
            runtime.events.index("rollback:inspection-a"),
            runtime.events.index(
                "manifest:cleanup:inspection-a:run-1:restored"
            ),
        )

    def test_interrupted_ready_identity_uses_verified_pi5_for_kiosk_only(self):
        fleet = {
            "fleet": {
                "pi5": host_record("server", NEW_SHA),
            }
        }

        self.assertEqual(
            coordinator._interrupted_rollback_ready_sha(
                fleet, {"terminalType": "kiosk"}, OLD_SHA
            ),
            NEW_SHA,
        )
        self.assertEqual(
            coordinator._interrupted_rollback_ready_sha(
                {"fleet": {}}, {"terminalType": "signage"}, OLD_SHA
            ),
            OLD_SHA,
        )

    def test_interrupted_kiosk_ready_identity_rejects_unknown_pi5(self):
        server = host_record("server", NEW_SHA)
        server.update({"currentSha": None, "evidence": "unknown"})

        with self.assertRaisesRegex(RuntimeError, "verified Pi5 Web release"):
            coordinator._interrupted_rollback_ready_sha(
                {"fleet": {"pi5": server}},
                {"terminalType": "kiosk"},
                OLD_SHA,
            )

    def test_target_inventory_identity_mismatch_precedes_fleet_and_devices(self):
        runtime = FakeRuntime(fleet={}, hosts=[], plan={}, targets=[])

        with self.assertRaisesRegex(RuntimeError, "does not match target inventory"):
            coordinator.execute(
                args(expected_server_client_id="talkplaza-pi5-server"),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )

        self.assertEqual(runtime.events, ["inventory:/ansible/inventory.yml"])
        self.assertEqual(runtime.states, [])
        self.assertIsNone(runtime.fleet["activeRun"])

    def test_noop_finishes_fleet_before_legacy_success(self):
        hosts = [
            {"host": "pi5", "role": "server"},
            {
                "host": "kiosk-a",
                "role": "kiosk",
                "terminalType": "kiosk",
                "clientId": "a",
            },
        ]
        plan = {
            "pi5Required": False,
            "hosts": [
                decision("pi5", "server", current=NEW_SHA, targeted=False),
                decision("kiosk-a", "kiosk", current=NEW_SHA, targeted=False),
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": host_record("kiosk", NEW_SHA),
            },
            hosts=hosts,
            plan=plan,
            targets=[],
        )

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 0)
        self.assertTrue(runtime.events[0].startswith("inventory:"))
        self.assertEqual(runtime.events[1], "pi5:reconcile-candidate")
        self.assertEqual(runtime.events[2], "fleet:begin")
        self.assertFalse(any(event.startswith("observe:") for event in runtime.events))
        finish = runtime.events.index("fleet:finish:success")
        self.assertLess(finish, len(runtime.events) - 1)
        self.assertTrue(runtime.events[-1].startswith("legacy:save:success:completed"))

    def test_candidate_reconcile_failure_precedes_fleet_state_and_noop_planning(self):
        runtime = FakeRuntime(fleet={}, hosts=[], plan={}, targets=[])
        runtime.pi5_reconcile_error = RuntimeError("candidate recovery unsafe")

        with self.assertRaisesRegex(RuntimeError, "candidate recovery unsafe"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertEqual(
            runtime.events,
            ["inventory:/ansible/inventory.yml", "pi5:reconcile-candidate"],
        )
        self.assertEqual(runtime.states, [])
        self.assertIsNone(runtime.fleet["activeRun"])

    def test_seed_promotes_only_successful_live_observation(self):
        hosts = [
            {"host": "pi5", "role": "server"},
            {"host": "kiosk-a", "role": "kiosk", "clientId": "a"},
        ]
        runtime = FakeRuntime(fleet={}, hosts=hosts, plan={}, targets=[])
        original_observer = runtime.observe_terminal_evidence

        def unavailable(*_args):
            runtime.events.append("observe:terminal:kiosk-a")
            raise RuntimeError("unreachable")

        runtime.observe_terminal_evidence = unavailable
        state, failures = coordinator._seed_unverified_hosts(
            hosts,
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="run-1",
            desired_sha=NEW_SHA,
            abandoned_run_id=None,
            runtime=runtime,
            token=FakeToken(runtime.events),
        )
        runtime.observe_terminal_evidence = original_observer

        self.assertEqual(state["fleet"]["pi5"]["evidence"], "verified")
        self.assertEqual(state["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertEqual(state["fleet"]["kiosk-a"]["desiredSha"], NEW_SHA)
        self.assertEqual(failures, [{"host": "kiosk-a", "error": "unreachable"}])
        self.assertLess(
            runtime.events.index("observe:server:None"),
            runtime.events.index(f"fleet:verified:pi5:{OLD_SHA}"),
        )

    def test_signage_seed_promotes_its_complete_repository_claim(self):
        host = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        runtime = FakeRuntime(fleet={}, hosts=[host], plan={}, targets=[])

        state, failures = coordinator._seed_unverified_hosts(
            [host],
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="run-1",
            desired_sha=NEW_SHA,
            abandoned_run_id=None,
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(failures, [])
        record = state["fleet"][host["host"]]
        self.assertEqual(record["evidence"], "verified")
        claim = record["releaseClaims"]["signageReleaseArtifact"]
        self.assertEqual(claim["authority"], "signage-artifact-probe")
        self.assertEqual(claim["expectedIdentity"], NEW_ARTIFACT_IDENTITY)
        self.assertEqual(claim["observedIdentity"], NEW_ARTIFACT_IDENTITY)
        self.assertEqual(claim["state"], "verified")

    def test_kiosk_seed_stays_unknown_until_the_browser_claim_is_verified(self):
        host = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(fleet={}, hosts=[host], plan={}, targets=[])
        runtime.deployed_sha[host["host"]] = OLD_SHA

        state, failures = coordinator._seed_unverified_hosts(
            [host],
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="run-1",
            desired_sha=NEW_SHA,
            abandoned_run_id=None,
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(failures, [])
        record = state["fleet"][host["host"]]
        self.assertEqual(record["evidence"], "unknown")
        self.assertIsNone(record["currentSha"])
        self.assertEqual(record["desiredSha"], OLD_SHA)
        self.assertEqual(set(record["releaseClaims"]), {"terminalRepository"})
        self.assertEqual(
            record["releaseClaims"]["terminalRepository"]["state"],
            "verified",
        )
        self.assertEqual(
            record["releaseClaims"]["terminalRepository"][
                "expectedIdentity"
            ],
            OLD_SHA,
        )
        self.assertNotIn("controlPlaneWeb", record["releaseClaims"])

    def test_seed_never_repromotes_an_existing_authoritative_record(self):
        stale = host_record("kiosk", OLD_SHA)
        stale["desiredSha"] = NEW_SHA
        hosts = [{"host": "kiosk-a", "role": "kiosk", "clientId": "a"}]
        runtime = FakeRuntime(
            fleet={"kiosk-a": stale}, hosts=hosts, plan={}, targets=[]
        )
        runtime.deployed_sha["kiosk-a"] = OLD_SHA

        state, failures = coordinator._seed_unverified_hosts(
            hosts,
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="run-1",
            desired_sha=NEW_SHA,
            abandoned_run_id=None,
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(failures, [])
        record = state["fleet"]["kiosk-a"]
        self.assertEqual(record["currentSha"], OLD_SHA)
        self.assertEqual(record["desiredSha"], NEW_SHA)
        self.assertEqual(record["evidence"], "verified")
        self.assertNotIn("observe:terminal:kiosk-a", runtime.events)

    def test_seed_never_promotes_existing_unknown_after_failed_cleanup(self):
        unknown = host_record("kiosk", OLD_SHA)
        unknown.update(
            {
                "desiredSha": NEW_SHA,
                "currentSha": None,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "failed-maintenance-run",
            }
        )
        hosts = [{"host": "kiosk-a", "role": "kiosk", "clientId": "a"}]
        runtime = FakeRuntime(
            fleet={"kiosk-a": unknown}, hosts=hosts, plan={}, targets=[]
        )

        state, failures = coordinator._seed_unverified_hosts(
            hosts,
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="retry-run",
            desired_sha=NEW_SHA,
            abandoned_run_id=None,
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(failures, [])
        self.assertEqual(state["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertNotIn("observe:terminal:kiosk-a", runtime.events)

    def test_full_release_orders_authoritative_writes_before_execution(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        plan = {
            "pi5Required": True,
            "hosts": [
                decision("pi5", "server"),
                decision("kiosk-a", "kiosk"),
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )

        result = coordinator.execute(
            args(full_fleet=True),
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(result, 0)
        self.assertTrue(runtime.scope_kwargs["full_fleet"])
        self.assertLess(
            runtime.events.index("fleet:unknown:pi5"),
            runtime.events.index("pi5:config-capture:pi5:run-1"),
        )
        self.assertLess(
            runtime.events.index("pi5:config-capture:pi5:run-1"),
            runtime.events.index(f"pi5:host-config:pi5:{NEW_SHA}"),
        )
        self.assertLess(
            runtime.events.index(f"pi5:host-config:pi5:{NEW_SHA}"),
            runtime.events.index("pi5:ensure"),
        )
        unknown = runtime.events.index("fleet:unknown:pi5")
        host_config = runtime.events.index(f"pi5:host-config:pi5:{NEW_SHA}")
        self.assertTrue(
            any(
                event.startswith("legacy:save:running:preparing")
                for event in runtime.events[unknown + 1 : host_config]
            )
        )
        self.assertIn(f"fleet:verified:pi5:{NEW_SHA}", runtime.events)
        self.assertEqual(
            runtime.states[-1].payload["serverConfig"]["state"], "converged"
        )
        self.assertLess(
            runtime.events.index("fleet:unknown:kiosk-a"),
            runtime.events.index("terminal:baseline:kiosk-a"),
        )
        self.assertLess(
            runtime.events.index("terminal:baseline:kiosk-a"),
            runtime.events.index(f"manifest:capture:kiosk-a:{OLD_SHA}"),
        )
        self.assertLess(
            runtime.events.index(f"manifest:capture:kiosk-a:{OLD_SHA}"),
            runtime.events.index("playbook:kiosk-a"),
        )
        self.assertLess(
            runtime.events.index("playbook:kiosk-a"),
            runtime.events.index(
                "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
                f"--desired-release-sha:{NEW_SHA}"
            ),
        )
        self.assertLess(
            runtime.events.index(
                "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
                f"--desired-release-sha:{NEW_SHA}"
            ),
            runtime.events.index("observe:terminal:kiosk-a"),
        )
        self.assertLess(
            runtime.events.index("observe:terminal:kiosk-a"),
            runtime.events.index("status:remove-client:--run-id:run-1:--client:a"),
        )
        self.assertLess(
            runtime.events.index("status:remove-client:--run-id:run-1:--client:a"),
            runtime.events.index(
                "manifest:cleanup:kiosk-a:run-1:committed"
            ),
        )
        self.assertLess(
            runtime.events.index("manifest:cleanup:kiosk-a:run-1:committed"),
            runtime.events.index(f"fleet:verified:kiosk-a:{NEW_SHA}"),
        )
        self.assertLess(
            runtime.events.index("fleet:finish:success"),
            len(runtime.events) - 1,
        )
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "verified")
        target_state = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target_state["readyReleaseSha"], NEW_SHA)
        self.assertEqual(target_state["expectedReadySha"], NEW_SHA)
        self.assertEqual(
            target_state["expectedReadyVerificationId"],
            FORWARD_VERIFICATION_ID,
        )
        self.assertEqual(
            target_state["readyVerificationId"], FORWARD_VERIFICATION_ID
        )
        self.assertEqual(
            target_state["rollbackManifest"],
            rollback_manifest("run-1", "kiosk-a"),
        )

    def test_pi5_promotion_requires_both_typed_image_claims_at_candidate_sha(self):
        plan = {
            "pi5Required": True,
            "hosts": [decision("pi5", "server")],
        }
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", OLD_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan=plan,
            targets=[],
        )
        runtime.observe_pi5_evidence = lambda _expected: {
            "currentSha": OLD_SHA,
            "activeSlot": "green",
            "apiImage": f"api:{OLD_SHA}-aaaaaaaaaaaa",
            "webImage": f"web:{OLD_SHA}-bbbbbbbbbbbb",
            "configDigest": "sha256:" + "c" * 64,
            "migrationDigest": "sha256:" + "d" * 64,
        }

        with self.assertRaisesRegex(RuntimeError, "not fully verified"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        record = runtime.fleet["fleet"]["pi5"]
        self.assertEqual(record["evidence"], "unknown")
        self.assertIsNone(record["currentSha"])
        self.assertNotIn(f"fleet:verified:pi5:{OLD_SHA}", runtime.events)

    def test_pipelining_preflight_failure_precedes_every_terminal_mutation(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.terminal_pipelining_preflight_error = RuntimeError(
            "pipelining become unavailable"
        )

        with self.assertRaisesRegex(RuntimeError, "pipelining become unavailable"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("fleet:unknown:kiosk-a", runtime.events)
        self.assertIn("terminal:pipelining-preflight:kiosk-a", runtime.events)
        for forbidden in (
            "terminal:baseline:kiosk-a",
            f"manifest:capture:kiosk-a:{OLD_SHA}",
            "playbook:kiosk-a",
            "rollback:kiosk-a",
            "signage:prestage",
        ):
            self.assertNotIn(forbidden, runtime.events)
        self.assertFalse(
            any(event.startswith("status:") for event in runtime.events)
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertNotIn("maintenanceStartedAt", target)
        self.assertNotIn("rollbackManifest", target)
        self.assertEqual(target["evidence"], "unknown")
        phase = next(
            phase
            for phase in runtime.states[-1].payload["telemetry"]["phases"]
            if phase["name"] == "terminal-ansible-pipelining-preflight"
        )
        self.assertEqual(phase["outcome"], "RuntimeError")

    def test_manifest_capture_failure_precedes_every_terminal_mutation(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.manifest_capture_error = RuntimeError("manifest unavailable")

        with self.assertRaisesRegex(RuntimeError, "manifest unavailable"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn(f"manifest:capture:kiosk-a:{OLD_SHA}", runtime.events)
        self.assertNotIn("fleet:finish:failed", runtime.events)
        self.assertEqual(runtime.fleet["activeRun"]["runId"], "run-1")
        for forbidden in (
            "playbook:kiosk-a",
            "rollback:kiosk-a",
            "signage:prestage",
        ):
            self.assertNotIn(forbidden, runtime.events)
        self.assertFalse(
            any(event.startswith("status:") for event in runtime.events)
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertNotIn("maintenanceStartedAt", target)
        self.assertNotIn("rollbackManifest", target)
        self.assertEqual(target["evidence"], "unknown")

    def test_cancel_after_manifest_before_maintenance_cleans_runtime_authority(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )

        result = coordinator.execute(
            args(),
            runtime=runtime,
            token=FakeToken(runtime.events, cancel_at="after-notice:kiosk-a"),
        )

        self.assertEqual(result, 130)
        capture = runtime.events.index(f"manifest:capture:kiosk-a:{OLD_SHA}")
        cleanup = runtime.events.index(
            "manifest:cleanup:kiosk-a:run-1:committed"
        )
        finish = runtime.events.index("fleet:finish:cancelled")
        self.assertLess(capture, cleanup)
        self.assertLess(cleanup, finish)
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertNotIn("playbook:kiosk-a", runtime.events)
        self.assertFalse(
            any(event.startswith("source:stage:") for event in runtime.events)
        )
        self.assertNotIn(
            "status:put:--run-id:run-1:--clients:a:--terminal-type:kiosk",
            runtime.events,
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertNotIn("maintenanceStartedAt", target)
        self.assertEqual(
            target["runtimeFinalization"],
            {"outcome": "committed", "verifiedSha": OLD_SHA},
        )
        self.assertIn("runtimeCleanup", target)

    def test_pi3_source_stage_before_after_faults_leave_runtime_unchanged(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }

        def build_runtime():
            return FakeRuntime(
                fleet={
                    "pi5": host_record("server", OLD_SHA),
                    "signage-a": host_record("signage", OLD_SHA),
                },
                hosts=[{"host": "pi5", "role": "server"}, terminal],
                plan={
                    "pi5Required": False,
                    "hosts": [
                        decision("pi5", "server", targeted=False),
                        decision("signage-a", "signage"),
                    ],
                },
                targets=[terminal],
            )

        with self.subTest(boundary="during-stage"):
            runtime = build_runtime()
            runtime.source_stage_error = RuntimeError("source transfer failed")
            with self.assertRaisesRegex(RuntimeError, "source transfer failed"):
                coordinator.execute(
                    args(), runtime=runtime, token=FakeToken(runtime.events)
                )
            self.assertIn("stage3:stage:signage-a:run-1", runtime.events)
            self.assertIn(
                "stage3:internal-cleanup:signage-a:run-1", runtime.events
            )
            self.assertNotIn("playbook:signage-a", runtime.events)
            self.assertFalse(
                any(event.startswith("status:put:") for event in runtime.events)
            )
            target = runtime.states[-1].target("signage-a")
            self.assertNotIn("maintenanceStartedAt", target)
            self.assertEqual(
                runtime.repository_baseline_strict, [("signage-a", True)]
            )

        with self.subTest(boundary="after-stage"):
            runtime = build_runtime()
            result = coordinator.execute(
                args(),
                runtime=runtime,
                token=FakeToken(
                    runtime.events, cancel_at="after-source-stage:signage-a"
                ),
            )
            self.assertEqual(result, 130)
            stage = runtime.events.index("stage3:stage:signage-a:run-1")
            cleanup = runtime.events.index(
                "stage3:candidate-cleanup:signage-a:run-1"
            )
            runtime_cleanup = runtime.events.index(
                "stage3:cleanup:signage-a:run-1:committed"
            )
            self.assertLess(stage, cleanup)
            self.assertLess(cleanup, runtime_cleanup)
            self.assertNotIn("playbook:signage-a", runtime.events)
            self.assertFalse(
                any(event.startswith("status:put:") for event in runtime.events)
            )
            target = runtime.states[-1].target("signage-a")
            self.assertNotIn("maintenanceStartedAt", target)
            self.assertEqual(target["stagedSourceCleanup"]["status"], "passed")
            self.assertIs(target["stagedSourceCleanup"]["stageResidue"], False)

    def test_signage_prestage_failure_restores_the_sealed_manifest(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "signage-a": host_record("signage", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "activationExecutionEnabled": True,
                "verificationOnlyExecutionEnabled": True,
                "mutationTargets": [{"host": terminal["host"]}],
                "activationTargets": [],
                "verificationTargets": [{"host": terminal["host"]}],
                "terminalWork": [
                    {
                        "host": terminal["host"],
                        "role": "signage",
                        "mutationRequired": True,
                        "activationRequired": False,
                        "verificationRequired": True,
                        "activationStrategyId": None,
                        "activationMode": None,
                        "claimRequirements": [
                            {
                                "kind": "signageReleaseArtifact",
                                "expectedIdentity": NEW_ARTIFACT_IDENTITY,
                                "status": "stale-or-unverified",
                            }
                        ],
                    }
                ],
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("signage-a", "signage"),
                ],
            },
            targets=[terminal],
        )
        runtime.prestage_error = RuntimeError("staging failed")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertLess(
            runtime.events.index("stage3:capture:signage-a:run-1"),
            runtime.events.index("signage:prestage"),
        )
        self.assertLess(
            runtime.events.index("signage:prestage"),
            runtime.events.index("stage3:rollback:signage-a:run-1"),
        )
        self.assertNotIn("playbook:signage-a", runtime.events)
        self.assertIn(
            "signage:ready-proof:signage-a:run-1:s1:"
            f"{OLD_SHA}:{ROLLBACK_VERIFICATION_ID}",
            runtime.events,
        )
        self.assertLess(
            runtime.events.index(
                "stage3:cleanup:signage-a:run-1:restored"
            ),
            runtime.events.index(f"fleet:verified:signage-a:{OLD_SHA}"),
        )
        target = runtime.states[-1].target("signage-a")
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertIn("maintenanceClearedAt", target)
        remove = runtime.events.index(
            "status:remove-client:--run-id:run-1:--client:s1"
        )
        refresh = runtime.events.index("signage:refresh:signage-a:run-1")
        cleanup = runtime.events.index(
            "stage3:cleanup:signage-a:run-1:restored"
        )
        self.assertLess(remove, refresh)
        self.assertLess(refresh, cleanup)

    def test_signage_rollback_claim_restores_absent_or_previous_artifact_identity(self):
        runtime = FakeRuntime(fleet={}, hosts=[], plan={}, targets=[])
        adapter = adapter_for_profile("signage", runtime=runtime)
        base_target = {
            "previousSha": OLD_SHA,
            "rollbackReadyReleaseSha": OLD_SHA,
            "rollbackReadyVerificationId": ROLLBACK_VERIFICATION_ID,
            "claimRequirements": [
                {
                    "kind": "signageReleaseArtifact",
                    "expectedIdentity": NEW_ARTIFACT_IDENTITY,
                    "status": "stale-or-unverified",
                }
            ],
        }
        cases = (
            (
                {
                    "head": OLD_SHA,
                    "artifactState": "absent",
                    "artifactIdentity": None,
                    "artifactSha256": None,
                    "legacyRepositorySha": OLD_SHA,
                },
                {"currentSha": OLD_SHA},
                "terminalRepository",
                OLD_SHA,
            ),
            (
                {
                    "head": OLD_SHA,
                    "artifactState": "installed",
                    "artifactIdentity": OLD_ARTIFACT_IDENTITY,
                    "artifactSha256": ARTIFACT_DIGEST,
                    "legacyRepositorySha": None,
                },
                {
                    "currentSha": OLD_SHA,
                    "artifactSha256": ARTIFACT_DIGEST,
                    "releaseArtifactIdentity": OLD_ARTIFACT_IDENTITY,
                },
                "signageReleaseArtifact",
                OLD_ARTIFACT_IDENTITY,
            ),
        )
        for baseline, observation, expected_kind, expected_identity in cases:
            with self.subTest(state=baseline["artifactState"]):
                claims = coordinator._terminal_observed_release_claims(
                    runtime=runtime,
                    adapter=adapter,
                    target={**base_target, "repositoryBaseline": baseline},
                    observation=observation,
                    run_id="run-1",
                    rollback=True,
                )
                self.assertEqual(set(claims or {}), {expected_kind})
                claim = (claims or {})[expected_kind]
                self.assertEqual(claim["expectedIdentity"], expected_identity)
                self.assertEqual(claim["observedIdentity"], expected_identity)
                self.assertEqual(claim["state"], "verified")

    def test_signage_ready_proof_rejects_unknown_or_malformed_rollback_identity(self):
        runtime = FakeRuntime(fleet={}, hosts=[], plan={}, targets=[])
        adapter = adapter_for_profile("signage", runtime=runtime)
        malformed = (
            {**ProductionSignageFixture().baseline("absent"), "legacyRepositorySha": None},
            {**ProductionSignageFixture().baseline("installed"), "artifactSha256": "bad"},
            {**ProductionSignageFixture().baseline("absent"), "artifactState": "unknown"},
        )
        for baseline in malformed:
            with self.subTest(baseline=baseline), self.assertRaises(RuntimeError):
                adapter.prove_ready(
                    "inventory.yml",
                    ProductionSignageFixture().terminal(),
                    "run-1",
                    OLD_SHA,
                    ROLLBACK_VERIFICATION_ID,
                    {"repositoryBaseline": baseline},
                    rollback=True,
                )
        self.assertFalse(
            any(event.startswith("signage:ready-proof:") for event in runtime.events)
        )

    def test_unobserved_artifact_claim_never_retains_an_observation_time(self):
        claim = coordinator._claim_record(
            kind=ClaimKind.SIGNAGE_RELEASE_ARTIFACT,
            expected=NEW_ARTIFACT_IDENTITY,
            observed=None,
            authority=ClaimAuthority.SIGNAGE_READY,
            verification_id=None,
            observed_at="2026-07-15T00:00:00Z",
            run_id="run-1",
        )

        self.assertEqual(claim["state"], "unknown")
        self.assertIsNone(claim["observedIdentity"])
        self.assertIsNone(claim["observedAt"])

    def test_signage_artifact_transaction_commits_or_fails_before_maintenance(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }

        def make_runtime():
            return FakeRuntime(
                fleet={
                    "pi5": host_record("server", OLD_SHA),
                    "signage-a": host_record("signage", OLD_SHA),
                },
                hosts=[{"host": "pi5", "role": "server"}, terminal],
                plan={
                    "pi5Required": False,
                    "activationExecutionEnabled": True,
                    "verificationOnlyExecutionEnabled": True,
                    "mutationTargets": [{"host": terminal["host"]}],
                    "activationTargets": [],
                    "verificationTargets": [{"host": terminal["host"]}],
                    "terminalWork": [
                        {
                            "host": terminal["host"],
                            "role": "signage",
                            "mutationRequired": True,
                            "activationRequired": False,
                            "verificationRequired": True,
                            "activationStrategyId": None,
                            "activationMode": None,
                            "claimRequirements": [
                                {
                                    "kind": "signageReleaseArtifact",
                                    "expectedIdentity": NEW_ARTIFACT_IDENTITY,
                                    "status": "stale-or-unverified",
                                }
                            ],
                        }
                    ],
                    "hosts": [
                        decision("pi5", "server", targeted=False),
                        decision("signage-a", "signage"),
                    ],
                },
                targets=[terminal],
            )

        with self.subTest(outcome="success"):
            runtime = make_runtime()
            self.assertEqual(
                coordinator.execute(
                    args(), runtime=runtime, token=FakeToken(runtime.events)
                ),
                0,
            )

            capture = runtime.events.index(
                "stage3:capture:signage-a:run-1"
            )
            maintenance = runtime.events.index(
                "status:put:--run-id:run-1:--clients:s1:--terminal-type:signage"
            )
            apply = runtime.events.index("playbook:signage-a")
            remove = runtime.events.index(
                "status:remove-client:--run-id:run-1:--client:s1"
            )
            refresh = runtime.events.index("signage:refresh:signage-a:run-1")
            promote = runtime.events.index(f"fleet:verified:signage-a:{NEW_SHA}")
            finish = runtime.events.index("fleet:finish:success")
            self.assertLess(capture, maintenance)
            self.assertLess(maintenance, apply)
            self.assertLess(apply, remove)
            self.assertLess(remove, refresh)
            self.assertLess(refresh, promote)
            self.assertLess(promote, finish)
            target = runtime.states[-1].target("signage-a")
            self.assertTrue(
                target["signageDisplayProof"]["maintenanceArtifactReplaced"]
            )
            claim = runtime.fleet["fleet"]["signage-a"]["releaseClaims"][
                "signageReleaseArtifact"
            ]
            self.assertEqual(claim["authority"], "signage-ready")
            self.assertEqual(claim["expectedIdentity"], NEW_ARTIFACT_IDENTITY)
            self.assertEqual(claim["observedIdentity"], NEW_ARTIFACT_IDENTITY)
            self.assertEqual(claim["verificationId"], FORWARD_VERIFICATION_ID)
            self.assertIsNone(runtime.fleet["activeRun"])
            self.assertEqual(runtime.fleet["lastRun"]["status"], "success")

        with self.subTest(outcome="safe-capture-failure"):
            runtime = make_runtime()
            runtime.manifest_capture_error = TerminalManifestCapturePreMutationError(
                "terminal manifest capture identity/account: terminal account is unavailable"
            )
            with self.assertRaises(TerminalManifestCapturePreMutationError):
                coordinator.execute(
                    args(), runtime=runtime, token=FakeToken(runtime.events)
                )

            self.assertFalse(
                any(event.startswith("status:") for event in runtime.events)
            )
            self.assertNotIn("stage3:stage:signage-a:run-1", runtime.events)
            self.assertNotIn("playbook:signage-a", runtime.events)
            target = runtime.states[-1].target("signage-a")
            self.assertNotIn("maintenanceStartedAt", target)
            self.assertNotIn("rollbackManifest", target)
            self.assertEqual(runtime.states[-1].payload["state"], "failed")
            self.assertEqual(runtime.states[-1].payload["phase"], "completed")
            self.assertIsNone(runtime.fleet["activeRun"])
            self.assertEqual(runtime.fleet["lastRun"]["status"], "failed")

    def test_signage_verification_only_skips_ansible_and_promotes_ready_claim(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        signage = host_record("signage", NEW_SHA)
        signage["releaseClaims"] = {
            "signageReleaseArtifact": {
                **verified_claim(
                    NEW_ARTIFACT_IDENTITY,
                    "signage-ready",
                    verification_id=FORWARD_VERIFICATION_ID,
                ),
                "state": "unknown",
            }
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                terminal["host"]: signage,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "activationExecutionEnabled": True,
                "verificationOnlyExecutionEnabled": True,
                "mutationTargets": [],
                "activationTargets": [],
                "verificationTargets": [{"host": terminal["host"]}],
                "terminalWork": [
                    {
                        "host": terminal["host"],
                        "role": "signage",
                        "mutationRequired": False,
                        "activationRequired": False,
                        "verificationRequired": True,
                        "activationStrategyId": None,
                        "activationMode": None,
                        "claimRequirements": [
                            {
                                "kind": "signageReleaseArtifact",
                                "expectedIdentity": NEW_ARTIFACT_IDENTITY,
                                "status": "stale-or-unverified",
                            }
                        ],
                    }
                ],
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision(
                        terminal["host"],
                        "signage",
                        current=NEW_SHA,
                        targeted=False,
                        reason="typed claim verification",
                    ),
                ],
            },
            targets=[terminal],
        )
        runtime.repository_baseline_result = {
            "head": NEW_SHA,
            "repairedLegacyDocs": False,
            "count": 0,
        }
        runtime.deployed_sha[terminal["host"]] = NEW_SHA

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        self.assertNotIn("playbook:signage-a", runtime.events)
        self.assertNotIn(
            "terminal:pipelining-preflight:signage-a", runtime.events
        )
        self.assertIn(
            "signage:ready-proof:signage-a:run-1:s1:"
            f"{NEW_SHA}:{FORWARD_VERIFICATION_ID}",
            runtime.events,
        )
        claim = runtime.fleet["fleet"][terminal["host"]]["releaseClaims"][
            "signageReleaseArtifact"
        ]
        self.assertEqual(claim["authority"], "signage-ready")
        self.assertEqual(claim["state"], "verified")
        self.assertEqual(claim["verificationId"], FORWARD_VERIFICATION_ID)

    def test_status_ready_success_cannot_mask_signage_image_key_failure(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "signage-a": host_record("signage", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "activationExecutionEnabled": True,
                "verificationOnlyExecutionEnabled": True,
                "mutationTargets": [{"host": terminal["host"]}],
                "activationTargets": [],
                "verificationTargets": [{"host": terminal["host"]}],
                "terminalWork": [
                    {
                        "host": terminal["host"],
                        "role": "signage",
                        "mutationRequired": True,
                        "activationRequired": False,
                        "verificationRequired": True,
                        "activationStrategyId": None,
                        "activationMode": None,
                        "claimRequirements": [
                            {
                                "kind": "signageReleaseArtifact",
                                "expectedIdentity": NEW_ARTIFACT_IDENTITY,
                                "status": "stale-or-unverified",
                            }
                        ],
                    }
                ],
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("signage-a", "signage"),
                ],
            },
            targets=[terminal],
        )
        runtime.signage_refresh_error = RuntimeError("signage image key rejected")

        with self.assertRaisesRegex(RuntimeError, "terminal finalization failed"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertTrue(
            any(event.startswith("signage:ready-proof:") for event in runtime.events)
        )
        self.assertIn("signage:refresh:signage-a:run-1", runtime.events)
        self.assertFalse(
            any(
                event.startswith("fleet:verified:signage-a:")
                for event in runtime.events
            )
        )
        self.assertNotIn("stage3:rollback:signage-a:run-1", runtime.events)
        target = runtime.states[-1].target("signage-a")
        self.assertEqual(target["evidence"], "unknown")
        self.assertIn("signage image key rejected", target["finalizationFailure"])

    def test_cancel_after_maintenance_restores_before_run_cancels(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )

        result = coordinator.execute(
            args(),
            runtime=runtime,
            token=FakeToken(runtime.events, cancel_at="after-maintenance:kiosk-a"),
        )

        self.assertEqual(result, 130)
        self.assertLess(
            runtime.events.index("rollback:kiosk-a"),
            runtime.events.index(
                "manifest:cleanup:kiosk-a:run-1:restored"
            ),
        )
        self.assertLess(
            runtime.events.index("manifest:cleanup:kiosk-a:run-1:restored"),
            runtime.events.index("fleet:finish:cancelled"),
        )
        self.assertNotIn("playbook:kiosk-a", runtime.events)
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(
            runtime.states[-1].payload["cancellation"]["checkpoint"],
            "after-maintenance:kiosk-a",
        )

    def test_maintenance_ack_timeout_is_a_warning_before_terminal_apply(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.maintenance_ack = False

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 0)
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertIn("playbook:kiosk-a", runtime.events)
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["maintenance"]["state"], "unconfirmed")
        self.assertEqual(target["warnings"][0]["phase"], "maintenance")
        self.assertEqual(runtime.states[-1].payload["warnings"][0]["host"], "kiosk-a")

    def test_full_signage_failure_matrix_recovers_before_next_plan(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }

        def make_runtime():
            return FakeRuntime(
                fleet={
                    "pi5": host_record("server", OLD_SHA),
                    "signage-a": host_record("signage", OLD_SHA),
                },
                hosts=[{"host": "pi5", "role": "server"}, terminal],
                plan={
                    "pi5Required": False,
                    "activationExecutionEnabled": True,
                    "verificationOnlyExecutionEnabled": True,
                    "mutationTargets": [{"host": terminal["host"]}],
                    "activationTargets": [],
                    "verificationTargets": [{"host": terminal["host"]}],
                    "terminalWork": [
                        {
                            "host": terminal["host"],
                            "role": "signage",
                            "mutationRequired": True,
                            "activationRequired": False,
                            "verificationRequired": True,
                            "activationStrategyId": None,
                            "activationMode": None,
                            "claimRequirements": [
                                {
                                    "kind": "signageReleaseArtifact",
                                    "expectedIdentity": NEW_ARTIFACT_IDENTITY,
                                    "status": "stale-or-unverified",
                                }
                            ],
                        }
                    ],
                    "hosts": [
                        decision("pi5", "server", targeted=False),
                        decision("signage-a", "signage"),
                    ],
                },
                targets=[terminal],
            )

        cases = (
            ("status-put", {"state_command_error_once_action": "put"}, False),
            (
                "status-set-phase",
                {"state_command_error_once_action": "set-phase"},
                False,
            ),
            ("prestage", {"prestage_error": RuntimeError("prestage lost")}, False),
            ("playbook", {"playbook_error": RuntimeError("deploy failed")}, False),
            ("ready-ack", {"ready_ack_error": RuntimeError("ready lost")}, False),
            (
                "forward-observation",
                {
                    "terminal_observation_error": RuntimeError("probe lost"),
                    "terminal_observation_failures": 1,
                },
                False,
            ),
            (
                "forward-remove-maintenance",
                {"state_command_error_once_action": "remove-client"},
                True,
            ),
            (
                "forward-signage-refresh",
                {"signage_refresh_error": RuntimeError("refresh lost")},
                True,
            ),
            (
                "forward-runtime-cleanup",
                {"runtime_cleanup_error": RuntimeError("cleanup lost")},
                True,
            ),
            (
                "forward-fleet-persist",
                {"fleet_verified_error_host": "signage-a"},
                True,
            ),
            (
                "rollback-restore",
                {
                    "playbook_error": RuntimeError("deploy failed"),
                    "rollback_ok": False,
                },
                True,
            ),
            (
                "rollback-observation",
                {
                    "playbook_error": RuntimeError("deploy failed"),
                    "terminal_observation_error": RuntimeError("probe lost"),
                    "terminal_observation_failures": 1,
                },
                True,
            ),
            (
                "rollback-remove-maintenance",
                {
                    "playbook_error": RuntimeError("deploy failed"),
                    "state_command_error_once_action": "remove-client",
                },
                True,
            ),
            (
                "rollback-signage-refresh",
                {
                    "playbook_error": RuntimeError("deploy failed"),
                    "signage_refresh_error": RuntimeError("refresh lost"),
                },
                True,
            ),
            (
                "rollback-runtime-cleanup",
                {
                    "playbook_error": RuntimeError("deploy failed"),
                    "runtime_cleanup_error": RuntimeError("cleanup lost"),
                },
                True,
            ),
            (
                "rollback-fleet-persist",
                {
                    "playbook_error": RuntimeError("deploy failed"),
                    "fleet_verified_error_host": "signage-a",
                },
                True,
            ),
        )
        self.assertEqual(len(cases), 16)

        for name, injected, requires_recovery in cases:
            with self.subTest(name=name):
                runtime = make_runtime()
                for attribute, value in injected.items():
                    setattr(runtime, attribute, value)

                with self.assertRaises(RuntimeError):
                    coordinator.execute(
                        args(), runtime=runtime, token=FakeToken(runtime.events)
                    )

                active = runtime.fleet["activeRun"]
                self.assertEqual(active is not None, requires_recovery)
                if not requires_recovery:
                    recovered = runtime.fleet["fleet"]["signage-a"]
                    self.assertEqual(recovered["evidence"], "verified")
                    claim = recovered["releaseClaims"]["terminalRepository"]
                    self.assertEqual(claim["state"], "verified")
                    self.assertEqual(
                        claim["expectedIdentity"], recovered["currentSha"]
                    )
                    self.assertEqual(
                        claim["observedIdentity"], recovered["currentSha"]
                    )
                    continue

                failed_state = copy.deepcopy(runtime.states[-1].payload)
                runtime.prior_runs["run-1"] = failed_state
                runtime.abandoned_run_id = "run-1"
                runtime.plan = {
                    "pi5Required": False,
                    "hosts": [
                        decision("pi5", "server", targeted=False),
                        decision("signage-a", "signage", targeted=False),
                    ],
                }
                runtime.targets = []
                runtime.prestage_error = None
                runtime.playbook_error = None
                runtime.rollback_ok = True
                runtime.maintenance_ack = True
                runtime.ready_ack_error = None
                runtime.terminal_observation_error = None
                runtime.terminal_observation_failures = None
                runtime.signage_refresh_error = None
                runtime.runtime_cleanup_error = None
                runtime.fleet_verified_error_host = None
                runtime.state_command_error_once_action = None

                self.assertEqual(
                    coordinator.execute(
                        args(run_id="recovery-run"),
                        runtime=runtime,
                        token=FakeToken(runtime.events),
                    ),
                    0,
                )
                recovered = runtime.fleet["fleet"]["signage-a"]
                self.assertEqual(recovered["evidence"], "verified")
                self.assertEqual(recovered["lastRunId"], "recovery-run")
                claim_kind = (
                    "signageReleaseArtifact"
                    if recovered["currentSha"] == NEW_SHA
                    else "terminalRepository"
                )
                claim = recovered["releaseClaims"][claim_kind]
                self.assertEqual(claim["state"], "verified")
                expected_identity = (
                    NEW_ARTIFACT_IDENTITY
                    if claim_kind == "signageReleaseArtifact"
                    else recovered["currentSha"]
                )
                self.assertEqual(claim["expectedIdentity"], expected_identity)
                self.assertEqual(claim["observedIdentity"], expected_identity)
                self.assertIsNone(runtime.fleet["activeRun"])

    def test_terminal_only_kiosk_acks_the_verified_web_release(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["newSha"], NEW_SHA)
        self.assertEqual(target["expectedReadySha"], OLD_SHA)
        self.assertEqual(target["readyReleaseSha"], OLD_SHA)
        self.assertEqual(target["readyVerificationId"], FORWARD_VERIFICATION_ID)
        self.assertIn(
            "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
            f"--desired-release-sha:{OLD_SHA}",
            runtime.events,
        )

    def test_post_health_fleet_failure_never_rolls_the_exposed_terminal_back(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.fleet_verified_error_host = "kiosk-a"

        with self.assertRaisesRegex(RuntimeError, "terminal finalization failed"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn(
            "status:remove-client:--run-id:run-1:--client:a", runtime.events
        )
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        target = runtime.states[-1].target("kiosk-a")
        self.assertIn("maintenanceClearedAt", target)
        self.assertEqual(target["evidence"], "unknown")
        self.assertIn("fleet persistence unavailable", target["finalizationFailure"])
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertNotIn("fleet:finish:failed", runtime.events)
        self.assertEqual(runtime.fleet["activeRun"]["runId"], "run-1")

    def test_forward_runtime_cleanup_failure_stays_unknown_without_rollback(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.runtime_cleanup_error = RuntimeError("runtime cleanup unavailable")

        with self.assertRaisesRegex(RuntimeError, "terminal finalization failed"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn(
            "manifest:cleanup:kiosk-a:run-1:committed", runtime.events
        )
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertFalse(
            any(
                event.startswith("fleet:verified:kiosk-a:")
                for event in runtime.events
            )
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(
            target["runtimeFinalization"],
            {"outcome": "committed", "verifiedSha": NEW_SHA},
        )
        self.assertIn("maintenanceClearedAt", target)
        self.assertIn("runtime cleanup unavailable", target["finalizationFailure"])
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")

    def test_rollback_runtime_cleanup_failure_keeps_rollback_evidence_unknown(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.playbook_error = RuntimeError("deploy failed")
        runtime.runtime_cleanup_error = RuntimeError("runtime cleanup unavailable")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("rollback:kiosk-a", runtime.events)
        self.assertIn(
            "manifest:cleanup:kiosk-a:run-1:restored", runtime.events
        )
        self.assertFalse(
            any(
                event.startswith("fleet:verified:kiosk-a:")
                for event in runtime.events
            )
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertIn("runtime cleanup unavailable", target["rollbackEvidence"])
        self.assertEqual(
            target["runtimeFinalization"],
            {"outcome": "restored", "verifiedSha": OLD_SHA},
        )
        self.assertIn("maintenanceClearedAt", target)
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")

    def test_rollback_display_failure_preserves_partial_proof_and_still_cleans(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "signage-a": host_record("signage", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("signage-a", "signage"),
                ],
            },
            targets=[terminal],
        )
        runtime.playbook_error = RuntimeError("deploy failed")
        runtime.signage_refresh_error = RuntimeError("runtime proof failed")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        set_failed = runtime.events.index(
            "status:set-phase:--run-id:run-1:--client:s1:--phase:failed"
        )
        remove = runtime.events.index(
            "status:remove-client:--run-id:run-1:--client:s1"
        )
        refresh = runtime.events.index("signage:refresh:signage-a:run-1")
        cleanup = runtime.events.index(
            "stage3:cleanup:signage-a:run-1:restored"
        )
        self.assertLess(set_failed, remove)
        self.assertLess(remove, refresh)
        self.assertLess(refresh, cleanup)
        target = runtime.states[-1].target("signage-a")
        self.assertNotIn("rollbackPhaseError", target)
        self.assertEqual(target["rollbackProofs"]["repository"]["state"], "verified")
        self.assertEqual(target["rollbackProofs"]["runtime"]["state"], "verified")
        self.assertEqual(target["rollbackProofs"]["display"]["state"], "unknown")
        self.assertEqual(target["rollbackProofs"]["cleanup"]["state"], "verified")
        self.assertIn("runtime proof failed", target["rollbackEvidence"])
        self.assertIn("runtimeCleanup", target)
        self.assertEqual(target["runtimeCleanup"]["outcome"], "restored")
        self.assertIn("maintenanceClearedAt", target)
        self.assertEqual(runtime.fleet["fleet"]["signage-a"]["evidence"], "unknown")

    def test_rollback_observation_failure_still_records_cleanup_receipt(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.playbook_error = RuntimeError("deploy failed")
        runtime.terminal_observation_error = RuntimeError("probe lost")
        runtime.terminal_observation_failures = 1

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn(
            "manifest:cleanup:kiosk-a:run-1:restored", runtime.events
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["rollbackProofs"]["repository"]["state"], "restored")
        self.assertEqual(target["rollbackProofs"]["runtime"]["state"], "verified")
        self.assertEqual(target["rollbackProofs"]["display"]["state"], "unknown")
        self.assertEqual(target["rollbackProofs"]["cleanup"]["state"], "verified")
        self.assertIn("probe lost", target["rollbackEvidence"])
        self.assertIn("runtimeCleanup", target)
        self.assertNotIn("maintenanceClearedAt", target)

    def test_pi5_host_config_failure_stops_before_candidate_and_terminals(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        server = decision("pi5", "server")
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": True,
                "hosts": [server, decision("kiosk-a", "kiosk")],
            },
            targets=[terminal],
        )
        runtime.host_config_error = RuntimeError("host config failed")

        with self.assertRaisesRegex(RuntimeError, "host config failed"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertLess(
            runtime.events.index("pi5:config-capture:pi5:run-1"),
            runtime.events.index(f"pi5:host-config:pi5:{NEW_SHA}"),
        )
        self.assertIn(f"pi5:host-config:pi5:{NEW_SHA}", runtime.events)
        self.assertIn("pi5:config-restore:pi5:run-1", runtime.events)
        self.assertNotIn("pi5:ensure", runtime.events)
        self.assertFalse(
            any(event.startswith("observe:server:") for event in runtime.events)
        )
        self.assertEqual(runtime.fleet["fleet"]["pi5"]["evidence"], "unknown")
        self.assertEqual(
            runtime.fleet["fleet"]["kiosk-a"], host_record("kiosk", OLD_SHA)
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["state"], "pending")
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(target["evidence"], "verified")
        for forbidden in (
            "fleet:unknown:kiosk-a",
            "terminal:previous:kiosk-a",
            "playbook:kiosk-a",
            "observe:terminal:kiosk-a",
            "rollback:kiosk-a",
            "signage:prestage",
        ):
            self.assertNotIn(forbidden, runtime.events)
        self.assertFalse(any(event.startswith("status:") for event in runtime.events))
        self.assertNotIn("kiosk-a", runtime.deployed_sha)
        self.assertIn("fleet:finish:failed", runtime.events)
        self.assertIsNone(runtime.fleet["activeRun"])
        self.assertEqual(
            runtime.states[-1].payload["serverConfig"]["state"], "restored"
        )

    def test_pi5_host_config_restore_failure_retains_active_recovery_authority(self):
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", OLD_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan={
                "pi5Required": True,
                "hosts": [decision("pi5", "server")],
            },
            targets=[],
        )
        runtime.host_config_error = RuntimeError("host config failed")
        runtime.server_config_restore_error = RuntimeError("restore unavailable")

        with self.assertRaisesRegex(
            RuntimeError, "server config convergence and restore failed"
        ):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("pi5:config-restore:pi5:run-1", runtime.events)
        self.assertNotIn("fleet:finish:failed", runtime.events)
        self.assertEqual(runtime.fleet["activeRun"]["runId"], "run-1")
        config = runtime.states[-1].payload["serverConfig"]
        self.assertEqual(config["state"], "restore-failed")
        self.assertIn("restore unavailable", config["restoreFailure"])

    def test_pi5_config_capture_failure_is_mutation_free_and_recoverable(self):
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", OLD_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan={
                "pi5Required": True,
                "hosts": [decision("pi5", "server")],
            },
            targets=[],
        )
        runtime.server_config_capture_error = RuntimeError("capture unavailable")

        with self.assertRaisesRegex(RuntimeError, "capture unavailable"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("pi5:config-capture:pi5:run-1", runtime.events)
        self.assertNotIn(f"pi5:host-config:pi5:{NEW_SHA}", runtime.events)
        self.assertNotIn("pi5:config-restore:pi5:run-1", runtime.events)
        self.assertNotIn("pi5:ensure", runtime.events)
        self.assertNotIn("fleet:finish:failed", runtime.events)
        self.assertEqual(runtime.fleet["activeRun"]["runId"], "run-1")
        self.assertEqual(
            runtime.states[-1].payload["serverConfig"]["state"],
            "capture-pending",
        )

    def test_interrupted_captured_pi5_config_restores_before_noop_planning(self):
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", NEW_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False)
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.prior_runs["crashed-run"] = {
            "runId": "crashed-run",
            "inventory": "inventory.yml",
            "serverConfig": {
                "state": "captured",
                "authorityRunId": "crashed-run",
                "host": "pi5",
                "sha": NEW_SHA,
                "rollbackManifest": server_config_manifest("crashed-run"),
            },
            "targets": [],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        restore = runtime.events.index("pi5:config-restore:pi5:crashed-run")
        self.assertLess(restore, runtime.events.index("fleet:finish:success"))
        recovery = runtime.states[-1].payload["interruptedServerConfig"]
        self.assertEqual(recovery["state"], "restored")
        self.assertEqual(recovery["authorityRunId"], "crashed-run")

    def test_interrupted_capture_pending_recaptures_same_run_before_restore(self):
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", NEW_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False)
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.prior_runs["crashed-run"] = {
            "runId": "crashed-run",
            "inventory": "inventory.yml",
            "serverConfig": {
                "state": "capture-pending",
                "authorityRunId": "crashed-run",
                "host": "pi5",
                "sha": NEW_SHA,
            },
            "targets": [],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        capture = runtime.events.index("pi5:config-capture:pi5:crashed-run")
        restore = runtime.events.index("pi5:config-restore:pi5:crashed-run")
        self.assertLess(capture, restore)
        self.assertEqual(
            runtime.states[-1].payload["interruptedServerConfig"]["state"],
            "restored",
        )

    def test_cancel_after_pi5_host_config_never_starts_candidate_or_terminals(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        server = decision("pi5", "server")
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": True,
                "hosts": [server, decision("kiosk-a", "kiosk")],
            },
            targets=[terminal],
        )

        result = coordinator.execute(
            args(),
            runtime=runtime,
            token=FakeToken(runtime.events, cancel_at="after-pi5-host-config"),
        )

        self.assertEqual(result, 130)
        self.assertIn(f"pi5:host-config:pi5:{NEW_SHA}", runtime.events)
        self.assertNotIn("pi5:ensure", runtime.events)
        self.assertEqual(
            runtime.fleet["fleet"]["kiosk-a"], host_record("kiosk", OLD_SHA)
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["state"], "pending")
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(target["evidence"], "verified")
        for forbidden in (
            "fleet:unknown:kiosk-a",
            "terminal:previous:kiosk-a",
            "playbook:kiosk-a",
            "observe:terminal:kiosk-a",
            "rollback:kiosk-a",
            "signage:prestage",
        ):
            self.assertNotIn(forbidden, runtime.events)
        status_events = [
            event for event in runtime.events if event.startswith("status:")
        ]
        self.assertEqual(
            status_events, ["status:remove-run:--run-id:run-1"]
        )
        self.assertNotIn("kiosk-a", runtime.deployed_sha)
        self.assertIn("fleet:finish:cancelled", runtime.events)

    def test_verified_rollback_is_observed_then_run_finishes_failed(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        plan = {
            "pi5Required": False,
            "hosts": [
                decision("pi5", "server", targeted=False),
                decision("kiosk-a", "kiosk"),
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )
        runtime.playbook_error = RuntimeError("deploy failed")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertEqual(runtime.events.count("fleet:unknown:kiosk-a"), 2)
        self.assertLess(
            runtime.events.index("rollback:kiosk-a"),
            runtime.events.index("observe:terminal:kiosk-a"),
        )
        self.assertIn(
            "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
            f"--desired-release-sha:{OLD_SHA}:--rollback",
            runtime.events,
        )
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["currentSha"], OLD_SHA)
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "verified")
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["expectedRollbackReadySha"], OLD_SHA)
        self.assertEqual(target["rollbackReadyReleaseSha"], OLD_SHA)
        self.assertEqual(
            target["expectedRollbackReadyVerificationId"],
            ROLLBACK_VERIFICATION_ID,
        )
        self.assertEqual(
            target["rollbackReadyVerificationId"], ROLLBACK_VERIFICATION_ID
        )
        self.assertIn("maintenanceClearedAt", target)
        self.assertIn(
            ("kiosk-a", rollback_runtime_health("kiosk")),
            runtime.observed_runtime_health,
        )
        self.assertLess(
            runtime.events.index("manifest:cleanup:kiosk-a:run-1:restored"),
            runtime.events.index(f"fleet:verified:kiosk-a:{OLD_SHA}"),
        )
        self.assertIn("fleet:finish:failed", runtime.events)

    def test_kiosk_agent_death_after_playbook_is_caught_by_final_observation(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.terminal_observation_error = RuntimeError(
            "nfc-agent died after playbook"
        )
        runtime.terminal_observation_failures = 1

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        playbook = runtime.events.index("playbook:kiosk-a")
        first_observe = runtime.events.index("observe:terminal:kiosk-a")
        rollback = runtime.events.index("rollback:kiosk-a")
        self.assertLess(playbook, first_observe)
        self.assertLess(first_observe, rollback)
        self.assertEqual(runtime.events.count("observe:terminal:kiosk-a"), 2)
        target = runtime.states[-1].target("kiosk-a")
        self.assertIn("nfc-agent died after playbook", target["failure"])
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["currentSha"], OLD_SHA)

    def test_execution_uses_each_hosts_role_specific_desired_sha(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        stale_desired = decision("kiosk-a", "kiosk")
        stale_desired.update(
            {
                "desiredSha": OLD_SHA,
                "targetReason": "desired SHA differs from role-specific plan",
            }
        )
        plan = {
            "pi5Required": False,
            "hosts": [
                decision("pi5", "server", targeted=False),
                stale_desired,
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 0)
        self.assertEqual(runtime.deployed_sha["kiosk-a"], OLD_SHA)
        record = runtime.fleet["fleet"]["kiosk-a"]
        self.assertEqual(record["desiredSha"], OLD_SHA)
        self.assertEqual(record["currentSha"], OLD_SHA)

    def test_pi5_execution_uses_server_specific_desired_sha(self):
        server = decision("pi5", "server")
        server.update(
            {
                "desiredSha": OLD_SHA,
                "targetReason": "desired SHA differs from role-specific plan",
            }
        )
        plan = {"pi5Required": True, "hosts": [server]}
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", OLD_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan=plan,
            targets=[],
        )

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 0)
        self.assertEqual(runtime.pi5_release_sha, OLD_SHA)
        record = runtime.fleet["fleet"]["pi5"]
        self.assertEqual(record["desiredSha"], OLD_SHA)
        self.assertEqual(record["currentSha"], OLD_SHA)

    def test_unverifiable_rollback_remains_unknown(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        plan = {
            "pi5Required": False,
            "activationExecutionEnabled": True,
            "verificationOnlyExecutionEnabled": True,
            "mutationTargets": [{"host": terminal["host"]}],
            "activationTargets": [],
            "verificationTargets": [{"host": terminal["host"]}],
            "terminalWork": [
                {
                    "host": terminal["host"],
                    "role": "kiosk",
                    "mutationRequired": True,
                    "activationRequired": False,
                    "verificationRequired": True,
                    "activationStrategyId": "kiosk-web-activation-v1",
                    "activationMode": None,
                    "claimRequirements": [
                        {
                            "kind": "controlPlaneWeb",
                            "expectedIdentity": OLD_SHA,
                            "status": "current",
                        },
                        {
                            "kind": "terminalRepository",
                            "expectedIdentity": NEW_SHA,
                            "status": "stale-or-unverified",
                        },
                    ],
                }
            ],
            "hosts": [
                decision("pi5", "server", targeted=False),
                decision("kiosk-a", "kiosk"),
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )
        runtime.playbook_error = RuntimeError("deploy failed")
        runtime.terminal_observation_error = RuntimeError("host unreachable")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")
        claims = runtime.fleet["fleet"]["kiosk-a"]["releaseClaims"]
        self.assertEqual(set(claims), {"controlPlaneWeb", "terminalRepository"})
        self.assertTrue(
            all(claim["state"] == "unknown" for claim in claims.values())
        )
        self.assertTrue(
            all(claim["observedIdentity"] is None for claim in claims.values())
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertIn("host unreachable", target["rollbackEvidence"])
        self.assertNotIn("maintenanceClearedAt", target)
        self.assertNotIn(
            "status:remove-client:--run-id:run-1:--client:a",
            runtime.events,
        )
        self.assertNotIn("fleet:finish:failed", runtime.events)
        self.assertEqual(runtime.fleet["activeRun"]["runId"], "run-1")

    def test_cancel_during_ready_wait_rolls_back_before_cancel_finishes(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.ready_ack_error = CancellationRequested(
            "operator stop", "wait-ready-ack:a"
        )

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 130)
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(target["rollbackReadyReleaseSha"], OLD_SHA)
        self.assertEqual(
            target["rollbackReadyVerificationId"], ROLLBACK_VERIFICATION_ID
        )
        self.assertNotEqual(
            target["expectedReadyVerificationId"],
            target["rollbackReadyVerificationId"],
        )
        self.assertIn("maintenanceClearedAt", target)
        self.assertIn(
            "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
            f"--desired-release-sha:{OLD_SHA}:--rollback",
            runtime.events,
        )
        self.assertLess(
            runtime.events.index("rollback:kiosk-a"),
            runtime.events.index("manifest:cleanup:kiosk-a:run-1:restored"),
        )
        self.assertLess(
            runtime.events.index("manifest:cleanup:kiosk-a:run-1:restored"),
            runtime.events.index("fleet:finish:cancelled"),
        )
        self.assertIn(
            "status:remove-run:--run-id:run-1", runtime.events
        )
        self.assertEqual(
            runtime.states[-1].payload["cancellation"]["checkpoint"],
            "wait-ready-ack:a",
        )

    def test_cancel_with_unknown_rollback_keeps_terminal_maintenance(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.ready_ack_error = CancellationRequested(
            "operator stop", "wait-ready-ack:a"
        )
        runtime.terminal_observation_error = RuntimeError("health unavailable")

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 130)
        target = runtime.states[-1].target("kiosk-a")
        self.assertIn("health unavailable", target["rollbackEvidence"])
        self.assertNotIn("maintenanceClearedAt", target)
        self.assertEqual(
            runtime.states[-1].payload["cancellationCleanup"]["state"],
            "retained",
        )
        self.assertNotIn(
            "status:remove-run:--run-id:run-1", runtime.events
        )
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")

    def test_cancellation_finishes_fleet_before_legacy_terminal_state(self):
        plan = {
            "pi5Required": False,
            "hosts": [decision("pi5", "server", targeted=False)],
        }
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", OLD_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan=plan,
            targets=[],
        )

        result = coordinator.execute(
            args(),
            runtime=runtime,
            token=FakeToken(runtime.events, cancel_at="plan-complete"),
        )

        self.assertEqual(result, 130)
        finish = runtime.events.index("fleet:finish:cancelled")
        final_save = max(
            index
            for index, event in enumerate(runtime.events)
            if event.startswith("legacy:save:cancelled:completed")
        )
        self.assertLess(finish, final_save)
        self.assertIsNone(runtime.fleet["activeRun"])

    def test_late_cancel_finishes_both_formats_as_cancelled(self):
        plan = {
            "pi5Required": False,
            "hosts": [decision("pi5", "server", targeted=False)],
        }
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", OLD_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan=plan,
            targets=[],
        )
        runtime.cancel_at_finish = True

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 130)
        self.assertEqual(runtime.fleet["lastRun"]["status"], "cancelled")
        self.assertTrue(
            runtime.events[-1].startswith("legacy:save:cancelled:completed")
        )

    def test_abandoned_run_hosts_are_not_seed_promoted(self):
        stranded = host_record("kiosk", NEW_SHA)
        stranded["lastRunId"] = "abandoned-run"
        hosts = [{"host": "kiosk-a", "role": "kiosk", "clientId": "a"}]
        runtime = FakeRuntime(
            fleet={"kiosk-a": stranded}, hosts=hosts, plan={}, targets=[]
        )

        state, failures = coordinator._seed_unverified_hosts(
            hosts,
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="run-2",
            desired_sha=NEW_SHA,
            abandoned_run_id="abandoned-run",
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(state["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertNotIn("observe:terminal:kiosk-a", runtime.events)
        self.assertIn("interrupted", failures[0]["error"])

    def test_new_run_restores_interrupted_terminal_before_planning(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "desiredSha": NEW_SHA,
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": interrupted,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision("kiosk-a", "kiosk", targeted=False),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "running",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "currentSha": None,
                    "evidence": "unknown",
                    "state": "deploying",
                    "maintenanceStartedAt": "2026-07-14T23:59:00Z",
                    "rollbackManifest": rollback_manifest(
                        "crashed-run", "kiosk-a"
                    ),
                }
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        self.assertLess(
            runtime.events.index("legacy:read:crashed-run"),
            runtime.events.index("rollback:kiosk-a"),
        )
        recovery_put = (
            "status:put:--run-id:crashed-run:--clients:a:"
            "--terminal-type:kiosk:--phase:failed"
        )
        self.assertLess(
            runtime.events.index(recovery_put),
            runtime.events.index("rollback:kiosk-a"),
        )
        self.assertLess(
            runtime.events.index("rollback:kiosk-a"),
            runtime.events.index(
                "manifest:cleanup:kiosk-a:crashed-run:restored"
            ),
        )
        self.assertLess(
            runtime.events.index(
                "manifest:cleanup:kiosk-a:crashed-run:restored"
            ),
            runtime.events.index(f"fleet:verified:kiosk-a:{OLD_SHA}"),
        )
        self.assertNotIn(f"manifest:capture:kiosk-a:{OLD_SHA}", runtime.events)
        record = runtime.fleet["fleet"]["kiosk-a"]
        self.assertEqual(record["currentSha"], OLD_SHA)
        self.assertEqual(record["evidence"], "verified")
        recovery = runtime.states[-1].payload["interruptedRecovery"]
        self.assertEqual(recovery["runId"], "crashed-run")
        self.assertEqual(recovery["targets"][0]["recovery"], "manifest-restored")
        self.assertEqual(
            recovery["targets"][0]["expectedRollbackReadySha"], NEW_SHA
        )
        self.assertIn(
            f"status:verification:a:{NEW_SHA}:{ROLLBACK_VERIFICATION_ID}",
            runtime.events,
        )
        self.assertIn(
            "status:remove-client:--run-id:crashed-run:--client:a",
            runtime.events,
        )
        self.assertIn(
            ("kiosk-a", rollback_runtime_health("kiosk")),
            runtime.observed_runtime_health,
        )

    def test_interrupted_signage_recovery_refreshes_after_remove_before_promotion(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        interrupted = host_record("signage", OLD_SHA)
        interrupted.update(
            {
                "desiredSha": NEW_SHA,
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "signage-a": interrupted,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision("signage-a", "signage", targeted=False),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "running",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "currentSha": None,
                    "evidence": "unknown",
                    "state": "deploying",
                    "maintenanceStartedAt": "2026-07-14T23:59:00Z",
                    "rollbackManifest": rollback_manifest(
                        "crashed-run", "signage-a", "signage"
                    ),
                }
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        remove = runtime.events.index(
            "status:remove-client:--run-id:crashed-run:--client:s1"
        )
        refresh = runtime.events.index(
            "signage:refresh:signage-a:crashed-run"
        )
        cleanup = runtime.events.index(
            "manifest:cleanup:signage-a:crashed-run:restored"
        )
        promote = runtime.events.index(f"fleet:verified:signage-a:{OLD_SHA}")
        self.assertLess(remove, refresh)
        self.assertLess(refresh, cleanup)
        self.assertLess(cleanup, promote)
        recovery = runtime.states[-1].payload["interruptedRecovery"]["targets"][0]
        self.assertTrue(
            recovery["signageDisplayProof"]["maintenanceArtifactReplaced"]
        )

    def test_interrupted_failure_does_not_mark_later_completed_terminal_unknown(self):
        signage = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        kiosk = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "k1",
        }
        interrupted = host_record("signage", OLD_SHA)
        interrupted.update(
            {
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "crashed-run",
            }
        )
        completed = host_record("kiosk", NEW_SHA)
        completed["lastRunId"] = "crashed-run"
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "signage-a": interrupted,
                "kiosk-a": completed,
            },
            hosts=[{"host": "pi5", "role": "server"}, signage, kiosk],
            plan={},
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.rollback_ok = False
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "interrupted",
            "targets": [
                {
                    **signage,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "state": "rolling-back",
                    "maintenanceStartedAt": "2026-07-14T23:59:00Z",
                    "rollbackManifest": rollback_manifest(
                        "crashed-run", "signage-a", "signage"
                    ),
                },
                {
                    **kiosk,
                    "desiredSha": NEW_SHA,
                    "currentSha": NEW_SHA,
                    "newSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "evidence": "verified",
                    "state": "success",
                    "maintenanceStartedAt": "2026-07-14T23:55:00Z",
                    "maintenanceClearedAt": "2026-07-14T23:56:00Z",
                    "rollbackManifest": rollback_manifest(
                        "crashed-run", "kiosk-a"
                    ),
                },
            ],
        }

        with self.assertRaisesRegex(RuntimeError, "manifest restore failed"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        kiosk_record = runtime.fleet["fleet"]["kiosk-a"]
        self.assertEqual(kiosk_record["evidence"], "verified")
        self.assertEqual(kiosk_record["currentSha"], NEW_SHA)
        self.assertEqual(kiosk_record["lastRunId"], "crashed-run")
        self.assertNotIn("observe:terminal:kiosk-a", runtime.events)
        self.assertNotIn("fleet:unknown:kiosk-a", runtime.events)

    def test_durable_completed_terminal_repairs_batch_unknown_without_live_probe(self):
        completed_sha = "c" * 40
        signage = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        kiosk = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "k1",
        }
        fleet = {}
        for terminal in (signage, kiosk):
            record = host_record(terminal["role"], OLD_SHA)
            record.update(
                {
                    "desiredSha": NEW_SHA,
                    "currentSha": None,
                    "previousSha": OLD_SHA,
                    "evidence": "unknown",
                    "verifiedAt": None,
                    "lastRunId": "failed-recovery",
                }
            )
            fleet[terminal["host"]] = record
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", NEW_SHA), **fleet},
            hosts=[{"host": "pi5", "role": "server"}, signage, kiosk],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision("signage-a", "signage", current=OLD_SHA, targeted=False),
                    decision(
                        "kiosk-a",
                        "kiosk",
                        current=completed_sha,
                        targeted=False,
                    ),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "failed-recovery"
        runtime.rollback_preflight_by_host["kiosk-a"] = RuntimeError(
            "a committed manifest must not be reopened"
        )
        runtime.prior_runs["failed-recovery"] = {
            "version": 1,
            "runId": "failed-recovery",
            "state": "failed",
            "targets": [
                {
                    **signage,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "state": "rolling-back",
                    "maintenanceStartedAt": "2026-07-14T23:59:00Z",
                    "rollbackAuthorityRunId": "original-run",
                    "rollbackManifest": rollback_manifest(
                        "original-run", "signage-a", "signage"
                    ),
                },
                {
                    **kiosk,
                    "desiredSha": completed_sha,
                    "currentSha": completed_sha,
                    "newSha": completed_sha,
                    "previousSha": OLD_SHA,
                    "evidence": "verified",
                    "state": "success",
                    "maintenanceStartedAt": "2026-07-14T23:55:00Z",
                    "maintenanceClearedAt": "2026-07-14T23:56:00Z",
                    "rollbackManifest": rollback_manifest(
                        "original-run", "kiosk-a"
                    ),
                    "runtimeFinalization": {
                        "outcome": "committed",
                        "verifiedSha": completed_sha,
                    },
                    "runtimeCleanup": {
                        "outcome": "committed",
                        "cleaned": True,
                        "alreadyClean": False,
                        "manifestSha256": "d" * 64,
                        "tagCount": 1,
                    },
                },
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(run_id="repair-run"),
                runtime=runtime,
                token=FakeToken(runtime.events),
            ),
            0,
        )

        self.assertNotIn("observe:terminal:kiosk-a", runtime.events)
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertNotIn("rollback:preflight:kiosk-a", runtime.events)
        self.assertFalse(
            any(
                event.startswith("manifest:cleanup:kiosk-a:")
                for event in runtime.events
            )
        )
        kiosk_record = runtime.scope_kwargs["fleet_state"]["fleet"]["kiosk-a"]
        self.assertEqual(kiosk_record["evidence"], "verified")
        self.assertEqual(kiosk_record["currentSha"], completed_sha)
        self.assertEqual(kiosk_record["desiredSha"], completed_sha)
        self.assertEqual(kiosk_record["lastRunId"], "repair-run")
        recovered = runtime.states[-1].payload["interruptedRecovery"]["targets"]
        kiosk_recovery = next(
            record for record in recovered if record["host"] == "kiosk-a"
        )
        self.assertEqual(
            kiosk_recovery["recovery"], "durable-success-carried-forward"
        )
        audit = runtime.states[-1].payload["interruptedRecoveryPreflight"]
        kiosk_audit = next(
            record for record in audit["targets"] if record["host"] == "kiosk-a"
        )
        self.assertTrue(kiosk_audit["preflightSkipped"])
        self.assertEqual(kiosk_audit["durableCompletedSha"], completed_sha)

    def test_durable_completed_terminal_rejects_malformed_cleanup_proof(self):
        manifest = rollback_manifest("original-run", "kiosk-a")
        proof = {
            "desiredSha": NEW_SHA,
            "currentSha": NEW_SHA,
            "newSha": NEW_SHA,
            "previousSha": OLD_SHA,
            "evidence": "verified",
            "state": "success",
            "maintenanceStartedAt": "2026-07-14T23:55:00Z",
            "maintenanceClearedAt": "2026-07-14T23:56:00Z",
            "rollbackManifest": manifest,
            "runtimeFinalization": {
                "outcome": "committed",
                "verifiedSha": NEW_SHA,
            },
            "runtimeCleanup": {
                "cleaned": True,
                "alreadyClean": False,
                "manifestSha256": manifest["runtime"]["manifestSha256"],
                "tagCount": 1,
                "outcome": "committed",
            },
        }
        corruptions = (
            {"cleaned": False},
            {"alreadyClean": "false"},
            {"manifestSha256": "e" * 64},
            {"tagCount": -1},
            {"tagCount": 3},
            {"alreadyClean": True, "tagCount": 1},
            {"outcome": "restored"},
        )

        self.assertEqual(
            coordinator._durable_completed_terminal_sha(proof, host="kiosk-a"),
            NEW_SHA,
        )
        for corruption in corruptions:
            with self.subTest(corruption=corruption):
                malformed = copy.deepcopy(proof)
                malformed["runtimeCleanup"].update(corruption)
                with self.assertRaisesRegex(
                    RuntimeError, "completed terminal proof is malformed"
                ):
                    coordinator._durable_completed_terminal_sha(
                        malformed, host="kiosk-a"
                    )

    def test_interrupted_target_without_run_record_fails_closed(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={"kiosk-a": interrupted},
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={},
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"

        with self.assertRaisesRegex(
            RuntimeError, "refusing to capture a partial host"
        ):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("legacy:read:crashed-run", runtime.events)
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertFalse(
            any(event.startswith("manifest:capture:") for event in runtime.events)
        )
        self.assertNotIn("fleet:finish:failed", runtime.events)
        self.assertEqual(runtime.fleet["activeRun"]["runId"], "run-1")

    def test_completed_terminal_in_abandoned_run_is_live_verified_not_reverted(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        completed = host_record("kiosk", NEW_SHA)
        completed["lastRunId"] = "crashed-run"
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": completed,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision(
                        "kiosk-a", "kiosk", current=NEW_SHA, targeted=False
                    ),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "running",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "currentSha": NEW_SHA,
                    "newSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "evidence": "verified",
                    "state": "success",
                    "maintenanceStartedAt": "2026-07-14T23:58:00Z",
                    "maintenanceClearedAt": "2026-07-14T23:59:00Z",
                    "runtimeFinalization": {
                        "outcome": "committed",
                        "verifiedSha": NEW_SHA,
                    },
                    "runtimeCleanup": {
                        "outcome": "committed",
                        "cleaned": True,
                        "alreadyClean": False,
                        "manifestSha256": "d" * 64,
                        "tagCount": 1,
                    },
                    "rollbackManifest": rollback_manifest(
                        "crashed-run", "kiosk-a"
                    ),
                }
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertNotIn(
            "status:remove-client:--run-id:crashed-run:--client:a",
            runtime.events,
        )
        self.assertNotIn(
            "manifest:cleanup:kiosk-a:crashed-run:committed",
            runtime.events,
        )
        self.assertEqual(
            runtime.states[-1].payload["interruptedRecovery"]["targets"][0][
                "recovery"
            ],
            "durable-success-carried-forward",
        )
        self.assertEqual(
            runtime.fleet["fleet"]["kiosk-a"]["currentSha"], NEW_SHA
        )

    def test_pre_mutation_interruption_recaptures_lost_manifest_result(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "desiredSha": NEW_SHA,
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": interrupted,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision("kiosk-a", "kiosk", current=OLD_SHA, targeted=False),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.deployed_sha["kiosk-a"] = OLD_SHA
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "running",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "currentSha": OLD_SHA,
                    "evidence": "unknown",
                    "state": "pending",
                }
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        capture = runtime.events.index(f"manifest:capture:kiosk-a:{OLD_SHA}")
        cleanup = runtime.events.index(
            "manifest:cleanup:kiosk-a:crashed-run:committed"
        )
        verified = runtime.events.index(f"fleet:verified:kiosk-a:{OLD_SHA}")
        self.assertLess(capture, cleanup)
        self.assertLess(cleanup, verified)
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertNotIn(
            "status:remove-client:--run-id:crashed-run:--client:a",
            runtime.events,
        )
        recovery = runtime.states[-1].payload["interruptedRecovery"]["targets"][0]
        self.assertEqual(recovery["recovery"], "pre-mutation-live-verified")
        self.assertEqual(recovery["rollbackAuthorityRunId"], "crashed-run")

    def test_premaintenance_recovery_does_not_promote_incomplete_typed_claims(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        pending_claims = {
            "controlPlaneWeb": {
                "expectedIdentity": NEW_SHA,
                "observedIdentity": None,
                "authority": "kiosk-compiled-web-ready",
                "verificationId": None,
                "state": "unknown",
                "observedAt": None,
                "lastRunId": "crashed-run",
            },
            "terminalRepository": {
                "expectedIdentity": NEW_SHA,
                "observedIdentity": None,
                "authority": "terminal-repository-probe",
                "verificationId": None,
                "state": "unknown",
                "observedAt": None,
                "lastRunId": "crashed-run",
            },
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "desiredSha": NEW_SHA,
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "crashed-run",
                "releaseClaims": copy.deepcopy(pending_claims),
            }
        )
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                terminal["host"]: interrupted,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision(
                        terminal["host"],
                        "kiosk",
                        current=OLD_SHA,
                        targeted=False,
                    ),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.deployed_sha[terminal["host"]] = OLD_SHA
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "running",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "currentSha": OLD_SHA,
                    "evidence": "unknown",
                    "state": "pending",
                    "mutationRequired": True,
                    "activationRequired": True,
                    "verificationRequired": True,
                    "activationStrategyId": "kiosk-web-activation-v1",
                    "activationMode": "one-time-service-activation",
                    "claimRequirements": [
                        {
                            "kind": "controlPlaneWeb",
                            "expectedIdentity": NEW_SHA,
                            "status": "stale-or-unverified",
                        },
                        {
                            "kind": "terminalRepository",
                            "expectedIdentity": NEW_SHA,
                            "status": "stale-or-unverified",
                        },
                    ],
                    "releaseClaims": copy.deepcopy(pending_claims),
                }
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        record = runtime.fleet["fleet"][terminal["host"]]
        self.assertEqual(record["evidence"], "unknown")
        self.assertIsNone(record["currentSha"])
        claims = record["releaseClaims"]
        self.assertEqual(claims["controlPlaneWeb"]["state"], "unknown")
        self.assertEqual(
            claims["terminalRepository"]["expectedIdentity"], OLD_SHA
        )
        self.assertEqual(
            claims["terminalRepository"]["observedIdentity"], OLD_SHA
        )
        self.assertEqual(claims["terminalRepository"]["state"], "verified")
        recovery = runtime.states[-1].payload["interruptedRecovery"]["targets"][0]
        self.assertEqual(recovery["state"], "recovered-claims-incomplete")
        self.assertEqual(recovery["recoveryObservedSha"], OLD_SHA)

    def test_interrupted_typed_claims_rebind_atomically_to_new_run_sha(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        prior_claims = {
            "signageReleaseArtifact": {
                "expectedIdentity": OLD_ARTIFACT_IDENTITY,
                "observedIdentity": None,
                "authority": "signage-ready",
                "verificationId": None,
                "state": "unknown",
                "observedAt": None,
                "lastRunId": "crashed-run",
            }
        }
        interrupted = host_record("signage", OLD_SHA)
        interrupted.update(
            {
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "crashed-run",
                "releaseClaims": copy.deepcopy(prior_claims),
            }
        )

        class StrictFleetRuntime(FakeRuntime):
            def __init__(self, **kwargs):
                super().__init__(**kwargs)
                self.unknown_claim_transitions = []

            def fleet_mark_unknown(
                self,
                host,
                role,
                desired_sha,
                run_id,
                *,
                release_claims=None,
            ):
                if release_claims is not None:
                    candidate = {
                        "role": role,
                        "desiredSha": desired_sha,
                        "currentSha": None,
                    }
                    validate_host_claim_compatibility(
                        candidate, release_claims
                    )
                    self.unknown_claim_transitions.append(
                        copy.deepcopy(release_claims)
                    )
                return super().fleet_mark_unknown(
                    host,
                    role,
                    desired_sha,
                    run_id,
                    release_claims=release_claims,
                )

        runtime = StrictFleetRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                terminal["host"]: interrupted,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision(
                        terminal["host"],
                        "signage",
                        current=OLD_SHA,
                        targeted=False,
                    ),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.deployed_sha[terminal["host"]] = OLD_SHA
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "failed",
            "targets": [
                {
                    **terminal,
                    "desiredSha": OLD_SHA,
                    "previousSha": OLD_SHA,
                    "currentSha": OLD_SHA,
                    "evidence": "unknown",
                    "state": "pending",
                    "mutationRequired": True,
                    "activationRequired": False,
                    "verificationRequired": True,
                    "activationStrategyId": None,
                    "activationMode": None,
                    "claimRequirements": [
                        {
                            "kind": "signageReleaseArtifact",
                            "expectedIdentity": OLD_ARTIFACT_IDENTITY,
                            "status": "stale-or-unverified",
                        }
                    ],
                    "repositoryBaseline": {
                        "head": OLD_SHA,
                        "artifactState": "installed",
                        "artifactIdentity": OLD_ARTIFACT_IDENTITY,
                        "artifactSha256": ARTIFACT_DIGEST,
                        "legacyRepositorySha": None,
                    },
                    "releaseClaims": copy.deepcopy(prior_claims),
                }
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        rebound = runtime.unknown_claim_transitions[0]["signageReleaseArtifact"]
        self.assertEqual(
            rebound["expectedIdentity"],
            NEW_ARTIFACT_IDENTITY,
        )
        self.assertIsNone(rebound["observedIdentity"])
        self.assertEqual(rebound["state"], "unknown")
        self.assertEqual(rebound["lastRunId"], "run-1")
        self.assertEqual(
            runtime.prior_runs["crashed-run"]["targets"][0]["releaseClaims"],
            prior_claims,
        )

    def test_pre_mutation_interruption_preflights_sealed_runtime_health(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "desiredSha": NEW_SHA,
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": interrupted,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision("kiosk-a", "kiosk", current=OLD_SHA, targeted=False),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.deployed_sha["kiosk-a"] = OLD_SHA
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "running",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "currentSha": OLD_SHA,
                    "evidence": "unknown",
                    "state": "pending",
                    "rollbackManifest": rollback_manifest(
                        "crashed-run", "kiosk-a"
                    ),
                }
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        preflight = runtime.events.index("rollback:preflight:kiosk-a")
        observe = runtime.events.index("observe:terminal:kiosk-a")
        self.assertLess(preflight, observe)
        self.assertNotIn(f"manifest:capture:kiosk-a:{OLD_SHA}", runtime.events)
        self.assertEqual(
            runtime.observed_runtime_health,
            [("kiosk-a", rollback_runtime_health("kiosk"))],
        )
        audit = runtime.states[-1].payload["interruptedRecoveryPreflight"]
        self.assertEqual(audit["state"], "success")
        self.assertEqual(audit["targets"][0]["rollbackReadySha"], None)
        self.assertTrue(audit["targets"][0]["runtimeManifestReady"])

    def test_unknown_first_run_recovers_crash_on_either_side_of_repository_baseline(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        for boundary, repaired, count in (
            ("before-baseline", True, 1),
            ("after-baseline-before-persist", False, 0),
        ):
            with self.subTest(boundary=boundary):
                interrupted = {
                    "role": "kiosk",
                    "desiredSha": NEW_SHA,
                    "currentSha": None,
                    "previousSha": None,
                    "evidence": "unknown",
                    "verifiedAt": None,
                    "lastRunId": "crashed-run",
                }
                runtime = FakeRuntime(
                    fleet={
                        "pi5": host_record("server", NEW_SHA),
                        "kiosk-a": interrupted,
                    },
                    hosts=[{"host": "pi5", "role": "server"}, terminal],
                    plan={
                        "pi5Required": False,
                        "hosts": [
                            decision(
                                "pi5", "server", current=NEW_SHA, targeted=False
                            ),
                            decision(
                                "kiosk-a", "kiosk", current=OLD_SHA, targeted=False
                            ),
                        ],
                    },
                    targets=[],
                )
                runtime.abandoned_run_id = "crashed-run"
                runtime.deployed_sha["kiosk-a"] = OLD_SHA
                runtime.repository_baseline_result = {
                    "head": OLD_SHA,
                    "repairedLegacyDocs": repaired,
                    "count": count,
                }
                runtime.prior_runs["crashed-run"] = {
                    "version": 1,
                    "runId": "crashed-run",
                    "state": "running",
                    "targets": [
                        {
                            **terminal,
                            "desiredSha": NEW_SHA,
                            "currentSha": None,
                            "evidence": "unknown",
                            "state": "pending",
                        }
                    ],
                }

                self.assertEqual(
                    coordinator.execute(
                        args(), runtime=runtime, token=FakeToken(runtime.events)
                    ),
                    0,
                )

                baseline = runtime.events.index("terminal:baseline:kiosk-a")
                capture = runtime.events.index(
                    f"manifest:capture:kiosk-a:{OLD_SHA}"
                )
                observe = runtime.events.index("observe:terminal:kiosk-a")
                self.assertLess(baseline, capture)
                self.assertLess(capture, observe)
                recovery = runtime.states[-1].payload["interruptedRecovery"][
                    "targets"
                ][0]
                self.assertEqual(recovery["previousSha"], OLD_SHA)
                self.assertEqual(
                    recovery["repositoryBaseline"],
                    runtime.repository_baseline_result,
                )
                self.assertEqual(recovery["recovery"], "pre-mutation-live-verified")

    def test_pre_mutation_recovery_removes_notice_on_either_side_of_notice_put(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        for boundary, notice_state in (
            ("before-put-notice", "requested"),
            ("after-put-notice", "acknowledged"),
        ):
            with self.subTest(boundary=boundary):
                interrupted = host_record("kiosk", OLD_SHA)
                interrupted.update(
                    {
                        "desiredSha": NEW_SHA,
                        "currentSha": None,
                        "previousSha": OLD_SHA,
                        "evidence": "unknown",
                        "verifiedAt": None,
                        "lastRunId": "crashed-run",
                    }
                )
                runtime = FakeRuntime(
                    fleet={
                        "pi5": host_record("server", NEW_SHA),
                        "kiosk-a": interrupted,
                    },
                    hosts=[{"host": "pi5", "role": "server"}, terminal],
                    plan={
                        "pi5Required": False,
                        "hosts": [
                            decision(
                                "pi5", "server", current=NEW_SHA, targeted=False
                            ),
                            decision(
                                "kiosk-a", "kiosk", current=OLD_SHA, targeted=False
                            ),
                        ],
                    },
                    targets=[],
                )
                runtime.abandoned_run_id = "crashed-run"
                runtime.deployed_sha["kiosk-a"] = OLD_SHA
                runtime.prior_runs["crashed-run"] = {
                    "version": 1,
                    "runId": "crashed-run",
                    "state": "running",
                    "targets": [
                        {
                            **terminal,
                            "desiredSha": NEW_SHA,
                            "previousSha": OLD_SHA,
                            "currentSha": None,
                            "evidence": "unknown",
                            "state": "pending",
                            "rollbackManifest": rollback_manifest(
                                "crashed-run", "kiosk-a"
                            ),
                            "notice": {
                                "state": notice_state,
                                "requestedAt": "2026-07-15T00:00:00Z",
                            },
                        }
                    ],
                }

                self.assertEqual(
                    coordinator.execute(
                        args(), runtime=runtime, token=FakeToken(runtime.events)
                    ),
                    0,
                )

                remove = runtime.events.index(
                    "status:remove-client:--run-id:crashed-run:--client:a"
                )
                observe = runtime.events.index("observe:terminal:kiosk-a")
                cleanup = runtime.events.index(
                    "manifest:cleanup:kiosk-a:crashed-run:committed"
                )
                self.assertLess(remove, observe)
                self.assertLess(observe, cleanup)
                recovery = runtime.states[-1].payload["interruptedRecovery"][
                    "targets"
                ][0]
                self.assertIn("noticeClearedAt", recovery)

    def test_interrupted_cleanup_failure_retries_original_manifest_authority(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "desiredSha": NEW_SHA,
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": interrupted,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision("kiosk-a", "kiosk", current=OLD_SHA, targeted=False),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.runtime_cleanup_error = RuntimeError("cleanup transport lost")
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "running",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "currentSha": None,
                    "evidence": "unknown",
                    "state": "deploying",
                    "maintenanceStartedAt": "2026-07-14T23:59:00Z",
                    "rollbackManifest": rollback_manifest(
                        "crashed-run", "kiosk-a"
                    ),
                }
            ],
        }

        with self.assertRaisesRegex(RuntimeError, "cleanup transport lost"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )
        failed_recovery = copy.deepcopy(runtime.states[-1].payload)
        self.assertEqual(runtime.fleet["activeRun"]["runId"], "run-1")
        self.assertEqual(
            runtime.fleet["fleet"]["kiosk-a"]["lastRunId"], "run-1"
        )

        runtime.prior_runs["run-1"] = failed_recovery
        runtime.abandoned_run_id = "run-1"
        runtime.runtime_cleanup_error = None
        self.assertEqual(
            coordinator.execute(
                args(run_id="run-2"),
                runtime=runtime,
                token=FakeToken(runtime.events),
            ),
            0,
        )

        cleanup_event = "manifest:cleanup:kiosk-a:crashed-run:restored"
        self.assertEqual(runtime.events.count(cleanup_event), 2)
        self.assertNotIn("manifest:cleanup:kiosk-a:run-1:restored", runtime.events)
        self.assertEqual(runtime.events.count("rollback:kiosk-a"), 1)
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "verified")
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["lastRunId"], "run-2")

    def test_interrupted_manifest_restore_failure_keeps_unknown_and_stops(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": interrupted,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={},
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.rollback_ok = False
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "interrupted",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "state": "deploying",
                    "maintenanceStartedAt": "2026-07-14T23:59:00Z",
                    "rollbackManifest": rollback_manifest(
                        "crashed-run", "kiosk-a"
                    ),
                }
            ],
        }

        with self.assertRaisesRegex(RuntimeError, "manifest restore failed"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("rollback:kiosk-a", runtime.events)
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertNotIn(
            "status:remove-client:--run-id:crashed-run:--client:a",
            runtime.events,
        )
        self.assertEqual(runtime.fleet["activeRun"]["runId"], "run-1")

    def test_interrupted_preflight_reports_all_hosts_before_any_host_mutation(self):
        kiosk = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        signage = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s",
        }
        fleet = {}
        prior_targets = []
        for target in (kiosk, signage):
            record = host_record(target["role"], OLD_SHA)
            record.update(
                {
                    "currentSha": None,
                    "previousSha": OLD_SHA,
                    "evidence": "unknown",
                    "lastRunId": "crashed-run",
                }
            )
            fleet[target["host"]] = record
            prior_targets.append(
                {
                    **target,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "state": "deploying",
                    "maintenanceStartedAt": "2026-07-14T23:59:00Z",
                    "rollbackManifest": rollback_manifest(
                        "crashed-run",
                        target["host"],
                        target["terminalType"],
                    ),
                }
            )
        runtime = FakeRuntime(
            fleet=fleet,
            hosts=[{"host": "pi5", "role": "server"}, kiosk, signage],
            plan={},
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "interrupted",
            "targets": prior_targets,
        }
        runtime.rollback_preflight_by_host = {
            "kiosk-a": {
                "ready": False,
                "issues": ["systemd unit requires reconciliation"],
                "fileManifestReady": True,
                "runtimeManifestReady": False,
                "runtimeHealth": rollback_runtime_health("kiosk"),
                "restoredReceipt": True,
                "requiresRuntimeReconciliation": True,
            },
            "signage-a": RuntimeError("sealed image is unavailable"),
        }

        with self.assertRaisesRegex(
            RuntimeError,
            "kiosk-a: rollback ready identity: Kiosk rollback has no unique Pi5 "
            "release authority.*kiosk-a: systemd unit requires reconciliation.*"
            "signage-a: rollback manifests: sealed image is unavailable",
        ):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("rollback:preflight:kiosk-a", runtime.events)
        self.assertIn("rollback:preflight:signage-a", runtime.events)
        self.assertFalse(
            any(event.startswith("fleet:unknown:") for event in runtime.events)
        )
        self.assertFalse(
            any(event.startswith("status:put:") for event in runtime.events)
        )
        self.assertFalse(
            any(
                event.startswith("rollback:kiosk-a")
                and event != "rollback:preflight:kiosk-a"
                for event in runtime.events
            )
        )
        self.assertNotIn("stage3:rollback:signage-a:run-1", runtime.events)
        audit = runtime.states[-1].payload["interruptedRecoveryPreflight"]
        self.assertEqual(audit["state"], "failed")
        self.assertEqual(len(audit["issues"]), 3)

    def test_unknown_pi5_success_preserves_last_confirmed_sha(self):
        unknown = host_record("server", OLD_SHA)
        unknown.update({
            "desiredSha": NEW_SHA,
            "currentSha": None,
            "previousSha": OLD_SHA,
            "evidence": "unknown",
            "verifiedAt": None,
        })
        server = decision("pi5", "server")
        server.update({"currentSha": None, "evidence": "unknown"})
        runtime = FakeRuntime(
            fleet={"pi5": unknown},
            hosts=[{"host": "pi5", "role": "server"}],
            plan={"pi5Required": True, "hosts": [server]},
            targets=[],
        )

        self.assertEqual(
            coordinator.execute(args(), runtime=runtime, token=FakeToken(runtime.events)),
            0,
        )
        self.assertEqual(runtime.fleet["fleet"]["pi5"]["previousSha"], OLD_SHA)

    def test_full_fleet_same_sha_preserves_real_previous_sha(self):
        current = host_record("server", NEW_SHA)
        current["previousSha"] = OLD_SHA
        server = decision("pi5", "server", current=NEW_SHA)
        runtime = FakeRuntime(
            fleet={"pi5": current},
            hosts=[{"host": "pi5", "role": "server"}],
            plan={"pi5Required": True, "hosts": [server]},
            targets=[],
        )

        self.assertEqual(
            coordinator.execute(
                args(full_fleet=True), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )
        self.assertEqual(runtime.fleet["fleet"]["pi5"]["previousSha"], OLD_SHA)
        self.assertIn(f"pi5:host-config:pi5:{NEW_SHA}", runtime.events)


if __name__ == "__main__":
    unittest.main()
