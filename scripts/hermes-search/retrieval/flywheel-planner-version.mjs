import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_FLYWHEEL_DIR } from './flywheel-paths.mjs';
import { DEFAULT_PLANNER_QUESTION_VERSION, PLANNER_QUESTION_VERSIONS } from './planner-jev.mjs';
import { compareRuns } from './flywheel-gate.mjs';
import { bareId } from './flywheel-pairs.mjs';

export const PLANNER_VERSION_SCHEMA = 'hermes-flywheel-planner-version/v1';

export function plannerVersionPath(dir) {
  return path.join(dir, 'planner-version.json');
}

export function plannerVersionPathFromEnv(env = process.env) {
  return env.HERMES_FLYWHEEL_PLANNER_VERSION_PATH || plannerVersionPath(DEFAULT_FLYWHEEL_DIR);
}

function validCheck(check) {
  return check && typeof check.night === 'string' && typeof check.decidedAt === 'string'
    && typeof check.active === 'string' && typeof check.candidate === 'string' && check.decision === 'report'
    && [check.compared, check.affected].every((n) => Number.isInteger(n) && n >= 0)
    && ['dev', 'heldout', 'real'].every((split) => ['n', 'gained', 'lost'].every((key) =>
      Number.isInteger(check[split]?.[key]) && check[split][key] >= 0));
}

export function readPlannerVersion(file) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    if (state?.schema === PLANNER_VERSION_SCHEMA
      && (state.active === null || typeof state.active === 'string')
      && (state.candidate === null || typeof state.candidate === 'string')
      && Array.isArray(state.checks) && state.checks.every(validCheck)) {
      return { active: state.active, candidate: state.candidate, checks: state.checks.slice(-30) };
    }
  } catch { /* A missing or invalid file keeps the code default. */ }
  return { active: null, candidate: null, checks: [] };
}

export async function writePlannerVersion(file, state) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schema: PLANNER_VERSION_SCHEMA,
    active: state.active ?? null, candidate: state.candidate ?? null, checks: state.checks.slice(-30) })}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export function activePlannerQuestionVersion(env = process.env) {
  if (env.HERMES_FLYWHEEL_PLANNER_VERSION_ENABLED === 'false') return DEFAULT_PLANNER_QUESTION_VERSION;
  const { active } = readPlannerVersion(plannerVersionPathFromEnv(env));
  return PLANNER_QUESTION_VERSIONS.includes(active) ? active : DEFAULT_PLANNER_QUESTION_VERSION;
}

function rowId(row) {
  return ['real', 'regression'].includes(row.source) || row.kind === 'filter' ? row.id : bareId(row.a);
}

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
  }
  return value;
}

function planKey(plan) {
  const filters = (plan?.filters ?? []).map((filter) => normalized({ ...filter,
    values: ['eq', 'in'].includes(filter.op) ? [...(filter.values ?? [])].sort() : filter.values,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify(normalized({ filters, semanticQuery: plan?.semanticQuery ?? '',
    sort: plan?.sort ?? null, limit: plan?.limit ?? null }));
}

export function comparePlannerVersions({ questions, baselineRows, candidateRows, labels }) {
  const cases = (rows) => rows.map((row) => ({ id: rowId(row), shown: row.live.shown, filterCheck: row.filterCheck, followUpCheck: row.followUpCheck }));
  const baseline = new Map(baselineRows.map((row) => [rowId(row), row]));
  const candidate = new Map(candidateRows.map((row) => [rowId(row), row]));
  let affected = 0;
  for (const [id, row] of baseline) {
    if (candidate.has(id) && planKey(row.live.plan) !== planKey(candidate.get(id).live.plan)) affected += 1;
  }
  return { comparison: compareRuns({ questions, baseline: { cases: cases(baselineRows) }, candidate: { cases: cases(candidateRows) }, labels }), affected };
}
