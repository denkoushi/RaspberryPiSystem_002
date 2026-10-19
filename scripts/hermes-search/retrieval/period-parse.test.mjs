import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePeriods } from './period-parse.mjs';

const NOW = '2026-09-24';

const CASES = [
  ['2024年', { from: '2024-01-01', to: '2024-12-31' }],
  ['２０２４年', { from: '2024-01-01', to: '2024-12-31' }],
  ['令和6年', { from: '2024-01-01', to: '2024-12-31' }],
  ['令和６年', { from: '2024-01-01', to: '2024-12-31' }],
  ['令和元年', { from: '2019-01-01', to: '2019-12-31' }],
  ['平成31年', { from: '2019-01-01', to: '2019-12-31' }],
  ['昭和64年', { from: '1989-01-01', to: '1989-12-31' }],
  ['今年', { from: '2026-01-01', to: '2026-12-31' }],
  ['本年', { from: '2026-01-01', to: '2026-12-31' }],
  ['去年', { from: '2025-01-01', to: '2025-12-31' }],
  ['昨年', { from: '2025-01-01', to: '2025-12-31' }],
  ['一昨年', { from: '2024-01-01', to: '2024-12-31' }],
  ['来年', { from: '2027-01-01', to: '2027-12-31' }],
  ['2024年度', { from: '2024-04-01', to: '2025-03-31' }],
  ['令和6年度', { from: '2024-04-01', to: '2025-03-31' }],
  ['今年度', { from: '2026-04-01', to: '2027-03-31' }],
  ['本年度', { from: '2026-04-01', to: '2027-03-31' }],
  ['昨年度', { from: '2025-04-01', to: '2026-03-31' }],
  ['前年度', { from: '2025-04-01', to: '2026-03-31' }],
  ['来年度', { from: '2027-04-01', to: '2028-03-31' }],
  ['2026年9月', { from: '2026-09-01', to: '2026-09-30' }],
  ['2026年09月', { from: '2026-09-01', to: '2026-09-30' }],
  ['2024年2月', { from: '2024-02-01', to: '2024-02-29' }],
  ['2024年9月1日', { from: '2024-09-01', to: '2024-09-01' }],
  ['2024-09-01', { from: '2024-09-01', to: '2024-09-01' }],
  ['2024/9/1', { from: '2024-09-01', to: '2024-09-01' }],
  ['9月', { from: '2026-09-01', to: '2026-09-30' }],
  ['今月', { from: '2026-09-01', to: '2026-09-30' }],
  ['来月', { from: '2026-10-01', to: '2026-10-31' }],
  ['先月', { from: '2026-08-01', to: '2026-08-31' }],
  ['先々月', { from: '2026-07-01', to: '2026-07-31' }],
  ['去年の9月', { from: '2025-09-01', to: '2025-09-30' }],
  ['今年の3月', { from: '2026-03-01', to: '2026-03-31' }],
  ['直近3か月', { from: '2026-06-24', to: '2026-09-24' }],
  ['直近3ヶ月', { from: '2026-06-24', to: '2026-09-24' }],
  ['直近三か月', { from: '2026-06-24', to: '2026-09-24' }],
  ['過去1年', { from: '2025-09-24', to: '2026-09-24' }],
  ['過去30日', { from: '2026-08-25', to: '2026-09-24' }],
  ['直近1週間', { from: '2026-09-17', to: '2026-09-24' }],
  ['9月以降', { from: '2026-09-01', to: null }],
  ['2024年9月以降', { from: '2024-09-01', to: null }],
  ['9月以前', { from: null, to: '2026-09-30' }],
  ['2024年まで', { from: null, to: '2024-12-31' }],
  ['2024年9月まで', { from: null, to: '2024-09-30' }],
  ['2024年1月から2024年3月', { from: '2024-01-01', to: '2024-03-31' }],
  ['2024年1月〜3月', { from: '2024-01-01', to: '2024-03-31' }],
  ['1月から3月', { from: '2026-01-01', to: '2026-03-31' }],
];

test('deterministic period parser covers years, fiscal years, relative months, ranges, and edges', () => {
  assert.ok(CASES.length >= 40);
  for (const [text, expected] of CASES) {
    const matches = parsePeriods(text, NOW);
    assert.equal(matches.length, 1, text);
    assert.equal(matches[0].interpretations.length, 1, text);
    const { from, to } = matches[0].interpretations[0];
    assert.deepEqual({ from, to }, expected, text);
  }
});

test('a future bare month stays ambiguous and January wraps 先月', () => {
  const future = parsePeriods('12月', NOW);
  assert.equal(future[0].interpretations.length, 2);
  assert.deepEqual(future[0].interpretations.map((item) => item.from), ['2026-12-01', '2025-12-01']);
  const wrapped = parsePeriods('先月', '2026-01-15');
  assert.deepEqual(wrapped[0].interpretations[0], {
    from: '2025-12-01',
    to: '2025-12-31',
    label: '2025-12-01..2025-12-31',
  });
});
