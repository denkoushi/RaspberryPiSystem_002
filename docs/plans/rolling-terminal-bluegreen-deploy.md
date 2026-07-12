---
title: Rolling terminal deployment with Pi5 Blue/Green
status: accepted
scope: Pi5 API/Web and Pi4 kiosk / Pi3 signage release orchestration
date: 2026-07-12
source_of_truth: docs/plans/rolling-terminal-bluegreen-deploy.md
related_code: [scripts/deploy/rolling-release.py, scripts/deploy/deploy-status-state.py, scripts/deploy/pi5-candidate-build.sh]
related_docs: [../runbooks/pi5-blue-green-deploy.md, ../guides/deployment.md]
validation: isolated PostgreSQL, unit tests, shell tests, CI, and 2026-07-12 production rolling-terminal and Pi5 Blue/Green acceptance
open_items: []
---

# Rolling terminal deployment with Pi5 Blue/Green

## Purpose

Make `scripts/update-all-clients.sh` the only normal application deployment
entry point. It resolves one immutable revision, prepares and stabilizes Pi5
Blue/Green, then updates the kiosk canary, remaining kiosks, and signage one
terminal at a time.

## Decisions

- Each terminal is placed in maintenance and acknowledged before its update.
- A terminal failure restores its previous Git revision and configuration, then
  stops the release. A failed rollback retains maintenance state for recovery.
- `deploy-status.json` retains its compatible `kioskByClient` field while
  carrying the optional terminal type and run phase.
- Pi3 bootstraps its first maintenance acknowledgement from the controller only
  after its local `feh` image has been replaced; subsequent ACKs are emitted by
  its own update timer.

## Production acceptance (2026-07-12)

The canonical command completed release run `20260712-065916-75ecd7` at
immutable revision `95be149fb275ba94387b67c4cb1648e4ca7a6678`.

- The Pi4 canary, the remaining four Pi4 kiosks, and `raspberrypi3` signage all
  completed successfully. Each terminal entered maintenance alone, recorded an
  acknowledgement before update, returned to its normal display after its
  service checks, and ended at the same revision. `deploy-status.json` finished
  with an empty `kioskByClient` map, so no terminal remained in maintenance.
- This release was correctly classified as not requiring a Pi5 application
  switch. The separate Pi5 Phase 3 acceptance immediately afterward built and
  prepared the same immutable candidate, switched Blue to Green, completed the
  five-minute stability monitor without rollback, and cleaned the old slot.
- The first Green prepare attempt failed closed on the configured host-load
  guard before any inactive container was started. A retry after the load fell
  below the limit succeeded, demonstrating that the operational preflight is
  enforced in production.

The failure and automatic-rollback paths remain covered by automated tests and
are available to the release coordinator. Deliberately injecting a production
failure is an optional future drill, not an outstanding acceptance requirement.

## Validation

Use a uniquely named local PostgreSQL container, volume and network only. Run
Prisma deploy/status, API deploy-status integration coverage, and an indexed
`EXPLAIN (ANALYZE, BUFFERS)` on `ClientDevice.apiKey`; clean those resources in
an unconditional trap. The implementation and its production acceptance are
complete; future releases use this canonical path.
