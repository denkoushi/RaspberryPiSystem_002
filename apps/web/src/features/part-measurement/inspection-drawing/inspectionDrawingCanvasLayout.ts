import { computeObjectContainLayout, type ObjectContainRect } from './computeObjectContainLayout';

export type ZoomedCanvasLayout = {
  /** 図面の描画矩形（スクロール可能コンテンツ座標） */
  image: ObjectContainRect;
  contentWidth: number;
  contentHeight: number;
};

/**
 * ビューポート内 object-contain フィットを基準に、倍率を掛けたスクロール可能レイアウトを返す。
 * ページ全体の transform: scale は使わない（検査図面 ADR 契約）。
 */
export function computeZoomedCanvasLayout(
  viewportWidth: number,
  viewportHeight: number,
  imageNaturalWidth: number,
  imageNaturalHeight: number,
  zoom: number
): ZoomedCanvasLayout | null {
  const base = computeObjectContainLayout(
    viewportWidth,
    viewportHeight,
    imageNaturalWidth,
    imageNaturalHeight
  );
  if (!base || zoom <= 0) {
    return null;
  }

  const imageWidth = base.width * zoom;
  const imageHeight = base.height * zoom;
  const contentWidth = Math.max(viewportWidth, imageWidth);
  const contentHeight = Math.max(viewportHeight, imageHeight);

  return {
    image: {
      width: imageWidth,
      height: imageHeight,
      offsetX: (contentWidth - imageWidth) / 2,
      offsetY: (contentHeight - imageHeight) / 2
    },
    contentWidth,
    contentHeight
  };
}

export function pointerClientToImageRatios(
  clientX: number,
  clientY: number,
  viewportRect: DOMRect,
  scrollLeft: number,
  scrollTop: number,
  layout: ZoomedCanvasLayout
): { xRatio: number; yRatio: number } | null {
  const contentX = clientX - viewportRect.left + scrollLeft;
  const contentY = clientY - viewportRect.top + scrollTop;
  const { image } = layout;
  const localX = contentX - image.offsetX;
  const localY = contentY - image.offsetY;
  if (localX < 0 || localY < 0 || localX > image.width || localY > image.height) {
    return null;
  }
  return {
    xRatio: localX / image.width,
    yRatio: localY / image.height
  };
}

export type ScrollToCenterMarkerInput = {
  layout: ZoomedCanvasLayout;
  xRatio: number;
  yRatio: number;
  viewportWidth: number;
  viewportHeight: number;
};

/**
 * 測定点 ratio を viewport 中央付近へ寄せる scroll 位置（clamp 済み）。
 */
export function zoomedLayoutMatchesCanvasZoom(
  layout: ZoomedCanvasLayout,
  viewportWidth: number,
  viewportHeight: number,
  imageNaturalWidth: number,
  imageNaturalHeight: number,
  zoom: number,
  epsilonPx = 0.5
): boolean {
  const expected = computeZoomedCanvasLayout(
    viewportWidth,
    viewportHeight,
    imageNaturalWidth,
    imageNaturalHeight,
    zoom
  );
  if (!expected) return false;
  return (
    Math.abs(layout.contentWidth - expected.contentWidth) <= epsilonPx &&
    Math.abs(layout.contentHeight - expected.contentHeight) <= epsilonPx &&
    Math.abs(layout.image.width - expected.image.width) <= epsilonPx &&
    Math.abs(layout.image.height - expected.image.height) <= epsilonPx
  );
}

export function computeScrollToCenterMarker(input: ScrollToCenterMarkerInput): {
  scrollLeft: number;
  scrollTop: number;
} {
  const { layout, xRatio, yRatio, viewportWidth, viewportHeight } = input;
  const { image, contentWidth, contentHeight } = layout;
  const markerX = image.offsetX + xRatio * image.width;
  const markerY = image.offsetY + yRatio * image.height;
  const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);
  const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
  const scrollLeft = Math.min(maxScrollLeft, Math.max(0, markerX - viewportWidth / 2));
  const scrollTop = Math.min(maxScrollTop, Math.max(0, markerY - viewportHeight / 2));
  return { scrollLeft, scrollTop };
}
