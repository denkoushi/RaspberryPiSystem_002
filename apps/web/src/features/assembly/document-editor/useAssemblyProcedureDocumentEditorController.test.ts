import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  getDocument: vi.fn(),
  createRevision: vi.fn(),
  findTextCandidates: vi.fn(),
  createImageRegion: vi.fn(),
  createTextRewriteRegion: vi.fn(),
  uploadImage: vi.fn(),
  saveOverlays: vi.fn(),
  publishDocument: vi.fn(),
  addBlankPage: vi.fn(),
  importPages: vi.fn(),
  deletePage: vi.fn(),
  suggestLayout: vi.fn(),
  placeMaterial: vi.fn(),
  unplaceMaterial: vi.fn()
}));

const leaseMocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
vi.mock('../../../api/domains/assembly-edit-lease', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/domains/assembly-edit-lease')>(),
  acquireAssemblyProcedureDocumentEditLease: leaseMocks.acquire,
  releaseAssemblyProcedureDocumentEditLease: leaseMocks.release
}));

vi.mock('../../../api/client', () => ({
  addBlankAssemblyProcedurePage: apiMocks.addBlankPage,
  importAssemblyProcedurePages: apiMocks.importPages,
  deleteAssemblyProcedurePage: apiMocks.deletePage,
  suggestAssemblyProcedureLayout: apiMocks.suggestLayout,
  placeProcedureMaterial: apiMocks.placeMaterial,
  unplaceProcedureMaterial: apiMocks.unplaceMaterial,
  verifyAssemblyTemplateAccessPassword: apiMocks.verifyPassword,
  getAssemblyProcedureDocument: apiMocks.getDocument,
  createAssemblyProcedureDocumentRevision: apiMocks.createRevision,
  findAssemblyProcedureTextCandidates: apiMocks.findTextCandidates,
  createAssemblyProcedureImageRegion: apiMocks.createImageRegion,
  createAssemblyProcedureTextRewriteRegion: apiMocks.createTextRewriteRegion,
  uploadAssemblyProcedureOverlayImage: apiMocks.uploadImage,
  saveAssemblyProcedureDocumentOverlays: apiMocks.saveOverlays,
  publishAssemblyProcedureDocument: apiMocks.publishDocument,
}));

import { api, getResolvedClientKey } from '../../../api/http';
import { clearProcedureEditorAccess, readProcedureEditorAccess, saveProcedureEditorAccess } from '../procedureEditorAccess';

import { createOverlayForRange } from './assemblyDocumentEditorDraft';
import { readAssemblyDocumentEditorRecovery, writeAssemblyDocumentEditorRecovery } from './assemblyDocumentEditorRecovery';
import { AssemblyProcedureDocumentEditorCanvas } from './AssemblyProcedureDocumentEditorCanvas';
import { AssemblyProcedureOverlayTypeDialog } from './AssemblyProcedureOverlayTypeDialog';
import { useAssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';

import type { AssemblyProcedureDocumentDto } from '../types';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

vi.mock('../AssemblyProcedureCanvas', () => ({ AssemblyProcedureCanvas: ({ overlay }: { overlay: ReactNode }) => createElement('div', null, overlay) }));

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
  await act(async () => {
    await result.current.verifyEditorPassword('1234');
  });
  expect(result.current.accessGranted).toBe(true);
}

function renderEditor(document: AssemblyProcedureDocumentDto, onNavigateBack?: () => void) {
  apiMocks.getDocument.mockResolvedValue(document);
  apiMocks.verifyPassword.mockResolvedValue({ success: true });
  apiMocks.createRevision.mockResolvedValue(document);
  return renderHook(() => useAssemblyProcedureDocumentEditorController({ documentId: document.id, onNavigateBack }));
}

