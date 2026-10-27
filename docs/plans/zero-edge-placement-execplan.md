# Zero 棚スキャナで配膳を記録する(作り直し)

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current. Follow `.agent/PLANS.md`.

## Purpose / Big Picture

A Raspberry Pi Zero 2 W or a first-generation Pi Zero W sits next to a factory shelf. A USB desk barcode reader is attached as a keyboard (HID). A worker can optionally scan a distribution QR code (`DIST:n`, where n is 1 to 5), then scans the 10-digit manufacturing order number (製造オーダー番号) or purchase order number (注文番号) printed on the slip. The parts are then recorded as being placed on the shelf that the device is assigned to. These are the same records the smartphone placement screen (配膳) writes, so the kiosk, the part search, and the phone all show the result without any separate list. If no distribution QR was scanned, the scan means 分配なし (branch 0).

Today this exists only as an older, separate system: `clients/haizen-agent`, the tables `HaizenScanEvent` and `HaizenCurrentPlacement`, and `POST /api/mobile-placement/haizen-scans`. It was never used in production. On 2026-10-27 the production database held one device, `zero2w-tanaban01`, which had been silent since 2026-05-06 and had no shelf assigned, 8 scan events, and 0 current rows. The owner decided to rewrite it from scratch.

## Decisions fixed by the owner (2026-10-27)

Devices live in the factory, and the number of devices will change. When two records for the same order and branch disagree, the one with the newer scan time wins, regardless of arrival order. A distribution QR applies only to the next slip, and with no QR the scan means 分配なし. When 分配なし and numbered branches collide for the same order, the newer record replaces the older one instead of being rejected. When a 10-digit number matches both a schedule row and a purchase order, it is treated as a manufacturing order. Failures (an unassigned shelf, or a number found nowhere) are sent to the kiosk floating Chat as a system notice. Shelf assignment stays in the phone's shelf master screen (棚マスタ > 配置編集 > 「Zero2W 付ける/外す」). Pi Zero W (ARMv6, 32-bit) must be supported.

## Orientation

Phone placement goes through `registerOrderPlacement` in `apps/api/src/services/mobile-placement/mobile-placement-order-placement.service.ts`, called by `POST /api/mobile-placement/register-order-placement` in `apps/api/src/routes/mobile-placement/index.ts`. Each order number plus branch number has one row in `OrderPlacementBranchState` (the current shelf). Every placement also appends an `OrderPlacementEvent` (history, with `placedAt` = the time it was scanned on the device, and `clientRecordId` = a client-generated UUID used to make resends idempotent). Branch 0 means 分配なし and branches 1 to 5 are distribution numbers.

A "device" is a `ClientDevice` row authenticated by the `x-client-key` header via `requireClientDevice` (from `apps/api/src/routes/kiosk/shared.ts`) and `resolveCredentialIdentity`. `ClientDevice.haizenEdgeEnabled` marks a shelf scanner, and `ClientDevice.haizenPresetShelfCodeRaw` is its assigned shelf. Kiosk Chat system notices are created with `deliverSystemNotice({ key, title, body, state })` from `apps/api/src/services/kiosk-inquiry/system-notice.service.ts`. A notice with the same open key is not repeated within 24 hours.

## Plan of Work

Milestone 1 (PR A, API) changes the server so a shelf scanner can post scans into the shared records.

First, `registerOrderPlacement` becomes "newest wins". When the target branch state exists and its last event (`lastEventId`) has a `placedAt` later than the incoming `placedAt`, the incoming record is still stored as an `OrderPlacementEvent` (history), but the branch state is not moved. The result action is `'stale'`. This also protects the phone's offline resend path.

Second, the 409 `ORDER_PLACEMENT_BRANCH_CONFLICT` is replaced. When the incoming branchNo is 0 and numbered branches exist, or the incoming branchNo is numbered and branch 0 exists, the conflicting branch states are compared with the incoming record. If the incoming `placedAt` is newer than the newest `placedAt` among the conflicting states' last events, those conflicting states are deleted inside the same transaction, the same way `deleteOrderPlacementBranch` does, and the incoming placement is created. Otherwise the incoming record is kept only as history and the action is `'stale'`.

Third, a new endpoint, `POST /api/mobile-placement/edge-scans`, is added and authenticated by `x-client-key`. Its body is `{ clientRecordId: uuid, scannedAt: ISO datetime with offset, orderNumber: string, branchNo: 0..5 }`. It requires the device to have `haizenEdgeEnabled` and a preset shelf. It decides the slip kind itself: it uses `manufacturing_order` when `listScheduleRowsByProductNo` finds a row, otherwise `purchase_order` when `findPurchaseOrderLookupRows` finds a row. It then calls `registerOrderPlacement` with the preset shelf.

The endpoint returns 200 with `{ status: 'created' | 'moved' | 'unchanged' | 'stale', branchNo, shelfCodeRaw }`. Permanent failures return 422 with a `code` so the device drops the record instead of resending: `EDGE_SHELF_NOT_ASSIGNED`, `EDGE_DEVICE_NOT_ENABLED`, `EDGE_ORDER_NOT_FOUND`, `EDGE_ORDER_AMBIGUOUS`. Each permanent failure except `EDGE_DEVICE_NOT_ENABLED` also sends a kiosk Chat notice. The title is the device label (location, or name) plus 「棚スキャナ」, and the body is one short plain Japanese sentence. The key is per device and failure kind.

