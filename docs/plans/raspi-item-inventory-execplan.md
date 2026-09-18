# Raspberry Pi Item Inventory

## Purpose

Implement the Raspberry Pi inventory workflow for the `ItemlistRaspi` SharePoint export and the `[ItemlistRaspi-photo]` Gmail photo manifest workflow. The feature must coexist with the existing tool-borrowing, instrument, rigging, employee, and photo-borrowing workflows.

## Context

The existing `Item` model and kiosk routes represent tools and must not be repurposed. The inventory domain therefore uses separate Prisma models, API routes, and UI pages. Existing Gmail attachment traversal, photo storage, NFC event handling, kiosk layout, role authorization, and transaction conventions are reused where they fit.

The accepted manifest contract is schema version 1:

```json
{"schema_version":1,"source":{"system":"sharepoint","list":"ItemlistRaspi","item_id":2,"modified":"2026-09-16T06:54:14Z"},"id":2,"category":"治具","location":"30007_KSJP-55","note":"ppp","photos":[{"index":1,"image":"2_photo_1.jpeg"}]}
```

`location` is the area. Shelf number and drawer number are numeric management-console choices, and the final compartment is NFC-tagged. One compartment contains one item type; stock is balanced independently per compartment while item metadata/photos are shared.

## Plan

1. Add inventory persistence and migration without changing the existing tool models.
2. Add manifest parsing, filename-paired JPEG attachment validation, canonical duplicate detection, and Gmail ingestion with visible retryable failures.
3. Add transactional inventory operations with serialized stock updates, idempotency, cancellation, correction, location/tag administration, and history.
4. Add admin registration/review and minimal shelf/drawer/tag management UI, including the software keypad for initial physical count.
5. Add the dedicated kiosk inventory screen and a layout-level NFC router that consumes inventory tags while leaving existing non-inventory NFC behavior intact.
6. Run focused unit/API/web validation and record any environment or real-device limitations.

## Concrete Steps

### Persistence

- Add `InventoryItem`, shared photos, import payload/message/photo records, area/shelf/drawer/compartment records, quantity/item/restock NFC tags, and inventory transaction history.
- Use explicit enums for import outcomes, registration mode, tag kind, and transaction action.
- Keep the existing `Item`, `Loan`, and `Transaction` models unchanged.
- Enforce unique source payload hashes, Gmail message IDs, location hierarchy keys, NFC UIDs, one compartment per item tag, and non-negative stock in the database/service boundary.

### Gmail ingestion

- Reserve the literal subject token `[ItemlistRaspi-photo]`, matching the existing token-leading subject convention with a variable suffix.
- Recursively collect named Gmail parts using the existing attachment collector.
- Require one valid schema-version-1 JSON manifest and pair every `photos[].image` reference to an attachment by filename. Validate referenced images as JPEGs.
- Hash canonical manifest content plus sorted referenced image hashes. Exact duplicate payloads become duplicate outcomes and never create another registration. A changed payload creates a reviewable pending payload.
- Persist invalid/missing-photo errors as visible retryable records without silently discarding the source message.
- Register the scheduler/configuration and admin trigger using existing Gmail client and scheduler patterns.

### Inventory service/API

- Resolve inventory NFC tags and process only `item tag -> quantity tag` for issue, or `restock tag -> item tag -> quantity tag` for restock.
- Require a kiosk client key for kiosk mutations and record client/terminal identity in history.
- Serialize compartment updates, reject insufficient stock without decrementing, and use idempotency keys to make network retries safe.
- Restrict cancellation to the latest applicable transaction when the expected current balance still matches; otherwise return a conflict. Corrections use the same row lock and record before/after values.
- Keep existing-item review limited to metadata/photos. It must not change stock, area, shelf, drawer, or compartment.
- Add administration endpoints for review, hierarchy options, quantity tags, restock tags, NFC replacement, location changes, item listing, and history.

### Web UI

