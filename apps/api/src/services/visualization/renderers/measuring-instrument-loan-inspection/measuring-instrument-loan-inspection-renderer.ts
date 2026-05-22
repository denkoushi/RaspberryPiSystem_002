import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, VisualizationData } from '../../visualization.types.js';
import { MI_INSTRUMENT_DETAIL_COLUMN, MI_RETURNED_COUNT_COLUMN } from './mi-instrument-display.types.js';
import { renderLoanInspectionBoard } from '../../shared/loan-inspection-card/render-loan-inspection-board.js';

export class MeasuringInstrumentLoanInspectionRenderer implements Renderer {
  readonly type = 'measuring_instrument_loan_inspection';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    return renderLoanInspectionBoard({
      data,
      config,
      defaultTitle: '計測機器持出状況',
      errorPrefix: '計測機器持出状況',
      activeCountColumn: '貸出中計測機器数',
      returnedCountColumn: MI_RETURNED_COUNT_COLUMN,
      columns: {
        detailColumn: MI_INSTRUMENT_DETAIL_COLUMN,
        namesColumn: '計測機器名称一覧',
      },
    });
  }
}
