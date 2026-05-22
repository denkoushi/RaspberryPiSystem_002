import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, VisualizationData } from '../../visualization.types.js';
import {
  RIGGING_ACTIVE_COUNT_COLUMN,
  RIGGING_INSTRUMENT_DETAIL_COLUMN,
  RIGGING_NAMES_COLUMN,
  RIGGING_RETURNED_COUNT_COLUMN,
} from '../../data-sources/rigging-loan-inspection/rigging-loan-inspection.constants.js';
import { renderLoanInspectionBoard } from '../../shared/loan-inspection-card/render-loan-inspection-board.js';
import type { LoanInspectionTableRow } from '../../shared/loan-inspection-card/display.types.js';
import { layoutRiggingBodyWithinMaxHeight } from './rigging-layout-body.js';

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** 吊具: Loan または当日点検があれば青カード（CSV 点検のみも含む）。 */
export function resolveRiggingHasVisibleLoanState(
  row: LoanInspectionTableRow,
  counts: { activeLoanCount: number; returnedLoanCount: number },
  context: { inspectionCountColumn?: string },
): boolean {
  if (counts.activeLoanCount > 0 || counts.returnedLoanCount > 0) {
    return true;
  }
  const inspectionCountColumn = context.inspectionCountColumn ?? '点検件数';
  return toNumber(row[inspectionCountColumn], 0) > 0;
}

export class RiggingLoanInspectionRenderer implements Renderer {
  readonly type = 'rigging_loan_inspection';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    return renderLoanInspectionBoard({
      data,
      config,
      defaultTitle: '吊具持出状況',
      errorPrefix: '吊具持出状況',
      activeCountColumn: RIGGING_ACTIVE_COUNT_COLUMN,
      returnedCountColumn: RIGGING_RETURNED_COUNT_COLUMN,
      columns: {
        detailColumn: RIGGING_INSTRUMENT_DETAIL_COLUMN,
        namesColumn: RIGGING_NAMES_COLUMN,
      },
      sortOptions: {
        inspectionCountColumn: '点検件数',
      },
      layoutBodyWithinMaxHeight: layoutRiggingBodyWithinMaxHeight,
      resolveHasVisibleLoanState: resolveRiggingHasVisibleLoanState,
    });
  }
}
