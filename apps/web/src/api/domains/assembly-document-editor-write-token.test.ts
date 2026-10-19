import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../http', () => ({ api: mocks }));

import {
  addBlankAssemblyProcedurePage,
  approvePublishAssemblyProcedureDocument,
  createAssemblyProcedureImageRegion,
  deleteAssemblyProcedureDocument,
  discardAssemblyProcedureDocumentRevision,
  placeProcedureMaterial,
  publishAssemblyProcedureDocument,
  renameAssemblyProcedureDocument,
  replaceProcedurePageVideos,
  saveAssemblyProcedureDocumentOverlays,
  uploadAssemblyProcedureOverlayImage
} from './assembly';

const input = { id: 'document', accessPassword: 'pw', expectedEditVersion: 0, holderToken: 'session-token' };
beforeEach(() => {
  vi.clearAllMocks();
  for (const request of Object.values(mocks)) request.mockResolvedValue({ data: { document: {}, asset: {}, videos: [] } });
});

const mutations = {
  overlays: () => saveAssemblyProcedureDocumentOverlays({ ...input, elements: [] }),
  blankPage: () => addBlankAssemblyProcedurePage(input),
  placement: () => placeProcedureMaterial({ ...input, materialId: 'material', pageIndex: 0 }),
  publish: () => publishAssemblyProcedureDocument(input),
  approvePublish: () => approvePublishAssemblyProcedureDocument({ id: input.id, expectedEditVersion: 0, reviewerTagUid: 'tag', holderToken: input.holderToken }),
  discard: () => discardAssemblyProcedureDocumentRevision(input),
  upload: () => uploadAssemblyProcedureOverlayImage({ ...input, file: new File(['image'], 'image.png', { type: 'image/png' }) }),
  imageRegion: () => createAssemblyProcedureImageRegion({ ...input, pageIndex: 0, bbox: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 } }),
  videos: () => replaceProcedurePageVideos(input.id, 0, [], input.accessPassword, input.holderToken),
  rename: () => renameAssemblyProcedureDocument(input.id, '変更後', input.holderToken),
  delete: () => deleteAssemblyProcedureDocument(input.id, input.holderToken)
};

describe('document editor mutation tokens', () => {
  it.each(Object.entries(mutations))('sends the edit session token in the header for %s', async (_name, mutate) => {
    await mutate();
    const calls = Object.values(mocks).flatMap((request) => request.mock.calls);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.at(-1)).toMatchObject({ headers: { 'x-procedure-edit-token': input.holderToken } });
    // The strict API body schemas continue receiving only their declared fields.
    if (typeof call[1] === 'object' && !(call[1] instanceof FormData)) expect(call[1]).not.toHaveProperty('holderToken');
  });
  it('sends optional caption ids in the overlay save body and omits them for old callers', async () => {
    await saveAssemblyProcedureDocumentOverlays({ ...input, elements: [], appliedCaptionElementIds: ['caption'] });
    expect(mocks.put).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ appliedCaptionElementIds: ['caption'] }), expect.any(Object));
    await saveAssemblyProcedureDocumentOverlays({ ...input, elements: [] });
    expect(mocks.put.mock.calls.at(-1)?.[1]).not.toHaveProperty('appliedCaptionElementIds');
  });

});
