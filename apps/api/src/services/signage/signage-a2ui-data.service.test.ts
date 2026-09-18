import { describe, expect, it, vi } from 'vitest';
import { SignageA2uiDataService } from './signage-a2ui-data.service.js';
import { parseSignageA2uiProposal, type SignageA2uiProposal } from './signage-a2ui.js';

const source = { kind: 'self_inspection' as const, id: 'schedule-row' };
const proposal: SignageA2uiProposal = {
  layoutMessage: { version: 'v0.9', updateComponents: { surfaceId: 'signage', components: [
    { id: 'root', component: 'Text', text: { path: '/quality/latest' }, variant: 'h1' },
  ] } },
  dataMessage: { version: 'v0.9', updateDataModel: { surfaceId: 'signage', path: '/', value: { quality: { latest: 'invented by model' } } } },
  bindings: [{ path: '/quality/latest', source, select: '/entries/0/value', format: 'text' }],
};

describe('live A2UI source bindings', () => {
  it('reads each frame from the same reference, overwrites invented values and preserves the definition', async () => {
    const service = new SignageA2uiDataService();
    const read = vi.spyOn(service, 'readSource').mockResolvedValueOnce({ entries: [{ value: '1.00' }] })
      .mockResolvedValueOnce({ entries: [{ value: '2.00' }] });
    const original = structuredClone(proposal);
    expect(await service.resolve(proposal)).toMatchObject({ dataMessage: { updateDataModel: { value: { quality: { latest: '1.00' } } } } });
    expect(await service.resolve(proposal)).toMatchObject({ dataMessage: { updateDataModel: { value: { quality: { latest: '2.00' } } } } });
    expect(read).toHaveBeenNthCalledWith(2, source, true);
    expect(proposal).toEqual(original);
  });

  it('fails a missing live value instead of delivering the model or previous value as current', async () => {
    const service = new SignageA2uiDataService();
    vi.spyOn(service, 'readSource').mockResolvedValue({ entries: [] });
    await expect(service.resolve(proposal)).rejects.toThrow('未取得');
  });

  it('rejects overlapping destinations, prototype selectors and non-public image sources', () => {
    expect(parseSignageA2uiProposal({ ...proposal, bindings: [...proposal.bindings!, ...proposal.bindings!] })).toBeUndefined();
    expect(parseSignageA2uiProposal({ ...proposal, bindings: [{ ...proposal.bindings![0], select: '/__proto__/value' }] })).toBeUndefined();
    expect(parseSignageA2uiProposal({ ...proposal, bindings: [{ ...proposal.bindings![0], format: 'image' }] })).toBeUndefined();
  });
});
