import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  createRevision: vi.fn(),
  publish: vi.fn(), approvePublish: vi.fn(),
  saveOverlays: vi.fn()
}));

vi.mock('../../../api/client', () => ({
  verifyAssemblyTemplateAccessPassword: apiMocks.verifyPassword,
  createAssemblyProcedureDocumentRevision: apiMocks.createRevision,
  saveAssemblyProcedureDocumentOverlays: apiMocks.saveOverlays,
  getAssemblyProcedureDocument: vi.fn(),
  publishAssemblyProcedureDocument: apiMocks.publish,
  approvePublishAssemblyProcedureDocument: apiMocks.approvePublish,
  discardAssemblyProcedureDocumentRevision: vi.fn()
}));

import { useAssemblyProcedureDocumentRevisionCommands } from './useAssemblyProcedureDocumentRevisionCommands';

import type { AssemblyProcedureDocumentDto } from '../types';
import type { AssemblyProcedureDocumentRevisionCommandSession } from './useAssemblyProcedureDocumentRevisionCommands';

const documentFixture: AssemblyProcedureDocumentDto = {
  id: 'document-1',
  name: '手順書',
  imageRelativePath: '/pages/1.png',
  status: 'draft',
  publishedAt: null,
  isActive: false,
  isRevisionHead: true,
  editVersion: 2,
  pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [] }],
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

function makeSession(
  overrides: Partial<AssemblyProcedureDocumentRevisionCommandSession> = {}
): AssemblyProcedureDocumentRevisionCommandSession {
  return {
    document: documentFixture,
    elements: [],
    passwordInput: '2520',
    busy: false,
    isDirty: true,
    readOnly: false,
    conflictEditVersion: null,
    setAccessGranted: vi.fn(),
    setBaselineSnapshot: vi.fn(),
    setBusy: vi.fn(),
    setConflict: vi.fn(),
    setConflictEditVersion: vi.fn(),
    setDocument: vi.fn(),
    setMessage: vi.fn(),
    setSelectedOverlayId: vi.fn(),
    dispatch: vi.fn() as never,
    recovery: { clear: vi.fn() },
    onNavigateAfterDiscard: vi.fn(),
    onNavigateAfterPublish: vi.fn(),
    ...overrides
  };
}

describe('useAssemblyProcedureDocumentRevisionCommands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('orchestrates password revision creation and optimistic-versioned saves', async () => {
    const revision = { ...documentFixture, editVersion: 3 };
    apiMocks.verifyPassword.mockResolvedValue({ success: true });
    apiMocks.createRevision.mockResolvedValue(revision);
    apiMocks.saveOverlays.mockResolvedValue(revision);
    const session = makeSession();
    const hook = renderHook(() => useAssemblyProcedureDocumentRevisionCommands(session));

    await act(async () => {
      await hook.result.current.verifyEditorPassword();
    });
    expect(apiMocks.verifyPassword).toHaveBeenCalledWith({ password: '2520' });
    expect(apiMocks.createRevision).toHaveBeenCalledWith('document-1', '2520');
    expect(session.setAccessGranted).toHaveBeenCalledWith(true);
    expect(session.setBaselineSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await hook.result.current.save();
    });
    expect(apiMocks.saveOverlays).toHaveBeenCalledWith({
      id: 'document-1',
      accessPassword: '2520',
      expectedEditVersion: 2,
      elements: []
    });
    expect(session.recovery.clear).toHaveBeenCalledTimes(1);
    expect(session.setMessage).toHaveBeenCalledWith('オーバーレイを保存しました。');
  });

  it.each(['password', 'tag'])('publishes via %s with the current edit version', async method => {
    const published = { ...documentFixture, status: 'published' as const };
    apiMocks.publish.mockResolvedValue(published);
    apiMocks.approvePublish.mockResolvedValue(published);
    const session = makeSession({ isDirty: false });
    const hook = renderHook(() => useAssemblyProcedureDocumentRevisionCommands(session));
    await act(async () => {
      expect(await hook.result.current.publish(method === 'tag' ? { reviewerTagUid: 'TAG', comment: '確認済み' } : undefined)).toBe(true);
    });
    if (method === 'tag') {
      expect(apiMocks.approvePublish).toHaveBeenCalledExactlyOnceWith({ id: 'document-1', reviewerTagUid: 'TAG', expectedEditVersion: 2, comment: '確認済み' });
      expect(apiMocks.publish).not.toHaveBeenCalled();
    } else {
      expect(apiMocks.publish).toHaveBeenCalledExactlyOnceWith({ id: 'document-1', accessPassword: '2520', expectedEditVersion: 2 });
      expect(apiMocks.approvePublish).not.toHaveBeenCalled();
    }
    expect(session.setDocument).toHaveBeenCalledWith(published);
    expect(session.recovery.clear).toHaveBeenCalledOnce();
  });

  it('preserves conflict handling for approval publication', async () => {
    apiMocks.approvePublish.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { details: { currentEditVersion: 9 } } } });
    const session = makeSession({ isDirty: false });
    const hook = renderHook(() => useAssemblyProcedureDocumentRevisionCommands(session));
    await act(async () => { expect(await hook.result.current.publish({ reviewerTagUid: 'TAG' })).toBe(false); });
    expect(session.setConflict).toHaveBeenCalledWith(true);
    expect(session.setDocument).not.toHaveBeenCalled();
  });

  it('turns a 409 into explicit conflict state without replacing local elements', async () => {
    apiMocks.saveOverlays.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { details: { currentEditVersion: 9 } } }
    });
    const localElement = {
      id: 'local-shape',
      pageIndex: 0,
      kind: 'SHAPE' as const,
      shape: 'RECTANGLE' as const,
      bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.2 },
      zIndex: 0
    };
    const session = makeSession({ elements: [localElement] });
    const hook = renderHook(() => useAssemblyProcedureDocumentRevisionCommands(session));

    await act(async () => {
      await hook.result.current.save();
    });
    expect(session.setConflict).toHaveBeenCalledWith(true);
    expect(session.setConflictEditVersion).toHaveBeenCalledWith(9);
    expect(session.setMessage).toHaveBeenCalledWith(
      '他の編集で更新されています。現在の入力内容は保持しています。別画面で最新内容を確認してください。'
    );
    expect(session.dispatch).not.toHaveBeenCalled();
  });
});
