import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  getDocument: vi.fn(),
  createRevision: vi.fn(),
  findTextCandidates: vi.fn(),
  createImageRegion: vi.fn(),
  uploadImage: vi.fn(),
  saveOverlays: vi.fn(),
  publishDocument: vi.fn(),
  discardRevision: vi.fn()
}));

vi.mock('../../../api/client', () => ({
  verifyAssemblyTemplateAccessPassword: apiMocks.verifyPassword,
  getAssemblyProcedureDocument: apiMocks.getDocument,
  createAssemblyProcedureDocumentRevision: apiMocks.createRevision,
  findAssemblyProcedureTextCandidates: apiMocks.findTextCandidates,
  createAssemblyProcedureImageRegion: apiMocks.createImageRegion,
  uploadAssemblyProcedureOverlayImage: apiMocks.uploadImage,
  saveAssemblyProcedureDocumentOverlays: apiMocks.saveOverlays,
  publishAssemblyProcedureDocument: apiMocks.publishDocument,
  discardAssemblyProcedureDocumentRevision: apiMocks.discardRevision
}));

import { useAssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';

import type { AssemblyProcedureDocumentDto } from '../types';

const range = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 };

function makeDocument(overrides: Partial<AssemblyProcedureDocumentDto> = {}): AssemblyProcedureDocumentDto {
  return {
    id: 'source-draft',
    name: '手順書',
    imageRelativePath: '/pages/1.png',
    status: 'draft',
    publishedAt: null,
    isActive: false,
    isRevisionHead: true,
    editVersion: 0,
    pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [] }],
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides
  };
}

async function authenticate(result: { current: ReturnType<typeof useAssemblyProcedureDocumentEditorController> }) {
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.setPasswordInput('1234'));
  await act(async () => {
    await result.current.verifyEditorPassword();
  });
  expect(result.current.accessGranted).toBe(true);
}

function renderEditor(document: AssemblyProcedureDocumentDto) {
  apiMocks.getDocument.mockResolvedValue(document);
  apiMocks.verifyPassword.mockResolvedValue({ success: true });
  apiMocks.createRevision.mockResolvedValue(document);
  return renderHook(() => useAssemblyProcedureDocumentEditorController({ documentId: document.id }));
}

