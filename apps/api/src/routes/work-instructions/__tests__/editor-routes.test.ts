import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerRateLimit } from '../../../plugins/rate-limit.js';
import { computeWorkInstructionMemoFingerprint } from '../../../services/work-instructions/domain/editing.js';
import type { WorkInstructionEditService } from '../../../services/work-instructions/work-instruction-edit.service.js';
import type { WorkInstructionReadService } from '../../../services/work-instructions/work-instruction-read.service.js';
import { registerWorkInstructionEditorRoutes } from '../editor-routes.js';

vi.mock('../../kiosk/shared.js', () => ({
  requireClientDevice: vi.fn(async () => ({
    clientKey: 'test-client-key',
    clientDevice: {
      id: '00000000-0000-0000-0000-000000000199',
      apiKey: 'test-client-key',
      name: 'Test Kiosk',
      location: null,
      statusClientId: null
    }
  }))
}));

const rowId = '00000000-0000-0000-0000-000000000101';
const revisionId = '00000000-0000-0000-0000-000000000102';
const versionId = '00000000-0000-0000-0000-000000000103';
const now = new Date('2026-08-31T00:00:00.000Z');

const sourceVersion = {
  id: versionId,
  rowId,
  sourceModified: now,
  partNumber: 'MD004',
  shootingTarget: '研削',
  rawManifest: {},
  contentHash: 'a'.repeat(64),
  createdAt: now,
  steps: [{
    id: '00000000-0000-0000-0000-000000000104',
    step: 1,
    text: '本文',
    imageName: null,
    imageAssetId: null,
    imageStorageKey: null,
    imageMimeType: null,
    imageSha256: null,
    imageDeletedAt: null,
    imageDeletedBy: null
  }]
};

const revision = {
  id: revisionId,
  sourceVersionId: versionId,
  revisionNumber: 1,
  supersedesRevisionId: null,
  copiedFromRevisionId: null,
  isRevisionHead: true,
  status: 'DRAFT' as const,
  editVersion: 0,
  baseContentHash: 'a'.repeat(64),
  createdAt: now,
  updatedAt: now,
  overlays: [],
  memoOverrides: []
};

const editingView = {
  rowId,
  source: { system: 'SharePoint', list: 'List', itemId: 101, modified: now },
  latestVersion: sourceVersion,
  publishedVersion: sourceVersion,
  draftRevision: revision,
  publishedRevision: null
};

function makeApp(overrides: { allowWrite?: () => Promise<void>; withRateLimit?: boolean } = {}) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const apiError = error as ApiError;
    reply.code(apiError.statusCode ?? 500).send({ code: apiError.code ?? 'UNEXPECTED' });
  });
  if (overrides.withRateLimit) {
    app.register(registerRateLimit);
  }
  const read = {
    readRows: vi.fn(async () => [{
      id: rowId,
      source: { system: 'SharePoint', list: 'List', itemId: 101, modified: now },
      partNumber: 'MD004',
      shootingTarget: '研削',
      contentHash: 'a'.repeat(64),
      rawManifest: {},
      steps: [],
      createdAt: now,
      updatedAt: now
    }]),
    readPublishedGroup: vi.fn(async () => ({ partNumber: 'MD004', shootingTarget: '研削', rows: [], steps: [] }))
  } as unknown as WorkInstructionReadService;
  const editing = {
    createEditorAuthentication: vi.fn(async () => ({
      id: '00000000-0000-0000-0000-000000000198',
      employeeId: '00000000-0000-0000-0000-000000000197',
      employeeCodeSnapshot: '0001',
      employeeNameSnapshot: '山田 太郎',
      clientDeviceId: '00000000-0000-0000-0000-000000000199',
      clientDeviceNameSnapshot: 'Test Kiosk',
      partNumber: 'MD004',
      shootingTarget: '研削',
      authenticatedAt: now,
      expiresAt: new Date(now.getTime() + 4 * 60 * 60 * 1000)
    })),
    validateEditorAuthentication: vi.fn(async () => ({
      id: '00000000-0000-0000-0000-000000000198',
      employeeId: '00000000-0000-0000-0000-000000000197',
      employeeCodeSnapshot: '0001',
      employeeNameSnapshot: '山田 太郎',
      clientDeviceId: '00000000-0000-0000-0000-000000000199',
      clientDeviceNameSnapshot: 'Test Kiosk',
      partNumber: 'MD004',
      shootingTarget: '研削',
      authenticatedAt: now,
      expiresAt: new Date(now.getTime() + 4 * 60 * 60 * 1000)
    })),
    listEditAuditLogs: vi.fn(async () => []),
    readEditingView: vi.fn(async () => editingView),
    readRevisionContext: vi.fn(async (id: string) => ({
      revision: id === revisionId ? revision : revision,
      source: editingView.source,
      sourceVersion
    })),
    listSourceVersions: vi.fn(async () => [sourceVersion]),
    saveOverlays: vi.fn(async () => revision),
    saveDraft: vi.fn(async () => revision),
    discardRevision: vi.fn(async () => revision),
    createImageRegion: vi.fn(async () => ({
      id: '00000000-0000-0000-0000-000000000105',
      storageKey: 'private/edit-region.png',
      mimeType: 'image/png',
      sizeBytes: 42,
      sha256: 'b'.repeat(64),
      status: 'ACTIVE' as const,
      origin: 'ROI' as const,
      originSourceVersionId: versionId,
      originSourceStep: 1,
      originBbox: { xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 0.5 },
      ownerRevisionId: null,
      createdAt: now,
      activatedAt: now,
      deletePendingAt: null
    })),
    createDraftRevisionGroup: vi.fn(async () => [{ revision, copy: { elements: [], copiedCount: 0, needsReviewCount: 0, unassignedCount: 0, skippedCount: 0, unassignedIds: [] } }]),
    publishRevisionGroup: vi.fn(async () => [{ revision: { ...revision, status: 'PUBLISHED' as const }, migration: { needsReviewCount: 0, unassignedCount: 0, skippedCount: 0 } }]),
    deleteSourceVersionImages: vi.fn(async () => [{ assetId: 'asset-1', auditId: 'audit-1', status: 'DELETED' as const }])
  } as unknown as WorkInstructionEditService;
  const routeOptions = {
    read,
    editing,
    allowView: async () => undefined,
    allowWrite: overrides.allowWrite ?? (async () => undefined)
  };
  if (overrides.withRateLimit) {
    app.register(async (instance) => {
      registerWorkInstructionEditorRoutes(instance, routeOptions);
    });
  } else {
    registerWorkInstructionEditorRoutes(app, routeOptions);
  }
  return { app, read, editing };
}

