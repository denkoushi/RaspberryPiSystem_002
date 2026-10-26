# Nightly security and error review by the business LLM

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It is maintained in accordance with `.agent/PLANS.md` at the repository root.

## Purpose / Big Picture

Today the business server (the Raspberry Pi 5 that runs the API, called "Pi5" below) already watches for known patterns: repeated failed logins, unexpected listening ports, and nightly virus, rootkit and dependency scans. Those checks only catch what a fixed rule describes. Nobody reads the deployed code changes from a security angle, and nobody reads the error logs every day, so slow-growing errors and unusual-but-not-rule-breaking access go unnoticed until something breaks.

After this change, every night the business LLM (the GLM model that already serves the business system from the two DGX Spark machines) reads three prepared materials: the code changes deployed to the Pi5 since the previous review, a digest of the security logs, and a digest of the error logs. It writes one private report per night on the Pi5. In the morning, when the operator opens the Claude desktop app, Claude fetches that report, checks every finding against the source code, discards false alarms, and tells the operator in plain Japanese only what really needs fixing. The LLM is a night watch that only reads and writes a report; judging and fixing stay with Claude and the operator.

You can see it working when, the morning after a deploy, a dated report exists in the private report folder on the Pi5, its JSON validates, and Claude's morning summary lists either confirmed findings or "nothing to report".

## Progress

- [x] (2026-10-26 14:00 JST) Agreed the scope and boundaries with the user (see Decision Log).
- [x] (2026-10-26 15:00 JST) Researched existing nightly LLM jobs, log locations, storage conventions and DGX boundaries; findings are folded into Context and Orientation.
- [x] (2026-10-26 16:00 JST) Independent review of the first draft; corrected the storage mount, file ownership, container names, scheduler registration, use-case routing, timeouts, retries, scan exclusion and deploy order.
- [ ] Milestone 0: confirm the remaining unknowns (night-time model availability for background traffic, background admission in production, how thinking is switched off for GLM through this adapter, gateway output-token cap, provider timeout).
- [ ] Milestone 1: host-side collector that builds the nightly material bundle, with fixture tests run in CI.
- [ ] Milestone 2: API-side nightly review job that calls the LLM and writes the report, with tests using a fake model.
- [ ] Milestone 3: deploy (folders and scan exclusion first, then the API release with the flag off), then enable and observe the first real report.
- [ ] Milestone 4: morning procedure runbook, known-findings tool, and a two-week trial that counts refusals and false alarms.
- [ ] Milestone 5 (decision point): compare GLM with DeepSeek V4.1 Flash on seeded vulnerable changes and decide whether a nightly model swap is worth it.
- [ ] Later, optional: a scheduled morning check on the Claude side; widen scope (weekly whole-repository sweep, the Control Plane repository, configuration review, leaked-secret search).

## Surprises & Discoveries

- Observation: the `alerts/` folder on the Pi5 is not private. Files written there are ingested by the API and shown to kiosk users as system notices.
  Evidence: `apps/api/src/services/alerts/alerts-ingestor.ts` upserts each alert file and calls `deliverFileAlertNotice`.
- Observation: the Trivy file-system scan covers the whole project folder and writes an alert, which reaches kiosk notices, when it finds something. A folder full of diffs and log lines would be scanned every night.
  Evidence: `infrastructure/ansible/group_vars/all.yml` (`trivy_scan_target`, `trivy_skip_dirs` lists only `certs`) and `infrastructure/ansible/templates/trivy-scan.sh.j2`.
- Observation: production runs `infrastructure/docker/docker-compose.phase3.yml`, and the API containers do not see `storage/` as a whole; they see named volumes plus one bind for `storage/hermes-search`. The API runs as `API_RUNTIME_UID` (default 1000) with a read-only root file system.
  Evidence: the `api-blue` service and its volume list at the top of `docker-compose.phase3.yml`; `infrastructure/ansible/roles/release_pi5/defaults/main.yml`.
- Observation: the Pi5 checkout at `/opt/RaspberryPiSystem_002` is a detached HEAD at the deployed commit, not the tip of `main`.
  Evidence: `scripts/deploy/standard-ansible-release.py` runs `git checkout --detach <sha>`.
- Observation: the default warm window for the business model ends at 23:00, consumers must not force the model to start, and the night is already shared by document enrichment, embeddings, the business Hermes nightly job and the scans.
  Evidence: `apps/api/src/config/env/local-llm.ts`, `docs/runbooks/business-hermes.md`, `docs/plans/dgx-night-preparation-execplan.md`, `apps/api/src/services/business-hermes/business-hermes-nightly.scheduler.ts`, scan cron values in `group_vars/all.yml`.
