import type { AssemblyProcedureDocumentDto } from '../types';
import type {
  AssemblyProcedureOverlayBBox,
  AssemblyProcedureOverlayElement,
  AssemblyProcedureOverlayShapeKind
} from '@raspi-system/shared-types';


export type OverlayDraftAction =
  | { type: 'replace'; elements: AssemblyProcedureOverlayElement[]; preserveHistory?: boolean }
  | { type: 'add'; element: AssemblyProcedureOverlayElement }
  | { type: 'update'; element: AssemblyProcedureOverlayElement }
  | { type: 'remove'; id: string }
  | { type: 'bringForward'; id: string }
  | { type: 'sendBackward'; id: string }
  | { type: 'bringToFront'; id: string }
  | { type: 'sendToBack'; id: string }
  | { type: 'nudge'; id: string; dxRatio: number; dyRatio: number }
  | { type: 'clear' };

function reorderElement(
  state: AssemblyProcedureOverlayElement[],
  id: string,
  direction: 'forward' | 'backward' | 'front' | 'back'
): AssemblyProcedureOverlayElement[] {
  const target = state.find((element) => element.id === id);
  if (!target) return state;
  const pageElements = state
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.pageIndex === target.pageIndex)
    .sort((a, b) => a.element.zIndex - b.element.zIndex || a.index - b.index);
  const position = pageElements.findIndex(({ element }) => element.id === id);
  const nextPosition = direction === 'front' ? pageElements.length - 1
    : direction === 'back' ? 0
    : direction === 'forward' ? Math.min(position + 1, pageElements.length - 1)
    : Math.max(position - 1, 0);
  const [current] = pageElements.splice(position, 1);
  pageElements.splice(nextPosition, 0, current);
  const zIndexes = new Map(pageElements.map(({ element }, index) => [element.id, index]));
  return state.map((element) => {
    if (element.pageIndex !== target.pageIndex) return element;
    return { ...element, zIndex: zIndexes.get(element.id)! };
  });
}

function nudgeElement(
  state: AssemblyProcedureOverlayElement[],
  id: string,
  dxRatio: number,
  dyRatio: number
): AssemblyProcedureOverlayElement[] {
  return state.map((element) => {
    if (element.id !== id) return element;
    const xRatio = Math.max(0, Math.min(1 - element.bbox.widthRatio, element.bbox.xRatio + dxRatio));
    const yRatio = Math.max(0, Math.min(1 - element.bbox.heightRatio, element.bbox.yRatio + dyRatio));
    return { ...element, bbox: { ...element.bbox, xRatio, yRatio } };
  });
}

export function overlayDraftReducer(
  state: AssemblyProcedureOverlayElement[],
  action: OverlayDraftAction
): AssemblyProcedureOverlayElement[] {
  switch (action.type) {
    case 'replace':
      return action.elements.map((element) => ({ ...element }));
    case 'add':
      return [...state, action.element];
    case 'update':
      return state.map((element) => (element.id === action.element.id ? action.element : element));
    case 'remove':
      return state.filter((element) => element.id !== action.id);
    case 'bringForward':
      return reorderElement(state, action.id, 'forward');
    case 'sendBackward':
      return reorderElement(state, action.id, 'backward');
    case 'bringToFront':
      return reorderElement(state, action.id, 'front');
    case 'sendToBack':
      return reorderElement(state, action.id, 'back');
    case 'nudge':
      return nudgeElement(state, action.id, action.dxRatio, action.dyRatio);
    case 'clear':
      return [];
    default:
      return state;
  }
}

export function documentOverlayElements(document: AssemblyProcedureDocumentDto): AssemblyProcedureOverlayElement[] {
  return document.pages
    .flatMap((page) => page.overlays ?? [])
    .map((element) => ({ ...element }));
}

export function pageOverlayElements(
  elements: AssemblyProcedureOverlayElement[],
  pageIndex: number
): AssemblyProcedureOverlayElement[] {
  return elements.filter((element) => element.pageIndex === pageIndex);
}