describe('useAssemblyProcedureDocumentEditorController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('authenticates and uses create-or-get for a root draft, then handles text candidates and manual fallback', async () => {
    const source = makeDocument();
    const hook = renderEditor(source);
    await authenticate(hook.result);

    expect(apiMocks.createRevision).toHaveBeenCalledWith('source-draft', '1234');
    expect(hook.result.current.document?.id).toBe('source-draft');

    apiMocks.findTextCandidates.mockResolvedValueOnce([{
      text: '候補文章',
      confidence: 0.98,
      bounds: { ...range, xRatio: 0.2 },
      pageIndex: 0,
      source: 'coordinate-ocr'
    }]);
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => {
      await hook.result.current.createOverlay('TEXT');
    });
    expect(hook.result.current.textCandidates).toHaveLength(1);
    act(() => hook.result.current.chooseTextCandidate(hook.result.current.textCandidates[0]!));
    expect(hook.result.current.elements).toContainEqual(expect.objectContaining({ kind: 'TEXT', text: '候補文章' }));

    apiMocks.findTextCandidates.mockResolvedValueOnce([]);
    act(() => hook.result.current.handleRangeSelected({ ...range, yRatio: 0.5 }));
    await act(async () => {
      await hook.result.current.createOverlay('TEXT');
    });
    expect(hook.result.current.elements).toContainEqual(expect.objectContaining({ kind: 'TEXT', text: 'ここに文章を入力' }));
    expect(hook.result.current.elements.every((element) => element.kind !== 'TEXT' || element.mask?.color === '#ffffff')).toBe(true);
  });

  it('re-fetches candidates for the selected text without changing its edited bounds or duplicating it', async () => {
    const source = makeDocument();
    const hook = renderEditor(source);
    await authenticate(hook.result);

    const createdCandidate = {
      text: '初回候補',
      confidence: 0.98,
      bounds: { ...range, xRatio: 0.2 },
      pageIndex: 0,
      source: 'coordinate-ocr' as const
    };
    apiMocks.findTextCandidates.mockResolvedValueOnce([createdCandidate]);
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => {
      await hook.result.current.createOverlay('TEXT');
    });
    act(() => hook.result.current.chooseTextCandidate(createdCandidate));

    const selected = hook.result.current.selectedElement;
    expect(selected).toMatchObject({ kind: 'TEXT', text: '初回候補' });
    const editedBBox = { xRatio: 0.28, yRatio: 0.31, widthRatio: 0.42, heightRatio: 0.16 };
    act(() => hook.result.current.updateElementBBox(selected!.id, editedBBox));
    act(() => hook.result.current.updateElement({
      ...hook.result.current.selectedElement!,
      kind: 'TEXT',
      text: '手修正済み'
    }));
    expect(apiMocks.findTextCandidates).toHaveBeenCalledTimes(1);

    const refetchedCandidate = {
      text: '再取得候補',
      confidence: 0.91,
      bounds: { ...editedBBox, xRatio: 0.05, widthRatio: 0.2 },
      pageIndex: 0,
      source: 'coordinate-ocr' as const
    };
    apiMocks.findTextCandidates.mockResolvedValueOnce([refetchedCandidate]);
    await act(async () => {
      await hook.result.current.refetchTextCandidates();
    });
    expect(apiMocks.findTextCandidates).toHaveBeenCalledTimes(2);
    expect(apiMocks.findTextCandidates).toHaveBeenLastCalledWith({
      id: 'source-draft',
      accessPassword: '1234',
      pageIndex: 0,
      bbox: editedBBox
    });
    expect(hook.result.current.textCandidates).toHaveLength(1);

    act(() => hook.result.current.chooseTextCandidate(refetchedCandidate));
    expect(hook.result.current.elements).toHaveLength(1);
    expect(hook.result.current.selectedElement).toMatchObject({
      id: selected!.id,
      kind: 'TEXT',
      text: '再取得候補',
      bbox: editedBBox
    });

    const manualText = hook.result.current.selectedElement!.kind === 'TEXT'
      ? hook.result.current.selectedElement.text
      : '';
    apiMocks.findTextCandidates.mockResolvedValueOnce([refetchedCandidate]);
    await act(async () => {
      await hook.result.current.refetchTextCandidates();
    });
    act(() => hook.result.current.chooseTextCandidate(null));
    expect(hook.result.current.selectedElement).toMatchObject({ text: manualText, bbox: editedBBox });

    apiMocks.findTextCandidates.mockResolvedValueOnce([refetchedCandidate]);
    await act(async () => {
      await hook.result.current.refetchTextCandidates();
    });
    act(() => hook.result.current.cancelTextCandidates());
    expect(hook.result.current.selectedElement).toMatchObject({ text: manualText, bbox: editedBBox });
    expect(hook.result.current.elements).toHaveLength(1);
  });

  it('creates an image from an ROI and replaces its asset through upload', async () => {
    const source = makeDocument();
    const hook = renderEditor(source);
    await authenticate(hook.result);
    const roiAsset = {
      assetId: 'roi-png',
      storageKey: 'assembly/roi-png',
      contentType: 'image/png',
      byteSize: 20,
      relativeUrl: '/assets/roi-png'
    };
    const uploadAsset = { ...roiAsset, assetId: 'upload-webp', contentType: 'image/webp', relativeUrl: '/assets/upload-webp' };
    apiMocks.createImageRegion.mockResolvedValue(roiAsset);
    apiMocks.uploadImage.mockResolvedValue(uploadAsset);

    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => {
      await hook.result.current.createOverlay('IMAGE');
    });
    expect(apiMocks.createImageRegion).toHaveBeenCalledWith({ id: 'source-draft', accessPassword: '1234', pageIndex: 0, bbox: range });
    expect(hook.result.current.selectedElement).toMatchObject({ kind: 'IMAGE', assetId: 'roi-png', mask: { enabled: true, color: '#ffffff' } });

    const file = new File(['image'], 'manual.webp', { type: 'image/webp' });
    await act(async () => {
      await hook.result.current.uploadImage(file);
    });
    expect(apiMocks.uploadImage).toHaveBeenCalledWith({ id: 'source-draft', accessPassword: '1234', file });
    expect(hook.result.current.selectedElement).toMatchObject({ kind: 'IMAGE', assetId: 'upload-webp' });
    expect(hook.result.current.document?.assets?.['upload-webp']).toMatchObject({ contentType: 'image/webp' });
  });

  it('saves, publishes, and discards through the explicit revision APIs', async () => {
    const source = makeDocument();
    const hook = renderEditor(source);
    await authenticate(hook.result);
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => {
      await hook.result.current.createOverlay('SHAPE');
    });
    const saved = makeDocument({ editVersion: 1, pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: hook.result.current.elements }] });
    apiMocks.saveOverlays.mockResolvedValue(saved);
    await act(async () => {
      await hook.result.current.save();
    });
    expect(apiMocks.saveOverlays).toHaveBeenCalledWith(expect.objectContaining({ id: 'source-draft', expectedEditVersion: 0 }));
    expect(hook.result.current.isDirty).toBe(false);

    const published = makeDocument({ status: 'published', isActive: true, isRevisionHead: true, publishedAt: '2026-08-21T00:02:00.000Z', editVersion: 2 });
    apiMocks.publishDocument.mockResolvedValue(published);
    await act(async () => {
      await hook.result.current.publish();
    });
    expect(apiMocks.publishDocument).toHaveBeenCalledWith({ id: 'source-draft', accessPassword: '1234', expectedEditVersion: 1 });

    const revision = makeDocument({ id: 'revision-1', revisionRootId: 'source-draft', supersedesDocumentId: 'source-draft' });
    const revisionHook = renderEditor(revision);
    await authenticate(revisionHook.result);
    expect(revisionHook.result.current.canDiscard).toBe(true);
    apiMocks.discardRevision.mockResolvedValue(makeDocument({ id: 'source-draft' }));
    await act(async () => {
      await revisionHook.result.current.discard();
    });
    expect(apiMocks.discardRevision).toHaveBeenCalledWith({ id: 'revision-1', accessPassword: '1234', expectedEditVersion: 0 });
  });

  it('retains local elements on 409 and offers explicit re-save or latest reload', async () => {
    const source = makeDocument();
    const hook = renderEditor(source);
    await authenticate(hook.result);
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => {
      await hook.result.current.createOverlay('SHAPE');
    });
    const localElements = hook.result.current.elements;
    apiMocks.saveOverlays.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { details: { currentEditVersion: 5 } } }
    });
    await act(async () => {
      await hook.result.current.save();
    });
    expect(hook.result.current.conflict).toBe(true);
    expect(hook.result.current.conflictEditVersion).toBe(5);
    expect(hook.result.current.elements).toEqual(localElements);
    await waitFor(() => expect(window.localStorage.getItem('kiosk-assembly-procedure-document-editor:source-draft')).toContain('source-draft'), { timeout: 2_000 });

    const saved = makeDocument({ editVersion: 6, pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: localElements }] });
    apiMocks.saveOverlays.mockResolvedValueOnce(saved);
    await act(async () => {
      await hook.result.current.retryConflictSave();
    });
    expect(apiMocks.saveOverlays).toHaveBeenLastCalledWith(expect.objectContaining({ expectedEditVersion: 5, elements: localElements }));
    expect(hook.result.current.conflict).toBe(false);

    act(() => hook.result.current.handleRangeSelected({ ...range, xRatio: 0.5 }));
    await act(async () => {
      await hook.result.current.createOverlay('SHAPE');
    });
    apiMocks.saveOverlays.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { details: { currentEditVersion: 7 } } }
    });
    await act(async () => {
      await hook.result.current.save();
    });
    apiMocks.getDocument.mockResolvedValueOnce(makeDocument({ editVersion: 7, pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [] }] }));
    await act(async () => {
      await hook.result.current.reloadConflict();
    });
    expect(hook.result.current.conflict).toBe(false);
    expect(hook.result.current.elements).toEqual([]);
  });
});
