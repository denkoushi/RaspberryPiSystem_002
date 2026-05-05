import { PrismaClient } from '@prisma/client';

import { env } from '../config/env.js';
import { mergePostgresUrlQueryParams } from './postgres-url-params.js';

const datasourceUrl = mergePostgresUrlQueryParams(env.DATABASE_URL, {
  connection_limit: String(env.DATABASE_PRISMA_CONNECTION_LIMIT),
  pool_timeout: String(env.DATABASE_PRISMA_POOL_TIMEOUT_SECONDS),
  connect_timeout: String(env.DATABASE_PRISMA_CONNECT_TIMEOUT_SECONDS)
});

export const prisma = new PrismaClient({
  datasourceUrl
});
