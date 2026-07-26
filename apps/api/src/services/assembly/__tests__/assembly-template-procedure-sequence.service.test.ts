import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import {
  collectTemplateProcedureDocumentKeys,
  normalizeAssemblyTemplateProcedureItems
} from '../assembly-template-procedure-sequence.service.js';

const PRIMARY_ID = '11111111-1111-4111-8111-111111111111';
const SECONDARY_ID = '22222222-2222-4222-8222-222222222222';
const KIOSK_ID = '33333333-3333-4333-8333-333333333333';

describe('assembly template procedure sequence normalization', () => {
  it('normalizes labels and preserves legacy duplicate occurrences', () => {
    const result = normalizeAssemblyTemplateProcedureItems(PRIMARY_ID, [
      { assemblyProcedureDocumentId: PRIMARY_ID, label: ' 主工程 ' },
      { kioskDocumentId: KIOSK_ID },
      { assemblyProcedureDocumentId: PRIMARY_ID, label: '再確認' }
    ]);

    expect(result).toEqual([
      {
        kioskDocumentId: null,
        assemblyProcedureDocumentId: PRIMARY_ID,
        label: '主工程'
      },
      {
        kioskDocumentId: KIOSK_ID,
        assemblyProcedureDocumentId: null,
        label: null
      },
      {
        kioskDocumentId: null,
        assemblyProcedureDocumentId: PRIMARY_ID,
        label: '再確認'
      }
    ]);
    expect(collectTemplateProcedureDocumentKeys(result)).toEqual(
      new Set([
        `assembly_procedure_document:${PRIMARY_ID}`,
        `kiosk_document:${KIOSK_ID}`
      ])
    );
  });

  it.each([
    {
      name: 'empty',
      items: []
    },
    {
      name: 'both references',
      items: [
        {
          kioskDocumentId: KIOSK_ID,
          assemblyProcedureDocumentId: PRIMARY_ID
        }
      ]
    },
    {
      name: 'no assembly document',
      items: [{ kioskDocumentId: KIOSK_ID }]
    },
    {
      name: 'primary mismatch',
      items: [
        { assemblyProcedureDocumentId: SECONDARY_ID },
        { assemblyProcedureDocumentId: PRIMARY_ID }
      ]
    }
  ])('rejects $name', ({ items }) => {
    expect(() => normalizeAssemblyTemplateProcedureItems(PRIMARY_ID, items)).toThrow(ApiError);
  });

  it('rejects more than 50 documents', () => {
    const items = Array.from({ length: 51 }, () => ({
      assemblyProcedureDocumentId: PRIMARY_ID
    }));
    expect(() => normalizeAssemblyTemplateProcedureItems(PRIMARY_ID, items)).toThrow(
      '1件以上50件以下'
    );
  });
});
