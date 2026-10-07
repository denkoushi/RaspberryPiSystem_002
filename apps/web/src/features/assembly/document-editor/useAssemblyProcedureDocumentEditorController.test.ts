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
  discardRevision: vi.fn(),
  addBlankPage: vi.fn(),
  placeMaterial: vi.fn()
}));

const leaseMocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
vi.mock('../../../api/domains/assembly-edit-lease', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/domains/assembly-edit-lease')>(),
  acquireAssemblyProcedureDocumentEditLease: leaseMocks.acquire,
  releaseAssemblyProcedureDocumentEditLease: leaseMocks.release
}));

vi.mock('../../../api/client', () => ({
  addBlankAssemblyProcedurePage: apiMocks.addBlankPage,
  placeProcedureMaterial: apiMocks.placeMaterial,
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

import { clearProcedureEditorAccess, readProcedureEditorAccess, saveProcedureEditorAccess } from '../procedureEditorAccess';

import { readAssemblyDocumentEditorRecovery } from './assemblyDocumentEditorRecovery';
import { useAssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';

import type { AssemblyProcedureDocumentDto } from '../types';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

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
    vi.resetAllMocks();
    leaseMocks.acquire.mockResolvedValue({ mine: true, holderToken: 'session-token', lease: { holderLabel: '自分の端末', acquiredAt: '2026-10-06T03:00:00Z', heartbeatAt: '2026-10-06T03:00:00Z' } });
    leaseMocks.release.mockResolvedValue(undefined);
    window.localStorage.clear(); clearProcedureEditorAccess();
  });

  it('uses valid entrance access without asking or verifying again', async () => {
    saveProcedureEditorAccess('2520');
    const doc = makeDocument(); apiMocks.getDocument.mockResolvedValue(doc); apiMocks.createRevision.mockResolvedValue(doc);
    const { result } = renderHook(() => useAssemblyProcedureDocumentEditorController({ documentId: doc.id }));
    await waitFor(() => expect(result.current.accessGranted).toBe(true));
    expect(result.current.passwordInput).toBe('2520');
    expect(apiMocks.verifyPassword).not.toHaveBeenCalled();
    expect(apiMocks.createRevision).toHaveBeenCalledWith(doc.id, '2520');
  });
  it('falls back to the gate and clears stored access when revision authentication fails', async () => {
    saveProcedureEditorAccess('2520');
    apiMocks.getDocument.mockResolvedValue(makeDocument()); apiMocks.createRevision.mockRejectedValue(new Error('認証失敗'));
    const { result } = renderHook(() => useAssemblyProcedureDocumentEditorController({ documentId: 'source-draft' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accessGranted).toBe(false); expect(result.current.passwordInput).toBe('');
    expect(readProcedureEditorAccess()).toBeNull();
  });
  it.each([401, 403])('revokes entrance access on an authenticated save returning %s', async status => {
    saveProcedureEditorAccess('2520');
    const doc = makeDocument(); apiMocks.getDocument.mockResolvedValue(doc); apiMocks.createRevision.mockResolvedValue(doc);
    const { result } = renderHook(() => useAssemblyProcedureDocumentEditorController({ documentId: doc.id }));
    await waitFor(() => expect(result.current.accessGranted).toBe(true));
    await waitFor(() => expect(result.current.readOnly).toBe(false));
    act(() => result.current.addOverlay('TEXT'));
    apiMocks.saveOverlays.mockRejectedValue({ isAxiosError: true, response: { status, data: { message: '組立テンプレート編集パスワードが違います' } } });
    await act(async () => { await result.current.save(); });
    expect(result.current.accessGranted).toBe(false); expect(result.current.passwordInput).toBe('');
    expect(readProcedureEditorAccess()).toBeNull();
  });
  it('returns to the gate when the eight-hour deadline arrives', async () => {
    vi.useFakeTimers();
    try {
      saveProcedureEditorAccess('2520');
      const doc = makeDocument(); apiMocks.getDocument.mockResolvedValue(doc); apiMocks.createRevision.mockResolvedValue(doc);
      const { result } = renderHook(() => useAssemblyProcedureDocumentEditorController({ documentId: doc.id }));
      await act(async () => {});
      expect(result.current.accessGranted).toBe(true);
      await act(async () => { vi.advanceTimersByTime(8 * 60 * 60 * 1000); });
      expect(result.current.accessGranted).toBe(false);
      expect(readProcedureEditorAccess()).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('saves the last edit immediately before expiry and retains it and the navigation guard after reauthentication', async () => {
    vi.useFakeTimers();
    try {
      saveProcedureEditorAccess('2520');
      const hook = renderEditor(makeDocument());
      await act(async () => {});
      expect(hook.result.current.readOnly).toBe(false);
      act(() => vi.advanceTimersByTime(8 * 3600000 - 100));
      act(() => hook.result.current.addOverlay('TEXT'));
      const element = hook.result.current.elements[0];
      act(() => hook.result.current.updateElement({ ...element, kind: 'TEXT', text: '失効直前の編集' }));
      act(() => vi.advanceTimersByTime(100));
      expect(hook.result.current.accessGranted).toBe(false);
      expect(readAssemblyDocumentEditorRecovery(localStorage, 'source-draft', { baseUpdatedAt: makeDocument().updatedAt, editVersion: 0 })?.elements).toEqual(hook.result.current.elements);
      const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      expect(hook.result.current.confirmNavigation()).toBe(false);
      expect(confirm).toHaveBeenCalled(); confirm.mockRestore();
      act(() => hook.result.current.setPasswordInput('2520'));
      await act(async () => { await hook.result.current.verifyEditorPassword(); });
      expect(hook.result.current.accessGranted).toBe(true);
      expect(hook.result.current.elements[0]).toMatchObject({ text: '失効直前の編集' });
      expect(hook.result.current.isDirty).toBe(true);
      expect(hook.result.current.conflict).toBe(false);
      expect(hook.result.current.recoveryPending).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('keeps edits after reauthentication and enters conflict handling only when the server version changed', async () => {
    const hook = renderEditor(makeDocument()); await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    act(() => hook.result.current.addOverlay('TEXT'));
    const localElements = hook.result.current.elements;
    act(() => { hook.result.current.onEditLeaseError({ isAxiosError: true, response: { status: 401 } }); });
    apiMocks.createRevision.mockResolvedValue(makeDocument({ editVersion: 2 }));
    act(() => hook.result.current.setPasswordInput('2520'));
    await act(async () => { await hook.result.current.verifyEditorPassword(); });
    expect(hook.result.current.elements).toEqual(localElements);
    expect(hook.result.current.conflict).toBe(true);
    expect(hook.result.current.conflictEditVersion).toBe(2);
  });
  it('groups a long drag into one undo operation without recording intermediate positions', async () => {
    const hook = renderEditor(makeDocument()); await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    act(() => hook.result.current.addOverlay('SHAPE'));
    const initial = hook.result.current.elements;
    act(() => hook.result.current.beginOverlayDrag());
    for (let index = 1; index <= 100; index++) {
      act(() => hook.result.current.updateElementBBox(initial[0].id, { ...initial[0].bbox, xRatio: 0.25 + index / 1000 }));
    }
    act(() => hook.result.current.endOverlayDrag());
    const dragged = hook.result.current.elements;
    act(() => hook.result.current.undo()); expect(hook.result.current.elements).toEqual(initial);
    act(() => hook.result.current.redo()); expect(hook.result.current.elements).toEqual(dragged);
    act(() => hook.result.current.undo()); act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([]); expect(hook.result.current.canUndo).toBe(false);
  });
  it('drops the oldest history entry after 51 operations', async () => {
    const hook = renderEditor(makeDocument()); await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    for (let index = 0; index < 51; index++) act(() => hook.result.current.addOverlay('SHAPE'));
    for (let index = 0; index < 50; index++) act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toHaveLength(1);
    expect(hook.result.current.canUndo).toBe(false);
  });
  it('retains history on save and clears it on conflict reload even for identical content', async () => {
    const hook = renderEditor(makeDocument()); await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    act(() => hook.result.current.addOverlay('SHAPE'));
    const saved = makeDocument({ editVersion: 1, pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: hook.result.current.elements }] });
    apiMocks.saveOverlays.mockResolvedValue(saved);
    await act(async () => { await hook.result.current.save(); });
    expect(hook.result.current.canUndo).toBe(true);
    act(() => hook.result.current.undo()); expect(hook.result.current.isDirty).toBe(true);
    act(() => hook.result.current.redo()); expect(hook.result.current.isDirty).toBe(false);
    apiMocks.getDocument.mockResolvedValue(saved);
    await act(async () => { await hook.result.current.reloadConflict(); });
    expect(hook.result.current.elements).toEqual(saved.pages[0].overlays);
    expect(hook.result.current.canUndo).toBe(false); expect(hook.result.current.canRedo).toBe(false);
  });
  it('creates text and shape, duplicates and restores overlay edits with undo/redo', async () => {
    const doc = makeDocument(); const { result } = renderEditor(doc);
    await authenticate(result); await waitFor(() => expect(result.current.readOnly).toBe(false));
    act(() => result.current.addOverlay('TEXT'));
    expect(result.current.selectedElement?.kind).toBe('TEXT');
    act(() => result.current.duplicateSelectedOverlay()); expect(result.current.elements).toHaveLength(2);
    act(() => result.current.undo()); expect(result.current.elements).toHaveLength(1);
    act(() => result.current.redo()); expect(result.current.elements).toHaveLength(2);
    act(() => result.current.addOverlay('SHAPE')); expect(result.current.selectedElement?.kind).toBe('SHAPE');
    act(() => result.current.undo());
    act(() => result.current.addOverlay('TEXT')); expect(result.current.canRedo).toBe(false);
  });

  it('appends a blank page and retains unsaved overlays while advancing editVersion', async () => {
    const document = makeDocument({ assets: { pending: { assetId: 'pending', relativeUrl: '/pending.png', storageKey: 'pending', sha256: 'a', byteSize: 3, contentType: 'image/png', kind: 'OVERLAY_IMAGE' } } });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => { await hook.result.current.createOverlay('SHAPE'); });
    const draft = hook.result.current.elements;
    apiMocks.addBlankPage.mockResolvedValue({ ...document, assets: {}, editVersion: 1, pages: [...document.pages, { pageIndex: 3, imageRelativePath: '/pages/blank.png', overlays: [] }] });
    await act(async () => { await hook.result.current.addBlankPage(); });
    expect(apiMocks.addBlankPage).toHaveBeenCalledWith({ id: document.id, holderToken: 'session-token', accessPassword: '1234', expectedEditVersion: 0 });
    expect(hook.result.current.selectedPageIndex).toBe(3);
    expect(hook.result.current.elements).toEqual(draft);
    expect(hook.result.current.document?.editVersion).toBe(1);
    expect(hook.result.current.document?.assets?.pending).toMatchObject({ assetId: 'pending' });
    expect(hook.result.current.isDirty).toBe(true);
  });

  it.each([
    ['not found', { isAxiosError: true, response: { status: 404 } }],
    ['server error', { isAxiosError: true, response: { status: 503 } }],
    ['network error', new Error('offline')]
  ])('allows edits and saves without a token when lease acquisition fails with %s', async (_label, error) => {
    leaseMocks.acquire.mockRejectedValueOnce(error);
    const document = makeDocument();
    const hook = renderEditor(document);
    await authenticate(hook.result);
    expect(hook.result.current.readOnly).toBe(false);
    expect(hook.result.current.editLeaseUnavailable).toBe(true);
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => hook.result.current.createOverlay('SHAPE'));
    expect(hook.result.current.elements).toHaveLength(1);
    apiMocks.saveOverlays.mockResolvedValue({ ...document, editVersion: 1 });
    await act(async () => hook.result.current.save());
    expect(apiMocks.saveOverlays).toHaveBeenCalledWith(expect.objectContaining({ id: document.id, expectedEditVersion: 0 }));
    expect(apiMocks.saveOverlays.mock.calls[0]?.[0]).not.toHaveProperty('holderToken');
    hook.unmount();
  });

  it('retains unsaved content locally and becomes read-only when another holder takes over', async () => {
    vi.useFakeTimers();
    const source = makeDocument();
    const hook = renderEditor(source);
    await act(async () => undefined);
    expect(hook.result.current.loading).toBe(false);
    act(() => hook.result.current.setPasswordInput('1234'));
    await act(async () => hook.result.current.verifyEditorPassword());
    expect(hook.result.current.accessGranted).toBe(true);
    try {
      act(() => hook.result.current.handleRangeSelected(range));
      await act(async () => hook.result.current.createOverlay('SHAPE'));
      const draft = hook.result.current.elements;
      leaseMocks.acquire.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: {
        code: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED', lease: { holderLabel: '隣の端末', acquiredAt: '2026-10-06T03:00:00Z', heartbeatAt: '2026-10-06T03:01:00Z' }
      } } });
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(hook.result.current.readOnly).toBe(true);
      expect(hook.result.current.message).toBe('隣の端末に引き継がれました。未保存の内容は端末に保持しています');
      expect(hook.result.current.elements).toEqual(draft);
      expect(readAssemblyDocumentEditorRecovery(window.localStorage, source.id)?.elements).toEqual(draft);
      await act(async () => hook.result.current.save());
      expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
      await act(async () => hook.result.current.takeoverEditLease());
      expect(hook.result.current.readOnly).toBe(false);
      expect(leaseMocks.acquire).toHaveBeenLastCalledWith(source.id, true, 'session-token');
    } finally {
      hook.unmount();
      vi.useRealTimers();
    }
  });

  it('handles an edit lock returned by a save separately from version conflict', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => hook.result.current.createOverlay('SHAPE'));
    apiMocks.saveOverlays.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: {
      code: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED', lease: { holderLabel: '別端末', acquiredAt: '2026-10-06T03:00:00Z', heartbeatAt: '2026-10-06T03:01:00Z' }
    } } });
    await act(async () => hook.result.current.save());
    expect(hook.result.current.readOnly).toBe(true);
    expect(hook.result.current.conflict).toBe(false);
    expect(hook.result.current.message).toContain('別端末に引き継がれました');
    hook.unmount();
  });

  it('adds a material IMAGE draft, selects it and keeps it after unsaved elements in z-order', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => { await hook.result.current.createOverlay('SHAPE'); });
    const element = { id: 'placed-overlay', kind: 'IMAGE', assetId: 'asset', pageIndex: 0, zIndex: 0, bbox: range, objectFit: 'contain' };
    apiMocks.placeMaterial.mockResolvedValue({ element, asset: { assetId: 'asset', relativeUrl: '/asset.png' } });
    await act(async () => { await hook.result.current.placeMaterial({ id: 'material' }); });
    expect(apiMocks.placeMaterial).toHaveBeenCalledWith({ holderToken: 'session-token', id: 'source-draft', materialId: 'material', pageIndex: 0, accessPassword: '1234' });
    expect(hook.result.current.selectedOverlayId).toBe('placed-overlay');
    expect(hook.result.current.elements[1]).toMatchObject({ ...element, zIndex: 1 });
    expect(hook.result.current.document?.assets?.asset).toMatchObject({ assetId: 'asset' });
    expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
  });
  it('replaces only the selected image asset, preserves all other properties and supports undo/redo', async () => {
    const image: AssemblyProcedureOverlayElement = {
      id: 'selected-image', kind: 'IMAGE', assetId: 'old-asset', pageIndex: 0,
      bbox: range, zIndex: 7, opacity: 0.6, objectFit: 'cover',
      mask: { enabled: true, color: '#eeeeee' }
    };
    const other: AssemblyProcedureOverlayElement = { ...image, id: 'other-image', zIndex: 6 };
    const oldAsset = { assetId: 'old-asset', relativeUrl: '/old.png', storageKey: 'old', sha256: 'a', byteSize: 3, contentType: 'image/png', kind: 'OVERLAY_IMAGE' as const };
    const asset = { ...oldAsset, assetId: 'new-asset', relativeUrl: '/new.png', storageKey: 'new' };
    const hook = renderEditor(makeDocument({
      assets: { [oldAsset.assetId]: oldAsset },
      pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [image, other] }]
    }));
    await authenticate(hook.result);
    act(() => hook.result.current.setSelectedOverlayId(image.id));
    apiMocks.placeMaterial.mockResolvedValue({ element: { ...image, id: 'unused-new-overlay', bbox: { ...range, widthRatio: 0.8 } }, asset });

    await act(async () => { await hook.result.current.replaceSelectedImageMaterial({ id: 'material-photo', kind: 'PHOTO' }); });

    expect(apiMocks.placeMaterial).toHaveBeenCalledWith({ holderToken: 'session-token', id: 'source-draft', materialId: 'material-photo', pageIndex: 0, accessPassword: '1234' });
    expect(hook.result.current.elements).toEqual([{ ...image, assetId: asset.assetId }, other]);
    expect(hook.result.current.selectedElement?.bbox).toEqual(range);
    expect(hook.result.current.selectedOverlayId).toBe(image.id);
    expect(hook.result.current.document?.assets).toEqual({ [oldAsset.assetId]: oldAsset, [asset.assetId]: asset });
    expect(hook.result.current.message).toBe('画像を差し替えました。保存してください。');
    expect(hook.result.current.isDirty).toBe(true);
    expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([image, other]);
    act(() => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([{ ...image, assetId: asset.assetId }, other]);
  });

  it.each(['TEXT', 'SHAPE', null] as const)('does not call the material API when the selected kind is %s', async (kind) => {
    const element: AssemblyProcedureOverlayElement = kind === 'SHAPE'
      ? { id: 'selected', kind, shape: 'RECTANGLE', pageIndex: 0, bbox: range, zIndex: 0 }
      : { id: 'selected', kind: 'TEXT', text: '手順', pageIndex: 0, bbox: range, zIndex: 0 };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [element] }] }));
    await authenticate(hook.result);
    if (kind) act(() => hook.result.current.setSelectedOverlayId(element.id));
    await act(async () => {
      await expect(hook.result.current.replaceSelectedImageMaterial({ id: 'material', kind: 'PHOTO' })).rejects.toThrow('現在は画像を差し替えできません');
    });
    expect(apiMocks.placeMaterial).not.toHaveBeenCalled();
    expect(hook.result.current.elements).toEqual([element]);
    expect(hook.result.current.canUndo).toBe(false);
  });

  it('rejects text materials before calling the material API', async () => {
    const image: AssemblyProcedureOverlayElement = { id: 'image', kind: 'IMAGE', assetId: 'old', pageIndex: 0, bbox: range, zIndex: 0 };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [image] }] }));
    await authenticate(hook.result);
    act(() => hook.result.current.setSelectedOverlayId(image.id));
    await act(async () => {
      await expect(hook.result.current.replaceSelectedImageMaterial({ id: 'text-material', kind: 'TEXT' })).rejects.toThrow('画像の素材を選んでください。');
    });
    expect(apiMocks.placeMaterial).not.toHaveBeenCalled();
    expect(hook.result.current.elements).toEqual([image]);
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.busy).toBe(false);
  });

  it('rejects image replacement in read-only mode', async () => {
    const image: AssemblyProcedureOverlayElement = { id: 'image', kind: 'IMAGE', assetId: 'old', pageIndex: 0, bbox: range, zIndex: 0 };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [image] }] }));
    await authenticate(hook.result);
    act(() => hook.result.current.setSelectedOverlayId(image.id));
    act(() => { hook.result.current.onEditLeaseError({ isAxiosError: true, response: { status: 401 } }); });
    expect(hook.result.current.readOnly).toBe(true);
    expect(hook.result.current.selectedElement).toEqual(image);
    await act(async () => {
      await expect(hook.result.current.replaceSelectedImageMaterial({ id: 'photo', kind: 'PHOTO' })).rejects.toThrow('現在は画像を差し替えできません');
    });
    expect(apiMocks.placeMaterial).not.toHaveBeenCalled();
    expect(hook.result.current.elements).toEqual([image]);
    expect(hook.result.current.canUndo).toBe(false);
  });

  it('rejects another replacement while an image replacement is busy', async () => {
    const image: AssemblyProcedureOverlayElement = { id: 'image', kind: 'IMAGE', assetId: 'old', pageIndex: 0, bbox: range, zIndex: 0 };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [image] }] }));
    await authenticate(hook.result);
    act(() => hook.result.current.setSelectedOverlayId(image.id));
    const asset = { assetId: 'new', relativeUrl: '/new.png' };
    let finish: () => void = () => undefined;
    apiMocks.placeMaterial.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ element: image, asset }); }));
    let replacement: Promise<void>;
    act(() => { replacement = hook.result.current.replaceSelectedImageMaterial({ id: 'first', kind: 'PHOTO' }); });
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      await expect(hook.result.current.replaceSelectedImageMaterial({ id: 'second', kind: 'PHOTO' })).rejects.toThrow('現在は画像を差し替えできません');
    });
    expect(apiMocks.placeMaterial).toHaveBeenCalledOnce();
    expect(hook.result.current.elements).toEqual([image]);
    await act(async () => { finish(); await replacement; });
    expect(hook.result.current.busy).toBe(false);
  });

  it('does not change the selected image when a photo response has no image asset', async () => {
    const image: AssemblyProcedureOverlayElement = { id: 'image', kind: 'IMAGE', assetId: 'old', pageIndex: 0, bbox: range, zIndex: 0 };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [image] }] }));
    await authenticate(hook.result);
    act(() => hook.result.current.setSelectedOverlayId(image.id));
    apiMocks.placeMaterial.mockResolvedValue({ element: { id: 'text', kind: 'TEXT', text: '手順', pageIndex: 0, bbox: range, zIndex: 0 } });
    await act(async () => {
      await expect(hook.result.current.replaceSelectedImageMaterial({ id: 'photo-material', kind: 'PHOTO' })).rejects.toThrow('画像素材を選択してください。');
    });
    expect(hook.result.current.elements).toEqual([image]);
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.busy).toBe(false);
  });

  it('appends sequential shelf selections to the draft with distinct assets and increasing z-order', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const place = hook.result.current.placeMaterial;
    const first = { id: 'first-overlay', kind: 'IMAGE', assetId: 'first', pageIndex: 0, zIndex: 0, bbox: range, objectFit: 'contain' };
    const second = { ...first, id: 'second-overlay', assetId: 'second' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: first, asset: { assetId: 'first', relativeUrl: '/first.png' } })
      .mockResolvedValueOnce({ element: second, asset: { assetId: 'second', relativeUrl: '/second.png' } });
    await act(async () => { await place({ id: 'first' }); await place({ id: 'second' }); });
    expect(apiMocks.placeMaterial.mock.calls.map(([params]) => params.materialId)).toEqual(['first', 'second']);
    expect(hook.result.current.elements).toEqual([expect.objectContaining({ id: 'first-overlay', zIndex: 0 }), expect.objectContaining({ id: 'second-overlay', zIndex: 1 })]);
    expect(hook.result.current.document?.assets).toMatchObject({ first: { assetId: 'first' }, second: { assetId: 'second' } });
    expect(hook.result.current.isDirty).toBe(true);
    expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
  });
  it('updates recovery to the new version immediately after adding a blank page', async () => {
    const document = makeDocument();
    const hook = renderEditor(document);
    await authenticate(hook.result);
    vi.useFakeTimers();
    let draft;
    const next = { ...document, editVersion: 1, updatedAt: '2026-10-05T00:00:00.000Z', pages: [...document.pages, { pageIndex: 1, imageRelativePath: '/blank.png', overlays: [] }] };
    try {
      act(() => hook.result.current.handleRangeSelected(range));
      await act(async () => { await hook.result.current.createOverlay('SHAPE'); });
      draft = hook.result.current.elements;
      act(() => vi.advanceTimersByTime(750));
      expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)?.editVersion).toBe(0);
      apiMocks.addBlankPage.mockResolvedValue(next);
      await act(async () => { await hook.result.current.addBlankPage(); });
      // No debounce timer has run since the API response.
      expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id, { baseUpdatedAt: next.updatedAt, editVersion: 1 })).toMatchObject({ elements: draft });
      expect(hook.result.current.recoveryPending).toBeNull();
    } finally {
      hook.unmount();
      vi.useRealTimers();
    }
    const reloaded = renderEditor(next);
    await authenticate(reloaded.result);
    expect(reloaded.result.current.recoveryPending?.editVersion).toBe(1);
    act(() => reloaded.result.current.restoreRecovery());
    expect(reloaded.result.current.elements).toEqual(draft);
    reloaded.unmount();
  });

  it('restores an unsaved placed PHOTO after reload with a display URL from the document lease', async () => {
    const document = makeDocument();
    const asset = { assetId: 'photo-asset', storageKey: 'assembly-procedure-assets/photo.png', contentType: 'image/png', byteSize: 42, url: '/api/storage/assembly-procedure-assets/photo.png' };
    const element = { id: 'placed-photo', kind: 'IMAGE', assetId: asset.assetId, pageIndex: 0, zIndex: 0, bbox: range, objectFit: 'contain' };
    const hook = renderEditor(document);
    await authenticate(hook.result);
    vi.useFakeTimers();
    try {
      apiMocks.placeMaterial.mockResolvedValue({ element, asset });
      await act(async () => { await hook.result.current.placeMaterial({ id: 'material-photo' }); });
      act(() => vi.advanceTimersByTime(750));
      expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
      vi.useRealTimers();
    }
    // The API returns no persisted overlay, but includes the ownerDocumentId lease.
    const reloaded = renderEditor({ ...document, assets: { [asset.assetId]: asset } });
    await authenticate(reloaded.result);
    expect(reloaded.result.current.elements).toEqual([]);
    expect(reloaded.result.current.recoveryPending?.elements).toContainEqual(expect.objectContaining({ id: element.id }));
    act(() => reloaded.result.current.restoreRecovery());
    const restored = reloaded.result.current.elements[0];
    expect(restored).toMatchObject(element);
    expect(restored?.kind === 'IMAGE' && reloaded.result.current.document?.assets?.[restored.assetId]?.url).toBe(asset.url);
    expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
    reloaded.unmount();
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

  it('sends intersecting images from the current unsaved draft in z order for both region kinds', async () => {
    const image: AssemblyProcedureOverlayElement = { id: 'low', kind: 'IMAGE', assetId: 'low-asset', pageIndex: 0, bbox: range, zIndex: 1, objectFit: 'cover', opacity: 0.5 };
    const high: AssemblyProcedureOverlayElement = { ...image, id: 'high', assetId: 'high-asset', zIndex: 5 };
    const outside: AssemblyProcedureOverlayElement = { ...image, id: 'outside', bbox: { ...range, xRatio: 0.6 } };
    const boundary: AssemblyProcedureOverlayElement = { ...image, id: 'boundary', bbox: { ...range, yRatio: 0.4 } };
    const otherPage: AssemblyProcedureOverlayElement = { ...image, id: 'page-1', pageIndex: 1 };
    const shape: AssemblyProcedureOverlayElement = { id: 'shape', kind: 'SHAPE', shape: 'RECTANGLE', pageIndex: 0, bbox: range, zIndex: 3 };
    const hook = renderEditor(makeDocument({ pages: [
      { pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [high, outside, boundary, shape, image] },
      { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [otherPage] }
    ] }));
    await authenticate(hook.result);
    const edited = { ...image, assetId: 'unsaved-asset', bbox: { ...range, widthRatio: 0.2 } };
    act(() => hook.result.current.updateElement(edited));
    apiMocks.findTextCandidates.mockResolvedValue([{ text: '素材文章', confidence: 0.9, bounds: range, pageIndex: 0, source: 'ocr' }]);
    const overlays = [edited, high].map(({ assetId, bbox, zIndex, objectFit, opacity }) => ({ assetId, bbox, zIndex, objectFit, opacity }));
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => hook.result.current.createOverlay('TEXT'));
    expect(apiMocks.findTextCandidates).toHaveBeenLastCalledWith({ id: 'source-draft', accessPassword: '1234', pageIndex: 0, bbox: range, overlays });
    act(() => hook.result.current.cancelTextCandidates());
    apiMocks.createImageRegion.mockResolvedValue({ assetId: 'cropped', relativeUrl: '/crop.jpg', contentType: 'image/jpeg' });
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => hook.result.current.createOverlay('IMAGE'));
    expect(apiMocks.createImageRegion).toHaveBeenLastCalledWith({ holderToken: 'session-token', id: 'source-draft', accessPassword: '1234', pageIndex: 0, bbox: range, overlays });
    expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
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
    expect(apiMocks.createImageRegion).toHaveBeenCalledWith({ holderToken: 'session-token', id: 'source-draft', accessPassword: '1234', pageIndex: 0, bbox: range });
    expect(hook.result.current.selectedElement).toMatchObject({ kind: 'IMAGE', assetId: 'roi-png', mask: { enabled: true, color: '#ffffff' } });

    const file = new File(['image'], 'manual.webp', { type: 'image/webp' });
    await act(async () => {
      await hook.result.current.uploadImage(file);
    });
    expect(apiMocks.uploadImage).toHaveBeenCalledWith({ holderToken: 'session-token', id: 'source-draft', accessPassword: '1234', file });
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
    expect(apiMocks.publishDocument).toHaveBeenCalledWith({ holderToken: 'session-token', id: 'source-draft', accessPassword: '1234', expectedEditVersion: 1 });

    const revision = makeDocument({ id: 'revision-1', revisionRootId: 'source-draft', supersedesDocumentId: 'source-draft' });
    const revisionHook = renderEditor(revision);
    await authenticate(revisionHook.result);
    expect(revisionHook.result.current.canDiscard).toBe(true);
    apiMocks.discardRevision.mockResolvedValue(makeDocument({ id: 'source-draft' }));
    await act(async () => {
      await revisionHook.result.current.discard();
    });
    expect(apiMocks.discardRevision).toHaveBeenCalledWith({ id: 'revision-1', holderToken: 'session-token', accessPassword: '1234', expectedEditVersion: 0 });
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
