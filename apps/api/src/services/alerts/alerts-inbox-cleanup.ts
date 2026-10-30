import { promises as fs, type Stats } from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

const DAY_MS = 86400_000;
const BATCH_SIZE = 100;

export async function cleanupAlertsInbox(alertsDir: string, now: number): Promise<void> {
  const configuredDays = Number(process.env.ALERTS_INBOX_RETENTION_DAYS);
  const retentionDays = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 30;
  const counts = { deletedEmpty: 0, deletedIngested: 0, keptUnparseable: 0, keptNotInDb: 0, errors: 0 };
  let batch: { filePath: string; id: string; stat: Stats }[] = [];

  // Recheck the file before unlinking so a replacement or an active write is kept.
  const remove = async (filePath: string, previous: Stats): Promise<boolean> => {
    const current = await fs.lstat(filePath);
    if (!current.isFile() || current.ino !== previous.ino || current.dev !== previous.dev ||
        current.size !== previous.size || current.mtimeMs !== previous.mtimeMs ||
        current.ctimeMs !== previous.ctimeMs) return false;
    await fs.unlink(filePath);
    return true;
  };

  const flush = async () => {
    if (batch.length === 0) return;
    const candidates = batch;
    batch = [];
    try {
      const rows = await prisma.alert.findMany({
        where: { id: { in: candidates.map((file) => file.id) } },
        select: { id: true }
      });
      const ingestedIds = new Set(rows.map((row) => row.id));
      for (const file of candidates) {
        if (!ingestedIds.has(file.id)) {
          counts.keptNotInDb++;
          continue;
        }
        try {
          if (await remove(file.filePath, file.stat)) counts.deletedIngested++;
        } catch (err) {
          counts.errors++;
          logger?.warn({ err, filePath: file.filePath }, '[AlertsIngestor] Failed to delete inbox file');
        }
      }
    } catch (err) {
      counts.errors += candidates.length;
      logger?.warn({ err }, '[AlertsIngestor] Inbox DB lookup failed, keeping batch');
    }
  };

  try {
    const directory = await fs.opendir(alertsDir);
    for await (const entry of directory) {
      if (!entry.isFile() || !/^alert-.*\.json(\.1)?$/.test(entry.name)) continue;
      const filePath = path.join(alertsDir, entry.name);
      try {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile()) continue;
        const age = now - stat.mtimeMs;
        if (stat.size === 0) {
          if (age > DAY_MS && await remove(filePath, stat)) counts.deletedEmpty++;
          continue;
        }
        if (age <= retentionDays * DAY_MS) continue;
        let alert: unknown;
        try {
          alert = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        } catch {
          counts.keptUnparseable++;
          continue;
        }
        if (!alert || typeof alert !== 'object' || !('id' in alert) ||
            typeof alert.id !== 'string' || !alert.id) {
          counts.keptNotInDb++;
          continue;
        }
        batch.push({ filePath, id: alert.id, stat });
        if (batch.length >= BATCH_SIZE) await flush();
      } catch (err) {
        counts.errors++;
        logger?.warn({ err, filePath }, '[AlertsIngestor] Failed to clean inbox file');
      }
    }
    await flush();
  } finally {
    logger?.info(counts, '[AlertsIngestor] Inbox cleanup completed');
  }
}
