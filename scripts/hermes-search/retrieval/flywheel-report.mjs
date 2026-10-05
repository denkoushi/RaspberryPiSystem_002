#!/usr/bin/env node
// Night summary of the synthetic question flywheel, from copied questions-YYYY-MM-DD.jsonl files
// (hermes-synthetic-question-flywheel-execplan.md, Milestone 3). The files hold ids and grades
// only, so the report can be read anywhere.
// Usage: node retrieval/flywheel-report.mjs path/to/questions-2026-10-03.jsonl [more files]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareId } from './flywheel-pairs.mjs';

export function nightOfFile(filePath) {
  const match = /(?:questions|real)-(\d{4}-\d{2}-\d{2})\.jsonl$/u.exec(path.basename(filePath));
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

export function summarizeNight(rows, { labels = null } = {}) {
  const summary = {
    rows: rows.length,
    generated: 0,
    kept: 0,
    dropped: {},
    styles: {},
    medianLength: null,
    medianOverlap: null,
    live: { scored: 0, shown: 0, otherShown: 0, notInPool: 0, judgeRejected: 0, status: 0, failed: 0, notRun: 0, denseFallbacks: 0, labelled: 0 },
  };
  if (labels != null) summary.live.shownAfterLabels = 0;
  const lengths = [];
  const overlaps = [];
  for (const row of rows) {
    if (typeof row.question === 'string' && row.question) summary.generated += 1;
    if (row.kept !== true) {
      const key = row.reason ?? 'unknown';
      summary.dropped[key] = (summary.dropped[key] ?? 0) + 1;
      continue;
    }
    summary.kept += 1;
    lengths.push(row.question.length);
    if (typeof row.overlap === 'number') overlaps.push(row.overlap);
    const style = row.seed?.style ?? 'unknown';
    summary.styles[style] = (summary.styles[style] ?? 0) + 1;
    const live = row.live;
    if (!live || typeof live !== 'object') {
      summary.live.notRun += 1;
      continue;
    }
    summary.live.scored += 1;
    const shownAfterLabels = labels != null && live.loss === 'other_shown'
      && (live.shown ?? []).some((id) => labels[bareId(row.a)]?.[bareId(id)]?.g === 3);
    if (live.labelled === true) summary.live.labelled += 1;
    else if (shownAfterLabels) {
      summary.live.shownAfterLabels += 1;
      summary.live.labelled += 1;
    }
    if (live.vectorStatus === 'timeout' || live.vectorStatus === 'failed') summary.live.denseFallbacks += 1;
    if (live.loss == null || shownAfterLabels) summary.live.shown += 1;
    else if (live.loss === 'other_shown') summary.live.otherShown += 1;
    else if (live.loss === 'not_in_pool') summary.live.notInPool += 1;
    else if (live.loss === 'judge_rejected') summary.live.judgeRejected += 1;
    else if (live.loss === 'status') summary.live.status += 1;
    else summary.live.failed += 1;
  }
  lengths.sort((left, right) => left - right);
  summary.medianLength = lengths.length ? lengths[lengths.length >> 1] : null;
  overlaps.sort((left, right) => left - right);
  summary.medianOverlap = overlaps.length ? overlaps[overlaps.length >> 1] : null;
  return summary;
}

function counts(record) {
  return Object.entries(record).sort((left, right) => right[1] - left[1]).map(([key, value]) => `${key} ${value}`).join(', ');
}

export function summarizeReal(rows) {
  const summary = { questions: 0, withRelevant: 0, shown: 0, lossStages: {}, dayOutcomes: {} };
  for (const row of rows) {
    if (row?.source !== 'real') continue;
    summary.questions += 1;
    const outcome = row.dayOutcome;
    summary.dayOutcomes[outcome] = (summary.dayOutcomes[outcome] ?? 0) + 1;
    if (!row.relevant?.length) continue;
    summary.withRelevant += 1;
    if (row.live && row.live.loss == null) summary.shown += 1;
    else if (row.live?.loss != null) {
      const loss = row.live.loss;
      summary.lossStages[loss] = (summary.lossStages[loss] ?? 0) + 1;
    }
  }
  return summary;
}

export function formatRealReport(night, summary) {
  const losses = summary.lossStages;
  const nothing = (losses.not_in_pool ?? 0) + (losses.judge_rejected ?? 0) + (losses.status ?? 0);
  return `real ${night}: questions ${summary.questions}, with relevant ${summary.withRelevant}, relevant shown ${summary.shown}, nothing shown ${nothing}`
    + ` (outside judged candidates ${losses.not_in_pool ?? 0}, rejected by judge ${losses.judge_rejected ?? 0}, asked back or out of scope ${losses.status ?? 0})`
    + (losses.other_shown ? `, other records shown ${losses.other_shown}` : '')
    + (losses.failed ? `, failed ${losses.failed}` : '')
    + `, day outcomes ${Object.keys(summary.dayOutcomes).length ? counts(summary.dayOutcomes) : 'none'}`;
}

export function formatReport(night, summary) {
  const live = summary.live;
  const nothing = live.notInPool + live.judgeRejected + live.status;
  const lines = [
    `night ${night}: pairs ${summary.rows}, generated ${summary.generated}, kept ${summary.kept}` + (summary.medianLength == null ? '' : ` (median ${summary.medianLength} chars`
      + (summary.medianOverlap == null ? ')' : `, anchor overlap ${summary.medianOverlap.toFixed(2)})`)),
    `  dropped: ${Object.keys(summary.dropped).length ? counts(summary.dropped) : 'none'}`,
    `  styles: ${Object.keys(summary.styles).length ? counts(summary.styles) : 'none'}`,
  ];
  if (live.scored === 0) {
    lines.push(`  live: not run for ${live.notRun} kept questions`);
    return lines.join('\n');
  }
  lines.push(
    `  live (${live.scored} scored): relevant shown ${live.shown}`
      + (live.shownAfterLabels == null ? '' : `, labelled relevant ${live.labelled}`)
      + `, other records shown ${live.otherShown}, nothing shown ${nothing}`
      + ` (outside judged candidates ${live.notInPool}, rejected by judge ${live.judgeRejected}, asked back or out of scope ${live.status})`
      + (live.failed ? `, failed ${live.failed}` : '')
      + (live.notRun ? `, not run ${live.notRun}` : ''),
  );
  if (live.denseFallbacks) lines.push(`  dense fallbacks: ${live.denseFallbacks}`);
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const files = [];
  let labels = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--labels') {
      files.push(argv[index]);
      continue;
    }
    const file = argv[++index];
    if (!file || file.startsWith('--')) throw new Error('--labels needs a path');
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    labels = stored.schema === 'hermes-flywheel-labels/v1' ? stored.labels : stored;
  }
  if (!files.length) {
    console.error('usage: flywheel-report.mjs questions-YYYY-MM-DD.jsonl [more files] [--labels labels.json]');
    process.exitCode = 2;
    return;
  }
  for (const file of files) {
    const rows = readNightRows(readFileSync(file, 'utf8'));
    console.log(/^real-\d{4}-\d{2}-\d{2}\.jsonl$/u.test(path.basename(file))
      ? formatRealReport(nightOfFile(file), summarizeReal(rows))
      : formatReport(nightOfFile(file), summarizeNight(rows, { labels })));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
