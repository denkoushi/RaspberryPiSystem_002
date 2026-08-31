import { ImportStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const importJob = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { importJob },
}));

import { prismaImportJobStore } from '../work-instruction-import-job.store.js';

const createdJob = {
  id: 'job-1',
  type: 'WORK_INSTRUCTION_GMAIL',
  status: 'PENDING' as const,
  summary: { discovered: 2 },
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  completedAt: null,
};

describe('prismaImportJobStore', () => {
  beforeEach(() => {
    importJob.create.mockReset();
    importJob.update.mockReset();
    importJob.findFirst.mockReset();
  });

  it('creates a job with the requested status and JSON summary', async () => {
    importJob.create.mockResolvedValue(createdJob);
    const summary = { discovered: 2, source: 'gmail' };

    await expect(prismaImportJobStore.create({
      type: 'WORK_INSTRUCTION_GMAIL',
      status: 'PENDING',
      summary,
    })).resolves.toBe(createdJob);

    expect(importJob.create).toHaveBeenCalledWith({
      data: {
        type: 'WORK_INSTRUCTION_GMAIL',
        status: ImportStatus.PENDING,
        summary,
      },
    });
  });

  it('updates summaries and includes completedAt only when supplied', async () => {
    const completedAt = new Date('2026-08-31T01:00:00.000Z');
    const completed = { ...createdJob, status: 'COMPLETED' as const, completedAt };
    importJob.update.mockResolvedValueOnce(completed).mockResolvedValueOnce({
      ...createdJob,
      status: 'FAILED' as const,
    });

    await expect(prismaImportJobStore.update('job-1', {
      status: 'COMPLETED',
      summary: { applied: 2 },
      completedAt,
    })).resolves.toBe(completed);
    await expect(prismaImportJobStore.update('job-1', {
      status: 'FAILED',
      summary: { error: 'temporary' },
    })).resolves.toMatchObject({ status: 'FAILED' });

    expect(importJob.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'job-1' },
      data: {
        status: ImportStatus.COMPLETED,
        summary: { applied: 2 },
        completedAt,
      },
    });
    expect(importJob.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'job-1' },
      data: {
        status: ImportStatus.FAILED,
        summary: { error: 'temporary' },
      },
    });
  });

  it('finds jobs by both id and type and preserves a missing result as null', async () => {
    importJob.findFirst.mockResolvedValueOnce(createdJob).mockResolvedValueOnce(null);

    await expect(prismaImportJobStore.find('job-1', 'WORK_INSTRUCTION_GMAIL')).resolves.toBe(createdJob);
    await expect(prismaImportJobStore.find('missing', 'WORK_INSTRUCTION_GMAIL')).resolves.toBeNull();

    expect(importJob.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: 'job-1', type: 'WORK_INSTRUCTION_GMAIL' },
    });
    expect(importJob.findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: 'missing', type: 'WORK_INSTRUCTION_GMAIL' },
    });
  });
});