- Observation: the GLM profile is controlled through `reasoning_effort`, while the adapter sends `chat_template_kwargs.enable_thinking`. Earlier trials showed that GLM leaks reasoning text when only `enable_thinking: false` reaches it.
  Evidence: `scripts/dgx-local-llm-system/model-registry.examples/business_glm53_flash_fp4_tp2/manifest.json` (`thinkingControl`), `openai-compatible-text.adapter.ts`, `docs/plans/business-llm-glm53-tp2-execplan.md`. Whether the gateway maps it correctly for this path is checked in Milestone 0.

## Decision Log

- Decision: use the existing business LLM (GLM-5.3 on both Sparks) first, not an uncensored DeepSeek build.
  Rationale: reading changes and logs and pointing at suspicious places is defensive work that a normal model does not refuse. GLM and DeepSeek each need both Sparks, so DeepSeek would require a nightly stop/start swap of 5 to 10 minutes each way, with the risk that the business model is not back in the morning. Each chunk's answer records whether the model refused or answered vaguely; after the two-week trial, Milestone 5 compares both models on seeded vulnerable changes before any swap is considered.
  Date/Author: 2026-10-26 / user and Claude.
- Decision: do not use Hermes Agent or any other tool-using agent for this job.
  Rationale: logs contain text chosen by outsiders, such as request paths and user agents. A model that can run tools could be steered by instructions hidden in that text. Here the model has no tools: a fixed program collects the material, the model reads it and returns schema-checked JSON, and nothing it writes is executed. The useful parts of "memory" and "skills" are kept in a simpler form: a known-findings list on the Pi5 fed back into the prompt, and one instruction file per review kind. The existing business Hermes is a kiosk consultation assistant with memory and tools deliberately disabled and must not take this role. The private Pi5 Hermes must never see business data.
  Date/Author: 2026-10-26 / user and Claude.
- Decision: the LLM only reads and writes the report. It does not fix code, run commands, touch or probe devices, write to GitHub or send notifications.
  Rationale: the user wants a night watch; Claude and the operator decide and fix.
  Date/Author: 2026-10-26 / user.
- Decision: findings never go to GitHub Issues, pull requests, CI logs, the `alerts/` folder, the kiosk Chat, Slack or Discord, and this public plan never contains report content, log lines or detection thresholds.
  Rationale: the repository is public on GitHub, so an Issue would announce weaknesses to everyone, and published thresholds and time windows tell an attacker how to stay unnoticed. Reports stay in a private folder on the Pi5 that no route serves; thresholds and schedule times live in Ansible variables; Claude relays confirmed items in the conversation.
  Date/Author: 2026-10-26 / user and Claude.
- Decision: review the changes deployed to the Pi5 since the last review, not the tip of `main`.
  Rationale: deployed code is what attackers can reach, the Pi5 checkout already holds it, and no GitHub access is needed. Changes merged but not yet deployed are picked up the night after they are deployed.
  Date/Author: 2026-10-26 / Claude.
- Decision: two stages. A host collector (systemd timer, running as root because it reads root-only logs, Docker and the journal) prepares the material; an API-side scheduler calls the LLM and writes the report.
  Rationale: the API container cannot read host logs, while the API already has the model client, token handling, deferral behaviour, leader election for schedulers and database access for kiosk error rows.
  Date/Author: 2026-10-26 / Claude.
- Decision: one folder tree, `storage/security-review`, owned by the API runtime user with mode 0700, bind-mounted into both API slots. The collector writes there and hands each file to the API user; only the API job deletes old files.
  Rationale: this copies the existing `storage/hermes-search` arrangement and gives a single owner for retention.
  Date/Author: 2026-10-26 / Claude.
- Decision: never acquire DGX leases and never force the model to start. If the model is unavailable, retry within the configured window and then write a `skipped` report that the morning check reports.
  Rationale: the DGX Control Plane owns arbitration and startup (`AGENTS.md`, `docs/decisions/ADR-20260502-dgx-resource-control-targets.md`).
  Date/Author: 2026-10-26 / Claude.
- Decision: the morning check reads only the schema-validated JSON report, never free text written by the model.
  Rationale: Claude has tools, so Claude is the component that injected instructions could actually misuse; schema validation limits each field to a bounded string, and Claude treats every field as data.
  Date/Author: 2026-10-26 / Claude.

