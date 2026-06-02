import { describe, expect, it } from 'vitest';

import {
  inspectionDrawingBlobFetchPath,
  inspectionDrawingCanvasImageUrl,
  inspectionDrawingHasImageSource
} from './inspectionDrawingTemplateImageDisplay';

describe('inspectionDrawingTemplateImageDisplay', () => {
  const serverPath = '/api/storage/part-measurement-drawings/x.png';
  const localBlob = 'blob:http://localhost/abc';
  const serverBlob = 'blob:http://localhost/def';

  describe('inspectionDrawingBlobFetchPath', () => {
    it('returns server path when no local file is selected', () => {
      expect(inspectionDrawingBlobFetchPath(serverPath, false)).toBe(serverPath);
    });

    it('returns null when local file is selected (skip authorized fetch)', () => {
      expect(inspectionDrawingBlobFetchPath(serverPath, true)).toBeNull();
    });

    it('returns null for empty server path', () => {
      expect(inspectionDrawingBlobFetchPath('  ', false)).toBeNull();
    });
  });

  describe('inspectionDrawingCanvasImageUrl', () => {
    it('prefers local preview over server blob', () => {
      expect(inspectionDrawingCanvasImageUrl(localBlob, serverBlob)).toBe(localBlob);
    });

    it('uses server blob when no local preview', () => {
      expect(inspectionDrawingCanvasImageUrl(null, serverBlob)).toBe(serverBlob);
    });

    it('returns null when neither is available', () => {
      expect(inspectionDrawingCanvasImageUrl(null, null)).toBeNull();
    });
  });

  describe('inspectionDrawingHasImageSource', () => {
    it('is true with server path even before blob resolves', () => {
      expect(inspectionDrawingHasImageSource(null, serverPath)).toBe(true);
    });

    it('is true with local preview only', () => {
      expect(inspectionDrawingHasImageSource(localBlob, null)).toBe(true);
    });

    it('is false with no source', () => {
      expect(inspectionDrawingHasImageSource(null, null)).toBe(false);
    });

    it('is true while pdf preview is resolving', () => {
      expect(inspectionDrawingHasImageSource(null, null, true)).toBe(true);
    });
  });
});
