# Run the Hermes search trial on Pi5 with Spark inference

## Purpose / Big Picture

Users will ask questions in the existing consultation interface and receive the
same original-record answers as the accepted Mac trial. Business Pi5 owns the
snapshot, reviewed extraction manifest, SQLite search index, retrieval and answer
projection on its SSD. Spark performs only EmbeddingGemma and BGE inference,
through the existing business authentication and Private workload arbitration.
This is a trial deployment; r10's unresolved accuracy failures remain failures.
This plan follows `.agent/PLANS.md`.

## Progress

- [x] (2026-09-12) Confirm operator approval for Pi5 storage/search and Spark-only inference; preserve Mac r10 evidence and both repositories' existing work.
- [x] Locate QMD's per-store inference adapter, existing business gateway arbitration, and canonical deployments.
- [x] Implement remote inference and focused boundary tests without moving source/index storage.
- [x] Implement and test business/Private stop/admission integration in the separate control-plane branch.
- [x] Package the isolated Pi5 trial behind existing consultation authentication; API typecheck and UI build pass.
- [ ] Review exact changes, required CI and release artifacts for both repositories.
- [ ] Deploy the DGX support first, then exact-limit business Pi5 trial; preserve rollback.
- [ ] Measure final answers, complete-screen latency and Pi5 resource/normal-service impact on the final device version.
- [ ] Complete repository integration and record exact deployed revisions separately from Mac results.

## Context and Orientation

The existing trial lives under `scratch/hermes-qmd-prefetch-worker.mjs` and
`scratch/hermes-ui-prefetch-coordinator.mjs`. QMD at commit
`04e4dbd8245c527a88f1a8f0bda547aef9ca81fb` provides SQLite lexical/vector search.
Its `store.internal.llm` is the per-store inference adapter; its search, chunking
and fusion implementations can therefore remain unchanged. The Mac route must
remain usable while a separately configured remote route is validated.

The authorized snapshot contains 8,209 active-latest nonconformity rows; only 16
reviewed records currently support organized answers. Their source hashes and
UTF16 offsets are validated before display. These private runtime artifacts,
models, credentials and full question/result logs must not enter Git.

`denkoushi/DGXSparkControlPlane` owns the business gateway and Private arbitration.
Its separate feature worktree is `feat/hermes-search-inference`. Changes to that
repository precede the business consumer. The normal business Agent route and
current inference models/profiles remain unchanged.

## Plan of Work

First replace only the trial's local inference boundary with an optional strict
remote adapter. Requests carry inference inputs, never indexes or snapshots.
The adapter validates model identity, vector dimensions and complete score order;
errors remain errors and cannot silently fall back to Pi5 model inference.

Next add a bounded Spark inference runtime. Keep model processes resident between
requests, but stop them before a Private workload can acquire compute. Preserve
the existing business principal and preemption behavior. Runtime state must be
observable even when the usual business generation model is stopped.

Finally expose an isolated trial entry through the existing business API's
authorization. A separate trial must not overwrite normal consultations or make
the Mac-only unauthenticated HTTP facade public. Store trial assets on Pi5 SSD;
keep code release and private artifacts separate. Limit concurrency and return
an explicit unavailable/busy response when inference cannot run.

## Validation and Acceptance

Run focused synthetic protocol and authorization tests first. Verify that number
lookup causes no Spark request, malformed responses fail closed, complete source
spans are retained and local inference cannot load in remote mode. Then verify
the preserved real snapshot on a separate local test run, without adding results
to `work/revision-r10/final-results.jsonl`.

Before any deployment, confirm the exact SHA, required CI and artifacts. Use
Control Plane's canonical release procedure for DGX, and
`scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml
--print-plan --limit raspberrypi5` followed by the same canonical exact-limit
deployment for the business server. Read existing standard Vault credentials in
place; do not copy or invent credentials. No other business endpoint is deployed.

Final evidence must name the actual browser/device and include questions, full
visible answers, screen completion times, CPU/memory and normal API health.
Recheck a numbered answer, broad natural question, numeric-condition failure,
no-match and unused question. Clarifications and partial answers do not count as
answer successes. The goal remains accurate answers in 5–10 seconds.

