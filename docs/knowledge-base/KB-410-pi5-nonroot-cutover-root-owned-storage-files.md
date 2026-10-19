---
id: KB-410
title: Pi5 non-root cutover left root-owned storage files (inspection drawing not shown)
status: active
scope: Pi5 API file storage (`/opt/RaspberryPiSystem_002/storage`), kiosk inspection drawings, file integrity catalog
date: 2026-09-30
source_of_truth: true
related_code:
  - apps/api/src/routes/storage/part-measurement-drawings.ts
  - apps/api/src/services/file-storage/file-storage-integrity-catalog.ts
  - apps/api/src/services/file-storage/secure-atomic-file.ts
  - infrastructure/ansible/playbooks/prepare-pi5-runtime-permissions.yml
related_docs:
  - ../plans/production-secrets-and-runtime-execplan.md
  - ../plans/standard-release-production-path-audit-execplan.md
  - ./KB-320-kiosk-part-measurement.md
validation: API-user read of drawing and integrity record, SHA256 match, zero root-owned files under storage, kiosk display confirmed on Pi4 StoneBase
open_items:
  - retire the verification-only template `サドル_表` (MD004809542) whose drawing file is missing
  - decide whether the standard release should fail closed on root-owned files under storage (not implemented)
---

# KB-410: Pi5 non-root cutover left root-owned storage files

## Context

On 2026-09-30 the kiosk inspection drawing screen (キオスク＞検査図面) did not
show the drawing for ナットホルダ `MD005281340` (template
`26623ca7-ae78-49fc-a218-a243a87a31b7`, GRINDING / resource 586, visual
template `02d6067e-e106-45cd-9c49-dd82aeacef83`). The screen showed
`図面の読み込みに失敗しました`. Other drawings displayed normally.

## Symptoms Or Trigger

- `GET /api/storage/part-measurement-drawings/1c65d3a2-ada4-4598-a60c-5b02215e6907.jpg` failed.
- API log, first layer: `EACCES: permission denied, open '/app/storage/part-measurement-drawings/1c65d3a2-….jpg'`
  (also repeated every 10 minutes by the `partMeasurementDrawingOcr` worker).
- After the file owner was fixed, second layer: `FILE_STORAGE_INTEGRITY_MISMATCH`
  / `保存ファイルの整合性を確認できません` from `FileStorageIntegrityCatalog.get`.

## Investigation

1. DB: the template and visual template were active and pointed to an existing path. Not a data-link problem.
2. Storage listing inside the API container: every drawing was `node:node 0644`
   except this one, which was `root:root 0600`. The API runs as UID 1000 with
   `CapDrop: ALL`, so it cannot read the file, and `chown` inside the container
   fails with `Operation not permitted`.
3. Fixing the drawing file alone was not enough. Its integrity record
   `.integrity/v1/objects/ec/eca8fa69….json` (key = sha256 of the storage key)
   was also `root:root 0600`. The catalog treats an unreadable record as a
   mismatch and refuses delivery (fail-closed by design).
4. A host scan (`find storage -user root`) found every root-owned storage file
   written between **2026-08-04 12:21 and 2026-08-05 04:15 JST**:
   drawing 1, `csv-dashboards` raw CSV 224, `.integrity/v1` 225.
5. The execution logs in the ExecPlans match that window exactly (see Root Cause).
6. Cross-check of all 39 visual templates against files: 37 OK, this one
   unreadable (fixed), and `サドル_表` (MD004809542) has **no file at all**
   (created 2026-04-03, verification data; to be retired, not restored).

## Root Cause

Ownership migration and runtime cutover were separated in time during the
2026-08-04 container hardening (`de6030e9`, non-root API/Web):

| Time (JST) | Event |
|---|---|
| 2026-08-04 12:16 | One-time `prepare-pi5-runtime-permissions.yml` recursively chowned `storage` to UID 1000 |
| 2026-08-04 12:33–19:11 | Several standard releases failed closed; the **old root API stayed active** |
| 2026-08-04 15:59 | Drawing for MD005281340 uploaded through the old API → written as root |
| 2026-08-05 ~04:26 | Non-root API finally became active (`20260804-185819-598324`) |

The old API ran as root and the secure atomic writer creates files with
`0o600`, so every file it wrote after the one-time chown stayed root-only.
Nothing re-ran the ownership migration immediately before the cutover.

## Fix

Host-side only (container has no CAP_CHOWN), run by the operator with sudo:

```bash
sudo chown 1000:1000 /opt/RaspberryPiSystem_002/storage/part-measurement-drawings/1c65d3a2-ada4-4598-a60c-5b02215e6907.jpg
sudo chmod 644 /opt/RaspberryPiSystem_002/storage/part-measurement-drawings/1c65d3a2-ada4-4598-a60c-5b02215e6907.jpg
sudo find /opt/RaspberryPiSystem_002/storage/csv-dashboards /opt/RaspberryPiSystem_002/storage/.integrity -user root -exec chown 1000:1000 {} +
```

File contents were not changed. No code change.

## Prevention

- When a permission migration and a runtime user change are applied in
  separate steps, re-scan (`find <tree> -user root`) right before or after the
  cutover, not only at the first migration.
- For "drawing not shown" / `図面の読み込みに失敗しました`, check both the file
  and its `.integrity/v1/objects/<xx>/<sha256(storageKey)>.json` record.
- Not implemented: a release preflight that fails on root-owned files under
  `storage` (listed in Open Items).

## Validation

- `node` in `bluegreen-api-green-1` read the drawing (`197494` bytes) and its integrity record.
- Integrity record `sha256` `05ba10c7…` and `size` `197494` equal the file on disk.
- `sudo find /opt/RaspberryPiSystem_002/storage -user root | wc -l` → `0`.
- Kiosk on Pi4 StoneBase displayed the MD005281340 drawing (operator confirmed, 2026-09-30).

## Open Items

- Retire `サドル_表` (MD004809542) with the kiosk library 「無効」 button (verification data, file missing).
- Decide on a storage-ownership release guard.

## References

- Container hardening commit `de6030e9`; [production-secrets-and-runtime-execplan.md](../plans/production-secrets-and-runtime-execplan.md) (2026-08-04 timeline)
- [standard-release-production-path-audit-execplan.md](../plans/standard-release-production-path-audit-execplan.md) (2026-08-05 04:26 cutover)
- Out of scope: root-owned files in `alerts/` and `config/host-etc` are written by host root services and Ansible, not by the API.
