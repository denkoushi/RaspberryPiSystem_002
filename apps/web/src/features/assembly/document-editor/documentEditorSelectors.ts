import {
  documentOverlayElements,
  pageOverlayElements
} from './assemblyDocumentEditorDraft';

import type {
  AssemblyProcedureDocumentDto,
  AssemblyProcedureDocumentPageDto
} from '../types';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export function selectDocumentPages(
  document: AssemblyProcedureDocumentDto | null
): AssemblyProcedureDocumentPageDto[] {
  return document?.pages ?? [];
}

export function selectDocumentPage(
  document: AssemblyProcedureDocumentDto | null,
  pageIndex: number
): AssemblyProcedureDocumentPageDto | null {
  return document?.pages.find((page) => page.pageIndex === pageIndex) ?? document?.pages[0] ?? null;
}

export function selectDocumentOverlayElements(
  document: AssemblyProcedureDocumentDto
): AssemblyProcedureOverlayElement[] {
  return documentOverlayElements(document);
}

export function selectDocumentElement(
  elements: AssemblyProcedureOverlayElement[],
  overlayId: string | null
): AssemblyProcedureOverlayElement | null {
  return elements.find((element) => element.id === overlayId) ?? null;
}

export function selectDocumentPageElements(
  elements: AssemblyProcedureOverlayElement[],
  document: AssemblyProcedureDocumentDto | null,
  selectedPageIndex: number
): AssemblyProcedureOverlayElement[] {
  const page = selectDocumentPage(document, selectedPageIndex);
  return pageOverlayElements(elements, page?.pageIndex ?? selectedPageIndex);
}
