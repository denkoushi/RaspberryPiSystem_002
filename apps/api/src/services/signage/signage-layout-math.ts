export type SplitPaneGeometry = {
  scale: number;
  outerPadding: number;
  panelGap: number;
  leftWidth: number;
  rightWidth: number;
  panelHeight: number;
  leftX: number;
  rightX: number;
  innerPadding: number;
  headerHeight: number;
  paneContentHeight: number;
  leftPaneContentWidth: number;
  rightPaneContentWidth: number;
};

/**
 * Compute SPLIT pane geometry used by SignageRenderer when it renders two panes
 * (pdf/tools/csv_dashboard/visualization) into a single canvas.
 *
 * IMPORTANT:
 * - Keep this in sync with signage.renderer.ts behavior.
 * - Keep it pure so preview tooling can reuse it.
 */
export function computeSplitPaneGeometry(params: { width: number; height: number }): SplitPaneGeometry {
  const scale = params.width / 1920;
  const outerPadding = 0;
  const panelGap = Math.round(12 * scale);
  const leftWidth = Math.round((params.width - outerPadding * 2 - panelGap) * 0.5);
  const rightWidth = params.width - outerPadding * 2 - panelGap - leftWidth;
  const panelHeight = params.height - outerPadding * 2;
  const leftX = outerPadding;
  const rightX = leftX + leftWidth + panelGap;
  const innerPadding = Math.round(12 * scale);
  const headerHeight = Math.round(40 * scale);
  const paneContentHeight = panelHeight - innerPadding * 2 - headerHeight;
  const leftPaneContentWidth = leftWidth - innerPadding * 2;
  const rightPaneContentWidth = rightWidth - innerPadding * 2;

  return {
    scale,
    outerPadding,
    panelGap,
    leftWidth,
    rightWidth,
    panelHeight,
    leftX,
    rightX,
    innerPadding,
    headerHeight,
    paneContentHeight,
    leftPaneContentWidth,
    rightPaneContentWidth,
  };
}

