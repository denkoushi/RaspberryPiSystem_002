#!/usr/bin/env node
/**
 * Pi5 実データ: continue chunk pageSize A/B（現行 80 vs 候補 160 · 80/160）読み取りベンチ。
 * 出力同値: 完走後 rows[].id 列を比較。
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-continue-chunk.mjs
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-continue-chunk.mjs --profile stonebase
 */

const BASE_URL = (process.env.LEADERBOARD_BENCH_BASE_URL ?? 'https://100.106.158.2').replace(/\/$/, '');
const CLIENT_KEY = process.env.LEADERBOARD_BENCH_CLIENT_KEY ?? 'client-key-raspberrypi4-kiosk1';
const SHELL_PAGE_SIZE = 80;
const CHUNK_SIZES = [80, 160];
const MAX_CONTINUE_ROUNDS = 200;
const COOLDOWN_MS = 3000;

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
  let profiles = Object.keys(PROFILES);
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--profile' && argv[i + 1]) {
      profiles = [argv[++i]];
    }
  }
  return { profiles };
}

async function timedFetch(url, init = {}) {
  const started = performance.now();
  const res = await fetch(url, {
    ...init,
    headers: { 'x-client-key': CLIENT_KEY, ...(init.headers ?? {}) },
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
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return { json, elapsedMs };
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

function continuePayload(resourceCds, board, continuePageSize) {
  return {
    boardResourceCds: resourceCds.join(','),
    allowResourceOnly: true,
    includeDecorations: false,
    pageSize: continuePageSize,
    resourceSlices: (board.resources ?? []).map((r) => ({
      resourceCd: r.resourceCd,
      snapshotId: r.snapshotId,
      cursor: r.nextCursor,
      hasMore: r.hasMore
    }))
  };
}

function rowIdFingerprint(board) {
  return (board?.rows ?? []).map((r) => r.id).join('\u0001');
}

async function fetchComplete(resourceCds, continuePageSize) {
  const timings = [];
  const shell = await timedFetch(boardQuery(resourceCds));
  timings.push({ phase: 'shell', elapsedMs: shell.elapsedMs, rows: shell.json.rows?.length ?? 0 });
  let board = shell.json;

  let guard = 0;
  while (hasMoreResources(board) && guard < MAX_CONTINUE_ROUNDS) {
    guard += 1;
    const cont = await timedFetch(`${BASE_URL}/api/kiosk/production-schedule/leaderboard-board/continue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(continuePayload(resourceCds, board, continuePageSize))
    });
    timings.push({
      phase: `continue-${guard}`,
      elapsedMs: cont.elapsedMs,
      rows: cont.json.rows?.length ?? 0
    });
    if (cont.json.snapshotExpired) {
      return { error: 'snapshotExpired', timings, board: cont.json, continuePageSize };
    }
    board = cont.json;
  }

  const continueTimings = timings.slice(1);
  return {
    continuePageSize,
    board,
    timings,
    totalRows: board.rows?.length ?? 0,
    totalMs: timings.reduce((s, t) => s + t.elapsedMs, 0),
    shellMs: timings[0]?.elapsedMs ?? 0,
    continueMs: continueTimings.reduce((s, t) => s + t.elapsedMs, 0),
    continueCount: continueTimings.length,
    avgContinueMs: continueTimings.length > 0 ? continueTimings.reduce((s, t) => s + t.elapsedMs, 0) / continueTimings.length : 0,
    rowIds: rowIdFingerprint(board)
  };
}

function evaluateGate(baseline, candidate) {
  const idsMatch = baseline.rowIds === candidate.rowIds;
  const rowCountMatch = baseline.totalRows === candidate.totalRows;
  const speedup = baseline.totalMs / candidate.totalMs;
  const savedMs = baseline.totalMs - candidate.totalMs;
  const savedPct = baseline.totalMs > 0 ? (savedMs / baseline.totalMs) * 100 : 0;
  return { idsMatch, rowCountMatch, speedup, savedMs, savedPct };
}

async function runProfile(profileKey, profile) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`Profile: ${profileKey} — ${profile.label}`);
  console.log(`resourceCds: ${profile.resourceCds.join(',')}`);
  console.log(`shell pageSize=${SHELL_PAGE_SIZE}`);

  const results = {};
  for (let i = 0; i < CHUNK_SIZES.length; i += 1) {
    const chunk = CHUNK_SIZES[i];
    console.log(`\n  [continue pageSize=${chunk}] fetching...`);
    results[chunk] = await fetchComplete(profile.resourceCds, chunk);
    if (results[chunk].error) {
      console.log(`  ERROR: ${results[chunk].error}`);
    } else {
      const r = results[chunk];
      console.log(
        `  totalMs=${r.totalMs.toFixed(1)} shell=${r.shellMs.toFixed(1)} continue=${r.continueMs.toFixed(1)} rounds=${r.continueCount} avgContinue=${r.avgContinueMs.toFixed(0)}ms rows=${r.totalRows}`
      );
    }
    if (i < CHUNK_SIZES.length - 1) {
      await new Promise((res) => setTimeout(res, COOLDOWN_MS));
    }
  }

  const baseline = results[80];
  const candidate = results[160];
  if (!baseline?.error && !candidate?.error) {
    const gate = evaluateGate(baseline, candidate);
    console.log('\n  --- A/B (80 vs 160) ---');
    console.log(`  row ids match: ${gate.idsMatch ? 'YES' : 'NO'}`);
    console.log(`  row count: ${baseline.totalRows} vs ${candidate.totalRows}`);
    console.log(`  http requests: ${baseline.timings.length} vs ${candidate.timings.length}`);
    console.log(`  totalMs: ${baseline.totalMs.toFixed(1)} vs ${candidate.totalMs.toFixed(1)}`);
    console.log(`  speedup (160 vs 80): ${gate.speedup.toFixed(2)}x (${gate.savedPct >= 0 ? 'saved' : 'lost'} ${Math.abs(gate.savedPct).toFixed(1)}%)`);
    console.log(`  continue rounds: ${baseline.continueCount} vs ${candidate.continueCount}`);
    console.log(`  avg continue hop: ${baseline.avgContinueMs.toFixed(0)}ms vs ${candidate.avgContinueMs.toFixed(0)}ms`);
    const passOutput = gate.idsMatch && gate.rowCountMatch;
    const passPerf = gate.speedup >= 1.05;
    console.log(`  gate output同値: ${passOutput ? 'PASS' : 'FAIL'}`);
    console.log(`  gate 5%+ faster: ${passPerf ? 'PASS' : 'FAIL (marginal or slower)'}`);
    return { profileKey, baseline, candidate, gate, passOutput, passPerf };
  }
  return { profileKey, error: baseline?.error ?? candidate?.error };
}

async function main() {
  const { profiles } = parseArgs(process.argv);
  console.log(`Leaderboard continue chunk A/B bench`);
  console.log(`base: ${BASE_URL}`);

  const health = await timedFetch(`${BASE_URL}/api/system/health`);
  console.log(`health: ${health.json.status} (${health.elapsedMs.toFixed(0)}ms)`);

  const all = [];
  for (const key of profiles) {
    if (!PROFILES[key]) {
      console.error(`Unknown profile: ${key}`);
      process.exit(1);
    }
    all.push(await runProfile(key, PROFILES[key]));
    if (profiles.length > 1) {
      console.log('\n  Cooldown 8s before next profile...');
      await new Promise((r) => setTimeout(r, 8000));
    }
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log('SUMMARY');
  for (const r of all) {
    if (r.error) {
      console.log(`  ${r.profileKey}: ERROR ${r.error}`);
      continue;
    }
    const g = r.gate;
    console.log(
      `  ${r.profileKey}: ${g.speedup.toFixed(2)}x | rounds ${r.baseline.continueCount}→${r.candidate.continueCount} | ids=${g.idsMatch ? 'OK' : 'NG'} | ${g.savedPct.toFixed(1)}% ${g.savedPct >= 0 ? 'saved' : 'slower'}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
