# Perceived Performance Audit and Fixes (2026-11)

## Status

- Scope: user-perceived speed of kiosk (Pi4), admin, signage and mobile screens.
- State: fixes implemented on branch `claude/loving-bardeen-ph3wez` (PR pending merge). Not deployed. Real-device measurement not done.
- Method: per-feature audit with an independent refutation pass, measured in a cloud VM (local PostgreSQL 16 + API + production `vite build`). Pi numbers below are estimates.

## Measurement Environment

- Cloud VM, 4 vCPU. Synthetic DBs at factory scale (e.g. 86k schedule rows / 3,200 FSEIBANs, 60k schedule rows + 600 verify records, 25 ClientDevices, 45k-100k loans).
- Browser timing: headless Chromium, CDP CPU throttling 6x (Pi4 approximation), cold cache, emulated 50 Mbps / 5 ms, median of 5 runs.
- Production `CsvDashboardRow` is about 6.5M rows (see KB api.md); synthetic DBs are smaller, so DB gains in production are expected to be equal or larger.

## Fixed (before → after, measured in VM)

| Area | Change | Before → After |
|---|---|---|
| All screens (web) | SOP manual HTML (3.0 MB base64 PNG) moved out of the entry chunk; loaded at startup only on screens with the SOP launcher | entry JS 6.70 MB / 3.22 MB gzip → 3.02 MB / 0.85 MB gzip (together with admin lazy) |
| All screens (web) | Admin/tools pages lazy-loaded (kiosk/signage/mobile pages stay eager) | included above (−0.59 MB raw) |
| All screens (Caddy) | `encode zstd gzip` on static route; `immutable` Cache-Control only for Vite-hashed `/assets/*` | /kiosk first text 2.9 s → 1.7 s; bytes 7.75 MB → 1.22 MB; JS heap 19.5 → 7.6 MB |
| Due management | earliest due date via scalar subquery; triage scoped to target FSEIBANs before aggregation; second coverage scan merged | triage 4.9-5.2 s → 0.4-0.6 s; summary 4.8-5.2 s → 2.5-2.8 s; proposal/explanation 2.0 s → 1.3-1.6 s |
| Mobile verify history / order trail | 500-way JSON-path OR → `->> = ANY(text[])` id lookup | verify-records 3.8-4.3 s → 67-83 ms; order-trail ~30 ms → ~15 ms |
| Mobile shelf photos | near-viewport tiles fetched first; the rest still prefetched in background (offline cache kept, retry 3) | visible photos ready 5.9-7.8 s → 3.8-4.3 s (cold), 4.5-5.2 s → 2.3-2.8 s (warm) |
| Part search | normalizer: hoisted yoon table, hiragana-free fast path (byte-identical, equivalence test) | index build 5,000 rows 214-239 ms → 35-44 ms |
| Signage render (Pi5 CPU) | identical payloads rendered once per cycle, saved per client | 25 clients: 8.9-9.1 s → 0.87-0.98 s per cycle |
| Loan analytics / loan report | month list as bound VALUES instead of `generate_series` (removes JIT) | 0.31-0.65 s → 0.15-0.28 s per call |
| Kiosk loan scan | no 500 ms debounce for URL/NFC tag UIDs; parallel by-tag lookups; shared cached tag map; server Collator + Promise.all | −500 ms (instrument via URL/NFC), −1 round trip per scan; /api/tools/unified ~80 → ~72 ms |

## Remaining Candidates (not done, need owner decision)

- PostgreSQL JIT: schedule queries spend 0.35-0.6 s in JIT. A global `jit=off` conflicts with the earlier decision in `kiosk-leaderboard-first-display-performance-202607.md` (transaction-local only). Options: raise `jit_*_above_cost`, or `SET LOCAL jit=off` on hot queries.
- Schedule search `FHINCD`/`FSEIBAN` substring ILIKE has no trigram index (about 1 s per count/page query on 86k rows). Needs a migration; building a GIN index on the 6.5M-row table is heavy.
- Google Fonts stylesheet in `apps/web/index.html` is render-blocking; if the factory network silently drops packets to fonts.googleapis.com, startup can stall. Making it non-blocking changes the first paint font (FOUT).
- Signage SPA `/signage` re-downloads `current-image` every 5 s while the server renders every 30 s (visible staleness change if aligned).
- Kiosks without `kiosk_server_cert_spki_sha256` launch Chromium with `--ignore-certificate-errors`; responses with certificate errors may not be disk-cached, so those kiosks may re-download the entry on every load. Verify on a device.
- `Transaction.createdAt` has no index (admin history list sorts the whole table). Needs a migration; low impact.
- Due management summary still ~2.5 s (shared winner aggregation). Request coalescing was rejected because of a read-after-write risk.
- `useLocalPlacements` creates a new rows array on every store/outbox notification even when unchanged, forcing a part-search index rebuild.
- Schedule table / active-loan cards re-render fully on each poll (not measured in a profiler).

## Real-Device Verification Plan

1. Caddy config: on a host with Docker run `scripts/deploy/tests/test-web-static-routing.sh` (no Caddy binary was available in the VM). After deploy, `curl -sI -H 'Accept-Encoding: gzip' https://<pi5>/assets/<app-hash>.js` must show `Content-Encoding` and `Cache-Control: public, max-age=31536000, immutable`; `index.html` must keep its current headers.
2. Pi4 kiosk cold load: in Chromium DevTools (remote debugging) Network tab with cache disabled, record transferred bytes and the time until the `/kiosk/tag` screen text appears, before and after deploy. Expected: about 7.7 MB → 1.2 MB, and about 1 s sooner.
3. Kiosk heap: `performance.memory.usedJSHeapSize` on `/kiosk/tag` after load (expected about −12 MB).
4. SOP popup: on `/kiosk/part-measurement/inspection` and `/kiosk/assembly/library`, open the SOP after the screen loads, also once with the network unplugged after load.
5. Due management: time `GET /api/kiosk/production-schedule/due-management/{summary,triage}` on Pi5 with `curl -w '%{time_total}'` (x-client-key of a kiosk), 3 runs each.
6. Mobile: open the haizen verify history and the shelf grid on a phone; time verify-records with curl on Pi5.
7. Signage: Pi5 API log `Scheduled signage render completed` `durationMs` before/after, and Pi5 CPU load (`top`) during the 30 s cycle.
8. Instrument borrow: scan an instrument NFC tag on Pi4 and confirm the instrument appears without the previous ~0.5 s delay.

## Local Notes JA

- 実機の速さは未計測。上表の数値はクラウド VM での実測、Pi の値はすべて推定。
- 「挙動・表示は変えない」方針で、表示が変わり得る候補（フォント、サイネージ更新間隔）と DB migration・全体設定変更（JIT）は残課題に回した。
