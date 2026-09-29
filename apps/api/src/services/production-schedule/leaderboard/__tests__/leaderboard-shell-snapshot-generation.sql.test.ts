import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('leaderboard-shell-snapshot-generation SQL', () => {
  it('does not scan raw mail rowData digest on the snapshot token path', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../fkojunst-status-mail-generation-signals.ts'),
      'utf8'
    );

    expect(source).not.toContain('string_agg');
    expect(source).not.toContain('md5("rowData"::text)');
    expect(source).not.toContain('sum(hashtext("rowData"::text))');
    expect(source).not.toContain('COUNT(*)');
    expect(source).toContain('fetchFkojunstStatusMailGenerationRevision');
  });

  it('reads the persisted raw mail revision instead of aggregating raw mail rows', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../leaderboard-shell-snapshot-generation.ts'),
      'utf8'
    );

    expect(source).toContain('rowsLatestUpdatedAt');
    expect(source).toContain('MAX(COALESCE("updatedAt", "createdAt"))');
    expect(source).toContain('fkojunstStatusMailRowsRevision');
    expect(source).toContain('fetchFkojunstStatusMailGenerationRevision(prisma)');
    expect(source).not.toContain('fkojunstStatusMailRowsCount');
    expect(source).not.toContain('"CsvDashboardIngestRun"');
    const tokenObject = source.slice(
      source.indexOf('return JSON.stringify({'),
      source.indexOf('  });', source.indexOf('return JSON.stringify({'))
    );
    expect(tokenObject).not.toContain('fkojunstStatusMailRowsCount:');
    expect(tokenObject).not.toContain('fkojunstStatusMailRowsLatestCreatedAt:');
    expect(tokenObject).not.toContain('fkojunstStatusMailRowsLatestUpdatedAt:');
    expect(source).not.toContain('fkojunstStatusMailLatestIngestCompletedAt');
  });
});
