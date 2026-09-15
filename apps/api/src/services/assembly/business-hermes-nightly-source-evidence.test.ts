import { describe, expect, it, vi } from 'vitest';
import { NightlySourceEvidence } from './business-hermes-nightly-source-evidence.js';
import { sourceFingerprint } from './business-hermes-source-identity.js';
import { sourceDocument } from './business-hermes-source-adapters.js';

describe('Batch-owned source evidence', () => {
  const record = { kind: 'nonconformity', id: 'n1', nonconformityNo: '20260001',
    partNumber: 'MD001', condition: '傷', disposition: '設計確認', provenance: { activeLatest: true } };
  const ref = { kind: record.kind, id: record.id };
  it('reuses complete evidence without a second database read or changing its fingerprint', async () => {
    const evidence = new NightlySourceEvidence();
    evidence.add(record);
    const reader = { call: vi.fn() };
    const actual = await evidence.read(ref, reader, new AbortController().signal);
    expect(actual).toEqual({ content: [{ type: 'text', text: JSON.stringify(record) }] });
    expect(sourceFingerprint(actual)).toBe(sourceFingerprint({ content: [{ type: 'text', text: JSON.stringify(record) }] }));
    expect(reader.call).not.toHaveBeenCalled();
  });
  it('checks missing references through the visibility-aware reader and propagates cancellation', async () => {
    const evidence = new NightlySourceEvidence();
    const missing = { content: [{ type: 'text' as const, text: '{"result":null}' }] };
    const reader = { call: vi.fn().mockResolvedValue(missing) };
    expect(await evidence.read(ref, reader, new AbortController().signal)).toEqual(missing);
    expect(reader.call).toHaveBeenCalledWith('business_hermes_get_detail', ref);
    reader.call.mockClear();
    const abort = new AbortController(); abort.abort();
    await expect(evidence.read(ref, reader, abort.signal)).rejects.toThrow();
    expect(reader.call).not.toHaveBeenCalled();
  });
  it('rejects duplicate identities caused by shifting pagination', () => {
    const evidence = new NightlySourceEvidence(); evidence.add(record);
    expect(() => evidence.add({ ...record, disposition: '修正' })).toThrow('pagination');
  });
  it('detects evidence-only changes while retaining the same searchable text', () => {
    const before = sourceDocument(record);
    const after = sourceDocument({ ...record, disposition: '処置完了' });
    expect(after.text).toBe(before.text);
    expect(after.revision).not.toBe(before.revision);
    expect(sourceDocument({ ...record }).revision).toBe(before.revision);
  });
});
