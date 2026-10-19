# Move Pi4 SD-card recovery to the managed LAN

> Historical fixed-endpoint plan. Live factory checks on 2026-08-01 showed two
> healthy Pi4s at DHCP addresses different from these declarations. The merged
> LAN foundation remains useful, but its fixed-target decision is superseded by
> `pi4-sd-recovery-dynamic-bootstrap-execplan.md`. Do not use the fixed-address
> instructions for a physical recovery.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

An operator must be able to rebuild an explicitly enabled Pi4 after its SD card fails without creating a Tailscale account, storing Tailscale recovery credentials, or depending on a paid external service. After this change, the existing Pi5-only recovery commands use a predeclared private-LAN management address, rebuild the terminal with LAN-facing Pi5 URLs, observe that address on the rebuilt host, save a Pi5-local LAN runtime override, and verify the kiosk and device agents over ordinary OpenSSH. The feature remains fail-closed when the Pi5 has no route to the terminal LAN or when the observed address differs from the declared management address.

## Progress

- [x] (2026-08-01 JST) Synchronized clean `main` with `origin/main` at `a3dcdbf591b375835991e9bc7fe9388e773d36b7` and created `feat/pi4-sd-recovery-lan-provider`.
- [x] (2026-08-01 JST) Traced Inventory, group variables, NetworkManager behavior, recovery playbooks, runtime overrides, verification, unit tests, Runbook, ADR, and historical LAN reachability evidence before writing this plan.
- [x] (2026-08-01 JST) Added schema-v2 secret-free LAN recovery contracts for exactly five hosts and the injected `RecoveryNetworkProvider`/`LanRecoveryNetworkProvider` boundary.
- [x] (2026-08-01 JST) Converted recovery execution, observed result, mode-0600 runtime override, Pi5 URL derivation, and final verification from Tailscale to LAN.
- [x] (2026-08-01 JST) Removed the recovery-only OAuth role, Vault example fields, fake HTTP tests, and active documentation while preserving normal connected/static Tailscale behavior.
- [x] (2026-08-01 JST) Passed 37 focused recovery tests, three recovery Ansible syntax checks, five production-shaped controller-only resolutions, and the canonical Node 22.23.1/pnpm 9.15.9 deploy-contract suite.
- [x] (2026-08-01 JST) Committed implementation, tests, and documentation by intent; pushed `feat/pi4-sd-recovery-lan-provider`; and opened draft PR #1148.
- [ ] Pass required CI on PR #1148, merge, and synchronize local `main` before any production action.
- [ ] After separate production approval, deploy the merged SHA to Pi5, run five read-only plans, and perform the blank-SD physical drill only where Pi5-to-terminal LAN routing is proven.

## Surprises & Discoveries

- Observation: the repository already records a private LAN IPv4 for every enabled standard Pi4, but Ansible does not configure a static address and deliberately leaves existing NetworkManager connections unchanged.
  Evidence: `infrastructure/ansible/group_vars/all.yml` defines five `local_network` entries, while `infrastructure/ansible/roles/client/tasks/network.yml` says that existing Wi-Fi connection settings are not changed.
- Observation: changing only the SSH endpoint would leave the rebuilt terminal pointing at the Pi5 Tailscale API address.
  Evidence: `server_base_url`, `kiosk_url`, and agent URLs derive from `server_ip`, which derives from `current_network`; the global default is `network_mode: tailscale`.
- Observation: LAN reachability cannot be assumed for every installation site.
  Evidence: KB-315 records a real `No route to host` case between Pi5 and a new FJV Pi4, and the Sessaku LAN address is in `192.168.128.0/24` while Pi5's recorded LAN address is in `192.168.10.0/24`.
- Observation: a same-hardware SD replacement retains the Pi4 network-interface MAC address, so an existing DHCP reservation can continue assigning the declared LAN address.
  Evidence: the failure scope replaces the SD card, not the Pi4 board; the new contract therefore requires the operator-supplied bootstrap address to equal the inventory-declared management address instead of accepting an arbitrary temporary lease.
- Observation: `ansible-inventory --host` still returns nested Jinja text for a derived URL even when host-variable precedence has selected `network_mode: local`.
  Evidence: the raw result contained `https://{{ server_ip }}`, while an Ansible `debug` action evaluated the same fixture to `https://192.168.10.230`. The regression test therefore validates both raw precedence fields and the evaluated play result.
- Observation: the first complete deploy-contract attempt passed every Python, Docker/PostgreSQL, SQL, index, and API stage, then failed because the Ansible callback rendered a debug value as YAML instead of the JSON callback used by the focused run.
  Evidence: the expected and observed value were both `https://192.168.10.230`; changing the assertion to require the field and value independently made it callback-format-neutral, and the complete rerun passed.
