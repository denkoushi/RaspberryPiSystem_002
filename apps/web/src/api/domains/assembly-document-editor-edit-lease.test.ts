import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn(), headers: {} as Record<string, string>, key: vi.fn(() => 'terminal-key') }));
vi.mock('../http', () => ({
  api: { post: mocks.post, defaults: { headers: { common: mocks.headers } } },
  apiBase: '/api/',
  getResolvedClientKey: mocks.key
}));

import {
  acquireAssemblyProcedureDocumentEditLease,
  readAssemblyProcedureDocumentEditLock,
  releaseAssemblyProcedureDocumentEditLease
} from './assembly-edit-lease';

describe('document editor lease API', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete mocks.headers.Authorization; });

  it('posts the takeover flag to the document lease endpoint', async () => {
    const data = { mine: true, lease: { holderLabel: '端末' } };
    mocks.post.mockResolvedValue({ data });
    expect(await acquireAssemblyProcedureDocumentEditLease('doc/id', true)).toEqual(data);
    expect(mocks.post).toHaveBeenCalledWith('/assembly/procedure-documents/doc%2Fid/edit-lease', { takeover: true }, { headers: {} });
  });

  it('releases using keepalive and the same user and terminal authentication', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    mocks.headers.Authorization = 'Bearer test-user';
    await releaseAssemblyProcedureDocumentEditLease('document-1', 'session-token');
    expect(fetch).toHaveBeenCalledWith('/api/assembly/procedure-documents/document-1/edit-lease', {
      method: 'DELETE', keepalive: true, headers: { 'x-client-key': 'terminal-key', 'x-procedure-edit-token': 'session-token', Authorization: 'Bearer test-user' }
    });
  });

  it('sends the session token on heartbeat and recognizes transaction conflicts', async () => {
    mocks.post.mockResolvedValue({ data: { holderToken: 'session-token', mine: true } });
    await acquireAssemblyProcedureDocumentEditLease('doc', false, 'session-token');
    expect(mocks.post).toHaveBeenCalledWith('/assembly/procedure-documents/doc/edit-lease', { takeover: false }, { headers: { 'x-procedure-edit-token': 'session-token' } });
    const lease = { holderLabel: '他の端末', acquiredAt: 'now', heartbeatAt: 'now' };
    expect(readAssemblyProcedureDocumentEditLock({ isAxiosError: true, response: { status: 409, data: { errorCode: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED', details: { lease } } } })).toEqual(lease);
  });

  it('recognizes only the edit-lock code and preserves the holder details', () => {
    const lease = { holderLabel: '端末', acquiredAt: '2026-10-06T03:00:00Z', heartbeatAt: '2026-10-06T03:01:00Z' };
    expect(readAssemblyProcedureDocumentEditLock({ isAxiosError: true, response: { status: 409, data: { code: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED', lease } } })).toEqual(lease);
    expect(readAssemblyProcedureDocumentEditLock({ isAxiosError: true, response: { status: 409, data: { code: 'VERSION_CONFLICT', lease } } })).toBeNull();
  });
});
