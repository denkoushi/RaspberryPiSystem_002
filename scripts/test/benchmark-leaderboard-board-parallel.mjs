#!/usr/bin/env node
/**
 * Pi5 実データ向け: 順位ボード board 取得の直列集約 vs スロット並列（読み取りのみ）ベンチ。
 *
 * Usage:
 *   node scripts/test/benchmark-leaderboard-board-parallel.mjs [--profile robodrill|fjv|stonebase] [--runs 1]
 *
 * Env:
 *   LEADERBOARD_BENCH_BASE_URL  (default https://100.106.158.2)
 *   LEADERBOARD_BENCH_CLIENT_KEY (default client-key-raspberrypi4-kiosk1)
 */

const BASE_URL = (process.env.LEADERBOARD_BENCH_BASE_URL ?? 'https://100.106.158.2').replace(/\/$/, '');
const CLIENT_KEY = process.env.LEADERBOARD_BENCH_CLIENT_KEY ?? 'client-key-raspberrypi4-kiosk1';
const SHELL_PAGE_SIZE = 80;
const CONTINUE_PAGE_SIZE = 40;
const MAX_CONTINUE_ROUNDS = 200;

const PROFILES = {
  robodrill: {
    label: '第2工場 RoboDrill01 (6 slots)',
    resourceCds: ['500', '051', '052', '070', '24M', '26M']
  },
  fjv: {
    label: '第2工場 FJV60/80 (6 slots)',
    resourceCds: ['080', '060', '501', '502', '021', '033']
  },
  stonebase: {
    label: '第2工場 kensakuMain (8 slots)',
    resourceCds: ['581', '305', '584', '585', '586', '587', '589', '588']
  }
};

function parseArgs(argv) {
  let profile = 'robodrill';
  let runs = 1;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--profile' && argv[i + 1]) {
      profile = argv[++i];
    } else if (argv[i] === '--runs' && argv[i + 1]) {
      runs = Math.max(1, Number.parseInt(argv[++i], 10) || 1);
    }
  }
  return { profile, runs };
}

async function timedFetch(url, init = {}) {
  const started = performance.now();
  const res = await fetch(url, {
    ...init,
    headers: {
      'x-client-key': CLIENT_KEY,
      ...(init.headers ?? {})
    },
    signal: AbortSignal.timeout(300_000)
  });
  const elapsedMs = performance.now() - started;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.elapsedMs = elapsedMs;
    throw err;
  }
  return { json, elapsedMs, status: res.status };
}

function boardQuery(resourceCds) {
  const qs = new URLSearchParams({
    boardResourceCds: resourceCds.join(','),
    pageSize: String(SHELL_PAGE_SIZE),
    allowResourceOnly: 'true',
    includeDecorations: 'false'
  });
  return `${BASE_URL}/api/kiosk/production-schedule/leaderboard-board?${qs}`;
}

function hasMoreResources(board) {
  return (board.resources ?? []).some(
    (r) => r.hasMore || (typeof r.nextCursor === 'number' && typeof r.total === 'number' && r.nextCursor < r.total)
  );
}

function continuePayload(resourceCds, board) {
  return {
    boardResourceCds: resourceCds.join(','),
    allowResourceOnly: true,
    includeDecorations: false,
    pageSize: CONTINUE_PAGE_SIZE,
    resourceSlices: (board.resources ?? []).map((r) => ({
      resourceCd: r.resourceCd,
      snapshotId: r.snapshotId,
      cursor: r.nextCursor,
      hasMore: r.hasMore
    }))
  };
}

