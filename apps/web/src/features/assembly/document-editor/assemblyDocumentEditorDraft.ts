import { ASSEMBLY_PROCEDURE_TEXT_ERASE_ID_PREFIX, assemblyProcedureOverlayBBoxCenter } from '@raspi-system/shared-types';

import type { AssemblyProcedureDocumentDto } from '../types';
import type {
  AssemblyProcedureOverlayBBox,
  AssemblyProcedureOverlayElement,
  AssemblyProcedureOverlayShapeKind
} from '@raspi-system/shared-types';


export type OverlayDraftAction =
  | { type: 'replace'; elements: AssemblyProcedureOverlayElement[]; preserveHistory?: boolean }
  | { type: 'applyLayout'; pageIndex: number; elements: AssemblyProcedureOverlayElement[] }
  | { type: 'splitLayout'; pageIndex: number; elements: AssemblyProcedureOverlayElement[]; nextPageElements: AssemblyProcedureOverlayElement[] }
  | { type: 'addPair'; elements: [AssemblyProcedureOverlayElement, AssemblyProcedureOverlayElement] }
  | { type: 'add'; element: AssemblyProcedureOverlayElement }
  | { type: 'duplicate'; sourceId: string; id: string; pageIndex: number; attachedIds: ReadonlyMap<string, string> }
  | { type: 'update'; element: AssemblyProcedureOverlayElement }
  | { type: 'remove'; id: string }
  | { type: 'bringForward'; id: string }
  | { type: 'sendBackward'; id: string }
  | { type: 'bringToFront'; id: string }
  | { type: 'sendToBack'; id: string }
  | { type: 'nudge'; id: string; dxRatio: number; dyRatio: number }
  | { type: 'clear' };

function isErasePatch(element: AssemblyProcedureOverlayElement): boolean {
  return element.kind === 'IMAGE' && element.id.startsWith(ASSEMBLY_PROCEDURE_TEXT_ERASE_ID_PREFIX);
}

function isPhoto(element: AssemblyProcedureOverlayElement): boolean {
  return element.kind === 'IMAGE' && !isErasePatch(element);
}

function containsCenter(bbox: AssemblyProcedureOverlayBBox, inner: AssemblyProcedureOverlayBBox): boolean {
  const { xRatio, yRatio } = assemblyProcedureOverlayBBoxCenter(inner);
  return xRatio >= bbox.xRatio && xRatio <= bbox.xRatio + bbox.widthRatio
    && yRatio >= bbox.yRatio && yRatio <= bbox.yRatio + bbox.heightRatio;
}

export function findAttachedOverlayIds(elements: AssemblyProcedureOverlayElement[], parentId: string): string[] {
  const parent = elements.find(element => element.id === parentId);
  if (!parent || !isPhoto(parent)) return [];

  // Match the stable back-to-front sort used by OverlayLayer.
  const page = pageOverlayElements(elements, parent.pageIndex).sort((a, b) => a.zIndex - b.zIndex);
  const positions = new Map(page.map((element, index) => [element, index]));
  const isBelow = (a: AssemblyProcedureOverlayElement, b: AssemblyProcedureOverlayElement) =>
    positions.get(a)! < positions.get(b)!;
  const patches = page.filter(isErasePatch).reverse();
  if (!patches.length) return [];
  const photos = page.filter(isPhoto).reverse();
  const attachedPatches = new Set(patches.filter(patch => isBelow(parent, patch)
    && photos.find(photo => isBelow(photo, patch) && containsCenter(photo.bbox, patch.bbox)) === parent));
  if (!attachedPatches.size) return [];

  return page.filter(element => {
    if (attachedPatches.has(element)) return true;
    if (element.kind !== 'TEXT' || !isBelow(parent, element)) return false;
    const patch = patches.find(candidate => isBelow(candidate, element) && containsCenter(candidate.bbox, element.bbox));
    return patch !== undefined && attachedPatches.has(patch);
  }).map(element => element.id);
}

