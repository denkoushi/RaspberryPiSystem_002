/** Private, read-only export; run with the existing API database environment. */
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function exportBusinessHermesLearning(db: Pick<PrismaClient, 'businessHermesConsultationMessage'>,
  since: Date, until: Date, write: (line: string) => Promise<unknown>): Promise<number> {
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until) throw new Error('Invalid export time range');
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.businessHermesConsultationMessage.findMany({
      where: { role: 'user', createdAt: { gte: since, lt: until } }, orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, consultationId: true, searchDiagnostics: true }
    });
    if (!rows.length) break;
    for (const row of rows) {
      const measurement = Array.isArray(row.searchDiagnostics)
        ? row.searchDiagnostics.find((item) => item && typeof item === 'object' && !Array.isArray(item) && item.kind === 'business-hermes-learning-v1') : undefined;
      if (!measurement || typeof measurement !== 'object' || Array.isArray(measurement)) continue;
      const answer = typeof measurement.answerMessageId === 'string'
        ? await db.businessHermesConsultationMessage.findFirst({ where: {
          id: measurement.answerMessageId, consultationId: row.consultationId, role: 'assistant'
        }, select: { id: true, content: true, evidence: true, searchDiagnostics: true } }) : null;
      await write(`${JSON.stringify({ schemaVersion: 1, id: row.id, consultationId: row.consultationId, measurement, answer })}\n`);
      count++;
    }
    cursor = rows.at(-1)!.id;
  }
  return count;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const since = new Date(value('--since') ?? '');
  const until = new Date(value('--until') ?? new Date().toISOString());
  const output = value('--out');
  if (!output || !Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until) {
    throw new Error('Usage: export-business-hermes-learning --since=ISO --until=ISO --out=PRIVATE.jsonl');
  }
  const file = await open(resolve(output), 'wx', 0o600);
  try {
    const count = await exportBusinessHermesLearning(prisma, since, until, (line) => file.write(line));
    console.log(JSON.stringify({ records: count, output: resolve(output), since, until }));
  } finally {
    await file.close();
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