## Outcomes & Retrospective

Nothing implemented yet.

## Context and Orientation

Data flows through four parts: the Pi5 host, the Pi5 API containers, the DGX gateway, and Claude in the morning.

The Pi5 host is managed by Ansible under `infrastructure/ansible`. The repository is checked out at `/opt/RaspberryPiSystem_002` at the deployed commit. Host-level security tooling comes from the `server` role (`roles/server/tasks/security.yml`, `monitoring.yml`, `malware.yml`; templates in `infrastructure/ansible/templates`). The relevant host logs are the fail2ban log, the Caddy web server access log (JSON lines, rotated by Caddy itself after a few days, configured in `Caddyfile.production`), the security monitor's lines in the system journal (it is a shell script that a systemd timer runs every 15 minutes), and the nightly ClamAV, Trivy and rkhunter scan logs. Their exact paths are the variables in `infrastructure/ansible/group_vars/all.yml`; the collector must read them from those variables through its Ansible template rather than hard-coding them. A "systemd timer" is a scheduled job defined by a `.timer` and `.service` unit pair, the mechanism `security-monitor` uses.

Deployment detail: the standard rolling update runs the `server` role in host-configuration-only mode (`roles/server/tasks/main.yml` gates monitoring and malware tasks on `server_release_mode == 'full'`), so host scripts and timers like this are applied with a dedicated playbook, as `infrastructure/ansible/playbooks/prepare-pi5-security-scans.yml` does, always first with `--check --diff`.

The Pi5 API runs as blue and green slots, the containers `api-blue` and `api-green`, with matching `web-blue` and `web-green`, defined in `infrastructure/docker/docker-compose.phase3.yml`. Only one slot is active; `scripts/server/resolve-active-backup-api.py` and `scripts/server/run-in-active-api.sh` show how to find it. The API containers run as `API_RUNTIME_UID` (default 1000) on a read-only root file system and see storage only through the volumes in the shared `api-volumes` list in that file. Private nightly data already lives in a bind-mounted host folder, `storage/hermes-search`, created by `infrastructure/ansible/roles/release_pi5/tasks/hermes-search-trial.yml` with the API user as owner and mode 0700. No HTTP route serves it. API logs go to standard output through the pino logger (`apps/api/src/lib/logger.ts`) and Docker keeps them only for a few days. Kiosk terminals report their own errors into the `ClientLog` table (`apps/api/prisma/schema.prisma`; `level` is the string `ERROR` for errors).

The existing nightly LLM job is the pattern to copy. `apps/api/src/services/business-hermes/business-hermes-nightly.scheduler.ts` uses `node-cron` in the Asia/Tokyo time zone, is gated by a flag that defaults to false, schedules its own retry after a deferral, and bounds each run with an abort signal. It is registered in `apps/api/src/bootstrap/start-post-listen-schedulers.ts`, which runs schedulers only on the slot that holds the scheduler lease, so a job registered there does not run twice. Its settings are written into the API environment file by `infrastructure/ansible/roles/release_pi5/tasks/business-hermes-answer-cache.yml` from group variables such as `business_hermes_nightly_enabled`, and parsed in `apps/api/src/config/env/business-hermes.ts`.

The model client is `apps/api/src/services/inference/adapters/openai-compatible-text.adapter.ts`. Each request names a use case from the closed list `INFERENCE_USE_CASES` in `apps/api/src/services/inference/types/inference-usecase.ts`, and the router maps the use case to a provider and model; use cases are also listed in `inference-use-case-runtime-intent.ts` and `business-profile-intent.ts` in the same service tree. With `background: true` the adapter switches to the low-priority alias `dgx-background-preparation`, and it refuses unless the resolved model is `system-prod-primary`. HTTP 429 or 503 become a deferral, not an error. Each call is bounded by the provider's `timeoutMs` (configured through `LOCAL_LLM_TIMEOUT_MS`, default 60 seconds, maximum 300) and by any abort signal the caller passes. Background admission is implemented, but its production acceptance is recorded as not yet executed in `docs/plans/hermes-background-admission.md`.

The DGX gateway and model scheduling belong to the separate repository `denkoushi/DGXSparkControlPlane`. The business model profile (`business_glm53_flash_fp4_tp2/manifest.json`) allows a 262,144-token context, at most four concurrent sequences and 4,096 tokens per prefill batch, so long inputs are slow and are split into chunks here.

