import { prisma } from '../../lib/prisma.js';

export async function checkDatabaseConnection(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
