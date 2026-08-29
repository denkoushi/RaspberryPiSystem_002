import type { Prisma, PrismaClient } from '@prisma/client';

/** Generated Prisma payloads used by the work-instruction persistence modules. */
export type WorkInstructionRowRecord = Prisma.WorkInstructionRowGetPayload<{
  include: { steps: { orderBy: { step: 'asc' }; include: { asset: true } } };
}>;

export type WorkInstructionStepRecord = WorkInstructionRowRecord['steps'][number];
export type WorkInstructionAssetRecord = Prisma.WorkInstructionAssetGetPayload<Prisma.WorkInstructionAssetDefaultArgs>;
export type WorkInstructionImportMessageRecord = Prisma.WorkInstructionImportMessageGetPayload<Prisma.WorkInstructionImportMessageDefaultArgs>;

export type WorkInstructionDbClient = PrismaClient | Prisma.TransactionClient;
export type WorkInstructionLockedAsset = Pick<WorkInstructionAssetRecord, 'id' | 'status' | 'sha256'>;
