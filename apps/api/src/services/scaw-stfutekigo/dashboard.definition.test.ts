import { describe, expect, it } from 'vitest';
import { SCAW_STFUTEKIGO_DASHBOARD_ID, SCAW_STFUTEKIGO_SOURCE_COLUMNS } from './constants.js';
import { buildScawStfutekigoDashboardDefinition } from './dashboard.definition.js';

describe('scawSTFUTEKIGO dashboard definition', () => {
  it('fixes the 16-column source contract at the ingest boundary', () => {
    const definition = buildScawStfutekigoDashboardDefinition();
    expect(SCAW_STFUTEKIGO_DASHBOARD_ID).toBe('3b1a4089-3274-448b-9f4e-ec20c294fe27');
    expect(definition.ingestMode).toBe('APPEND');
    expect(definition.dateColumnName).toBe('discoveredOn');
    expect(definition.columnDefinitions).toHaveLength(16);
    expect(definition.columnDefinitions.every((column) => column.required && column.dataType === 'string')).toBe(true);
    expect(definition.columnDefinitions.map((column) => column.csvHeaderCandidates[0])).toEqual([...SCAW_STFUTEKIGO_SOURCE_COLUMNS]);
  });
});
