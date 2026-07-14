---
id: KB-401
title: Pi5 rolling deploy resilience and offline terminal containment
status: active
scope: Pi5 candidate build, Blue/Green release, and Pi4 rolling coordination
date: 2026-07-14
source_of_truth: true
related_code:
  - scripts/deploy/pi5-image-deploy.sh
  - scripts/deploy/pi5-blue-green.sh
  - scripts/deploy/rolling-release.py
related_docs:
  - ../plans/rolling-deploy-resilience.md
  - ../runbooks/pi5-blue-green-deploy.md
  - ../runbooks/deploy-status-recovery.md
validation: pending implementation
open_items:
  - Record hosted CI and production follow-up outcome.
---

# KB-401: Pi5 rolling deploy resilience and offline terminal containment

## Incident pattern

On 2026-07-14, Pi5 candidate builds repeatedly crossed the same one-minute
load gate used after building, migration history files restored to Git required
manual guard corrections, and `raspi4-fjv60-80` became unreachable while its
NFC image was being rebuilt. The release retained the terminal in maintenance
but the coordinator did not have a bounded termination path.

## Operating rule

Do not raise the Pi5 load threshold to hide this condition. Pause only the
confirmed signage renderer, wait for a bounded stable window, reuse an exact
validated candidate instead of rebuilding it, and retain maintenance for any
terminal whose state cannot be verified. Use the canonical cancel command; do
not kill a coordinator or delete a lock directory by hand.

## Deferred FJV60/80 recovery

FJV60/80 remains in maintenance until it is physically reachable, then is
updated through a dedicated standard rolling run and verified for kiosk UI,
status-agent, PC/SC, and NFC readiness. Its maintenance entry is not cleared
merely because another terminal release succeeds.
