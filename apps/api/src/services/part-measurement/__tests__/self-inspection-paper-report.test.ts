import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { SelfInspectionPaperQrCodec } from '../self-inspection-paper-qr-codec.js';
import { buildSelfInspectionPaperReportPagePlans } from '../self-inspection-paper-report-planner.js';

describe('SelfInspectionPaperQrCodec', () => {
  it('encodes a short versioned payload and rejects a bad check', () => {
    const codec = new SelfInspectionPaperQrCodec();
    const encoded = codec.encode('a7k4m2q9');

    expect(encoded).toMatch(/^SIP1:A7K4M2Q9:[A-F0-9]{2}$/);
    expect(codec.decode(encoded)).toMatchObject({
      ok: true,
      payload: { pageCode: 'A7K4M2Q9' }
    });
    const badCheck = encoded.endsWith('0') ? `${encoded.slice(0, -1)}1` : `${encoded.slice(0, -1)}0`;
    expect(codec.decode(badCheck)).toMatchObject({ ok: false });
  });
});

describe('buildSelfInspectionPaperReportPagePlans', () => {
  it('splits by five entry columns and fourteen measurement points', () => {
    const template = {
      selfInspectionMode: 'FULL' as const,
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      visualTemplate: { drawingImageRelativePath: '/api/storage/part-measurement-drawings/a.png' },
      items: Array.from({ length: 15 }, (_, index) => ({
        id: `item-${index}`,
        sortOrder: index,
        displayMarker: String(index + 1),
        markerXRatio: new Prisma.Decimal('0.1'),
        markerYRatio: new Prisma.Decimal('0.2'),
        lowerLimit: new Prisma.Decimal('1.0'),
        upperLimit: new Prisma.Decimal('2.0')
      }))
    };

    const pages = buildSelfInspectionPaperReportPagePlans(template, 6);

    expect(pages).toEqual([
      {
        pageNumber: 2,
        entryIndexFrom: 0,
        entryIndexTo: 4,
        markerNoFrom: 1,
        markerNoTo: 14
      },
      {
        pageNumber: 3,
        entryIndexFrom: 0,
        entryIndexTo: 4,
        markerNoFrom: 15,
        markerNoTo: 15
      },
      {
        pageNumber: 4,
        entryIndexFrom: 5,
        entryIndexTo: 5,
        markerNoFrom: 1,
        markerNoTo: 14
      },
      {
        pageNumber: 5,
        entryIndexFrom: 5,
        entryIndexTo: 5,
        markerNoFrom: 15,
        markerNoTo: 15
      }
    ]);
  });
});
