---
id: deployment-foundation-refactor-program
title: Refactor the deployment foundation through eight gated pull requests
status: in-progress
scope: Migration safety, GitHub Actions, release coordination, fleet state, Pi5 Blue/Green, terminal rollout, health verification, rollback, and deployment documentation
date: 2026-07-15
source_of_truth: docs/plans/deployment-foundation-refactor-execplan.md
related_code:
  - scripts/update-all-clients.sh
  - scripts/deploy/rolling-release.py
  - scripts/deploy/pi5-blue-green.sh
  - scripts/deploy/pi5-image-deploy.sh
  - scripts/deploy/pi5-candidate-build.sh
  - scripts/deploy/deploy-status-state.py
  - scripts/deploy/classify-deploy-impact.py
  - scripts/deploy/validate-expand-only-migrations.py
  - infrastructure/ansible/inventory.yml
  - infrastructure/ansible/inventory-talkplaza.yml
  - infrastructure/ansible/playbooks/deploy-staged.yml
  - infrastructure/ansible/tasks/rollback-configs.yml
  - apps/api/src/routes/system/deploy-status.ts
  - .github/workflows/ci.yml
  - .github/workflows/codeql.yml
  - .github/workflows/gitleaks.yml
related_docs:
  - ./rolling-terminal-bluegreen-deploy.md
  - ./pi5-blue-green-phase3.md
  - ../decisions/ADR-20260712-rolling-terminal-release-orchestration.md
  - ../decisions/ADR-20260712-deploy-target-minimization-canary-hold.md
  - ../guides/deployment.md
  - ../runbooks/pi5-blue-green-deploy.md
validation:
  - isolated unit, shell, inventory, Ansible, API, and fault-injection tests
  - hosted GitHub Actions with one stable ci-required aggregate check
  - read-only plans for both production inventories before any approved release
  - one explicitly approved full-fleet acceptance per inventory, followed by a same-SHA no-op plan
open_items:
  - validate and merge Draft PR 1030 from exact origin/main 79ab05f8
  - retain the closed PR 1003 source branch until PR 1030 is merged
  - complete or explicitly evaluate the seven-day CI observation window
supersedes:
  - ./rolling-terminal-bluegreen-deploy.md
  - ../decisions/ADR-20260712-deploy-target-minimization-canary-hold.md
superseded_by: null
---

# Refactor the deployment foundation through eight gated pull requests

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be updated whenever work stops, a pull request changes state, or production evidence changes. Maintain this document in accordance with `.agent/PLANS.md` from the repository root.

The previously accepted behavior and its production evidence remain preserved through `docs/plans/rolling-terminal-bluegreen-deploy.md` and its linked archive. This document is the sole active source of truth for the refactor program and supersedes that prior behavior now that production acceptance has completed and PR 8 has begun compatibility removal.

The program baseline is immutable commit `38e72080969631ababc7c595ef67daca067d327f` on `origin/main`. Each implementation pull request starts from the latest merged `origin/main`, not from Draft PR #1003 and not from another unmerged implementation branch.

## Purpose / Big Picture

After this program, an operator will still use `scripts/update-all-clients.sh`, but the command will have one coordinator, one durable release record, one rollback owner, and a small documented option set. A read-only plan will explain why each host is included or excluded. Unknown or unverifiable hosts will be included rather than silently skipped. The Pi5 server will complete its immutable image, configuration, and migration checks before kiosks and signage update one at a time. A release will not remove maintenance mode until the device proves that it is ready at the requested release SHA.

The change is observable without touching production. Pull requests will exercise migration history, locking before checkout, cancellation, inventory-to-playbook consistency, rollback manifests, Blue/Green state, terminal acknowledgements, and CI path classification in isolated tests. `--print-plan` will be read-only and will show target reasons. Production proof comes later, only after hosted CI and read-only plans pass and the user explicitly approves each inventory. The first accepted production run uses `--full-fleet`; a second plan for the same SHA must be a no-op.

This work exists because the current release path has accumulated two coordinators, options with ambiguous behavior, checkout-before-lock races, duplicated health/load decisions, and CI work that runs twice or runs unrelated jobs. The intended outcome is faster feedback and a simpler recovery model without weakening the five-minute Pi5 stability observation, the sixty-second terminal notification, Expand-only database policy, or serial terminal rollout.

## Progress

- [x] (2026-07-14 21:31Z) Recorded the user-approved eight-PR sequence, production freeze, public interfaces, acceptance gates, and PR #1003 supersession policy in this ExecPlan.
- [x] (2026-07-14 21:31Z) Established `origin/main` commit `38e72080969631ababc7c595ef67daca067d327f` as the initial baseline and confirmed that the remote has no `develop` branch.
- [x] (2026-07-14 21:31Z) Published PR 1 as Draft PR #1004, `fix(deploy): restore migration ledger safety`, from `agent/deploy-migration-ledger`; it initially contained four intentionally scoped commits and now has one additional independent-review hardening commit.
- [x] (2026-07-14 22:19Z) Completed PR 1 hosted validation at Draft PR #1004; the infrastructure-only Trivy rerun passed and every check is green.
- [x] (2026-07-14 22:19Z) Published PR 2 as Draft PR #1005 from `agent/ci-deploy-contract-shadow`; head `efa93df4` adds the client-lifecycle baseline and merge-base diff contract, and the branch push still produces no duplicate push-event workflow run.
- [x] (2026-07-14 22:19Z) Completed PR 2 hosted validation; the latest `ci-required`, `codeql`, `gitleaks`, and all constituent checks are green.
- [x] (2026-07-14 22:32Z) Completed PR 3 publication and validation at Draft PR #1006; three focused inventory, exact-set rollback, and pre-checkout `flock` commits are published at head `e33ecadb`, and local, Ansible, isolated Linux, and every hosted check passes.
- [x] (2026-07-14 23:10Z) Hardened PR 1 at head `d755a679`: the gate now validates the candidate-wide commit-object ledger, permits only A-status migration changes, uses quote-aware SQL parsing plus a built-in type allow-list, passes 22 focused tests and two independent reviews with no P1/P2 blocker, and has a green 11-of-11 hosted rerun with zero failures or skips.
- [x] (2026-07-14 23:27Z) Merged the living ExecPlan PR #1007 with merge commit `3ea5d442` after 11 of 11 checks passed; the docs-only run took 8m23s wall time and about 39m46s of summed reported check time.
- [x] (2026-07-14 23:36Z) Refreshed PR 1 from that main, reran 11 of 11 checks successfully at head `83fbb379`, and merged PR #1004 with merge commit `d9abaa6e` under the user's explicit ordered-merge approval.
- [x] (2026-07-14 23:55Z) Refreshed PR 2 from merge commit `d9abaa6e`, reran every hosted check successfully at head `50e3eeaa` with no feature-branch push duplicate, and merged PR #1005 with merge commit `bf238688`.
- [x] (2026-07-15 00:04Z) Refreshed PR 3 from that main and hardened the successful outer-lock path at `f3d39012`: the transitional lock parent is created only after the kernel lock, and a Linux regression now exercises a fresh checkout with no pre-existing `logs` directory.
- [x] (2026-07-15 00:23Z) Diagnosed the refreshed PR 3 hosted failure as npm's retired legacy audit endpoint returning HTTP 410 to pnpm 9; every deployment, Linux lock, inventory, Ansible, API, E2E, CodeQL, gitleaks, Docker, and non-audit check passed. With explicit approval, replaced only the audit client with pinned pnpm 11.4 on Node 22 so the required critical gate uses the bulk advisory endpoint without `--ignore-registry-errors`.
- [x] (2026-07-15 00:40Z) Reran PR 3 at exact head `f98aebf2`; hosted run `29379111287` passed every deployment, Linux lock, inventory, Ansible, API, E2E, CodeQL, gitleaks, audit, and Docker check, then PR #1006 merged as `0b24be7f` under the user's ordered approval.
- [x] (2026-07-15 02:14Z) Implemented PR 4 locally from merged `origin/main`: one strict shell wrapper, one package coordinator, transient-systemd foreground/detach/control lifecycle, atomic per-run state/control, cooperative cancellation, legacy run-status read compatibility, and refusal stubs for four alternate deployment entrances. The complete deploy Python suite passes 222 tests; the single-entrypoint and Ansible safety contracts also pass, and three independent reviews report no remaining Blocker/P1/P2.
- [x] (2026-07-15 03:57Z) Published PR 4 as Draft PR #1008 at exact head `c22da822`, completed the hosted suite with 12 successes and one neutral auxiliary CodeQL skip, then merged it under explicit approval as `ccdc624a`. No real-device action occurred.
- [x] (2026-07-15 04:22Z) Implemented and independently hardened PR 5 locally from merged `ccdc624a`: strict generation-checked fleet state, pre-checkout fleet lock plus compatibility lock, live-evidence seeding, default host-specific minimization, `--full-fleet`, a warning-only temporary minimization alias, new-state-first dual writes, and Pi4 recovery on the same state/lock. Review corrections make service probes independent, prohibit `--limit` from excluding unknown evidence, restrict legacy-marker fallback to genuinely pre-fleet state, bind Pi5 source digests to the matching checkout release, classify both sides of renames, and require the fleet-capable v2 bootstrap protocol. The deploy Python suite passes 295 tests and all isolated deployment shell contracts pass.
- [x] (2026-07-15 06:03Z) Closed the final PR 5 review findings before publication: launch and plan require the exact resolved target checkout, a non-secret inventory `status_agent_client_id` binds every Pi5 operation to the intended site before state or Git mutation, an active run makes a read-only plan conservatively report the entire inventory as unknown, and deploy-status now has one Python writer protected by a crash-safe kernel lock. Pi4 recovery is an explicit per-host capability for the five standard Tailscale kiosks and remains unavailable at Talkplaza. The final local evidence is 321/321 deploy tests, 16/16 shell contracts plus lifecycle and maintenance checks, 10/10 isolated PostgreSQL API tests, API lint/type checks, and two final reviews with no P1/P2.
- [x] (2026-07-15 06:25Z) Published PR 5 as Draft PR #1009 at implementation head `23c5f763`, based exactly on merged PR 4 commit `ccdc624a`; #1003 remains open, draft, and untouched at `0f19936a`.
- [x] (2026-07-15 06:29Z) Diagnosed the first hosted `lint-build-unit` failure: Actions checked out its PR merge SHA but a legacy smoke invoked `--print-plan` for `main` and the production inventory, so the new exact-checkout guard correctly rejected it. Removed that unsafe live-inventory workflow call rather than pointing it at `HEAD`, and added a static contract that hosted workflows never invoke the public deploy entrypoint against either production inventory. The fixture/unit plan coverage and local single-entrypoint contract pass.
- [x] (2026-07-15 06:52Z) Completed refreshed hosted validation for PR #1009 and merged it under explicit approval as `deab7d5e`; its final implementation head is `5441065e`. No real-device action occurred.
- [x] (2026-07-15 07:32Z) Started PR 6 locally from exact merged base `deab7d5e` on `agent/deploy-executor-health-rollback`. Two independently reviewed commits replace the shadow client lifecycle with build/recreate/no-build selection and bind ready acknowledgements to an immutable full release SHA. A third, uncommitted Pi5 host-configuration slice passes 325 deploy tests but is not accepted: fresh review found one P1 and two P2 issues around genre-image preservation, post-switch environment evidence, and contract-test coverage.
- [x] (2026-07-15 09:15Z) Corrected, independently reviewed, and committed the Pi5 host-configuration slice as `b1c98f32`. Host-only convergence now rescues stopped-container genre images through a traversal-safe, non-overwriting archive merge; the actual server play execution graph is covered by a multiline-aware AST safety contract; candidate and final evidence require the exact image-default-plus-Compose API environment including unset semantics; and active-run-bound expired prior-release cleanup alone uses structural health so an intentional config change cannot block candidate creation. The deploy Python suite passes 344 tests, the Blue/Green lifecycle and Ansible safety contracts pass, focused archive tests pass 9/9, and two post-fix reviews report no remaining P1/P2.
- [x] (2026-07-15 10:16Z) Committed the independently reviewed terminal readiness and health slice as `6e9ad694`. Kiosk bundles and signage HEADs must answer an opaque per-verification challenge at the exact release SHA; a fresh rollback cycle invalidates delayed forward ACKs even when the Kiosk Web SHA is unchanged. Terminal evidence now requires exact HEAD, authenticated status identity, successful status-agent oneshot, lightdm, browser/signage services, and every operational timer before maintenance is removed. HTTP 401 and the old `failed_when: false` signage success path are rejected. Local evidence is 363/363 deploy Python tests, 283 Web files and 1,430 tests, 20/20 isolated PostgreSQL deploy-status tests, type/lint checks, and the deployment, image, signage, and lifecycle shell contracts. Review found no remaining P1/P2 inside this slice; the known manifest-only rollback P1 still blocks publication.
- [x] (2026-07-15 14:22Z) Completed PR 6 locally at implementation commit `1af8f1ab`. Terminal changes now use one sealed file/repository/runtime manifest and coordinator-owned rollback; Pi5 uses one migration plan/live-ledger verifier, one candidate/Blue-Green executor, run-scoped image identities, reusable load evidence, durable hard-kill recovery, and a bounded host-config transaction. The final local evidence is 540/540 deploy Python tests, all three Pi5 shell lifecycles, terminal lifecycle and signage-maintenance contracts, 41/41 focused API tests, API lint/build, both-inventory server-config syntax checks, and the deployment safety contract.
- [x] (2026-07-15 20:20Z) Published the explicitly approved branch as Draft PR #1010, `refactor(deploy): unify Pi5 and terminal execution`, from clean local head `be1634a8`; CI, CodeQL, and gitleaks started without any SSH or real-device action.
- [x] (2026-07-15 20:32Z) Completed Draft PR #1010 hosted validation at head `f86e51fc`: CI run `29448017438`, CodeQL `29448017389`, and Secret scan `29448017406` all succeeded. `ci-required`, fixed-name `codeql`, `gitleaks`, three API shards, lint/build, E2E, and both Docker jobs are green; only the intentionally neutral auxiliary `CodeQL` aggregator is non-success.
- [x] (2026-07-15 20:42Z) Revalidated PR #1010 at final head `f29ec691`, marked it ready, and merged it as `0efcbb34`; merge-commit CI `29449339822`, CodeQL `29449339819`, Secret scan `29449339758`, and Pages `29449338992` all completed successfully. No SSH, database mutation, or real-device action occurred.
- [x] (2026-07-15 21:54Z) Completed PR 7 from exact merged base `0efcbb34`: classifier enforcement, ten conditional jobs, strict `ci-required`, full-suite events, fixed security triggers, and active ruleset `19014580` passed hosted validation and merged as `aad3defd` in PR #1011.
- [x] (2026-07-16 02:09Z) Merged rollback Compose-context correction PR #1020 as `31ef395a`; its PR checks and main CI `29465507084`, CodeQL `29465507088`, Secret scan `29465507086`, and Pages `29465506530` succeeded.
- [x] (2026-07-16 03:44Z) Recovered the root-owned StoneBase checkout boundary through PR #1021, merged as `e1584e3d` after green PR and exact-main hosted checks. Run `20260716-034454-3c4881` then proved the sealed file, repository, systemd, and Docker restore succeeds; it stopped safely with maintenance retained because the interrupted-run Kiosk ready challenge incorrectly requested the terminal repository SHA instead of the live Pi5 Web SHA.
- [x] (2026-07-16 04:10Z) Merged the interrupted-Kiosk ready-identity correction through PR #1022 as `d82e1d24` after green PR and exact-main CI, CodeQL, gitleaks, and Pages checks. The approved full-fleet retry `20260716-041146-930ac2` stopped before new Pi5 or terminal mutation: replaying the sealed file manifest changed systemd unit bytes, but the durable runtime-restored receipt made the runtime restore verify-only, so it rejected the resulting `NeedDaemonReload=yes` state instead of reconciling it.
- [x] (2026-07-16 05:29Z) Completed and merged PR #1023 as `06fb53ed` after all fixed PR checks and exact-main checks passed; one unrelated API random-code collision in main CI passed on a single failed-job rerun without a deployment code change. Approved run `20260716-052933-fff467` then proved aggregate interrupted recovery and repeated runtime reconciliation on StoneBase, completed Pi5 build/switch/five-minute stability, and verified all five Pi4 kiosks at the requested SHA.
- [x] (2026-07-16 09:07Z) Merged the fourth isolated Pi3 recovery correction as PR #1028 at `0d92d19c`; exact-main full CI, CodeQL, and gitleaks passed. Production was not retried after the preceding approved attempt failed.
- [ ] (2026-07-16 09:53Z) Replace isolated Pi3 retry discovery with one exhaustive rehearsal before any further production run. Local rehearsal is complete: corrected fleet-wide pre-emptive `unknown` contamination; constrained durable Pi4 carry-forward to the exact finalization, cleanup, manifest checksum, and tag-count proof; restored each completed Pi4 with its verified host SHA rather than manufacturing a stale desired release; classified the coordinator itself as non-runtime deploy control; and proved the actual Pi4/Pi5 baseline excludes both roles while targeting signage. The full eleven-unit Pi3 runtime survives thirty-six before/after mutation failures, and all seventeen forward/rollback phase failures recover before another plan. All 572 deploy Python tests, shell safety/lifecycle contracts, CI classifiers, both inventories, and every deployment playbook pass. Read-only live audit found clean Pi3 HEAD `0a2402a8`, no residual jobs or daemon reload, all required services/timers healthy, 118 MB available memory, and approximately 49 GB available disk; all five completed Pi4 records satisfy the strict carry-forward proof. Remaining: PR publication and hosted validation only. No production retry started.
- [x] (2026-07-16) Completed the explicitly approved second-factory production acceptance at exact main `79ab05f8`: Pi5, all five Pi4 kiosks, and Pi3 signage finished verified, no maintenance remained, and the same-SHA standard plan was a no-op. TalkPlaza Pi5 has no physical device and was not deployed.
- [x] (2026-07-16) Reconstructed the deferred product changes as three independent merged pull requests: shared UI extraction #1013, assembly schema/API/editor #1014, and deploy-notice placement #1015. The mixed source commit was not cherry-picked.
- [x] (2026-07-18 12:11Z) Closed the local normal-release prerequisite gap exposed by run `20260718-114117-fa74e2`. Pi5 remains verified at `99108892`; StoneBase is clean at `3e52d7bb`. The implementation now runs one secret-free aggregate terminal preflight before transient release-unit submission, uses the `pcscd.socket` operational contract, and exposes `--preflight-only`. Focused 53 tests, the complete 643-test deploy suite, static safety contracts, zero-warning workspace lint, Ansible syntax, document audit, and diff checks pass.
- [ ] Publish the aggregate-preflight correction, require hosted `ci-required`, `codeql`, and `gitleaks`, then run only the read-only real Pi5 plus StoneBase `--preflight-only` scope. Do not retry product deployment in this step.
- [x] Made stacked-branch manual Secret scan deterministic locally. The first `workflow_dispatch` at `f67897b9` scanned all 4,623 historical commits and rediscovered five pre-existing findings while all 15 CI jobs and CodeQL succeeded. The corrected workflow retains event-native behavior for PR/push/schedule and uses pinned gitleaks 8.24.3 over cumulative `origin/main..HEAD` for manual runs. Twenty-two workflow tests and an isolated container scan of all 136 cumulative branch commits pass with zero findings; the temporary clone and image were removed.
- [ ] Publish the Secret scan range correction and require fresh `ci-required`, `codeql`, and `gitleaks` success at the new exact head before real preflight-only evidence.
- [x] (2026-07-16) Implemented PR 8 locally from exact `origin/main` `79ab05f8`: removed the old Pi5 marker, pre-fleet lock, old run-format reads, pre-unified terminal finalization fallback, and temporary minimization alias; retained only fleet state/lock, locked current run records, transient systemd units, and the documented CLI. Archived historical evidence and replaced the 5,717-line guide with a 134-line current operator guide. Local evidence is 571 deploy Python tests, every Pi5/terminal shell contract, 20 CI-classifier tests, 20 isolated PostgreSQL deploy-status tests, both inventories, all deployment playbook syntax checks, current document inventory, zero new archive link failures, and a clean diff check.
- [x] (2026-07-16) Published PR 8 as Draft #1030 from implementation head `b1aea44d`, based exactly on `79ab05f8`. Added the complete replacement map to Draft #1003 and closed it unmerged as superseded; its source branch remains retained until #1030 merges.
- [ ] Complete Draft PR #1030 hosted `ci-required`, `codeql`, and `gitleaks`, then merge under explicit approval.
- [x] (2026-07-17) Implemented the post-acceptance image-cache correction from exact `origin/main` `3e669702`: API and Web release provenance now follows every final-stage filesystem instruction, while the Web bundle still consumes its exact release SHA. Static ordering checks, 619 deploy tests, the Pi5 image and Blue/Green lifecycles, single-entrypoint and deploy-safety contracts, and 21 CI tests pass. Local arm64 two-build evidence proves both API and Web retain identical `RootFS.Layers` when only the release SHA and configuration hash change; the second API build cached OCR, production dependencies, and Playwright completely. Trivy 0.68.1 with its 2026-07-17 vulnerability database reports zero unignored fixed HIGH/CRITICAL findings for both final images.
- [x] (2026-07-17) Published the cache-boundary implementation as Draft PR #1037 from exact head `1562d3f6`, based on `origin/main` `3e669702`. CI, CodeQL, and gitleaks started without SSH, production deployment, or real-device mutation.
- [x] (2026-07-17) Completed hosted validation for Draft PR #1037 at head `48458edc`: CI run `29557294394`, CodeQL `29557294342`, and gitleaks `29557294378` succeeded. The API and Web Docker jobs passed the new provenance-only rebuild, exact-label, RootFS-identity, and Trivy checks in 8m25s and 40s respectively; fixed required checks `ci-required`, `codeql`, and `gitleaks` are green.
- [ ] Merge PR #1037 after the validation-record commit passes the same required checks, then use the standard read-only plan and explicitly approved rollout to collect first-build warm-up and next-release warm-cache timing evidence. No production action occurred during implementation or hosted validation.

