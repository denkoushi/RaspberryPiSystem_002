import { describe, expect, it } from 'vitest';

import {
  isSafeInspectionDrawingReturnPath,
  normalizeInternalInspectionDrawingReturnPath,
  parseInspectionDrawingReturnFromLocation,
  type InspectionDrawingLocationReturn
} from '../inspectionDrawingReturnNavigation';

const LIBRARY_PATH = '/kiosk/part-measurement/inspection';
const FALLBACK: InspectionDrawingLocationReturn = {
  inspectionDrawingReturnTo: LIBRARY_PATH,
  inspectionDrawingReturnLabel: '一覧へ戻る'
};
const PRODUCTION_ALLOWED = [LIBRARY_PATH] as const;
const PARSE_OPTIONS = { fallback: FALLBACK, allowedReturnPaths: PRODUCTION_ALLOWED };

describe('normalizeInternalInspectionDrawingReturnPath', () => {
  it('.. を解決する', () => {
    expect(
      normalizeInternalInspectionDrawingReturnPath(
        '/kiosk/production-schedule/leader-order-board/../../admin'
      )
    ).toBe('/kiosk/admin');
  });
});

describe('isSafeInspectionDrawingReturnPath', () => {
  it('allowlist の pathname のみ true', () => {
    expect(isSafeInspectionDrawingReturnPath(LIBRARY_PATH, PRODUCTION_ALLOWED)).toBe(true);
  });

  it('外部 URL・プロトコル相対・正規化後の逸脱を拒否する', () => {
    expect(isSafeInspectionDrawingReturnPath('https://evil.example', PRODUCTION_ALLOWED)).toBe(false);
    expect(isSafeInspectionDrawingReturnPath('//evil.example/path', PRODUCTION_ALLOWED)).toBe(false);
    expect(isSafeInspectionDrawingReturnPath('/evil/unknown', PRODUCTION_ALLOWED)).toBe(false);
    expect(
      isSafeInspectionDrawingReturnPath(
        '/kiosk/production-schedule/leader-order-board/../../admin',
        PRODUCTION_ALLOWED
      )
    ).toBe(false);
    expect(
      isSafeInspectionDrawingReturnPath('/kiosk/production-schedule/leader-order-board', PRODUCTION_ALLOWED)
    ).toBe(false);
  });
});

describe('parseInspectionDrawingReturnFromLocation', () => {
  it('一覧導線の既定戻り先を返す', () => {
    expect(parseInspectionDrawingReturnFromLocation(null, PARSE_OPTIONS)).toEqual(FALLBACK);
    expect(parseInspectionDrawingReturnFromLocation(undefined, PARSE_OPTIONS)).toEqual(FALLBACK);
  });

  it('allowlist 外の state はフォールバックする', () => {
    expect(
      parseInspectionDrawingReturnFromLocation(
        {
          inspectionDrawingReturnTo: '/kiosk/production-schedule/leader-order-board',
          inspectionDrawingReturnLabel: '順位ボード'
        },
        PARSE_OPTIONS
      )
    ).toEqual(FALLBACK);
  });

  it('非文字列・不完全・危険な state はフォールバックする', () => {
    expect(
      parseInspectionDrawingReturnFromLocation(
        { inspectionDrawingReturnTo: 1, inspectionDrawingReturnLabel: 'x' },
        PARSE_OPTIONS
      )
    ).toEqual(FALLBACK);
    expect(parseInspectionDrawingReturnFromLocation({ inspectionDrawingReturnTo: '/x' }, PARSE_OPTIONS)).toEqual(
      FALLBACK
    );
    expect(
      parseInspectionDrawingReturnFromLocation(
        {
          inspectionDrawingReturnTo: 'https://evil',
          inspectionDrawingReturnLabel: '悪意'
        },
        PARSE_OPTIONS
      )
    ).toEqual(FALLBACK);
  });
});