"Prompt injection" means text inside the material that tries to give the model instructions. A "seeded vulnerable change" is a deliberately flawed, synthetic code change used only to test whether the reviewer notices it.

## Plan of Work

Milestone 0 confirms the unknowns without changing anything. On the Control Plane side, confirm whether the business model serves background traffic during the planned night slot, and whether background admission is accepted in production. If either is missing, make the Control Plane change first in that repository, following its boundary document: keep the model available for background traffic in that slot, or give this workload its own alias at background priority. Send one test request through the adapter path with `enableThinking: false` and confirm that the answer has no reasoning text. If it has, the gateway must map the flag to `reasoning_effort` low for this alias before Milestone 2 relies on it. Read the gateway's output-token cap for the alias, and read the provider timeout configured on the Pi5. Acceptance for this milestone: each answer is written into Surprises & Discoveries with its evidence, and the night slot, chunk size and per-call timeout are fixed in the Decision Log.

Milestone 1 adds the host collector. Create `scripts/server/security-review/collect.py` (Python standard library only), installed from an Ansible template so that log paths, the schedule and all thresholds come from group variables under a new `security_review_` prefix. A systemd timer runs it once a night, after midnight, before the review job and before the scans; the exact time is a group variable. It runs as root and writes one bundle per night under `/opt/RaspberryPiSystem_002/storage/security-review/bundles/<YYYY-MM-DD>/`. Each file is written atomically: write a temporary file, set owner to the API user and mode 0600, then rename it.

The changes material lists commits and per-file diffs from the last reviewed commit to the checkout's HEAD. The last reviewed commit is kept in `/var/lib/security-review/last_reviewed_sha`. Git is run with `-c safe.directory=/opt/RaspberryPiSystem_002`. On the first run, when no state file exists, the range is the commits of the last 24 hours by commit date. If the stored commit is not an ancestor of HEAD, for example after a rollback, the collector reviews the last 24 hours and notes the reason. Lock files, generated code, images and documentation are left out.

The security material summarises the last 24 hours. It counts fail2ban bans and their sources. From the Caddy log it counts requests per source address and per status class, and lists requests that match the configured unusual-hours, denied, unknown-path and oversized rules, keeping a capped number of example lines per rule. It also includes the security monitor's journal lines, and the result lines of the most recent completed scan of each kind, chosen by date so a scan still running is not read half-done.

The error material reads `docker logs --since 24h` for each of `api-blue`, `api-green`, `web-blue` and `web-green` that exists. It keeps pino entries at error level or above and groups them by slot and message, with counts and first and last time.

Before anything is written, every material goes through redaction. Redaction removes authorization headers, cookies, client keys, query strings and anything shaped like a token or password. Each material has a hard size cap, and dropped lines are counted, not silently lost. The collector writes `last_reviewed_sha` only after the whole bundle is written. Tests live in `scripts/server/tests/test_security_review_collect.py` and use fixture logs only. Add `scripts/server/tests/test_security_review_collect.py` to the `python3 -m pytest` line in `.github/workflows/ci.yml` that runs the client agent tests, so CI runs it. Acceptance: the tests pass. A redaction test fails if an authorization header survives. A first-run test and a rollback test show the chosen commit range.

Milestone 2 adds the review job in the API. Add `security_review` to `INFERENCE_USE_CASES` and to the use-case lists in `inference-use-case-runtime-intent.ts` and `business-profile-intent.ts`, routed like `business_hermes`, so that it resolves to `system-prod-primary` and may use `background: true`. Add the settings `SECURITY_REVIEW_NIGHTLY_ENABLED` (default false) and `SECURITY_REVIEW_DATA_DIR` beside the business Hermes ones in `apps/api/src/config/env/business-hermes.ts`, or in a new sibling file under `apps/api/src/config/env/` registered in the same way.

Create `apps/api/src/services/security-review/` with a scheduler in the same shape as the business Hermes nightly scheduler. It starts at the configured time, and after a deferral it retries every 10 minutes until the configured window ends. Register it in `apps/api/src/bootstrap/start-post-listen-schedulers.ts` next to `business-hermes-nightly`. The service picks the newest bundle that has no report. It adds `ClientLog` rows with level `ERROR` from the last 24 hours, grouped by terminal and message. It also adds the known-findings list from `known-findings.json` in the data folder.