Milestone 2 (PR B) adds a new device agent (stdlib plus python3-evdev, an SQLite queue, a `DIST:n` that applies to the next slip only and expires after 60 s), file-only Ansible deployment without a repository clone, a `zero_edge` group in `infrastructure/ansible/inventory.yml`, and heartbeat monitoring for these hosts. It also verifies the agent on a Pi Zero W.

Milestone 3 (PR C) removes the old haizen path: the `HaizenScanEvent` and `HaizenCurrentPlacement` tables, the `haizen-scans` and `haizen-current` routes, `clients/haizen-agent`, `zero2w-edge-setup.yml`, the Zero2W status page, and the dead `KioskMobileZero2wAssignmentPage.tsx`. It adds the device's last-seen time to the shelf master assignment sheet and updates the KB and runbook.

## Validation

For milestone 1, run from the repository root:

    pnpm --filter @raspi-system/api test -- mobile-placement-order-placement order-placement edge-scan
    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/api build

The tests must show the following. An older `placedAt` arriving after a newer one leaves the shelf unchanged and returns `stale`. A newer 分配なし replaces existing numbered branches, and an older one does not. The edge endpoint auto-detects the slip kind, prefers the manufacturing order when both match, returns 422 with the right code, and sends exactly one Chat notice per failure key. A resend with the same clientRecordId returns the first result.

## Progress

- [x] (2026-10-27) Survey, production DB read, and owner decisions.
- [x] (2026-10-27) Milestone 1: API (PR A) implemented locally: newest-wins placement, conflicting branch replacement, authenticated edge scans, permanent failure notices, and regression tests. Not committed, pushed, or merged; integrationPending.
- [x] (2026-10-27) Milestone 1 validation from `apps/api`: `npx vitest run src/services/mobile-placement src/routes/__tests__/mobile-placement-branch-delete.test.ts` passed (21 files, 299 tests); `npx eslint src/services/mobile-placement src/routes/mobile-placement` passed; `npx --offline --prefix "$PWD" tsc -p tsconfig.build.json --noEmit` passed. Missing workspace dependency build outputs were generated locally; explicit npm prefix was needed to resolve the installed TypeScript compiler without a registry request.
- [x] (2026-10-27) Milestone 1 merged as #2334 (1997395c) and deployed to Pi5 (run 20261027-062818-6c0a3d).
- [x] (2026-10-27) Milestone 2 implemented: `clients/zero-edge-agent`, `infrastructure/ansible/playbooks/zero-edge.yml`, `infrastructure/ansible/inventory-zero-edge.yml`, heartbeat pattern `zero-edge-`. Agent tests 67 passed. Not yet verified on a device.
- [ ] Milestone 2: run the playbook on zero2w-tanaban01 (Zero 2 W) and confirm a scan reaches the server.
- [ ] Milestone 3: removal + UI + docs (PR C).

## Surprises & Discoveries

- The heartbeat alert pattern `^(raspi|raspberrypi)` in `apps/api/src/services/clients/client-heartbeat-alert-policy.ts` excludes `zero2w-*`. Milestone 2 must change it or name the hosts to match.
- Review of milestone 1 (2026-10-27): the server replaces any placedAt older than 7 days or more than 5 minutes ahead with the arrival time, so a device with an unsynchronised clock would win over newer records. The milestone 2 agent must not record scans until the clock is synchronised (Pi Zero has no RTC), and must drop queued scans older than 7 days. The edge route returns 400 for a malformed body; the agent must treat 400 and 422 as permanent and only resend on network errors and 5xx.
- A resend of a record that was first answered `stale` now answers `stale` again with the current branch, so the phone toast does not flip to 「置きました」. When two records have the same placedAt, the one that arrives later wins, both for the same branch and for 分配なし/番号付き replacement.
- The old Ansible path git-clones the whole repository onto the device, which is too heavy for a Pi Zero W.
- Review of milestone 2: python-evdev has no `set_clockid`, so the first draft would have crash-looped on the device; tests used loose mocks and passed. Fake devices are now strict.
- Review of milestone 2: `scripts/deploy/standard-ansible-release.py` rejects any inventory host outside server/kiosk/signage when no `--limit` is given, so a `zero_edge` group in `inventory.yml` with a host would break `--print-plan` and `--full-fleet`. The group lives in the separate `inventory-zero-edge.yml`; device hosts go in a git-ignored fragment on Pi5.

## Decision Log

- Decision: Use one record table (`OrderPlacementBranchState`/`OrderPlacementEvent`) for phone and shelf scanner. Rationale: the owner wants one truth, and the old tables hold no live data. Date: 2026-10-27.
- Decision: Permanent failures use 422 plus a Chat notice, and transient failures use 5xx so the device resends. Rationale: the device queue must not loop forever on bad input. Date: 2026-10-27.

## Outcomes & Retrospective

(To be filled at each milestone.)
