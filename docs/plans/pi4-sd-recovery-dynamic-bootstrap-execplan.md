# Recover a Pi4 from a user-reported dynamic LAN endpoint

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current while work proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

When a Pi4 SD card fails, the operator buys a replacement SD card, installs Raspberry Pi OS, connects it to Wi-Fi, and reports which inventory terminal is being replaced together with the new OS hostname and its current private-LAN IPv4 address. The Pi5 then verifies that fresh machine without assuming the old IP address will return, rebuilds it from the immutable release already proven on Pi5, and records the new endpoint for normal operation. A read-only `plan` must prove the reported SSH identity before a destructive `run` is allowed. Recovery must neither restore an old SSH identity nor depend on Tailscale, a fixed DHCP reservation, an external paid service, or an application database change.

## Progress

- [x] (2026-08-01 JST) Inspected the current coordinator, inventory resolver, LAN provider, recovery and verification playbooks, runtime override precedence, Fleet Lock/state behavior, all 37 focused tests, Runbook, ADR, setup guide, and the prior LAN ExecPlan before creating this plan.
- [x] (2026-08-01 JST) Compared declared endpoints with live factory evidence. Robodrill and FJV matched, while `raspberrypi4` and Sessaku were healthy at different DHCP addresses; this disproved the fixed-address premise.
- [x] (2026-08-01 JST) Synchronized clean `main` with `origin/main` at `426d959fea9f88ed0a95c32d492a7deabf030dc4` and created `feat/pi4-sd-recovery-dynamic-bootstrap` without stashing, deleting, or overwriting user work.
- [x] (2026-08-01 JST) Added an independently testable ED25519 SSH bootstrap-identity verifier with temporary mode-0600 known-hosts files and strict pinning for plan, recovery, and verification.
- [x] (2026-08-01 JST) Replaced the target fixed-IP contract with schema-v3 Pi5-server LAN readiness and dynamic RFC1918 bootstrap validation; removed the five misleading static recovery endpoint fields.
- [x] (2026-08-01 JST) Corrected current/original endpoint history, duplicate SSH-identity guards, runtime metadata, CLI output, and recovery playbook address proof.
- [x] (2026-08-01 JST) Expanded focused coverage from 37 to 43 tests, passed all three Ansible syntax checks and six production-shaped controller-only resolutions, and updated the Runbook, ADR, setup guide, and historical-plan status.
- [x] (2026-08-01 JST) Passed Node 22.23.1/pnpm 9.15.9 canonical deploy contracts: 962 Python tests, 157 isolated migrations and current status, indexed SQL EXPLAIN, 20 API tests, Ansible contracts, and cleanup with zero new UUID resources.
- [x] (2026-08-01 JST) Committed implementation, tests, and documentation in three reviewable local intent commits and prepared a clean handoff. Push, PR, merge, production deployment, and a physical SD drill remain separate gates requiring the relevant approval.

## Surprises & Discoveries

- Observation: current `plan` rejects a correct fresh Pi4 whenever its DHCP address differs from the inventory-declared recovery address.
  Evidence: `LanRecoveryNetworkProvider.validate_bootstrap` requires equality with `recovery_network.target_endpoint`, and `recover-pi4.yml` asserts `ansible_host == pi4_recovery_lan_endpoint`.
- Observation: the inventory addresses are not reliable statements of the currently assigned address.
  Evidence: on 2026-08-01, `raspberrypi4` was declared as `192.168.10.224` but healthy at `192.168.10.223`; Sessaku was declared as `192.168.128.187` but healthy at `192.168.10.104`. ICMP, SSH, Ansible, and Pi4-to-Pi5 LAN checks passed at the observed addresses.
- Observation: current runtime metadata preserves only the first inventory endpoint, so a later recovery can confuse the first endpoint with the immediately previous active endpoint.
  Evidence: `resolve_target` promotes `metadata.original_ansible_host` to the comparison endpoint whenever a runtime override exists.
- Observation: the recovery path presently disables effective SSH host-key checking.
  Evidence: the repository Ansible configuration sets `host_key_checking=False`, and the coordinator uses generic batch SSH without a recovery-specific known-hosts file.
- Observation: recovery does not need to rename the replacement OS to the inventory target name.
  Evidence: logical identity is already carried by the selected inventory host, status client ID, and per-host configuration. The reported OS hostname is instead useful as a human-controlled freshness and targeting check.
- Observation: an older stopped temporary-test container, volume, and network with UUID `d57c85bc-02d3-44a7-8bda-e74a33afe89c` predate this work.
  Evidence: the prior ExecPlan recorded their identities. They must remain untouched; each new test run must clean only its own UUID-labelled resources.