- Add an admin inventory page with pending review cards, large photo previews, Japanese labels, new-versus-existing registration choice, NFC binding, software numeric keypad, hierarchy-filtered shelf/drawer selectors, tag setup, and history/maintenance views.
- Add a kiosk inventory page with large state feedback, 30-second inactivity reset, one-shot handling per NFC event, cancel/reset, distinct success/restock/error tones, restock mode, and the required scan order.
- Mount inventory NFC classification at `KioskLayout` so an inventory tag can switch from any kiosk page to inventory. Unknown/non-inventory tags must remain available to existing kiosk listeners.
- Preserve current employee/tool/instrument/rigging/photo kiosk routes and their NFC listeners.

## Progress

- [x] Audit base repository, rules, current worktree state, and existing tool/Gmail/NFC/photo patterns (2026-09-16 JST).
- [x] Create isolated feature worktree `RaspberryPiSystem_002-worktrees/feat--raspi-item-inventory` from base `e48ef1e36bc1926508f4e9a36ee361ec8d62a4e7` (2026-09-16 JST).
- [x] Confirm the concrete manifest contract from `/Users/tsudatakashi/Downloads/itemlistraspiphotoid2/2_manifest.json` (2026-09-16 JST).
- [x] Add Prisma schema and migration.
- [x] Implement manifest resolver and ingestion service/tests.
- [x] Implement inventory transaction service/API.
- [x] Implement admin and kiosk UI/NFC routing.
- [x] Normalize inventory item/location response shapes and preserve existing-item metadata on photo-only review.
- [x] Run focused validation and document remaining limitations (2026-09-16 JST).

## Validation

Completed focused validation:

```sh
DATABASE_URL=postgresql://localhost:5432/raspi pnpm --filter @raspi-system/api exec prisma validate
pnpm --filter @raspi-system/api test -- src/services/item-inventory/__tests__/item-inventory-gmail-packet-resolver.test.ts
pnpm --filter @raspi-system/api test -- src/services/gmail/__tests__/gmail-subject-reservation.policy.test.ts src/services/backup/__tests__/gmail-storage.provider.test.ts src/services/kiosk-documents/__tests__/kiosk-document-gmail-ingestion.query.test.ts src/services/csv-dashboard/__tests__/csv-dashboard-import.service.ingest-behavior.test.ts
pnpm --filter @raspi-system/api test -- src/services/item-inventory/__tests__/item-inventory.service.test.ts src/services/item-inventory/__tests__/item-inventory-gmail-ingestion.test.ts src/routes/item-inventory/cancel-authorization.test.ts
pnpm --filter @raspi-system/api exec eslint src/services/item-inventory src/routes/item-inventory src/services/gmail/gmail-subject-reservation.policy.ts src/services/backup/storage/gmail-storage.provider.ts src/services/kiosk-documents/kiosk-document-gmail-ingestion.service.ts src/services/csv-dashboard/csv-dashboard-import.service.ts src/services/item-inventory/__tests__ src/services/gmail/__tests__/gmail-subject-reservation.policy.test.ts src/services/backup/__tests__/gmail-storage.provider.test.ts src/services/kiosk-documents/__tests__/kiosk-document-gmail-ingestion.query.test.ts src/services/csv-dashboard/__tests__/csv-dashboard-import.service.ingest-behavior.test.ts
pnpm --filter @raspi-system/web test -- src/hooks/useNfcStream.test.ts src/pages/kiosk/KioskItemInventoryPage.test.tsx
pnpm --filter @raspi-system/web test -- src/pages/admin/RaspiInventoryPage.test.tsx
pnpm --filter @raspi-system/web exec eslint src/hooks/useNfcStream.ts src/hooks/useNfcStream.test.ts src/features/kiosk/InventoryNfcRouter.tsx src/pages/kiosk/KioskItemInventoryPage.tsx src/pages/kiosk/KioskItemInventoryPage.test.tsx src/pages/admin/RaspiInventoryPage.tsx src/api/domains/item-inventory.ts src/api/hooks/item-inventory.ts
pnpm --filter @raspi-system/api build
pnpm --filter @raspi-system/web build
git diff --check
```