- Observation: an older stopped test container, labelled volume, and labelled network already existed before this work and were not created or removed by this run. Docker Desktop also regenerated its built-in `bridge` network ID between the first pre/post snapshots.
  Evidence: the named resources with UUID `d57c85bc-02d3-44a7-8bda-e74a33afe89c` retained their container, volume, and network identities. Each new UUID reported `cleanup verified: run resources=0`; only Docker's unnamed built-in bridge changed from `57b0f751a767` to `498e4d3377e9`, outside the test script's named create/remove targets.

## Decision Log

- Decision: use a per-host `pi4_recovery_lan_endpoint` as the authoritative recovery address and require `--bootstrap-host` to match it.
  Rationale: persisting an arbitrary DHCP lease would make later Ansible runs unreliable. An explicit address lets the plan catch a missing or stale reservation before mutation.
  Date/Author: 2026-08-01 / User and Codex.
- Decision: save `ansible_host`, `network_mode: local`, and `tailscale_enabled: false` in the ignored Pi5-local runtime override for the recovered host.
  Rationale: these three values keep SSH and application/API traffic on LAN for only the recovered host without changing the entire fleet or tracked global defaults.
  Date/Author: 2026-08-01 / Codex.
- Decision: introduce a `RecoveryNetworkProvider` protocol with a LAN implementation instead of embedding LAN checks throughout the coordinator.
  Rationale: inventory resolution, network policy, orchestration, and command execution remain independently testable, and a future self-hosted network provider can be added without rewriting recovery state handling.
  Date/Author: 2026-08-01 / Codex.
- Decision: remove the recovery-only OAuth implementation and credentials while leaving the normal static/connected Tailscale path unchanged for terminals not converted by recovery.
  Rationale: the user selected LAN specifically to avoid a commercial external-account dependency. Dead OAuth code would create a misleading readiness path and secret-rotation burden.
  Date/Author: 2026-08-01 / User and Codex.
- Decision: retain Assembly, Talkplaza, Pi3, Pi5, and unrelated normal deployment behavior outside this recovery capability.
  Rationale: these systems have separate hardware or network acceptance requirements. This change continues to recognize only the five hosts with `pi4_recovery_enabled: true`.
  Date/Author: 2026-08-01 / Codex.

## Outcomes & Retrospective

Feature-branch implementation and local validation are complete, and draft PR #1148 is open. Five production inventory hosts resolve to `192.168.10.224`, `192.168.10.236`, `192.168.10.12`, `192.168.10.238`, and `192.168.128.187`, all with Pi5 service endpoint `192.168.10.230`, while Assembly resolves disabled and unconfigured. Recovery no longer has a Tailscale account, OAuth, auth-key, or recovery-secret dependency. The design does not create missing inter-site routing. Required CI/main integration, Pi5 deployment, and a physical drill remain separate gates; this plan cannot be marked complete until effective changes are in `origin/main` and the deployed Pi5 SHA and drill evidence are recorded.

## Context and Orientation

`scripts/deploy/recover-pi4.py` is the Pi5-only coordinator. `plan` reads configuration and the Pi5's verified immutable release without changing Fleet State, runtime overrides, or logs. Confirmed `run` obtains the shared Fleet Lock, resolves the contract again, refuses a still-live old endpoint, provisions a fresh OS through `infrastructure/ansible/playbooks/recover-pi4.yml`, writes an ignored runtime override under `infrastructure/ansible/host_vars/<target>/recovery-runtime.yml`, and runs `infrastructure/ansible/playbooks/recover-pi4-verify.yml`.

`infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml` is a controller-only play. It lets Ansible evaluate Jinja, Inventory, Vault, and runtime host variables, then writes a temporary secret-free JSON contract. `scripts/deploy/recovery/inventory.py` validates that contract. The new LAN contract replaces `tailscaleAuth` with `recoveryNetwork`, containing mode `lan`, a configured boolean, the target management IPv4, and the Pi5 LAN IPv4.

A runtime override is a local, ignored host-variable file read by Ansible on Pi5. It is not copied to Pi4 or committed. Host variables take precedence over group defaults, so setting `network_mode: local` changes the recovered host's derived Pi5 URLs, while `tailscale_enabled: false` stops full provisioning from installing or authenticating Tailscale for that host.

The declared LAN address must be stable. For the intended same-board SD replacement, preserve or create a router DHCP reservation for the Pi4 MAC address. A replacement Pi4 board has a different MAC address and is outside automatic acceptance until the reservation and inventory contract are deliberately updated. `run` proves reachability through SSH and proves the declared address is actually assigned to a global-scope IPv4 interface before saving it.

