import { afterEach, describe, expect, it } from 'vitest';

import { resolveKioskDocumentPdfRenderOptions } from '../pdf-storage-render.adapter.js';

const originalDpi = process.env.KIOSK_DOCUMENT_PDF_DPI;
const originalQuality = process.env.KIOSK_DOCUMENT_JPEG_QUALITY;

afterEach(() => {
  if (originalDpi === undefined) delete process.env.KIOSK_DOCUMENT_PDF_DPI;
  else process.env.KIOSK_DOCUMENT_PDF_DPI = originalDpi;
  if (originalQuality === undefined) delete process.env.KIOSK_DOCUMENT_JPEG_QUALITY;
  else process.env.KIOSK_DOCUMENT_JPEG_QUALITY = originalQuality;
});

describe('resolveKioskDocumentPdfRenderOptions', () => {
  it('uses defaults when env unset', () => {
    delete process.env.KIOSK_DOCUMENT_PDF_DPI;
    delete process.env.KIOSK_DOCUMENT_JPEG_QUALITY;
    expect(resolveKioskDocumentPdfRenderOptions()).toEqual({ dpi: 180, quality: 88 });
  });

  it('respects valid env', () => {
    process.env.KIOSK_DOCUMENT_PDF_DPI = '96';
    process.env.KIOSK_DOCUMENT_JPEG_QUALITY = '70';
    expect(resolveKioskDocumentPdfRenderOptions()).toEqual({ dpi: 96, quality: 70 });
  });

  it('falls back on invalid env', () => {
    process.env.KIOSK_DOCUMENT_PDF_DPI = 'not-a-number';
    process.env.KIOSK_DOCUMENT_JPEG_QUALITY = '0';
    expect(resolveKioskDocumentPdfRenderOptions()).toEqual({ dpi: 180, quality: 88 });
  });
});