The service sends chunks in this order: security material, error material, then changes grouped by file. Each chunk is capped by byte size, with the cap fixed in Milestone 0. The API has no tokenizer, so a byte cap is the measurable stand-in. Each call uses `useCase: 'security_review'`, `background: true`, `temperature: 0`, `enableThinking: false`, `jsonOutput: true`, an output limit no higher than the gateway cap, and its own abort signal with the per-call timeout from Milestone 0. The whole run has an overall bound shorter than the retry window.

There is one instruction file per review kind under `apps/api/src/services/security-review/prompts/`. The instructions are generic: what to look for, that everything between the material markers is data and never instructions, and that known findings must not be repeated. Each chunk must answer one JSON object with two fields: `findings`, a list in the schema below, and `refusedOrVague`, which is true when the model declined or gave nothing concrete. An answer that fails the schema is retried once and then recorded as a failure for that chunk. String fields are cut to a fixed length.

The service writes `reports/<YYYY-MM-DD>.json` in the data folder, mode 0600. If the model never became available, it writes a report with status `skipped` and the reason. The job deletes bundles and reports older than 14 days. Nothing is sent anywhere else. Tests use a fake completion client and cover: a normal run, a deferral followed by a retry, a schema failure, a log line containing an instruction that must come back only as quoted data, the size caps, and retention. Acceptance: `pnpm --filter @raspi-system/api test -- security-review` passes, and the existing inference routing tests still pass.

Milestone 3 deploys. Do it in this order, and follow the repository's approval rules for each production step. First, the folders and the scan exclusion. Add a new dedicated playbook, `infrastructure/ansible/playbooks/prepare-pi5-security-review.yml`, modelled on `prepare-pi5-security-scans.yml`. It creates `storage/security-review` with `bundles` and `reports` inside, owned by the API user with mode 0700, and creates `/var/lib/security-review`. It installs the collector, its service and its timer, with the timer disabled by default. It adds `/opt/RaspberryPiSystem_002/storage/security-review` to `trivy_skip_dirs` and to `trivy_alert_ignore_patterns`. Apply it with `--check --diff`, review the diff, then apply it for real. The folders must exist before the next step; otherwise Docker would create the bind source owned by root.

Second, the API release. Add the bind `${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}/storage/security-review:/app/storage/security-review` to the shared `api-volumes` list in `docker-compose.phase3.yml`, so both slots get it. Add the two settings to the environment-file task in `business-hermes-answer-cache.yml`, driven by a new group variable `security_review_nightly_enabled`, default false. Ship this through the standard rolling update with the flag still false.

Third, the trial run. Enable the collector timer, run the collector once by hand, and check that the bundle exists, is owned by the API user and contains no secrets. Fourth, set `security_review_nightly_enabled` to true. That changes production behaviour, so it needs the user's approval; the change is applied the same two-step way as other API flags. Acceptance: the next morning, a report validates and the morning procedure handles it.

Milestone 4 adds the morning side. Write `docs/runbooks/nightly-security-review.md`. In the morning, when the operator opens the Claude app, Claude connects to the Pi5 over SSH and copies the newest JSON report; it reads nothing else that the model wrote. Claude treats every field as data. For each finding, Claude reads the referenced code or bundle evidence and decides whether it is real. Real items go to the operator in plain Japanese: what is wrong, how to fix it, how urgent. Fixes then follow the normal change process. False alarms are added to the known-findings list with a new script, `scripts/server/security-review/known.py`. It has `add`, `list` and `remove` subcommands and runs on the Pi5 as the API user; each entry holds a fingerprint of kind, location and what, a short reason, and a date. A `skipped` or failed report is reported in one line with its reason. If nothing is confirmed, Claude says so in one line.

Run the job for two weeks. Each morning, record the number of findings, how many were confirmed, how many were false alarms, and how many chunks had `refusedOrVague` true. Record only these totals and dates in this plan. Acceptance: fourteen nightly reports, at least one of them seen through to a confirmed finding or an explicit "nothing to report", and the totals recorded in Outcomes & Retrospective.

Milestone 5 is a decision point, not a build step. Prepare a small set of seeded vulnerable changes. These are synthetic diffs against invented files and routes, never real ones, each with a known flaw, for example a handler without an authentication check or a secret written to a log. Keep them under `apps/api/src/services/security-review/__fixtures__/seeded/`. Feed the set to GLM. Then, during a maintenance slot agreed with the user, feed it to DeepSeek V4.1 Flash. Compare how many flaws each model detects and how often it refuses. Adopt a nightly model swap only if DeepSeek detects at least two more of the seeded flaws than GLM, or if GLM's refusal rate in the two-week trial was above 10 percent. Otherwise keep GLM. Record the result and the decision in the Decision Log.