## Plan of Work

First add `pi4_recovery_lan_endpoint` to the five enabled host entries in `infrastructure/ansible/inventory.yml`, each referencing its existing `local_network` value. Do not add it to `raspi4-assembly-01`. Change the resolver play to emit schema version 2 and a `recoveryNetwork` object. Change `scripts/deploy/recovery/inventory.py` to parse that object with strict required fields and no OAuth types.

Create `scripts/deploy/recovery/network.py`. Define a `RecoveryNetworkProvider` protocol whose LAN implementation validates the resolved network contract, validates that the CLI bootstrap IPv4 is private, is not in Tailscale's carrier-grade NAT range, and exactly equals the declared target endpoint, validates the structured Ansible result, and produces the non-secret runtime host variables. Inject this provider into `RecoveryCoordinator`; keep filesystem, Fleet State, subprocess, and resolver adapters separate.

Change `infrastructure/ansible/playbooks/recover-pi4.yml` so it explicitly runs with local network mode and Tailscale disabled. Remove OAuth variables and Tailscale status tasks. After provisioning, execute an address-observation command on Pi4, extract global IPv4 addresses, require that `ansible_host` is among them, and write `lanIpv4` plus target and release SHA to the controller result. The coordinator validates this result before atomically saving a mode-0600 runtime override containing `ansible_host`, `network_mode: local`, `tailscale_enabled: false`, and recovery metadata including the original endpoint.

Remove `infrastructure/ansible/roles/tailscale_recovery_auth`, its isolated fixture and Python HTTP-server test, and the two recovery OAuth variables from the Vault example. Simplify `infrastructure/ansible/roles/common/tasks/tailscale.yml` back to the normal connected-or-static-key path without changing its behavior for existing Tailscale-enabled hosts. Update the ADR, Runbook, initial setup guide, historical plans, and navigation references so no operator is told to create recovery OAuth credentials. Preserve historical facts by marking the previous OAuth readiness plan superseded rather than pretending that work never happened.

