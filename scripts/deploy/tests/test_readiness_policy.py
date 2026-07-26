from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.rolling_release import readiness_policy


SHA = "a" * 40
PROJECT = Path(__file__).resolve().parents[3]


def work(
    host: str,
    role: str = "kiosk",
    *,
    mutation: bool = True,
    activation: bool = False,
    verification: bool = True,
    claims: tuple[str, ...] = ("terminalRepository",),
) -> dict[str, object]:
    return {
        "host": host,
        "role": role,
        "mutationRequired": mutation,
        "activationRequired": activation,
        "verificationRequired": verification,
        "claimRequirements": [
            {
                "kind": claim,
                "status": "unknown",
                "expectedIdentity": SHA,
            }
            for claim in claims
        ],
    }


def plan(
    *,
    components: tuple[str, ...] = ("neutral",),
    terminal_work: tuple[dict[str, object], ...] = (),
    pi5_required: bool = False,
    activation_enabled: bool = True,
    verification_enabled: bool = True,
    full_fleet: bool = False,
    reverify: bool = False,
) -> dict[str, object]:
    return {
        "sha": SHA,
        "classificationComponents": list(components),
        "pi5Required": pi5_required,
        "typedTargetPlanningEnabled": True,
        "activationExecutionEnabled": activation_enabled,
        "verificationOnlyExecutionEnabled": verification_enabled,
        "fullFleet": full_fleet,
        "reverifySelected": reverify,
        "terminalWork": list(terminal_work),
    }


def passing_evidence(
    selection: readiness_policy.ReadinessSelection,
) -> tuple[readiness_policy.ProbeEvidence, ...]:
    return tuple(
        readiness_policy.ProbeEvidence(
            capability=request.capability,
            status="passed",
            hosts=request.hosts,
        )
        for request in selection.probes
    )


class ReadinessPolicyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = readiness_policy.load_registry()

    def load_modified(self, mutate) -> readiness_policy.ReadinessRegistry:
        payload = json.loads(
            readiness_policy.REGISTRY_PATH.read_text(encoding="utf-8")
        )
        mutate(payload)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "readiness.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            return readiness_policy.load_registry(path, project=PROJECT)

    def test_real_registry_is_strict_complete_and_data_only(self):
        self.assertEqual(len(self.registry.gates), 8)
        self.assertEqual(
            {gate.mode for gate in self.registry.gates}, {"enforce", "observe"}
        )
        serialized = readiness_policy.REGISTRY_PATH.read_text(encoding="utf-8")
        for forbidden in ("command", "pythonImport", "modulePath", "__import__"):
            self.assertNotIn(f'"{forbidden}"', serialized)

    def test_registry_rejects_duplicate_unknown_and_uncovered_values(self):
        cases = (
            lambda payload: payload["gates"].append(
                copy.deepcopy(payload["gates"][0])
            ),
            lambda payload: payload["gates"][0].update(
                {"capability": "feature.arbitrary-shell"}
            ),
            lambda payload: payload["componentCoverage"].pop("torque-agent"),
            lambda payload: payload["componentCoverage"].update(
                {"invented-component": {"gateIds": ["local.source-and-scope"]}}
            ),
        )
        for mutate in cases:
            with self.subTest(case=cases.index(mutate)):
                with self.assertRaises(readiness_policy.ReadinessPolicyError):
                    self.load_modified(mutate)

    def test_registry_rejects_deep_conditions_and_unjustified_enforcement(self):
        def deep(payload):
            condition: dict[str, object] = {"always": True}
            for _index in range(readiness_policy.MAX_CONDITION_DEPTH + 1):
                condition = {"not": condition}
            payload["gates"][0]["when"] = condition

        def unjustified(payload):
            payload["gates"][-1]["mode"] = "enforce"

        def early_promotion(payload):
            gate = payload["gates"][-1]
            gate["mode"] = "enforce"
            gate["enforcementBasis"] = {
                "kind": "observed-promotion",
                "productionRunIds": ["run-one", "run-two"],
                "reason": "too early",
            }

        for mutate in (deep, unjustified, early_promotion):
            with self.assertRaises(readiness_policy.ReadinessPolicyError):
                self.load_modified(mutate)

    def test_docs_only_does_not_schedule_terminal_or_external_build_probe(self):
        selection = readiness_policy.select_readiness(
            self.registry,
            readiness_policy.facts_from_plan(plan()),
        )
        capabilities = {request.capability for request in selection.probes}
        self.assertNotIn("terminal.selected-prerequisites", capabilities)
        self.assertNotIn("route.external-server-build", capabilities)
        self.assertIn("migration.production-ledger", capabilities)
        self.assertIn("route.pi5-authority-and-resources", capabilities)

    def test_server_app_adds_external_build_but_not_terminal_probe(self):
        selection = readiness_policy.select_readiness(
            self.registry,
            readiness_policy.facts_from_plan(
                plan(components=("server-app",), pi5_required=True)
            ),
        )
        capabilities = {request.capability for request in selection.probes}
        self.assertIn("route.external-server-build", capabilities)
        self.assertNotIn("terminal.selected-prerequisites", capabilities)

    def test_exact_six_kiosk_targets_exclude_signage(self):
        kiosks = tuple(work(f"kiosk-{index}") for index in range(1, 7))
        selection = readiness_policy.select_readiness(
            self.registry,
            readiness_policy.facts_from_plan(
                plan(
                    components=("torque-agent",),
                    terminal_work=kiosks,
                    pi5_required=True,
                )
            ),
        )
        terminal = next(
            request
            for request in selection.probes
            if request.capability == "terminal.selected-prerequisites"
        )
        self.assertEqual(
            terminal.hosts, tuple(f"kiosk-{index}" for index in range(1, 7))
        )
        self.assertNotIn("raspberrypi3-signage", terminal.hosts)

    def test_activation_and_verification_only_executor_gates_are_selected(self):
        selection = readiness_policy.select_readiness(
            self.registry,
            readiness_policy.facts_from_plan(
                plan(
                    components=("server-app",),
                    terminal_work=(
                        work(
                            "kiosk-a",
                            mutation=False,
                            activation=True,
                            claims=("controlPlaneWeb",),
                        ),
                        work(
                            "signage-a",
                            "signage",
                            mutation=False,
                            verification=True,
                        ),
                    ),
                )
            ),
        )
        capabilities = {request.capability for request in selection.probes}
        self.assertIn("architecture.activation-executor", capabilities)
        self.assertIn("architecture.verification-executor", capabilities)

    def test_observe_issue_warns_with_zero_enforce_blocks_78_and_unknown_is_70(self):
        selection = readiness_policy.select_readiness(
            self.registry, readiness_policy.facts_from_plan(plan())
        )
        evidence = list(passing_evidence(selection))
        route_index = next(
            index
            for index, item in enumerate(evidence)
            if item.capability == "route.interrupted-run-recovery"
        )
        evidence[route_index] = readiness_policy.ProbeEvidence(
            capability="route.interrupted-run-recovery",
            status="passed",
            warnings=("pi5.interrupted-run-recovery-required",),
        )
        warned = readiness_policy.evaluate_readiness(
            self.registry, selection, evidence
        )
        self.assertEqual((warned.status, warned.exit_code), ("warned", 0))

        migration_index = next(
            index
            for index, item in enumerate(evidence)
            if item.capability == "migration.production-ledger"
        )
        evidence[migration_index] = readiness_policy.ProbeEvidence(
            capability="migration.production-ledger",
            status="blocked",
            issues=("migration.production-ledger-rejected",),
        )
        blocked = readiness_policy.evaluate_readiness(
            self.registry, selection, evidence
        )
        self.assertEqual((blocked.status, blocked.exit_code), ("blocked", 78))

        evidence[migration_index] = readiness_policy.ProbeEvidence(
            capability="migration.production-ledger",
            status="blocked",
            issues=("migration-unregistered-contract",),
        )
        incomplete = readiness_policy.evaluate_readiness(
            self.registry, selection, evidence
        )
        self.assertEqual(
            (incomplete.status, incomplete.exit_code), ("incomplete", 70)
        )
        self.assertEqual(
            incomplete.unowned_issues, ("migration-unregistered-contract",)
        )

    def test_missing_plan_facts_fail_closed_without_inventory_fallback(self):
        malformed = plan()
        del malformed["terminalWork"]
        with self.assertRaisesRegex(
            readiness_policy.ReadinessPolicyError, "terminalWork"
        ):
            readiness_policy.facts_from_plan(malformed)

        unknown_profile = readiness_policy.facts_from_plan(
            plan(terminal_work=(work("future-a", "future-profile"),))
        )
        with self.assertRaisesRegex(
            readiness_policy.ReadinessPolicyError, "unknown profiles"
        ):
            readiness_policy.select_readiness(
                self.registry, unknown_profile
            )

    def test_admission_allows_scope_reduction_and_rejects_every_expansion(self):
        original_plan = plan(
            components=("torque-agent",),
            terminal_work=(
                work(
                    "kiosk-a",
                    mutation=False,
                    activation=False,
                    verification=True,
                    claims=("terminalRepository", "controlPlaneWeb"),
                ),
                work("kiosk-b"),
            ),
            pi5_required=True,
        )
        selection = readiness_policy.select_readiness(
            self.registry, readiness_policy.facts_from_plan(original_plan)
        )
        decision = readiness_policy.evaluate_readiness(
            self.registry, selection, passing_evidence(selection)
        )
        admission = readiness_policy.make_admission(selection, decision)
        self.assertEqual(
            readiness_policy.parse_admission(admission.as_payload()), admission
        )

        reduced = readiness_policy.select_readiness(
            self.registry,
            readiness_policy.facts_from_plan(
                plan(
                    components=("torque-agent",),
                    terminal_work=(
                        work(
                            "kiosk-a",
                            mutation=False,
                            activation=False,
                            verification=True,
                            claims=("terminalRepository", "controlPlaneWeb"),
                        ),
                    ),
                )
            ),
        )
        self.assertEqual(
            readiness_policy.compare_admission(admission, reduced), ()
        )

        expansions = (
            plan(
                components=("torque-agent",),
                terminal_work=(
                    *original_plan["terminalWork"],
                    work("kiosk-c"),
                ),
                pi5_required=True,
            ),
            plan(
                components=("torque-agent",),
                terminal_work=(
                    work(
                        "kiosk-a",
                        mutation=False,
                        activation=True,
                        claims=("terminalRepository",),
                    ),
                ),
            ),
            plan(
                components=("torque-agent",),
                terminal_work=(
                    work(
                        "kiosk-a",
                        claims=(
                            "terminalRepository",
                            "controlPlaneWeb",
                            "runtime",
                        ),
                    ),
                ),
            ),
            plan(
                components=("server-app", "torque-agent"),
                terminal_work=(work("kiosk-a"),),
                pi5_required=True,
            ),
        )
        expected_fragments = ("host-added", "action-expanded", "claim-expanded", "component-expanded")
        for changed, fragment in zip(expansions, expected_fragments):
            current = readiness_policy.select_readiness(
                self.registry, readiness_policy.facts_from_plan(changed)
            )
            self.assertTrue(
                any(
                    fragment in issue
                    for issue in readiness_policy.compare_admission(
                        admission, current
                    )
                ),
                (fragment, readiness_policy.compare_admission(admission, current)),
            )


if __name__ == "__main__":
    unittest.main()