- Observation: Docker Desktop regenerated only its built-in `bridge` network ID when the isolated test network was created and removed.
  Evidence: the built-in bridge changed from `498e4d3377e9…` to `7d868bfff860…`; the pre-existing container `a7d25ece2047…`, volume `rolling-deploy-status-d57c85bc-…-data`, host/null networks, old labelled network `fdc7f98f5fcd…`, and user debug network `9647f70f2644…` retained their identities. The new run `0f13af3b-8077-4a9d-99c9-c945651d5e31` reported container, volume, and network cleanup and `run resources=0`.

## Decision Log

- Decision: treat `--bootstrap-host` as the replacement OS's current RFC1918 IPv4, not a stable inventory address.
  Rationale: DHCP may assign a different address after every SD installation, and the user explicitly supplies the currently reachable address.
  Date/Author: 2026-08-01 / User and Codex.
- Decision: require a user-reported `--bootstrap-hostname` and make `plan` read-only probe the SSH username, hostname, and ED25519 host key.
  Rationale: an IP alone is not machine identity. These independent checks greatly reduce the chance of provisioning the wrong LAN device while keeping operator input simple.
  Date/Author: 2026-08-01 / Codex.
- Decision: return the SSH host-key fingerprint from `plan` and require that fingerprint explicitly on `run`; re-resolve and re-probe inside the Fleet Lock.
  Rationale: the operator can review the planned identity, and a DHCP reassignment or replaced host between plan and run fails closed before Fleet State or endpoint mutation.
  Date/Author: 2026-08-01 / Codex.
- Decision: pin a temporary mode-0600 `known_hosts` file for bootstrap SSH, recovery Ansible, and final verification.
  Rationale: connection-wide pinning closes the gap left by global disabled host-key checking. The public host key and fingerprint are not secrets, but the temporary file is still removed on success and failure.
  Date/Author: 2026-08-01 / Codex.
- Decision: retain both the earliest inventory endpoint and the immediately previous active endpoint in runtime metadata.
  Rationale: audit history and duplicate-device protection have different meanings and must not be represented by one overloaded field.
  Date/Author: 2026-08-01 / Codex.
- Decision: keep recovery scoped to the five hosts with `pi4_recovery_enabled: true`; Assembly, Talkplaza, Pi3, and Pi5 remain outside it.
  Rationale: those systems need separate hardware and operational acceptance.
  Date/Author: 2026-08-01 / Codex.

## Outcomes & Retrospective

Local implementation, validation, and intent commits are complete. The base is the merged and Pi5-deployed LAN recovery implementation at `426d959f…`, whose read-only plans succeeded for all five enabled targets but whose fixed-address safety premise failed against two live factory terminals. The new schema-v3 contract resolves all five enabled production hosts as configured and keeps Assembly disabled; 43 focused tests and the complete 962-test deploy-contract suite prove dynamic addressing, SSH identity, isolated database, and deployment behavior. Repository integration, production deployment, and the physical drill remain open. This plan is not complete until changes are in `origin/main`, Pi5 runs the exact merged SHA, all five dynamic plans succeed in their real networks, and a preserved-old-SD blank-card drill reaches verified completion with recorded evidence.

## Context and Orientation

`scripts/deploy/recover-pi4.py` is the coordinator. `plan` currently resolves a secret-free inventory contract and Pi5's immutable release but assumes a predeclared target endpoint. Confirmed `run` acquires the shared Fleet Lock, resolves again, rejects a live old endpoint, provisions through `infrastructure/ansible/playbooks/recover-pi4.yml`, atomically writes the ignored mode-0600 runtime override `infrastructure/ansible/host_vars/<target>/recovery-runtime.yml`, and verifies with `infrastructure/ansible/playbooks/recover-pi4-verify.yml`.

`scripts/deploy/recovery/inventory.py` validates the Ansible-evaluated contract emitted by `infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml`. `scripts/deploy/recovery/network.py` owns pure LAN policy. The new SSH identity boundary belongs in `scripts/deploy/recovery/bootstrap.py`; it must not own Fleet State, filesystem endpoint persistence, inventory evaluation, or release selection. The coordinator composes these narrow components.

The dynamic endpoint remains stable only for one recovery run. The playbook must prove the reported address is still globally assigned before saving it. A later DHCP change is handled by another explicitly verified update or recovery, not by guessing or scanning the LAN.

## Plan of Work

Create immutable `BootstrapIdentity` and a `BootstrapIdentityVerifier` protocol with an OpenSSH implementation. Validate a conservative short hostname, collect exactly one ED25519 key with `ssh-keyscan`, calculate its standard `SHA256:` fingerprint with Python's standard library, write only the public key to a private temporary known-hosts file, and use strict host-key checking to read `id -un` and `hostname`. Reject missing or multiple keys, unexpected user or hostname, fingerprint changes, malformed output, and command failures without leaking command internals into public plan JSON.

