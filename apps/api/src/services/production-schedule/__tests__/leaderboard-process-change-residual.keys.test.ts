import { describe, expect, it } from 'vitest';

import {
  buildProcessChangeResidualStrongEvidenceKey,
  buildProcessChangeResidualStrongEvidenceKeyArrays,
  buildProcessChangeResidualSqlTextKey,
  parseProcessChangeResidualStrongEvidenceKey
} from '../leaderboard/leaderboard-process-change-residual.keys.js';

describe('leaderboard-process-change-residual.keys', () => {
  it('buildProcessChangeResidualStrongEvidenceKey normalizes resource cd', () => {
    expect(
      buildProcessChangeResidualStrongEvidenceKey({
        productNo: 'P1',
        fkojun: '210',
        resourceCd: '035'
      })
    ).toBe('P1\u0000210\u0000035');
  });

  it('buildProcessChangeResidualStrongEvidenceKeyArrays preserves parallel arrays', () => {
    const keys = new Set([
      buildProcessChangeResidualStrongEvidenceKey({ productNo: 'A', fkojun: '210', resourceCd: '001' }),
      buildProcessChangeResidualStrongEvidenceKey({ productNo: 'B', fkojun: '310', resourceCd: '002' })
    ]);
    expect(buildProcessChangeResidualStrongEvidenceKeyArrays(keys)).toEqual({
      productNos: ['A', 'B'],
      fkojuns: ['210', '310'],
      resourceCds: ['001', '002']
    });
  });

  it('parseProcessChangeResidualStrongEvidenceKey rejects malformed keys', () => {
    expect(parseProcessChangeResidualStrongEvidenceKey('missing-parts')).toBeNull();
  });

  it('buildProcessChangeResidualSqlTextKey avoids NUL bytes and length-prefixes parts', () => {
    const key = buildProcessChangeResidualSqlTextKey({
      productNo: 'P|1',
      fkojun: '2:10',
      resourceCd: 'r1'
    });
    expect(key).toBe('3:P|1|4:2:10|2:R1');
    expect(key).not.toContain('\u0000');
  });
});
