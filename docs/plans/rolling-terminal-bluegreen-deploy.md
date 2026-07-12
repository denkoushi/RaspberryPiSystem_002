---
title: Rolling terminal deployment with Pi5 Blue/Green
status: implemented_pending_field_acceptance
scope: Pi5 API/Web and Pi4 kiosk / Pi3 signage release orchestration
date: 2026-07-12
source_of_truth: docs/plans/rolling-terminal-bluegreen-deploy.md
related_code: [scripts/deploy/rolling-release.py, scripts/deploy/deploy-status-state.py, scripts/deploy/pi5-candidate-build.sh]
related_docs: [../runbooks/pi5-blue-green-deploy.md, ../guides/deployment.md]
validation: isolated PostgreSQL, unit tests, shell tests, CI
open_items: [approved field canary and production acceptance]
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

## Validation

Use a uniquely named local PostgreSQL container, volume and network only. Run
Prisma deploy/status, API deploy-status integration coverage, and an indexed
`EXPLAIN (ANALYZE, BUFFERS)` on `ClientDevice.apiKey`; clean those resources in
an unconditional trap. Production deployment remains separately approved.