export function createOverlayId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `overlay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type OverlayCreationKind = 'TEXT' | 'IMAGE' | 'SHAPE';

const MIN_OVERLAY_RATIO = 0.005;

export function normalizeOverlayBBox(bbox: AssemblyProcedureOverlayBBox): AssemblyProcedureOverlayBBox {
  const widthRatio = Math.max(MIN_OVERLAY_RATIO, Math.min(1, Number.isFinite(bbox.widthRatio) ? bbox.widthRatio : MIN_OVERLAY_RATIO));
  const heightRatio = Math.max(MIN_OVERLAY_RATIO, Math.min(1, Number.isFinite(bbox.heightRatio) ? bbox.heightRatio : MIN_OVERLAY_RATIO));
  const xRatio = Math.max(0, Math.min(1 - widthRatio, Number.isFinite(bbox.xRatio) ? bbox.xRatio : 0));
  const yRatio = Math.max(0, Math.min(1 - heightRatio, Number.isFinite(bbox.yRatio) ? bbox.yRatio : 0));
  return { xRatio, yRatio, widthRatio, heightRatio };
}

function pointToBBoxLocal(point: { xRatio: number; yRatio: number }, bbox: AssemblyProcedureOverlayBBox) {
  return {
    xRatio: bbox.widthRatio > 0 ? (point.xRatio - bbox.xRatio) / bbox.widthRatio : 0,
    yRatio: bbox.heightRatio > 0 ? (point.yRatio - bbox.yRatio) / bbox.heightRatio : 0
  };
}

function pointFromBBoxLocal(
  point: { xRatio: number; yRatio: number },
  bbox: AssemblyProcedureOverlayBBox
) {
  return {
    xRatio: bbox.xRatio + point.xRatio * bbox.widthRatio,
    yRatio: bbox.yRatio + point.yRatio * bbox.heightRatio
  };
}

export type LineDirection = 'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left';

export function lineEndpointsForDirection(bbox: AssemblyProcedureOverlayBBox, direction: LineDirection) {
  const [startX, startY, endX, endY] = ({
    up: [0.5, 1, 0.5, 0],
    'up-right': [0, 1, 1, 0],
    right: [0, 0.5, 1, 0.5],
    'down-right': [0, 0, 1, 1],
    down: [0.5, 0, 0.5, 1],
    'down-left': [1, 0, 0, 1],
    left: [1, 0.5, 0, 0.5],
    'up-left': [1, 1, 0, 0]
  } as const)[direction];
  return {
    start: pointFromBBoxLocal({ xRatio: startX, yRatio: startY }, bbox),
    end: pointFromBBoxLocal({ xRatio: endX, yRatio: endY }, bbox)
  };
}

export function updateOverlayBBox(
  element: AssemblyProcedureOverlayElement,
  bbox: AssemblyProcedureOverlayBBox
): AssemblyProcedureOverlayElement {
  const normalized = normalizeOverlayBBox(bbox);
  if (element.kind !== 'SHAPE' || (element.shape !== 'LINE' && element.shape !== 'ARROW')) {
    return { ...element, bbox: normalized };
  }
  const fallbackStart = { xRatio: element.bbox.xRatio, yRatio: element.bbox.yRatio };
  const fallbackEnd = {
    xRatio: element.bbox.xRatio + element.bbox.widthRatio,
    yRatio: element.bbox.yRatio + element.bbox.heightRatio
  };
  return {
    ...element,
    bbox: normalized,
    start: pointFromBBoxLocal(pointToBBoxLocal(element.start ?? fallbackStart, element.bbox), normalized),
    end: pointFromBBoxLocal(pointToBBoxLocal(element.end ?? fallbackEnd, element.bbox), normalized)
  };
}

export function convertOverlayShapeKind(
  element: Extract<AssemblyProcedureOverlayElement, { kind: 'SHAPE' }>,
  shape: AssemblyProcedureOverlayShapeKind
): Extract<AssemblyProcedureOverlayElement, { kind: 'SHAPE' }> {
  const next = { ...element, shape };
  if (shape === 'LINE' || shape === 'ARROW') {
    return {
      ...next,
      start: element.start ?? { xRatio: element.bbox.xRatio, yRatio: element.bbox.yRatio },
      end: element.end ?? {
        xRatio: element.bbox.xRatio + element.bbox.widthRatio,
        yRatio: element.bbox.yRatio + element.bbox.heightRatio
      }
    };
  }
  return { ...next, start: undefined, end: undefined };
}

export function createOverlayForRange(
  kind: OverlayCreationKind,
  pageIndex: number,
  bbox: AssemblyProcedureOverlayBBox
): AssemblyProcedureOverlayElement {
  const base = {
    id: createOverlayId(),
    pageIndex,
    bbox,
    zIndex: 0,
    opacity: 1
  } as const;
  if (kind === 'TEXT') {
    return {
      ...base,
      kind,
      text: 'ここに文章を入力',
      mask: { enabled: true, color: '#ffffff' },
      style: {
        fontSizeRatio: 0.025,
        fontWeight: 'bold',
        color: '#0f172a',
        align: 'start'
      }
    };
  }
  if (kind === 'IMAGE') {
    return {
      ...base,
      kind,
      assetId: '',
      mask: { enabled: true, color: '#ffffff' },
      objectFit: 'contain'
    };
  }
  return {
    ...base,
    kind,
    shape: 'RECTANGLE',
    strokeColor: '#dc2626',
    fillColor: 'transparent',
    strokeWidthRatio: 0.008
  };
}

export function overlayDraftSnapshot(elements: AssemblyProcedureOverlayElement[]): string {
  return JSON.stringify(
    elements.map((element) => ({ ...element })).sort((a, b) => a.id.localeCompare(b.id))
  );
}

export function isOverlayDraftSaveable(elements: AssemblyProcedureOverlayElement[]): boolean {
  return elements.every((element) => {
    if (element.kind === 'TEXT') return element.text.trim().length > 0;
    if (element.kind === 'IMAGE') return element.assetId.trim().length > 0;
    return true;
  });
}

export function canPublishAssemblyProcedureDocument(
  document: Pick<AssemblyProcedureDocumentDto, 'status' | 'isRevisionHead'> | null,
  dirty: boolean
): boolean {
  return !dirty && document?.status === 'draft' && (document.isRevisionHead ?? true);
}

export function canDiscardAssemblyProcedureDocumentRevision(
  document: Pick<AssemblyProcedureDocumentDto, 'status' | 'supersedesDocumentId'> | null
): boolean {
  return document?.status === 'draft' && Boolean(document.supersedesDocumentId);
}
