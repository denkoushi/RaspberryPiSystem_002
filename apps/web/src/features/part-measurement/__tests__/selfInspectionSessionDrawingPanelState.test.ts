import { describe, expect, it } from 'vitest';

import {
  resolveSelfInspectionDrawingPanelPhase,
  selfInspectionDrawingZoomEnabled
} from '../selfInspectionSessionDrawingPanelState';

describe('resolveSelfInspectionDrawingPanelPhase', () => {
  it('drawingPath なしは missing', () => {
    expect(
      resolveSelfInspectionDrawingPanelPhase({
        drawingPath: null,
        blobUrl: null,
        loadError: null
      })
    ).toBe('missing');
  });

  it('drawingPath あり・blob 未取得・エラーなしは loading', () => {
    expect(
      resolveSelfInspectionDrawingPanelPhase({
        drawingPath: '/api/storage/part-measurement-drawings/a.jpg',
        blobUrl: null,
        loadError: null
      })
    ).toBe('loading');
  });

  it('drawingPath あり・blob ありは canvas', () => {
    expect(
      resolveSelfInspectionDrawingPanelPhase({
        drawingPath: '/api/storage/part-measurement-drawings/a.jpg',
        blobUrl: 'blob:mock',
        loadError: null
      })
    ).toBe('canvas');
  });

  it('drawingPath あり・loadError ありは error（blob の有無より優先）', () => {
    expect(
      resolveSelfInspectionDrawingPanelPhase({
        drawingPath: '/api/storage/part-measurement-drawings/a.jpg',
        blobUrl: 'blob:mock',
        loadError: '図面の読み込みに失敗しました'
      })
    ).toBe('error');
  });
});

describe('selfInspectionDrawingZoomEnabled', () => {
  it('blobUrl があるときのみ true', () => {
    expect(selfInspectionDrawingZoomEnabled('blob:x')).toBe(true);
    expect(selfInspectionDrawingZoomEnabled(null)).toBe(false);
    expect(selfInspectionDrawingZoomEnabled('')).toBe(false);
  });
});
