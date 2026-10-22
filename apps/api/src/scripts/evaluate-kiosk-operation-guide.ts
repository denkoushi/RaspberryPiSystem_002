// Measures how often the kiosk operation guide lookup used by the Chat answers a gold question
// with the right document. Run from apps/api:
//   pnpm exec tsx src/scripts/evaluate-kiosk-operation-guide.ts --gold ../../scripts/hermes-search/operation-guide/gold/operation-guide-v1.json \
//     [--guide-dir ../../docs/kiosk-operation-guide] [--master <names.json>] [--out <run.json>] [--baseline <run.json>]
// A wrong document counts worse than no answer: the Chat shows a wrong screen's steps as fact,
// while no answer sends the question to お問い合わせ.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isOperationHowToQuestion, KioskOperationGuideIndex } from '../services/assembly/kiosk-operation-guide.service.js';
import { masterNamesSubjectResolver, type MasterNames } from '../services/assembly/kiosk-operation-guide-subject.js';

type GoldCase = { id: string; question: string; expect: string | string[] | null; kind: string; previousScreen?: string };
type Outcome = 'hit' | 'correct_null' | 'miss' | 'wrong' | 'false_answer';
type CaseResult = GoldCase & { got: string | null; outcome: Outcome };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function outcome(expect: GoldCase['expect'], got: string | null): Outcome {
  if (expect === null) return got === null ? 'correct_null' : 'false_answer';
  if (got === null) return 'miss';
  return (Array.isArray(expect) ? expect : [expect]).includes(got) ? 'hit' : 'wrong';
}

const goldPath = arg('gold');
if (!goldPath) throw new Error('--gold <file> is required');
const guideDir = path.resolve(arg('guide-dir') ?? path.join(process.cwd(), '../../docs/kiosk-operation-guide'));
const gold = JSON.parse(readFileSync(goldPath, 'utf8')) as { version: string; cases: GoldCase[] };
const index = KioskOperationGuideIndex.fromDirectory(guideDir);
const masterPath = arg('master');
const resolver = masterPath ? masterNamesSubjectResolver(JSON.parse(readFileSync(masterPath, 'utf8')) as MasterNames) : null;

const results: CaseResult[] = gold.cases.map((item) => {
  const inherited = item.previousScreen === undefined ? [] : index.familiesForScreen(item.previousScreen);
  const within = index.familyMatchStrength(item.question, inherited);
  const eligible = item.previousScreen === undefined || within !== 'none'
    || (isOperationHowToQuestion(item.question) && index.matchStrength(item.question) === 'screen');
  const families = eligible
    ? [...new Set([...inherited, ...(resolver ? resolver(index.unknownTerms(item.question)) : [])])]
    : [];
  const got = eligible ? index.bestSection(item.question, { families })?.file ?? null : null;
  return { ...item, got, outcome: outcome(item.expect, got) };
});
const count = (name: Outcome) => results.filter((row) => row.outcome === name).length;
const summary = {
  gold: gold.version, guideDir, master: masterPath ?? null, cases: results.length,
  correct: count('hit') + count('correct_null'), hit: count('hit'), correct_null: count('correct_null'),
  miss: count('miss'), wrong: count('wrong'), false_answer: count('false_answer'),
  accuracy: Number(((count('hit') + count('correct_null')) / results.length).toFixed(3)),
  wrong_rate: Number(((count('wrong') + count('false_answer')) / results.length).toFixed(3))
};
console.log(JSON.stringify(summary));
for (const row of results.filter((item) => item.outcome !== 'hit' && item.outcome !== 'correct_null')) {
  console.log(`${row.outcome.padEnd(12)} ${row.id} ${row.question} | expect ${JSON.stringify(row.expect)} | got ${row.got}`);
}
const baselinePath = arg('baseline');
if (baselinePath) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as { results: CaseResult[] };
  const before = new Map(baseline.results.map((row) => [row.id, row.outcome]));
  const changed = results.filter((row) => before.get(row.id) !== row.outcome);
  console.log(`changed vs baseline: ${changed.length}`);
  for (const row of changed) console.log(`  ${row.id} ${row.question}: ${before.get(row.id) ?? 'n/a'} -> ${row.outcome}`);
}
const outPath = arg('out');
if (outPath) writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
