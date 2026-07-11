import { describe, expect, it } from 'vitest';

import {
  parseCsvList,
  productionScheduleLeaderboardBoardContinueBodySchema,
  productionScheduleLeaderboardClientPerfBodySchema,
  productionScheduleLeaderboardLaborMetadataBodySchema,
  productionScheduleLeaderboardBoardQuerySchema,
  productionScheduleSeibanMachineNamesBodySchema,
  toLegacyLocationKeyFromDeviceScope
} from '../shared.js';

describe('production-schedule route shared helpers', () => {
  it('deduplicates csv tokens while preserving explicit scope boundary conversion', () => {
    expect(parseCsvList(' 305,581,305 , ,582 ')).toEqual(['305', '581', '582']);
  });

  it('bridges deviceScopeKey to legacy locationKey at route boundary', () => {
    const deviceScopeKey = '第2工場 - kensakuMain';
    expect(toLegacyLocationKeyFromDeviceScope(deviceScopeKey)).toBe('第2工場 - kensakuMain');
  });

  it('productionScheduleSeibanMachineNamesBodySchema は重複除去と正規化する', () => {
    const parsed = productionScheduleSeibanMachineNamesBodySchema.parse({
      fseibans: ['  a ', 'a', 'b']
    });
    expect(parsed.fseibans).toEqual(['a', 'b']);
  });

  it('productionScheduleSeibanMachineNamesBodySchema は 100 件までは保持する', () => {
    const inputs = Array.from({ length: 60 }, (_, i) => `S-${i + 1}`);
    const parsed = productionScheduleSeibanMachineNamesBodySchema.parse({
      fseibans: inputs
    });
    expect(parsed.fseibans).toEqual(inputs);
  });

  it('productionScheduleLeaderboardBoardQuerySchema は deferTotals を string/boolean 両方で解釈する', () => {
    const base = {
      boardResourceCds: 'R1',
      pageSize: '80',
      allowResourceOnly: 'true'
    };

    expect(
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...base,
        deferTotals: 'true'
      }).deferTotals
    ).toBe(true);
    expect(
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...base,
        deferTotals: true
      }).deferTotals
    ).toBe(true);
    expect(
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...base,
        deferTotals: 'false'
      }).deferTotals
    ).toBe(false);
    expect(productionScheduleLeaderboardBoardQuerySchema.parse(base).deferTotals).toBe(false);
  });

  it('productionScheduleLeaderboardBoardQuerySchema は includeLabor を既定 false / 明示 true で解釈する', () => {
    const base = {
      boardResourceCds: 'R1',
      pageSize: '80',
      allowResourceOnly: 'true'
    };

    expect(productionScheduleLeaderboardBoardQuerySchema.parse(base).includeLabor).toBe(false);
    expect(
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...base,
        includeLabor: 'false'
      }).includeLabor
    ).toBe(false);
    expect(
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...base,
        includeLabor: false
      }).includeLabor
    ).toBe(false);
    expect(
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...base,
        includeLabor: 'true'
      }).includeLabor
    ).toBe(true);
    expect(
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...base,
        includeLabor: true
      }).includeLabor
    ).toBe(true);
  });

  it('productionScheduleLeaderboardBoardContinueBodySchema は includeLabor 欠落を false にする', () => {
    const base = {
      boardResourceCds: 'R1',
      pageSize: 160,
      allowResourceOnly: true,
      resourceSlices: [{ resourceCd: 'R1', hasMore: false }]
    };

    expect(productionScheduleLeaderboardBoardContinueBodySchema.parse(base).includeLabor).toBe(false);
    expect(
      productionScheduleLeaderboardBoardContinueBodySchema.parse({
        ...base,
        includeLabor: true
      }).includeLabor
    ).toBe(true);
  });

  it('残骸 summary 遅延 field は既定 false / 明示 true で解釈する', () => {
    const queryBase = {
      boardResourceCds: 'R1',
      pageSize: '50',
      allowResourceOnly: 'true'
    };
    expect(productionScheduleLeaderboardBoardQuerySchema.parse(queryBase).deferResidualSummary).toBe(false);
    expect(
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...queryBase,
        deferResidualSummary: 'true'
      }).deferResidualSummary
    ).toBe(true);

    const continueBase = {
      boardResourceCds: 'R1',
      pageSize: 160,
      allowResourceOnly: true,
      resourceSlices: [{ resourceCd: 'R1', hasMore: false }]
    };
    expect(
      productionScheduleLeaderboardBoardContinueBodySchema.parse(continueBase).includeResidualSummary
    ).toBe(false);
    expect(
      productionScheduleLeaderboardBoardContinueBodySchema.parse({
        ...continueBase,
        includeResidualSummary: true
      }).includeResidualSummary
    ).toBe(true);
  });

  it('productionScheduleLeaderboardLaborMetadataBodySchema は UUID / split UUID と target scope を受け付ける', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const splitUuid = 'split:550e8400-e29b-41d4-a716-446655440001';

    const parsed = productionScheduleLeaderboardLaborMetadataBodySchema.parse({
      rowIds: [uuid, splitUuid],
      targetDeviceScopeKey: 'site-a - mac'
    });

    expect(parsed.rowIds).toEqual([uuid, splitUuid]);
    expect(parsed.targetDeviceScopeKey).toBe('site-a - mac');
  });

  it('productionScheduleLeaderboardLaborMetadataBodySchema は空配列・不正 ID・上限超過を拒否する', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';

    expect(() =>
      productionScheduleLeaderboardLaborMetadataBodySchema.parse({
        rowIds: []
      })
    ).toThrow();
    expect(() =>
      productionScheduleLeaderboardLaborMetadataBodySchema.parse({
        rowIds: ['not-a-display-id']
      })
    ).toThrow();
    expect(() =>
      productionScheduleLeaderboardLaborMetadataBodySchema.parse({
        rowIds: Array.from({ length: 8001 }, () => uuid)
      })
    ).toThrow();
  });

  it('leaderboard board schemas は completionFilter を既定 all / 明示値で解釈する', () => {
    const queryBase = {
      boardResourceCds: 'R1',
      pageSize: '80',
      allowResourceOnly: 'true'
    };
    expect(productionScheduleLeaderboardBoardQuerySchema.parse(queryBase).completionFilter).toBe('all');
    expect(
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...queryBase,
        completionFilter: 'incomplete'
      }).completionFilter
    ).toBe('incomplete');
    expect(() =>
      productionScheduleLeaderboardBoardQuerySchema.parse({
        ...queryBase,
        completionFilter: 'done'
      })
    ).toThrow();

    const continueBase = {
      boardResourceCds: 'R1',
      pageSize: 160,
      allowResourceOnly: true,
      resourceSlices: [{ resourceCd: 'R1', hasMore: false }]
    };
    expect(productionScheduleLeaderboardBoardContinueBodySchema.parse(continueBase).completionFilter).toBe('all');
    expect(
      productionScheduleLeaderboardBoardContinueBodySchema.parse({
        ...continueBase,
        completionFilter: 'complete'
      }).completionFilter
    ).toBe('complete');
  });

  it('productionScheduleLeaderboardClientPerfBodySchema は計測イベントを制限付きで受け付ける', () => {
    const parsed = productionScheduleLeaderboardClientPerfBodySchema.parse({
      sessionId: 'session-1',
      event: 'schedule-usable',
      pagePath: '/kiosk/production-schedule/leader-order-board?leaderboardPerf=1',
      paramsKeyHash: 'deadbeef',
      resourceCds: '581,305',
      markMs: 1234.5,
      elapsedMs: 999,
      detail: {
        rowCount: 480,
        isFetching: false,
        source: 'network',
        empty: null
      }
    });

    expect(parsed.detail?.rowCount).toBe(480);
    expect(() =>
      productionScheduleLeaderboardClientPerfBodySchema.parse({
        sessionId: 'session-1',
        event: 'x',
        detail: { nested: { nope: true } }
      })
    ).toThrow();
  });
});