function carryAttachedOverlays(
  before: AssemblyProcedureOverlayElement[],
  after: AssemblyProcedureOverlayElement[],
  layoutPageIndex?: number,
  attachmentElements = before
): AssemblyProcedureOverlayElement[] {
  const proposed = new Map(after.map(element => [element.id, element]));
  const carried = new Map<string, AssemblyProcedureOverlayElement>();
  const original = new Map(before.map(element => [element.id, element]));
  for (const photo of before) {
    if (!isPhoto(photo)) continue;
    const next = proposed.get(photo.id);
    if (!next || !isPhoto(next)) continue;
    const oldBox = photo.bbox;
    const newBox = next.bbox;
    const sameBox = oldBox.xRatio === newBox.xRatio && oldBox.yRatio === newBox.yRatio
      && oldBox.widthRatio === newBox.widthRatio && oldBox.heightRatio === newBox.heightRatio;
    if (sameBox && photo.pageIndex === next.pageIndex && photo.pageIndex !== layoutPageIndex) continue;

    const sx = newBox.widthRatio / oldBox.widthRatio;
    const sy = newBox.heightRatio / oldBox.heightRatio;
    for (const id of findAttachedOverlayIds(attachmentElements, photo.id)) {
      const attachment = original.get(id);
      if (!attachment) continue;
      const element = proposed.get(id) ?? attachment;
      const box = attachment.bbox;
      const bbox = sameBox ? box : normalizeOverlayBBox({
        xRatio: newBox.xRatio + (box.xRatio - oldBox.xRatio) * sx,
        yRatio: newBox.yRatio + (box.yRatio - oldBox.yRatio) * sy,
        widthRatio: box.widthRatio * sx,
        heightRatio: box.heightRatio * sy
      }, 0);
      const moved = { ...element, pageIndex: next.pageIndex, bbox };
      if (moved.kind === 'TEXT' && attachment.kind === 'TEXT') {
        const oldFontSize = attachment.style?.fontSizeRatio;
        const fontSizeRatio = sx === 1 ? oldFontSize : (oldFontSize ?? 0.025) * sx;
        if (fontSizeRatio !== moved.style?.fontSizeRatio) {
          carried.set(id, { ...moved, style: { ...moved.style, fontSizeRatio } });
          continue;
        }
      }
      carried.set(id, moved);
    }
  }
  if (!carried.size) return after;
  return [
    ...after.map(element => carried.get(element.id) ?? element),
    ...[...carried.values()].filter(element => !proposed.has(element.id))
  ];
}

