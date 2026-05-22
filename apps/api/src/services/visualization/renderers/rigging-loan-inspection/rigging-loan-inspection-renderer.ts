import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, VisualizationData } from '../../visualization.types.js';
import {
  RIGGING_ACTIVE_COUNT_COLUMN,
  RIGGING_INSTRUMENT_DETAIL_COLUMN,
  RIGGING_NAMES_COLUMN,
  RIGGING_RETURNED_COUNT_COLUMN,
} from '../../data-sources/rigging-loan-inspection/rigging-loan-inspection.constants.js';
import { renderLoanInspectionBoard } from '../../shared/loan-inspection-card/render-loan-inspection-board.js';
import { layoutRiggingBodyWithinMaxHeight } from './rigging-layout-body.js';

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
    });
  }
}
