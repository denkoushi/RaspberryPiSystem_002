import { describe, expect, it } from 'vitest';
import { autoUnitSplitCandidateSql, isFirstAutoUnitSplitProcess } from '../auto-unit-split-candidates.js';
import { isLaterProcessOrder } from '../../process-order.js';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import { STRING_TRIM_CHARACTERS } from '../../grinding-planning-board/shared.js';

describe('automatic candidate SQL contract', () => {
  it.each([
    ['20', '010', true], ['010', '10', false], ['１０', '10', false], [' ２０\t', '１０', true],
    ['A', 'a', isLaterProcessOrder('A', 'a')], ['a', 'A', isLaterProcessOrder('a', 'A')], ['0x20', '10', true], ['2e1', '10', true], ['A', 'B', false], ['B', 'A', true], ['AA', 'A', true], ['', '10', false]
  ])('compares normalized process orders %s / %s', (candidate, base, later) => {
    const item = { fseiban: 'S', fhincd: 'PART', originalResourceCd: '021', processOrder: candidate } as GrindingPlanningBoardItem;
    expect(isFirstAutoUnitSplitProcess(item, [{ ...item, processOrder: base as string }])).toBe(!later);
  });
  it('gates the probe by flags/defaults, quantity, progress, history, winners and raw part keys and conservative process order', () => {
    const sql = autoUnitSplitCandidateSql('site', ['S'], { grindingResourceCds: ['305'], cuttingExcludedResourceCds: ['MSZ'] });
    expect(sql.sql).toContain('COALESCE(c."unitSplitEnabled",');
    expect(sql.sql).toContain("IN ('021', '022')");
    expect(sql.sql).toContain('q."plannedQuantity" BETWEEN 2 AND 50');
    for (const table of ['ProductionScheduleProgress', 'ProductionScheduleExternalCompletion', 'ProductionScheduleSessakuPieceSet',
      'ProductionScheduleSessakuPieceHistory', 'ProductionScheduleGrindingPlanningBoardOverride']) expect(sql.sql).toContain(table);
    expect(sql.sql).toContain('NORMALIZE(e."rowData"');
    expect(sql.sql).toContain('ELSE false END');
    expect(sql.sql).toContain('WITH untouched AS MATERIALIZED');
    expect(sql.sql).toContain('ORDER BY array_position(?::text[], "fseiban"), "fseiban" COLLATE "C", "parentId" COLLATE "C", "id"');
    expect(sql.sql).toContain(`e."rowData"->>'FHINCD' = r."rowData"->>'FHINCD'`);
    expect(sql.values).toContain(STRING_TRIM_CHARACTERS);
    expect('\t\u3000PART\ufeff'.trim()).toBe('PART');
    for (const char of ['\t', '\u3000', '\ufeff']) expect(STRING_TRIM_CHARACTERS).toContain(char);
  });
  it('keeps candidate discovery scoped to the board order without input-generation scans', () => {
    const sql = autoUnitSplitCandidateSql('site', ['S'], { grindingResourceCds: ['305'], cuttingExcludedResourceCds: [] });
    expect(sql.sql).toContain(`r."rowData"->>'FSEIBAN' = ANY(`);
    for (const removed of ['input_keys', 'input_generations', 'inputKey', 'ctid', 'xmin', 'JSONB_TO_RECORDSET']) {
      expect(sql.sql).not.toContain(removed);
    }
  });
  it('optionally excludes raw parent IDs without changing the default candidate query or ordering', () => {
    const policy = { grindingResourceCds: ['305'], cuttingExcludedResourceCds: [] };
    const original = autoUnitSplitCandidateSql('site', ['S'], policy);
    const empty = autoUnitSplitCandidateSql('site', ['S'], policy, []);
    expect(empty.sql).toBe(original.sql); expect(empty.values).toEqual(original.values);
    const excluded = ['row:first', 'row:second'];
    const paged = autoUnitSplitCandidateSql('site', ['S'], policy, excluded);
    expect(paged.sql).toContain(') <> ALL(?::text[])');
    expect(paged.values).toContainEqual(excluded);
    expect(paged.sql).toContain('ORDER BY array_position(?::text[], "fseiban"), "fseiban" COLLATE "C", "parentId" COLLATE "C", "id"');
  });
});
