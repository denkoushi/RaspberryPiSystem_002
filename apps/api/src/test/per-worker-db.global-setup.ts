/**
 * Vitest global setup for API_TEST_PER_WORKER_DB=1 (see per-worker-db.ts).
 *
 * Clones the already-migrated DATABASE_URL database into one database per worker with
 * `CREATE DATABASE ... TEMPLATE`, so test files running in parallel never share rows.
 * Without the flag this is a no-op and the suite keeps its single-database behaviour.
 */
import os from 'node:os';

import pg from 'pg';
import type { TestProject } from 'vitest/node';

import {
  assertDisposableDatabaseUrl,
  databaseNameFromUrl,
  isPerWorkerDbEnabled,
  workerDatabaseName,
} from './per-worker-db.js';

const TEMPLATE_BUSY_RETRIES = 10;
const TEMPLATE_BUSY_DELAY_MS = 500;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Mirrors Vitest's own worker-count resolution so every VITEST_POOL_ID has a database. */
function resolveWorkerCount(project: TestProject): number {
  const configured = project.config.maxWorkers || project.vitest.config.maxWorkers;
  if (configured) return configured;
  return Math.max(os.availableParallelism() - 1, 1);
}

async function withMaintenanceClient<T>(databaseUrl: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function createFromTemplate(client: pg.Client, name: string, template: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await client.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`);
      return;
    } catch (error) {
      // 55006: the template still has a session open (e.g. a migration client shutting down).
      const busy = (error as { code?: string }).code === '55006';
      if (!busy || attempt >= TEMPLATE_BUSY_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, TEMPLATE_BUSY_DELAY_MS));
    }
  }
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  if (!isPerWorkerDbEnabled()) return;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('API_TEST_PER_WORKER_DB=1 requires DATABASE_URL');
  assertDisposableDatabaseUrl(databaseUrl);

  const template = databaseNameFromUrl(databaseUrl);
  const names = Array.from({ length: resolveWorkerCount(project) }, (_, i) => workerDatabaseName(template, i + 1));

  await withMaintenanceClient(databaseUrl, async (client) => {
    for (const name of names) {
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      await createFromTemplate(client, name, template);
    }
  });

  return async () => {
    await withMaintenanceClient(databaseUrl, async (client) => {
      for (const name of names) {
        await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      }
    }).catch(() => {});
  };
}
