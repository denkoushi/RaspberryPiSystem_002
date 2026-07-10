import type { Prisma } from '@prisma/client';
import { assemblyTemplateDetailInclude } from './assembly-template.service.js';

export const assemblyWorkSessionDetailInclude = {
  template: { include: assemblyTemplateDetailInclude },
  torqueRecords: {
    orderBy: [{ recordedAt: 'asc' }, { createdAt: 'asc' }],
    include: { templateBolt: { include: { area: true } } },
  },
  checkRecords: { orderBy: [{ checkedAt: 'asc' }, { createdAt: 'asc' }] },
  restartLogs: { orderBy: { createdAt: 'asc' } },
  approval: true,
} satisfies Prisma.AssemblyWorkSessionInclude;

export type AssemblyWorkSessionDetail = Prisma.AssemblyWorkSessionGetPayload<{
  include: typeof assemblyWorkSessionDetailInclude;
}>;
