"""Release ordering and cooperative phase control.

The facade is injected as ``runtime`` so the long-standing unit tests can
continue patching command adapters while implementation moves into a package.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .cancellation import CancellationRequested, CancellationToken


def execute(args: Any, *, runtime: Any, token: CancellationToken) -> int:
    inventory = str(
        Path(args.inventory)
        if Path(args.inventory).is_absolute()
        else runtime.ANSIBLE_DIRECTORY / args.inventory
    )
    state = None
    try:
        token.checkpoint("coordinator-start")
        initial = {
            "version": 1,
            "runId": args.run_id,
            "branch": args.branch,
            "inventory": args.inventory,
            "limitHosts": args.limit or "",
            "releaseSha": args.sha,
            "unitName": runtime.os.environ.get("ROLLING_RELEASE_UNIT"),
            "runner": "systemd-run",
            "startedAt": runtime.utc_now(),
            "state": "running",
            "phase": "planning",
            "targets": [],
        }
        state = runtime.ReleaseState(runtime.status_file(args.run_id), initial)
        state.save()
        token.checkpoint("state-initialized")
        inventory_data = runtime.inventory_json(inventory)
        selected = runtime.selected_hosts(inventory, args.limit)
        if args.limit and selected == []:
            raise RuntimeError(f"--limit selected no hosts: {args.limit}")
        targets = runtime.release_targets(inventory_data, selected)
        if not targets and not args.limit:
            raise RuntimeError("no kiosk or signage targets selected")

        classification: dict[str, Any] | None = None
        minimize_metadata: dict[str, Any] = {
            "autoMinimize": False,
            "minimized": False,
            "excludedHosts": [],
            "classificationComponents": None,
        }
        if args.auto_minimize:
            classification, _ = runtime.classify_release_impact(
                args.sha, runtime.read_pi5_release_current()
            )
            targets, minimize_metadata = runtime.apply_auto_minimize(
                targets, inventory_data, classification
            )

        if classification is not None:
            pi5_required = runtime.release_policy.requires_pi5_release(classification)
        else:
            pi5_required = runtime.pi5_release_required(args.sha)

        plan = runtime.release_planner.build_execution_plan_payload(
            pi5_required=pi5_required,
            targets=targets,
            limit=args.limit,
            minimize_metadata=minimize_metadata,
        )
        if not targets and not pi5_required and not args.auto_minimize:
            raise RuntimeError("no kiosk or signage targets selected")
        state.payload["targets"] = [{**target, "state": "pending"} for target in targets]
        state.payload["plan"] = plan
        state.save()
        token.checkpoint("plan-complete")

        if not targets and not pi5_required:
            state.payload["pi5"] = {"state": "not-required"}
            state.payload["phase"] = "completed"
            state.payload["state"] = "success"
            state.save()
            return 0 if state.payload["state"] == "success" else 130

        state.payload["phase"] = "preparing"
        state.save()
        token.checkpoint("before-pi5")
        if pi5_required:
            # The five-minute Blue/Green switch monitor and cleanup form one
            # atomic safety window.  Cancellation is observed immediately
            # after it, never by killing or abandoning the monitor.
            runtime.ensure_pi5_release(args.sha, state)
        else:
            state.payload["pi5"] = {"state": "not-required"}
            state.save()
        token.checkpoint("after-pi5-stability")

        for index, target_spec in enumerate(targets):
            token.checkpoint(f'before-terminal:{target_spec["host"]}')
            target = state.target(target_spec["host"])
            target["previousSha"] = runtime.remote_previous_sha(inventory, target_spec["host"])
            if runtime.should_issue_terminal_notice(
                terminal_type=target_spec["terminalType"],
                emergency_override=args.emergency_override,
            ):
                runtime.deliver_terminal_notice(state, target_spec, target, args.run_id)
            else:
                target["notice"] = {
                    "state": "skipped",
                    "reason": runtime.terminal_notice_skip_reason(
                        terminal_type=target_spec["terminalType"],
                        emergency_override=args.emergency_override,
                    ),
                    "skippedAt": runtime.utc_now(),
                }
                state.save()
            token.checkpoint(f'after-notice:{target_spec["host"]}')

            target["state"] = "maintenance-requested"
            target["maintenanceStartedAt"] = runtime.utc_now()
            state.payload["phase"] = "deploying"
            state.save()
            runtime.state_command(
                "put",
                "--run-id",
                args.run_id,
                "--clients",
                target_spec["clientId"],
                "--terminal-type",
                target_spec["terminalType"],
            )
            token.checkpoint(f'after-maintenance:{target_spec["host"]}')
            if target_spec["terminalType"] == "signage":
                runtime.prestage_signage_maintenance(
                    inventory,
                    target_spec["host"],
                    args.run_id,
                    target_spec["clientId"],
                )
            if not runtime.wait_for_ack(
                args.run_id, target_spec["clientId"], phase="maintenance"
            ):
                if not args.emergency_override:
                    raise RuntimeError(
                        f'maintenance acknowledgement timed out for {target_spec["host"]}'
                    )
                target["ackOverrideReason"] = args.reason
            target["acknowledgedAt"] = runtime.utc_now()
            token.checkpoint(f'before-playbook:{target_spec["host"]}')

            target["state"] = "deploying"
            state.save()
            runtime.state_command("set-phase", "--run-id", args.run_id, "--phase", "deploying")
            try:
                # Ansible is not killed mid-operation.  A control request is
                # honored at the checkpoint immediately after it returns.
                runtime.playbook(inventory, target_spec["host"], args.sha, args.run_id)
                target["newSha"] = args.sha
                target["state"] = "success"
                target["completedAt"] = runtime.utc_now()
                runtime.state_command(
                    "remove-client",
                    "--run-id",
                    args.run_id,
                    "--client",
                    target_spec["clientId"],
                )
                state.save()
            except Exception as error:
                target["state"] = "rolling-back"
                target["failure"] = str(error)
                state.payload["phase"] = "rolling-back"
                state.save()
                # Rollback wins over cancellation and is never interrupted.
                runtime.rollback_terminal(inventory, target_spec, target, args.run_id)
                target["state"] = "failed"
                target["completedAt"] = runtime.utc_now()
                state.save()
                raise RuntimeError(
                    f'rollout stopped after {target_spec["host"]} failed'
                ) from error

            token.checkpoint(f'after-playbook:{target_spec["host"]}')
            if runtime.should_hold_after_canary(
                targets, index, skip=args.skip_canary_hold
            ):
                state.payload["phase"] = "waiting-approval"
                state.save()
                runtime.wait_for_canary_hold(
                    state, args.run_id, target_spec["host"], args.canary_hold_timeout
                )
                token.checkpoint("after-canary-approval")

        token.checkpoint("before-success")
        state.payload["phase"] = "completed"
        state.payload["state"] = "success"
        state.save()
        return 0 if state.payload["state"] == "success" else 130
    except CancellationRequested as cancellation:
        # No Git, checkout, lock deletion, PID kill, or child kill occurs here.
        # Removing deploy-status entries is safe only at a coordinator phase
        # boundary; Blue/Green, Ansible, and rollback return before reaching it.
        cleanup: dict[str, Any]
        try:
            runtime.state_command("remove-run", "--run-id", args.run_id)
            cleanup = {"state": "success", "completedAt": runtime.utc_now()}
        except Exception as cleanup_error:
            cleanup = {
                "state": "failed",
                "failedAt": runtime.utc_now(),
                "error": str(cleanup_error),
            }
        cleanup_failed = cleanup["state"] == "failed"
        terminal_state = "failed" if cleanup_failed else "cancelled"
        if state is None:
            state = runtime.ReleaseState(
                runtime.status_file(args.run_id),
                {
                    "version": 1,
                    "runId": args.run_id,
                    "branch": args.branch,
                    "inventory": args.inventory,
                    "limitHosts": args.limit or "",
                    "releaseSha": args.sha,
                    "unitName": runtime.os.environ.get("ROLLING_RELEASE_UNIT"),
                    "runner": "systemd-run",
                    "startedAt": runtime.utc_now(),
                    "targets": [],
                    "state": terminal_state,
                    "phase": "completed",
                },
            )
        else:
            state.payload["state"] = terminal_state
            state.payload["phase"] = "completed"
        canary_hold = state.payload.get("canaryHold")
        if isinstance(canary_hold, dict):
            canary_hold.update({"state": "cancelled", "cancelledAt": runtime.utc_now()})
        state.payload["cancellation"] = {
            "reason": cancellation.reason,
            "checkpoint": cancellation.checkpoint,
            "cancelledAt": runtime.utc_now(),
        }
        state.payload["cancellationCleanup"] = cleanup
        if cleanup_failed:
            state.payload["failure"] = f'cancellation cleanup failed: {cleanup["error"]}'
        state.save()
        return 1 if cleanup_failed else 130
    except Exception as error:
        if state is not None:
            state.payload["state"] = "failed"
            state.payload["phase"] = "completed"
            state.payload["failure"] = str(error)
            state.save()
        raise
