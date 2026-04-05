import { describe, expect, it } from 'vitest';

import {
  classifyCandidateMatch,
  compareCandidates,
  isSelectableForSheetCreation,
  matchesSearchFilter,
  scheduleFhinmeiMatchesCandidate
} from './template-candidate-rules.js';

const CUTTING = 'CUTTING' as const;
const GRINDING = 'GRINDING' as const;

describe('templateCandidateRules', () => {
  it('THREE_KEY: exact_resource when 3 keys match', () => {
    expect(
      classifyCandidateMatch({
        scheduleFhincdNorm: 'ABC',
        scheduleProcessGroup: CUTTING,
        scheduleResourceCdNorm: '587',
        scheduleFhinmei: '品X',
        templateScope: 'THREE_KEY',
        templateFhincdNorm: 'ABC',
        templateProcessGroup: CUTTING,
        templateResourceCdNorm: '587',
        candidateFhinmei: null
      })
    ).toBe('exact_resource');
  });

  it('THREE_KEY: two_key when fhincd+resource match but process differs', () => {
    expect(
      classifyCandidateMatch({
        scheduleFhincdNorm: 'ABC',
        scheduleProcessGroup: GRINDING,
        scheduleResourceCdNorm: '587',
        templateScope: 'THREE_KEY',
        templateFhincdNorm: 'ABC',
        templateProcessGroup: CUTTING,
        templateResourceCdNorm: '587',
        candidateFhinmei: null
      })
    ).toBe('two_key_fhincd_resource');
  });

  it('THREE_KEY: null when resource differs', () => {
    expect(
      classifyCandidateMatch({
        scheduleFhincdNorm: 'ABC',
        scheduleProcessGroup: CUTTING,
        scheduleResourceCdNorm: '587',
        templateScope: 'THREE_KEY',
        templateFhincdNorm: 'ABC',
        templateProcessGroup: CUTTING,
        templateResourceCdNorm: '305',
        candidateFhinmei: null
      })
    ).toBeNull();
  });

  it('THREE_KEY: null when fhincd differs', () => {
    expect(
      classifyCandidateMatch({
        scheduleFhincdNorm: 'AAA',
        scheduleProcessGroup: CUTTING,
        scheduleResourceCdNorm: '587',
        templateScope: 'THREE_KEY',
        templateFhincdNorm: 'BBB',
        templateProcessGroup: CUTTING,
        templateResourceCdNorm: '587',
        candidateFhinmei: null
      })
    ).toBeNull();
  });

  it('FHINCD_RESOURCE: two_key when fhincd+resource match', () => {
    expect(
      classifyCandidateMatch({
        scheduleFhincdNorm: 'ABC',
        scheduleProcessGroup: GRINDING,
        scheduleResourceCdNorm: '587',
        templateScope: 'FHINCD_RESOURCE',
        templateFhincdNorm: 'ABC',
        templateProcessGroup: 'CANDIDATE_FHINCD_RESOURCE',
        templateResourceCdNorm: '587',
        candidateFhinmei: null
      })
    ).toBe('two_key_fhincd_resource');
  });

  it('FHINMEI_ONLY: one_key when schedule contains candidate key', () => {
    expect(
      classifyCandidateMatch({
        scheduleFhincdNorm: 'ABC',
        scheduleProcessGroup: CUTTING,
        scheduleResourceCdNorm: '587',
        scheduleFhinmei: '  シャフト本体 ',
        templateScope: 'FHINMEI_ONLY',
        templateFhincdNorm: '__X__',
        templateProcessGroup: 'CANDIDATE_FHINMEI_ONLY',
        templateResourceCdNorm: 'uuid',
        candidateFhinmei: 'シャフト本体'
      })
    ).toBe('one_key_fhinmei');
    expect(
      classifyCandidateMatch({
        scheduleFhincdNorm: 'ABC',
        scheduleProcessGroup: CUTTING,
        scheduleResourceCdNorm: '587',
        scheduleFhinmei: 'シャフト特殊品 早川',
        templateScope: 'FHINMEI_ONLY',
        templateFhincdNorm: '__X__',
        templateProcessGroup: 'CANDIDATE_FHINMEI_ONLY',
        templateResourceCdNorm: 'uuid',
        candidateFhinmei: 'シャフト'
      })
    ).toBe('one_key_fhinmei');
  });

  it('scheduleFhinmeiMatchesCandidate: substring after normalize, min length 2', () => {
    expect(scheduleFhinmeiMatchesCandidate('シャフト', 'シャフト特殊品')).toBe(true);
    expect(scheduleFhinmeiMatchesCandidate('  シャフト  ', '早川 シャフト特殊品')).toBe(true);
    expect(scheduleFhinmeiMatchesCandidate('AB', 'xxabYY')).toBe(true);
    expect(scheduleFhinmeiMatchesCandidate('シャフト本体', '  シャフト本体 ')).toBe(true);
    expect(scheduleFhinmeiMatchesCandidate('別物', 'シャフト特殊品')).toBe(false);
    expect(scheduleFhinmeiMatchesCandidate('板', 'シャフト特殊品')).toBe(false);
    expect(scheduleFhinmeiMatchesCandidate(' A ', 'a')).toBe(false);
    expect(scheduleFhinmeiMatchesCandidate('ab', 'a')).toBe(false);
    expect(scheduleFhinmeiMatchesCandidate('x', 'y')).toBe(false);
    expect(scheduleFhinmeiMatchesCandidate('', 'y')).toBe(false);
  });

  it('all match kinds are selectable', () => {
    expect(isSelectableForSheetCreation('exact_resource')).toBe(true);
    expect(isSelectableForSheetCreation('two_key_fhincd_resource')).toBe(true);
    expect(isSelectableForSheetCreation('one_key_fhinmei')).toBe(true);
  });

  it('compareCandidates orders by kind then version then updatedAt', () => {
    const t0 = { updatedAtMs: 0 };
    const a = { matchKind: 'two_key_fhincd_resource' as const, version: 99, ...t0 };
    const b = { matchKind: 'exact_resource' as const, version: 1, ...t0 };
    const c = { matchKind: 'exact_resource' as const, version: 2, ...t0 };
    const d = { matchKind: 'exact_resource' as const, version: 2, updatedAtMs: 100 };
    const e = { matchKind: 'exact_resource' as const, version: 2, updatedAtMs: 50 };
    expect(compareCandidates(b, a)).toBeLessThan(0);
    expect(compareCandidates(c, b)).toBeLessThan(0);
    expect(compareCandidates(d, e)).toBeLessThan(0);
  });

  it('compareCandidates: one_key_fhinmei tiebreak by longer normalized candidate key', () => {
    const t0 = { updatedAtMs: 0, version: 1 };
    const longer = {
      matchKind: 'one_key_fhinmei' as const,
      fhinmeiNormalizedLen: 10,
      ...t0
    };
    const shorter = {
      matchKind: 'one_key_fhinmei' as const,
      fhinmeiNormalizedLen: 3,
      ...t0
    };
    expect(compareCandidates(longer, shorter)).toBeLessThan(0);
    expect(compareCandidates(shorter, longer)).toBeGreaterThan(0);
  });

  it('matchesSearchFilter includes candidateFhinmei', () => {
    const t = { fhincd: 'MD001', name: '表測定', candidateFhinmei: 'シャフトA型' };
    expect(matchesSearchFilter('シャフト', t)).toBe(true);
    expect(matchesSearchFilter('zzz', t)).toBe(false);
  });
});
