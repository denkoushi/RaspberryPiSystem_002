import { describe, expect, it } from 'vitest';

import { BackupConfigSchema, defaultBackupConfig } from '../../backup/backup-config.js';
import {
  ASSEMBLY_PROCEDURE_GMAIL_SUBJECT,
  assertCsvGmailSubjectPatternAllowed,
  canCsvSubjectPatternMatchReservedSubject,
  isWorkInstructionGmailSubject,
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

  it.each([
    '[Kakou-Dandori-photo]',
    '[Kakou-Dandori-photo] ID645',
    '[Kakou-Dandori-photo] ID700',
    '  [Kakou-Dandori-photo]\titem-645 snapshot',
  ])('claims the canonical leading work-instruction token: %s', (subject) => {
    expect(isWorkInstructionGmailSubject(subject)).toBe(true);
  });

  it.each([
    '[WORK-INSTRUCTION] 640 snapshot',
    '[WORK-INSTRUCTION-TEST] 640 snapshot',
    '[Kakou-Dandori-photo]-TEST 640 snapshot',
    'Re: [Kakou-Dandori-photo] ID645 snapshot',
    'prefix [Kakou-Dandori-photo] ID645 snapshot',
  ])('does not claim a colliding or non-leading subject: %s', (subject) => {
    expect(isWorkInstructionGmailSubject(subject)).toBe(false);
  });

  it('uses only the canonical token in work-instruction configuration defaults', () => {
    expect(defaultBackupConfig.workInstructionGmailIngest?.subjectTokens).toEqual([
      '[Kakou-Dandori-photo]',
    ]);
    expect(BackupConfigSchema.parse({
      storage: { provider: 'local' },
      targets: [],
    }).workInstructionGmailIngest?.subjectTokens).toEqual([
      '[Kakou-Dandori-photo]',
    ]);
    expect(() => BackupConfigSchema.parse({
      storage: { provider: 'local' },
      targets: [],
      workInstructionGmailIngest: {
        subjectTokens: ['[WORK-INSTRUCTION]'],
      },
    })).toThrow();
  });
});
