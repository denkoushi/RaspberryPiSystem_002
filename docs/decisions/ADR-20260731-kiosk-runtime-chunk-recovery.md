---
id: ADR-20260731-kiosk-runtime-chunk-recovery
title: Bounded kiosk recovery for stale lazy chunks
status: accepted-implementation-live-rollout-blocked
date: 2026-07-31
source_of_truth: true
scope: Web runtime error containment, lazy-route recovery, and static asset routing
related_code:
  - apps/web/src/components/AppErrorBoundary.tsx
  - apps/web/src/features/kiosk/kioskRuntimeRecovery.ts
  - infrastructure/docker/Caddyfile.slot.template
related_docs:
  - ../plans/kiosk-white-screen-runtime-recovery-execplan.md
  - ./ADR-20260721-deploy-release-identity-and-activation.md
validation: focused Vitest, production-build Playwright fault injection, isolated Caddy HTTP contract, and offline deployment contracts
open_items:
  - obtain separate production deployment authorization
  - verify one Firefox kiosk canary before fleet rollout
---

# ADR-20260731: Bounded kiosk recovery for stale lazy chunks

## Status

Accepted for implementation. Live deployment remains blocked until separately authorized. This decision does not authorize Pi5 mutation, kiosk activation, or a fleet rollout.

## Context

Vite emits content-hashed files for lazily loaded kiosk routes. A browser that retains an older entry point can request a chunk removed by a later Web deployment. The static server previously treated every missing non-API file as a client-side route, so a missing `/assets/*.js` request returned `index.html` with HTTP 200. A browser then rejected that HTML as a JavaScript module.

The React root had no error boundary and lazy routes rendered a null loading fallback. A rejected lazy import could therefore leave the kiosk looking blank until an operator manually reloaded it. The exact production incident remains unproven, but this failure path was reproduced locally and is unsafe regardless of whether it caused every observed white screen.

The existing `kiosk-web-activation-v1` protocol solves a different problem. It runs during a typed deployment verification challenge, may retry within its own bounded policy, and proves the exact compiled release SHA before acknowledging readiness. Ordinary route navigation must not reuse its state or weaken that evidence contract.

## Decision

The Web application will have a dependency-free Error Boundary outside all providers. It prevents render and lazy-import failures from leaving an empty React root on kiosk, admin, and signage routes. General failures show a Japanese recovery screen with a touch-sized manual reload control and never expose exception text or stack data.

Automatic recovery is narrower. Only recognized Firefox, Chromium, or Vite dynamic-module failures on `/kiosk` paths with a valid compiled full release SHA may reload. The browser records one attempt under `raspi:web-runtime-recovery:v1` before performing a cache-busted same-origin `location.replace`. A repeat for the same pathname and release SHA within sixty seconds stops at the recovery screen. Invalid identity, storage errors, corrupt state, time reversal, and invalid or cross-origin URLs fail closed.

Runtime recovery and browser effects remain separate. A pure policy classifies the error and returns a typed decision from explicit inputs. A thin browser adapter owns configuration, session storage, and navigation. The Error Boundary consumes an injected controller so component tests do not depend on browser globals.

All runtime Caddy configurations will exclude `/assets/*` from SPA fallback. Missing assets return HTTP 404 instead of HTML. Direct and rewritten HTML documents return `Cache-Control: no-store, no-cache, must-revalidate`, reducing the chance that a browser retains a stale entry point. Existing API, WebSocket, storage, TLS, security-header, and blue-green ownership remain unchanged. Asset-wide immutable caching is not introduced because the repository also publishes stable unhashed asset paths.

## Consequences

A transient removed-chunk failure can recover without operator action once. Persistent or unrelated faults become visible and actionable instead of looping or remaining blank. The one-reload limit can discard state immediately before a lazy route mounts, but it is restricted to kiosk navigation and is preferable to an unusable screen.

Initial entry-script failures that occur before React starts cannot be handled by the Error Boundary. Correct asset 404 responses and no-store HTML reduce that risk; deployment-driven browser activation continues to own release acquisition and exact-SHA readiness proof.

This change adds no public API, database schema, migration, periodic reload, Service Worker, error-reporting service, or page-specific workaround. Production rollout must begin with the standard deployment print-plan and one Firefox kiosk canary after explicit authorization.
