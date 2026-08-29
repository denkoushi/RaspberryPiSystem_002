import { ImportStatus, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

export type ImportJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type WorkInstructionImportJob = {
  id: string;
  type: string;
  status: ImportJobStatus;
  summary: unknown;
  createdAt: Date;
  completedAt: Date | null;
};

export type ImportJobStore = {
  create: (input: {
    type: string;
    status: ImportJobStatus;
    summary: Record<string, unknown>;
  }) => Promise<WorkInstructionImportJob>;
  update: (id: string, input: {
    status: ImportJobStatus;
    summary: Record<string, unknown>;
    completedAt?: Date | null;
  }) => Promise<WorkInstructionImportJob>;
  find: (id: string, type: string) => Promise<WorkInstructionImportJob | null>;
};

export const prismaImportJobStore: ImportJobStore = {
  async create(input) {
    const job = await prisma.importJob.create({
      data: {
        type: input.type,
        status: input.status as ImportStatus,
        summary: input.summary as unknown as Prisma.InputJsonValue,
      },
    });
    return job as WorkInstructionImportJob;
  },
  async update(id, input) {
    const job = await prisma.importJob.update({
      where: { id },
      data: {
        status: input.status as ImportStatus,
        summary: input.summary as unknown as Prisma.InputJsonValue,
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      },
    });
    return job as WorkInstructionImportJob;
  },
  async find(id, type) {
    const job = await prisma.importJob.findFirst({ where: { id, type } });
    return (job as WorkInstructionImportJob | null) ?? null;
  },
};
