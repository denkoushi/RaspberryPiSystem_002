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
