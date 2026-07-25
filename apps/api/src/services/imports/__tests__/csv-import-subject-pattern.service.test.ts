import { beforeEach, describe, expect, it, vi } from 'vitest';

const subjectPatternMock = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    csvImportSubjectPattern: subjectPatternMock,
  },
}));

import { CsvImportSubjectPatternService } from '../csv-import-subject-pattern.service.js';

describe('CsvImportSubjectPatternService reserved Gmail subject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a conflicting pattern before create', async () => {
    const service = new CsvImportSubjectPatternService();

    await expect(
      service.create({ importType: 'employees', pattern: 'ASM' })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'GMAIL_SUBJECT_PATTERN_RESERVED',
    });
    expect(subjectPatternMock.create).not.toHaveBeenCalled();
  });

  it('rejects a conflicting pattern before update', async () => {
    subjectPatternMock.findUnique.mockResolvedValueOnce({
      id: 'pattern-1',
      importType: 'employees',
      pattern: 'employees',
    });
    const service = new CsvImportSubjectPatternService();

    await expect(
      service.update('pattern-1', { pattern: ' documentasm ' })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'GMAIL_SUBJECT_PATTERN_RESERVED',
    });
    expect(subjectPatternMock.update).not.toHaveBeenCalled();
  });

  it('rejects another-field update when the stored pattern conflicts', async () => {
    subjectPatternMock.findUnique.mockResolvedValueOnce({
      id: 'pattern-legacy',
      importType: 'employees',
      pattern: 'ASM',
    });
    const service = new CsvImportSubjectPatternService();

    await expect(
      service.update('pattern-legacy', { priority: 10 })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'GMAIL_SUBJECT_PATTERN_RESERVED',
    });
    expect(subjectPatternMock.update).not.toHaveBeenCalled();
  });

  it('keeps non-conflicting create behavior unchanged', async () => {
    subjectPatternMock.create.mockResolvedValueOnce({ id: 'pattern-2', pattern: 'FKOBAINO' });
    const service = new CsvImportSubjectPatternService();

    await expect(
      service.create({ importType: 'employees', pattern: 'FKOBAINO' })
    ).resolves.toMatchObject({ pattern: 'FKOBAINO' });
    expect(subjectPatternMock.create).toHaveBeenCalledOnce();
  });
});