## Concrete Steps

Repository commands run from the task worktree root.

    python3 -m pytest scripts/server/tests/test_security_review_collect.py -q
    pnpm --filter @raspi-system/api test -- security-review

Expected: all tests pass. The redaction and injection tests fail on purpose if their protection is removed.

Milestone 3 playbook check, run from `infrastructure/ansible` on the deploy host:

    ansible-playbook -i inventory.yml playbooks/prepare-pi5-security-review.yml --limit raspberrypi5 --check --diff

Expected: the diff contains only the new folders, script, units, state folder and the two Trivy list additions.

## Validation and Acceptance

The feature is accepted when all of the following hold. Two consecutive nights produce a report file in `storage/security-review/reports/` that validates against the schema. The report has mode 0600, and requesting its path through the web server returns 404. A night when the model is unavailable produces retries within the window and then a `skipped` report, with no tight retry loop. Only one API slot runs the job. The morning procedure turns one report into a Japanese summary. A planted test line in the Caddy log, containing an instruction aimed at the model, appears only as quoted evidence. The Trivy scan raises no alert about the bundle folder. Bundles and reports older than 14 days are gone.

## Idempotence and Recovery

The collector can be re-run for the same night; it rewrites that night's bundle and moves `last_reviewed_sha` only after a complete write. The review job skips bundles that already have a report, unless it is started by hand with a re-run option. To roll back, set `security_review_nightly_enabled` to false and disable the collector timer with the dedicated playbook. The private folder can then be removed only with an explicit command the user approves. Nothing in this feature changes existing alerts, scans (apart from the added exclusion) or business model settings.

## Artifacts and Notes

None yet. Never paste real report content, log lines, findings, thresholds or schedule times into this public file; record only counts and dates.

## Interfaces and Dependencies

No new package dependencies. The collector uses the Python standard library and the `git`, `docker` and `journalctl` commands already on the Pi5. The API job uses `node-cron`, the existing completion client and Prisma. The schema lives in `apps/api/src/services/security-review/report-schema.ts`:

    type SecurityReviewFinding = {
      kind: 'changes' | 'security' | 'errors';
      location: string;          // file path and line, or log source; length-capped
      what: string;              // length-capped
      whyItMatters: string;      // length-capped
      severity: 'high' | 'medium' | 'low' | 'info';
      evidenceRef: string;       // pointer into the bundle
    };
    type SecurityReviewChunkAnswer = {
      findings: SecurityReviewFinding[];
      refusedOrVague: boolean;
    };
    type SecurityReviewReport = {
      date: string;              // YYYY-MM-DD, Asia/Tokyo
      status: 'ok' | 'skipped' | 'partial';
      reason?: string;
      reviewedCommits: { from: string; to: string; note?: string };
      chunks: { id: string; kind: SecurityReviewFinding['kind']; refusedOrVague: boolean; error?: string }[];
      findings: SecurityReviewFinding[];
    };

Control Plane prerequisites are owned by `denkoushi/DGXSparkControlPlane`. If one is missing, change it there first. Background traffic must be served during the chosen night slot. Background admission, or a dedicated alias at background priority for this workload, must be accepted in production. The thinking switch must be mapped correctly for that alias. No principal, token or lease changes are expected.

## Local Notes JA

夜間に業務 AI(GLM)が、Pi5 に反映された変更、セキュリティのログ、エラーログを読み、非公開の報告書を書く。朝に Claude が報告書を確かめ、本当に直すべきものだけを日本語で伝える。業務 AI は読むだけで、修正、コマンドの実行、実機への試し撃ち、GitHub への書き込み、通知はさせない。リポジトリは公開なので、報告書の中身、ログ、検知の閾値と時刻はこの文書に書かない。`alerts/` はキオスクに表示されるので使わない。最初は GLM で始め、2週間「断った・ぼかした」回数を数える。そのうえで、わざと穴を仕込んだ変更で DeepSeek と比べてから、切り替えるかを決める。Hermes Agent は使わない。ログに仕込まれた指示で道具を使われるおそれがあるためである。

Revision note (2026-10-26): the first draft wrongly assumed `storage/` was mounted into the API and left ownership, container names, scheduler registration, use-case routing, timeouts, retries, the Trivy scan of the new folder and deploy order open. An independent review against the code found these. All of them are now specified above, and thresholds and times were moved out of this public text.