describe('work-instruction editor route contract', () => {
  it('issues an editor authentication from an employee NFC UID and binds it to the client device', async () => {
    const fixture = makeApp();
    await fixture.app.ready();
    const response = await fixture.app.inject({
      method: 'POST',
      url: '/work-instructions/editor-authentications',
      headers: { 'x-client-key': 'test-client-key' },
      payload: { partNumber: 'MD004', shootingTarget: '研削', employeeTagUid: 'employee-tag-1' }
    });

    expect(response.statusCode).toBe(200);
    expect(fixture.editing.createEditorAuthentication).toHaveBeenCalledWith({
      partNumber: 'MD004',
      shootingTarget: '研削',
      employeeTagUid: 'employee-tag-1',
      clientDeviceId: '00000000-0000-0000-0000-000000000199'
    });
    expect(response.json()).toMatchObject({
      authentication: {
        id: '00000000-0000-0000-0000-000000000198',
        employee: { id: '00000000-0000-0000-0000-000000000197', employeeCode: '0001', displayName: '山田 太郎' },
        clientDevice: { id: '00000000-0000-0000-0000-000000000199', name: 'Test Kiosk' }
      }
    });
    await fixture.app.close();
  });

  it('rate-limits repeated editor authentication attempts', async () => {
    const fixture = makeApp({ withRateLimit: true });
    await fixture.app.ready();

    const request = {
      method: 'POST' as const,
      url: '/work-instructions/editor-authentications',
      headers: { 'x-client-key': 'test-client-key' },
      payload: { partNumber: 'MD004', shootingTarget: '研削', employeeTagUid: 'employee-tag-1' }
    };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(fixture.app.inject(request)).resolves.toMatchObject({ statusCode: 200 });
    }
    await expect(fixture.app.inject(request)).resolves.toMatchObject({ statusCode: 429 });

    await fixture.app.close();
  });

  it('rejects password-only writes and writes without the editor authentication header', async () => {
    const fixture = makeApp();
    await fixture.app.ready();
    const passwordOnly = await fixture.app.inject({
      method: 'PUT',
      url: `/work-instructions/editor-revisions/${revisionId}/overlays`,
      headers: { 'x-client-key': 'test-client-key' },
      payload: {
        accessPassword: '',
        expectedEditVersion: 0,
        expectedSourceVersionId: versionId,
        expectedContentHash: 'a'.repeat(64),
        elements: []
      }
    });
    expect(passwordOnly.statusCode).toBeGreaterThanOrEqual(400);
    expect(fixture.editing.saveOverlays).not.toHaveBeenCalled();

    const missingAuthentication = await fixture.app.inject({
      method: 'POST',
      url: `/work-instructions/editor-revisions/${revisionId}/discard`,
      headers: { 'x-client-key': 'test-client-key' },
      payload: {}
    });
    expect(missingAuthentication.statusCode).toBe(401);
    expect(missingAuthentication.json()).toMatchObject({ code: 'WORK_INSTRUCTION_EDITOR_AUTHENTICATION_REQUIRED' });
    expect(fixture.editing.discardRevision).not.toHaveBeenCalled();
    await fixture.app.close();
  });

  it('serializes audit snapshots and the server-side change set for history readers', async () => {
    const fixture = makeApp();
    vi.mocked(fixture.editing.listEditAuditLogs).mockResolvedValueOnce([{
      id: '00000000-0000-0000-0000-000000000196',
      authenticationId: '00000000-0000-0000-0000-000000000198',
      action: 'SAVED',
      employeeIdSnapshot: '00000000-0000-0000-0000-000000000197',
      employeeCodeSnapshot: '0001',
      employeeNameSnapshot: '山田 太郎',
      clientDeviceIdSnapshot: '00000000-0000-0000-0000-000000000199',
      clientDeviceNameSnapshot: 'Test Kiosk',
      partNumber: 'MD004',
      shootingTarget: '研削',
      rowId,
      sourceVersionId: versionId,
      revisionId,
      editVersionBefore: 0,
      editVersionAfter: 1,
      requestId: 'request-1',
      changeSet: { overlays: { added: ['overlay-1'] } },
      createdAt: now
    }]);
    await fixture.app.ready();
    const response = await fixture.app.inject({
      method: 'GET',
      url: '/work-instructions/editor-audit?partNumber=MD004&resource=%E7%A0%94%E5%89%8A',
      headers: {
        'x-work-instruction-editor-authentication-id': '00000000-0000-0000-0000-000000000198',
        'x-client-key': 'test-client-key'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      action: 'SAVED',
      employeeIdSnapshot: '00000000-0000-0000-0000-000000000197',
      employeeCodeSnapshot: '0001',
      employeeNameSnapshot: '山田 太郎',
      clientDeviceIdSnapshot: '00000000-0000-0000-0000-000000000199',
      clientDeviceNameSnapshot: 'Test Kiosk',
      changeSet: { overlays: { added: ['overlay-1'] } }
    });
    await fixture.app.close();
  });

  it('maps frontend stepKey overlays to a validated sourceStep', async () => {
    const fixture = makeApp();
    await fixture.app.ready();
    const response = await fixture.app.inject({
      method: 'PUT',
      url: `/work-instructions/editor-revisions/${revisionId}/overlays`,
      headers: {
        'x-work-instruction-editor-authentication-id': '00000000-0000-0000-0000-000000000198',
        'x-client-key': 'test-client-key'
      },
      payload: {
        expectedEditVersion: 0,
        expectedSourceVersionId: versionId,
        expectedContentHash: 'a'.repeat(64),
        elements: [{
          kind: 'TEXT',
          stepKey: 'SharePoint:List:101:1',
          bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.1 },
          text: '注記'
        }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(fixture.editing.saveOverlays).toHaveBeenCalledWith(expect.objectContaining({
      elements: [expect.objectContaining({ sourceStep: 1, migratedFromStep: 1 })],
      editorAuthenticationId: '00000000-0000-0000-0000-000000000198',
      clientDeviceId: '00000000-0000-0000-0000-000000000199'
    }));
    await fixture.app.close();
  });

  it('publishes a group using the expected edit versions and returns the group DTO', async () => {
    const fixture = makeApp();
    await fixture.app.ready();
    const response = await fixture.app.inject({
      method: 'POST',
      url: '/work-instructions/editor-revisions/publish',
      headers: {
        'x-work-instruction-editor-authentication-id': '00000000-0000-0000-0000-000000000198',
        'x-client-key': 'test-client-key'
      },
      payload: {
        partNumber: 'MD004',
        shootingTarget: '研削',
        revisionIds: [revisionId],
        expectedEditVersions: { [revisionId]: 0 }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(fixture.editing.publishRevisionGroup).toHaveBeenCalledWith({
      partNumber: 'MD004',
      shootingTarget: '研削',
      editorAuthenticationId: '00000000-0000-0000-0000-000000000198',
      clientDeviceId: '00000000-0000-0000-0000-000000000199',
      requestId: expect.any(String),
      revisions: [{ revisionId, expectedEditVersion: 0, confirmUnassigned: undefined }]
    });
    expect(response.json().group.rows[0].history[0]).toMatchObject({ id: versionId, isLatest: true, isPublished: true });
    await fixture.app.close();
  });

  it('uses the canonical draft endpoint for memo overrides and accepts an empty override', async () => {
    const fixture = makeApp();
    await fixture.app.ready();
    const response = await fixture.app.inject({
      method: 'PUT',
      url: `/work-instructions/editor-revisions/${revisionId}/draft`,
      headers: {
        'x-work-instruction-editor-authentication-id': '00000000-0000-0000-0000-000000000198',
        'x-client-key': 'test-client-key'
      },
      payload: {
        expectedEditVersion: 0,
        expectedSourceVersionId: versionId,
        expectedContentHash: 'a'.repeat(64),
        elements: [],
        memoOverrides: [{ stepKey: 'SharePoint:List:101:1', text: '' }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(fixture.editing.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      memoOverrides: [expect.objectContaining({ sourceStep: 1, migratedFromStep: 1, text: '' })]
    }));
    expect(fixture.editing.saveOverlays).not.toHaveBeenCalled();
    await fixture.app.close();
  });

  it('exposes the history projection through the compatibility history endpoint', async () => {
    const fixture = makeApp();
    await fixture.app.ready();
    const response = await fixture.app.inject({
      method: 'GET',
      url: '/work-instructions/editor-revisions/history?partNumber=MD004&resource=%E7%A0%8A%E5%89%8A',
      headers: {
        'x-work-instruction-editor-authentication-id': '00000000-0000-0000-0000-000000000198',
        'x-client-key': 'test-client-key'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().history[0]).toMatchObject({ sourceVersionId: versionId, eligibleImageCount: 0, canDeleteImage: false });
    await fixture.app.close();
  });

  it('returns the canonical revision and ROI asset DTOs for editor writes', async () => {
    const fixture = makeApp();
    await fixture.app.ready();
    const save = await fixture.app.inject({
      method: 'PUT',
      url: `/work-instructions/editor-revisions/${revisionId}/overlays`,
      headers: {
        'x-work-instruction-editor-authentication-id': '00000000-0000-0000-0000-000000000198',
        'x-client-key': 'test-client-key'
      },
      payload: {
        expectedEditVersion: 0,
        expectedSourceVersionId: versionId,
        expectedContentHash: 'a'.repeat(64),
        elements: []
      }
    });
    expect(save.statusCode).toBe(200);
    expect(save.json().revision).toMatchObject({
      id: revisionId,
      sourceVersionId: versionId,
      contentHash: 'a'.repeat(64),
      steps: [expect.objectContaining({
        stepKey: 'SharePoint:List:101:1',
        sourceVersionId: versionId,
        memoFingerprint: computeWorkInstructionMemoFingerprint(sourceVersion.steps[0]!)
      })],
      assets: {}
    });

    const roi = await fixture.app.inject({
      method: 'POST',
      url: `/work-instructions/editor-revisions/${revisionId}/regions/image`,
      headers: {
        'x-work-instruction-editor-authentication-id': '00000000-0000-0000-0000-000000000198',
        'x-client-key': 'test-client-key'
      },
      payload: {
        stepKey: 'SharePoint:List:101:1',
        bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 0.5 }
      }
    });
    expect(roi.statusCode).toBe(200);
    expect(roi.json().asset).toMatchObject({ assetId: expect.any(String), contentType: 'image/png', byteSize: 42, url: expect.stringContaining('/edit-assets/') });
    expect(roi.json().asset).not.toHaveProperty('storageKey');
    expect(roi.json().asset).not.toHaveProperty('imageUrl');
    await fixture.app.close();
  });

  it('allows an authenticated employee to bulk-delete source images and returns per-asset audit results', async () => {
    const fixture = makeApp();
    await fixture.app.ready();
    const response = await fixture.app.inject({
      method: 'DELETE',
      url: `/work-instructions/source-versions/${versionId}/image`,
      headers: {
        'x-work-instruction-editor-authentication-id': '00000000-0000-0000-0000-000000000198',
        'x-client-key': 'test-client-key'
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(fixture.editing.deleteSourceVersionImages).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersionId: versionId,
      editorAuthenticationId: '00000000-0000-0000-0000-000000000198',
      clientDeviceId: '00000000-0000-0000-0000-000000000199',
      requestId: expect.any(String)
    }));
    expect(response.json()).toEqual({
      results: [{ assetId: 'asset-1', auditId: 'audit-1', status: 'DELETED' }],
      deletedCount: 1,
      deletedImageCount: 1,
      failedCount: 0
    });
    await fixture.app.close();
  });

  it('does not execute writes when the write pre-handler rejects the request', async () => {
    const fixture = makeApp({ allowWrite: async () => { throw new ApiError(403, 'forbidden', undefined, 'FORBIDDEN'); } });
    await fixture.app.ready();
    const response = await fixture.app.inject({
      method: 'POST',
      url: `/work-instructions/editor-revisions/${revisionId}/discard`,
      payload: { accessPassword: '' }
    });

    expect(response.statusCode).toBe(403);
    expect(fixture.editing.saveOverlays).not.toHaveBeenCalled();
    await fixture.app.close();
  });
});
