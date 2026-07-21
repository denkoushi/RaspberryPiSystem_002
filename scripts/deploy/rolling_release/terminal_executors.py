"""Forward terminal execution strategies below the safety adapter boundary."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .local_execution import LOCAL_EXECUTOR, SSH_EXECUTOR
from .terminal_adapters import TerminalAdapter


@dataclass(frozen=True)
class TerminalExecutor:
    runtime: Any
    adapter: TerminalAdapter

    executor_id: str = ""

    def prepare(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
        maintenance_state_sha256: str,
    ) -> dict[str, Any] | None:
        del inventory, target_spec, target, run_id, maintenance_state_sha256
        return None

    def apply(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
        prepared: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        del prepared
        self.adapter.apply(inventory, target_spec["host"], target["desiredSha"], run_id)
        return None

    def expected_ready_sha(self, state: Any, target: dict[str, Any]) -> str:
        return self.adapter.expected_ready_sha(state, target)

    def await_completion(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
    ) -> dict[str, Any] | None:
        del inventory, target_spec, target
        return None

    def prove_ready(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
        release_sha: str,
        verification_id: str,
        target: dict[str, Any],
    ) -> None:
        del target
        self.adapter.prove_ready(
            inventory, target_spec, run_id, release_sha, verification_id
        )

    def reconcile(
        self, inventory: str, target_spec: dict[str, str], target: dict[str, Any]
    ) -> dict[str, Any]:
        del inventory, target_spec, target
        return {"state": "not-applicable", "quiesced": True, "result": None}

    def cleanup_residue(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
    ) -> dict[str, Any] | None:
        del inventory, target_spec, target
        return None


@dataclass(frozen=True)
class SshAnsibleExecutor(TerminalExecutor):
    executor_id: str = SSH_EXECUTOR


@dataclass(frozen=True)
class StoneBaseLocalAnsibleExecutor(TerminalExecutor):
    executor_id: str = LOCAL_EXECUTOR

    def prepare(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
        maintenance_state_sha256: str,
    ) -> dict[str, Any]:
        return self.runtime.prepare_local_terminal_candidate(
            inventory,
            target_spec,
            target,
            run_id,
            maintenance_state_sha256,
        )

    def apply(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
        prepared: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if not isinstance(prepared, dict):
            raise RuntimeError("local candidate artifact was not prepared")
        return self.runtime.submit_local_terminal_candidate(
            inventory, target_spec, target, run_id, prepared
        )

    def expected_ready_sha(self, state: Any, target: dict[str, Any]) -> str:
        del state
        candidate = target.get("desiredSha")
        if not isinstance(candidate, str) or len(candidate) != 40:
            raise RuntimeError("local candidate ready SHA is unavailable")
        return candidate

    def await_completion(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
    ) -> dict[str, Any]:
        return self.runtime.await_local_terminal_candidate(
            inventory, target_spec, target
        )

    def prove_ready(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
        release_sha: str,
        verification_id: str,
        target: dict[str, Any],
    ) -> None:
        self.runtime.prove_local_terminal_ready(
            inventory,
            target_spec,
            run_id,
            release_sha,
            verification_id,
            target,
        )

    def reconcile(
        self, inventory: str, target_spec: dict[str, str], target: dict[str, Any]
    ) -> dict[str, Any]:
        return self.runtime.reconcile_local_terminal_candidate(
            inventory, target_spec, target
        )

    def cleanup_residue(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
    ) -> dict[str, Any]:
        return self.runtime.cleanup_local_terminal_candidate(
            inventory, target_spec, target
        )


def executor_for(
    executor_id: str, *, runtime: Any, adapter: TerminalAdapter
) -> TerminalExecutor:
    if executor_id == SSH_EXECUTOR:
        return SshAnsibleExecutor(runtime, adapter)
    if executor_id == LOCAL_EXECUTOR:
        return StoneBaseLocalAnsibleExecutor(runtime, adapter)
    raise RuntimeError(f"unsupported terminal executor: {executor_id}")
