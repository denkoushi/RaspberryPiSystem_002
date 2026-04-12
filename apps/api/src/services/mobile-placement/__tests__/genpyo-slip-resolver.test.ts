import { describe, expect, it } from 'vitest';

import { resolveGenpyoSlipFromRegionTexts } from '../genpyo-slip/genpyo-slip-resolver.js';

describe('resolveGenpyoSlipFromRegionTexts', () => {
  it('prefers manufacturing order from moHeader over moFooter', () => {
    const r = resolveGenpyoSlipFromRegionTexts({
      moHeader: '製造オーダNo 0002178005',
      fseibanMain: '製番 BE1N9321',
      moFooter: '製造オーダ番号 0002178000'
    });
    expect(r.manufacturingOrder10).toBe('0002178005');
    expect(r.fseiban).toBe('BE1N9321');
    expect(r.moResolvedFromRoi).toBe('moHeader');
  });

  it('falls back to moFooter when header has no MO', () => {
    const r = resolveGenpyoSlipFromRegionTexts({
      moHeader: '注文番号 0003507502',
      fseibanMain: '製番 XX1N9321',
      moFooter: '製造オーダ番号 0002178000'
    });
    expect(r.manufacturingOrder10).toBe('0002178000');
    expect(r.moResolvedFromRoi).toBe('moFooter');
  });

  it('falls back FSEIBAN from header/footer when main ROI misses it', () => {
    const r = resolveGenpyoSlipFromRegionTexts({
      moHeader: '製造オーダNo 0002178005 / 製番 BE1N9321',
      fseibanMain: 'ノイズ',
      moFooter: ''
    });
    expect(r.manufacturingOrder10).toBe('0002178005');
    expect(r.fseiban).toBe('BE1N9321');
  });
});