function reorderElement(
  state: AssemblyProcedureOverlayElement[],
  id: string,
  direction: 'forward' | 'backward' | 'front' | 'back'
): AssemblyProcedureOverlayElement[] {
  const target = state.find((element) => element.id === id);
  if (!target) return state;
  const page = pageOverlayElements(state, target.pageIndex).sort((a, b) => a.zIndex - b.zIndex);
  const attachedIds = new Set(findAttachedOverlayIds(page, id));
  const order = page.filter(element => !attachedIds.has(element.id)).map(element => element.id);
  const position = order.indexOf(id);
  let nextPosition = direction === 'front' ? order.length - 1
    : direction === 'back' ? 0
    : direction === 'forward' ? Math.min(position + 1, order.length - 1)
    : Math.max(position - 1, 0);
  if (isPhoto(target) && nextPosition !== position && (direction === 'forward' || direction === 'backward')) {
    const spans: { first: number; last: number }[] = [];
    for (const photo of page) {
      if (!isPhoto(photo) || photo.id === id) continue;
      const lastId = findAttachedOverlayIds(page, photo.id).at(-1);
      if (lastId !== undefined) spans.push({ first: order.indexOf(photo.id), last: order.indexOf(lastId) });
    }
    // Extend the move if crossing one group leaves the insertion point inside another.
    if (direction === 'forward') {
      for (const { first, last } of spans) {
        if (first <= nextPosition && nextPosition < last) nextPosition = last;
      }
    } else {
      for (const { first, last } of spans.sort((a, b) => b.last - a.last)) {
        if (first < nextPosition && nextPosition <= last) nextPosition = first;
      }
    }
  }
  order.splice(position, 1);
  order.splice(nextPosition, 0, id, ...attachedIds);
  const zIndexes = new Map(order.map((elementId, index) => [elementId, index]));
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
  action: OverlayDraftAction,
  attachmentElements?: AssemblyProcedureOverlayElement[]
): AssemblyProcedureOverlayElement[] {
  switch (action.type) {
    case 'splitLayout':
      return carryAttachedOverlays(state, [
        ...state.filter(element => element.pageIndex !== action.pageIndex && element.pageIndex !== action.pageIndex + 1),
        ...action.elements.map(element => ({ ...element, pageIndex: action.pageIndex })),
        ...action.nextPageElements.map(element => ({ ...element, pageIndex: action.pageIndex + 1 }))
      ], action.pageIndex);
    case 'applyLayout': {
      const proposed = new Map(action.elements.map(element => [element.id, element]));
      const existingIds = new Set(state.filter(element => element.pageIndex === action.pageIndex).map(element => element.id));
      return carryAttachedOverlays(state, [
        ...state.map(element => element.pageIndex === action.pageIndex ? { ...(proposed.get(element.id) ?? element) } : element),
        ...action.elements.filter(element => element.pageIndex === action.pageIndex && !existingIds.has(element.id)).map(element => ({ ...element }))
      ], action.pageIndex);
    }
    case 'replace':
      return action.elements.map((element) => ({ ...element }));
    case 'addPair': {
      const [first, second] = action.elements;
      const zIndex = nextPageZIndex(state, first.pageIndex);
      return [...state, { ...first, zIndex }, { ...second, zIndex: zIndex + 1 }];
    }
    case 'add':
      return [...state, { ...action.element, zIndex: nextPageZIndex(state, action.element.pageIndex) }];
    case 'duplicate': {
      const source = state.find((element) => element.id === action.sourceId);
      if (!source) return state;
      const zIndex = nextPageZIndex(state, action.pageIndex);
      const attached = state.filter(element => action.attachedIds.has(element.id)).sort((a, b) => a.zIndex - b.zIndex);
      return [...state, ...[source, ...attached].map((element, index) => ({
        ...structuredClone(element),
        id: index === 0 ? action.id : action.attachedIds.get(element.id)!,
        pageIndex: action.pageIndex,
        zIndex: zIndex + index
      }))];
    }
    case 'update': {
      const updated = state.map((element) => (element.id === action.element.id ? action.element : element));
      return isPhoto(action.element) ? carryAttachedOverlays(state, updated, undefined, attachmentElements) : updated;
    }
    case 'remove': {
      const attachedIds = new Set(findAttachedOverlayIds(state, action.id));
      return state.filter((element) => element.id !== action.id && !attachedIds.has(element.id));
    }
    case 'bringForward':
      return reorderElement(state, action.id, 'forward');
    case 'sendBackward':
      return reorderElement(state, action.id, 'backward');
    case 'bringToFront':
      return reorderElement(state, action.id, 'front');
    case 'sendToBack':
      return reorderElement(state, action.id, 'back');
    case 'nudge':
      return carryAttachedOverlays(state, nudgeElement(state, action.id, action.dxRatio, action.dyRatio));
    case 'clear':
      return [];
    default:
      return state;
  }
}

export function shiftOverlayPages(elements: AssemblyProcedureOverlayElement[], afterPageIndex: number, pageCount = 1): AssemblyProcedureOverlayElement[] {
  return elements.map(element => element.pageIndex > afterPageIndex ? { ...element, pageIndex: element.pageIndex + pageCount } : element);
}

