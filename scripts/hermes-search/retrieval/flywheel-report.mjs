#!/usr/bin/env node
// Night summary of the synthetic question flywheel, from copied questions-YYYY-MM-DD.jsonl files
// (hermes-synthetic-question-flywheel-execplan.md, Milestone 3). The files hold ids and grades
// only, so the report can be read anywhere.
// Usage: node retrieval/flywheel-report.mjs path/to/questions-2026-10-03.jsonl [more files]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function nightOfFile(filePath) {
  const match = /questions-(\d{4}-\d{2}-\d{2})\.jsonl$/u.exec(path.basename(filePath));
  return match ? match[1] : path.basename(filePath);
}

export function readNightRows(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A torn line is skipped.
    }
  }
  return rows;
}

export function summarizeNight(rows) {
  const summary = {
    rows: rows.length,
    generated: 0,
    kept: 0,
    dropped: {},
    styles: {},
    medianLength: null,
    live: { scored: 0, shown: 0, otherShown: 0, notInPool: 0, judgeRejected: 0, status: 0, failed: 0, notRun: 0, denseFallbacks: 0 },
  };
  const lengths = [];
  for (const row of rows) {
    if (typeof row.question === 'string' && row.question) summary.generated += 1;
    if (row.kept !== true) {
      const key = row.reason ?? 'unknown';
      summary.dropped[key] = (summary.dropped[key] ?? 0) + 1;
      continue;
    }
    summary.kept += 1;
    lengths.push(row.question.length);
    const style = row.seed?.style ?? 'unknown';
    summary.styles[style] = (summary.styles[style] ?? 0) + 1;
    const live = row.live;
    if (!live || typeof live !== 'object') {
      summary.live.notRun += 1;
      continue;
    }
    summary.live.scored += 1;
    if (live.vectorStatus === 'timeout' || live.vectorStatus === 'failed') summary.live.denseFallbacks += 1;
    if (live.loss == null) summary.live.shown += 1;
    else if (live.loss === 'other_shown') summary.live.otherShown += 1;
    else if (live.loss === 'not_in_pool') summary.live.notInPool += 1;
    else if (live.loss === 'judge_rejected') summary.live.judgeRejected += 1;
    else if (live.loss === 'status') summary.live.status += 1;
    else summary.live.failed += 1;
  }
  lengths.sort((left, right) => left - right);
  summary.medianLength = lengths.length ? lengths[lengths.length >> 1] : null;
  return summary;
}

function counts(record) {
  return Object.entries(record).sort((left, right) => right[1] - left[1]).map(([key, value]) => `${key} ${value}`).join(', ');
}

export function formatReport(night, summary) {
  const live = summary.live;
  const nothing = live.notInPool + live.judgeRejected + live.status;
  const lines = [
    `night ${night}: pairs ${summary.rows}, generated ${summary.generated}, kept ${summary.kept}` + (summary.medianLength == null ? '' : ` (median ${summary.medianLength} chars)`),
    `  dropped: ${Object.keys(summary.dropped).length ? counts(summary.dropped) : 'none'}`,
    `  styles: ${Object.keys(summary.styles).length ? counts(summary.styles) : 'none'}`,
  ];
  if (live.scored === 0) {
    lines.push(`  live: not run for ${live.notRun} kept questions`);
    return lines.join('\n');
  }
  lines.push(
    `  live (${live.scored} scored): relevant shown ${live.shown}, other records shown ${live.otherShown}, nothing shown ${nothing}`
      + ` (outside judged candidates ${live.notInPool}, rejected by judge ${live.judgeRejected}, asked back or out of scope ${live.status})`
      + (live.failed ? `, failed ${live.failed}` : '')
      + (live.notRun ? `, not run ${live.notRun}` : ''),
  );
  if (live.denseFallbacks) lines.push(`  dense fallbacks: ${live.denseFallbacks}`);
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  if (!argv.length) {
    console.error('usage: flywheel-report.mjs questions-YYYY-MM-DD.jsonl [more files]');
    process.exitCode = 2;
    return;
  }
  for (const file of argv) {
    const rows = readNightRows(readFileSync(file, 'utf8'));
    console.log(formatReport(nightOfFile(file), summarizeNight(rows)));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