Change the CLI to accept `--bootstrap-hostname` for both commands and `--bootstrap-host-key` for `run`. A successful plan exposes `bootstrapIdentity` containing only hostname, username, and fingerprint. `run` requires the reviewed fingerprint, obtains the Fleet Lock, re-resolves inventory, re-probes the endpoint, and verifies that fingerprint before beginning a Fleet run or writing an override. Keep `--target`, `--bootstrap-host`, `--reason`, and `--confirm-recovery` semantics otherwise compatible.

Advance the resolver contract to schema version 3. Remove `targetEndpoint`; LAN readiness consists of mode `lan`, a configured flag, and the evaluated Pi5 LAN server endpoint. Remove `pi4_recovery_lan_endpoint` from the five host entries because it falsely claims a stable recovery identity. The LAN provider accepts any literal RFC1918 IPv4 other than the Pi5 server address and rejects IPv6, loopback, link-local, public, multicast, and Tailscale carrier-grade-NAT addresses.

Pass the bootstrap IPv4 and a strict temporary SSH configuration to the recovery and verification playbooks. Remove their fixed-endpoint assertions. Require the bootstrap IPv4 to remain among global interface addresses at result time; otherwise fail before endpoint persistence. Preserve local mode and `tailscale_enabled: false`; do not restore SSH private keys, Tailscale state, or the old device identity.

Represent endpoint history explicitly. `current_endpoint` is the active runtime override when present, otherwise the resolved inventory endpoint; `original_endpoint` is the earliest recorded endpoint. Refuse a reachable different current endpoint. Refuse a previously recorded host key appearing at a different reported IP. At the same IP, reject an equal stored fingerprint as the already-known OS; allow a different key after all fresh identity checks, because the SD may have been replaced while DHCP reused the address. For a legacy override without a stored fingerprint, retain the explicit-confirmation and hostname/user proof while recording the new fingerprint for subsequent runs.

Write runtime metadata containing the earliest original endpoint, the immediately previous endpoint, reported hostname, pinned fingerprint, run ID, immutable release SHA, and timestamp. Never store the known-hosts file, an SSH private key, or a secret. Keep atomic replacement and mode 0600.

Update unit fakes and tests for dynamic addresses, identity probing, plan immutability, lock-time fingerprint drift, wrong hostname/user, missing or multiple keys, same-IP new-key recovery, same-key duplicate rejection, moved-old-OS rejection, endpoint history, Ansible key pinning, result-address drift, exact five-host eligibility, and Assembly/Talkplaza rejection. Update Runbook, ADR, and initial setup guide to describe the operator's actual three inputs and mark the old fixed-address plan superseded rather than erasing its history.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002` on `feat/pi4-sd-recovery-dynamic-bootstrap`. Use `apply_patch` for tracked edits. During implementation run:

    python3 -m unittest scripts/deploy/tests/test_recover_pi4.py -v
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml --syntax-check
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/recover-pi4.yml --syntax-check
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/recover-pi4-verify.yml --syntax-check
    git diff --check

For final validation, use repository pnpm 9.15.9 under Node 22.23.1 and run `scripts/ci/run-deploy-contracts-local.sh`. Record pre-existing Docker container, volume, and network IDs first. Use only the script's UUID-labelled temporary Postgres container, volume, network, and database; pull `pgvector/pgvector:pg15` only if needed. Apply every Prisma migration, run `prisma migrate status`, inspect `_prisma_migrations` with SQL, load the isolated fixture, and run `EXPLAIN (ANALYZE, BUFFERS)` plus related API/deploy-contract tests. On success, failure, or interruption, cleanup must report zero resources for the new UUID. Compare before/after IDs and do not modify or delete any pre-existing Docker resource or database.

Commit the bootstrap verifier, dynamic network/orchestration contract, tests, and documentation in reviewable intent units. Do not deploy to Pi5 or touch a physical SD card, production Vault, backup configuration, existing DB, or live endpoint during this implementation phase.

## Validation and Acceptance

A valid `plan` for an enabled terminal and reachable fresh OS must output the selected inventory target, reported current IPv4, verified immutable release, Pi5 LAN endpoint, `inventoryResolved: true`, and `bootstrapIdentity` with exact hostname, inventory username, and a `SHA256:` ED25519 fingerprint. It must leave Fleet State, recovery log, and runtime override byte-for-byte unchanged. Invalid inventory, address, hostname, user, key, or server readiness must fail before mutation.

A successful mocked `run` must re-evaluate the contract and SSH identity while holding the Fleet Lock, require the fingerprint approved from plan, pin that key across all SSH and Ansible connections, reject duplicate identity conditions, accept a truly new key even when DHCP reused the same address, prove the bootstrap IP remained assigned, save correct endpoint history in a mode-0600 override, verify services and immutable SHA, and close Fleet State as verified. A failure before result validation must not save a new endpoint and must close a begun run as unknown/failed.