## Idempotence and Recovery

Keep r10 Mac processes and sealed logs intact until replacement validation.
Deployment uses exact release artifacts and the existing rollback procedures.
Disable the consumer before removing Spark support. Never roll back the business
database, wipe indexes/models, change auth/publication scope or bypass Private
arbitration. A failed deployment remains failed until its actual cause is fixed.

## Surprises & Discoveries

The current QMD SDK exposes the required per-store adapter, so retrieval does not
need a new search product. Its model identity participates in index fingerprints;
portable index metadata needs explicit verified handling rather than silently
re-embedding the entire snapshot during application startup.

## Decision Log

2026-09-12: retain Pi5 data ownership and place only inference on Spark, following
the operator's existing deployment model. Preserve the r10 selection policy and
accuracy limitations during this placement change.

## Outcomes & Retrospective

In progress. No device deployment or device performance result exists yet.

## Artifacts and Notes

The initial lifecycle audit is stored locally as
`outputs/hermes-device-lifecycle-start.json` in the supervising task workspace.
Existing standard Vault path availability was verified without reading values.

Revision note: created for the approved device trial; milestones are not complete
merely because an adapter or model can run locally.

## Trial entry and explicit deployment settings

The device entry is `/hermes-search-device-trial.html` on the existing business
origin, after existing login/kiosk authentication. Normal Agent consultations
keep their routes. The API starts one persistent Node 24 search worker with
384 MB JS heap, lower scheduling priority and two filesystem threads. Actual
Pi5 RSS/CPU impact is still unmeasured; these limits are not performance proof.
The API itself keeps its existing Node runtime.

Prepare the private artifact with `scripts/hermes-search/prepare-device-index.py`;
its CLI requires the approved embedding model, source SQLite index, snapshot,
reviewed manifest and a new output directory. SQLite backup includes committed
WAL state. The tool verifies the model and fingerprints, preserves every vector
byte, assigns the portable model URI, checks document counts and seals checksums.
On the Pi, each API container copies the sealed index into its own runtime
folder, preventing blue/green workers from sharing a writable SQLite index.
The worker rejects missing embeddings instead of rebuilding them at startup.

For the canonical exact-Pi5 deployment, export `HERMES_SEARCH_TRIAL_ENABLED=true`
and `HERMES_SEARCH_TRIAL_ARTIFACT=<local sealed artifact directory>`, plus the
existing `ANSIBLE_VAULT_PASSWORD_FILE`. Use the canonical `--print-plan` command
above, then the same exact-limit deployment. The role uses the existing
consultation credential and egress; it copies only the four sealed data files
under the existing project's SSD storage. Export `HERMES_SEARCH_TRIAL_ENABLED=false`
on a later canonical release to disable only this trial. Omitting the flag
preserves current configuration. No runtime credential belongs in Git.

2026-09-12 read-only device preflight: `/opt/RaspberryPiSystem_002` is on
`/dev/sda2` (916.6 GiB, about 678 GiB free). Pi5 has about 8 GiB RAM with
4.65 GiB available at observation time; swap usage was 1.35 GiB. No extra load
has been measured. Spark administrator authentication is unavailable to the
agent (`Missing sudo password`), so no device files/services have changed.

Validation completed locally: API route authorization and exact Japanese text;
API typecheck; UI build; ten inference/egress tests; portable index has 8,242
vector chunks, 8,209 raw and 16 reviewed documents. The npm release numbered
2.8.3 differed from the prior validated checkout, so both devices now pin its
exact upstream Git commit. Key SDK files were verified byte-identical.

Mac integration failures are retained separately in private work artifacts:
the first Unix socket path exceeded macOS's limit, then the wire adapter exposed
unnormalized vectors. Those were fixed before final UI checks. First model
loading subsequently exceeded the 30-second deadline; this remains a failed
cold request and cannot count toward the 5–10-second target. This is a Mac
model runtime result, not Spark/Pi5 evidence. Previous r10 results remain sealed.