## Surprises & Discoveries

- Observation: `origin/main` is currently `38e72080`, while the mixed Draft PR #1003 contains both deployment and product work. The safe base is therefore `origin/main`, with only named behavior reconstructed or selected commits transplanted.
  Evidence: `git log -1 origin/main` reports `38e72080`; `git show -s` identifies the requested source commits individually.
- Observation: there is no remote `develop` branch even though all three current workflows name it.
  Evidence: `git ls-remote --heads origin develop` returns no ref, while `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, and `.github/workflows/gitleaks.yml` include `develop` triggers.
- Observation: the requested client lifecycle test does not exist on `origin/main`; its behavior first appears in the later client-lifecycle source changes intended for PR 6.
  Evidence: `rg --files scripts infrastructure apps | rg 'client-agent-lifecycle'` returns no path on the baseline, while commits `85fe6198` and `1f64d5b4` contain the later behavior to reconstruct.
- Observation: the public shell entry point contains a hidden legacy coordinator behind `ROLLING_RELEASE_V2`, so two implementations and two option interpretations coexist.
  Evidence: `scripts/update-all-clients.sh` executes `scripts/deploy/rolling-release.py` only when `ROLLING_RELEASE_V2` is `1`, then retains more than two thousand lines of legacy shell behavior.
- Observation: four additional executable paths can bypass coordinator policy, locking, and rollback ownership; one legacy dry-run path can even evaluate an operator-supplied rollback command.
  Evidence: pre-PR-4 `scripts/server/deploy.sh`, `scripts/server/deploy-detached.sh`, `scripts/deploy/deploy-executor.sh`, and `scripts/deploy/deploy-all.sh` contain direct Git, Docker, systemd/nohup, Ansible, and `ROLLBACK_CMD` execution outside the public coordinator.
- Observation: HEAD equality alone does not prove that the remote runner bytes belong to the immutable release because Git can retain dirty tracked files or untracked package shadows across a same-SHA checkout.
  Evidence: an isolated real Git fixture kept a modified `scripts/deploy/rolling-release.py` while `rev-parse HEAD` still matched; PR 4 now refuses dirty state both before fetch and after checkout.
- Observation: the current remote command fetches and checks out the target SHA before the remote Python coordinator owns its release lock.
  Evidence: `scripts/deploy/rolling-release.py` builds a remote command containing `git fetch` and `git checkout --detach` before `--remote-run`; the remote-run lock is acquired afterward.
- Observation: Talkplaza places terminals directly under `clients.hosts`, but the staged playbook targets the `kiosk` and `signage` groups.
  Evidence: `infrastructure/ansible/inventory-talkplaza.yml` and the `hosts: kiosk` / `hosts: signage` plays in `infrastructure/ansible/playbooks/deploy-staged.yml` do not currently share a canonical group hierarchy.
- Observation: the service rollback destination removes only a trailing numeric suffix, not the actual `YYYYMMDD_HHMMSS` backup suffix, and it iterates every matching backup.
  Evidence: `infrastructure/ansible/tasks/rollback-configs.yml` uses `regex_replace('\\.[0-9]+$', '')` over every `*.service.*` file sorted by modification time.
- Observation: PR 1 can restore migration safety without importing the unrelated recovery, load-gate, lifecycle, and product behavior in `c5d8a4da`.
  Evidence: Draft PR #1004 contains selected source behavior as commits `e1e4f29b`, `b9b6c7d1`, `4b57a494`, and the focused no-new-migration implementation `a06658fb`.
- Observation: the newly connected Pi5 lifecycle test compares against `HEAD^`, so the default depth-one Actions checkout cannot provide its required migration history.
  Evidence: PR #1005 initially failed `lint-build-unit` at that test; focused commit `98c3dae4` sets fetch depth two, and the same lifecycle test passed locally afterward.
- Observation: PR #1005's trigger cleanup works in the published branch, not only in classifier unit tests.
  Evidence: pushing `agent/ci-deploy-contract-shadow` produced zero push-event runs; CI, CodeQL, and Secret scan were created only for the `pull_request` event, and the classifier job passed.
- Observation: PR #1004's only hosted failure was transient runner storage exhaustion, not a migration regression, and the rerun recovered without a code change.
  Evidence: `security-docker (api)` first failed during Trivy image export with `no space left on device`; its failed-job rerun passed, leaving every check green.
- Observation: the PR 2 shadow can exercise client lifecycle selection from a stable baseline and merge-base diff without importing the final executor behavior reserved for PR 6.
  Evidence: Draft PR #1005 head `efa93df4` includes that contract, and its latest `ci-required`, `codeql`, `gitleaks`, and constituent checks all pass.
- Observation: safe detached execution, cooperative cancellation, and job lifecycle reporting share one process-ownership problem that cannot be completed reliably before the transient systemd backend exists.
  Evidence: Draft PR #1006 keeps those operations fail-closed before mutation while its isolated Linux test proves the non-waiting kernel lock is held before checkout.
- Observation: the first PR 1 hosted suite was green even though the migration validator inspected only Git-added migration paths and stripped comments without understanding SQL quotes.
  Evidence: independent review reproduced acceptance of a destructive base-existing pending migration and of `COMMENT ON ... 'keep -- text'; DROP TABLE ...`; corrective commit `d755a679` now validates every candidate migration from immutable commit objects and its hosted rerun is green.
- Observation: SQL quote markers need identifier-boundary checks for both ASCII and Unicode continuations, and a user-defined domain can smuggle constraints or defaults through an otherwise nullable `ADD COLUMN` form.
  Evidence: adversarial tests reproduced `$tag$` boundary bypasses after ASCII and Unicode combining/joiner characters plus custom/domain type bypasses. Commit `d755a679` rejects them and applies the same conservative identifier-boundary rule to `E'...'` prefixes.
- Observation: the Pi5 bootstrap must check out the target coordinator SHA before planning, while its active API/Web images may legitimately remain at an older release SHA for a terminal-only change.
  Evidence: treating checkout HEAD as the Pi5 runtime baseline made every such change appear to require Pi5. PR 5 verifies checkout identity independently and derives runtime `currentSha` from the two matching active image tags. If an unverified baseline has a different checkout SHA, its checkout-derived config and migration-source digests cannot be attributed to the active release, so evidence remains `unknown` and Pi5 stays in scope. Post-release verification requires checkout plus both images to equal the target.
- Observation: Pi4 recovery can race a pre-PR-5 coordinator if it takes only the new fleet lock during the compatibility window.
  Evidence: the pre-PR-5 process knew only the pre-fleet compatibility lock. PR 5 recovery therefore took the fleet lock first and the compatibility lock second, matching bootstrap order; PR 8 removes the second lock only after accepted migration.
- Observation: one multi-unit `systemctl is-active` call is not proof that every required unit is active.
  Evidence: systemd may return success when at least one named unit is active. PR 5 probes each required terminal service independently and promotes evidence only after every command succeeds.
- Observation: default minimization makes rename detection and stale protocol compatibility safety-critical.
  Evidence: Git rename detection can report only a neutral destination path for a runtime-file move, and the PR 4 protocol marker did not prove fleet-state support. PR 5 classifies `git diff --no-renames` so both deletion and addition are considered, and bumps the immutable target/bootstrap/coordinator contract to `raspi-rolling-release-v2`.
- Observation: a directory-created cross-language lock cannot recover safely from SIGKILL without a race-prone stale-owner protocol.
  Evidence: the former Node and Python deploy-status writers could strand `.lock.d` after a crash, while owner-based directory reclamation introduces a compare-and-swap race. PR 5 makes the Python helper the only writer and delegates API acknowledgements to it; a persistent regular lock inode with kernel `flock` releases automatically on process exit or reboot.
- Observation: moving acknowledgement writes behind one helper also moves every protocol validation into that helper.
  Evidence: final fresh review reproduced a malformed notice with no duration being accepted at zero seconds after Node's former positive-integer check was removed. The Python writer now requires an exact positive integer before creating any acknowledgement, and Python/API regressions prove missing, null, boolean, string, fractional, zero, and negative durations return failure without changing state.
- Observation: a valid Pi5 SSH endpoint and repository SHA do not prove that the operator selected the intended inventory site.
  Evidence: both inventories may expose a server reachable with the same deployment account. PR 5 reads only non-secret `CLIENT_ID` from status-agent configuration before Git or fleet-state mutation and requires it to equal the target-tree inventory's server client ID; secret keys are never printed or transported by this probe.
- Observation: a group-level recovery capability silently opts future kiosk hosts into destructive bare-metal recovery.
  Evidence: an adversarial Raspberry Pi 3 fixture inherited `pi4_recovery_enabled: true` from kiosk vars. The capability now exists only on the five named standard-site Pi4 hosts, and Talkplaza plus any newly added kiosk fail closed unless reviewed and explicitly opted in.
- Observation: the PR 5 coordinator verified Pi5 image state but never converged the server role, so image success could coexist with stale host-owned `.env`, systemd, security, or dispatcher configuration.
  Evidence: the coordinator called `ensure_pi5_release` directly after marking fleet evidence unknown. The first PR 6 attempt introduces `host-config-only`, but remains uncommitted until its runtime boundary is corrected.
- Observation: the client role registered Git command results into the same names later reused for normalized SHA strings, which made the post-sync diff lose the actual pre-sync revision.
  Evidence: the executable A-to-B Git fixture failed until command results became `repo_prev_head_result` and `repo_new_head_result`, with separate normalized SHA facts consumed by `git diff`.
- Observation: a ready acknowledgement is safe only when its verification cycle and full desired release SHA are explicit.
  Evidence: preserving a run ID alone could reuse stale ready evidence or permit a retry to rebind a client to another SHA. PR 6 keeps the same-run SHA immutable across retries, hides it outside `verifying`, and clears old ready evidence when a new verification cycle starts.
- Observation: the PR 6 starting point had three rollback owners and no exact run manifest.
  Evidence: coordinator rollback, Ansible `rescue`, and Pi5 lifecycle shell rollback could each mutate state independently. PR 6 removes terminal and Pi5 runtime rollback from Ansible, seals exact file/repository/runtime authority before mutation, and leaves the coordinator as the only policy owner.
- Observation: not every pre-candidate Docker operation is a runtime executor; genre-image extraction protects data that exists only in the outgoing API container.
  Evidence: the first `host-config-only` guard also skipped the extraction. A later cleanup could then delete the sole copy, so review classified this as P1 and the slice was withheld from commit.
- Observation: hashing `.env` proves desired file bytes, not that the active API container received them.
  Evidence: guarding the legacy API environment check out of `host-config-only` left no equivalent post-switch evidence in the coordinator path. PR 6 health work must verify the selected candidate container before fleet evidence becomes `verified`.
- Observation: desired-config verification cannot be reused unchanged for the outgoing slot during prior-release recovery.
  Evidence: after checkout and host configuration change, the old active container is expected to differ. Normal `status` must reject that drift for same-SHA skipping, but handoff inspection and expired cleanup must first prove only image, scheduler, Web, gateway, and durable-state structure so the new candidate can be created.
- Observation: comparing only desired environment keys misses deletions.
  Evidence: a container retaining a removed optional key passed the first verifier. PR 6 now derives the exact expected environment from image `Config.Env` overlaid by effective Compose configuration and rejects missing, changed, and unexpected keys without printing values.
- Observation: terminal repository ownership follows the historical full-provisioning path, but the release-only checkout used a different user.
  Evidence: StoneBase began `git reset --hard` at the sealed prior HEAD, updated the user-writable `.dockerignore`, then failed at root-owned tracked directories. The repository and services remained on the prior release, while the rollback helper correctly refused the resulting dirty worktree. Read-only ownership inspection showed that full provisioning runs Git as root and had created the mixed tracked-tree ownership.
- Observation: interrupted-run Kiosk rollback restored the terminal repository correctly but challenged the browser with that terminal SHA, even though the browser renders the independently versioned live Pi5 Web bundle.
  Evidence: StoneBase restored cleanly to `85fe6198`, its Docker and systemd runtime matched the sealed manifest, and its authenticated deploy-status response requested ready SHA `85fe6198`; the verified Pi5 Web image remained `31ef395a`. The Kiosk bundle correctly refused the mismatched challenge and the coordinator timed out without clearing maintenance.
- Observation: a durable runtime-restored receipt cannot make later interrupted recovery verification-only when the sealed file manifest is replayed first.
  Evidence: StoneBase has a valid runtime receipt for manifest digest `660a2364`, but the next retry atomically restored the systemd unit files before runtime restore. systemd then reported `NeedDaemonReload=yes` for the restored units; the old receipt shortcut refused that safe, expected reconciliation and stopped before any new release mutation. The repository, Docker services, and retained rollback images remain available.
- Observation: `host-config-only` was not a safe boundary while it still traversed the general server play graph.
  Evidence: the first implementation could reach repository, SSH, security, status-agent, dispatcher, and systemd tasks without a matching rollback manifest. PR 6 now uses a dedicated exact-checkout playbook, restricts the release mutation profile to three environment files plus bounded storage rescue, and records `capture-pending`, `captured`, `converged`, or restored evidence around the coordinator-owned transaction.
- Observation: a same-SHA/config image tag is not immutable across two coordinator runs.
  Evidence: the earlier tag could be rebuilt and retargeted by a later run. PR 6 adds a full run-ID digest to the tag, retains a strict parser for legacy tags, and retires only proven unreferenced run-owned tags; partial Phase 3 ownership fails closed.
- Observation: a no-op fleet plan can still inherit candidate containers or a paused signage renderer from a hard-killed run.
  Evidence: planning solely from fleet evidence would skip executor cleanup. The coordinator now reconciles labelled candidate containers, signage pause authority, candidate tags, and incomplete Pi5 stage state before beginning fleet state or accepting a no-op.
- Observation: a controller prestage file cannot share the signage updater's periodic temporary filename.
  Evidence: at 15:42:50 JST the Pi3 timer opened `current.tmp.jpg` while the coordinator was sealing it, displayed and acknowledged the maintenance screen, then removed that shared file. The coordinator's next script invocation failed because its artifact had disappeared. The repository remained clean at prior SHA `0a2402a8`, but rollback also rejected the absent, never-fetched candidate object before restoring the file manifest.
- Observation: migration-source files alone cannot prove the live database ledger.
  Evidence: an applied migration may be missing or have a different checksum even when the checkout matches. PR 6 reads completed, non-rolled-back Prisma rows from the active API, reuses the PR 1 canonical verifier for zero-new and new-migration cases, and binds final fleet evidence to the verified live ledger without down migration.
- Observation: the repository had neither a repository ruleset nor legacy branch protection on `main` when PR 7 started.
  Evidence: `GET /repos/denkoushi/RaspberryPiSystem_002/rulesets` returned an empty array and the branch-protection endpoint returned HTTP 404, so PR 7 can create one canonical ruleset without merging two competing policies.
- Observation: a conditional aggregate must distinguish an intentional skip from an unexpected success as well as from failure or cancellation.
  Evidence: `scripts/ci/validate_required_results.py` accepts only selected=`true` with result=`success` or selected=`false` with result=`skipped`; 20 CI unit tests cover classification, full-suite fallback, workflow wiring, and aggregate fail-closed cases.
- Observation: an aggregate that executes a repository validator still needs its own checkout even when every dependency checked out independently.
  Evidence: representative run `29452440441` completed all ten selected jobs successfully, then `ci-required` failed because `scripts/ci/validate_required_results.py` was absent from its fresh runner. PR 7 now checks out before executing that validator, and the workflow contract asserts the checkout exists.
- Observation: the four Pi3 runtime corrections were validated independently, so no test combined timer transitions, daemon-reload drift, intentional stop status 143, and timer-owned postflight transitions in the full eleven-unit signage manifest.
  Evidence: the new combined restore scenario reaches eighteen systemd mutation boundaries and exercises both command failure before mutation and lost result after mutation at every boundary; all thirty-six retries converge to the same sealed manifest.
- Observation: interrupted recovery marked every affected terminal unknown before processing the first host, so one Pi3 failure erased durable fleet evidence for five untouched, already-successful Pi4 kiosks.
  Evidence: the incident-derived two-host regression failed with `kiosk-a.evidence=unknown` before the correction. Per-host unknown transition and durable success carry-forward now leave the untouched kiosk verified without a live probe or cleanup replay.
- Observation: a terminal `state=success` flag alone is insufficient to skip a new live probe during interrupted recovery.
  Evidence: carry-forward now also requires exact committed runtime finalization, a clean runtime-cleanup result, the sealed runtime-manifest checksum, bounded tag count, matching desired/new/current SHA, and both maintenance boundaries. A corruption matrix rejects false cleanup, wrong checksum, invalid count, inconsistent already-clean evidence, and restored rather than committed outcomes; all five production Pi4 records satisfy the complete proof.
- Observation: carrying a completed Pi4 forward with the new run's overall release SHA as its recorded `desiredSha` silently retargets that Pi4 even when impact classification says its role is unaffected.
  Evidence: policy treats `recorded_desired != current` as stale desired evidence. Carry-forward now records the completed host's verified SHA as both desired and current until planning; the incident-shaped regression uses different run and completed SHAs and requires them to remain equal.
- Observation: changing `rolling_release/coordinator.py` was previously classified as an unknown runtime path and therefore expanded a signage recovery correction to the entire fleet.
  Evidence: the coordinator executes only from the immutable Pi5 checkout and is not installed into API/Web or terminals. It is now an explicit `deploy-control` file; the real diff from the five Pi4/Pi5 baseline `06fb53ed` classifies `server=false`, `kiosk=false`, `signage=true`, while unknown paths remain fail-closed.
- Observation: release-only image metadata was declared before the API and Web runtime filesystem layers, so every new release SHA invalidated unchanged dependency layers.
  Evidence: production run `20260717-031409-be92ee` took about 54 minutes overall. Pi5 `docker history` prefixed the API OCR, production dependency, and Playwright steps with that release's `BUILD_COMMIT` and `BUILD_CONFIG_HASH`; the affected layers were approximately 2.22 GB, 637 MB, and 945 MB. Comparing the current and prior 5.43 GB API images showed that the runtime layers diverged from the first release-metadata instruction even though the dependency inputs were unchanged.
- Observation: normal terminal release prerequisites were distributed through mutating roles instead of being exhausted before the release boundary.
  Evidence: run `20260718-114117-fa74e2` passed migration preflight and completed the Pi5 rollout, then StoneBase entered maintenance, synchronized its repository, and only afterward reached the NFC lifecycle assertion. Read-only inspection showed `pcscd.socket=active/enabled`, `/run/pcscd/pcscd.comm` present, and the NFC status endpoint returning HTTP 200 while `pcscd.service=inactive/indirect`; the service assertion was both late and semantically wrong for socket activation.
- Observation: a stacked PR can invoke CI and CodeQL through `workflow_dispatch`, but gitleaks-action v3 gives that event no commit range and therefore scans the complete repository history.
  Evidence: manual run `29644978416` scanned 4,623 commits and reported five findings from commits dated before the current branch. The same head passed all 15 CI jobs and CodeQL. The upstream v3 implementation applies bounded refs only to push and pull-request events, not workflow dispatch.

## Decision Log

- Decision: A normal release must run one aggregate, secret-free terminal prerequisite probe for every selected terminal before creating the transient release unit. The probe reports all known issues across all selected terminals and `--preflight-only` exposes the same boundary without submitting a release.
  Rationale: Per-role fail-fast checks discover one issue only after earlier mutations, which creates serial stop/fix/retry cycles. A single read-only boundary makes the failure set complete and proves that Pi5, maintenance, repository, configuration, services, containers, and database remain untouched when prerequisites fail.
  Date/Author: 2026-07-18 / Codex, required by user after run `20260718-114117-fa74e2`.

- Decision: Treat PC/SC on Raspberry Pi OS by its operational socket contract: packages installed, `pcscd.socket` loaded/active/enabled, and `/run/pcscd/pcscd.comm` a Unix socket. Do not require `pcscd.service` to be enabled or continuously active.
  Rationale: `pcscd.service` is intentionally indirect and may be inactive between requests. The enabled socket and communication endpoint are the actual runtime authority, as confirmed by the live NFC agent returning HTTP 200.
  Date/Author: 2026-07-18 / Codex.

- Decision: For manual CI on a stacked branch, scan secrets over the cumulative immutable `origin/main..HEAD` commit range with pinned gitleaks 8.24.3; keep the action-owned event range for push, pull request, and schedule.
  Rationale: This covers every commit that the stacked branch would eventually introduce to main without reclassifying unrelated historical findings or temporarily retargeting the PR base merely to start checks.
  Date/Author: 2026-07-18 / Codex, approved by user.

- Decision: After accepted full-fleet and same-SHA no-op evidence, remove every pre-fleet release compatibility read/write instead of extending another migration window. Keep the locked current per-run state because public status, approve, and cancel still require it; do not confuse that current contract with the removed unlocked and shell-status fallbacks.
  Rationale: accepting two authorities after production migration would keep recovery ambiguous, while deleting current per-run control would break the documented public interface.
  Date/Author: 2026-07-16 / Codex

- Decision: Deliver the program as eight small, ordered pull requests based on the latest merged `origin/main`.
  Rationale: each safety contract remains reviewable and reversible, and later architecture work cannot hide urgent ledger, CI, or lock corrections.
  Date/Author: 2026-07-15 / User and Codex
- Decision: Freeze ordinary product deployment until the safety foundation passes production acceptance.
  Rationale: mixing new product behavior into a changing deployment path would make failures harder to attribute and increase recovery time.
  Date/Author: 2026-07-15 / User
- Decision: Keep Draft PR #1003 unchanged as a reference; never merge it, force-push it, or delete its branch during replacement.
  Rationale: it is useful provenance, but its mixed history is not a safe integration unit.
  Date/Author: 2026-07-15 / User
- Decision: Preserve `scripts/update-all-clients.sh` as the public entry point and replace its internals with one strict Python coordinator.
  Rationale: operators keep a familiar command while hidden coordinator selection and inconsistent options disappear.
  Date/Author: 2026-07-15 / User
- Decision: Treat uncertainty as deployment scope, not as permission to exclude a host.
  Rationale: a false-positive target costs time; a false-negative target can leave a fleet on incompatible versions.
  Date/Author: 2026-07-15 / User
- Decision: Keep terminal deployment serial, the five-minute Blue/Green stability window, and the sixty-second notice interval.
  Rationale: these are accepted safety and shop-floor behavior; this program removes duplicated work without shortening the observation or operator warning.
  Date/Author: 2026-07-15 / User
- Decision: Connect the client-lifecycle baseline and merge-base diff contract in PR 2, while leaving reconstruction of the final client executor behavior and its complete hosted contract to PR 6.
  Rationale: PR 2 can protect the real pre-sync diff input without inventing a placeholder executor; PR 6 still owns behavior reconstructed from `c5d8a4da`, `85fe6198`, and `1f64d5b4`.
  Date/Author: 2026-07-15 / Codex
- Decision: Make the coordinator the only rollback decision-maker and prohibit database down migrations.
  Rationale: nested rollback obscures final state, while rolling a database schema backward can make already-running API versions unsafe. Only backward-compatible Expand-only migrations are allowed.
  Date/Author: 2026-07-15 / User
- Decision: Make `ci-required` the only conditional-CI aggregate required check, while `codeql` and `gitleaks` remain separately required.
  Rationale: path-specific jobs can be skipped legitimately, but the fixed aggregate name gives the ruleset a stable contract.
  Date/Author: 2026-07-15 / User
- Decision: Stop after CI and read-only planning and request explicit approval separately for each inventory before any production mutation.
  Rationale: repository implementation approval does not implicitly authorize changing either physical fleet.
  Date/Author: 2026-07-15 / User
- Decision: Keep cancel, detach, and job operations fail-closed before mutation in PR 3, and implement their shared lifecycle only with the transient systemd backend in PR 4.
  Rationale: one systemd-owned execution identity is required to avoid false detached-start success, stale process identity, and unsafe cancellation of a mutating child process.
  Date/Author: 2026-07-15 / Codex
- Decision: Require PR 1 to validate every candidate migration from the immutable candidate commit object, parse SQL comments and statement boundaries with ASCII- and Unicode-aware quote boundaries, allow only built-in types for nullable constraint-free `ADD COLUMN`, and reject every migration-file Git change except A status.
  Rationale: an added-path-only allow-list, regex comment stripping, or a user-defined domain can let `migrate deploy` execute unreviewed, hidden, or implicitly constrained SQL even when checks are green.
  Date/Author: 2026-07-15 / Codex
- Decision: Keep the workspace install and build toolchain on Node 20 with packageManager-pinned pnpm 9, but run the security audit after all build work with pinned pnpm 11.4 on Node 22 from outside the repository.
  Rationale: npm permanently retired the endpoint used by pnpm 9, while pnpm 11 uses the bulk advisory endpoint and requires Node 22. Isolating that read-only client restores the critical gate without a broad package-manager migration or a fail-open registry flag.
  Date/Author: 2026-07-15 / Codex
- Decision: Run every PR 4 release as one system-manager transient unit, started and inspected through non-interactive `sudo -n`, with an explicit unprivileged deploy user, `Type=exec`, and a unit name derived only from the validated run ID.
  Rationale: start, wait, status, and signal must address one durable execution identity; `InvocationID` and `MainPID` verification prevents forged environment variables from impersonating that unit.
  Date/Author: 2026-07-15 / Codex
- Decision: Make the fsynced control JSON the sole cancellation authority and use SIGUSR1 only as a wake-up; keep progress state and control in separate files under a per-run kernel lock.
  Rationale: a signal alone cannot authorize cancellation, concurrent progress writes cannot erase an operator reason, and terminal-state versus cancel races have one linearized outcome.
  Date/Author: 2026-07-15 / Codex
- Decision: Require a clean remote worktree before fetch and after checkout, plus an exact protocol marker in the target SHA, before the bootstrap may exec the coordinator.
  Rationale: immutable HEAD and global lock ownership are insufficient if dirty or pre-PR-4 runner bytes can execute after checkout.
  Date/Author: 2026-07-15 / Codex
- Decision: Retain explicit read-only adapters for unlocked pre-PR-4 run JSON and the older status-file format until PR 8, while validating locked current-format records strictly.
  Rationale: existing run IDs must remain inspectable during migration, but legacy tolerance must never weaken the new state/control corruption checks or create files during status reads.
  Date/Author: 2026-07-15 / Codex
- Decision: Define the Pi5 host record's `currentSha` as the immutable release SHA shared by its active API and Web images, while checking bootstrap checkout HEAD separately.
  Rationale: coordinator code must run from the requested target before scope is known, but that checkout alone does not mean the live server release changed. Checkout-derived digests are verified only when checkout and active image release agree; otherwise evidence is unknown. Post-release verification requires checkout, API image, and Web image to agree exactly.
  Date/Author: 2026-07-15 / Codex
- Decision: Write authoritative fleet transitions before the corresponding compatibility marker or per-run snapshot, and downgrade a host to `unknown` before every mutating attempt or rollback.
  Rationale: a crash can leave old evidence behind only if compatibility data leads the authoritative state. New-state-first ordering makes the next plan conservatively include any ambiguous host.
  Date/Author: 2026-07-15 / Codex
- Decision: Permit the Pi5 compatibility marker only when fleet state is pristine, and reject any ambiguous or non-inventory server authority in Pi4 recovery.
  Rationale: once a fleet transition exists, `unknown`, an active run, or competing server records are authoritative uncertainty and an older marker cannot safely replace them.
  Date/Author: 2026-07-15 / Codex
- Decision: Bind every launch, read-only plan, and recovery to both the exact resolved target checkout and the target inventory's non-secret Pi5 client identity before using release state or mutating Git.
  Rationale: branch-name intent, SSH reachability, and a clean repository are insufficient proof of immutable bytes or physical-site identity. A mismatched or missing client ID must stop without exposing `CLIENT_KEY`.
  Date/Author: 2026-07-15 / Codex
- Decision: Use `scripts/deploy/deploy-status-state.py` as the sole deploy-status writer and let the API invoke it without a shell; serialize all writers with a persistent regular-file kernel lock.
  Rationale: one implementation preserves acknowledgement semantics and atomic replacement, while `flock` has automatic crash/reboot release and avoids unsafe stale-directory deletion.
  Date/Author: 2026-07-15 / Codex
- Decision: Treat a concurrently active fleet run as unknown for every host in `--print-plan`, and require recovery capabilities per host rather than by inherited group.
  Rationale: read-only planning cannot make a stable exclusion decision while another run is changing evidence, and destructive recovery eligibility must never expand implicitly when inventory membership changes.
  Date/Author: 2026-07-15 / Codex
- Decision: Build PR 6 in independently reviewable lifecycle, protocol, host-configuration, health, rollback, and Pi5-executor slices without publishing a partial safety contract.
  Rationale: each slice can gain executable fail-closed tests while the branch remains local, and the requested stopping boundary can leave a clean, precise restart point.
  Date/Author: 2026-07-15 / Codex
- Decision: Preserve the historical full server role by default and select `host-config-only` only from the coordinator adapter.
  Rationale: existing non-coordinator playbooks retain their behavior, while the coordinator remains the sole owner of candidate build, migration, runtime health, and Blue/Green switching.
  Date/Author: 2026-07-15 / Codex
- Decision: During interrupted rollback, bind a Kiosk ready challenge to the unique verified fleet server `currentSha`; keep signage bound to its restored repository SHA.
  Rationale: Kiosk readiness proves the compiled Web bundle rendered from Pi5, while signage readiness proves terminal-local release bytes. Reusing the terminal repository SHA for both creates an impossible but superficially valid Kiosk challenge.
  Date/Author: 2026-07-16 / Codex
- Decision: Before interrupted terminal recovery mutates any host, run one automatic read-only preflight across every affected host and report all discovered prerequisites together; do not add this gate to normal deployment.
  Rationale: serial first-error discovery caused repeated production stop/fix/retry cycles. Aggregating sealed file/runtime, repository, systemd, Docker, receipt, retained-image, and ready-SHA checks finds the whole recovery chain in one pass without adding an operator approval, notice, or delay to ordinary releases. A valid restore receipt remains durable evidence, but actual replay-created drift must be reconciled idempotently rather than rejected.
  Date/Author: 2026-07-16 / User and Codex
- Decision: Render and seal signage maintenance into run-scoped files that are included in the rollback manifest; allow a clean repository already at the sealed prior SHA to restore without possessing an unfetched candidate object.
  Rationale: the periodic updater owns `current.tmp.jpg`, while the coordinator needs a stable artifact through its seal boundary. Before checkout, the candidate cannot have left repository residue, so requiring its object adds no safety and converts a file-only recovery into an avoidable interruption. Dirty or candidate-HEAD repositories still require the exact candidate object and residue proof.
  Date/Author: 2026-07-16 / Codex
- Decision: Permit structural-only Pi5 status and cleanup only for recovering an already-expired prior handoff; never use it for same-SHA skip, candidate readiness, stability monitoring, or fleet verification.
  Rationale: a newly desired environment should not invalidate the old rollback slot before a candidate exists, but no host may become `verified` without exact live configuration evidence.
  Date/Author: 2026-07-15 / Codex
- Decision: Bind terminal readiness to an opaque verification ID as well as the run and release SHA, and start a new immutable challenge for rollback.
  Rationale: a delayed forward ACK could otherwise satisfy rollback when a Kiosk continues to render the same Pi5 Web SHA. The challenge makes each release or rollback proof single-cycle and auditable.
  Date/Author: 2026-07-15 / Codex
- Decision: Keep the terminal health slice local until rollback stops re-running the general playbook and restores one exact run manifest; provide a controller-owned signage ready probe for restored pre-protocol scripts.
  Rationale: controller-current templates can leave a previous-HEAD terminal partially configured, while an exact restore can legitimately bring back a signage script that predates ready ACKs. Neither state may be promoted or have maintenance removed without coordinator-owned restoration and proof.
  Date/Author: 2026-07-15 / Codex
- Decision: Treat Pi5 host configuration as a manifest-bounded forward commit: restore `capture-pending`, `captured`, or `restore-failed` state before planning, but never restore `converged` configuration after a later candidate failure or cancellation.
  Rationale: a crash before the durable commit may have replaced only part of the environment, whereas a completed environment change is compatible with the still-running prior image and must remain the desired host configuration while candidate work retries.
  Date/Author: 2026-07-15 / Codex
- Decision: Reconcile executor-owned Pi5 residue before fleet begin, evidence seeding, cancellation checkpoints, and no-op planning.
  Rationale: fleet state describes release evidence, not orphaned containers, paused scheduling, or incomplete stage authority; those resources must be healed before planning can be trusted.
  Date/Author: 2026-07-15 / Codex
- Decision: Give every Pi5 candidate run-scoped image tags and durable image IDs, while accepting legacy immutable tags only at compatibility read boundaries.
  Rationale: later builds must not retarget a slot tag owned by an earlier run, and cleanup must prove tag shape, provenance, exact ID, and absence from every slot/container before removal.
  Date/Author: 2026-07-15 / Codex
- Decision: Sample load for about forty seconds before and after candidate build, reuse the sealed post-build evidence in Phase 3, and retain the separate five-minute post-switch stability monitor.
  Rationale: this removes the duplicate Phase 3 load wait (about 120 seconds to about 80 seconds total) without weakening the accepted five-minute runtime observation.
  Date/Author: 2026-07-15 / Codex
- Decision: Cancel only superseded pull-request workflow runs; allow every `main`, merge-group, manual, and scheduled full-suite run to finish.
  Rationale: a path-independent full-suite trigger is not meaningful if a later push can cancel its evidence, while stale PR heads should still release runner capacity quickly.
  Date/Author: 2026-07-15 / Codex
- Decision: Keep `ci-required`, `codeql`, and `gitleaks` as the only ruleset status checks and add `merge_group` to all three producing workflows.
  Rationale: GitHub required checks are matched by check name rather than conditional-job intent; requiring a skippable name can deadlock a valid PR or merge queue.
  Date/Author: 2026-07-15 / User and Codex
- Decision: Run only the immutable release Git checkout as root with an explicit `safe.directory`, and never normalize the terminal tree with recursive ownership changes.
  Rationale: this matches the existing full-provisioning owner, removes the real checkout failure, and avoids a broad filesystem mutation. Interrupted-run rollback may accept a dirty tree only when HEAD and index remain at the sealed prior SHA and every dirty path exactly matches the coordinator's immutable candidate commit; unrelated, staged, hidden-index, or untracked operator state remains fail-closed. This exceptional recovery adds no normal deployment wait or approval gate.
  Date/Author: 2026-07-16 / User and Codex

- Decision: Do not run Pi3 production again after an isolated correction. Require one composed incident replay, failure injection at every recovery mutation boundary, forward-phase fault coverage, and proof that completed Pi4 records remain outside live recovery.
  Rationale: the prior isolated tests allowed the next systemd edge case to appear only in production. Composed rehearsal is the same error-discovery method that made the Pi4 rollout succeed and does not add an operator gate to normal deployments.
  Date/Author: 2026-07-16 / Codex

- Decision: Mark a terminal unknown only immediately before that terminal's recovery work. Carry a fully committed PR-6 terminal success forward from its durable finalization and cleanup proof without another live probe.
  Rationale: untouched successful Pi4 kiosks must not become dependencies of Pi3 recovery. The durable proof is the same evidence already used for ordinary target exclusion; legacy records without that proof retain the existing live-verification path.
  Date/Author: 2026-07-16 / Codex

- Decision: Correct the local Docker cache boundary before considering a registry-based image distribution path.
  Rationale: `BUILD_COMMIT` and `BUILD_CONFIG_HASH` are provenance metadata, not dependency inputs. Declaring them only after every final-stage `RUN`, `COPY`, and `ADD` preserves exact image labels while allowing the existing Pi5 BuildKit cache to reuse unchanged OCR, Playwright, Node/Python dependency, Alpine package, and Caddy layers. Immutable Git archives, run-scoped tags, candidate validation, load gates, Blue/Green rollback, the five-minute stability window, serial terminal rollout, and fail-closed host selection remain unchanged. GHCR or another registry would add a new publication and trust boundary and is deferred unless warm-cache evidence misses the target.
  Date/Author: 2026-07-17 / User and Codex

## Outcomes & Retrospective

The program is in progress. The living ExecPlan in #1007, migration ledger safety in #1004, CI/deploy-contract shadowing in #1005, critical inventory/rollback/checkout-lock safety in #1006, single-coordinator foundation in #1008, durable fleet state in #1009, unified executor/health/rollback in #1010, and staged CI/ruleset enforcement in #1011 are merged. Ruleset `19014580` is active and requires only `ci-required`, `codeql`, and `gitleaks`. The explicitly approved second-factory full-fleet acceptance and same-SHA no-op proof succeeded at exact main `79ab05f8`; PR 8 implementation and local acceptance are complete and published as Draft #1030, with hosted validation and merge remaining. Draft #1003 is closed unmerged with a complete replacement map, and its source branch remains retained. TalkPlaza Pi5 was not deployed because no physical device exists.

Merged PR 1 validates the complete candidate commit-object ledger, enforces addition-only migration diffs, and applies a quote-aware conservative SQL allow-list. Its 22 focused tests, real 144-base/146-candidate ledger check, adversarial matrix, two independent reviews, and both hosted suites passed. Merged PR 2 proves pull-request-only feature-branch CI, stable required-check names, the shadow classifier, and the client-lifecycle baseline/merge-base contract; its refreshed suite passed with no duplicate feature-branch push run. Merged PR 3 delivers canonical inventory groups, exact-run rollback selection, and checkout-before-lock prevention; final hosted run `29379111287` passed completely after the approved isolated audit-client repair.

Merged PR 4 removes the 2,000-line hidden shell coordinator and all four alternate mutating entrances, while preserving the public wrapper and legacy status reads. A systemd-owned bootstrap locks before every Git operation, refuses dirty or old-protocol targets, verifies the exact systemd invocation, then execs the package coordinator. Foreground, detach, status, approval, and cooperative cancellation share one state/control model. Exact head `c22da822` passed its hosted suite and merged as `ccdc624a`.

Merged PR 5 adds the durable release authority and conservative default minimization described above. Its refreshed branch head `5441065e` passed hosted validation and merged as `deab7d5e` without touching production.

Merged PR 6 implements the full accepted milestone. Client lifecycle uses the real pre-sync revision; ready ACKs are bound to one verification cycle and release SHA; terminal mutation is captured in exact file, repository, systemd, and Docker manifests; rollback and crash takeover restore only that authority before authenticated readiness proof. Pi5 host configuration uses a dedicated bounded playbook and durable manifest state. Candidate build, migration planning/application/live-ledger verification, Blue/Green switch, five-minute monitor, cleanup, and rollback are coordinated by one owner. Run-scoped image tags and IDs prevent later retargeting, and the post-build load proof is reused instead of repeated.

PR 6's final local and hosted suites passed, followed by a successful full `main` suite at merge commit `0efcbb34`. Independent terminal and Pi5 audits found and closed the remaining hard-kill, partial-ownership, host-config graph, bootstrap deletion, scheduler-resume, and candidate-tag issues. The approved second-factory acceptance has since verified the Pi5 through build, switch, five-minute stability, cleanup, and live migration-ledger checks at `31ef395a`; terminal acceptance remains incomplete.

The three deferred product slices were reintroduced as merged PRs #1013, #1014, and #1015 rather than cherry-picking the mixed draft. Draft PR #1003 remains open, untouched, and unmerged at head `0f19936a` for provenance only. Terminal checkout ownership and Kiosk rollback identity are corrected in merged PRs #1021 and #1022. The remaining acceptance blocker is the repeated interrupted-runtime reconciliation path on StoneBase; the latest retry stopped before new Pi5 or later-terminal mutation, and normal deployment behavior is intentionally unchanged.

The 2026-07-17 post-acceptance cache correction changes no deployment decision or public interface. Local arm64 evidence rebuilt both images with two different provenance pairs and found identical filesystem-layer arrays with exact per-image OCI labels. On the second API build, the roughly 499-second OCR layer, 47-second production dependency layer, and 136-second Playwright layer were all cache hits; the second Web build likewise cached every layer. Updated local Trivy scans found zero unignored fixed HIGH/CRITICAL vulnerabilities in both images. Hosted Docker validation and warm-cache production timing remain pending.

At each major merge, update this section with the observable behavior delivered, the checks that passed, any time saved or regression found, and the remaining risk. After the seven-day CI observation, compare actual latency and runner-minute evidence against the thresholds in `Validation and Acceptance`. After PR 8, state whether the old marker, lock, and run formats were fully removed and whether the accepted same-SHA plan is a no-op.

## Context and Orientation

The repository is a pnpm monorepo with a Fastify API in `apps/api`, a Web application in `apps/web`, Raspberry Pi client software under `clients`, release scripts under `scripts/deploy`, Ansible inventories and playbooks under `infrastructure/ansible`, and GitHub Actions under `.github/workflows`.

`scripts/update-all-clients.sh` is the operator-facing release command. On the baseline, it normally delegates to `scripts/deploy/rolling-release.py`, but an environment variable can reveal a second large shell coordinator. The Python coordinator resolves a Git revision, remotely checks out the code on the Pi5, optionally performs Pi5 Blue/Green, then updates kiosks and signage. `infrastructure/ansible/playbooks/deploy-staged.yml` applies server, kiosk, and signage roles. The accepted current behavior is one terminal at a time with a canary hold and per-terminal maintenance state.

Two inventories are production-relevant: `infrastructure/ansible/inventory.yml` and `infrastructure/ansible/inventory-talkplaza.yml`. An inventory is an Ansible file that maps host names into groups and supplies connection and role variables. A play targets a group by name. If inventory and playbook group names disagree, a host can be silently omitted even though it has the right role variables.

The Pi5 Blue/Green design runs two named application slots, Blue and Green, behind one gateway. A candidate is built in the inactive slot, checked, switched into service, and observed for five minutes while the old slot remains available. A canary is the first kiosk updated before the remaining terminals. An acknowledgement, abbreviated ACK, is evidence returned by a terminal that it entered or left a release phase. The sixty-second notice is the maintenance message displayed before an update.

An immutable SHA is the full Git commit identifier selected for a release. A migration ledger is the database table and repository directory that together record which schema migrations were applied. A checksum proves that an applied migration file has not changed. Expand-only means a schema change adds compatible structures without removing or redefining structures still needed by the old API. Fail-closed means uncertainty stops the operation or expands its checks and targets; it never silently assumes safety.

A release coordinator decides what to deploy, in what order, and when to stop or roll back. An adapter is a small boundary that translates coordinator decisions into Pi5 or Ansible commands. A transient systemd unit is a run-specific Linux service created with `systemd-run`; systemd records its process and exit state without requiring a permanent unit file. A kernel `flock` is an operating-system file lock released automatically when its owning process exits. The lock must be obtained before any remote fetch or checkout so a later run cannot alter the repository or state of an active run.

Fleet state is the durable JSON record introduced in PR 5. It is not merely a log. It is the sole authority for whether a host is already at a release. Evidence is `verified` only after live Git, service, API/Web image, configuration, migration, and device acknowledgement checks appropriate to that host have passed. Missing, stale, timed-out, unreachable, partially rolled back, or otherwise ambiguous evidence is `unknown` and keeps the host in scope.

PR #1003 is a mixed draft used only as source evidence. The following source commits are named because the program reconstructs their final behavior selectively: `4a5d64a8`, `01999607`, `284e0bc5`, `c5d8a4da`, `19ccd48e`, `99cd44a6`, `85fe6198`, `1f64d5b4`, `de8dcdd7`, and `0f19936a`. Commit-level transplantation is allowed only where a milestone explicitly names it.

## Safety Boundary and Pull Request Discipline

Ordinary product releases remain frozen until the production acceptance in this plan succeeds. Repository tests, hosted CI, fixture-based fault injection, read-only GitHub inspection, and `--print-plan` are allowed. Do not run the deployment command in a mutating mode, execute Ansible against a production host, SSH to change a host, apply a migration to production, toggle maintenance, create production fleet state, or exercise rollback on a real device without the later per-inventory approval.

Each pull request must contain only its milestone. Start it from the latest merged `origin/main`, keep an intentional commit history, run `git diff --check`, and publish it as a draft before review. Do not merge or force-push PR #1003. Do not pull product commit `de8dcdd7` into any of PR 1 through PR 8.

Before a later milestone begins, its prerequisites must be merged or the branch must be demonstrably independent. PR 1, PR 2, and PR 3 may be prepared in parallel from baseline `38e72080` because their owned files and contracts are deliberately separated. PR 4 and later must wait for the applicable earlier merges, then start from the refreshed main branch.

## Plan of Work

### Milestone 1: Restore the migration ledger in PR 1

PR 1 is already published as Draft PR #1004 from `agent/deploy-migration-ledger`. Preserve the provenance of its first four focused commits and keep the independent-review hardening as a fifth commit. The first three commits transplant only source commits `4a5d64a8`, then `01999607`, then `284e0bc5`, in that order. They restore two migration files known to have been applied, teach reconciliation to accept the restored history, and apply pending Expand-only migrations before status is trusted.

The fourth commit reimplements only the `c5d8a4da` behavior that validates every applied migration and checksum even when there are zero new migrations. It must not import the rest of `c5d8a4da`. `scripts/deploy/validate-expand-only-migrations.py` must accept an empty list of new migration paths while still checking the full repository history supplied by the caller. `scripts/deploy/pi5-blue-green.sh` must never return early merely because the candidate introduces no new migration.

The fifth commit is the focused correction from independent review: read every migration from the immutable candidate commit object, enforce the applied/candidate set and checksum contract, reject non-addition migration diffs, and parse the conservative SQL allow-list without quote, comment, domain-type, or Unicode-boundary bypasses.

Tests in `scripts/deploy/tests/test-pi5-blue-green.sh` must cover a restored applied migration, an applied ledger entry missing from the repository, a checksum mismatch, a non-Expand-only new migration, and a release with zero new migrations. The implementation must never execute a down migration. SQL that is not compatible with the old API must fail before candidate activation.

Acceptance for this milestone is Draft PR #1004 with only migration-related diffs, all hosted checks green, and a reviewer able to trace every imported hunk to the named source behavior. After merge, refresh `origin/main` before basing dependent work.

### Milestone 2: Establish the CI baseline and deploy-contract shadow in PR 2

On branch `agent/ci-deploy-contract-shadow`, change feature, fix, refactor, and chore branch validation from duplicate `push` plus `pull_request` runs to `pull_request` only. Keep full `push` validation on `main`. Remove `develop` from `ci.yml`, `codeql.yml`, and `gitleaks.yml` because the branch does not exist. Preserve manual execution.

Create the pure standard-library classifier at `scripts/ci/classify_changes.py` with tests under `scripts/ci/tests`. It must classify the PR diff and publish the result in the GitHub Actions step summary, but PR 2 must not conditionally skip any existing job. This is shadow mode: classification is observable while the old full PR suite remains authoritative. Record enough output to distinguish docs/root Markdown, API, Web, shared packages, migrations, deployment/Ansible, clients, Docker/security, workflows/CI, unknown paths, and rename/delete events.

Connect the existing `scripts/deploy/tests/test-pi5-image-deploy.sh` to hosted CI. Parse both `infrastructure/ansible/inventory.yml` and `infrastructure/ansible/inventory-talkplaza.yml`, and syntax-check `infrastructure/ansible/playbooks/deploy-staged.yml` in the hosted environment. Add an executable client-lifecycle baseline contract for the behavior already present in the client roles, while leaving the final build/recreate/no-build executor behavior and its expanded contract to PR 6.

Add an always-present `ci-required` job. It must depend on every current PR job, use `if: always()`, inspect dependency results, and fail if any job unexpectedly failed or was cancelled. In shadow mode all existing jobs still run, so a skipped result is unexpected unless the workflow itself explicitly documents it. The check name must remain exactly `ci-required` from this PR onward.

Simplify CodeQL to the official JavaScript/TypeScript analysis flow. Remove the pnpm workspace setup, Prisma generation, API build, Web build, and explicit package builds that do not contribute to CodeQL extraction. Name the job exactly `codeql`, with no matrix suffix in the required-check name. Keep `gitleaks` named exactly `gitleaks`.

Acceptance is one PR run, not a branch-push duplicate, with classifier output in Summary, every pre-existing job still executed, deploy-contract checks executed on a hosted runner, and fixed check names `ci-required`, `codeql`, and `gitleaks`.

### Milestone 3: Repair critical safety contracts in PR 3

On branch `agent/deploy-safety-contracts`, change `infrastructure/ansible/inventory-talkplaza.yml` so `clients.children.kiosk` and `clients.children.signage` are the canonical terminal groups. The coordinator, both inventories, and `deploy-staged.yml` must select the same group names. Add a fixture-based regression that proves every release target belongs to exactly one actual play group and no release host is lost or duplicated.

Correct `infrastructure/ansible/tasks/rollback-configs.yml` so service restoration selects only the newest backup belonging to the current run. Strip exactly one `YYYYMMDD_HHMMSS` suffix from the backup basename to reconstruct the original `.service` filename. Do not loop over historical backups. Tests must use real-looking names such as `kiosk-browser.service.20260715_063000` and prove that the destination is `/etc/systemd/system/kiosk-browser.service`.

Move the remote non-waiting kernel `flock` ahead of every Pi5 `git fetch`, `git checkout`, and release-state mutation. A later run must fail immediately and must leave remote HEAD, state files, and services unchanged. Use an isolated temporary Git repository and stubbed adapters to prove two concurrent runs cannot both reach checkout.

Keep `--cancel`, `--detach`, and `--job` fail-closed before any mutation until PR 4 supplies the transient-systemd execution identity and cooperative control record. A regression must snapshot HEAD, invoke the disabled cancellation path, and prove that no Git, SSH, or signal operation occurred and HEAD is identical afterward.

Acceptance is passing inventory/playbook consistency, exact backup-name, concurrent-run, and cancel-with-unchanged-HEAD tests. No test may require an actual Raspberry Pi or production inventory connection.

### Milestone 4: Replace the dual coordinator with one coordinator and execution backend in PR 4

Reduce `scripts/update-all-clients.sh` to argument-preserving setup followed by strict `exec` into the Python coordinator. Delete the more-than-two-thousand-line legacy implementation and remove `ROLLING_RELEASE_V2`; there must be no hidden path capable of selecting a second coordinator.

Keep `scripts/deploy/rolling-release.py` as the compatible Python entry point, but move implementation into a `scripts/deploy/rolling_release/` package. Separate the CLI parser, plan and policy decisions, durable state and locking, and execution adapters. Suggested modules are `cli.py`, `planner.py`, `policy.py`, `state.py`, `lock.py`, `backends/pi5.py`, and `backends/ansible.py`. Policy modules return decisions and reasons; adapters execute commands but do not decide scope or rollback.

Unify remote execution around one transient systemd unit named from the run ID. The unit must own the non-waiting `flock`, then fetch and check out the immutable SHA, then `exec` the Python remote runner. A normal invocation starts the unit and waits for terminal state. `--detach` returns the run ID after systemd accepts the unit. `--status`, `--approve`, and `--cancel --reason` read both the unit state and release state so a crashed process cannot look successful.

Reject `--follow`, `--foreground`, `--profile`, `--job`, and `--attach` with exit status 2 and a concise replacement. Omitting `--foreground` is the replacement for foreground behavior; `--detach` replaces `--job`; `--status RUN_ID` replaces `--follow` and `--attach`; normal GitHub Actions and systemd timing replace the unsupported profile mode. There must be no compatibility fallback that silently accepts these options.

Allow `--skip-canary-hold` only when `--emergency-override --reason TEXT` is also present. Validate this before contacting a remote host. Cancellation must be cooperative: record the reason, signal the unit through the defined cancellation boundary, and let the coordinator stop between phases without a fetch, checkout, direct lock deletion, or untracked kill procedure.

Acceptance includes CLI contract tests for every retained and retired option, systemd command construction, foreground wait, detached run ID, status reconciliation, approval, cancellation reason, emergency override, and proof that the shell contains no `ROLLING_RELEASE_V2` or legacy coordinator body.

### Milestone 5: Introduce durable fleet state and make minimization standard in PR 5

Create `logs/deploy/fleet-release-state.json` as the only release-decision source of truth. The persisted schema has top-level `generation`, `activeRun`, `lastRun`, and `fleet`. `generation` is a monotonically increasing integer used to reject stale writers. `activeRun` is either null or the current run summary. `lastRun` retains the most recently terminal run. `fleet` maps inventory host names to evidence.

Every host record contains `role`, `desiredSha`, `currentSha`, `previousSha`, `evidence`, `verifiedAt`, and `lastRunId`. The Pi5 record additionally contains `activeSlot`, `apiImage`, `webImage`, `configDigest`, and `migrationDigest`. Use atomic temporary-file replacement under the common fleet lock. Only live verification may set `evidence` to `verified`. Unreachable hosts, timeouts, interrupted runs, partial success, and failed rollback must set or retain `unknown`.

Seed state only for a host whose live Git HEAD and required services were checked. For the Pi5, also check the checkout identity, active Blue/Green slot, API/Web image identities, configuration digest, and migration-source digest. Authenticated endpoint and device readiness evidence are added in PR 6. Never seed from inventory declarations, old log text, or an assumed branch. `--print-plan` is strictly read-only and must not create or update the fleet state file.

Make target minimization the default. Exclude a host only when its durable evidence is `verified` for the desired release and role-specific digests. Add `--full-fleet` to force every inventory host into scope. Keep one temporary warning-emitting alias for default minimization and remove it after successful production acceptance in PR 8. Do not transplant the client-only compatibility option from PR #1003. If a Pi5-required difference is present and `--limit` excludes Pi5, or if any unknown-evidence host falls outside an explicit limit, fail closed before execution.

During the compatibility interval, dual-write the old Pi5 release marker and old run snapshot after the new state write succeeds. Reads prefer the new fleet state and use legacy data only through an explicit compatibility adapter. Pi4 recovery must acquire the same fleet lock and update the same fleet state so recovery cannot race a release.

Acceptance includes tests for an unknown baseline, verified exclusion, no-op planning, partial success, timeout, rollback success and failure, crash between atomic writes, reboot with `activeRun`, stale generation, and print-plan non-mutation. A same input and same observed state must produce the same ordered plan and reasons.

### Milestone 6: Unify Pi5 and terminal execution, health, acknowledgements, and rollback in PR 6

Split Pi5 execution into four explicit coordinator stages: host configuration convergence, migration plan, candidate image build, and Blue/Green switch. Ansible configuration changes to the server are not satisfied merely because an image changed. Each stage records evidence that the next stage consumes.

Move migration guarding under the coordinator and leave exactly one implementation. Reconstruct the final Pi5 behavior from `c5d8a4da`, `19ccd48e`, and `99cd44a6`; do not cherry-pick any of those commits as a unit. Preserve the migration ledger work already merged from PR 1, first-signage control behavior, and the image dependency-cache behavior without importing unrelated code.

Reconstruct the final client lifecycle behavior from `c5d8a4da`, `85fe6198`, and `1f64d5b4`, again at behavior level rather than commit level. Add `scripts/deploy/tests/test-client-agent-lifecycle-selection.py` or an equivalently named executable contract and connect it to hosted CI in this PR. The test must prove that agent changes are classified before repository synchronization destroys the previous-diff evidence and that only the intended client lifecycle runs.

Record the post-candidate-build load evidence and let Phase 3 reuse it. This removes one duplicate load wait and should reduce the load-gate portion from roughly 120 seconds to roughly 80 seconds. Do not shorten the five-minute post-switch stability observation or the sixty-second terminal notice.

Remove automatic rollback from inside Ansible blocks. Before changing a host, write a run-specific manifest that records every source, destination, and checksum. The coordinator alone decides rollback and restores only entries from that manifest. A successful rollback sets observed evidence from a fresh health check; a failed or unverifiable rollback sets the host to `unknown` and stops later terminals.

Terminal health requires the expected remote Git HEAD, every required systemd service active, and an authenticated endpoint that returns success. HTTP 401 is failure. An Ansible task using `failed_when: false` may collect diagnostics but cannot contribute successful release evidence.

Extend the existing deploy-status GET response backward-compatibly with a `verifying` phase and `desiredReleaseSha`. Keep all existing fields. Extend ACK handling so existing notice and maintenance acknowledgements continue to work, but a `ready` ACK requires `releaseSha`. A kiosk returns the loaded Web bundle SHA. Signage returns its updated repository SHA. The coordinator removes maintenance only when the ACK SHA equals the desired immutable SHA and terminal health passes.

The Pi5 database is never rolled back. Migration planning accepts only schema changes compatible with the old API during the Blue/Green overlap. Any incompatible SQL stops before candidate activation.

Acceptance includes Pi5 image/config/migration identity, lifecycle selection, manifest-only rollback, Kiosk bundle ACK, signage SHA and endpoint, active services, 401 rejection, mismatched release ACK, timeout, load-evidence reuse, and unchanged five-minute/sixty-second timing tests.

### Milestone 7: Enforce staged CI and configure the GitHub ruleset in PR 7

Promote the PR 2 classifier from shadow output to job selection. PRs run `workspace-quality`, API, Web, DB/infra, deploy-contract, client, E2E, and Docker/security jobs in parallel according to the changed paths. A docs-only change limited to `docs/**` and root Markdown runs only repo-policy checks. Shared packages select all consumers that import them.

Unknown paths, renames, deletions, workflow files, action definitions, and CI classifier changes select the full suite. This is fail-closed because an unclassified build input is more dangerous than extra CI time. Tests must feed the classifier docs, API, Web, shared, migration, deploy, Docker, workflow, unknown, rename, and delete fixtures and assert exact job sets.

On pull requests, the API job runs the complete API test set without coverage. On `main` push and the daily schedule, run coverage in three shards. A `push` to `main`, `merge_group`, `workflow_dispatch`, and the daily schedule at 02:30 JST always run the full suite regardless of paths. Express 02:30 JST as 17:30 UTC in the cron schedule and note the timezone in a comment.

Conditional jobs are not required checks. The fixed `ci-required` aggregate evaluates every selected result and is the only CI aggregate required by the ruleset. Keep `codeql` and `gitleaks` as separate fixed-name required checks.

First prove a representative PR has successful `ci-required`, `codeql`, and `gitleaks` checks. Then configure the `main` ruleset to require a pull request with zero required approvals, require those three checks, prohibit force-push and branch deletion, and leave “branch must be up to date” disabled. Record the ruleset response or screenshot reference in this plan, but do not duplicate it into the deployment guide.

Acceptance is exact classifier-fixture behavior, no duplicate PR runs, full main/merge-queue/manual/scheduled runs, stable required names, and a read-back of the enabled ruleset matching the stated policy.

### Milestone 8: Complete migration and reduce documentation after production acceptance

Do not begin compatibility removal until the explicitly approved full-fleet acceptance has succeeded and the same-SHA standard plan is a no-op. Then remove reads and writes for the old Pi5 marker, old deployment lock, and old run format. Remove the temporary minimization alias. Keep only the fleet lock, fleet state, transient unit, and public CLI documented here.

Reduce `docs/guides/deployment.md` to the current operator procedure and move historical deployment evidence to month-based archives. Update recovery documentation to remove direct process kills, direct lock deletion, and retired CLI forms. Recovery uses `--status` and cooperative `--cancel --reason` only. Align architecture documents, `AGENTS.md`, and quick-start instructions to the same command forms and state transitions.

PR 8 must not erase accepted evidence from `docs/plans/rolling-terminal-bluegreen-deploy.md`; archive or link it as historical context. Update this plan’s `supersedes` metadata only when the old behavior is actually retired, and set `superseded_by` only if a later source replaces this plan.

Acceptance is a repository search with no legacy option, marker, lock, or run-format fallback outside historical archives; valid Markdown links; a short current deployment guide; and recovery instructions that cannot tell an operator to kill a process or delete a lock manually.

### Reintroduce product changes after the safety program

After production acceptance, reconstruct product commit `de8dcdd7` as three reviewable pull requests: first shared UI extraction, second assembly schema/API/editor behavior, and third deploy-notice placement. Do not cherry-pick `de8dcdd7`. Do not transplant PR #1003 progress-log commits or `0f19936a`.

When every replacement pull request for the deployment and product work is open, comment on PR #1003 with a mapping from its source behaviors to replacement PRs and close it as superseded. Do not merge or force-push PR #1003. Keep the source branch until all replacement PRs are merged so reviewers can still inspect provenance.

### Post-acceptance: Correct immutable-image cache boundaries

Keep the public deployment entry point and every accepted safety gate unchanged. In the final API and Web runtime stages, place `BUILD_COMMIT`, `BUILD_CONFIG_HASH`, and their OCI labels after every filesystem-producing instruction. Keep `VITE_RELEASE_SHA` immediately before the Web application build because the compiled bundle must still identify the exact release. Keep `NDLOCR_LITE_COMMIT`, `APT_CACHE_BUST`, `INSTALL_PLAYWRIGHT_CHROMIUM`, dependency manifests, and base-image selection at their existing dependency boundaries so a real dependency or security change intentionally rebuilds the affected layers.

Add two independent regressions. The deployment contract must parse both final Docker stages and reject provenance arguments or labels placed before a `RUN`, `COPY`, or `ADD`. The existing Docker CI build must then rebuild each image with only `BUILD_COMMIT` and `BUILD_CONFIG_HASH` changed, require identical `RootFS.Layers`, and require each image's labels to contain its own exact values. This reuses the first build's cache and does not publish an image.

The first production build after reordering can be a one-time cache warm-up. Acceptance is measured on the next ordinary server-app release with unchanged dependency inputs: no OCR or Playwright download, no unchanged production dependency install, API plus Web build at or below five minutes, and the complete Pi5 path including the retained five-minute stability observation at or below fifteen minutes. Terminal rollout time is recorded separately. The same-SHA standard plan must remain a no-op. If these warm-cache targets are missed, investigate the remaining uncached layer before proposing a separately reviewed ARM64 registry-build design.

## Concrete Steps

Run repository commands from the repository root unless a command says otherwise. Use a separate clean worktree for every pull request. Never reuse the original PR #1003 worktree for implementation.

Inspect the baseline and the current published PR 1:

    git fetch origin main
    git rev-parse origin/main
    gh pr view 1004 --repo denkoushi/RaspberryPiSystem_002
    gh pr checks 1004 --repo denkoushi/RaspberryPiSystem_002

Expect the baseline to begin at `38e72080969631ababc7c595ef67daca067d327f` for this plan revision and PR #1004 to be open as a draft. If `origin/main` has advanced, do not reset it; use the new tip for the next unstarted milestone and record the SHA in `Progress`.

Validate PR 1 from its clean worktree or checked-out branch:

    git diff --check origin/main...HEAD
    bash -n scripts/deploy/pi5-blue-green.sh
    python3 -m py_compile scripts/deploy/validate-expand-only-migrations.py
    bash scripts/deploy/tests/test-pi5-blue-green.sh

Expect syntax checks to exit zero and the shell test to print `PASS: pi5 blue/green safety lifecycle`. Remove generated ignored bytecode before committing if the test environment creates it. Do not run Prisma against a production database.

Validate PR 2 before publication:

    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    bash scripts/deploy/tests/test-pi5-image-deploy.sh
    python3 -m py_compile scripts/ci/classify_changes.py
    bash -n scripts/update-all-clients.sh
    git diff --check origin/main...HEAD

In the hosted workflow, also run `ansible-inventory --list` for each inventory and `ansible-playbook --syntax-check` for `playbooks/deploy-staged.yml` under the vault-disabled CI configuration. Expect both inventories to parse, the playbook to parse for both, and Summary to show classification without skipping the full suite.

Validate PR 3 with isolated fixtures:

    python3 -m unittest scripts/deploy/tests/test_inventory_playbook_contract.py
    python3 -m unittest scripts/deploy/tests/test_rollback_configs.py
    python3 scripts/deploy/tests/test_rolling_release.py
    bash -n scripts/update-all-clients.sh
    git diff --check origin/main...HEAD

If the final test filenames differ, record the exact replacements in this section before merge. The tests must execute the four named behaviors; a static text-only assertion is insufficient for lock, cancel, and rollback behavior.

For PR 4 through PR 6, keep one common fast contract suite and add milestone-specific tests:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/deploy/tests/test-pi5-image-deploy.sh
    bash scripts/deploy/tests/test-pi5-blue-green.sh
    bash scripts/deploy/tests/test-signage-deploy-maintenance.sh
    bash -n scripts/update-all-clients.sh
    git diff --check origin/main...HEAD

Validate the aggregate terminal preflight correction before any retry of run `20260718-114117-fa74e2`:

    PYTHONPATH=scripts/deploy:. python3 -m unittest \
      scripts.deploy.tests.test_terminal_preflight \
      scripts.deploy.tests.test_systemd_backend \
      scripts.deploy.tests.test_release_application
    PYTHONPATH=scripts/deploy:. python3 -m unittest discover \
      -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    bash -n scripts/update-all-clients.sh
    git diff --check

Expect the focused suite, the complete deployment suite, and the static safety contract to pass. The release application test must prove migration preflight, then aggregate terminal preflight, then transient-unit submission. It must also prove that a multi-host, multi-error result and `--preflight-only` both stop before unit submission. After hosted CI succeeds, run the public `--preflight-only` command against the explicitly approved Pi5 and StoneBase scope. Do not retry the release until the read-only result is clean and every repair was applied through an authorized provisioning path.

Run the client lifecycle executable contract from PR 6 explicitly:

    python3 scripts/deploy/tests/test-client-agent-lifecycle-selection.py

Expect it to exit zero and prove behavior with fixture repositories; it must not contact a terminal.

For PR 7, exercise classifier event and path fixtures locally, then inspect one representative hosted PR:

    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    gh pr checks <representative-pr-number> --repo denkoushi/RaspberryPiSystem_002

Do not enable the ruleset until that output contains successful checks named exactly `ci-required`, `codeql`, and `gitleaks`. After enabling it, read the ruleset back through GitHub and compare every setting with Milestone 7.

Before PR 8, execute the production acceptance sequence in `Validation and Acceptance`. This is not authorized by creation or merge of this plan. Stop after the two read-only plans and request explicit approval for `infrastructure/ansible/inventory.yml`, then separately for `infrastructure/ansible/inventory-talkplaza.yml`.

At every stopping point, update `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`, then run documentation checks:

    git diff --check
    git diff -- docs/plans/deployment-foundation-refactor-execplan.md docs/INDEX.md
    rg -n '\?\?\?' docs/plans/deployment-foundation-refactor-execplan.md docs/INDEX.md
    awk 'length($0) > 1000 { print FNR ":" length($0) }' docs/plans/deployment-foundation-refactor-execplan.md docs/INDEX.md

The corruption and long-line commands must print nothing for added lines. Validate every changed relative Markdown link before committing.

## Validation and Acceptance

Repository acceptance is cumulative. Migration tests prove restored history, missing history, checksum mismatch, Expand-only rejection, and zero-new validation. Lock and state tests prove lock-before-checkout, concurrent runs, crash/reboot, cancellation in every phase, partial success, timeout, successful rollback, failed rollback, and an unknown baseline. Inventory tests prove every release target belongs to exactly one real play group. Health tests prove Pi5 image/config/migration identity, Kiosk bundle ACK, signage SHA and authenticated endpoint, and active required services. CLI tests prove retained forms, exit 2 for retired forms, and absence of a hidden fallback. CI tests prove exact classification for docs, API, Web, shared, migration, deploy, Docker, workflow, unknown, rename, and delete inputs.

Production acceptance must occur in this order:

1. Confirm a clean release worktree and successful `ci-required`, `codeql`, and `gitleaks` for the immutable target SHA.
2. Run `--print-plan` for `infrastructure/ansible/inventory.yml` and `infrastructure/ansible/inventory-talkplaza.yml`. Confirm target reasons and confirm that every unknown host remains included. These calls may read live evidence but must not create state or mutate a host.
3. Stop and obtain explicit approval for each inventory. Approval for one inventory does not authorize the other.
4. Run `--preflight-only` against the approved target scope. Require one complete report, zero terminal issues, zero release-unit submission, and no fleet-state or host mutation.
5. For the first accepted run only, use `--full-fleet` and preserve the order Pi5, canary, remaining terminals one at a time. The normal run must repeat the same migration and terminal gates before submission.
6. Confirm every host has `evidence=verified`, Pi5 image and configuration digests match, no maintenance state remains, and the database migration ledger and checksums match the repository.
7. Run the standard plan for the same SHA and observe a no-op with every exclusion explained by verified evidence.
8. Do not inject a failure or deliberately roll back in production. Prove those paths only in an isolated fixture or lab environment.

During the seven days after CI enforcement, acceptance targets are zero duplicate workflow runs, docs-only completion within two minutes, deploy-only completion within four minutes, API/Web pull requests within six minutes, a `main` full-suite median within nine minutes, and at least a forty-five percent reduction in runner minutes per pull request. Measure completed workflow runs, not anecdotal wall-clock observations.

If even one main-only failure is caused by a missed path classification, disable only the conditional job expressions so pull requests return to the full suite. Keep duplicate-trigger removal and the fixed required checks. Add the missed path as a failing classifier fixture before re-enabling conditions.

The program is complete only when PR 8 is merged, production evidence meets the sequence above, the same-SHA plan is a no-op, the seven-day CI window meets or explicitly rolls back its conditional selection, and PR #1003 is closed with a complete replacement map.

## Idempotence and Recovery

All read-only plans and fixture tests must be safe to repeat. `--print-plan` never creates fleet state. State writes use a generation check, the fleet lock, a temporary file, `fsync` where supported, and atomic replacement. After interruption or reboot, `activeRun`, the transient systemd unit, and observed host evidence determine whether to resume, cancel, or mark the run interrupted; a stale PID or manually deleted lock is never the authority.

The kernel lock is process-owned and non-waiting. If it is held, a later run exits before fetch, checkout, or state change. If its process dies, the kernel releases it. Never recover by deleting the lock path while an owner may exist. Never recover by force-checking out a branch over an active run.

Database migration recovery is forward-only. Restoring a missing repository migration file is safe only when its checksum matches the already-applied ledger. A missing or changed applied migration stops the release. Do not issue a down migration. If an Expand-only candidate fails before activation, fix the repository or add a new forward migration.

Terminal rollback is run-manifest scoped. Repeating rollback reads the same manifest and verifies checksums; it does not select a newer-looking global backup. A rollback failure leaves evidence `unknown`, retains maintenance as appropriate, and stops the rollout. Pi5 rollback switches compatible API/Web images but never reverses the database.

Git recovery preserves work. Do not use force-push, hard reset, or checkout to discard another worktree’s changes. If a pull request must be rebased after earlier merges, prefer a new branch or a normal merge/update that preserves review history; never rewrite PR #1003.

If CI conditional selection is unsafe, use the documented full-PR-suite fallback. If the production release cannot establish verified evidence, stop, record the run as failed or interrupted, and leave uncertain hosts in scope for the next approved plan.

## Artifacts and Notes

Current replacement map at this revision:

    PR 1 / #1004:
      4a5d64a8 -> e1e4f29b
      01999607 -> b9b6c7d1
      284e0bc5 -> 4b57a494
      c5d8a4da migration-only behavior -> a06658fb
      independent-review hardening -> d755a679
      reviewed implementation head -> d755a679, with candidate commit-object ledger, A-only diff, quote-aware parsing, and built-in type allow-list
      refreshed PR head -> 83fbb379; merged -> d9abaa6e
      focused evidence -> 22 tests passed; 144 base / 146 candidate migrations verified; 19 rejects / 7 allows passed; two independent reviews found no remaining P1/P2 blocker
      hosted state -> both suites 11/11 success; final refreshed suite slowest API shard 8m34s
    PR 2 / #1005:
      CI baseline and deploy-contract shadow -> f0cadcdd
      hosted history-depth correction -> 98c3dae4
      reviewed implementation head -> efa93df4, including client-lifecycle baseline and merge-base diff coverage
      refreshed branch head -> 50e3eeaa, including main integration commit 5b1744aa and the living-plan record
      merged -> bf238688
      hosted state -> refreshed ci-required, codeql, gitleaks, and every constituent check green; API shards 8m05s / 7m36s / 7m33s, lint and deploy-contract 4m31s, no feature-branch push duplicate
    PR 3 / #1006:
      three focused commits -> canonical inventory groups, exact-set rollback, pre-checkout flock
      reviewed implementation head -> e33ecadb
      refreshed from main bf238688 -> merge commit 01ae9ffc
      successful-lock-path hardening -> f3d39012, including missing-parent creation after kernel lock and a fresh-checkout Linux regression
      test state -> first refreshed hosted run passed rolling release 78 with no Linux skip, deploy safety, all three API shards, E2E, CodeQL, gitleaks, and both Docker jobs; only the retired pnpm 9 audit endpoint failed
      audit recovery -> pinned pnpm 11.4 bulk client on Node 22, critical required and high informational, no registry fail-open; local bulk audit found 2 low / 10 moderate / 0 high-critical
      final PR head -> f98aebf2; merged -> 0b24be7f
      final hosted state -> run 29379111287 fully green across ci-required, deployment/Linux lock, inventory/Ansible, API/E2E, CodeQL, gitleaks, audit, and Docker checks
    PR 4:
      branch -> agent/deploy-single-coordinator, based on merged 0b24be7f
      public entrypoint -> strict argument-preserving exec into scripts/deploy/rolling-release.py; no ROLLING_RELEASE_V2 or shell coordinator body
      execution identity -> raspi-release-<runId>.service, Type=exec, system manager via sudo -n, explicit deploy user, verified InvocationID and MainPID
      bootstrap -> non-waiting global flock, clean check before fetch and after checkout, immutable SHA plus protocol marker, inherited exact lock FD
      state/control -> separate atomic JSON files, per-run flock, first cancel reason immutable, terminal/cancel race linearized, read-only legacy status adapters retained
      retired paths -> server deploy, detached deploy, deploy-executor, and deploy-all are side-effect-free exit-2 refusal stubs; direct Ansible emergency bypass removed
      local evidence -> 222 deploy Python tests, single-entrypoint contract, Ansible/inventory safety contract, Python/Bash syntax, and three independent reviews with no remaining Blocker/P1/P2
      final PR head -> c22da82285d213c8b10ce7552672c447239e598a; merged -> ccdc624af9f168f5fee40cf25a0a9b507e091ddc
      hosted state -> runs 29384459577 / 29384459580 / 29384459587; 12 successes, zero failures, one neutral skipped auxiliary CodeQL job
    PR 5:
      branch -> agent/deploy-durable-fleet-state, based on merged ccdc624a
      authority -> logs/deploy/fleet-release-state.json with strict schema, generation CAS, synced atomic replacement, and logs/deploy/fleet-release-state.lock
      planning -> verified host-specific Git baselines, default role-aware minimization, deterministic reasons, --full-fleet, and fail-closed Pi5 exclusion under --limit
      evidence -> terminal HEAD plus required services; Pi5 checkout identity, matching active image release SHA, active slot, config digest, and migration-source digest
      transitions -> begin/abandon, pre-mutation unknown, post-observation verified, rollback drift, and new-state-first success/failed/cancelled/interrupted finalization
      compatibility -> legacy Pi5 marker and per-run snapshot written only after fleet state; bootstrap and Pi4 recovery hold fleet then compatibility lock
      local evidence -> 321 deploy Python tests, 16 shell contracts plus lifecycle and maintenance checks, 10 isolated PostgreSQL API tests, API lint/type checks, both real inventories parsed with strict release-host ordering, Python syntax, diff check, and two final reviews with no P1/P2
      publication/hosted state -> first run 29394157999 exposed and removed an unsafe production-inventory print-plan smoke; final head 5441065e passed refreshed validation and merged as deab7d5e
    PR 6:
      branch/base -> agent/deploy-executor-health-rollback from merged deab7d5e
      accepted commits -> client lifecycle selection 629933e1; release-bound ready acknowledgement 6a1869c1; Pi5 host convergence and live config evidence b1c98f32; terminal readiness and authenticated health 6e9ad694; manifest and interrupted-terminal recovery c12ff20a through 4e8f0253; final unified executor/health/rollback 1af8f1ab
      final behavior -> exact terminal file/repository/runtime manifest rollback; controller-owned legacy-signage and Kiosk readiness; dedicated Pi5 host-config transaction; canonical migration plan/live-ledger gate; run-scoped candidate identities and bounded retirement; durable bootstrap/prepare/switch/monitor/cleanup recovery; reusable post-build load evidence
      local evidence -> 540 deploy Python tests, Pi5 image/Blue-Green/migration shell contracts, terminal lifecycle and signage maintenance, deployment safety graph, focused API 41/41, API lint/build, Ansible both-inventory syntax, Python/Bash syntax, diff check, commit lint hook, and final terminal/Pi5 audits with no reported blocker
      publication -> PR #1010 final head f29ec691 passed fixed and constituent checks; merged as 0efcbb34
      main verification -> CI 29449339822, CodeQL 29449339819, Secret scan 29449339758, and Pages 29449338992 all succeeded
    PR 7:
      branch/base -> agent/ci-staged-enforcement-ruleset from merged 0efcbb34
      local behavior -> enforced fail-closed classifier outputs; conditional repo/workspace/API/Web/DB/deploy/client/E2E/Docker jobs; PR full API without coverage; non-PR coverage in three shards; exact aggregate result validator; full push/merge-group/manual/scheduled suite; fixed codeql/gitleaks merge-group triggers
      local evidence -> 20 CI unit/contract tests, actionlint 1.7.12, YAML parse, client 30 tests, deploy 540 tests, Pi5/terminal shell contracts, deploy safety, workspace lint/shared tests, Web tests/build, API build, and diff check
      hosted evidence -> CI 29453076579, CodeQL 29453076581, and Secret scan 29453076670 succeeded at 425b8d9f; ci-required and all ten selected jobs passed
      ruleset -> active main ruleset 19014580 read back with PR required, zero approvals, ci-required/codeql/gitleaks, strict up-to-date false, deletion/non-fast-forward denied, and no bypass actors
      publication -> Draft PR #1011; final documentation head checks, merge, and seven-day observation remain
    PR 8: pending production acceptance
    Product reconstruction: pending deployment-foundation production acceptance

An example fleet state shape is:

    {
      "generation": 12,
      "activeRun": null,
      "lastRun": {
        "runId": "20260715-063000-a1b2c3",
        "status": "success",
        "desiredSha": "0123456789abcdef0123456789abcdef01234567",
        "inventory": "infrastructure/ansible/inventory.yml",
        "startedAt": "2026-07-15T06:30:00Z",
        "endedAt": "2026-07-15T06:42:00Z",
        "kind": "release"
      },
      "fleet": {
        "raspberrypi5": {
          "role": "server",
          "desiredSha": "0123456789abcdef0123456789abcdef01234567",
          "currentSha": "0123456789abcdef0123456789abcdef01234567",
          "previousSha": "89abcdef0123456789abcdef0123456789abcdef",
          "evidence": "verified",
          "verifiedAt": "2026-07-14T21:30:00Z",
          "lastRunId": "20260715-063000-a1b2c3",
          "activeSlot": "green",
          "apiImage": "raspisys-api:0123456789abcdef0123456789abcdef01234567-aaaaaaaaaaaa",
          "webImage": "raspisys-web:0123456789abcdef0123456789abcdef01234567-bbbbbbbbbbbb",
          "configDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "migrationDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        }
      }
    }

Actual state must use complete calculated digests, not the illustrative values above. Host records for kiosks and signage omit Pi5-only fields but retain the common fields.

An example read-only plan should explain inclusion rather than only listing hosts:

    {
      "desiredSha": "0123456789abcdef0123456789abcdef01234567",
      "fullFleet": false,
      "targets": [
        {"host": "raspberrypi5", "reason": "migration digest differs"},
        {"host": "raspi4-kensaku-stonebase01", "reason": "evidence unknown"}
      ],
      "excluded": [
        {"host": "raspberrypi3", "reason": "verified at desired SHA"}
      ]
    }

The PR #1003 supersession comment must map each retained behavior to a replacement PR, name intentionally omitted progress-only commits and `0f19936a`, link the three product reconstruction PRs, state that #1003 was not merged, and explain that its source branch remains until all replacements merge.

## Interfaces and Dependencies

The supported public CLI at the end of PR 5 is exactly:

    update-all-clients.sh <branch> <inventory> [--limit PATTERN] [--full-fleet] [--detach]
    update-all-clients.sh <branch> <inventory> --print-plan
    update-all-clients.sh <branch> <inventory> --preflight-only [--limit PATTERN]
    update-all-clients.sh --status RUN_ID
    update-all-clients.sh --approve RUN_ID
    update-all-clients.sh --cancel RUN_ID --reason TEXT

A normal invocation without an execution-mode option waits in the foreground. `--dry-run` remains an alias for `--print-plan`. `--preflight-only` runs immutable migration checks and one secret-free aggregate probe over the selected terminal universe, returns structured evidence, and never creates a release run or transient unit. It is mutually exclusive with execution, detach, plan, approval, cancellation, and emergency-override modes. `--skip-canary-hold` is accepted only together with `--emergency-override --reason TEXT`. The retired `--follow`, `--foreground`, `--profile`, `--job`, and `--attach` forms return exit status 2 and print their replacement. There is no `--client-only-compatible` interface.

Status retains terminal values `success`, `failed`, `cancelled`, and `interrupted`. It adds each host’s desired SHA, current SHA, evidence, and target reason. Intermediate phases may include `planning`, `waiting-approval`, `preparing`, `verifying`, `rolling-back`, and `cancelling`, but they must not be mistaken for terminal success.

Deploy-status GET keeps its existing response fields and adds `verifying`, `desiredReleaseSha`, `verificationCycle`, and an opaque `verificationId`. Existing notice and maintenance ACK payloads remain valid. A `ready` ACK requires both `releaseSha` and the exact active `verificationId`; readiness without either is invalid. The Kiosk value represents the loaded Web bundle SHA, while signage represents its updated repository SHA.

The coordinator depends on Python 3 standard-library code for policy and JSON state, Linux `flock`, systemd transient units, Git, SSH, Ansible, Docker Compose, and the existing authenticated API health surface. Policy code must not shell out. Execution adapters own subprocess calls and return structured results. Tests replace SSH, systemd, Docker, Ansible, HTTP, time, and filesystem boundaries with fixtures.

GitHub Actions exposes fixed checks `ci-required`, `codeql`, and `gitleaks`. `ci-required` is the conditional-job aggregate. The ruleset does not require conditional job names and does not require the branch to be up to date.

## Local Notes JA

- 「通常のproductデプロイは安全基盤の本番検証完了まで凍結」を継続する。計画書やPRの承認は、実機変更の承認ではない。
- 「根拠不明hostは必ず対象に含める」。`unknown` を除外理由にしない。
- 端末デプロイは「1台ずつ」。Pi5の5分安定化と端末の60秒通知は短縮しない。
- Dockerfileのキャッシュ境界を変えた最初のPi5ビルドは一度だけ重くなり得る。短縮効果は次の依存関係不変リリースで測り、安全ゲートは時間短縮の対象にしない。
- `--print-plan` 後に停止し、「inventoryごとに明示承認」を受ける。第2工場の承認をTalkplazaへ流用しない。
- 実行承認後も、最初に `--preflight-only` で全端末の停止要因を一括確認する。一件ずつ直してデプロイを再試行せず、全件を正規のprovisioningで解消してから同じ事前検査を再実行する。
- 本番で「故障注入」や「意図的rollback」は実施しない。隔離テストで確認する。
- PR #1003 は参照用に残し、merge・force-pushしない。置換PR対応表をコメントしてから `superseded` としてcloseする。

Revision note (2026-07-14): Created the sole active ExecPlan for the approved eight-PR deployment-foundation refactor. It records Draft PR #1004, the in-progress PR 2 and PR 3 branches, the missing baseline client-lifecycle test and its PR 6 deferral, the `38e72080` baseline, the absent `develop` branch, and the explicit prohibition on real-device actions before per-inventory approval.

Revision note (2026-07-14, 21:43Z): Updated living status after Draft PR #1005 publication. Recorded the verified absence of duplicate push-event runs, the classifier pass, the depth-two hosted-history correction, PR #1004's runner-disk-only Trivy failure and queued rerun, PR 3's 69-test plus safety-script local result, and the continued absence of real-device actions.

Revision note (2026-07-14, 22:19Z): Recorded green hosted validation for Draft PRs #1004 and #1005, publication and isolated test evidence for Draft PR #1006, and the decision to keep cancel, detach, and job operations fail-closed until PR 4 provides one transient-systemd execution identity. Reaffirmed that no merge, product deployment, real-device action, or change to open Draft PR #1003 occurred.

Revision note (2026-07-14, 22:32Z): Recorded completion of Draft PR #1006 hosted validation. CodeQL, all three API shards, lint, E2E, gitleaks, and Docker checks are green; the infrastructure shard completed in 9m05s. Merge and real-device gates remain unchanged.

Revision note (2026-07-14, 22:45Z): Recorded the independent PR #1004 migration-gate review. Green checks are retained as evidence, but PR 1 is blocked pending candidate-wide unapplied migration validation, quote-aware SQL parsing, an addition-only migration diff contract, and a fresh hosted run.

Revision note (2026-07-14, 23:10Z): Recorded resolution of the PR #1004 review blocker at head `d755a679`. The candidate-wide immutable ledger, A-only migration diff, quote-aware ASCII/Unicode boundaries, and built-in type allow-list pass 22 focused tests, two independent reviews, and a hosted rerun with 11 of 11 checks successful and no failures or skips. Merge and real-device gates remain unchanged.

Revision note (2026-07-14, 23:36Z): Recorded the user's ordered-merge approval, the merge of ExecPlan PR #1007 at `3ea5d442`, and the refresh, 11-of-11 hosted rerun, and merge of migration PR #1004 at `d9abaa6e`. PR #1005 is now refreshing from that main; no product deployment, real-device mutation, or change to Draft PR #1003 occurred.

Revision note (2026-07-14, 23:56Z): Recorded the refreshed 11-of-11 hosted success and merge of CI baseline PR #1005 at `bf238688`, including the absence of a feature-branch push duplicate. PR #1006 is now refreshed from that main at `01ae9ffc`; no product deployment, real-device mutation, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 00:04Z): Aligned the PR 2 client-lifecycle and PR 3 cancellation milestones with the recorded decisions, then hardened PR #1006's successful outer-lock path at `f3d39012` so a fresh checkout creates the transitional lock parent only after acquiring the kernel lock. The refreshed local suite passes; hosted Linux validation is pending.

Revision note (2026-07-15, 00:23Z): Recorded the first refreshed PR #1006 hosted run. Every deployment and Linux lock contract passed, but npm's retired legacy endpoint returned HTTP 410 to pnpm 9 and correctly failed `lint-build-unit` plus `ci-required`. After explicit approval, isolated the audit on pinned pnpm 11.4 and Node 22, retained the required critical gate and high advisory, added a static no-fail-open contract, and verified the bulk audit locally with no high or critical advisory.

Revision note (2026-07-15, 02:14Z): Recorded the fully green final PR #1006 run `29379111287` and merge at `0b24be7f`, then documented the locally complete PR 4 single-coordinator implementation. PR 4 now has one systemd execution identity, atomic state/control, cooperative cancellation, strict immutable-target checks, explicit legacy status compatibility, no alternate mutating entrypoint, 222 passing deploy Python tests, passing shell/Ansible safety contracts, and three independent reviews with no remaining Blocker/P1/P2. No product deployment, real-device mutation, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 03:57Z): Recorded PR #1008 exact head `c22da822`, its fully green hosted validation, and merge as `ccdc624a`, then documented the locally complete PR 5 durable fleet-state implementation. The new plan distinguishes Pi5 checkout identity from active image release identity, minimizes only from verified host evidence, writes unknown before mutation, orders authoritative state before compatibility data, and gives Pi4 recovery the same fleet lock/state plus the transitional compatibility lock. The deploy Python suite passes 285 fixture-only tests and both real inventories pass the safety contract. No product deployment, real-device mutation, production acceptance, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 04:22Z): Recorded the PR 5 independent-review corrections: independent service probes, fail-closed limits for unknown evidence, pre-fleet-only marker fallback, exact inventory server authority for recovery, source-digest release attribution, rename-safe classification, canonical print-plan SSH behavior, safety-error propagation, and a fleet-capable v2 target protocol. The deploy Python suite now passes 295 tests and all isolated deployment shell contracts pass. Publication remains pending; no SSH, product deployment, real-device mutation, production acceptance, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 06:03Z): Recorded the final PR 5 hardening and validation: exact target-tree binding, non-secret Pi5 site identity, conservative active-run planning, absent-only evidence seeding, one crash-safe deploy-status writer with strict notice-duration validation, explicit per-host Pi4 recovery capability, 321/321 deploy tests, all shell contracts, and 10/10 isolated PostgreSQL API tests. Two final reviews report no P1/P2. Publication remains pending; no SSH, product deployment, real-device mutation, production acceptance, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 06:29Z): Recorded Draft PR #1009 publication at implementation head `23c5f763` and the first hosted failure. The failure proved the exact-checkout guard: a legacy CI smoke combined the PR merge checkout with branch `main`. It was removed because changing it to `HEAD` would let hosted CI attempt a real production-inventory SSH plan; a new static contract prohibits that class of workflow call. Refreshed hosted validation remains pending. No SSH, product deployment, real-device mutation, production acceptance, merge, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 07:32Z): Recorded the refreshed PR #1009 success and approved merge as `deab7d5e`, then the first local PR 6 checkpoint. Client build/recreate selection and release-bound ready ACK state are committed after no-P1/P2 reviews. The uncommitted Pi5 host-config slice passes 325 deploy tests but fresh review found one P1 and two P2 issues: preserve outgoing-container genre images, prove candidate environment application before verified evidence, and strengthen safety/continuation regressions. These findings plus the unfinished health, emitters, manifest rollback, migration, load, and executor slices are the exact restart point. No SSH, production action, push, PR publication, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 09:15Z): Recorded local correction, two clean post-fix reviews, and commit `b1c98f32` for the PR 6 Pi5 host-config slice. Genre images are rescued fail-closed from stopped legacy containers without overwriting host files; exact active API environment evidence binds image defaults, Compose values, and unset semantics; only an active coordinator-owned expired handoff can use structural recovery; and AST plus continuation tests cover the full server play graph, multiline runtime commands, host-config failure, and cancellation. The deploy Python suite passes 344 tests and all focused shell, Ansible, helper, syntax, diff, and commit-lint checks pass. The remaining terminal, rollback, migration, load, and executor slices are pending. No SSH, production action, push, PR publication, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 10:16Z): Recorded local commit `6e9ad694` for the PR 6 terminal readiness and health slice. Exact bundle/HEAD readiness is bound to an opaque release-or-rollback verification challenge; terminal evidence requires authenticated identity, exact HEAD, successful status-agent execution, lightdm, and every required unit before maintenance cleanup. The slice passes 363 deploy tests, 1,430 Web tests, 20 isolated PostgreSQL API tests, lint/type checks, and focused shell contracts, with no remaining slice-local P1/P2. Publication remains blocked because the current general-playbook rollback is not manifest-only; the next slice must also use a controller-owned ready probe when restoring a pre-protocol signage script. No SSH, production action, push, PR publication, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 14:22Z): Recorded local PR 6 implementation completion at `1af8f1ab`. Terminal release now seals exact file, repository, systemd, and Docker authority before mutation and uses coordinator-only rollback plus controller-owned readiness. Pi5 host configuration is a dedicated three-environment manifest transaction; candidate build, Prisma plan/live ledger, run-scoped image identity, Blue/Green switch, five-minute monitoring, cleanup, and hard-kill takeover have one coordinator owner. The duplicate Phase 3 load gate is replaced by sealed post-build evidence while the five-minute hold remains. Final local evidence is 540/540 deploy Python tests, all Pi5 and terminal shell lifecycles, 41 focused API tests, API lint/build, both-inventory Ansible syntax, static safety contracts, syntax/diff checks, and clean final audits. PR 6 is not pushed or published; no SSH, production action, production acceptance, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 20:20Z): Recorded explicit approval, branch publication, and Draft PR #1010 creation from head `be1634a8`. GitHub created CI, CodeQL, and gitleaks checks immediately. Hosted validation remains pending; no merge, SSH, real-device deployment, database mutation, production acceptance, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 20:32Z): Recorded the fully green hosted result for Draft PR #1010 implementation head `f86e51fc`. CI run `29448017438`, CodeQL `29448017389`, and Secret scan `29448017406` succeeded; all eleven executable PR jobs including `ci-required`, fixed-name `codeql`, `gitleaks`, three API shards, E2E, lint/build, and Docker API/Web are green. The auxiliary `CodeQL` aggregator is intentionally neutral. The user explicitly approved completion through merge after CI success; this documentation-only validation record must receive the same required checks first. No merge, SSH, real-device deployment, database mutation, production acceptance, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 21:24Z): Recorded PR #1010 final-head validation, approved merge as `0efcbb34`, and successful merge-commit CI, CodeQL, Secret scan, and Pages workflows. Started PR 7 from that exact base with enforced fail-closed classification, ten conditional job contracts, a strict fixed aggregate, full non-PR events, and merge-group-safe security checks. Local CI, actionlint, workspace, API/Web, client, deploy, and Pi5/terminal contracts pass. The repository currently has no competing ruleset or branch protection; ruleset mutation remains gated on a successful representative PR. No SSH, production action, database mutation, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 21:32Z): Recorded publication of Draft PR #1011 from clean head `d7e7ec0f`. The repository ruleset remains unchanged while the representative `ci-required`, `codeql`, and `gitleaks` checks run. No SSH, production action, database mutation, production acceptance, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 21:44Z): Recorded the first PR #1011 hosted run `29452440441`: every selected constituent job succeeded, but `ci-required` could not open its repository-backed validator because the aggregate runner had no checkout. Added the missing checkout and a regression assertion; 20 CI tests, actionlint, and diff checks pass locally. The ruleset remains unchanged until the corrected fixed checks succeed. No SSH, production action, database mutation, production acceptance, or change to Draft PR #1003 occurred.

Revision note (2026-07-15, 21:54Z): Recorded corrected PR #1011 hosted validation at `425b8d9f`: CI `29453076579`, CodeQL `29453076581`, and Secret scan `29453076670` succeeded, including fixed-name `ci-required`, `codeql`, and `gitleaks` plus all ten selected constituent jobs. Created and read back active main ruleset `19014580`; it requires a PR with zero approvals and those three fixed checks, leaves strict up-to-date disabled, denies deletion and non-fast-forward updates, and has no bypass actors. This documentation record must pass the same new ruleset before merge. No SSH, production action, database mutation, production acceptance, or change to Draft PR #1003 occurred.

Revision note (2026-07-16, 01:12Z): The approved second-factory full-fleet run `20260716-002754-518b7a` completed the Pi5 candidate build, switch, five-minute stability monitor, cleanup, and live migration-ledger verification at `5f782489`, then stopped before the first terminal mutation. The terminal rollback identity probe omitted `-b`, but repository `ansible.cfg` enables become globally, so the real Pi5-side command returned `root:/root` and failed closed. A read-only reproduction proved that explicit `ansible_become=false` returns `raspi4-kensaku-stonebase01:/home/raspi4-kensaku-stonebase01`; the smallest adapter correction and regression assertion pass 44 focused tests, all 540 deploy Python tests, and the deploy safety contract. All six terminals remain pending with unknown evidence; retry remains gated on PR checks and merge.

Revision note (2026-07-16, 01:31Z): PR #1018 passed `ci-required`, `codeql`, and `gitleaks`, merged as `9b504bd4`, and its main full CI `29463786023`, CodeQL `29463786027`, and Secret scan `29463786055` succeeded. The approved retry `20260716-012802-159e19` then abandoned the old fleet authority and stopped before mutation while recapturing its runtime manifest: real systemd reports an absent `haizen-agent.service` as `LoadState=not-found`, empty `UnitFileState`, and `ActiveState=inactive`, while the helper accepted only an already-canonical `UnitFileState=not-found`. Read-only inspection found only the owner-only runtime lock and no manifest; all terminals remain unchanged. The exact absent-unit triple now normalizes to canonical `not-found`, while an empty unit-file state for a loaded unit still fails closed; 30 focused tests, all 542 deploy Python tests, and the deploy safety contract pass locally.

Revision note (2026-07-16, 01:58Z): PR #1019 passed its fixed required checks, merged as `7dacdfee`, and its main full CI `29464613631`, CodeQL `29464613574`, and Secret scan `29464613597` succeeded. Approved retry `20260716-014721-963494` passed checkout and the real absent-unit normalization, then stopped before terminal mutation because the rollback adapter requested the repository root as the Docker Compose working directory. Read-only inspection of all five second-factory kiosks proved their Compose labels consistently use `/opt/RaspberryPiSystem_002/infrastructure/docker`; the adapter now seals that exact runtime context and retains the same absolute config file. All terminals remain unchanged and the next retry remains gated on PR and merge-main validation.

Revision note (2026-07-16, 03:15Z): PR #1020 passed all fixed checks, merged as `31ef395a`, and its main full CI, CodeQL, Secret scan, and Pages workflows succeeded. Approved run `20260716-020945-92dca8` then completed the Pi5 build, switch, five-minute monitor, cleanup, and live ledger verification at that SHA.

StoneBase completed its sixty-second notice and maintenance acknowledgement but its release-only checkout failed after partially writing `.dockerignore`; coordinator rollback retained maintenance and stopped all later terminals because the repository was no longer clean. Read-only evidence proves HEAD and index remain at prior SHA `85fe6198`, `.dockerignore` alone matches candidate `31ef395a`, old services and Docker workloads remain live, and mixed root-owned tracked directories caused the unprivileged reset failure.

The local recovery hotfix uses root only for immutable Git checkout and extends the sealed rollback manifest with an exact candidate-residue proof; it does not add a normal hold, approval, or broad `chown`. Focused tests pass 85/85 and production remains paused pending PR and merge-main validation.

Revision note (2026-07-16, 04:37Z): PR #1021 merged as `e1584e3d` and proved exact StoneBase file, repository, systemd, and Docker rollback. PR #1022 then merged as `d82e1d24` with green PR and exact-main checks, correcting interrupted Kiosk ready identity to the verified Pi5 Web SHA. Approved retry `20260716-041146-930ac2` stopped before new release mutation because replaying the file manifest created expected systemd daemon-reload drift after a durable runtime-restored receipt had already been written.

The user approved replacing serial production discovery with one combined recovery correction. The local branch now performs an automatic read-only aggregate preflight across all affected interrupted terminals before any host mutation, validates rollback ready identity at the same boundary, and lets repeated runtime restore reconcile actual systemd or Docker drift without replacing its valid receipt. This behavior is limited to interrupted recovery and adds no normal approval, notice, hold, or full-fleet prerequisite. Real-incident-derived isolated tests cover receipt-plus-file-replay reconciliation and aggregate multi-host failures; production remains paused until PR and exact-main validation pass.

Revision note (2026-07-16, 04:56Z): Published the combined correction as Draft PR #1023 at implementation head `39b8e38c`, based exactly on main `d82e1d24`. All 555 deploy Python tests and the Pi5 image, Pi5 Blue/Green, client lifecycle, signage maintenance, single-entrypoint, and deploy safety contracts pass locally. The production route from Pi5 to StoneBase is reachable; no rollback, checkout, maintenance change, or new release mutation occurred. Hosted validation and merge remain before the single approved retry.

Revision note (2026-07-16, 05:01Z): Draft PR #1023 passed CI run `29472631700`, CodeQL `29472631695`, and gitleaks `29472631718`; fixed checks `ci-required`, `codeql`, and `gitleaks` are green, and deploy-contract completed in 2m17s. This validation-record commit must pass the same fixed checks before the approved merge. Production remains unchanged.

Revision note (2026-07-16, 06:58Z): PR #1023 merged as `06fb53ed` and exact-main CI is green after one unrelated API random-data collision passed on rerun. Approved full-fleet run `20260716-052933-fff467` successfully reconciled the prior StoneBase interruption, verified Pi5 image/config/migration stability, and committed all five Pi4 kiosks at `06fb53ed`. The final Pi3 stopped before checkout: its thirty-second updater consumed the coordinator's shared `current.tmp.jpg` after displaying and acknowledging maintenance, and rollback rejected the never-fetched candidate object despite a clean prior HEAD. Read-only inspection proves signage-lite and its timer remain active, the repository is clean at `0a2402a8`, and central maintenance is retained. The local correction uses run-scoped maintenance JPG/SHA files covered by the exact manifest and accepts only the clean-prior pre-checkout repository case without candidate-object proof; all 557 deploy Python tests and focused shell contracts pass. No retry has started.

Revision note (2026-07-16, 07:58Z): PR #1024 merged as `431b3302`; exact-main `ci-required`, `codeql`, and `gitleaks` are green. Its first read-only standard plan correctly retained the failed run as active authority, but the deploy-impact classifier treated the controller-only adapter, transferred rollback helper, and deploy tests as unknown, which would unnecessarily rebuild Pi5 and redeploy all five already-verified kiosks. Production remained paused. The follow-up classification distinguishes immutable-checkout deployment control from installed runtime, keeps the signage proof signage-only, and preserves fail-closed handling for every unclassified path. The required recovery run will therefore reconcile the abandoned Pi3 first, replan from verified evidence, and target only signage rather than repeating full-fleet.

Revision note (2026-07-16, 08:02Z): PR #1025 merged as `98001e9c` with green exact-main CI, CodeQL, and gitleaks. The single approved standard run `20260716-073140-3d13b1` stopped before planning or new release mutation while restoring the abandoned Pi3 runtime manifest. File restore and aggregate preflight succeeded, but the 30-second signage updater and status-agent oneshots entered their periodic start at the same second as runtime restore; the helper observed a short-lived transitional systemd state before it had quiesced the timers. No retry started, Pi3 remains at clean prior HEAD `0a2402a8`, its display services remain active, and maintenance authority remains retained. The isolated correction makes preflight treat allowlisted transient oneshot transitions as reconciliation work, then orders restore as timers-off, oneshots-inactive, full observation, daemon reload, and timers-last reactivation instead of adding a delay or operator gate.

Revision note (2026-07-16, 08:37Z): PR #1026 merged as `1818a9eb` with green exact-main CI, CodeQL, and gitleaks. The next single standard run `20260716-075756-dcf507` used that exact checkout and passed the prior periodic-oneshot race, then stopped during interrupted Pi3 runtime reconciliation before any new release plan, fetch, or checkout. Read-only journal and systemd evidence proved an intentional `systemctl stop signage-lite.service` terminated the long-running display process with status 143; systemd correctly quiesced the process but retained `ActiveState=failed`, while the rollback helper required only `inactive`. Timers remain stopped, the Pi3 repository remains at the clean prior SHA, central maintenance remains retained, and no retry started. The isolated correction clears only this post-stop systemd failure bookkeeping with `reset-failed`, then requires an observed inactive baseline before daemon reload and ordered reactivation; it adds no delay, approval, or broader target.

Revision note (2026-07-16, 08:56Z): PR #1027 merged as `eed1a082` with green exact-main CI, CodeQL, and gitleaks. Approved standard run `20260716-085356-6de232` passed the prior stop-status-143 case and restored every sealed Pi3 unit plus timer, then failed closed before writing the runtime receipt because reactivating Persistent timers immediately started their allowlisted update, watchdog, and status oneshots. Read-only journal, systemd state, and preflight show all units now match the sealed runtime, all required timers and signage are active, the repository remains clean at prior SHA `0a2402a8`, and no new release plan, fetch, or checkout occurred. The isolated correction preserves the pre-timer inactive proof, then lets final postflight compare only an allowlisted timer-owned oneshot's durable definition while it is `activating` or `deactivating`; failed state, unrelated transitions, or definition drift still fail closed. No retry started.

Revision note (2026-07-16, 09:45Z): PR #1028 merged as `0d92d19c` with green exact-main full CI and security checks. The user rejected another serial Pi3 production retry and required the same combined error-discovery method that preceded the successful Pi4 rollout. The local exhaustive branch now marks only the terminal whose recovery is starting as unknown, carries fully committed Pi4 success from durable finalization and cleanup proof without a new live dependency, and proves that the recovered scope retains Pi5 and Pi4 while targeting only signage. A full eleven-unit Pi3 runtime scenario composes every observed systemd failure and injects command loss before and after all eighteen mutation boundaries; thirty-six retries converge. Production remains paused while forward-phase coverage, full contracts, hosted validation, and live read-only prerequisites remain incomplete.

Revision note (2026-07-16, 09:53Z): Completed the exhaustive local Pi3 rehearsal without a production retry. Seventeen outer signage failure points now recover before another plan, while eighteen systemd mutation boundaries are each tested for command loss both before and after mutation. Static review found and corrected three pre-production faults: batch-wide unknown contamination, stale desired SHA on a completed Pi4 carry-forward, and unknown-path expansion of the coordinator change to full fleet. Carry-forward now requires the entire validated cleanup proof; read-only inspection confirms all five real Pi4 records satisfy it, and the actual diff from their `06fb53ed` baseline selects signage but not Kiosk or Pi5. The resulting 572-test deploy suite, all focused shell contracts, CI classifiers, both inventories, and deployment playbook syntax checks pass. Pi3 remains clean at `0a2402a8` with all eleven sealed unit states normal, no reload/job residue, 118 MB available memory, approximately 49 GB free disk, and the earlier aggregate rollback preflight successful. Production remains paused; only PR publication and hosted checks remain before requesting a new deployment approval.

Revision note (2026-07-16): PR #1029 merged as `79ab05f8` with successful exact-main CI, CodeQL, and gitleaks. The explicitly approved second-factory release then completed Pi5, all five Pi4 kiosks, and Pi3 signage with every host verified and no maintenance residue; the standard same-SHA plan was a no-op. TalkPlaza Pi5 was not deployed because no physical device exists. From that exact accepted base, local PR 8 removes the old Pi5 marker, compatibility lock, old run-format reads, pre-unified terminal finalization fallback, and temporary minimization alias. It retains only the fleet lock/state, locked current run records, transient unit, and current CLI. Historical evidence is archived, the operator guide is reduced from 5,717 to 134 lines, and recovery uses status plus cooperative cancel only. Local validation passes 571 deploy Python tests, every Pi5/terminal shell contract, 20 CI classifier tests, 20 isolated PostgreSQL tests, both inventories, all deployment playbook syntax checks, the document inventory, archive link checks, and `git diff --check`. No SSH or real-device mutation occurred during PR 8 implementation.

Revision note (2026-07-16): Published local PR 8 as Draft #1030 from head `b1aea44d` with two intentional implementation/documentation commits. Added the complete PR #1004–#1030 replacement map and omitted-source record to Draft #1003, then closed #1003 unmerged as superseded. Its source branch remains intact until #1030 merges. Hosted validation is pending; no real-device action occurred.

Revision note (2026-07-17): Recorded the production image-cache diagnosis and the local post-acceptance correction from `origin/main` `3e669702`. Release-only provenance arguments and labels now follow all final-stage filesystem mutations; the compiled Web bundle remains bound to `VITE_RELEASE_SHA`. Static and live two-build regressions prove exact labels with identical RootFS layers, and the existing 619-test deploy suite plus Pi5 image, Blue/Green, single-entrypoint, deploy-safety, and CI contracts pass. Updated local Trivy scans find zero unignored fixed HIGH/CRITICAL vulnerabilities in both images. The implementation does not change the sealed Git source, run-scoped image identity, migration policy, health/load gates, rollback authority, five-minute hold, terminal sequencing, notice interval, or fail-closed planning. Hosted validation and approved warm-cache production timing remain pending; no SSH or real-device mutation occurred.

Revision note (2026-07-17): Published the cache-boundary implementation as Draft PR #1037 from exact implementation head `1562d3f6`, based on `origin/main` `3e669702`. CI, CodeQL, and gitleaks started. Hosted validation and merge remain pending; no SSH, production deployment, or real-device mutation occurred.

Revision note (2026-07-17): Draft PR #1037 passed CI run `29557294394`, CodeQL `29557294342`, and gitleaks `29557294378` at head `48458edc`. The new API and Web two-build cache regressions, exact provenance labels, identical RootFS layers, Trivy scans, all selected CI jobs, and fixed required checks succeeded. A validation-record commit and its required-check rerun remain before merge; no SSH, production deployment, or real-device mutation occurred.

Revision note (2026-07-18): Run `20260718-114117-fa74e2` exposed that terminal prerequisites were checked serially after maintenance and checkout, and that the PC/SC assertion incorrectly required the socket-activated `pcscd.service` to stay enabled and active. Added a secret-free aggregate terminal preflight before transient-unit submission, a public read-only `--preflight-only` mode, multi-host/multi-error regressions, and the operational `pcscd.socket` plus Unix-socket contract. No release retry is allowed until hosted CI and the real approved-scope preflight-only evidence pass.

Revision note (2026-07-18): The first stacked-branch manual Secret scan exposed an independent workflow-dispatch defect: the upstream action scanned all repository history and rediscovered five unrelated old findings. Split the workflow so event-native runs retain the existing action while manual runs use pinned gitleaks 8.24.3 over `origin/main..HEAD`, with a static contract that prohibits `--all`. No PR base retargeting or production action is used to obtain CI evidence.
