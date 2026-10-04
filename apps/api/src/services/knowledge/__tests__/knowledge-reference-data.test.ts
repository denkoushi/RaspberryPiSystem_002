import type { PrismaClient } from '@prisma/client';
import { expect, it, vi } from 'vitest';

import { ensureKnowledgeReferenceData } from '../knowledge-reference-data.js';
import type { TriageRepositoryPort } from '../triage.port.js';

it('sends stopped drafts to approval during each startup reference-data pass', async () => {
  const tx = { $executeRaw: vi.fn(), knowledgeField: { count: vi.fn().mockResolvedValue(1) } };
  const db = { $transaction: vi.fn(async run => run(tx)), knowledgeWorkType: { count: vi.fn().mockResolvedValue(1) },
    knowledgeProcedureMaterial: { findMany: vi.fn().mockResolvedValue([]) } };
  const procedures = { submitStoppedDraftsForApproval: vi.fn().mockResolvedValue(undefined) };
  const triage = { open: vi.fn() };
  await ensureKnowledgeReferenceData(db as unknown as PrismaClient, triage as unknown as TriageRepositoryPort, procedures);
  expect(procedures.submitStoppedDraftsForApproval).toHaveBeenCalledTimes(1);
});