Update `scripts/deploy/tests/test_recover_pi4.py` and its fixtures. Tests must cover schema parsing, templated LAN evaluation, all five enabled hosts, missing or mismatched LAN addresses, public/loopback/link-local/Tailscale addresses, disabled Assembly, Talkplaza/non-kiosk targets, multiple servers, plan immutability, lock-time re-resolution, observed-address mismatch, LAN runtime precedence, failure-state closure, and final verification. Add textual contract assertions showing the recovery play disables Tailscale and observes a LAN address instead of echoing an unchecked value.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002` on `feat/pi4-sd-recovery-lan-provider`. Use `apply_patch` for tracked edits. During implementation run:

    python3 -m unittest scripts/deploy/tests/test_recover_pi4.py -v
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml --syntax-check
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/recover-pi4.yml --syntax-check
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/recover-pi4-verify.yml --syntax-check
    git diff --check

For final validation, use Node 22 and repository pnpm 9.15.9, then run `scripts/ci/run-deploy-contracts-local.sh`. Before the Docker stage, record all existing container, volume, and network IDs. The script may pull `pgvector/pgvector:pg15` and must use only its UUID-labelled temporary container, volume, network, and database. Expect every Prisma migration to apply to that temporary database, `prisma migrate status` and `_prisma_migrations` SQL checks to pass, `EXPLAIN (ANALYZE, BUFFERS)` to show the deploy-status index, related API tests to pass, and cleanup to report zero run resources. Compare pre- and post-run Docker IDs and do not alter any pre-existing resource.

Commit LAN contract/provider, recovery orchestration, tests, and documentation as separate intent commits. Publishing a branch, opening a draft PR, merging, or deploying is not completion by itself. Required CI must pass; after merge, local clean `main` must match `origin/main`. Production deployment and hardware work require separate approval and recorded SHA evidence.

## Validation and Acceptance

The resolver fixture must evaluate Jinja to literal private IPv4 addresses and serialize no status/NFC/kiosk secrets. A public plan for a valid target must contain `inventoryResolved: true` and `recoveryNetwork` with mode `lan`, configured true, and the declared target and Pi5 LAN endpoints. The same command must fail before reading Fleet State when the LAN contract is missing, invalid, or different from `--bootstrap-host`. `plan` must leave Fleet State, runtime overrides, and recovery logs byte-for-byte unchanged.

A mocked successful `run` must re-resolve inside the Fleet Lock, pass `network_mode=local` and `tailscale_enabled=false` to Ansible, accept only a result whose observed `lanIpv4` equals the declared endpoint, save a mode-0600 runtime override, verify standard SSH/Ansible/services and the immutable SHA through that LAN endpoint, and close Fleet State as verified. Every failure before result validation must leave no new endpoint override and close the host as unknown/failed after a run has begun.

The physical drill remains the final behavior proof. On Pi5, run `plan` for all five enabled hosts. A plan may be ready even when a powered-off terminal is unreachable, but the drill must not start until routing from Pi5 to both the target management address and the recorded Pi5 LAN service address is proven. Recover `raspberrypi4` first using a preserved original SD and a blank replacement SD. From Imager completion, reach `phase: completed` within 60 minutes, then verify OpenSSH, Ansible ping, kiosk, status timer, kiosk URL, NFC read, and optional barcode. Record the Pi5 deployed SHA, Fleet run ID, elapsed time, and network evidence.

## Idempotence and Recovery

The resolver writes only into a private temporary directory and removes it on success or failure. `plan` is read-only. A failed `run` never writes a new runtime endpoint before observed-address validation. Runtime override replacement is atomic and retains the original endpoint for duplicate-device safety. Retrying requires a new run ID after correcting the reported route, DHCP reservation, SSH, or provisioning failure.

Deleting the ignored runtime override is a manual rollback that must only be done after confirming which endpoint is authoritative; otherwise normal Ansible may reconnect through the old Tailscale inventory address. No implementation or test step edits a production Vault, live `backup.json`, existing database, existing Docker resource, Fleet State on Pi5, or physical SD card.

## Artifacts and Notes

The starting evidence is:

    branch: feat/pi4-sd-recovery-lan-provider
    base:   a3dcdbf591b375835991e9bc7fe9388e773d36b7
    worktree at branch creation: clean

Repository publication evidence is:

    implementation: bcc474a8471c43b7a95507546f0d5044405b8eb3
    tests:          b46d527e808cc7c5fc7f31fbc50886ab75f94fd0
    documentation:  9b1784e5dc5fea2a0f71c05a08ff6416588562e0
    draft PR:       https://github.com/denkoushi/RaspberryPiSystem_002/pull/1148
    base at open:   a3dcdbf591b375835991e9bc7fe9388e773d36b7

The known LAN contract candidates are `192.168.10.224`, `192.168.10.236`, `192.168.10.12`, `192.168.10.238`, and `192.168.128.187`; the Pi5 LAN service candidate is `192.168.10.230`. These are configuration inputs, not proof of current routing or DHCP reservation.

Local validation evidence on 2026-08-01 JST is:

    focused recovery: 37 tests passed
    production resolver: five enabled hosts configured=true; Assembly configured=false
    template parser: 102 Ansible Jinja templates parsed
    deploy contracts: 956 Python tests passed
    PostgreSQL: 157 migrations applied; schema up to date
    SQL plan: Index Scan using "ClientDevice_apiKey_key"
    API: 20 deploy-status tests passed
    Ansible: resolver/recovery/verify syntax and synthetic verify check passed
    Docker: each run printed cleanup verified: run resources=0

## Interfaces and Dependencies

In `scripts/deploy/recovery/inventory.py`, expose immutable `RecoveryNetworkReadiness` and include it in `ResolvedRecoveryContract`. In `scripts/deploy/recovery/network.py`, define:

    class RecoveryNetworkProvider(Protocol):
        def validate_contract(self, contract: ResolvedRecoveryContract) -> None: ...
        def validate_bootstrap(self, bootstrap_host: str, contract: ResolvedRecoveryContract) -> str: ...
        def read_result(self, payload: object, plan: RecoveryPlanView) -> str: ...
        def runtime_host_vars(self, endpoint: str) -> dict[str, object]: ...

The exact plan-view type may be narrowed during implementation to avoid an import cycle, but the provider must not read files, execute commands, or mutate Fleet State. `RecoveryCoordinator` owns orchestration and injects the provider. `AnsibleRecoveryInventoryResolver` remains the sole evaluator of Inventory/Jinja/Vault precedence. No HTTP API, Prisma schema, migration, or application database interface changes are permitted.

Revision note (2026-08-01): Created after the user selected LAN recovery and after detailed inspection showed that endpoint, application URL, and Tailscale enablement must be switched together. This plan supersedes the un-deployed OAuth production setup while retaining its useful Ansible inventory resolver.

Revision note (2026-08-01, implementation): Recorded the completed LAN provider implementation, OAuth removal, five-host resolution evidence, callback-format discovery, isolated PostgreSQL/index/API results, Docker cleanup evidence, and the still-open repository/production integration gates.

Revision note (2026-08-01, publication): Recorded the three intent commits and draft PR #1148 without claiming CI, merge, production deployment, or physical-drill completion.
