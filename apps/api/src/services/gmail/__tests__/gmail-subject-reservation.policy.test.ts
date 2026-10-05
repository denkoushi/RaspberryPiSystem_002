import { describe, expect, it } from 'vitest';

import { BackupConfigSchema, defaultBackupConfig } from '../../backup/backup-config.js';
import {
  ASSEMBLY_PROCEDURE_GMAIL_SUBJECT,
  assertCsvGmailSubjectPatternAllowed,
  canCsvSubjectPatternMatchReservedSubject,
  isItemInventoryGmailSubject,
  isProcedureMaterialGmailSubject,
  getProcedureMaterialSubjectHint,
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

  it.each(['AirGridFlexSignal', 'airgridflexsignal', 'FlexSignal'])(
    'rejects a CSV pattern that can match the machine signal subject: %s',
    (pattern) => {
      expect(() => assertCsvGmailSubjectPatternAllowed(pattern)).toThrowError(
        expect.objectContaining({
          statusCode: 400,
          code: 'GMAIL_SUBJECT_PATTERN_RESERVED',
          details: { pattern, reservedSubject: 'AirGridFlexSignal' },
          message: expect.stringContaining('設備稼働ログ専用'),
        })
      );
    }
  );

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

  it.each([
    '[ItemlistRaspi-photo]',
    '[ItemlistRaspi-photo] 2 snapshot',
    '  [ItemlistRaspi-photo]\t2 snapshot',
  ])('claims the canonical leading item-inventory token: %s', (subject) => {
    expect(isItemInventoryGmailSubject(subject)).toBe(true);
  });

  it.each([
    '[ItemlistRaspi-photo]-backup',
    'Re: [ItemlistRaspi-photo] 2 snapshot',
    'prefix [ItemlistRaspi-photo] 2 snapshot',
  ])('does not claim a colliding item-inventory subject: %s', (subject) => {
    expect(isItemInventoryGmailSubject(subject)).toBe(false);
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

describe('procedure-material subject reservation', () => {
  it.each([
    ['[Procedure-material]', null],
    [' [Procedure-material] DFD1 組立 ', 'DFD1 組立'],
    ['[Procedure-material]DFD2', 'DFD2'],
    ['[Procedure-material]\tヒント', 'ヒント'],
  ])('claims the leading token and saves the hint: %s', (subject, hint) => {
    expect(isProcedureMaterialGmailSubject(subject!)).toBe(true);
    expect(getProcedureMaterialSubjectHint(subject!)).toBe(hint);
    expect(isItemInventoryGmailSubject(subject!)).toBe(false);
    expect(isWorkInstructionGmailSubject(subject!)).toBe(false);
  });
  it.each(['Re: [Procedure-material]', 'prefix [Procedure-material]', '[Procedure-material-TEST]', '[procedure-material]', '[ItemlistRaspi-photo]', '[Kakou-Dandori-photo]', 'DocumentASM', 'AirGridFlexSignal'])('does not claim other mail: %s', (subject) => {
    expect(isProcedureMaterialGmailSubject(subject)).toBe(false);
    expect(getProcedureMaterialSubjectHint(subject)).toBeNull();
  });
  it.each(['[Procedure-material]', 'procedure-material', '/MATERIAL/'])('rejects CSV patterns claiming the material token: %s', (pattern) => {
    expect(() => assertCsvGmailSubjectPatternAllowed(pattern)).toThrowError(expect.objectContaining({ statusCode: 400, code: 'GMAIL_SUBJECT_PATTERN_RESERVED' }));
  });
});
