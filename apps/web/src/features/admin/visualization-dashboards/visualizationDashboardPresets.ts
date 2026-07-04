export const DEFAULT_JSON = '{}';

export const UNINSPECTED_DATA_SOURCE_TYPE = 'uninspected_machines';
export const UNINSPECTED_RENDERER_TYPE = 'uninspected_machines';
export const MI_LOAN_INSPECTION_DATA_SOURCE_TYPE = 'measuring_instrument_loan_inspection';
export const MI_LOAN_INSPECTION_RENDERER_TYPE = 'measuring_instrument_loan_inspection';
export const RIGGING_LOAN_INSPECTION_DATA_SOURCE_TYPE = 'rigging_loan_inspection';
export const RIGGING_LOAN_INSPECTION_RENDERER_TYPE = 'rigging_loan_inspection';
export const PALLET_VIZ_DATA_SOURCE_TYPE = 'pallet_visualization_board';
export const PALLET_VIZ_RENDERER_TYPE = 'pallet_visualization_board';

export const PALLET_VIZ_DATA_SOURCE_TEMPLATE = JSON.stringify({}, null, 2);
export const PALLET_VIZ_RENDERER_TEMPLATE = JSON.stringify(
  {
    pageIndex: 0,
    machinesPerPage: 6,
  },
  null,
  2,
);
export const UNINSPECTED_DATA_SOURCE_TEMPLATE = JSON.stringify(
  {
    csvDashboardId: '',
    date: '',
    maxRows: 30,
  },
  null,
  2,
);
export const UNINSPECTED_RENDERER_TEMPLATE = JSON.stringify(
  {
    maxRows: 18,
  },
  null,
  2,
);
export const MI_LOAN_INSPECTION_DATA_SOURCE_TEMPLATE = JSON.stringify(
  {
    sectionEquals: '加工担当部署',
    period: 'today_jst',
  },
  null,
  2,
);
export const MI_LOAN_INSPECTION_RENDERER_TEMPLATE = JSON.stringify(
  {
    maxRows: 24,
  },
  null,
  2,
);
export const RIGGING_LOAN_INSPECTION_DATA_SOURCE_TEMPLATE = JSON.stringify(
  {
    sectionEquals: '加工担当部署',
    period: 'today_jst',
  },
  null,
  2,
);
export const RIGGING_LOAN_INSPECTION_RENDERER_TEMPLATE = JSON.stringify(
  {
    maxRows: 24,
  },
  null,
  2,
);

export type PresetFormFields = {
  dataSourceType: string;
  rendererType: string;
  dataSourceConfig: string;
  rendererConfig: string;
  name: string;
  description: string;
};

function buildLoanInspectionPresetFields(
  dataSourceType: string,
  rendererType: string,
  dataSourceTemplate: string,
  rendererTemplate: string,
  defaultName: string,
  defaultDescription: string,
  name: string,
  description: string,
): PresetFormFields {
  return {
    dataSourceType,
    rendererType,
    dataSourceConfig: dataSourceTemplate,
    rendererConfig: rendererTemplate,
    name: name.trim() ? name : defaultName,
    description: description.trim() ? description : defaultDescription,
  };
}

export function buildUninspectedPresetFields(name: string, description: string): PresetFormFields {
  return {
    dataSourceType: UNINSPECTED_DATA_SOURCE_TYPE,
    rendererType: UNINSPECTED_RENDERER_TYPE,
    dataSourceConfig: UNINSPECTED_DATA_SOURCE_TEMPLATE,
    rendererConfig: UNINSPECTED_RENDERER_TEMPLATE,
    name: name.trim() ? name : '未点検加工機',
    description: description.trim() ? description : '加工機マスターと点検CSVの当日差分を表示',
  };
}

export function buildMeasuringInspectionPresetFields(name: string, description: string): PresetFormFields {
  return buildLoanInspectionPresetFields(
    MI_LOAN_INSPECTION_DATA_SOURCE_TYPE,
    MI_LOAN_INSPECTION_RENDERER_TYPE,
    MI_LOAN_INSPECTION_DATA_SOURCE_TEMPLATE,
    MI_LOAN_INSPECTION_RENDERER_TEMPLATE,
    '計測機器持出状況（点検可視化）',
    '加工担当部署の従業員ごとにJST当日の点検有無・貸出中計測機器数・返却件数（返却はカード上グレー）を表示',
    name,
    description,
  );
}

export function buildRiggingInspectionPresetFields(name: string, description: string): PresetFormFields {
  return buildLoanInspectionPresetFields(
    RIGGING_LOAN_INSPECTION_DATA_SOURCE_TYPE,
    RIGGING_LOAN_INSPECTION_RENDERER_TYPE,
    RIGGING_LOAN_INSPECTION_DATA_SOURCE_TEMPLATE,
    RIGGING_LOAN_INSPECTION_RENDERER_TEMPLATE,
    '吊具持出状況（点検可視化）',
    '加工担当部署の従業員ごとにJST当日の点検有無・貸出中吊具数・返却件数（返却はカード上グレー）を表示',
    name,
    description,
  );
}

export function buildPalletVisualizationPresetFields(name: string, description: string): PresetFormFields {
  return {
    dataSourceType: PALLET_VIZ_DATA_SOURCE_TYPE,
    rendererType: PALLET_VIZ_RENDERER_TYPE,
    dataSourceConfig: PALLET_VIZ_DATA_SOURCE_TEMPLATE,
    rendererConfig: PALLET_VIZ_RENDERER_TEMPLATE,
    name: name.trim() ? name : 'パレット可視化ボード',
    description: description.trim()
      ? description
      : 'パレット現在状態をJPEGで表示。対象加工機未指定時は資源マスタ登録の全機。1台のみのときは大画面レイアウト（ページは rendererConfig.pageIndex）',
  };
}
