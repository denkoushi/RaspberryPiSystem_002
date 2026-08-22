import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_EDITOR_CONFLICT_MESSAGES,
  isDocumentEditorConflict,
  readDocumentEditorConflict
} from './documentEditorConflict';
import {
  selectDocumentElement,
  selectDocumentOverlayElements,
  selectDocumentPage,
  selectDocumentPageElements,
  selectDocumentPages
} from './documentEditorSelectors';

import type { AssemblyProcedureDocumentDto } from '../types';

const documentFixture: AssemblyProcedureDocumentDto = {
  id: 'document-1',
  name: '手順書',
  imageRelativePath: '/pages/1.png',
  status: 'draft',
  publishedAt: null,
  isActive: false,
  pages: [
    {
      pageIndex: 0,
      imageRelativePath: '/pages/1.png',
      overlays: [{
        id: 'text-1',
        pageIndex: 0,
        kind: 'TEXT',
        text: '確認',
        bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.1 },
        zIndex: 0
      }]
    },
    {
      pageIndex: 2,
      imageRelativePath: '/pages/3.png',
      overlays: [{
        id: 'shape-1',
        pageIndex: 2,
        kind: 'SHAPE',
        shape: 'ARROW',
        bbox: { xRatio: 0.2, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 },
        zIndex: 1,
        start: { xRatio: 0.2, yRatio: 0.2 },
        end: { xRatio: 0.5, yRatio: 0.4 }
      }]
    }
  ],
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

describe('assembly procedure document editor utilities', () => {
  it('parses only Axios 409 responses and preserves nested edit versions', () => {
    expect(readDocumentEditorConflict({
      isAxiosError: true,
      response: { status: 409, data: { details: { currentEditVersion: 7 } } }
    })).toEqual({ currentEditVersion: 7 });
    expect(readDocumentEditorConflict({
      isAxiosError: true,
      response: { status: 409, data: { currentEditVersion: 4 } }
    })).toEqual({ currentEditVersion: 4 });
    expect(readDocumentEditorConflict({
      isAxiosError: true,
      response: { status: 409, data: { details: { currentEditVersion: '7' } } }
    })).toEqual({ currentEditVersion: null });
    expect(readDocumentEditorConflict({
      isAxiosError: true,
      response: { status: 412, data: { details: { currentEditVersion: 7 } } }
    })).toBeNull();
    expect(readDocumentEditorConflict({ response: { status: 409 } })).toBeNull();
    expect(isDocumentEditorConflict({
      isAxiosError: true,
      response: { status: 409, data: {} }
    })).toBe(true);
    expect(isDocumentEditorConflict(new Error('conflict'))).toBe(false);
    expect(DOCUMENT_EDITOR_CONFLICT_MESSAGES.save).toContain('保持');
  });

  it('projects pages, overlays, and selected elements without mutating the document', () => {
    expect(selectDocumentPages(documentFixture)).toHaveLength(2);
    expect(selectDocumentPage(documentFixture, 2)?.imageRelativePath).toBe('/pages/3.png');
    expect(selectDocumentPage(documentFixture, 8)?.pageIndex).toBe(0);
    expect(selectDocumentPage(null, 0)).toBeNull();

    const elements = selectDocumentOverlayElements(documentFixture);
    expect(elements.map((element) => element.id)).toEqual(['text-1', 'shape-1']);
    expect(elements[0]).not.toBe(documentFixture.pages[0]!.overlays![0]);
    expect(selectDocumentElement(elements, 'shape-1')).toMatchObject({ kind: 'SHAPE', shape: 'ARROW' });
    expect(selectDocumentElement(elements, null)).toBeNull();
    expect(selectDocumentPageElements(elements, documentFixture, 2)).toEqual([elements[1]]);
    expect(selectDocumentPageElements(elements, null, 2)).toEqual([elements[1]]);
  });
});
