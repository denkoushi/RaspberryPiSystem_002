import { describe, expect, it } from 'vitest';

import { createEmptyAccumulatedLeaderboardDecorations } from '../../mergeLeaderboardBoardWithDecorations';
import {
  fingerprintLeaderboardBoardContent,
  fingerprintLeaderboardBoardDecorations,
  shouldSkipCachePut,
  shouldSkipLeaderboardBoardCachePut
} from '../leaderboardBoardCachePersistPolicy';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function board(
  rows: Array<{
    id: string;
    order?: number | null;
    note?: string | null;
    machineRequiredMinutes?: number;
    laborRequiredMinutes?: number;
  }>
) {
  return {
    page: 1,
    pageSize: 80,
    total: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      processingOrder: r.order ?? null,
      note: r.note ?? null,
      machineRequiredMinutes: r.machineRequiredMinutes,
      laborRequiredMinutes: r.laborRequiredMinutes,
      rowData: { progress: '未' }
    })),
    resources: [{ resourceCd: '1', hasMore: false, total: rows.length, pageSize: 80 }]
  } as ProductionScheduleLeaderboardBoardResponse;
}

describe('leaderboardBoardCachePersistPolicy', () => {
  it('fingerprintLeaderboardBoardContent は順位変更で変わる', () => {
    const a = fingerprintLeaderboardBoardContent(board([{ id: 'r1', order: 1 }]));
    const b = fingerprintLeaderboardBoardContent(board([{ id: 'r1', order: 2 }]));
    expect(a).not.toBe(b);
  });

  it('fingerprintLeaderboardBoardContent は人工数メタデータの変化で変わる', () => {
    const base = fingerprintLeaderboardBoardContent(
      board([{ id: 'r1', machineRequiredMinutes: 400, laborRequiredMinutes: 0 }])
    );
    const withLabor = fingerprintLeaderboardBoardContent(
      board([{ id: 'r1', machineRequiredMinutes: 400, laborRequiredMinutes: 175 }])
    );
    expect(base).not.toBe(withLabor);
  });

  it('shouldSkipCachePut は内容同一なら true', () => {
    const fp = fingerprintLeaderboardBoardContent(board([{ id: 'r1', order: 1 }]));
    expect(shouldSkipCachePut({ lastContentFingerprint: fp, nextContentFingerprint: fp })).toBe(true);
    expect(
      shouldSkipCachePut({
        lastContentFingerprint: fp,
        nextContentFingerprint: fingerprintLeaderboardBoardContent(board([{ id: 'r1', order: 2 }]))
      })
    ).toBe(false);
  });

  it('fingerprintLeaderboardBoardDecorations は自主検査状態の変化で変わる', () => {
    const base = createEmptyAccumulatedLeaderboardDecorations();
    const rowId = 'row-self-inspection';
    const withoutInspection = {
      ...base,
      rowDecorationsById: new Map([
        [
          rowId,
          {
            resolvedMachineName: null,
            customerName: null,
            hasSelfInspectionDrawing: false,
            selfInspectionTemplateId: null,
            selfInspectionStatus: null,
            selfInspectionEntryPath: null
          }
        ]
      ])
    };
    const withInspection = {
      ...base,
      rowDecorationsById: new Map([
        [
          rowId,
          {
            resolvedMachineName: null,
            customerName: null,
            hasSelfInspectionDrawing: true,
            selfInspectionTemplateId: 'tpl-1',
            selfInspectionStatus: 'in_progress' as const,
            selfInspectionEntryPath: '/kiosk/part-measurement/self-inspection/start?x=1'
          }
        ]
      ])
    };
    expect(fingerprintLeaderboardBoardDecorations(withoutInspection)).not.toBe(
      fingerprintLeaderboardBoardDecorations(withInspection)
    );
  });

  it('fingerprintLeaderboardBoardDecorations はチップ追加で変わる', () => {
    const empty = createEmptyAccumulatedLeaderboardDecorations();
    const withChips = {
      ...empty,
      leaderboardFooterChipsByPartKey: {
        'seiban\0pn\0hc': [
          { rowId: 'row-1', resourceCd: '021', isCompleted: false }
        ]
      }
    };
    expect(fingerprintLeaderboardBoardDecorations(empty)).not.toBe(
      fingerprintLeaderboardBoardDecorations(withChips)
    );
  });

  it('fingerprintLeaderboardBoardContent は工程変更残骸疑いの変化で変わる', () => {
    const base = board([{ id: 'r1', order: 1 }]);
    const withResidual = {
      ...base,
      processChangeResidualTotal: 1,
      processChangeResidualRepresentativeLimit: 20,
      processChangeResidualRows: [
        {
          id: 'x1',
          occurredAt: '2026-01-01T00:00:00.000Z',
          rowData: {},
          processChangeResidualEvidence: {
            current: {
              productNo: 'P1',
              fkojun: '210',
              resourceCd: '1',
              status: 'R',
              fupdtedt: '2026-04-13T13:02:46.000Z'
            },
            completedOtherResource: {
              productNo: 'P1',
              fkojun: '210',
              resourceCd: '2',
              status: 'C',
              fupdtedt: '2026-05-12T06:46:56.000Z'
            }
          }
        }
      ]
    } as ProductionScheduleLeaderboardBoardResponse;
    expect(fingerprintLeaderboardBoardContent(base)).not.toBe(
      fingerprintLeaderboardBoardContent(withResidual)
    );
  });

  it('fingerprintLeaderboardBoardContent は工程変更残骸 evidence の詳細変化で変わる', () => {
    const base = board([{ id: 'r1', order: 1 }]);
    const withCurrentR = {
      ...base,
      processChangeResidualTotal: 1,
      processChangeResidualRepresentativeLimit: 20,
      processChangeResidualRows: [
        {
          id: 'x1',
          occurredAt: '2026-01-01T00:00:00.000Z',
          rowData: {},
          processChangeResidualEvidence: {
            current: {
              productNo: 'P1',
              fkojun: '210',
              resourceCd: '1',
              status: 'R',
              fupdtedt: '2026-04-13T13:02:46.000Z'
            },
            completedOtherResource: {
              productNo: 'P1',
              fkojun: '210',
              resourceCd: '2',
              status: 'C',
              fupdtedt: '2026-05-12T06:46:56.000Z'
            }
          }
        }
      ]
    } as ProductionScheduleLeaderboardBoardResponse;
    const withCurrentS = {
      ...withCurrentR,
      processChangeResidualRows: [
        {
          ...withCurrentR.processChangeResidualRows![0]!,
          processChangeResidualEvidence: {
            ...withCurrentR.processChangeResidualRows![0]!.processChangeResidualEvidence!,
            current: {
              ...withCurrentR.processChangeResidualRows![0]!.processChangeResidualEvidence!.current,
              status: 'S'
            }
          }
        }
      ]
    } as ProductionScheduleLeaderboardBoardResponse;

    expect(fingerprintLeaderboardBoardContent(withCurrentR)).not.toBe(
      fingerprintLeaderboardBoardContent(withCurrentS)
    );
  });

  it('shouldSkipLeaderboardBoardCachePut は board 同一でも装飾が変われば false', () => {
    const b = board([{ id: 'r1', order: 1 }]);
    const boardFp = fingerprintLeaderboardBoardContent(b);
    const emptyDecoFp = fingerprintLeaderboardBoardDecorations(
      createEmptyAccumulatedLeaderboardDecorations()
    );
    const withChipsDecoFp = fingerprintLeaderboardBoardDecorations({
      rowDecorationsById: new Map(),
      leaderboardFooterChipsByPartKey: {
        'k\0a\0b': [{ rowId: 'r1', resourceCd: '021', isCompleted: true }]
      }
    });

    expect(
      shouldSkipLeaderboardBoardCachePut({
        lastBoardFingerprint: boardFp,
        nextBoardFingerprint: boardFp,
        lastDecorationsFingerprint: emptyDecoFp,
        nextDecorationsFingerprint: withChipsDecoFp
      })
    ).toBe(false);

    expect(
      shouldSkipLeaderboardBoardCachePut({
        lastBoardFingerprint: boardFp,
        nextBoardFingerprint: boardFp,
        lastDecorationsFingerprint: withChipsDecoFp,
        nextDecorationsFingerprint: withChipsDecoFp
      })
    ).toBe(true);
  });
});
