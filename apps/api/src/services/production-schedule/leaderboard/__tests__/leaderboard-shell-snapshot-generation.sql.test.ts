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
  });

  it('keeps lightweight raw mail revision fields only for deriving the shell snapshot revision', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../leaderboard-shell-snapshot-generation.ts'),
      'utf8'
    );

    expect(source).toContain('fkojunstStatusMailRowsLatestUpdatedAt');
    expect(source).toContain('fkojunstStatusMailRowsRevision');
    expect(source).toContain('MAX(COALESCE(r."updatedAt", r."createdAt"))');
    expect(source).toContain('ir."status" = \'COMPLETED\'::"ImportStatus"');
    expect(source).toContain('ir."completedAt" IS NOT NULL');
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