The focused checks passed. The resolver test covers malformed/missing/non-JPEG attachments, canonical duplicate identity, and subject boundaries; mailbox tests cover broad-match ownership; service tests cover cross-domain UID rejection, kiosk cancellation isolation, flattened location responses, and photo-only existing-item preservation; the web tests cover one shared NFC socket, inventory/legacy dispatch, delayed ordered item→quantity consumption, registered location/move-option rendering from API-shaped fixtures, and existing-item metadata prefill. Full repository suites are only warranted if focused validation exposes cross-package risk.

## Idempotence and Recovery

- Re-running Gmail ingestion with the same payload hash is harmless; the existing payload is reused and the message is recorded as duplicate.
- Re-running a mutation with the same kiosk client and idempotency key returns the original transaction.
- Retryable Gmail failures stay visible and can be retried after the source message/attachments are corrected or re-delivered.
- Transaction cancellation and correction always re-read the locked compartment balance and refuse stale operations.

## Artifacts

- Prisma schema/migration for the inventory domain.
- API inventory service, Gmail resolver/ingestion, scheduler/configuration, routes, and tests.
- Admin inventory review/management page and kiosk inventory operation page.
- Kiosk NFC router integration and focused validation output.

## Interfaces

- Gmail subject: `[ItemlistRaspi-photo]` plus optional suffix.
- Kiosk mutation: item NFC UID, then quantity NFC UID; restock command NFC precedes those two scans.
- Quantity tags carry a configured positive integer in management data; no physical tag writing is required.
- JSON source location maps to area; shelf/drawer are controlled numeric hierarchy values; the terminal compartment is bound to an item NFC tag.

## Surprises & Discoveries

- The existing `Item` model is a tool-borrowing model with a `TO####` contract and cannot safely represent Raspberry Pi stock.
- Existing Gmail and photo-storage utilities provide the needed transport/storage primitives, but the accepted manifest has a different `photos[]` shape than work-instruction manifests.
- Kiosk pages currently own separate NFC streams; the inventory classifier must be layout-level and must ignore non-inventory tags to avoid changing established workflows.

## Decision Log

- 2026-09-16: Use a separate inventory schema instead of extending `Item`, because tool behavior and constraints are production-facing.
- 2026-09-16: Treat the canonical manifest and referenced JPEG bytes as the duplicate identity; Gmail message ID alone is insufficient because resends can have different message IDs.
- 2026-09-16: Existing-item review changes only shared item information/photos; stock and physical location remain compartment-level administration concerns.
- 2026-09-16: Quantity NFC tags store arbitrary positive configured quantities and are never written physically.
- 2026-09-16: Inventory NFC routing is mounted in `KioskLayout`, while non-inventory tags fall through to existing page listeners.
- 2026-09-16: Serializable transaction retries are limited to three attempts and only handle the database serialization failure code; this is the smallest mechanism needed to make concurrent kiosk scans safe.
- 2026-09-16: Normalize item and location responses at the inventory service boundary with the existing locationDto shape; keep existing-item photo review field-preserving when optional metadata is absent.

## Outcomes & Retrospective

Implementation is complete in the isolated worktree. The Gmail path reuses `GmailApiClient`/its configured factory, the existing recursive `collectWorkInstructionAttachmentParts` traversal, and `PhotoStorage` for original/thumbnail files. The kiosk path keeps existing `useNfcStream` callers on the shared stream and adds a layout-level inventory classifier; the inventory page reuses the existing React Query mutation/client patterns and the NFC event contract. Focused resolver/service/mailbox/web tests, API/web builds, Prisma validation, and targeted lint passed. No live database migration, Gmail credentials, SharePoint delivery, production kiosk browser, or physical NFC reader was exercised in this environment.
