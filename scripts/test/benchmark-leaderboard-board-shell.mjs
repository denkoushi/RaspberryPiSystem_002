#!/usr/bin/env node
/**
 * Pi5 実データ: leaderboard-board shell GET の壁時計計測（初回ペイント相当）。
 * サーバ側最適化の before/after 比較用（読み取りのみ）。
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-board-shell.mjs
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-board-shell.mjs --profile stonebase --runs 3
 */

const BASE_URL = (process.env.LEADERBOARD_BENCH_BASE_URL ?? 'https://100.106.158.2').replace(/\/$/, '');
const CLIENT_KEY = process.env.LEADERBOARD_BENCH_CLIENT_KEY ?? 'client-key-raspberrypi4-kiosk1';
const SHELL_PAGE_SIZE = 80;
const COOLDOWN_MS = 2000;

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
  let runs = 2;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--profile' && argv[i + 1]) {
      profiles = [argv[++i]];
    } else if (argv[i] === '--runs' && argv[i + 1]) {
      runs = Math.max(1, Number.parseInt(argv[++i], 10) || 2);
    }
  }
  return { profiles, runs };
}

async function timedShellFetch(resourceCds) {
  const qs = new URLSearchParams({
    boardResourceCds: resourceCds.join(','),
    pageSize: String(SHELL_PAGE_SIZE),
    allowResourceOnly: 'true',
    includeDecorations: 'false'
  });
  const url = `${BASE_URL}/api/kiosk/production-schedule/leaderboard-board?${qs}`;
  const started = performance.now();
  const res = await fetch(url, {
    headers: { 'x-client-key': CLIENT_KEY },
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
  const resources = json.resources ?? [];
  const hasMoreCount = resources.filter((r) => r.hasMore).length;
  const completeInShellCount = resources.filter((r) => !r.hasMore).length;
  return {
    elapsedMs,
    rowCount: json.rows?.length ?? 0,
    total: json.total ?? 0,
    slotCount: resources.length,
    hasMoreCount,
    completeInShellCount,
    resources: resources.map((r) => ({
      resourceCd: r.resourceCd,
      rowsInShell: (json.rows ?? []).filter((row) => row.rowData?.FSIGENCD === r.resourceCd).length,
      hasMore: r.hasMore,
      total: r.total,
      nextCursor: r.nextCursor
    }))
  };
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((s, n) => s + n, 0);
  const mid = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return {
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    avgMs: sorted.length > 0 ? sum / sorted.length : 0,
    medianMs: mid
  };
}

async function runProfile(profileKey, profile, runs) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`Profile: ${profileKey} — ${profile.label}`);
  console.log(`resourceCds (${profile.resourceCds.length}): ${profile.resourceCds.join(',')}`);
  console.log(`shell pageSize=${SHELL_PAGE_SIZE} · runs=${runs}`);

  const shellMsSamples = [];
  let lastDetail = null;

  for (let run = 1; run <= runs; run += 1) {
    if (run > 1) {
      await new Promise((r) => setTimeout(r, COOLDOWN_MS));
    }
    const result = await timedShellFetch(profile.resourceCds);
    shellMsSamples.push(result.elapsedMs);
    lastDetail = result;
    console.log(
      `  run ${run}: shellMs=${result.elapsedMs.toFixed(0)} rows=${result.rowCount} total=${result.total} hasMoreSlots=${result.hasMoreCount}/${result.slotCount} completeInShell=${result.completeInShellCount}`
    );
  }

  const stats = summarize(shellMsSamples);
  console.log(
    `\n  shell summary: min=${stats.minMs.toFixed(0)}ms median=${stats.medianMs.toFixed(0)}ms avg=${stats.avgMs.toFixed(0)}ms max=${stats.maxMs.toFixed(0)}ms`
  );
  if (lastDetail?.completeInShellCount > 0) {
    console.log(
      `  note: ${lastDetail.completeInShellCount} slot(s) completed in shell (COUNT skip eligible on server)`
    );
  }

  return { profileKey, stats, lastDetail };
}

async function main() {
  const { profiles, runs } = parseArgs(process.argv);
  console.log(`Leaderboard board shell benchmark`);
  console.log(`BASE_URL=${BASE_URL}`);

  const results = [];
  for (const key of profiles) {
    const profile = PROFILES[key];
    if (!profile) {
      console.error(`Unknown profile: ${key}`);
      process.exit(1);
    }
    results.push(await runProfile(key, profile, runs));
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log('Done.');
  return results;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