export function removeOverlayPage(elements: AssemblyProcedureOverlayElement[], pageIndex: number): AssemblyProcedureOverlayElement[] {
  return elements.filter(element => element.pageIndex !== pageIndex)
    .map(element => element.pageIndex > pageIndex ? { ...element, pageIndex: element.pageIndex - 1 } : element);
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

/** A copy of a text-erase patch keeps the prefix so it still renders without padding. */
export function duplicateOverlayId(sourceId: string, generateId: () => string = createOverlayId): string {
  return sourceId.startsWith(ASSEMBLY_PROCEDURE_TEXT_ERASE_ID_PREFIX)
    ? `${ASSEMBLY_PROCEDURE_TEXT_ERASE_ID_PREFIX}${createOverlayId()}`
    : generateId();
}

export function createDuplicateOverlayAction(
  elements: AssemblyProcedureOverlayElement[],
  sourceId: string,
  id: string,
  pageIndex: number
): Extract<OverlayDraftAction, { type: 'duplicate' }> {
  const attachedIds = new Map(findAttachedOverlayIds(elements, sourceId)
    .map(elementId => [elementId, duplicateOverlayId(elementId)]));
  return { type: 'duplicate', sourceId, id, pageIndex, attachedIds };
}

export type OverlayCreationKind = 'TEXT' | 'IMAGE' | 'SHAPE';
export type OverlayRangeChoice = OverlayCreationKind | 'TEXT_REWRITE';

function nextPageZIndex(elements: AssemblyProcedureOverlayElement[], pageIndex: number): number {
  const pageElements = pageOverlayElements(elements, pageIndex);
  return pageElements.length ? Math.max(...pageElements.map(element => element.zIndex)) + 1 : 0;
}

const MIN_OVERLAY_RATIO = 0.005;

export function normalizeOverlayBBox(bbox: AssemblyProcedureOverlayBBox, minRatio = MIN_OVERLAY_RATIO): AssemblyProcedureOverlayBBox {
  const widthRatio = Math.max(minRatio, Math.min(1, Number.isFinite(bbox.widthRatio) ? bbox.widthRatio : MIN_OVERLAY_RATIO));
  const heightRatio = Math.max(minRatio, Math.min(1, Number.isFinite(bbox.heightRatio) ? bbox.heightRatio : MIN_OVERLAY_RATIO));
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

export function createOverlayForRange<K extends OverlayCreationKind>(
  kind: K,
  pageIndex: number,
  bbox: AssemblyProcedureOverlayBBox,
  elements?: AssemblyProcedureOverlayElement[]
): Extract<AssemblyProcedureOverlayElement, { kind: K }>;
export function createOverlayForRange(
  kind: OverlayCreationKind,
  pageIndex: number,
  bbox: AssemblyProcedureOverlayBBox,
  elements: AssemblyProcedureOverlayElement[] = []
): AssemblyProcedureOverlayElement {
  const base = {
    id: createOverlayId(),
    pageIndex,
    bbox,
    zIndex: nextPageZIndex(elements, pageIndex),
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

// Draft arrays and elements are immutable. Reuse serialization across history and
// dirty checks, and serialize only changed elements while retaining the exact format.
const draftSnapshots = new WeakMap<AssemblyProcedureOverlayElement[], string>();
const elementSnapshots = new WeakMap<AssemblyProcedureOverlayElement, string>();

export function overlayDraftSnapshot(elements: AssemblyProcedureOverlayElement[]): string {
  const cached = draftSnapshots.get(elements);
  if (cached !== undefined) return cached;
  const snapshot = `[${[...elements].sort((a, b) => a.id.localeCompare(b.id)).map(element => {
    let serialized = elementSnapshots.get(element);
    if (serialized === undefined) {
      serialized = JSON.stringify({ ...element });
      elementSnapshots.set(element, serialized);
    }
    return serialized;
  }).join(',')}]`;
  draftSnapshots.set(elements, snapshot);
  return snapshot;
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

