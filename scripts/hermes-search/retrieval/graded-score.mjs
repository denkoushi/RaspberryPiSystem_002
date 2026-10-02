#!/usr/bin/env node
// Scores evaluated runs against graded relevance labels (graded-labels.mjs). For each run it
// reports what was shown and, for content questions that showed nothing, which stage lost the
// answer. Prints counts and case ids only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEVANCE_CANDIDATE_LIMIT } from './relevance-jev.mjs';
import { caseKey, loadSets, parseSetArg, runCaseIds } from './graded-labels.mjs';

export const RELEVANT_GRADE = 3;

/** Why a case with expect=answer showed no record. */
export const LOSS = {
  status: 'answered in another form (clarification or out of scope)',
  noRelevantLabelled: 'no relevant record among the labelled candidates',
  notInPool: 'relevant records exist but none reached the judged candidates',
  judgeRejected: 'a relevant record reached the judge and was not accepted',
  unknown: 'no candidate list; run evaluate.mjs with --stage-dump',
};

function isRelevant(labels, id) {
  return labels?.[id]?.g === RELEVANT_GRADE;
}

/**
 * One case. `judged` is how many ranked candidates the relevance judge read in that run.
 * A run without --stage-dump has no candidate list, so the stage of a loss stays unknown.
 */
export function scoreCase({ item, runCase, labels, judged = RELEVANCE_CANDIDATE_LIMIT }) {
  const { candidates, shown } = runCaseIds(runCase);
  const grades = { relevant: 0, similar: 0, lower: 0, unjudged: 0 };
  for (const id of shown) {
    const grade = labels?.[id]?.g;
    if (grade == null) grades.unjudged += 1;
    else if (grade === RELEVANT_GRADE) grades.relevant += 1;
    else if (grade === 2) grades.similar += 1;
    else grades.lower += 1;
  }
  const relevantLabelled = Object.values(labels ?? {}).filter((label) => label?.g === RELEVANT_GRADE).length;
  const relevantRanks = candidates.map((id, index) => (isRelevant(labels, id) ? index + 1 : null)).filter(Boolean);
  const scored = {
    id: item.id,
    status: runCase?.status ?? null,
    shown: shown.length,
    grades,
    relevantShown: grades.relevant > 0,
    relevantLabelled,
    firstRelevantRank: relevantRanks[0] ?? null,
    loss: null,
  };
  if (item.expect === 'answer' && shown.length === 0) {
    if (scored.status && scored.status !== 'no_result' && scored.status !== 'answer') scored.loss = 'status';
    else if (relevantLabelled === 0) scored.loss = 'noRelevantLabelled';
    else if (!Array.isArray(runCase?.candidateIds)) scored.loss = 'unknown';
    else if (!relevantRanks.some((rank) => rank <= judged)) scored.loss = 'notInPool';
    else scored.loss = 'judgeRejected';
  }
  return scored;
}

/** Only cases that expect an answer are scored; filters and out-of-scope cases have their own scores. */
export function scoreGradedRun({ setName, gold, run, labels, judged = RELEVANCE_CANDIDATE_LIMIT }) {
  const cases = [];
  for (const item of gold) {
    if (item.expect !== 'answer') continue;
    const runCase = (run.cases ?? []).find((entry) => entry.id === item.id);
    if (!runCase) continue;
    cases.push(scoreCase({ item, runCase, labels: labels[caseKey(setName, item.id)] ?? {}, judged }));
  }
  const answered = cases.filter((entry) => entry.shown > 0);
  const sum = (key) => cases.reduce((total, entry) => total + entry.grades[key], 0);
  const losses = {};
  for (const entry of cases) {
    if (entry.loss) (losses[entry.loss] ??= []).push(entry.id);
  }
  const within = (limit) => cases.filter((entry) => entry.firstRelevantRank != null && entry.firstRelevantRank <= limit).length;
  return {
    summary: {
      cases: cases.length,
      answered: answered.length,
      relevantShown: cases.filter((entry) => entry.relevantShown).length,
      nothingShown: cases.length - answered.length,
      shownGrades: { relevant: sum('relevant'), similar: sum('similar'), lower: sum('lower'), unjudged: sum('unjudged') },
      relevantInCandidates: { top15: within(15), top30: within(30), top50: within(50) },
      losses,
    },
    cases,
  };
}

export function formatGradedTable(label, summary) {
  const grades = summary.shownGrades;
  const lines = [
    `run=${label}`,
    `cases ${summary.cases} | answered ${summary.answered} | a relevant record shown ${summary.relevantShown} | nothing shown ${summary.nothingShown}`,
    `shown records: relevant ${grades.relevant} / similar ${grades.similar} / lower ${grades.lower} / unjudged ${grades.unjudged}`,
    `relevant record among candidates: top 15 ${summary.relevantInCandidates.top15} / top 30 ${summary.relevantInCandidates.top30} / top 50 ${summary.relevantInCandidates.top50}`,
  ];
  for (const [kind, ids] of Object.entries(summary.losses)) lines.push(`lost (${LOSS[kind]}): ${ids.length} [${ids.join(', ')}]`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const parsed = { sets: [], labels: null, judged: RELEVANCE_CANDIDATE_LIMIT, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--set') parsed.sets.push(parseSetArg(argv[++index]));
    else if (arg === '--labels') parsed.labels = argv[++index];
    else if (arg === '--judged') parsed.judged = Number(argv[++index]);
    else if (arg === '--out') parsed.out = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!parsed.sets.length || !parsed.labels || !Number.isInteger(parsed.judged) || parsed.judged < 1) {
    throw new Error('Usage: node retrieval/graded-score.mjs --set <name:gold:run[,run]> [--set ...] --labels <labels.json> [--judged 15] [--out <file>]');
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const labels = JSON.parse(fs.readFileSync(args.labels, 'utf8'));
  const specs = args.sets;
  const sets = loadSets(specs);
  const report = [];
  sets.forEach((set, setIndex) => {
    set.runs.forEach((run, runIndex) => {
      const label = `${set.name}:${path.basename(specs[setIndex].runs[runIndex])}`;
      const scored = scoreGradedRun({ setName: set.name, gold: set.gold, run, labels, judged: args.judged });
      report.push({ run: label, ...scored });
      process.stdout.write(`${formatGradedTable(label, scored.summary)}\n\n`);
    });
  });
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true, mode: 0o700 });
    fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error?.message ?? error);
    process.exit(1);
  }
}
