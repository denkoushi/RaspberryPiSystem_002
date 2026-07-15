"""Pure reconciliation of durable run JSON with transient systemd state."""
from __future__ import annotations

import copy
from typing import Any

from .models import UNIT_PREFIX, UNIT_SUFFIX, UnitObservation


TERMINAL_STATES = frozenset({"success", "failed", "cancelled", "interrupted"})
ACTIVE_STATES = frozenset({"active", "activating", "reloading", "deactivating"})
INTERRUPTION_RESULTS = frozenset(
    {"signal", "core-dump", "timeout", "watchdog", "oom-kill", "resources"}
)
INTERRUPTION_EXEC_CODES = frozenset({"2", "3", "killed", "dumped"})


def _finish(result: dict[str, Any], unit: UnitObservation) -> dict[str, Any]:
    """Keep terminal metadata consistent with the reconciled public state."""
    effective = result.get("state")
    if effective not in TERMINAL_STATES:
        for field in ("endedAt", "completedAt", "exitCode"):
            result.pop(field, None)
        return result

    if effective == "success":
        result["exitCode"] = 0
    elif effective == "cancelled":
        result["exitCode"] = 130
    elif unit.exec_main_status not in (None, 0):
        result["exitCode"] = unit.exec_main_status
    else:
        result["exitCode"] = 1
    return result


def _unit_payload(unit: UnitObservation) -> dict[str, Any]:
    return {
        "loadState": unit.load_state,
        "activeState": unit.active_state,
        "subState": unit.sub_state,
        "result": unit.result,
        "execMainCode": unit.exec_main_code,
        "execMainStatus": unit.exec_main_status,
    }


def reconcile_status(
    state: dict[str, Any] | None,
    control: dict[str, Any] | None,
    unit: UnitObservation,
) -> dict[str, Any]:
    """Return the effective public status without promoting uncertain success."""
    if not unit.reachable:
        raise RuntimeError(f"systemd state is unreachable: {unit.error or 'unknown error'}")
    result: dict[str, Any] = copy.deepcopy(state) if state is not None else {}
    if "runId" not in result and isinstance(control, dict):
        result["runId"] = control.get("runId")
    if "runId" not in result and unit.unit_name.startswith(UNIT_PREFIX) and unit.unit_name.endswith(UNIT_SUFFIX):
        result["runId"] = unit.unit_name[len(UNIT_PREFIX):-len(UNIT_SUFFIX)]
    result["unitName"] = unit.unit_name
    result["unit"] = _unit_payload(unit)
    result["control"] = copy.deepcopy(control)

    persisted = state.get("state") if isinstance(state, dict) else None
    if unit.active_state in ACTIVE_STATES:
        result["state"] = "cancelling" if control is not None else "running"
        result["phase"] = "cancelling" if control is not None else result.get("phase", "preparing")
        result["reconciliationReason"] = (
            "cancel-recorded-unit-active" if control is not None else "unit-active"
        )
        return _finish(result, unit)

    unit_missing = unit.load_state == "not-found"
    clean_exit = unit.result in (None, "success") and unit.exec_main_status in (None, 0)

    if persisted in TERMINAL_STATES:
        if persisted == "success":
            if unit_missing or clean_exit:
                result["state"] = "success"
                result["reconciliationReason"] = (
                    "persisted-success-unit-unloaded" if unit_missing else "persisted-success-clean-unit"
                )
            else:
                result["state"] = "interrupted"
                result["reconciliationReason"] = "persisted-success-conflicts-with-unit"
            return _finish(result, unit)
        if persisted == "cancelled" and control is None:
            result["state"] = "interrupted"
            result["reconciliationReason"] = "cancelled-state-missing-control"
            return _finish(result, unit)
        result["state"] = persisted
        result["reconciliationReason"] = f"persisted-{persisted}"
        return _finish(result, unit)

    if control is not None and (
        unit_missing
        or unit.exec_main_status == 130
        or unit.exec_main_code in INTERRUPTION_EXEC_CODES
        or unit.result in INTERRUPTION_RESULTS
    ):
        result["state"] = "cancelled"
        result["phase"] = "completed"
        result["reconciliationReason"] = "control-record-and-terminal-unit"
        return _finish(result, unit)

    if unit.exec_main_status == 75:
        result["state"] = "failed"
        result["phase"] = "completed"
        result["failure"] = result.get("failure", "another release owns the kernel lock")
        result["reconciliationReason"] = "lock-contended-before-coordinator"
        return _finish(result, unit)

    if unit_missing:
        result["state"] = "not-found" if state is None and control is None else "interrupted"
        result["phase"] = "completed" if result["state"] == "interrupted" else result.get("phase")
        result["reconciliationReason"] = (
            "no-unit-or-run-record" if result["state"] == "not-found" else "unit-missing-before-terminal-state"
        )
        return _finish(result, unit)

    if unit.result in INTERRUPTION_RESULTS or unit.exec_main_code in INTERRUPTION_EXEC_CODES:
        result["state"] = "interrupted"
        result["phase"] = "completed"
        result["reconciliationReason"] = "unit-interrupted-without-cancel-control"
        return _finish(result, unit)

    if unit.exec_main_status not in (None, 0) or unit.result not in (None, "success"):
        result["state"] = "failed"
        result["phase"] = "completed"
        result["failure"] = result.get(
            "failure", f"release unit failed ({unit.result or 'exit-code'}:{unit.exec_main_status})"
        )
        result["reconciliationReason"] = "unit-failed-before-terminal-state"
        return _finish(result, unit)

    # A clean unit exit cannot manufacture release success.  Only the
    # coordinator's fsynced terminal state may do that.
    result["state"] = "interrupted"
    result["phase"] = "completed"
    result["reconciliationReason"] = "unit-exited-without-persisted-success"
    return _finish(result, unit)
