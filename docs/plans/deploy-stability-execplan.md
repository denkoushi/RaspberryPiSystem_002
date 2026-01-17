# Deploy Stability Enhancements (Update-All-Clients Primary)

This ExecPlan is a living document and must be maintained in accordance with `.agent/PLANS.md`. It must remain self-contained so a novice can execute it without any other context.

## Purpose / Big Picture

After this change, deployments run from `scripts/update-all-clients.sh` become safer and more observable on a multi-client site, with explicit guards for resource pressure, duplicate executions, and transient network failures. Operators will see deterministic preflight checks, consistent failure handling, and Slack alerts for the right milestones. Success is observed by running the deployment script against the current inventory and seeing: (1) preflight reachability checks; (2) resource guard aborts when thresholds are exceeded; (3) lock file preventing parallel runs; (4) post-deploy health checks with summarized output; and (5) GitHub Actions CI passing on the feature branch.

## Progress

- [x] (2026-02-01 00:00Z) Drafted ExecPlan with scope, files, and verification steps.
- [x] (2026-01-17 00:10Z) Created feature branch `feat/deploy-stability-20260117`.
- [x] (2026-01-17 00:18Z) Added Pi5 reachability + inventory ping preflight in `scripts/update-all-clients.sh`.
- [x] (2026-01-17 00:24Z) Added Pi5-side lock file enforcement with stale lock cleanup in `scripts/update-all-clients.sh`.
- [x] (2026-01-17 00:33Z) Added shared resource guard tasks (memory/disk) and wired into `deploy.yml`.
- [x] (2026-01-17 00:44Z) Implemented unreachable-only retries (3 attempts, 30s delay) in `scripts/update-all-clients.sh`.
- [x] (2026-01-17 00:52Z) Set per-host command timeouts in `infrastructure/ansible/inventory.yml` (Pi3 30m / Pi4 10m / Pi5 15m).
- [x] (2026-01-17 00:58Z) Added start/success/failure/per-host Slack notifications in `scripts/update-all-clients.sh`.
- [x] (2026-01-17 01:02Z) Aligned `scripts/deploy/deploy-all.sh` lock timeout with update-all-clients.
- [ ] (2026-01-17 01:10Z) Ran local Docker build; `web` build failed with TypeScript errors (see Surprises).
- [x] (2026-01-17 01:12Z) `ansible-playbook deploy.yml --syntax-check` succeeded with `ANSIBLE_ROLES_PATH` set.
- [ ] Run local Docker build verification and trigger GitHub Actions CI on the feature branch.
- [ ] Record outcomes and update Decision Log.

## Surprises & Discoveries

- Docker build (`docker compose -f infrastructure/docker/docker-compose.server.yml build api web`) exceeded the initial timeout; rerun with a longer timeout if needed.
- `ansible-playbook ... --syntax-check` failed without `ANSIBLE_ROLES_PATH`. Use `ANSIBLE_ROLES_PATH=infrastructure/ansible/roles` when validating locally.
- Docker build failed in `apps/web` due to TypeScript errors in `useWebRTC.ts` (missing `useMemo` import, invalid `handlers` option type).

## Decision Log

- Decision: Use `scripts/update-all-clients.sh` + `infrastructure/ansible/playbooks/deploy.yml` as the primary deployment path, and keep `scripts/deploy/deploy-all.sh` aligned as a secondary path.  
  Rationale: This matches current operations and keeps the existing Ansible inventory-driven workflow as the primary control surface.  
  Date/Author: 2026-02-01 / GPT-5.2 Codex.

- Decision: Resource guard thresholds are memory 120MB and disk usage 90%, with CPU monitoring disabled.  
  Rationale: Pi3 failures are dominated by memory pressure; disk exhaustion is a practical failure mode; CPU spikes are transient and less predictive.  
  Date/Author: 2026-02-01 / GPT-5.2 Codex.

- Decision: Retries apply only to unreachable hosts, with 3 attempts and 30-second delay; task failures are not retried automatically.  
  Rationale: This matches the agreed “environment-only retry” policy and avoids re-running code/config failures.  
  Date/Author: 2026-02-01 / GPT-5.2 Codex.

- Decision: Timeouts are Pi3 30 minutes, Pi4 10 minutes, Pi5 15 minutes.  
  Rationale: Matches observed deployment durations and prior decisions; avoids premature termination.  
  Date/Author: 2026-02-01 / GPT-5.2 Codex.

- Decision: Slack notifications are sent on start, overall success, overall failure, and per-host failure.  
  Rationale: Keeps noise low while surfacing failures quickly.  
  Date/Author: 2026-02-01 / GPT-5.2 Codex.

## Outcomes & Retrospective

- Pending. This section will be updated after implementation and verification.

## Context and Orientation

The primary deployment entrypoint is `scripts/update-all-clients.sh`, which runs `infrastructure/ansible/playbooks/update-clients.yml` (a wrapper for `deploy.yml`) and then `infrastructure/ansible/playbooks/health-check.yml`. The `deploy.yml` playbook orchestrates `common`, `server`, `client`, `kiosk`, and `signage` roles with `serial: 1` and `order: inventory`. Preflight memory checks for signage clients live in `infrastructure/ansible/tasks/preflight-signage.yml`. The secondary deployment pipeline is `scripts/deploy/deploy-all.sh`, which has its own lock and JSONL logging. Slack notifications are issued via `scripts/generate-alert.sh`. Logs are stored under `logs/` and are not committed.

