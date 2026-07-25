import { describe, expect, it } from 'vitest';

import {
  ASSEMBLY_PROCEDURE_GMAIL_SUBJECT,
  assertCsvGmailSubjectPatternAllowed,
  canCsvSubjectPatternMatchReservedSubject,
} from '../gmail-subject-reservation.policy.js';

describe('gmail-subject-reservation.policy', () => {
  it.each([
    ASSEMBLY_PROCEDURE_GMAIL_SUBJECT,
    'documentasm',
    '  DocumentASM  ',
    'ASM',
    '/ASM/',
  ])('rejects a CSV pattern that can match the reserved subject: %s', (pattern) => {
    expect(canCsvSubjectPatternMatchReservedSubject(pattern)).toBe(true);
    expect(() => assertCsvGmailSubjectPatternAllowed(pattern)).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        code: 'GMAIL_SUBJECT_PATTERN_RESERVED',
      })
    );
  });

  it.each([
    '計測機器持出状況',
    '加工機日常点検結果',
    '生産日程_三島_研削工程',
    'CustomerSCAW',
    'FKOJUNST_Status',
    '部品納期個数',
    'FHINMEI_MH_SH',
    'FKOBAINO',
    'slingsInspectionRecord_PowerApps',
  ])('allows the currently deployed CSV subject: %s', (pattern) => {
    expect(canCsvSubjectPatternMatchReservedSubject(pattern)).toBe(false);
    expect(() => assertCsvGmailSubjectPatternAllowed(pattern)).not.toThrow();
  });
});
