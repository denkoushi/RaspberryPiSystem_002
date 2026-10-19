import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../http';

import { sendBusinessHermesChat } from './assembly';

vi.mock('../http', () => ({
  api: { post: vi.fn() }
}));

const apiPost = vi.mocked(api.post);

describe('assembly Business Hermes API client', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ data: { status: 'unavailable' } } as never);
  });

  it('allows a chat route to wait up to 600s while preserving cancellation', async () => {
    const controller = new AbortController();
    const payload = { messages: [{ role: 'user' as const, content: '品番 PART-1 の不適合' }] };

    await expect(sendBusinessHermesChat(payload, controller.signal)).resolves.toEqual({ status: 'unavailable' });
    expect(apiPost).toHaveBeenCalledWith('/assembly/business-hermes/chat', payload, {
      signal: controller.signal,
      timeout: 600_000
    });
  });
});

describe('assembly region API overlays', () => {
  const bbox = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 };
  const overlays = [{ assetId: 'material', bbox, zIndex: 3, objectFit: 'cover' as const, opacity: 0.7 }];
  it('forwards current overlays to image and text region requests', async () => {
    const { createAssemblyProcedureImageRegion, findAssemblyProcedureTextCandidates } = await import('./assembly');
    apiPost.mockResolvedValue({ data: { asset: { assetId: 'crop' }, candidates: [] } } as never);
    const input = { id: 'draft', accessPassword: '1234', pageIndex: 0, bbox, overlays };
    await createAssemblyProcedureImageRegion({ ...input, holderToken: 'session' });
    expect(apiPost).toHaveBeenLastCalledWith('/assembly/procedure-documents/draft/regions/image', {
      accessPassword: '1234', pageIndex: 0, bbox, overlays
    }, expect.objectContaining({ headers: expect.objectContaining({ 'x-procedure-edit-token': 'session' }) }));
    await findAssemblyProcedureTextCandidates(input);
    expect(apiPost).toHaveBeenLastCalledWith('/assembly/procedure-documents/draft/regions/text', {
      accessPassword: '1234', pageIndex: 0, bbox, overlays
    });
  });
});
