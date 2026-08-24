from __future__ import annotations

import argparse
import fcntl
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import yaml

ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / "scripts/deploy"
SCRIPT = DEPLOY / "standard-ansible-release.py"
sys.path.insert(0, str(DEPLOY))
SPEC = importlib.util.spec_from_file_location("standard_ansible_release", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

SHA = "a" * 40
RUN_ID = "20260808-010203-abcdef"


def completed(command: list[str], stdout: str = "", returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr="")


def torque_capable_host(serial: str = "702902S") -> dict[str, object]:
    link_name = f"bluetooth-TOHNICHI_{serial}-event-kbd"
    return {
        "torque_agent_enabled": True,
        "torque_connection_lease_enabled": True,
        "torque_agent_api_base_url": "https://pi5.example.test",
        "torque_agent_client_key": f"client-key-{serial}",
        "torque_agent_tls_verify_mode": "system",
        "torque_agent_bluetooth_adapter": {
            "usb_vendor_id": "2357",
            "usb_product_id": "0604",
        },
        "torque_agent_hid_devices": [
            {
                "path": f"/dev/input/by-id/{link_name}",
                "parserProfile": "cem3-btla-hogp-v1",
                "serialNumber": serial,
            }
        ],
        "torque_agent_hid_links": [
            {
                "link_name": link_name,
                "name": f"TOHNICHI_{serial}",
                "uniq": "c4:90:43:98:7e:c3",
                "vendor_id": "2f84",
                "product_id": "0001",
            }
        ],
    }


class StandardAnsibleReleaseTests(unittest.TestCase):
    def test_server_connection_uses_concrete_deploy_executor_host(self) -> None:
        inventory = {
            "server": {"hosts": ["raspberrypi5"]},
            "_meta": {
                "hostvars": {
                    "raspberrypi5": {
                        "ansible_host": "{{ server_ip }}",
                        "deploy_executor_host": "100.106.158.2",
                        "ansible_user": "denkon5sd02",
                    }
                }
            },
        }

        host, user, port = MODULE.server_connection(inventory)

        self.assertEqual((host, user, port), ("100.106.158.2", "denkon5sd02", 22))
        self.assertEqual(
            MODULE.ssh_argv(host, user, port, ["true"])[-2],
            "denkon5sd02@100.106.158.2",
        )

    def test_server_connection_rejects_missing_or_unresolved_executor_host(self) -> None:
        for host in (
            None,
            "",
            " 100.106.158.2",
            "100.106.158.2 ",
            "100.106. 158.2",
            "{{ server_ip }}",
        ):
            with self.subTest(host=host), self.assertRaisesRegex(
                MODULE.UsageError, "unresolved or malformed"
            ):
                MODULE.server_connection(
                    {
                        "server": {"hosts": ["raspberrypi5"]},
                        "_meta": {
                            "hostvars": {
                                "raspberrypi5": {
                                    "deploy_executor_host": host,
                                    "ansible_user": "denkon5sd02",
                                }
                            }
                        },
                    }
                )

    def test_release_remote_root_defaults_to_production_and_accepts_staging(self) -> None:
        production = {
            "server": {"hosts": ["pi5"]},
            "_meta": {"hostvars": {"pi5": {}}},
        }
        staging = {
            "server": {"hosts": ["staging-pi5"]},
            "_meta": {
                "hostvars": {
                    "staging-pi5": {
                        "release_remote_root": "/opt/RaspberryPiSystem_002-staging"
                    }
                }
            },
        }

        self.assertEqual(MODULE.server_release_root(production), MODULE.REMOTE_ROOT)
        self.assertEqual(
            MODULE.server_release_root(staging),
            Path("/opt/RaspberryPiSystem_002-staging"),
        )

        staging["_meta"]["hostvars"]["staging-pi5"]["release_remote_root"] = (
            "{{ repo_path }}"
        )
        with self.assertRaisesRegex(MODULE.UsageError, "unresolved or malformed"):
            MODULE.server_release_root(staging)

    def test_production_inventory_has_concrete_deploy_executor_host(self) -> None:
        inventory = yaml.safe_load(
            (ROOT / MODULE.DEFAULT_INVENTORY).read_text(encoding="utf-8")
        )
        pi5 = inventory["all"]["children"]["server"]["hosts"]["raspberrypi5"]

        self.assertEqual(pi5["ansible_host"], "{{ server_ip }}")
        self.assertEqual(pi5["deploy_executor_host"], "100.106.158.2")

    def test_parser_rejects_legacy_admission_and_implicit_mutation(self) -> None:
        with self.assertRaisesRegex(MODULE.UsageError, "unsupported"):
            MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--approve", RUN_ID])
        with self.assertRaisesRegex(MODULE.UsageError, "explicit --limit"):
            MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY])

        args = MODULE.parse_arguments(
            ["--branch", "main", "--inventory", MODULE.DEFAULT_INVENTORY, "--full-fleet"]
        )
        self.assertTrue(args.full_fleet)

        with self.assertRaisesRegex(MODULE.UsageError, "internal mutation"):
            MODULE.parse_arguments(
                [
                    "--execute-standard-route", "--branch", "main",
                    "--inventory", MODULE.DEFAULT_INVENTORY, "--sha", SHA,
                    "--run-id", RUN_ID, "--profiles", "pi4",
                ]
            )

    def test_torque_cutover_requires_exact_limit_and_capable_kiosks(self) -> None:
        for scope in ([], ["--full-fleet"]):
            with self.subTest(scope=scope), self.assertRaisesRegex(
                MODULE.UsageError, "exact --limit"
            ):
                MODULE.parse_arguments(
                    ["main", MODULE.DEFAULT_INVENTORY, "--torque-cutover", *scope]
                )

        args = MODULE.parse_arguments(
            [
                "main",
                MODULE.DEFAULT_INVENTORY,
                "--torque-cutover",
                "--limit",
                "raspberrypi5:raspi4-kensaku-stonebase01:raspi4-assembly-01",
            ]
        )
        self.assertTrue(args.torque_cutover)

        document = {
            "server": {"hosts": ["raspberrypi5"]},
            "kiosk": {
                "hosts": [
                    "raspi4-kensaku-stonebase01",
                    "raspi4-assembly-01",
                ]
            },
            "_meta": {
                "hostvars": {
                    "raspberrypi5": {},
                    "raspi4-kensaku-stonebase01": torque_capable_host(),
                    "raspi4-assembly-01": torque_capable_host("702903S"),
                }
            },
        }
        selection = MODULE.selected_profiles(document)
        MODULE.validate_torque_cutover_selection(document, selection)

        document["_meta"]["hostvars"]["raspi4-assembly-01"]["torque_agent_enabled"] = False
        with self.assertRaisesRegex(MODULE.UsageError, "every explicitly selected Pi4"):
            MODULE.validate_torque_cutover_selection(document, selection)

    def test_torque_cutover_accepts_a_future_explicitly_configured_kiosk(self) -> None:
        hosts = ["raspi4-kensaku-stonebase01", "raspi4-assembly-01", "future-kiosk"]
        document = {
            "server": {"hosts": ["raspberrypi5"]},
            "kiosk": {"hosts": hosts},
            "_meta": {
                "hostvars": {
                    "raspberrypi5": {},
                    **{
                        host: torque_capable_host(str(702902 + index) + "S")
                        for index, host in enumerate(hosts)
                    },
                }
            },
        }

        MODULE.validate_torque_cutover_selection(
            document,
            MODULE.selected_profiles(document),
        )

    def test_torque_cutover_rejects_incomplete_hid_identity(self) -> None:
        incomplete = torque_capable_host()
        incomplete["torque_agent_hid_links"] = []
        document = {
            "server": {"hosts": ["raspberrypi5"]},
            "kiosk": {"hosts": ["future-kiosk"]},
            "_meta": {
                "hostvars": {
                    "raspberrypi5": {},
                    "future-kiosk": incomplete,
                }
            },
        }

        with self.assertRaisesRegex(MODULE.UsageError, "complete torque-agent"):
            MODULE.validate_torque_cutover_selection(
                document,
                MODULE.selected_profiles(document),
            )

    def test_torque_cutover_capability_rejects_each_incomplete_setting(self) -> None:
        cases: dict[str, dict[str, object]] = {}
        for name in (
            "lease",
            "api",
            "client-key",
            "adapter",
            "parser",
            "link-match",
            "local-port",
            "browser-origin",
        ):
            cases[name] = torque_capable_host()
        cases["lease"]["torque_connection_lease_enabled"] = False
        cases["api"]["torque_agent_api_base_url"] = ""
        cases["client-key"]["torque_agent_client_key"] = ""
        cases["adapter"]["torque_agent_bluetooth_adapter"] = {
            "usb_vendor_id": "guess",
            "usb_product_id": "0604",
        }
        cases["parser"]["torque_agent_hid_devices"][0]["parserProfile"] = "unknown"
        cases["link-match"]["torque_agent_hid_links"][0]["link_name"] = (
            "bluetooth-TOHNICHI_OTHER-event-kbd"
        )
        cases["local-port"]["torque_agent_local_port"] = 70000
        cases["browser-origin"]["torque_agent_browser_origins"] = ["*"]

        for name, values in cases.items():
            with self.subTest(name=name):
                self.assertFalse(MODULE.torque_cutover_capable(values))

    def test_torque_cutover_capability_allows_only_safe_nested_url_variables(self) -> None:
        templated = torque_capable_host()
        templated["torque_agent_api_base_url"] = "{{ server_base_url }}"
        templated["torque_agent_browser_origins"] = ["{{ server_base_url }}"]
        self.assertTrue(MODULE.torque_cutover_capable(templated))

        templated["torque_agent_api_base_url"] = "{{ lookup('env', 'URL') }}"
        self.assertFalse(MODULE.torque_cutover_capable(templated))

    def test_torque_cutover_image_plan_excludes_unverified_agents(self) -> None:
        images = MODULE.image_plan(
            SHA,
            ("pi5", "pi4"),
            "b" * 64,
            torque_cutover=True,
        )
        self.assertEqual(images["pi4"], [f"release-set-v2:{SHA}:torque-agent"])
        self.assertNotIn("nfc-agent", " ".join(images["pi4"]))
        self.assertNotIn("barcode-agent", " ".join(images["pi4"]))

    def test_torque_image_plan_rejects_an_empty_or_non_torque_agent_set(self) -> None:
        for services in ((), ("nfc-agent",), ("torque-agent", "nfc-agent")):
            with self.subTest(services=services), self.assertRaisesRegex(
                MODULE.UsageError, "exactly .*torque-agent"
            ):
                MODULE.image_plan(
                    SHA,
                    ("pi5", "pi4"),
                    "b" * 64,
                    torque_cutover=True,
                    agent_services=services,
                )

    def test_web_only_image_plan_and_exact_targets_preserve_pi4_agents(self) -> None:
        images = MODULE.image_plan(
            SHA,
            ("pi5", "pi4"),
            "b" * 64,
            agent_services=(),
        )
        self.assertEqual(
            images,
            {
                "pi5": [
                    f"ghcr.io/denkoushi/raspisys-api:{SHA}-{'b' * 16}",
                    f"ghcr.io/denkoushi/raspisys-web:{SHA}-{'b' * 16}",
                ],
                "pi4": [],
            },
        )
        args = argparse.Namespace(branch="main", limit="pi4-a", full_fleet=False)
        with mock.patch.object(MODULE, "run", return_value=completed(["ansible-playbook"])):
            document = MODULE.plan(
                args,
                SHA,
                ROOT / MODULE.DEFAULT_INVENTORY,
                MODULE.DEFAULT_INVENTORY,
                (("pi4", ("pi4-a",)),),
                agent_services=(),
            )
        self.assertEqual(document["mode"], "web-only")
        self.assertEqual(document["agentServices"], [])
        self.assertEqual(document["executionOrder"][0]["images"], [])
        self.assertEqual(document["activationTargets"][0]["strategy"], "kiosk-web-activation-v1")

    def test_pi4_only_print_plan_uses_signed_agent_services_authority(self) -> None:
        args = [
            "--branch", "main",
            "--inventory", MODULE.DEFAULT_INVENTORY,
            "--limit", "pi4-a",
            "--print-plan",
        ]
        document = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-a"]},
            "_meta": {"hostvars": {"pi5": {}, "pi4-a": {}}},
        }
        signed = MODULE.ReleaseArtifacts(
            f"api:{SHA}", f"web:{SHA}", None, None, ()
        )
        captured: dict[str, object] = {}

        def fake_plan(plan_args: argparse.Namespace, *plan_args_: object) -> dict[str, object]:
            captured["agent_services"] = plan_args.agent_services
            return {"mode": "web-only", "agentServices": list(plan_args.agent_services)}

        with mock.patch.object(
            MODULE, "resolve_sha", return_value=SHA
        ), mock.patch.object(
            MODULE,
            "inventory_path",
            return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY),
        ), mock.patch.object(
            MODULE, "inventory_document", side_effect=[document, document]
        ), mock.patch.object(
            MODULE, "server_release_root", return_value=MODULE.REMOTE_ROOT
        ), mock.patch.object(
            MODULE, "release_set_artifacts", return_value=signed
        ) as resolve_release_set, mock.patch.object(
            MODULE, "plan", side_effect=fake_plan
        ), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(MODULE.main(args), 0)

        resolve_release_set.assert_called_once_with(
            SHA, Path("inventory.yml"), require_torque=False
        )
        self.assertEqual(captured["agent_services"], ())
        self.assertEqual(json.loads(output.getvalue())["agentServices"], [])

    def test_pi4_only_execute_resolves_signed_authority_without_default_agents(self) -> None:
        args = argparse.Namespace(
            inventory=MODULE.DEFAULT_INVENTORY,
            sha=SHA,
            run_id=RUN_ID,
            profiles="pi4",
            limit="pi4-a",
            full_fleet=False,
        )
        inventory = {
            "kiosk": {"hosts": ["pi4-a"]},
            "_meta": {"hostvars": {"pi4-a": {}}},
        }
        signed = MODULE.ReleaseArtifacts(
            f"api:{SHA}", f"web:{SHA}", None, None, ()
        )
        with mock.patch.object(
            MODULE,
            "inventory_path",
            return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY),
        ), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(
            MODULE, "run", return_value=completed(["git"], f"{SHA}\n")
        ), mock.patch.object(
            MODULE, "preflight_optional_hosts",
            return_value=((("pi4", ("pi4-a",)),), ()),
        ), mock.patch.object(
            MODULE, "release_set_artifacts", return_value=signed
        ) as resolve_release_set, mock.patch.object(
            MODULE.os, "execvpe"
        ) as execvpe, redirect_stdout(io.StringIO()):
            self.assertEqual(MODULE.execute_standard_route(args), 1)

        resolve_release_set.assert_called_once_with(
            SHA, Path("inventory.yml"), require_torque=False
        )
        command = execvpe.call_args.args[1]
        variables = json.loads(command[command.index("--extra-vars") + 1])
        self.assertEqual(variables["release_kiosk_agent_services"], [])

    def test_web_only_role_uses_activation_helper_without_agent_lifecycle(self) -> None:
        role_root = ROOT / "infrastructure/ansible/roles/release_kiosk"
        role = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted(role_root.rglob("*.yml"))
        )
        self.assertIn("release_kiosk_agent_services", role)
        self.assertIn("activate-kiosk-web", role)
        self.assertIn("reconcile-kiosk-web-activation", role)
        self.assertIn("cleanup-kiosk-web-activation", role)
        self.assertIn("release_kiosk_services | length > 0", role)

    def test_web_only_route_binds_pi5_authority_and_secret_safe_runtime_fingerprint(self) -> None:
        role_root = ROOT / "infrastructure/ansible/roles/release_kiosk"
        prepare = (role_root / "tasks/prepare.yml").read_text(encoding="utf-8")
        switch = (role_root / "tasks/switch.yml").read_text(encoding="utf-8")
        health = (role_root / "tasks/health_checks.yml").read_text(encoding="utf-8")
        rollback = (role_root / "tasks/rollback.yml").read_text(encoding="utf-8")
        cleanup = (role_root / "tasks/cleanup.yml").read_text(encoding="utf-8")

        self.assertIn("release_kiosk_pi5_status_state_helper", prepare)
        self.assertIn("- put", prepare)
        self.assertIn("- set-phase", switch)
        self.assertIn("- verifying", switch)
        self.assertIn("--desired-release-sha", switch)
        self.assertIn("preflight-restore", rollback)
        self.assertIn("- restore", rollback)
        self.assertIn("--rollback", rollback)
        self.assertIn("remove-client", cleanup)
        self.assertIn("sha256sum", prepare)
        self.assertIn("sha256sum", health)
        self.assertIn("pi4-agent-runtime|", prepare)
        self.assertIn("pi4-agent-runtime|", health)
        self.assertNotIn("json .Config.Env", prepare)
        self.assertNotIn("json .Config.Env", health)
        self.assertNotIn("printf '%s|%s|%s", prepare)
        self.assertNotIn("printf '%s|%s|%s", health)

        prepare_tasks = yaml.safe_load(prepare)
        snapshot = next(
            task for task in prepare_tasks
            if task["name"] == "Snapshot existing Pi4 agent identities before Web-only activation"
        )
        self.assertTrue(snapshot["no_log"])
        self.assertTrue(
            next(
                task for task in prepare_tasks
                if task["name"] == "Register the Web-only terminal with the Pi5 deploy-status authority"
            )["no_log"]
        )

    def test_target_selection_rejects_empty_and_unsupported_hosts(self) -> None:
        with self.assertRaisesRegex(MODULE.UsageError, "matched no hosts"):
            MODULE.selected_profiles({"_meta": {"hostvars": {}}})
        with self.assertRaisesRegex(MODULE.UsageError, "outside server/kiosk/signage"):
            MODULE.selected_profiles(
                {"_meta": {"hostvars": {"other": {}}}, "other_group": {"hosts": ["other"]}}
            )

        self.assertEqual(
            MODULE.selected_profiles(
                {
                    "_meta": {"hostvars": {"pi4-b": {}, "pi4-a": {}}},
                    "kiosk": {"hosts": ["pi4-b", "pi4-a", "not-selected"]},
                }
            ),
            (("pi4", ("pi4-b", "pi4-a")),),
        )

    def test_optional_preflight_probes_each_terminal_once_and_keeps_pi5_required(self) -> None:
        inventory = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-online", "pi4-offline"]},
            "signage": {"hosts": ["pi3-offline"]},
            "_meta": {
                "hostvars": {
                    "pi5": {},
                    "pi4-online": {"ansible_host": "100.64.0.4", "ansible_port": "22"},
                    "pi4-offline": {"ansible_host": "100.64.0.5"},
                    "pi3-offline": {"ansible_host": "100.64.0.3"},
                }
            },
        }
        calls: list[tuple[tuple[str, int], float]] = []

        class Connection:
            def close(self) -> None:
                pass

        def connect(endpoint: tuple[str, int], *, timeout: float) -> Connection:
            calls.append((endpoint, timeout))
            if endpoint[0] != "100.64.0.4":
                raise TimeoutError
            return Connection()

        reachable, excluded = MODULE.preflight_optional_hosts(
            inventory,
            (
                ("pi5", ("pi5",)),
                ("pi4", ("pi4-online", "pi4-offline")),
                ("pi3", ("pi3-offline",)),
            ),
            connector=connect,
        )

        self.assertEqual(
            reachable,
            (("pi5", ("pi5",)), ("pi4", ("pi4-online",))),
        )
        self.assertEqual(
            excluded,
            (
                {"host": "pi4-offline", "profile": "pi4", "reason": "tcp-unreachable"},
                {"host": "pi3-offline", "profile": "pi3", "reason": "tcp-unreachable"},
            ),
        )
        self.assertEqual(
            [endpoint[0] for endpoint, _timeout in calls],
            ["100.64.0.4", "100.64.0.5", "100.64.0.3"],
        )
        self.assertTrue(
            all(
                timeout == MODULE.OPTIONAL_HOST_CONNECT_TIMEOUT_SECONDS
                for _endpoint, timeout in calls
            )
        )
        self.assertEqual(MODULE.exact_host_limit(reachable), "pi5:pi4-online")

    def test_optional_preflight_rejects_unresolved_addresses(self) -> None:
        with self.assertRaisesRegex(MODULE.UsageError, "unresolved SSH address"):
            MODULE.preflight_optional_hosts(
                {"_meta": {"hostvars": {"pi4": {"ansible_host": "{{ missing }}"}}}},
                (("pi4", ("pi4",)),),
            )

    def test_production_optional_host_expressions_are_supported(self) -> None:
        inventory = yaml.safe_load(
            (ROOT / MODULE.DEFAULT_INVENTORY).read_text(encoding="utf-8")
        )
        all_vars = yaml.safe_load(
            (ROOT / "infrastructure/ansible/group_vars/all.yml").read_text(encoding="utf-8")
        )
        optional_groups = inventory["all"]["children"]["clients"]["children"]

        for group in ("kiosk", "signage"):
            for host, host_values in optional_groups[group]["hosts"].items():
                with self.subTest(host=host):
                    document = {
                        "_meta": {
                            "hostvars": {
                                host: {**all_vars, **(host_values or {})},
                            }
                        }
                    }
                    address, port = MODULE.optional_host_endpoint(document, host)
                    self.assertNotIn("{{", address)
                    self.assertIn(address, all_vars["tailscale_network"].values())
                    self.assertEqual(port, 22)

    def test_standard_route_excludes_offline_optional_profiles_before_artifact_pull(self) -> None:
        args = argparse.Namespace(
            inventory=MODULE.DEFAULT_INVENTORY,
            sha=SHA,
            run_id=RUN_ID,
            profiles="pi5,pi4,pi3",
            limit="",
            full_fleet=True,
        )
        inventory = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-online"]},
            "signage": {"hosts": ["pi3-offline"]},
            "_meta": {
                "hostvars": {
                    "pi5": {},
                    "pi4-online": {},
                    "pi3-offline": {},
                }
            },
        }
        reachable = (("pi5", ("pi5",)), ("pi4", ("pi4-online",)))
        excluded = (
            {
                "host": "pi3-offline",
                "profile": "pi3",
                "reason": "tcp-unreachable",
            },
        )

        with mock.patch.object(
            MODULE,
            "inventory_path",
            return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY),
        ), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(
            MODULE, "run", return_value=completed(["git"], f"{SHA}\n")
        ), mock.patch.object(
            MODULE, "preflight_optional_hosts", return_value=(reachable, excluded)
        ), mock.patch.object(
            MODULE,
            "release_set_artifacts",
            return_value=MODULE.ReleaseArtifacts(
                f"api:{SHA}", f"web:{SHA}", None, None
            ),
        ), mock.patch.object(
            MODULE, "signage_identity"
        ) as signage_identity, mock.patch.object(
            MODULE.os, "execvpe"
        ) as execvpe, redirect_stdout(io.StringIO()) as output:
            self.assertEqual(MODULE.execute_standard_route(args), 1)

        signage_identity.assert_not_called()
        command = execvpe.call_args.args[1]
        self.assertEqual(command[command.index("--tags") + 1], "pi5,pi4")
        self.assertEqual(command[-2:], ["--limit", "pi5:pi4-online"])
        event = json.loads(output.getvalue())
        self.assertEqual(event["excluded"], list(excluded))

    def test_ansible_argv_is_exact_and_contains_no_legacy_inputs(self) -> None:
        variables = {
            "release_sha": SHA,
            "release_run_id": RUN_ID,
            "release_signage_artifact_sha256": "b" * 64,
        }
        command = MODULE.ansible_argv(
            MODULE.DEFAULT_INVENTORY, "pi4-a", ("pi4",), variables
        )

        self.assertEqual(command[0], "ansible-playbook")
        self.assertEqual(command[1:3], ["-i", MODULE.DEFAULT_INVENTORY])
        self.assertIn("deploy-release-standard.yml", command[3])
        self.assertEqual(command[command.index("--tags") + 1], "pi4")
        self.assertEqual(command[-2:], ["--limit", "pi4-a"])
        payload = json.loads(command[command.index("--extra-vars") + 1])
        self.assertEqual(payload, variables)
        self.assertFalse(
            {"approve", "claims", "readiness", "fleet_state"} & set(payload)
        )

    def test_release_set_scratch_image_uses_explicit_harmless_command(self) -> None:
        commands: list[list[str]] = []
        release = types.SimpleNamespace(
            api=types.SimpleNamespace(
                repository="ghcr.io/denkoushi/raspisys-api",
                digest="sha256:" + "1" * 64,
            ),
            web=types.SimpleNamespace(
                repository="ghcr.io/denkoushi/raspisys-web",
                digest="sha256:" + "2" * 64,
            ),
            torque_agent=None,
            torque_compatibility=None,
        )

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            if command[1] == "create":
                return completed(command, "release-set-container\n")
            if command[1] == "cp":
                Path(command[-1]).write_text("{}", encoding="utf-8")
            return completed(command)

        with mock.patch.object(MODULE, "config_hash", return_value="b" * 64), mock.patch.object(
            MODULE, "parse_release_set", return_value=release
        ), mock.patch.object(MODULE, "validate_release_set"), mock.patch.object(
            MODULE, "_exact_repo_digest", return_value="ghcr.io/denkoushi/raspisys-release-set@sha256:" + "9" * 64
        ), mock.patch.object(
            MODULE, "verify_component_attestation"
        ), mock.patch.object(
            MODULE, "run", side_effect=fake_run
        ):
            MODULE.release_set_images(SHA, ROOT / MODULE.DEFAULT_INVENTORY)

        create = next(command for command in commands if command[1] == "create")
        self.assertEqual(create[-1], "/release-set.json")
        pull = next(command for command in commands if command[1:3] == ["image", "pull"])
        self.assertNotIn("-torque-v2", pull[-1])

    def test_torque_plan_normalizes_one_verified_tuple_for_all_selected_hosts(self) -> None:
        artifacts = MODULE.ReleaseArtifacts(
            "api@sha256:" + "1" * 64,
            "web@sha256:" + "2" * 64,
            "torque@sha256:" + "3" * 64,
            MODULE.TORQUE_PROTOCOL_VERSION,
        )

        plan = MODULE.normalize_torque_cutover_plan(
            SHA, RUN_ID, ("stonebase", "assembly-01"), artifacts
        )

        self.assertEqual(plan.hosts, ("stonebase", "assembly-01"))
        self.assertEqual(
            plan.ansible_variables()["release_kiosk_service_allowlist"],
            ["torque-agent"],
        )
        self.assertEqual(
            plan.journal_event()["targets"],
            [
                {"host": "stonebase", "component": "torque-agent"},
                {"host": "assembly-01", "component": "torque-agent"},
            ],
        )

    def test_torque_plan_rejects_duplicate_hosts_before_ansible(self) -> None:
        artifacts = MODULE.ReleaseArtifacts("api", "web", "torque", 1)
        with self.assertRaisesRegex(RuntimeError, "plan is incomplete"):
            MODULE.normalize_torque_cutover_plan(
                SHA, RUN_ID, ("stonebase", "stonebase"), artifacts
            )

    def test_v2_release_set_returns_exact_torque_digest_and_verifies_adoption(self) -> None:
        commands: list[list[str]] = []
        torque = types.SimpleNamespace(
            repository="ghcr.io/denkoushi/raspisys-torque-agent",
            index_digest="sha256:" + "3" * 64,
        )
        compatibility = types.SimpleNamespace(protocol_version=1)
        release = types.SimpleNamespace(
            schema_version=2,
            source_repository="denkoushi/RaspberryPiSystem_002",
            source_sha=SHA,
            source_ref="refs/heads/main",
            config_hash="b" * 64,
            api=types.SimpleNamespace(
                repository="ghcr.io/denkoushi/raspisys-api",
                digest="sha256:" + "1" * 64,
            ),
            web=types.SimpleNamespace(
                repository="ghcr.io/denkoushi/raspisys-web",
                digest="sha256:" + "2" * 64,
            ),
            torque_agent=torque,
            torque_compatibility=compatibility,
            workflow=types.SimpleNamespace(
                path=".github/workflows/ci.yml",
                run_id=123,
                run_attempt=1,
            ),
            composition_workflow=types.SimpleNamespace(
                path=".github/workflows/torque-release.yml",
                run_id=456,
                run_attempt=2,
            ),
            base_release_set=types.SimpleNamespace(
                digest="ghcr.io/denkoushi/raspisys-release-set@sha256:" + "8" * 64,
            ),
        )
        base_release = types.SimpleNamespace(
            schema_version=1,
            source_repository="denkoushi/RaspberryPiSystem_002",
            source_sha=SHA,
            source_ref="refs/heads/main",
            config_hash="b" * 64,
            api=release.api,
            web=release.web,
            workflow=release.workflow,
        )

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            if command[1] == "create":
                return completed(command, "release-set-container\n")
            if command[1] == "cp":
                Path(command[-1]).write_text("{}", encoding="utf-8")
            return completed(command)

        with mock.patch.object(MODULE, "config_hash", return_value="b" * 64), mock.patch.object(
            MODULE, "parse_release_set", side_effect=[release, base_release]
        ), mock.patch.object(MODULE, "validate_release_set"), mock.patch.object(
            MODULE, "_exact_repo_digest", return_value="ghcr.io/denkoushi/raspisys-release-set@sha256:" + "9" * 64
        ), mock.patch.object(
            MODULE, "verify_component_attestation"
        ) as verify, mock.patch.object(MODULE, "run", side_effect=fake_run):
            artifacts = MODULE.release_set_artifacts(
                SHA, ROOT / MODULE.DEFAULT_INVENTORY, require_torque=True
            )

        self.assertEqual(
            artifacts.torque_agent,
            "ghcr.io/denkoushi/raspisys-torque-agent@sha256:" + "3" * 64,
        )
        self.assertEqual(artifacts.torque_protocol_version, 1)
        self.assertEqual(verify.call_count, 3)
        self.assertIn("-torque-v2", commands[0][-1])
        self.assertEqual(
            verify.call_args_list[2].kwargs["adoption_workflow"],
            (".github/workflows/torque-release.yml", 456, 2),
        )
        created_references = [
            command[2] for command in commands if command[1] == "create"
        ]
        self.assertEqual(
            created_references,
            [
                "ghcr.io/denkoushi/raspisys-release-set@sha256:" + "9" * 64,
                "ghcr.io/denkoushi/raspisys-release-set@sha256:" + "8" * 64,
            ],
        )

        mismatches = {
            "source": ("source_sha", "c" * 40),
            "config": ("config_hash", "d" * 64),
            "image": (
                "api",
                types.SimpleNamespace(
                    repository="ghcr.io/denkoushi/raspisys-api",
                    digest="sha256:" + "7" * 64,
                ),
            ),
        }
        for label, (field, value) in mismatches.items():
            mismatched_base = types.SimpleNamespace(**vars(base_release))
            setattr(mismatched_base, field, value)
            with self.subTest(label=label), mock.patch.object(
                MODULE, "config_hash", return_value="b" * 64
            ), mock.patch.object(
                MODULE, "parse_release_set", side_effect=[release, mismatched_base]
            ), mock.patch.object(
                MODULE, "validate_release_set"
            ), mock.patch.object(
                MODULE,
                "_exact_repo_digest",
                return_value="ghcr.io/denkoushi/raspisys-release-set@sha256:"
                + "9" * 64,
            ), mock.patch.object(
                MODULE, "verify_component_attestation"
            ), mock.patch.object(
                MODULE, "run", side_effect=fake_run
            ), self.assertRaisesRegex(RuntimeError, "does not match"):
                MODULE.release_set_artifacts(
                    SHA, ROOT / MODULE.DEFAULT_INVENTORY, require_torque=True
                )

    def test_adoption_verifier_selects_the_manifest_bound_run_attempt(self) -> None:
        predicates = [{"attempt": 1}, {"attempt": 2}]
        verifier_environments: list[dict[str, str]] = []
        verifier_directories: list[Path] = []

        def fake_run(
            command: list[str], **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            environment = kwargs.get("env")
            self.assertIsInstance(environment, dict)
            verifier_environments.append(environment)
            verifier_directory = Path(environment["GH_CONFIG_DIR"])
            self.assertTrue(verifier_directory.is_dir())
            verifier_directories.append(verifier_directory)
            if command[1:] == ["--version"]:
                return completed(command, "gh version 2.96.0 (test)\n")
            return completed(
                command,
                json.dumps(
                    [
                        {
                            "verificationResult": {
                                "statement": {"predicate": predicate}
                            }
                        }
                        for predicate in predicates
                    ]
                ),
            )

        def validate(predicate: object, **kwargs: object) -> None:
            if predicate != predicates[1] or kwargs["run_attempt"] != 2:
                raise MODULE.AdoptionError("different signed adoption attempt")

        with mock.patch.dict(MODULE.os.environ, {"GITHUB_TOKEN": "must-not-leak"}), mock.patch.object(
            MODULE.shutil, "which", return_value="/usr/bin/gh"
        ), mock.patch.object(
            MODULE, "run", side_effect=fake_run
        ), mock.patch.object(
            MODULE, "validate_adoption_predicate", side_effect=validate
        ) as validator:
            MODULE.verify_component_attestation(
                "ghcr.io/denkoushi/raspisys-torque-agent@sha256:" + "3" * 64,
                SHA,
                predicate_type=MODULE.TORQUE_ADOPTION_PREDICATE_TYPE,
                adoption_workflow=(".github/workflows/ci.yml", 123, 2),
            )

        self.assertEqual(validator.call_count, 2)
        self.assertEqual(len(verifier_environments), 2)
        for environment in verifier_environments:
            self.assertEqual(
                environment["GH_TOKEN"], MODULE.PUBLIC_ATTESTATION_TOKEN
            )
            self.assertNotIn("GITHUB_TOKEN", environment)
            self.assertIn("GH_CONFIG_DIR", environment)
        self.assertTrue(all(not directory.exists() for directory in verifier_directories))

    def test_torque_route_passes_manifest_digest_and_protocol_to_ansible(self) -> None:
        args = argparse.Namespace(
            inventory=MODULE.DEFAULT_INVENTORY,
            sha=SHA,
            run_id=RUN_ID,
            profiles="pi5,pi4",
            limit="pi5:pi4-a",
            full_fleet=False,
            torque_cutover=True,
        )
        inventory = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-a"]},
            "_meta": {
                "hostvars": {
                    "pi5": {},
                    "pi4-a": torque_capable_host(),
                }
            },
        }
        selection = (("pi5", ("pi5",)), ("pi4", ("pi4-a",)))
        torque_reference = "ghcr.io/denkoushi/raspisys-torque-agent@sha256:" + "3" * 64
        artifacts = MODULE.ReleaseArtifacts(
            f"api:{SHA}@sha256:{'1' * 64}",
            f"web:{SHA}@sha256:{'2' * 64}",
            torque_reference,
            1,
        )

        with mock.patch.object(
            MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)
        ), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(
            MODULE, "run", return_value=completed(["git"], f"{SHA}\n")
        ), mock.patch.object(
            MODULE, "preflight_optional_hosts", return_value=(selection, ())
        ), mock.patch.object(
            MODULE, "release_set_artifacts", return_value=artifacts
        ), mock.patch.object(MODULE.os, "execvpe") as execvpe, redirect_stdout(io.StringIO()):
            self.assertEqual(MODULE.execute_standard_route(args), 1)

        command = execvpe.call_args.args[1]
        variables = json.loads(command[command.index("--extra-vars") + 1])
        self.assertEqual(variables["release_kiosk_torque_image"], torque_reference)
        self.assertEqual(variables["release_torque_protocol_version"], 1)

    def test_print_plan_only_lists_ansible_hosts_and_tasks(self) -> None:
        args = argparse.Namespace(
            branch="main", limit="pi4-a", full_fleet=False
        )
        commands: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            return completed(command)

        with mock.patch.object(MODULE, "run", side_effect=fake_run):
            document = MODULE.plan(
                args,
                SHA,
                ROOT / MODULE.DEFAULT_INVENTORY,
                MODULE.DEFAULT_INVENTORY,
                (("pi4", ("pi4-a",)),),
            )

        self.assertEqual(document["executionOrder"][0]["hosts"], ["pi4-a"])
        self.assertEqual(len(commands), 2)
        self.assertEqual({command[-1] for command in commands}, {"--list-hosts", "--list-tasks"})
        self.assertTrue(all(command[0] == "ansible-playbook" for command in commands))

    def test_torque_print_plan_exposes_manifest_resolution_and_phase_boundaries(
        self,
    ) -> None:
        args = argparse.Namespace(
            branch="main",
            limit="pi5:pi4-a:pi4-b",
            full_fleet=False,
            torque_cutover=True,
        )
        selection = (
            ("pi5", ("pi5",)),
            ("pi4", ("pi4-a", "pi4-b")),
        )

        with mock.patch.object(
            MODULE, "run", return_value=completed(["ansible-playbook"])
        ), mock.patch.object(MODULE, "config_hash", return_value="4" * 64):
            document = MODULE.plan(
                args,
                SHA,
                ROOT / MODULE.DEFAULT_INVENTORY,
                MODULE.DEFAULT_INVENTORY,
                selection,
            )

        self.assertEqual(
            document["artifactResolution"],
            "signed-release-set-v2-before-service-quiesce",
        )
        self.assertEqual(
            [phase["phase"] for phase in document["cutoverPhases"]],
            [
                "PREPARED",
                "QUIESCED",
                "CONTROL_PLANE",
                "AGENTS_STAGED",
                "AGENTS_HEALTHY_OFF",
                "BROWSERS_RESUMED",
            ],
        )
        self.assertEqual(
            document["cutoverPhases"][0],
            {
                "phase": "PREPARED",
                "hosts": ["pi5", "pi4-a", "pi4-b"],
                "serviceImpact": "none",
            },
        )

    def test_detach_uses_existing_transient_systemd_primitive(self) -> None:
        args = argparse.Namespace(
            branch="main", inventory=MODULE.DEFAULT_INVENTORY, limit="pi4-a",
            full_fleet=False, detach=True,
        )
        command = MODULE.systemd_argv(
            args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",), "pi"
        )
        rendered = " ".join(command)

        self.assertEqual(command[:4], ["/usr/bin/sudo", "-n", "/usr/bin/systemd-run", "--quiet"])
        self.assertNotIn("--wait", command)
        self.assertIn("--property=RemainAfterExit=yes", command)
        self.assertIn("--property=Type=exec", command)
        self.assertIn("git checkout --detach", rendered)
        self.assertIn("--execute-standard-route", rendered)
        self.assertNotIn("rolling-release.py", rendered)

        foreground = argparse.Namespace(**{**vars(args), "detach": False})
        foreground_command = MODULE.systemd_argv(
            foreground, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",), "pi"
        )
        self.assertIn("--wait", foreground_command)
        self.assertNotIn("--property=RemainAfterExit=yes", foreground_command)

    def test_staging_systemd_and_remote_script_use_the_inventory_remote_root(self) -> None:
        args = argparse.Namespace(
            branch="feat/assembly-procedure-overlay-editing",
            inventory="infrastructure/ansible/inventory-staging.yml",
            limit="staging-pi5:staging-pi4-kiosk01",
            full_fleet=False,
            detach=True,
        )
        remote_root = Path("/opt/RaspberryPiSystem_002-staging")

        command = MODULE.systemd_argv(
            args,
            SHA,
            RUN_ID,
            args.inventory,
            ("pi5", "pi4"),
            "stageadmin",
            remote_root,
        )
        script = command[-1]

        self.assertIn(
            "--property=WorkingDirectory=/opt/RaspberryPiSystem_002-staging",
            command,
        )
        self.assertIn("cd /opt/RaspberryPiSystem_002-staging", script)
        self.assertNotIn("cd /opt/RaspberryPiSystem_002\n", script)

    def test_standard_route_contends_with_legacy_global_lock_before_git(self) -> None:
        args = argparse.Namespace(
            branch="main", inventory=MODULE.DEFAULT_INVENTORY, limit="pi4-a",
            full_fleet=False, detach=True,
        )
        script = MODULE.remote_script(
            args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",)
        )
        self.assertNotIn(".standard-ansible-release.lock", script)
        self.assertLess(
            script.index("fleet-release-state.lock"), script.index("git fetch")
        )
        self.assertIn("/usr/bin/flock -n 9", script)
        self.assertEqual(script.count('test -z "$(git status --porcelain)"'), 2)
        self.assertIn(f'test "$(git rev-parse HEAD)" = {SHA}', script)

        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            lock_path = project / "logs/deploy/fleet-release-state.lock"
            lock_path.parent.mkdir(parents=True)
            descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT, 0o600)
            marker = project / "git-was-reached"
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                contender = subprocess.run(
                    [
                        sys.executable,
                        "-c",
                        "import fcntl,os,sys; "
                        "fd=os.open(sys.argv[1],os.O_WRONLY); "
                        "\ntry: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)"
                        "\nexcept BlockingIOError: raise SystemExit(75)"
                        "\nopen(sys.argv[2],'w').close()",
                        str(lock_path),
                        str(marker),
                    ],
                    check=False,
                )
                self.assertEqual(contender.returncode, 75)
                self.assertFalse(marker.exists())
            finally:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)

    def test_status_reads_only_systemd_and_journal(self) -> None:
        args = argparse.Namespace(inventory=MODULE.DEFAULT_INVENTORY, status=RUN_ID)
        inventory = {
            "server": {"hosts": ["pi5"]},
            "_meta": {
                "hostvars": {
                    "pi5": {
                        "deploy_executor_host": "100.106.158.2",
                        "ansible_user": "pi",
                    }
                }
            },
        }
        calls: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            if "systemctl" in command[-1]:
                return completed(command, "LoadState=loaded\nActiveState=inactive\nResult=success\nExecMainStatus=0\n")
            return completed(command, "one journal line\n")

        with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(MODULE, "run", side_effect=fake_run), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(MODULE.status(args), 0)

        payload = json.loads(output.getvalue())
        self.assertEqual(payload["status"]["Result"], "success")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][-2], "pi@100.106.158.2")
        self.assertIn("systemctl show", calls[0][-1])
        self.assertIn("journalctl", calls[1][-1])

    def test_status_rejects_missing_unit(self) -> None:
        args = argparse.Namespace(inventory=MODULE.DEFAULT_INVENTORY, status=RUN_ID)
        inventory = {
            "server": {"hosts": ["pi5"]},
            "_meta": {
                "hostvars": {
                    "pi5": {
                        "deploy_executor_host": "100.106.158.2",
                        "ansible_user": "pi",
                    }
                }
            },
        }
        responses = [
            completed([], "LoadState=not-found\nActiveState=inactive\nResult=\n"),
            completed([]),
        ]
        with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(MODULE, "run", side_effect=responses), redirect_stdout(io.StringIO()):
            self.assertEqual(MODULE.status(args), 1)

    def test_launch_result_status_command_preserves_custom_inventory(self) -> None:
        relative = "infrastructure/ansible/custom inventory.yml"
        args = argparse.Namespace(
            execute_standard_route=False, status=None, inventory=relative,
            branch="main", limit="pi4-b", full_fleet=False,
            print_plan=False, detach=True,
        )
        complete = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-b"]},
            "_meta": {
                "hostvars": {
                    "pi5": {"deploy_executor_host": "100.106.158.2", "ansible_user": "pi"},
                    "pi4-b": {},
                }
            },
        }
        selected = {
            "kiosk": {"hosts": ["pi4-b"]},
            "_meta": {"hostvars": {"pi4-b": {}}},
        }
        calls: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            return completed(command)

        with mock.patch.object(MODULE, "parse_arguments", return_value=args), mock.patch.object(
            MODULE, "inventory_path", return_value=(Path("inventory.yml"), relative)
        ), mock.patch.object(MODULE, "resolve_sha", return_value=SHA), mock.patch.object(
            MODULE, "inventory_document", side_effect=[complete, selected]
        ), mock.patch.object(MODULE, "new_run_id", return_value=RUN_ID), mock.patch.object(
            MODULE, "run", side_effect=fake_run
        ), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(MODULE.main([]), 0)

        payload = json.loads(output.getvalue())
        self.assertEqual(
            payload["statusCommand"],
            f"scripts/update-all-clients.sh --status {RUN_ID} --inventory '{relative}'",
        )
        self.assertEqual(calls[0][-2], "pi@100.106.158.2")


if __name__ == "__main__":
    unittest.main()