The final physical proof remains a separate approved operation. Preserve the original SD, isolate the old OS, prepare a blank SD, report the replacement hostname and current IP, review plan fingerprint, and run recovery from Pi5. Within 60 minutes verify Ansible, SSH, kiosk browser, status timer, kiosk screen, NFC, optional barcode, Fleet State, endpoint metadata, absence of secrets, and exact deployed SHA. Repeat read-only plans for all five eligible terminals at their actual sites.

## Idempotence and Recovery

All keyscan and known-hosts artifacts live in a `TemporaryDirectory` and are removed on success and exceptions. `plan` performs network reads but no repository, Pi5 state, Pi4 state, database, or log writes. A failed `run` never persists an endpoint before identity and observed-address validation. Re-running `plan` is safe. Retrying `run` requires a new explicit confirmation after correcting the stated cause.

Runtime override writes remain atomic and mode 0600. Manual removal or editing is not an automatic rollback because it can reconnect normal Ansible to a stale endpoint; first identify the authoritative machine. No LAN discovery, hostname guessing, host-key auto-acceptance, old SSH/Tailscale identity restoration, or broad Docker cleanup is allowed.

## Artifacts and Notes

Starting repository evidence:

    branch: feat/pi4-sd-recovery-dynamic-bootstrap
    base:   426d959fea9f88ed0a95c32d492a7deabf030dc4
    main and origin/main at branch creation: equal
    worktree before branch creation: clean

Local intent commits:

    implementation: d31aa17cf282e5d26b295f9c2dff205778090073
    tests:          e4e93d740646298d048697ba278f584a54b5d270
    documentation:  488d69abb3e2394fa603e5447ae164bf391a7a36

Production evidence from the base implementation:

    Pi5 release run: 20260801-104535-399f1b
    Pi5 deployed SHA: 426d959fea9f88ed0a95c32d492a7deabf030dc4
    five read-only plans: passed under the old fixed-address contract
    Robodrill current LAN: 192.168.10.236, declared address matched
    FJV current LAN:       192.168.10.12, declared address matched
    raspberrypi4 current:  192.168.10.223, declared 192.168.10.224 was stale
    Sessaku current:       192.168.10.104, declared 192.168.128.187 was stale
    Stone: home during factory checks; live factory-LAN proof pending

Local validation evidence on 2026-08-01 JST:

    runtime: Node 22.23.1; pnpm 9.15.9
    recovery focus: 43 tests passed
    production resolver: schema v3; five enabled/configured; Assembly disabled
    Ansible: resolver/recovery/verify syntax; synthetic verify passed
    templates: 102 Ansible Jinja templates parsed
    deploy contracts: 962 Python tests passed
    PostgreSQL: 157 migrations applied; schema up to date
    SQL: Index Scan using "ClientDevice_apiKey_key"
    API: 20 deploy-status tests passed
    Docker test UUID: 0f13af3b-8077-4a9d-99c9-c945651d5e31
    Docker cleanup: container/volume/network removed; run resources=0

## Interfaces and Dependencies

In `scripts/deploy/recovery/bootstrap.py`, expose immutable identity data and a verifier protocol similar to:

    @dataclass(frozen=True)
    class BootstrapIdentity:
        hostname: str
        user: str
        ssh_host_key_fingerprint: str
        known_hosts_entry: str

    class BootstrapIdentityVerifier(Protocol):
        def verify(self, host: str, expected_user: str, expected_hostname: str,
                   expected_fingerprint: str | None = None) -> BootstrapIdentity: ...

The concrete verifier may expose a context-managed pinned connection object instead if implementation proves that lifetime ownership clearer, but only public identity fields may enter plan JSON. `RecoveryNetworkProvider` stays pure and receives a dynamic bootstrap address plus schema-v3 `RecoveryNetworkReadiness`. `RecoveryCoordinator` owns sequencing, Fleet Lock/state, duplicate checks, temporary key-pinning lifetime, playbook calls, endpoint persistence, and verification. No HTTP API, Prisma schema, migration, or application database interface changes are permitted.

Revision note (2026-08-01): Created after live factory evidence and user clarification established that the replacement SD's current IP may differ from the previous OS. This plan supersedes the fixed target endpoint decision in `pi4-sd-recovery-lan-provider-execplan.md` while retaining its external-service-free LAN design.

Revision note (2026-08-01, local completion): Recorded the schema-v3 dynamic endpoint implementation, pinned SSH identity, repeat-recovery guards, 43 focused tests, six production resolver checks, full isolated PostgreSQL/deploy-contract evidence, Docker cleanup, and three local intent commits. Publication and production gates remain open.
