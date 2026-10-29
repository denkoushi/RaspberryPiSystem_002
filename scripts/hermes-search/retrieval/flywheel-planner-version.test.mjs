import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { activePlannerQuestionVersion, comparePlannerVersions, plannerVersionPath, plannerVersionPathFromEnv, readPlannerVersion, writePlannerVersion, PLANNER_VERSION_SCHEMA } from './flywheel-planner-version.mjs';
import { DEFAULT_FLYWHEEL_DIR } from './flywheel-paths.mjs';
import { DEFAULT_PLANNER_QUESTION_VERSION as baseline, CANDIDATE_PLANNER_QUESTION_VERSION as candidate } from './planner-jev.mjs';

test('planner state tolerates missing and invalid files, round trips and caps checks', async () => {
  const file = plannerVersionPath(mkdtempSync(path.join(tmpdir(), 'planner-version-')));
  const empty = { active: null, candidate: null, checks: [] };
  const env = { HERMES_FLYWHEEL_PLANNER_VERSION_PATH: file };
  assert.equal(plannerVersionPathFromEnv({}), plannerVersionPath(DEFAULT_FLYWHEEL_DIR));
  assert.equal(plannerVersionPathFromEnv(env), file);
  assert.deepEqual(readPlannerVersion(file), empty);
  assert.equal(activePlannerQuestionVersion(env), baseline);
  for (const invalid of ['{', 'null', '{}', JSON.stringify({ schema: PLANNER_VERSION_SCHEMA, active: 42, candidate, checks: [] }), JSON.stringify({ schema: PLANNER_VERSION_SCHEMA, active: candidate, candidate, checks: null }), JSON.stringify({ schema: PLANNER_VERSION_SCHEMA, active: candidate, candidate, checks: [{ night: '2026-10-28' }] })]) {
    writeFileSync(file, invalid);
    assert.deepEqual(readPlannerVersion(file), empty);
    assert.equal(activePlannerQuestionVersion(env), baseline);
  }
  const state = { active: candidate, candidate: null, checks: Array.from({ length: 35 }, (_, night) => ({ night: String(night), decidedAt: '2026-10-28T00:00:00Z', active: baseline, candidate, compared: 0, affected: 0, dev: { n: 0, gained: 0, lost: 0 }, heldout: { n: 0, gained: 0, lost: 0 }, real: { n: 0, gained: 0, lost: 0 }, decision: 'report' })) };
  await writePlannerVersion(file, state);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).schema, PLANNER_VERSION_SCHEMA);
  assert.deepEqual(readPlannerVersion(file), { ...state, checks: state.checks.slice(-30) });
  assert.equal(activePlannerQuestionVersion(env), candidate);
  assert.equal(activePlannerQuestionVersion({ ...env, HERMES_FLYWHEEL_PLANNER_VERSION_ENABLED: 'false' }), baseline);
  await writePlannerVersion(file, { ...state, active: 'future-unknown' });
  assert.equal(activePlannerQuestionVersion(env), baseline);
});

test('planner comparison reuses anchor and real ids, labels and filter checks, and normalizes plans', () => {
  const plan = { filters: [{ source: 'nonconformity', field: 'department', op: 'in', values: ['A', 'B'] }, { source: 'nonconformity', field: 'date', op: 'between', values: ['2026-01-01', '2026-10-28'] }], semanticQuery: '配管不良', sort: { field: 'date', direction: 'desc' }, limit: 5 };
  const equivalent = { ...plan, filters: [{ ...plan.filters[1] }, { values: ['B', 'A'], op: 'in', field: 'department', source: 'nonconformity' }], sort: { direction: 'desc', field: 'date' }, diagnostics: { changed: true } };
  const questions = [
    { id: 'gain', split: 'dev', relevant: ['gain'], source: 'synthetic' },
    { id: 'real-lost', split: 'heldout', relevant: ['x'], source: 'real' },
    { id: 'same', split: 'dev', relevant: ['same'], source: 'synthetic' },
    { id: 'real-filter', split: 'heldout', kind: 'filter', relevant: [], source: 'real' },
  ];
  const row = (a, shown, extra = {}) => ({ a, live: { shown, plan }, ...extra });
  const baselineRows = [row('nonconformity:gain', []), row(null, ['x'], { source: 'real', id: 'real-lost' }), row('same', ['same']), row(null, [], { source: 'real', id: 'real-filter', filterCheck: { ok: true } })];
  const candidateRows = baselineRows.map((row) => structuredClone(row));
  candidateRows[0].live = { shown: ['labelled'], plan: { ...plan, semanticQuery: 'new' } };
  candidateRows[1].live = { shown: [], plan: { ...plan, limit: 10 } };
  candidateRows[2].live.plan = equivalent;
  const { comparison, affected } = comparePlannerVersions({ questions, baselineRows, candidateRows, labels: { gain: { labelled: { g: 3 } } } });
  assert.equal(affected, 2);
  assert.deepEqual([comparison.dev.n, comparison.dev.gained, comparison.dev.lost], [2, 1, 0]);
  assert.deepEqual([comparison.heldout.n, comparison.heldout.gained, comparison.heldout.lost], [2, 0, 1]);
  assert.deepEqual([comparison.real.n, comparison.real.gained, comparison.real.lost], [2, 0, 1]);
  assert.deepEqual(comparison.dev.gainedIds, ['gain']);
});