describe('useAssemblyProcedureDocumentEditorController', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
    apiMocks.unplaceMaterial.mockResolvedValue(undefined);
    leaseMocks.acquire.mockResolvedValue({ mine: true, holderToken: 'session-token', lease: { holderLabel: '自分の端末', acquiredAt: '2026-10-06T03:00:00Z', heartbeatAt: '2026-10-06T03:00:00Z' } });
    leaseMocks.release.mockResolvedValue(undefined);
    window.localStorage.clear(); clearProcedureEditorAccess();
  });

  it('rebases unsaved edits, undo, redo and recovery while keeping imported overlays on the next save', async () => {
    const saved = { ...createOverlayForRange('TEXT', 1, range), id: 'saved', text: '保存済み' };
    const imported = { ...createOverlayForRange('TEXT', 2, range), id: 'imported', text: 'コピー元の部品' };
    const document = makeDocument({ pages: [
      { pageIndex: 0, imageRelativePath: '/first.png' },
      { pageIndex: 1, imageRelativePath: '/second.png', overlays: [saved] }
    ] });
    const next = { ...document, editVersion: 1, updatedAt: '2026-08-22T00:00:00.000Z', pages: [
      document.pages[0],
      { pageIndex: 1, imageRelativePath: '/source-2.png' },
      { pageIndex: 2, imageRelativePath: '/source-0.png', overlays: [imported] },
      { ...document.pages[1], pageIndex: 3, overlays: [{ ...saved, pageIndex: 3 }] }
    ] };
    const hook = renderEditor(document);
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.editLeaseMine).toBe(true));
    act(() => hook.result.current.updateElement({ ...saved, text: '未保存' }));
    act(() => hook.result.current.updateElement({ ...saved, text: 'やり直す編集' }));
    await act(async () => hook.result.current.undo());
    apiMocks.importPages.mockResolvedValue(next);
    await act(async () => expect(await hook.result.current.importPages('other-document', [2, 0], 0)).toBe(true));
    expect(apiMocks.importPages).toHaveBeenCalledWith({
      id: document.id, expectedEditVersion: 0, accessPassword: '1234', holderToken: 'session-token',
      sourceDocumentId: 'other-document', sourcePageIndexes: [2, 0], afterPageIndex: 0
    });
    expect(hook.result.current.selectedPageIndex).toBe(1);
    expect(hook.result.current.message).toBe('2ページを入れました。');
    const expected = [{ ...saved, pageIndex: 3, text: '未保存' }, imported];
    expect(hook.result.current.elements).toEqual(expected);
    expect(hook.result.current.isDirty).toBe(true);
    expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)).toMatchObject({
      editVersion: 1, baseUpdatedAt: next.updatedAt, elements: expected
    });
    await act(async () => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([{ ...saved, pageIndex: 3 }, imported]);
    expect(hook.result.current.isDirty).toBe(false);
    await act(async () => hook.result.current.redo());
    await act(async () => hook.result.current.redo());
    apiMocks.saveOverlays.mockResolvedValue({ ...next, editVersion: 2 });
    await act(async () => hook.result.current.save());
    expect(apiMocks.saveOverlays).toHaveBeenCalledWith(expect.objectContaining({
      expectedEditVersion: 1, elements: [{ ...saved, pageIndex: 3, text: 'やり直す編集' }, imported]
    }));
  });

  it('updates an offered recovery copy on prepending pages', async () => {
    const document = makeDocument();
    const unsaved = { ...createOverlayForRange('TEXT', 0, range), text: '復元する文' };
    const imported = { ...createOverlayForRange('TEXT', 0, range), text: '取り込んだ文' };
    writeAssemblyDocumentEditorRecovery(window.localStorage, {
      version: 1, documentId: document.id, baseUpdatedAt: document.updatedAt,
      editVersion: 0, savedAt: document.updatedAt, elements: [unsaved]
    });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.recoveryPending).not.toBeNull());
    apiMocks.importPages.mockResolvedValue({ ...document, editVersion: 1, updatedAt: '2026-08-22T00:00:00.000Z', pages: [
      { pageIndex: 0, imageRelativePath: '/source.png', overlays: [imported] },
      { ...document.pages[0], pageIndex: 1 }
    ] });
    await act(async () => hook.result.current.importPages('other-document', [0], -1));
    expect(hook.result.current.isDirty).toBe(false);
    const elements = [{ ...unsaved, pageIndex: 1 }, imported];
    expect(hook.result.current.recoveryPending).toMatchObject({ editVersion: 1, elements });
    expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)).toMatchObject({ editVersion: 1, elements });
    act(() => hook.result.current.restoreRecovery());
    expect(hook.result.current.elements).toEqual(elements);
  });

  it.each(['overlay', 'page'])('deletes an imported material %s without unplacing the source material', async kind => {
    const document = makeDocument();
    // The source material's saved IMAGE is copied with a new element ID and the same asset ID.
    const image = { id: 'copied-element', pageIndex: 1, zIndex: 0, bbox: range, kind: 'IMAGE' as const, assetId: 'source-material-asset', objectFit: 'contain' as const };
    const asset = { assetId: image.assetId, storageKey: 'material.png', contentType: 'image/png', byteSize: 1 };
    const hook = renderEditor(document);
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.editLeaseMine).toBe(true));
    apiMocks.importPages.mockResolvedValue({ ...document, editVersion: 1, assets: { [asset.assetId]: asset }, pages: [
      ...document.pages, { pageIndex: 1, imageRelativePath: '/source.png', overlays: [image] }
    ] });
    await act(async () => hook.result.current.importPages('other-document', [0], 0));
    expect(hook.result.current.document?.assets?.[asset.assetId]).toEqual(asset);
    expect(hook.result.current.isDirty).toBe(false);
    expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)).toBeNull();
    if (kind === 'overlay') {
      act(() => hook.result.current.setSelectedOverlayId(image.id));
      act(() => hook.result.current.deleteSelectedOverlay());
      apiMocks.saveOverlays.mockResolvedValue({ ...hook.result.current.document, editVersion: 2, pages: [
        ...document.pages, { pageIndex: 1, imageRelativePath: '/source.png', overlays: [] }
      ] });
      await act(async () => hook.result.current.save());
      expect(apiMocks.saveOverlays).toHaveBeenCalledWith(expect.objectContaining({ elements: [] }));
    } else {
      apiMocks.deletePage.mockResolvedValue({ ...document, editVersion: 2 });
      await act(async () => hook.result.current.deletePage(1));
    }
    expect(hook.result.current.elements).toEqual([]);
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])('deletes page %i while retaining drafts, baselines, history, assets and recovery for surviving pages', async pageIndex => {
    const overlays = [0, 1, 2].map(index => ({ ...createOverlayForRange('TEXT', index, range), id: `text-${index}`, text: `saved-${index}` }));
    const document = makeDocument({ pages: overlays.map((element, index) => ({ pageIndex: index, imageRelativePath: `/pages/${index}.png`, overlays: [element] })), assets: { draft: { assetId: 'draft', storageKey: 'draft.png', contentType: 'image/png', byteSize: 1 } } });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.editLeaseMine).toBe(true));
    act(() => {
      hook.result.current.updateElement({ ...overlays[0], text: 'first draft' });
      hook.result.current.updateElement({ ...overlays[2], text: 'last draft' });
    });
    act(() => hook.result.current.undo());
    act(() => { hook.result.current.setSelectedPageIndex(pageIndex); hook.result.current.setSelectedOverlayId(overlays[pageIndex].id); hook.result.current.beginOverlayDrag(); });
    const next = { ...document, editVersion: 1, assets: {}, pages: document.pages.filter(page => page.pageIndex !== pageIndex).map((page, index) => ({ ...page, pageIndex: index })) };
    apiMocks.deletePage.mockResolvedValue(next);
    await act(async () => { await hook.result.current.deletePage(pageIndex); });
    expect(apiMocks.deletePage).toHaveBeenCalledWith({ id: document.id, pageIndex, accessPassword: '1234', holderToken: 'session-token', expectedEditVersion: 0 });
    expect(hook.result.current.document?.editVersion).toBe(1);
    expect(hook.result.current.document?.assets?.draft).toBeDefined();
    expect(hook.result.current.selectedPageIndex).toBe(Math.min(pageIndex, 1));
    expect(hook.result.current.selectedOverlayId).toBeNull();
    expect(hook.result.current.message).toBe(`${pageIndex + 1}ページ目を削除しました`);
    const expected = overlays.filter(element => element.pageIndex !== pageIndex).map((element, index) => ({ ...element, pageIndex: index, text: element.id === 'text-0' ? 'first draft' : element.text }));
    expect(hook.result.current.elements).toEqual(expected);
    expect(hook.result.current.isDirty).toBe(pageIndex !== 0);
    const stored = readAssemblyDocumentEditorRecovery(window.localStorage, document.id)!;
    expect(stored).toMatchObject({ editVersion: 1, elements: expected });
    act(() => { hook.result.current.endOverlayDrag(); hook.result.current.redo(); });
    expect(hook.result.current.elements.some(element => element.id === overlays[pageIndex].id)).toBe(false);
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements.some(element => element.id === overlays[pageIndex].id)).toBe(false);
    expect(hook.result.current.elements.map(element => element.pageIndex)).toEqual([0, 1]);
  });

  it('does not create recovery data when deleting a page without unsaved edits', async () => {
    const document = makeDocument({ pages: [0, 1].map(pageIndex => ({ pageIndex, imageRelativePath: `/${pageIndex}.png`, overlays: [] })) });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    expect(hook.result.current.isDirty).toBe(false);
    apiMocks.deletePage.mockResolvedValue({ ...document, editVersion: 1, pages: [document.pages[0]] });
    await act(async () => hook.result.current.deletePage(1));
    expect(readAssemblyDocumentEditorRecovery(localStorage, document.id)).toBeNull();
    expect(hook.result.current.recoveryPending).toBeNull();
  });

  it.each([0, 1])('preserves split material history and placement after deleting page %i and undoing', async pageIndex => {
    const text = { ...createOverlayForRange('TEXT', 0, range), id: 'text' };
    const image = { ...createOverlayForRange('IMAGE', 0, range), id: 'image', assetId: 'photo' };
    const document = makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/0.png', overlays: [text] }] });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    apiMocks.placeMaterial.mockResolvedValue({ element: image });
    await act(async () => hook.result.current.placeMaterial({ id: 'material-photo' }));
    const placed = hook.result.current.elements.find(element => element.id === image.id)!;
    const edited = { ...placed, bbox: { ...range, xRatio: 0.4 } };
    act(() => hook.result.current.updateElement(edited));
    await waitFor(() => expect(hook.result.current.layoutSuggestions.canSuggest).toBe(true));
    apiMocks.suggestLayout.mockResolvedValue({ elements: [text, edited], addedElementIds: [], changes: ['split'], overflow: {
      split: { elements: [text], nextPageElements: [{ ...edited, pageIndex: 1 }], firstMovedPhotoNumber: 1, changes: ['split'] }
    } });
    const splitDocument = { ...document, editVersion: 1, pages: [...document.pages, { pageIndex: 1, imageRelativePath: '/blank.png', overlays: [] }] };
    apiMocks.addBlankPage.mockResolvedValue(splitDocument);
    await act(async () => hook.result.current.layoutSuggestions.start());
    await act(async () => hook.result.current.layoutSuggestions.apply());
    expect(hook.result.current.elements.find(element => element.id === image.id)?.pageIndex).toBe(1);
    apiMocks.deletePage.mockResolvedValue({ ...splitDocument, editVersion: 2, pages: [{ ...splitDocument.pages[1 - pageIndex], pageIndex: 0 }] });
    await act(async () => hook.result.current.deletePage(pageIndex));
    if (pageIndex === 0) {
      expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
      expect(readAssemblyDocumentEditorRecovery(localStorage, document.id)?.materialPlacements).toContainEqual(expect.objectContaining({ elementId: image.id }));
    }
    await act(async () => hook.result.current.undo());
    expect(hook.result.current.elements).toContainEqual(expect.objectContaining({ id: image.id, pageIndex: 0, assetId: 'photo' }));
    // Deleting the new page releases the absent material; undo must place it again.
    expect(apiMocks.placeMaterial).toHaveBeenCalledTimes(pageIndex === 1 ? 2 : 1);
    expect(readAssemblyDocumentEditorRecovery(localStorage, document.id)?.elements.some(element => element.id === image.id)).toBe(pageIndex === 0);
  });

  it('keeps a surviving inline draft in the preview, history and recovery after deleting another page', async () => {
    const text = { ...createOverlayForRange('TEXT', 1, range), id: 'inline-survivor', text: 'saved' };
    const document = makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/0.png', overlays: [] }, { pageIndex: 1, imageRelativePath: '/1.png', overlays: [text] }] });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    const draft = { ...text, kind: 'TEXT' as const, text: 'typing' };
    act(() => hook.result.current.onInlineDraftChange(draft));
    expect(hook.result.current.pagePreviewElements).toEqual([draft]);
    apiMocks.deletePage.mockResolvedValue({ ...document, editVersion: 1, pages: [{ ...document.pages[1], pageIndex: 0 }] });
    await act(async () => { await hook.result.current.deletePage(0); });
    expect(hook.result.current.elements).toEqual([{ ...draft, pageIndex: 0 }]);
    expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)?.elements).toEqual(hook.result.current.elements);
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([{ ...text, pageIndex: 0 }]);
  });

  it('does nothing when the document is read only', async () => {
    const hook = renderEditor(makeDocument());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.readOnly).toBe(true);
    await act(async () => { await hook.result.current.deletePage(0); });
    expect(apiMocks.deletePage).not.toHaveBeenCalled();
  });

  it('removes unsaved material placement from a deleted page and preserves placements on later pages', async () => {
    const document = makeDocument({ pages: [0, 1].map(pageIndex => ({ pageIndex, imageRelativePath: `/pages/${pageIndex}.png`, overlays: [] })) });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.editLeaseMine).toBe(true));
    const first = { ...createOverlayForRange('IMAGE', 0, range), id: 'first-material', assetId: 'first-asset' };
    const second = { ...createOverlayForRange('IMAGE', 1, range), id: 'second-material', assetId: 'second-asset' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: first }).mockResolvedValueOnce({ element: second });
    await act(async () => { await hook.result.current.placeMaterial({ id: 'material-0' }); });
    act(() => hook.result.current.setSelectedPageIndex(1));
    await act(async () => { await hook.result.current.placeMaterial({ id: 'material-1' }); });
    apiMocks.deletePage.mockResolvedValue({ ...document, editVersion: 1, pages: [{ ...document.pages[1], pageIndex: 0 }] });
    await act(async () => { await hook.result.current.deletePage(0); });
    expect(hook.result.current.elements).toEqual([{ ...second, pageIndex: 0 }]);
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledWith('material-0');
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalledWith('material-1');
    const stored = readAssemblyDocumentEditorRecovery(window.localStorage, document.id)!;
    expect(stored.materialPlacements?.map(item => item.elementId)).toEqual(['second-material']);
  });

  it('rebases pending recovery without reviving a deleted page', async () => {
    const document = makeDocument({ pages: [0, 1].map(pageIndex => ({ pageIndex, imageRelativePath: `/pages/${pageIndex}.png`, overlays: [] })) });
    const recovered = [0, 1].map(pageIndex => ({ ...createOverlayForRange('TEXT', pageIndex, range), id: `recovered-${pageIndex}` }));
    writeAssemblyDocumentEditorRecovery(window.localStorage, { version: 1, documentId: document.id, baseUpdatedAt: document.updatedAt, editVersion: 0, savedAt: document.updatedAt, elements: recovered });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.recoveryPending).not.toBeNull());
    apiMocks.deletePage.mockResolvedValue({ ...document, editVersion: 1, pages: [{ ...document.pages[1], pageIndex: 0 }] });
    await act(async () => { await hook.result.current.deletePage(0); });
    expect(hook.result.current.recoveryPending?.editVersion).toBe(1);
    act(() => hook.result.current.restoreRecovery());
    expect(hook.result.current.elements).toEqual([{ ...recovered[1], pageIndex: 0 }]);
  });

  it.each([400, 409, 500])('preserves draft, history, page selection and recovery after deletion fails with %i', async status => {
    const overlay = { ...createOverlayForRange('TEXT', 1, range), id: 'draft-text' };
    const document = makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/0.png', overlays: [] }, { pageIndex: 1, imageRelativePath: '/1.png', overlays: [overlay] }] });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    act(() => { hook.result.current.setSelectedPageIndex(1); hook.result.current.setSelectedOverlayId(overlay.id); hook.result.current.updateElement({ ...overlay, text: 'unsaved' }); });
    const before = hook.result.current.elements;
    const recoveryBefore = readAssemblyDocumentEditorRecovery(window.localStorage, document.id);
    apiMocks.deletePage.mockRejectedValue({ isAxiosError: true, response: { status, data: { message: '削除できません' } } });
    await act(async () => { await hook.result.current.deletePage(1); });
    expect(hook.result.current.document).toBe(document);
    expect(hook.result.current.elements).toBe(before);
    expect(hook.result.current.selectedPageIndex).toBe(1);
    expect(hook.result.current.selectedOverlayId).toBe(overlay.id);
    expect(hook.result.current.message).toBe('削除できません');
    expect(hook.result.current.messageIsError).toBe(true);
    expect(hook.result.current.conflict).toBe(false);
    expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)).toEqual(recoveryBefore);
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([overlay]);
  });

  it('blocks overlapping deletion requests and detects edit conflicts', async () => {
    const document = makeDocument({ pages: [0, 1].map(pageIndex => ({ pageIndex, imageRelativePath: `/${pageIndex}.png`, overlays: [] })) });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    let reject!: (error: unknown) => void;
    apiMocks.deletePage.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    let request!: Promise<void>;
    act(() => { request = hook.result.current.deletePage(0); void hook.result.current.deletePage(0); });
    expect(apiMocks.deletePage).toHaveBeenCalledOnce();
    await act(async () => { reject({ isAxiosError: true, response: { status: 409, data: { errorCode: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT', details: { currentEditVersion: 2 } } } }); await request; });
    expect(hook.result.current.conflict).toBe(true);
    expect(hook.result.current.document).toBe(document);
    await act(async () => { await hook.result.current.deletePage(0); });
    expect(apiMocks.deletePage).toHaveBeenCalledOnce();
  });

  it('previews the unsaved current page, applies one history change, and undoes it once', async () => {
    const text = { ...createOverlayForRange('TEXT', 0, range), id: 'text' };
    const image = { ...createOverlayForRange('IMAGE', 0, range), id: 'image', assetId: 'photo' };
    const other = { ...text, id: 'other', pageIndex: 1 };
    const hook = renderEditor(makeDocument({ pages: [
      { pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [text, image] },
      { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [other] }
    ] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.layoutSuggestions.canSuggest).toBe(true));
    const draftText = { ...text, text: '未保存の文章' } as AssemblyProcedureOverlayElement;
    act(() => hook.result.current.updateElement(draftText));
    const initial = hook.result.current.elements;
    const standard = [draftText, image].map(element => ({ ...element, bbox: { ...range, xRatio: 0.4 } }));
    const added = { ...draftText, id: 'added', text: 'ワークを固定する' } as AssemblyProcedureOverlayElement;
    const proposal = [...standard.map(element => element.kind === 'TEXT' ? { ...element, text: '書き直した文章' } : element), added];
    apiMocks.suggestLayout.mockResolvedValue({ elements: proposal, addedElementIds: ['added'], changes: ['写真を読んで 1 行足した'] });
    await act(async () => hook.result.current.layoutSuggestions.start());
    expect(apiMocks.suggestLayout).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 0, elements: [draftText, image], accessPassword: '1234', holderToken: 'session-token', signal: expect.any(AbortSignal) }));
    expect(hook.result.current.elements).toEqual(initial);
    expect(hook.result.current.layoutSuggestions.previewElements).toEqual(proposal.map(element => element.id === 'added' ? { ...element, mask: { enabled: true, color: '#fff2c6' } } : element));
    expect(hook.result.current.readOnly).toBe(true);
    act(() => { hook.result.current.setSelectedPageIndex(1); hook.result.current.addOverlay('TEXT'); hook.result.current.updateElement(text); hook.result.current.undo(); });
    expect(hook.result.current.selectedPageIndex).toBe(0);
    expect(hook.result.current.elements).toEqual(initial);
    act(() => hook.result.current.layoutSuggestions.showBefore(true));
    expect(hook.result.current.layoutSuggestions.previewElements).toBeNull();
    act(() => hook.result.current.layoutSuggestions.apply());
    expect(hook.result.current.selectedPageElements).toEqual(proposal);
    expect(hook.result.current.elements.find(element => element.id === 'other')).toEqual(other);
    expect(hook.result.current.message).toBe('整えました。元に戻せます');
    expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual(initial);
    expect(hook.result.current.layoutSuggestions.appliedCaptionElementIds).toEqual(['added']);
    apiMocks.saveOverlays.mockResolvedValue(makeDocument({ editVersion: 1, pages: [
      { pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [draftText, image] },
      { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [other] }
    ] }));
    await act(async () => { await hook.result.current.save(); });
    expect(apiMocks.saveOverlays).toHaveBeenLastCalledWith(expect.objectContaining({ appliedCaptionElementIds: ['added'], elements: initial }));
    expect(hook.result.current.layoutSuggestions.appliedCaptionElementIds).toEqual(['added']);
  });

  it('cancels preview and pending requests without draft or history changes, including late responses', async () => {
    const text = { ...createOverlayForRange('TEXT', 0, range), id: 'text' };
    const image = { ...createOverlayForRange('IMAGE', 0, range), id: 'image', assetId: 'photo' };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [text, image] }] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.layoutSuggestions.canSuggest).toBe(true));
    const initial = hook.result.current.elements;
    const response = { elements: [text, image], addedElementIds: [], changes: ['直すところはありません'] };
    apiMocks.suggestLayout.mockResolvedValueOnce(response);
    await act(async () => hook.result.current.layoutSuggestions.start());
    act(() => hook.result.current.layoutSuggestions.cancel());
    expect(hook.result.current.elements).toEqual(initial);
    expect(hook.result.current.canUndo).toBe(false);
    let finish!: () => void;
    apiMocks.suggestLayout.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(response); }));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.layoutSuggestions.start(); });
    expect(hook.result.current.layoutSuggestions.state.status).toBe('pending');
    const signal = apiMocks.suggestLayout.mock.calls[1][0].signal as AbortSignal;
    act(() => hook.result.current.layoutSuggestions.cancel());
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(); await pending; });
    expect(hook.result.current.layoutSuggestions.state.status).toBe('idle');
    expect(hook.result.current.elements).toEqual(initial);
    expect(hook.result.current.canUndo).toBe(false);
  });

  it('applies overflow shrink through the normal undoable layout without inserting a page', async () => {
    const text = { ...createOverlayForRange('TEXT', 0, range), id: 'text' };
    const image = { ...createOverlayForRange('IMAGE', 0, range), id: 'image', assetId: 'photo' };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/1.png', overlays: [text, image] }] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.layoutSuggestions.canSuggest).toBe(true));
    const shrunk = [text, { ...image, bbox: { ...range, widthRatio: range.widthRatio * 0.88, heightRatio: range.heightRatio * 0.88 } }];
    apiMocks.suggestLayout.mockResolvedValue({ elements: [text, image], addedElementIds: [], changes: ['写真が1ページに入りきりません'],
      overflow: { shrink: { elements: shrunk, changes: ['写真を縮めた'], scalePercent: 88 } } });
    await act(async () => hook.result.current.layoutSuggestions.start());
    act(() => hook.result.current.layoutSuggestions.apply());
    expect(hook.result.current.elements).toEqual(shrunk);
    expect(hook.result.current.isDirty).toBe(true);
    expect(apiMocks.addBlankPage).not.toHaveBeenCalled();
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([text, image]);
    expect(hook.result.current.isDirty).toBe(false);
  });

  it('inserts after the current page, preserves draft assets, shifts unsaved edits and baseline, and undoes the split once', async () => {
    const text = { ...createOverlayForRange('TEXT', 0, range), id: 'text' };
    const image = { ...createOverlayForRange('IMAGE', 0, range), id: 'image', assetId: 'photo' };
    const other = { ...text, id: 'other', pageIndex: 1 };
    const document = makeDocument({ pages: [
      { pageIndex: 0, imageRelativePath: '/1.png', overlays: [text, image] },
      { pageIndex: 1, imageRelativePath: '/2.png', overlays: [other] }
    ], assets: { photo: { assetId: 'photo', relativeUrl: '/photo.png', storageKey: 'photo', sha256: 'a', byteSize: 3, contentType: 'image/png', kind: 'OVERLAY_IMAGE' } } });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.layoutSuggestions.canSuggest).toBe(true));
    const draftOther = { ...other, text: '後ろの未保存編集' } as AssemblyProcedureOverlayElement;
    act(() => hook.result.current.updateElement(draftOther));
    const added = { ...text, id: 'added', text: '写真の説明' } as AssemblyProcedureOverlayElement;
    const split = { elements: [text], nextPageElements: [image, added].map(element => ({ ...element, pageIndex: 1 })), firstMovedPhotoNumber: 3, changes: ['2ページに分けた'] };
    apiMocks.suggestLayout.mockResolvedValue({ elements: [text, image], addedElementIds: ['added'], changes: ['写真が1ページに入りきりません'], overflow: { split } });
    apiMocks.addBlankPage.mockResolvedValue({ ...document, assets: {}, editVersion: 1, pages: [
      document.pages[0], { pageIndex: 1, imageRelativePath: '/blank.png', overlays: [] },
      { ...document.pages[1], pageIndex: 2, overlays: [{ ...other, pageIndex: 2 }] }
    ] });
    await act(async () => hook.result.current.layoutSuggestions.start());
    await act(async () => hook.result.current.layoutSuggestions.apply());
    expect(apiMocks.addBlankPage).toHaveBeenCalledExactlyOnceWith({ id: document.id, holderToken: 'session-token', accessPassword: '1234', expectedEditVersion: 0, afterPageIndex: 0 });
    expect(hook.result.current.selectedPageIndex).toBe(0);
    expect(hook.result.current.selectedPageElements).toEqual(split.elements);
    expect(hook.result.current.elements.filter(element => element.pageIndex === 1)).toEqual(split.nextPageElements);
    expect(hook.result.current.elements.find(element => element.id === 'other')).toEqual({ ...draftOther, pageIndex: 2 });
    expect(hook.result.current.document?.assets?.photo).toEqual(document.assets?.photo);
    expect(hook.result.current.document?.editVersion).toBe(1);
    expect(hook.result.current.message).toBe('2ページに分けました');
    expect(hook.result.current.isDirty).toBe(true);
    expect(hook.result.current.layoutSuggestions.appliedCaptionElementIds).toEqual(['added']);
    expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements.filter(element => element.pageIndex === 1)).toEqual([]);
    expect(hook.result.current.elements.filter(element => element.pageIndex === 0)).toEqual([text, image]);
    expect(hook.result.current.isDirty).toBe(true);
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements.find(element => element.id === 'other')).toEqual({ ...other, pageIndex: 2 });
    expect(hook.result.current.isDirty).toBe(false);
    act(() => { hook.result.current.redo(); });
    act(() => { hook.result.current.redo(); });
    apiMocks.saveOverlays.mockResolvedValue({ ...hook.result.current.document, editVersion: 2 });
    await act(async () => hook.result.current.save());
    expect(apiMocks.saveOverlays).toHaveBeenCalledWith(expect.objectContaining({ expectedEditVersion: 1, appliedCaptionElementIds: ['added'],
      elements: expect.arrayContaining([...split.elements, ...split.nextPageElements, { ...draftOther, pageIndex: 2 }]) }));
  });

  it('keeps the draft intact and handles an insert edit-version conflict', async () => {
    const text = { ...createOverlayForRange('TEXT', 0, range), id: 'text' };
    const image = { ...createOverlayForRange('IMAGE', 0, range), id: 'image', assetId: 'photo' };
    const document = makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/1.png', overlays: [text, image] }] });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.layoutSuggestions.canSuggest).toBe(true));
    apiMocks.suggestLayout.mockResolvedValue({ elements: [text, image], addedElementIds: [], changes: ['写真が1ページに入りきりません'], overflow: {
      split: { elements: [text], nextPageElements: [{ ...image, pageIndex: 1 }], firstMovedPhotoNumber: 2, changes: ['2ページに分けた'] }
    } });
    apiMocks.addBlankPage.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { errorCode: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT', details: { currentEditVersion: 2 } } } });
    await act(async () => hook.result.current.layoutSuggestions.start());
    await act(async () => hook.result.current.layoutSuggestions.apply());
    expect(hook.result.current.elements).toEqual([text, image]);
    expect(hook.result.current.document?.pages).toHaveLength(1);
    expect(hook.result.current.conflict).toBe(true);
    expect(hook.result.current.message).toBe('ページを分けられませんでした');
  });

  it.each([
    ['ASSEMBLY_PROCEDURE_LAYOUT_DOES_NOT_FIT', 422, 'このページは1枚に収まりません'],
    ['ASSEMBLY_PROCEDURE_LAYOUT_INFERENCE_FAILED', 502, 'いまは提案できません']
  ] as const)('displays the friendly layout failure message for %s without changing the draft', async (errorCode, status, message) => {
    const text = { ...createOverlayForRange('TEXT', 0, range), id: 'text' };
    const image = { ...createOverlayForRange('IMAGE', 0, range), id: 'image', assetId: 'photo' };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [text, image] }] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.layoutSuggestions.canSuggest).toBe(true));
    const initial = hook.result.current.elements;
    apiMocks.suggestLayout.mockRejectedValueOnce({ isAxiosError: true, response: { status, data: { errorCode } } });
    await act(async () => hook.result.current.layoutSuggestions.start());
    expect(hook.result.current.layoutSuggestions.state).toEqual({ status: 'error', message });
    expect(hook.result.current.readOnly).toBe(false);
    expect(hook.result.current.elements).toEqual(initial);
    expect(hook.result.current.canUndo).toBe(false);
    act(() => hook.result.current.layoutSuggestions.cancel());
    expect(hook.result.current.layoutSuggestions.state.status).toBe('idle');
  });

  it('disables arranging a page with fewer than two text or image elements', async () => {
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [createOverlayForRange('TEXT', 0, range), createOverlayForRange('SHAPE', 0, range)] }] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    expect(hook.result.current.layoutSuggestions.canSuggest).toBe(false);
    await act(async () => hook.result.current.layoutSuggestions.start());
    expect(apiMocks.suggestLayout).not.toHaveBeenCalled();
  });

  it('places toolbar and range additions above the current page without using other pages z-indices', async () => {
    const front: AssemblyProcedureOverlayElement = { id: 'front', kind: 'SHAPE', shape: 'RECTANGLE', pageIndex: 0, bbox: range, zIndex: 8 };
    const hook = renderEditor(makeDocument({ pages: [
      { pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [front] },
      { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [{ ...front, id: 'other', pageIndex: 1, zIndex: 100 }] }
    ] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    act(() => hook.result.current.addOverlay('TEXT'));
    expect(hook.result.current.selectedElement?.zIndex).toBe(9);
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => hook.result.current.createOverlay('SHAPE'));
    expect(hook.result.current.selectedElement?.zIndex).toBe(10);
    act(() => hook.result.current.setSelectedPageIndex(1));
    act(() => hook.result.current.addOverlay('SHAPE'));
    expect(hook.result.current.selectedElement?.zIndex).toBe(101);
  });

  it.each(['TEXT', 'IMAGE', 'SHAPE'] as const)('copies another page’s %s, selects it, keeps its source and undoes in one step', async kind => {
    const created = createOverlayForRange(kind, 1, range);
    const source = { ...created, ...(created.kind === 'IMAGE' ? { assetId: 'shared-asset' } : {}), id: 'source', zIndex: 100 };
    const front = { ...createOverlayForRange('SHAPE', 0, range), id: 'front', zIndex: 5 };
    const hook = renderEditor(makeDocument({ pages: [
      { pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [front] },
      { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [source] }
    ] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    const initial = hook.result.current.elements;
    act(() => hook.result.current.duplicateOverlayToCurrentPage('source'));
    const copy = hook.result.current.selectedElement!;
    expect(copy.id).not.toBe('source');
    expect(copy).toEqual({ ...source, id: copy.id, pageIndex: 0, zIndex: 6 });
    expect(copy.bbox).not.toBe(source.bbox);
    expect(hook.result.current.selectedPageElements).toEqual([front, copy]);
    expect(hook.result.current.elements.find(element => element.id === 'source')).toEqual(source);
    expect(hook.result.current.isDirty).toBe(true);
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual(initial);
    expect(hook.result.current.isDirty).toBe(false);
    expect(hook.result.current.canUndo).toBe(false);
    act(() => hook.result.current.redo());
    expect(hook.result.current.selectedElement).toEqual(copy);
    act(() => hook.result.current.updateElement({ ...copy, bbox: { ...copy.bbox, xRatio: 0.5 } }));
    expect(hook.result.current.elements.find(element => element.id === 'source')).toEqual(source);
    act(() => hook.result.current.setSelectedPageIndex(1));
    act(() => hook.result.current.duplicateOverlayToCurrentPage('front'));
    expect(hook.result.current.selectedElement).toMatchObject({ pageIndex: 1, zIndex: 101 });
  });

  it('guards reuse when read-only, busy, missing or already on the current page', async () => {
    const source = { ...createOverlayForRange('SHAPE', 1, range), id: 'source' };
    const hook = renderEditor(makeDocument({ pages: [
      { pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [] },
      { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [source] }
    ] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    act(() => hook.result.current.duplicateOverlayToCurrentPage('missing'));
    act(() => hook.result.current.setSelectedPageIndex(1));
    act(() => hook.result.current.duplicateOverlayToCurrentPage('source'));
    act(() => hook.result.current.setSelectedPageIndex(0));
    let finish: (document: AssemblyProcedureDocumentDto) => void = () => undefined;
    apiMocks.addBlankPage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending: Promise<void>;
    act(() => { pending = hook.result.current.addBlankPage(); });
    expect(hook.result.current.busy).toBe(true);
    act(() => hook.result.current.duplicateOverlayToCurrentPage('source'));
    expect(hook.result.current.elements).toEqual([source]);
    await act(async () => { finish(hook.result.current.document!); await pending; });
    act(() => hook.result.current.setSelectedPageIndex(0));
    act(() => clearProcedureEditorAccess());
    expect(hook.result.current.readOnly).toBe(true);
    act(() => hook.result.current.duplicateOverlayToCurrentPage('source'));
    expect(hook.result.current.elements).toEqual([source]);
    expect(hook.result.current.canUndo).toBe(false);
  });

  it('preserves the text-erase prefix for same-page and cross-page copies', async () => {
    const source = { ...createOverlayForRange('IMAGE', 0, range), id: 'text-erase-original', assetId: 'patch', objectFit: 'fill' as const };
    const hook = renderEditor(makeDocument({ pages: [
      { pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [source] },
      { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [] }
    ] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    const patchId = /^text-erase-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
    act(() => hook.result.current.setSelectedOverlayId(source.id));
    act(() => hook.result.current.duplicateSelectedOverlay());
    const samePageCopy = hook.result.current.selectedElement;
    expect(samePageCopy).toMatchObject({ id: expect.stringMatching(patchId), pageIndex: 0, assetId: 'patch', objectFit: 'fill' });
    act(() => hook.result.current.setSelectedPageIndex(1));
    act(() => hook.result.current.duplicateOverlayToCurrentPage(source.id));
    const otherPageCopy = hook.result.current.selectedElement;
    expect(otherPageCopy).toMatchObject({ id: expect.stringMatching(patchId), pageIndex: 1, assetId: 'patch', objectFit: 'fill' });
    expect(new Set([source.id, samePageCopy?.id, otherPageCopy?.id]).size).toBe(3);
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
      const beforeEdit = hook.result.current.elements;
      act(() => hook.result.current.updateElement({ ...element, kind: 'TEXT', text: '失効直前の編集' }));
      act(() => vi.advanceTimersByTime(100));
      expect(hook.result.current.accessGranted).toBe(false);
      expect(readAssemblyDocumentEditorRecovery(localStorage, 'source-draft', { baseUpdatedAt: makeDocument().updatedAt, editVersion: 0 })?.elements).toEqual(hook.result.current.elements);
      const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      expect(await hook.result.current.confirmNavigation()).toBe(false);
      expect(confirm).toHaveBeenCalled(); confirm.mockRestore();
      await act(async () => { await hook.result.current.verifyEditorPassword('2520'); });
      expect(hook.result.current.accessGranted).toBe(true);
      expect(hook.result.current.elements[0]).toMatchObject({ text: '失効直前の編集' });
      expect(hook.result.current.isDirty).toBe(true);
      expect(hook.result.current.conflict).toBe(false);
      expect(hook.result.current.recoveryPending).toBeNull();
      expect(hook.result.current.passwordInput).toBe('2520');
      act(() => hook.result.current.undo());
      expect(hook.result.current.elements).toEqual(beforeEdit);
      act(() => hook.result.current.redo());
      expect(hook.result.current.elements[0]).toMatchObject({ text: '失効直前の編集' });
    } finally { vi.useRealTimers(); }
  });
  it('keeps edits after reauthentication and enters conflict handling only when the server version changed', async () => {
    const hook = renderEditor(makeDocument()); await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    act(() => hook.result.current.addOverlay('TEXT'));
    const localElements = hook.result.current.elements;
    act(() => { hook.result.current.onEditLeaseError({ isAxiosError: true, response: { status: 401 } }); });
    apiMocks.createRevision.mockResolvedValue(makeDocument({ editVersion: 2 }));
    await act(async () => { await hook.result.current.verifyEditorPassword('2520'); });
    expect(hook.result.current.elements).toEqual(localElements);
    expect(hook.result.current.conflict).toBe(true);
    expect(hook.result.current.conflictEditVersion).toBe(2);
  });
  it('keeps interaction callbacks stable and uses the latest selection and draft', async () => {
    const hook = renderEditor(makeDocument()); await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    const before = hook.result.current;
    act(() => before.addOverlay('TEXT'));
    const added = hook.result.current.selectedElement!;
    act(() => hook.result.current.updateElement({ ...added, text: '最新の文章' } as AssemblyProcedureOverlayElement));
    const after = hook.result.current;
    for (const key of ['addOverlay', 'save', 'duplicateSelectedOverlay', 'duplicateOverlayToCurrentPage', 'deleteSelectedOverlay', 'updateElementBBox', 'beginOverlayDrag', 'endOverlayDrag', 'setSelectedOverlayId', 'refetchTextCandidates'] as const) {
      expect(after[key]).toBe(before[key]);
    }
    act(() => before.duplicateSelectedOverlay());
    expect(hook.result.current.selectedElement).toMatchObject({ text: '最新の文章' });
    const copyId = hook.result.current.selectedOverlayId;
    expect(copyId).not.toBe(added.id);
    act(() => before.deleteSelectedOverlay());
    expect(hook.result.current.elements.map(element => element.id)).toEqual([added.id]);
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
  it.each([
    ['bringForward', 'first', ['middle', 'first', 'last']],
    ['sendBackward', 'last', ['first', 'last', 'middle']],
    ['bringToFront', 'first', ['middle', 'last', 'first']],
    ['sendToBack', 'last', ['last', 'first', 'middle']]
  ] as const)('guards %s while read-only and records one undo step', async (command, id, order) => {
    const elements: AssemblyProcedureOverlayElement[] = ['first', 'middle', 'last'].map((elementId) => ({
      id: elementId, kind: 'SHAPE', shape: 'RECTANGLE', pageIndex: 0, bbox: range, zIndex: 5
    }));
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: elements }] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    act(() => hook.result.current[command](id));
    const reordered = hook.result.current.elements;
    expect([...reordered].sort((a, b) => a.zIndex - b.zIndex).map((element) => element.id)).toEqual(order);
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual(elements);
    expect(hook.result.current.canUndo).toBe(false);
    act(() => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual(reordered);
    act(() => hook.result.current.onEditLeaseError({ isAxiosError: true, response: { status: 401 } }));
    expect(hook.result.current.readOnly).toBe(true);
    act(() => hook.result.current[command](id));
    expect(hook.result.current.elements).toEqual(reordered);
  });

  it('records endpoint reversal through updateElement in undo history', async () => {
    const arrow: AssemblyProcedureOverlayElement = {
      id: 'arrow', kind: 'SHAPE', shape: 'ARROW', pageIndex: 0, bbox: range, zIndex: 0,
      start: { xRatio: 0.1, yRatio: 0.2 }, end: { xRatio: 0.4, yRatio: 0.4 }
    };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [arrow] }] }));
    await authenticate(hook.result);
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    const reversed = { ...arrow, start: arrow.end, end: arrow.start };
    act(() => hook.result.current.updateElement(reversed));
    expect(hook.result.current.elements).toEqual([reversed]);
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([arrow]);
    act(() => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([reversed]);
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
    await act(async () => hook.result.current.verifyEditorPassword('1234'));
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
  it('places at a supplied drop center with server dimensions in a single undo step', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const element: AssemblyProcedureOverlayElement = { id: 'placed', kind: 'TEXT', text: '文章', pageIndex: 0, zIndex: 0, bbox: { ...range, widthRatio: 0.4, heightRatio: 0.3 } };
    apiMocks.placeMaterial.mockResolvedValue({ element });
    await act(async () => { await hook.result.current.placeMaterial({ id: 'material' }, { bbox: { xRatio: 0.98, yRatio: 0.01, widthRatio: 0, heightRatio: 0 } }); });
    expect(hook.result.current.elements[0].bbox).toEqual({ xRatio: 0.6, yRatio: 0, widthRatio: 0.4, heightRatio: 0.3 });
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([]);
    expect(hook.result.current.canUndo).toBe(false);
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([{ ...element, bbox: { xRatio: 0.6, yRatio: 0, widthRatio: 0.4, heightRatio: 0.3 } }]);
    expect(apiMocks.placeMaterial).toHaveBeenCalledTimes(2);
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material');
  });

  it('re-places a photo after undo and keeps edited geometry through repeated history changes', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const image = { ...createOverlayForRange('IMAGE', 0, range), assetId: 'old' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: image });
    await act(async () => hook.result.current.placeMaterial({ id: 'photo' }));
    const moved = { ...image, bbox: { ...range, xRatio: 0.55 }, zIndex: 8 };
    act(() => hook.result.current.updateElement(moved));
    act(() => hook.result.current.undo());
    act(() => hook.result.current.undo());
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('photo');
    const asset = { assetId: 'fresh', url: '/fresh.png' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: { ...image, id: 'server-new-id', assetId: asset.assetId }, asset });
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([{ ...image, assetId: 'fresh' }]);
    act(() => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([{ ...moved, assetId: 'fresh' }]);
    expect(hook.result.current.document?.assets?.fresh).toEqual(asset);
    expect(apiMocks.placeMaterial).toHaveBeenLastCalledWith({ holderToken: 'session-token', id: 'source-draft', materialId: 'photo', pageIndex: 0, accessPassword: '1234' });
    act(() => hook.result.current.undo());
    act(() => hook.result.current.undo());
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: { ...image, assetId: 'fresh-again' } });
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([{ ...image, assetId: 'fresh-again' }]);
    hook.unmount();
  });

  it.each([new Error('offline'), { isAxiosError: true, response: { status: 409, data: {} } }])('skips a failed redo placement and continues editing: %s', async error => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: createOverlayForRange('TEXT', 0, range) });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    act(() => hook.result.current.undo());
    apiMocks.placeMaterial.mockRejectedValueOnce(error);
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([]);
    expect(hook.result.current.canRedo).toBe(false);
    expect(hook.result.current.messageIsError).toBe(true);
    expect(hook.result.current.message).toContain(error instanceof Error ? error.message : '素材を再配置できませんでした');
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.readOnly).toBe(false);
    act(() => hook.result.current.addOverlay('TEXT'));
    expect(hook.result.current.elements).toHaveLength(1);
    hook.unmount();
  });

  it('keeps later redo history usable after a material placement fails', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const first = { ...createOverlayForRange('TEXT', 0, range), id: 'first' };
    const second = { ...first, id: 'second' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: first }).mockResolvedValueOnce({ element: second });
    await act(async () => hook.result.current.placeMaterial({ id: 'first-material' }));
    await act(async () => hook.result.current.placeMaterial({ id: 'second-material' }));
    act(() => hook.result.current.undo());
    act(() => hook.result.current.undo());
    apiMocks.placeMaterial.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ element: second });
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([]);
    expect(hook.result.current.canRedo).toBe(true);
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([{ ...second, zIndex: 1 }]);
    expect(hook.result.current.canRedo).toBe(false);
    hook.unmount();
  });

  it('waits for undo unplace and prevents duplicate redo requests while placement is pending', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const element = createOverlayForRange('TEXT', 0, range);
    apiMocks.placeMaterial.mockResolvedValueOnce({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    let finishUnplace!: () => void;
    apiMocks.unplaceMaterial.mockImplementationOnce(() => new Promise(resolve => { finishUnplace = () => resolve(undefined); }));
    act(() => hook.result.current.undo());
    let finishPlace!: () => void;
    apiMocks.placeMaterial.mockImplementationOnce(() => new Promise(resolve => { finishPlace = () => resolve({ element }); }));
    let redo!: Promise<void> | undefined;
    act(() => { redo = hook.result.current.redo(); void hook.result.current.redo(); });
    expect(hook.result.current.busy).toBe(true);
    expect(apiMocks.placeMaterial).toHaveBeenCalledTimes(1);
    await act(async () => { finishUnplace(); });
    expect(apiMocks.placeMaterial).toHaveBeenCalledTimes(2);
    act(() => { void hook.result.current.redo(); hook.result.current.addOverlay('TEXT'); });
    expect(apiMocks.placeMaterial).toHaveBeenCalledTimes(2);
    expect(hook.result.current.elements).toEqual([]);
    await act(async () => { finishPlace(); await redo; });
    expect(hook.result.current.elements).toEqual([element]);
    expect(hook.result.current.busy).toBe(false);
    hook.unmount();
  });

  it.each(['lease', 'unmount', 'pagehide'] as const)('does not restore a late redo response after %s', async action => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const element = createOverlayForRange('TEXT', 0, range);
    apiMocks.placeMaterial.mockResolvedValueOnce({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    await act(async () => hook.result.current.undo());
    let finish!: () => void;
    apiMocks.placeMaterial.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ element }); }));
    let redo!: Promise<void> | undefined;
    await act(async () => { redo = hook.result.current.redo(); });
    if (action === 'lease') act(() => { hook.result.current.onEditLeaseError({ isAxiosError: true, response: { status: 409, data: { code: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED', lease: { holderLabel: '別端末', acquiredAt: 'now', heartbeatAt: 'now' } } } }); });
    if (action === 'unmount') hook.unmount();
    if (action === 'pagehide') act(() => window.dispatchEvent(new Event('pagehide')));
    await act(async () => { finish(); await redo; });
    expect(hook.result.current.elements).toEqual([]);
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledTimes(2);
    if (action !== 'unmount') hook.unmount();
  });

  it('restores an unsaved duplicate without placing a material that still has another copy', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const element = createOverlayForRange('TEXT', 0, range);
    apiMocks.placeMaterial.mockResolvedValueOnce({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    act(() => hook.result.current.duplicateSelectedOverlay());
    const copies = hook.result.current.elements;
    act(() => hook.result.current.undo());
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual(copies);
    expect(apiMocks.placeMaterial).toHaveBeenCalledTimes(1);
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('unplaces only unsaved tracked materials once on pagehide with the existing authentication headers', async () => {
    const document = makeDocument();
    const hook = renderEditor(document);
    await authenticate(hook.result);
    const saved = { ...createOverlayForRange('TEXT', 0, range), id: 'saved' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: saved });
    await act(async () => hook.result.current.placeMaterial({ id: 'saved-material' }));
    apiMocks.saveOverlays.mockResolvedValue(makeDocument({ pages: [{ ...document.pages[0], overlays: [saved] }] }));
    await act(async () => hook.result.current.save());
    act(() => hook.result.current.duplicateSelectedOverlay());
    const unsaved = { ...saved, id: 'unsaved' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: unsaved });
    await act(async () => hook.result.current.placeMaterial({ id: 'unsaved/material' }));
    act(() => hook.result.current.duplicateSelectedOverlay());
    act(() => hook.result.current.deleteSelectedOverlay());
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
    const originalBaseURL = api.defaults.baseURL;
    api.defaults.baseURL = 'https://pagehide.test/api';
    api.defaults.headers.common.Authorization = 'Bearer pagehide-user';
    vi.mocked(api.post).mockRestore();
    try {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
      await act(async () => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pagehide')); });
      expect(fetch).toHaveBeenCalledOnce();
      const request = vi.mocked(fetch).mock.calls[0][0] as Request;
      expect(request.url).toBe('https://pagehide.test/api/assembly/procedure-materials/unsaved%2Fmaterial/unplace');
      expect(request.method).toBe('POST');
      expect(request.keepalive).toBe(true);
      expect(request.headers.get('x-client-key')).toBe(getResolvedClientKey());
      expect(request.headers.get('Authorization')).toBe('Bearer pagehide-user');
      expect(readAssemblyDocumentEditorRecovery(localStorage, document.id)?.materialPlacements).toEqual([{ elementId: unsaved.id, materialId: 'unsaved/material' }]);
      expect(hook.result.current.busy).toBe(false);
      hook.unmount();
      expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
    } finally { delete api.defaults.headers.common.Authorization; api.defaults.baseURL = originalBaseURL; }
  });

  it.each(['TEXT', 'IMAGE'] as const)('unplaces an unsaved %s material on manual deletion and preserves unrelated history', async kind => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    act(() => hook.result.current.addOverlay('SHAPE'));
    const shape = hook.result.current.elements[0];
    const element = kind === 'TEXT'
      ? { ...createOverlayForRange('TEXT', 0, range), id: 'material-element' }
      : { ...createOverlayForRange('IMAGE', 0, range), id: 'material-element', assetId: 'photo' };
    apiMocks.placeMaterial.mockResolvedValue({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    act(() => hook.result.current.deleteSelectedOverlay());
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material');
    expect(hook.result.current.elements).toEqual([shape]);
    await act(async () => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([shape, { ...element, zIndex: 1 }]);
    act(() => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([shape]);
    expect(apiMocks.placeMaterial).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it.each(['undo', 'delete'] as const)('does not unplace committed material on %s', async action => {
    const document = makeDocument();
    const hook = renderEditor(document);
    await authenticate(hook.result);
    const element = { ...createOverlayForRange('TEXT', 0, range), id: 'material-element' };
    apiMocks.placeMaterial.mockResolvedValue({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    apiMocks.saveOverlays.mockResolvedValue(makeDocument({ editVersion: 1, pages: [{ ...document.pages[0], overlays: hook.result.current.elements }] }));
    await act(async () => hook.result.current.save());
    act(() => action === 'undo' ? hook.result.current.undo() : hook.result.current.deleteSelectedOverlay());
    expect(hook.result.current.elements).toEqual([]);
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
    act(() => action === 'undo' ? hook.result.current.redo() : hook.result.current.undo());
    expect(hook.result.current.elements).toHaveLength(1);
    expect(apiMocks.placeMaterial).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it.each(['undo', 'delete'] as const)('continues editing when unplace fails during %s', async action => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    apiMocks.placeMaterial.mockResolvedValue({ element: createOverlayForRange('TEXT', 0, range) });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    apiMocks.unplaceMaterial.mockRejectedValueOnce(new Error('offline'));
    await act(async () => action === 'undo' ? hook.result.current.undo() : hook.result.current.deleteSelectedOverlay());
    expect(hook.result.current.elements).toEqual([]);
    expect(hook.result.current.messageIsError).toBe(true);
    expect(hook.result.current.message).toContain('素材を未配置に戻せませんでした');
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.readOnly).toBe(false);
    act(() => hook.result.current.addOverlay('TEXT'));
    expect(hook.result.current.elements).toHaveLength(1);
    hook.unmount();
  });

  it('retains pending placement tracking after a failed save', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    apiMocks.placeMaterial.mockResolvedValue({ element: createOverlayForRange('TEXT', 0, range) });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    apiMocks.saveOverlays.mockRejectedValueOnce(new Error('offline'));
    await act(async () => hook.result.current.save());
    act(() => hook.result.current.undo());
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material');
    hook.unmount();
  });

  it('unplaces only unsaved additions before navigating back and removes them from recovery', async () => {
    const onBack = vi.fn();
    const document = makeDocument();
    const hook = renderEditor(document, onBack);
    await authenticate(hook.result);
    const saved = { ...createOverlayForRange('TEXT', 0, range), id: 'saved' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: saved });
    await act(async () => hook.result.current.placeMaterial({ id: 'saved-material' }));
    apiMocks.saveOverlays.mockResolvedValue(makeDocument({ pages: [{ ...document.pages[0], overlays: [saved] }] }));
    await act(async () => hook.result.current.save());
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: { ...saved, id: 'unsaved' } });
    await act(async () => hook.result.current.placeMaterial({ id: 'unsaved-material' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => hook.result.current.navigateBack());
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => hook.result.current.navigateBack());
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('unsaved-material');
    expect(onBack).toHaveBeenCalledOnce();
    expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)?.elements).toEqual([saved]);
    confirm.mockRestore(); hook.unmount();
  });

  it('reports a failed unplace and still navigates back', async () => {
    const onBack = vi.fn();
    const hook = renderEditor(makeDocument(), onBack);
    await authenticate(hook.result);
    apiMocks.placeMaterial.mockResolvedValue({ element: createOverlayForRange('TEXT', 0, range) });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    apiMocks.unplaceMaterial.mockRejectedValueOnce(new Error('offline'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    await act(async () => hook.result.current.navigateBack());
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('素材を未配置に戻せませんでした'));
    expect(onBack).toHaveBeenCalledOnce();
    confirm.mockRestore(); alert.mockRestore(); hook.unmount();
  });

  it('waits for an earlier undo unplace before leaving and reports its failure', async () => {
    const onBack = vi.fn();
    const hook = renderEditor(makeDocument(), onBack);
    await authenticate(hook.result);
    apiMocks.placeMaterial.mockResolvedValue({ element: createOverlayForRange('TEXT', 0, range) });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    let rejectUnplace!: (error: Error) => void;
    apiMocks.unplaceMaterial.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectUnplace = reject; }));
    act(() => hook.result.current.undo());
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    let leaving!: Promise<void>;
    act(() => { leaving = hook.result.current.navigateBack(); });
    expect(onBack).not.toHaveBeenCalled();
    await act(async () => { rejectUnplace(new Error('offline')); await leaving; });
    expect(alert).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
    expect(hook.result.current.busy).toBe(false);
    alert.mockRestore(); hook.unmount();
  });

  it('preserves flushed inline text when back navigation releases a pending material', async () => {
    const document = makeDocument();
    const hook = renderEditor(document, vi.fn());
    await authenticate(hook.result);
    act(() => hook.result.current.addOverlay('TEXT'));
    const text = hook.result.current.elements[0];
    const edited = { ...text, text: '確定した文章' } as AssemblyProcedureOverlayElement;
    apiMocks.placeMaterial.mockResolvedValue({ element: createOverlayForRange('TEXT', 0, range) });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    act(() => hook.result.current.registerInlineTextFlush(() => {
      hook.result.current.commitInlineText(edited);
      hook.result.current.registerInlineTextFlush(null);
      return edited;
    }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => hook.result.current.navigateBack());
    expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)?.elements).toEqual([edited]);
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material');
    confirm.mockRestore(); hook.unmount();
  });

  it('unplaces pending materials on lease loss and sanitizes recovery while retaining other edits', async () => {
    const document = makeDocument();
    const hook = renderEditor(document);
    await authenticate(hook.result);
    act(() => hook.result.current.addOverlay('TEXT'));
    const other = hook.result.current.elements[0];
    apiMocks.placeMaterial.mockResolvedValue({ element: createOverlayForRange('TEXT', 0, range) });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    await act(async () => hook.result.current.onEditLeaseError({ isAxiosError: true, response: { status: 409, data: { code: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED', lease: { holderLabel: '別端末', acquiredAt: 'now', heartbeatAt: 'now' } } } }));
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material');
    expect(hook.result.current.elements).toEqual([other]);
    const recovered = readAssemblyDocumentEditorRecovery(window.localStorage, document.id);
    expect(recovered?.elements).toEqual([other]);
    expect(recovered?.materialPlacements).toEqual([]);
    expect(hook.result.current.messageIsError).toBe(true);
    expect(hook.result.current.message).toContain('置いた素材を外しました');
    hook.unmount();
  });

  it('passes the employee UID for placement and redo while keeping it out of recovery storage', async () => {
    const document = makeDocument();
    const hook = renderEditor(document);
    await authenticate(hook.result);
    const element = createOverlayForRange('TEXT', 0, range);
    apiMocks.placeMaterial.mockResolvedValue({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'employee-material', employeeTagUid: 'private-tag-uid' }));
    expect(apiMocks.placeMaterial).toHaveBeenLastCalledWith(expect.objectContaining({ materialId: 'employee-material', employeeTagUid: 'private-tag-uid' }));
    await waitFor(() => expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)?.materialPlacements).toHaveLength(1));
    expect(JSON.stringify(readAssemblyDocumentEditorRecovery(window.localStorage, document.id))).not.toContain('private-tag-uid');
    act(() => hook.result.current.undo());
    await waitFor(() => expect(apiMocks.unplaceMaterial).toHaveBeenCalledWith('employee-material'));
    await act(async () => hook.result.current.redo());
    expect(apiMocks.placeMaterial).toHaveBeenCalledTimes(2);
    expect(apiMocks.placeMaterial).toHaveBeenLastCalledWith(expect.objectContaining({ materialId: 'employee-material', employeeTagUid: 'private-tag-uid' }));
    hook.unmount();
  });

  it('keeps a material placed while another unsaved copy still uses it', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const element = createOverlayForRange('TEXT', 0, range);
    apiMocks.placeMaterial.mockResolvedValue({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    act(() => hook.result.current.duplicateSelectedOverlay());
    act(() => hook.result.current.deleteSelectedOverlay());
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
    act(() => hook.result.current.setSelectedOverlayId(element.id));
    act(() => hook.result.current.deleteSelectedOverlay());
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material');
    hook.unmount();
  });

  it('releases successive unsaved replacements and falls back to the saved asset', async () => {
    const image = { ...createOverlayForRange('IMAGE', 0, range), assetId: 'saved' };
    const document = makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [image] }] });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    act(() => hook.result.current.setSelectedOverlayId(image.id));
    for (const id of ['first', 'second']) {
      apiMocks.placeMaterial.mockResolvedValueOnce({ element: { ...image, id }, asset: { assetId: id } });
      await act(async () => hook.result.current.replaceSelectedImageMaterial({ id, kind: 'PHOTO' }));
    }
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('first');
    expect(hook.result.current.elements[0]).toMatchObject({ assetId: 'second' });
    act(() => hook.result.current.undo());
    expect(apiMocks.unplaceMaterial).toHaveBeenLastCalledWith('second');
    expect(hook.result.current.elements).toEqual([image]);
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: { ...image, assetId: 'redo' }, asset: { assetId: 'redo' } });
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([{ ...image, assetId: 'redo' }]);
    hook.unmount();
  });

  it('releases a replaced unsaved addition without losing the new element', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const image = { ...createOverlayForRange('IMAGE', 0, range), assetId: 'first' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: image });
    await act(async () => hook.result.current.placeMaterial({ id: 'first' }));
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: { ...image, id: 'unused' }, asset: { assetId: 'second' } });
    await act(async () => hook.result.current.replaceSelectedImageMaterial({ id: 'second', kind: 'PHOTO' }));
    expect(hook.result.current.elements).toEqual([{ ...image, assetId: 'second' }]);
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('first');
    await act(async () => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([]);
    expect(apiMocks.unplaceMaterial).toHaveBeenLastCalledWith('second');
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: { ...image, assetId: 'redo' }, asset: { assetId: 'redo' } });
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([{ ...image, assetId: 'redo' }]);
    hook.unmount();
  });

  it('unplaces a placement response that arrives after lease loss without adding it to the draft', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    let resolvePlacement!: (value: { element: AssemblyProcedureOverlayElement }) => void;
    apiMocks.placeMaterial.mockImplementationOnce(() => new Promise(resolve => { resolvePlacement = resolve; }));
    let placing!: Promise<void>;
    await act(async () => { placing = hook.result.current.placeMaterial({ id: 'material' }); });
    act(() => hook.result.current.onEditLeaseError({ isAxiosError: true, response: { status: 409, data: { code: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED', lease: { holderLabel: '別端末', acquiredAt: 'now', heartbeatAt: 'now' } } } }));
    await act(async () => {
      resolvePlacement({ element: createOverlayForRange('TEXT', 0, range) });
      await placing;
    });
    expect(hook.result.current.elements).toEqual([]);
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material');
    hook.unmount();
  });

  it('flushes a clean inline draft into the save request and exposes saving until completion', async () => {
    const text: AssemblyProcedureOverlayElement = { id: 'text', kind: 'TEXT', text: '元の文章', pageIndex: 0, zIndex: 0, bbox: range };
    const document = makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [text] }] });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    const next = { ...text, text: 'その場で直した文章' };
    act(() => hook.result.current.registerInlineTextFlush(() => { hook.result.current.commitInlineText(next); hook.result.current.registerInlineTextFlush(null); return next; }));
    let resolve!: (value: AssemblyProcedureDocumentDto) => void;
    apiMocks.saveOverlays.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let saving!: Promise<void>;
    act(() => { saving = hook.result.current.save(); });
    expect(apiMocks.saveOverlays).toHaveBeenCalledWith(expect.objectContaining({ elements: [next] }));
    expect(hook.result.current.saving).toBe(true);
    await act(async () => { resolve({ ...document, pages: [{ ...document.pages[0], overlays: [next] }] }); await saving; });
    expect(hook.result.current.saving).toBe(false);
    expect(hook.result.current.isDirty).toBe(false);
  });

  it.each(['page', 'selection', 'back', 'lease', 'access'])('flushes inline text before %s', async action => {
    const text: AssemblyProcedureOverlayElement = { id: 'text', kind: 'TEXT', text: '元の文章', pageIndex: 0, zIndex: 0, bbox: range };
    const document = makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [text] }] });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    const next = { ...text, text: '確定する文章' };
    const flush = vi.fn(() => { hook.result.current.commitInlineText(next); hook.result.current.registerInlineTextFlush(null); return next; });
    act(() => { hook.result.current.setSelectedOverlayId('text'); hook.result.current.registerInlineTextFlush(flush); });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    act(() => {
      if (action === 'page') hook.result.current.setSelectedPageIndex(1);
      if (action === 'selection') hook.result.current.setSelectedOverlayId(null);
      if (action === 'back') hook.result.current.navigateBack();
      if (action === 'lease') hook.result.current.onEditLeaseError({ isAxiosError: true, response: { status: 409, data: { code: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED', lease: { holderLabel: '別端末', acquiredAt: 'now', heartbeatAt: 'now' } } } });
      if (action === 'access') hook.result.current.onEditLeaseError({ isAxiosError: true, response: { status: 401 } });
    });
    expect(flush).toHaveBeenCalledOnce();
    expect(hook.result.current.elements[0]).toEqual(next);
    if (action === 'back') expect(confirm).toHaveBeenCalledOnce();
    if (action === 'lease' || action === 'access') {
      const recovered = readAssemblyDocumentEditorRecovery(window.localStorage, document.id, { baseUpdatedAt: document.updatedAt, editVersion: 0 });
      expect(recovered?.elements).toEqual([next]);
    }
    confirm.mockRestore(); hook.unmount();
  });

  it('replaces only the selected image asset and re-places it on redo with the new asset', async () => {
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

    await act(async () => { await hook.result.current.replaceSelectedImageMaterial({ id: 'material-photo', kind: 'PHOTO', employeeTagUid: 'replacement-tag' }); });

    expect(apiMocks.placeMaterial).toHaveBeenCalledWith({ holderToken: 'session-token', id: 'source-draft', materialId: 'material-photo', pageIndex: 0, accessPassword: '1234', employeeTagUid: 'replacement-tag' });
    expect(apiMocks.placeMaterial).toHaveBeenLastCalledWith(expect.objectContaining({ employeeTagUid: 'replacement-tag' }));
    expect(hook.result.current.elements).toEqual([{ ...image, assetId: asset.assetId }, other]);
    expect(hook.result.current.selectedElement?.bbox).toEqual(range);
    expect(hook.result.current.selectedOverlayId).toBe(image.id);
    expect(hook.result.current.document?.assets).toEqual({ [oldAsset.assetId]: oldAsset, [asset.assetId]: asset });
    expect(hook.result.current.message).toBe('画像を差し替えました。保存してください。');
    expect(hook.result.current.isDirty).toBe(true);
    expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([image, other]);
    const redoAsset = { ...asset, assetId: 'redo-asset' };
    apiMocks.placeMaterial.mockResolvedValueOnce({ element: { ...image, assetId: redoAsset.assetId }, asset: redoAsset });
    await act(async () => hook.result.current.redo());
    expect(hook.result.current.elements).toEqual([{ ...image, assetId: redoAsset.assetId }, other]);
    expect(hook.result.current.document?.assets?.[redoAsset.assetId]).toEqual(redoAsset);
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material-photo');
    expect(apiMocks.placeMaterial).toHaveBeenLastCalledWith(expect.objectContaining({ employeeTagUid: 'replacement-tag' }));
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
      expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)?.materialPlacements).toEqual([
        { elementId: element.id, materialId: 'material-photo', assetId: asset.assetId }
      ]);
      act(() => window.dispatchEvent(new Event('pagehide')));
      expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
      expect(api.post).toHaveBeenCalledWith('/assembly/procedure-materials/material-photo/unplace', undefined, { adapter: 'fetch', fetchOptions: { keepalive: true } });
      expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)?.materialPlacements).toHaveLength(1);
    } finally {
      hook.unmount();
      vi.useRealTimers();
    }
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
    apiMocks.unplaceMaterial.mockClear();
    writeAssemblyDocumentEditorRecovery(localStorage, { version: 1, documentId: document.id, baseUpdatedAt: document.updatedAt, editVersion: 0, savedAt: 'now', elements: [element as AssemblyProcedureOverlayElement], materialPlacements: [{ elementId: element.id, materialId: 'material-photo', assetId: asset.assetId }] });
    // Simulate a draft retained by an interrupted browser session.
    const reloaded = renderEditor({ ...document, assets: { [asset.assetId]: asset } });
    await authenticate(reloaded.result);
    expect(reloaded.result.current.elements).toEqual([]);
    expect(reloaded.result.current.recoveryPending?.elements).toContainEqual(expect.objectContaining({ id: element.id }));
    act(() => reloaded.result.current.restoreRecovery());
    const restored = reloaded.result.current.elements[0];
    expect(restored).toMatchObject(element);
    expect(restored?.kind === 'IMAGE' && reloaded.result.current.document?.assets?.[restored.assetId]?.url).toBe(asset.url);
    expect(apiMocks.saveOverlays).not.toHaveBeenCalled();
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
    act(() => reloaded.result.current.setSelectedOverlayId(element.id));
    await act(async () => reloaded.result.current.deleteSelectedOverlay());
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material-photo');
    expect(readAssemblyDocumentEditorRecovery(window.localStorage, document.id)?.elements).toEqual([]);
    reloaded.unmount();
  });

  it.each([0, 99])('unplaces recovery materials before discarding a record at editVersion %s', async editVersion => {
    const document = makeDocument();
    const element = createOverlayForRange('TEXT', 0, range);
    writeAssemblyDocumentEditorRecovery(localStorage, { version: 1, documentId: document.id, baseUpdatedAt: document.updatedAt, editVersion, savedAt: 'now', elements: [element], materialPlacements: [{ elementId: element.id, materialId: 'recovery-material' }] });
    let resolve!: () => void;
    apiMocks.unplaceMaterial.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const hook = renderEditor(document);
    await authenticate(hook.result);
    let discarded: Promise<void> | undefined;
    if (editVersion === 0) act(() => { discarded = hook.result.current.discardRecovery(); });
    await waitFor(() => expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('recovery-material'));
    expect(readAssemblyDocumentEditorRecovery(localStorage, document.id)?.materialPlacements).toEqual([{ elementId: element.id, materialId: 'recovery-material' }]);
    await act(async () => { resolve(); await discarded; });
    await waitFor(() => expect(readAssemblyDocumentEditorRecovery(localStorage, document.id)).toBeNull());
  });

  it('rejects removal and edits while saving, including callbacks retained before save began', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const element = createOverlayForRange('TEXT', 0, range);
    apiMocks.placeMaterial.mockResolvedValue({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    const update = hook.result.current.updateElement;
    let resolve!: (document: AssemblyProcedureDocumentDto) => void;
    apiMocks.saveOverlays.mockImplementation(() => new Promise<AssemblyProcedureDocumentDto>(done => { resolve = done; }));
    let saved!: Promise<void>;
    act(() => { saved = hook.result.current.save(); hook.result.current.deleteSelectedOverlay(); update({ ...element, kind: 'TEXT', text: '拒否' }); hook.result.current.addOverlay('TEXT'); hook.result.current.undo(); });
    act(() => { hook.result.current.commitInlineText({ ...element, kind: 'TEXT', text: '拒否' }); hook.result.current.nudgeElement(element.id, 0.2, 0.2); hook.result.current.deleteSelectedOverlay(); });
    expect(hook.result.current.elements).toEqual([element]);
    expect(apiMocks.unplaceMaterial).not.toHaveBeenCalled();
    await act(async () => { resolve(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [element] }] })); await saved; });
    expect(hook.result.current.elements).toEqual([element]);
  });

  it('starts inline editing after a 6px jitter without creating move history', async () => {
    const element = { ...createOverlayForRange('TEXT', 0, range), kind: 'TEXT' as const, text: '元の文章' };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [element] }] }));
    await authenticate(hook.result);
    act(() => hook.result.current.setSelectedOverlayId(element.id));
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
    vi.stubGlobal('PointerEvent', MouseEvent);
    const controller = hook.result.current;
    const view = render(createElement(AssemblyProcedureDocumentEditorCanvas, { pageUrl: '/page.png', pageIndex: 0, elements: controller.elements, selectedOverlayId: element.id, editable: true, selectionMode: false,
      onSelectOverlay: controller.setSelectedOverlayId, onNudgeOverlay: controller.nudgeElement, onUpdateOverlayBBox: controller.updateElementBBox, onInteractionStart: controller.beginOverlayDrag, onInteractionEnd: controller.endOverlayDrag, onRangeSelected: controller.handleRangeSelected, onUpdateText: controller.commitInlineText }));
    try {
      const part = screen.getByTestId(`assembly-procedure-overlay-${element.id}`);
      fireEvent.pointerDown(part, { button: 0, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(part, { clientX: 206, clientY: 300 });
      fireEvent.pointerUp(part, { clientX: 206, clientY: 300 });
      expect(hook.result.current.elements).toEqual([element]);
      expect(hook.result.current.canUndo).toBe(false);
      await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
      expect(hook.result.current.canUndo).toBe(false);
    } finally { view.unmount(); rect.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('silently releases only unsaved tracked materials on unmount', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const element = createOverlayForRange('TEXT', 0, range);
    apiMocks.placeMaterial.mockResolvedValue({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    apiMocks.unplaceMaterial.mockRejectedValue(new Error('offline'));
    await act(async () => hook.unmount());
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material');
  });

  it('guards and persists uncommitted inline text on pagehide and beforeunload', async () => {
    const element = { ...createOverlayForRange('TEXT', 0, range), kind: 'TEXT' as const, text: '元の文章' };
    const document = makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [element] }] });
    const hook = renderEditor(document);
    await authenticate(hook.result);
    act(() => hook.result.current.onInlineDraftChange({ ...element, text: '編集中の文章' }));
    expect(hook.result.current.isDirty).toBe(true);
    expect(hook.result.current.elements).toEqual([element]);
    const unload = new Event('beforeunload', { cancelable: true });
    act(() => window.dispatchEvent(unload));
    expect(unload.defaultPrevented).toBe(true);
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(readAssemblyDocumentEditorRecovery(localStorage, document.id)?.elements).toEqual([{ ...element, text: '編集中の文章' }]);
    act(() => hook.result.current.onInlineDraftChange(null));
    expect(hook.result.current.isDirty).toBe(false);
  });

  it('uses the same material cleanup for confirmNavigation as for back navigation', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    const element = createOverlayForRange('TEXT', 0, range);
    apiMocks.placeMaterial.mockResolvedValue({ element });
    await act(async () => hook.result.current.placeMaterial({ id: 'material' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => expect(await hook.result.current.confirmNavigation()).toBe(true));
    expect(apiMocks.unplaceMaterial).toHaveBeenCalledExactlyOnceWith('material');
    expect(readAssemblyDocumentEditorRecovery(localStorage, 'source-draft')?.materialPlacements).toEqual([]);
    confirm.mockRestore();
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

  it('offers text rewriting second and undoes the patch and text together', async () => {
    const image: AssemblyProcedureOverlayElement = {
      id: 'existing', kind: 'IMAGE', assetId: 'existing-asset', pageIndex: 0, zIndex: 7,
      bbox: { ...range, xRatio: 0.5 }, objectFit: 'cover'
    };
    const hook = renderEditor(makeDocument({ pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [image] }] }));
    await authenticate(hook.result);
    const asset = { assetId: 'erased', storageKey: 'erased.jpg', relativeUrl: '/erased.jpg', contentType: 'image/jpeg' };
    const patchBBox = { ...range, widthRatio: 0.45 };
    const textBBox = { ...range, heightRatio: 0.04 };
    apiMocks.createTextRewriteRegion.mockResolvedValue({ asset, patchBBox, text: '締付確認', textBBox, color: '#171717', fontSizeRatio: 0.04 });
    act(() => hook.result.current.handleRangeSelected(range));
    render(createElement(AssemblyProcedureOverlayTypeDialog, {
      isOpen: true,
      onClose: hook.result.current.cancelPendingRange,
      onSelect: kind => { void hook.result.current.createOverlay(kind, 1.5); }
    }));
    const choices = screen.getAllByRole('radio');
    expect(choices[1]).toHaveTextContent('文字を書き換える');
    expect(choices[1]).toHaveTextContent('元の文字を消して、打ち直せる文章にします。');
    fireEvent.click(choices[1]);
    await waitFor(() => expect(hook.result.current.elements).toHaveLength(3));
    expect(apiMocks.createTextRewriteRegion).toHaveBeenCalledWith({
      holderToken: 'session-token', id: 'source-draft', accessPassword: '1234', pageIndex: 0, bbox: range,
      overlays: [{ assetId: image.assetId, zIndex: image.zIndex, bbox: image.bbox, objectFit: 'cover' }]
    });
    expect(hook.result.current.elements[1]).toMatchObject({ kind: 'IMAGE', bbox: patchBBox, objectFit: 'fill', assetId: asset.assetId, zIndex: 8 });
    expect(hook.result.current.selectedElement).toMatchObject({
      kind: 'TEXT', text: '締付確認', bbox: { ...textBBox, heightRatio: 0.06 },
      style: { color: '#171717', fontSizeRatio: 0.06 }, mask: { enabled: false }, zIndex: 9
    });
    act(() => hook.result.current.undo());
    expect(hook.result.current.elements).toEqual([image]);
    act(() => hook.result.current.redo());
    expect(hook.result.current.elements).toHaveLength(3);
  });

  it('sends the highest 20 images in the full-width rewrite band in z order', async () => {
    const selection = { ...range, yRatio: 0.4, heightRatio: 0.1 };
    const image: AssemblyProcedureOverlayElement = {
      id: 'image', kind: 'IMAGE', assetId: 'image-asset', pageIndex: 0, zIndex: 0,
      bbox: { xRatio: 0.75, yRatio: 0.32, widthRatio: 0.1, heightRatio: 0.05 }
    };
    const inBand = Array.from({ length: 22 }, (_, zIndex) => ({
      ...image, id: `image-${zIndex}`, assetId: `asset-${zIndex}`, zIndex
    }));
    const outside = { ...image, id: 'outside', assetId: 'outside-asset', zIndex: 99, bbox: { ...image.bbox, yRatio: 0.7 } };
    const hook = renderEditor(makeDocument({ pages: [
      { pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [outside, ...[...inBand].reverse()] },
      { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [{ ...image, id: 'other', pageIndex: 1, zIndex: 100 }] }
    ] }));
    await authenticate(hook.result);
    apiMocks.createTextRewriteRegion.mockResolvedValue({
      asset: { assetId: 'patch' }, patchBBox: selection, text: '確認', textBBox: selection, color: '#000000', fontSizeRatio: 0.05
    });
    act(() => hook.result.current.handleRangeSelected(selection));
    await act(async () => hook.result.current.createOverlay('TEXT_REWRITE'));
    expect(apiMocks.createTextRewriteRegion).toHaveBeenCalledWith(expect.objectContaining({
      bbox: selection,
      overlays: inBand.slice(2).map(({ assetId, bbox, zIndex }) => ({ assetId, bbox, zIndex }))
    }));
  });

  it('shows the rewrite error without adding overlays', async () => {
    const hook = renderEditor(makeDocument());
    await authenticate(hook.result);
    apiMocks.createTextRewriteRegion.mockRejectedValue({ response: { status: 422, data: { message: '文字が見つかりませんでした' } } });
    act(() => hook.result.current.handleRangeSelected(range));
    await act(async () => hook.result.current.createOverlay('TEXT_REWRITE'));
    expect(hook.result.current.message).toBe('文字が見つかりませんでした');
    expect(hook.result.current.elements).toEqual([]);
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

  it('saves and publishes through the explicit revision APIs', async () => {
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