async function fetchBoardCompleteSerial(resourceCds) {
  const timings = [];
  let rounds = 0;

  const shell = await timedFetch(boardQuery(resourceCds));
  timings.push({ phase: 'shell', elapsedMs: shell.elapsedMs, rows: shell.json.rows?.length ?? 0 });
  let board = shell.json;
  rounds += 1;

  while (hasMoreResources(board) && rounds <= MAX_CONTINUE_ROUNDS) {
    const cont = await timedFetch(`${BASE_URL}/api/kiosk/production-schedule/leaderboard-board/continue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(continuePayload(resourceCds, board))
    });
    timings.push({
      phase: `continue-${rounds}`,
      elapsedMs: cont.elapsedMs,
      rows: cont.json.rows?.length ?? 0
    });
    if (cont.json.snapshotExpired) {
      return { mode: 'serial-aggregate', error: 'snapshotExpired', timings, rounds, board: cont.json };
    }
    board = cont.json;
    rounds += 1;
  }

  return {
    mode: 'serial-aggregate',
    timings,
    rounds,
    board,
    totalRows: board.rows?.length ?? 0,
    totalMs: timings.reduce((s, t) => s + t.elapsedMs, 0),
    shellMs: timings[0]?.elapsedMs ?? 0,
    continueMs: timings.slice(1).reduce((s, t) => s + t.elapsedMs, 0),
    continueCount: Math.max(0, timings.length - 1)
  };
}

async function fetchSingleSlotComplete(resourceCd) {
  const timings = [];
  let rounds = 0;
  const shell = await timedFetch(boardQuery([resourceCd]));
  timings.push({ phase: 'shell', elapsedMs: shell.elapsedMs, rows: shell.json.rows?.length ?? 0 });
  let board = shell.json;
  rounds += 1;

  while (hasMoreResources(board) && rounds <= MAX_CONTINUE_ROUNDS) {
    const cont = await timedFetch(`${BASE_URL}/api/kiosk/production-schedule/leaderboard-board/continue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(continuePayload([resourceCd], board))
    });
    timings.push({
      phase: `continue-${rounds}`,
      elapsedMs: cont.elapsedMs,
      rows: cont.json.rows?.length ?? 0
    });
    if (cont.json.snapshotExpired) {
      return { resourceCd, error: 'snapshotExpired', timings, board: cont.json };
    }
    board = cont.json;
    rounds += 1;
  }

  const totalMs = timings.reduce((s, t) => s + t.elapsedMs, 0);
  return {
    resourceCd,
    timings,
    rounds,
    board,
    totalRows: board.rows?.length ?? 0,
    totalMs,
    shellMs: timings[0]?.elapsedMs ?? 0,
    continueCount: Math.max(0, timings.length - 1)
  };
}

async function fetchBoardCompleteParallel(resourceCds) {
  const started = performance.now();
  const slotResults = await Promise.all(resourceCds.map((cd) => fetchSingleSlotComplete(cd)));
  const wallMs = performance.now() - started;

  const totalRows = slotResults.reduce((s, r) => s + (r.totalRows ?? 0), 0);
  const maxSlotMs = Math.max(...slotResults.map((r) => r.totalMs ?? 0));
  const sumSlotMs = slotResults.reduce((s, r) => s + (r.totalMs ?? 0), 0);
  const maxShellMs = Math.max(...slotResults.map((r) => r.shellMs ?? 0));
  const requestCount = slotResults.reduce((s, r) => s + (r.timings?.length ?? 0), 0);

  return {
    mode: 'parallel-per-slot',
    wallMs,
    totalRows,
    maxSlotMs,
    sumSlotMs,
    maxShellMs,
    requestCount,
    slotResults
  };
}

function summarizeResources(board, resourceCds) {
  const rows = board?.rows ?? [];
  const byCd = Object.fromEntries(resourceCds.map((cd) => [cd, 0]));
  for (const row of rows) {
    const cd = String(row.rowData?.FSIGENCD ?? row.resourceCd ?? '').trim();
    if (cd in byCd) byCd[cd] += 1;
  }
  return byCd;
}

