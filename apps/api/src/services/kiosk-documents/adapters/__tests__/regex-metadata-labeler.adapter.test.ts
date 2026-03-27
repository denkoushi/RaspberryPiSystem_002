import { describe, expect, it } from 'vitest';

import { RegexMetadataLabelerAdapter } from '../regex-metadata-labeler.adapter.js';

describe('RegexMetadataLabelerAdapter', () => {
  const adapter = new RegexMetadataLabelerAdapter();

  it('extracts candidates from text', async () => {
    const text = '図面番号 A-1234 文書番号 産1-G025AAK FHINCD ZX98 研削 資源CD:RC10 目的: 試験手順';
    const result = await adapter.labelFromText(text);

    expect(result.candidates.fhincd).toBeDefined();
    expect(result.candidates.drawingNumber).toBe('A-1234');
    expect(result.candidates.processName).toBe('研削');
    expect(result.candidates.resourceCd).toBe('RC10');
    expect(result.candidates.documentNumber).toBe('産1-G025AAK');
    expect(result.summaryCandidates?.[0]).toBeTruthy();
  });
});
