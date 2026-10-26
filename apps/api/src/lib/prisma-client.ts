import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { postgresPoolConfig } from './postgres-url-params.js';

export function createPrismaClient(
  databaseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/borrow_return',
  poolDefaults?: Parameters<typeof postgresPoolConfig>[1]
) {
  return new PrismaClient({ adapter: new PrismaPg(postgresPoolConfig(databaseUrl, poolDefaults)) });
}