function printReport(profileKey, profile, serial, parallel) {
  console.log('\n=== Leaderboard board benchmark (read-only) ===');
  console.log(`base: ${BASE_URL}`);
  console.log(`profile: ${profileKey} — ${profile.label}`);
  console.log(`resourceCds: ${profile.resourceCds.join(',')}`);
  console.log(`pageSize: shell=${SHELL_PAGE_SIZE} continue=${CONTINUE_PAGE_SIZE}`);

  if (serial.error) {
    console.log(`\n[serial] ERROR: ${serial.error}`);
  } else {
    console.log('\n--- Serial aggregate (current client pattern) ---');
    console.log(`  totalMs: ${serial.totalMs.toFixed(1)} (shell ${serial.shellMs.toFixed(1)} + continue ${serial.continueMs.toFixed(1)})`);
    console.log(`  httpRequests: ${serial.timings.length} (continue rounds: ${serial.continueCount})`);
    console.log(`  totalRows(flat): ${serial.totalRows}`);
    console.log(`  perResource rows: ${JSON.stringify(summarizeResources(serial.board, profile.resourceCds))}`);
    const slowest = [...serial.timings].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 5);
    console.log(`  slowest hops: ${slowest.map((t) => `${t.phase}=${t.elapsedMs.toFixed(0)}ms`).join(', ')}`);
  }

  console.log('\n--- Parallel per-slot (simulated fan-out) ---');
  console.log(`  wallMs (Promise.all): ${parallel.wallMs.toFixed(1)}`);
  console.log(`  maxSlotMs: ${parallel.maxSlotMs.toFixed(1)} (bottleneck slot)`);
  console.log(`  sumSlotMs (if serial slots): ${parallel.sumSlotMs.toFixed(1)}`);
  console.log(`  maxShellMs (first paint proxy per slot): ${parallel.maxShellMs.toFixed(1)}`);
  console.log(`  httpRequests (all slots): ${parallel.requestCount}`);
  console.log(`  totalRows(sum slots): ${parallel.totalRows}`);
  for (const slot of parallel.slotResults) {
    console.log(
      `  slot ${slot.resourceCd}: totalMs=${slot.totalMs?.toFixed(1)} shell=${slot.shellMs?.toFixed(1)} continues=${slot.continueCount} rows=${slot.totalRows}${slot.error ? ` ERR=${slot.error}` : ''}`
    );
  }

  if (!serial.error && serial.totalMs > 0) {
    const speedup = serial.totalMs / parallel.wallMs;
    console.log('\n--- Comparison ---');
    console.log(`  wall-clock speedup (parallel / serial): ${speedup.toFixed(2)}x`);
    console.log(`  parallel saves ~${(serial.totalMs - parallel.wallMs).toFixed(0)}ms vs serial aggregate`);
    console.log(`  parallel HTTP requests: ${parallel.requestCount} vs serial ${serial.timings.length} (${parallel.requestCount > serial.timings.length ? 'more load on Pi5' : 'fewer or equal'})`);
  }
}

async function main() {
  const { profile: profileKey, runs } = parseArgs(process.argv);
  const profile = PROFILES[profileKey];
  if (!profile) {
    console.error(`Unknown profile: ${profileKey}. Use: ${Object.keys(PROFILES).join(', ')}`);
    process.exit(1);
  }

  console.log(`Health check: ${BASE_URL}/api/system/health`);
  const health = await timedFetch(`${BASE_URL}/api/system/health`);
  console.log(`  ok (${health.elapsedMs.toFixed(0)}ms) status=${health.json.status}`);

  for (let run = 1; run <= runs; run += 1) {
    if (runs > 1) console.log(`\n######## Run ${run}/${runs} ########`);
    console.log('\nRunning serial aggregate...');
    const serial = await fetchBoardCompleteSerial(profile.resourceCds);
    console.log('Running parallel per-slot...');
    const parallel = await fetchBoardCompleteParallel(profile.resourceCds);
    printReport(profileKey, profile, serial, parallel);
    if (run < runs) {
      console.log('\nCooldown 5s...');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
