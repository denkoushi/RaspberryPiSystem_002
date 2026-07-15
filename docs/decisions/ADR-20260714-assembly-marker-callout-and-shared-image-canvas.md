---
id: ADR-20260714-assembly-marker-callout-and-shared-image-canvas
title: Assembly marker callouts and shared image-canvas behavior
status: accepted
date: 2026-07-14
source_of_truth: true
related_docs:
  - ../plans/kiosk-deploy-notice-assembly-ui.md
  - ../plans/kiosk-assembly-torque-management-mvp.md
  - ./ADR-20260708-assembly-page-level-markers-and-publish-gate.md
  - ./ADR-20260710-inspection-drawing-callout-tip.md
---

# ADR-20260714: Assembly marker callouts and shared image-canvas behavior

## Context

Assembly bolt and check markers are page-level domain records, but their image zoom and optional callout interaction are the same presentation problem already solved by inspection drawings. Importing inspection-specific components directly into assembly would couple independent business domains.

## Decision

- Keep assembly DB/API/UI semantics in the assembly domain.
- Extract only generic image-canvas zoom, layout, pointer-tap, callout rendering, and accessible control behavior into domain-neutral Web modules. Preserve inspection-drawing compatibility exports.
- Store nullable paired `calloutTipXRatio` / `calloutTipYRatio` on both `AssemblyTemplateBolt` and `AssemblyTemplateCheckItem`.
- Attach callouts to existing bolt/check markers; do not add an independent annotation model.
- Require both ratios together, keep callouts optional, copy them on template revision, and render them in editor and work-session views.
- Keep marker/page ratios independent of zoom by sizing scrollable canvas content instead of applying page-level transforms.

## Consequences

- The migration is additive and existing templates remain visually unchanged.
- API and Web DTOs gain nullable callout fields; `modelCode` and page-reference contracts remain unchanged.
- Shared primitives receive regression coverage from both inspection-drawing and assembly consumers.
- A rolling release must update DB/API before a Web client that sends callout fields.
