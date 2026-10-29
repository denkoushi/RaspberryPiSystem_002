import { describe, expect, it, vi } from 'vitest';

import { frameEvictions, SCAN_FRAME_POLICY, shouldSampleFrame, type ScanFrameRecord } from './scanFrameStore';

export const meta: ScanFrameRecord['meta'] = { outcome: 'decoded', decodedValue: '001', decodeMs: 100,
  retryCount: 0, engine: 'native', camera: {}, cropBox: null, capturedAt: '2026-10-29T00:00:00Z' };
const record = (id: string, kind: ScanFrameRecord['kind'], size = 1): ScanFrameRecord => ({
  id, kind, meta, fullJpeg: new Blob(['x'.repeat(size)]), createdAt: `2026-10-29T00:00:${id.padStart(2, '0')}Z`
});
describe('scan frame retention', () => {
  it('enforces 300 records, dropping scan frames before older placement photos', () => {
    const rows = Array.from({ length: 302 }, (_, index) => ({ ...record(String(index), index < 2 ? 'placement-photo' : 'scan-frame'), createdAt: new Date(index * 1000).toISOString() }));
    expect(frameEvictions(rows.reverse())).toEqual(['2', '3']);
  });
  it('counts full and crop bytes and only removes photos after all scan frames', () => {
    const rows = [record('1', 'placement-photo', 5), record('2', 'scan-frame', 1), { ...record('3', 'placement-photo', 4), cropJpeg: new Blob(['1234']) }];
    expect(frameEvictions(rows, { ...SCAN_FRAME_POLICY, maxBytes: 8 })).toEqual(['2', '1']);
  });
  it('keeps exact count and size boundaries and evicts oldest photos if necessary', () => {
    const rows = [record('2', 'placement-photo', 2), record('1', 'placement-photo', 2)];
    expect(frameEvictions(rows, { ...SCAN_FRAME_POLICY, maxRecords: 2, maxBytes: 4 })).toEqual([]);
    expect(frameEvictions(rows, { ...SCAN_FRAME_POLICY, maxRecords: 1 })).toEqual(['1']);
    expect(SCAN_FRAME_POLICY.maxBytes).toBe(60 * 1024 * 1024);
  });
});
describe('scan frame sampling', () => {
  it.each([{ outcome: 'timeout' as const }, { decodeMs: 1500 }, { retryCount: 15 }])('always retains threshold %j', (change) => {
    const random = vi.fn(() => 1);
    expect(shouldSampleFrame({ ...meta, ...change }, random)).toBe(true);
    expect(random).not.toHaveBeenCalled();
  });
  it('samples fast reads at 10 percent with strict threshold boundaries', () => {
    expect(shouldSampleFrame({ ...meta, decodeMs: 1499, retryCount: 14 }, () => 0.099)).toBe(true);
    expect(shouldSampleFrame(meta, () => 0.1)).toBe(false);
    expect(shouldSampleFrame(meta, () => 0.99)).toBe(false);
  });
});