This work adds stability controls that do not alter business logic: a Pi5-side lock file, preflight reachability checks, resource guards for memory/disk, environment-only retries, and standardized timeouts. It also ensures Slack alerts and logging remain consistent and that both deployment paths are aligned.

## Plan of Work

Start by creating a feature branch. Update `scripts/update-all-clients.sh` to introduce a Pi5-side lock file (with stale lock cleanup) and to run a preflight reachability check before deployment. Implement unreachable-only retry logic driven by the generated summary JSON. Add consistent Slack notifications for start, overall success/failure, and per-host failure (reusing `scripts/generate-alert.sh`).  

Update Ansible by adding a reusable resource guard task file that checks available memory and disk usage before heavy steps; then include it in `infrastructure/ansible/playbooks/deploy.yml` and relevant role tasks. Ensure preflight signage memory checks remain consistent with the new guard. Introduce timeouts at the safest layer possible (prefer Ansible task timeouts or wrapper-level timeouts; avoid changing SSH globals without justification).  

Align `scripts/deploy/deploy-all.sh` to use the same lock/logging conventions and timeout assumptions so operators can switch paths without surprising behavior.  

Finally, run local Docker build verification, run Ansible syntax checks, and push to the feature branch to confirm GitHub Actions CI passes.

## Concrete Steps

1. Create a feature branch.
   - From repository root: `git checkout -b feat/deploy-stability-YYYYMMDD`
   - Confirm `git status` shows the new branch.

2. Update `scripts/update-all-clients.sh`.
   - Add a remote lock mechanism on Pi5 (in `/opt/RaspberryPiSystem_002/logs/`), with timeout-based stale lock removal.
   - Add a preflight reachability check: Pi5 is reachable, then `ansible -m ping` against inventory hosts from Pi5.
   - Add environment-only retries: if summary shows only `unreachableHosts` and no `failedHosts`, retry up to 3 times with 30s delay using `--limit`.
   - Add Slack notifications for start, overall success, overall failure, and per-host failure (reuse `scripts/generate-alert.sh`).

3. Add a shared resource guard task file (new).
   - Create `infrastructure/ansible/tasks/resource-guard.yml` to check memory and disk usage.
   - Use `free -m` for memory and `df -P /opt` for disk usage.
   - Fail fast with a clear message if memory < 120MB or disk usage >= 90%.

4. Wire the resource guard into the deployment flow.
   - Include the task near the start of `infrastructure/ansible/playbooks/deploy.yml`.
   - Reuse or harmonize messages with `infrastructure/ansible/tasks/preflight-signage.yml`.

5. Implement timeouts safely.
   - Apply task-level timeouts to long-running steps (Pi3 30m / Pi4 10m / Pi5 15m).
   - Prefer Ansible `async`/`poll` or shell `timeout` wrappers in specific tasks rather than global SSH settings.

6. Align `scripts/deploy/deploy-all.sh`.
   - Ensure lock path and timeout assumptions match update-all-clients.
   - Keep logging under `logs/deploy/` and include the same timeout defaults.

7. Validation.
   - Local build: `docker compose -f infrastructure/docker/docker-compose.server.yml build api web`
   - Ansible syntax check: `ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/deploy.yml --syntax-check`
   - Push branch to run GitHub Actions CI and verify all jobs pass.

## Validation and Acceptance

The change is accepted when:

- Running `scripts/update-all-clients.sh <branch> <inventory>` from Mac shows a preflight ping step and fails fast if Pi5 or inventory hosts are unreachable.
- Starting a second deployment while one is running fails with a clear lock-file message.
- If a host is unreachable, the script retries that host up to three times with 30-second delay.
- If memory is below 120MB or disk usage exceeds 90% on a host, Ansible fails with a clear resource guard error.
- Slack receives start/success/failure notifications and per-host failure alerts.
- `infrastructure/ansible/playbooks/health-check.yml` runs after deploy and logs outputs.
- GitHub Actions CI on the feature branch passes.

## Idempotence and Recovery

All changes are additive or guard-only. Lock files are removed on normal exit and are cleaned up if stale. Resource guard failures are safe and do not modify state beyond stopping the deployment. If a retry fails, the script exits without destructive operations. Re-running the script should be safe after clearing stale locks and verifying `network_mode` is `tailscale`.

## Artifacts and Notes

Expected log artifacts:
  - `logs/ansible-update-<timestamp>.log`
  - `logs/ansible-update-<timestamp>.summary.json`
  - `logs/ansible-history.jsonl`
  - `logs/ansible-health-<timestamp>.log`
  - `logs/ansible-health-<timestamp>.summary.json`

## Interfaces and Dependencies

Primary scripts:
  - `scripts/update-all-clients.sh` (entrypoint)
  - `scripts/generate-alert.sh` (Slack notification)
  - `scripts/deploy/deploy-all.sh` (secondary deployment path)

Primary Ansible files:
  - `infrastructure/ansible/playbooks/deploy.yml` (orchestration)
  - `infrastructure/ansible/tasks/preflight-signage.yml` (existing memory preflight)
  - `infrastructure/ansible/tasks/resource-guard.yml` (new guard task)
  - `infrastructure/ansible/playbooks/health-check.yml` (post-deploy checks)
