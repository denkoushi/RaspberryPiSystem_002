import { env } from '../config/env.js';
import { createPrismaClient } from './prisma-client.js';

export const prisma = createPrismaClient(env.DATABASE_URL, {
  connectionLimit: env.DATABASE_PRISMA_CONNECTION_LIMIT,
  poolTimeoutSeconds: env.DATABASE_PRISMA_POOL_TIMEOUT_SECONDS,
  connectTimeoutSeconds: env.DATABASE_PRISMA_CONNECT_TIMEOUT_SECONDS
});
