import type { CsvDashboard, CsvDashboardCreateInput } from '../../../api/client';

export const MACHINE_DAILY_INSPECTION_DASHBOARD_NAME = '加工機_日常点検結果';

export function buildMachineDailyInspectionPreset(): CsvDashboardCreateInput {
  const columnDefinitions: CsvDashboard['columnDefinitions'] = [
    {
      order: 0,
      internalName: 'machineName',
      displayName: '加工機_名称',
      csvHeaderCandidates: ['加工機_名称', '加工機名称'],
      dataType: 'string',
      required: true,
    },
    {
      order: 1,
      internalName: 'equipmentManagementNumber',
      displayName: '設備管理番号',
      csvHeaderCandidates: ['設備管理番号'],
      dataType: 'string',
      required: true,
    },
    {
      order: 2,
      internalName: 'inspectionAt',
      displayName: '点検日時',
      csvHeaderCandidates: ['点検日時'],
      dataType: 'date',
      required: true,
    },
    {
      order: 3,
      internalName: 'inspector',
      displayName: '点検者',
      csvHeaderCandidates: ['点検者'],
      dataType: 'string',
    },
    {
      order: 4,
      internalName: 'cycle',
      displayName: '周期',
      csvHeaderCandidates: ['周期'],
      dataType: 'string',
    },
    {
      order: 5,
      internalName: 'inspectionItem',
      displayName: '点検項目',
      csvHeaderCandidates: ['点検項目'],
      dataType: 'string',
    },
    {
      order: 6,
      internalName: 'criteria',
      displayName: '判断基準',
      csvHeaderCandidates: ['判断基準'],
      dataType: 'string',
    },
    {
      order: 7,
      internalName: 'inspectionResult',
      displayName: '点検結果',
      csvHeaderCandidates: ['点検結果'],
      dataType: 'string',
      required: true,
    },
    {
      order: 8,
      internalName: 'registeredAt',
      displayName: '登録日時',
      csvHeaderCandidates: ['登録日時'],
      dataType: 'date',
    },
  ];

  return {
    name: MACHINE_DAILY_INSPECTION_DASHBOARD_NAME,
    description: '加工機の日常点検結果（当日分の点検有無判定に使用）',
    columnDefinitions,
    // occurredAt（当日判定）に使う列。API側のパーサは "2026/2/11 10:33" を想定。
    dateColumnName: 'inspectionAt',
    displayPeriodDays: 1,
    emptyMessage: '当日の点検データはありません',
    ingestMode: 'APPEND',
    dedupKeyColumns: [],
    gmailSubjectPattern: null,
    templateType: 'TABLE',
    templateConfig: {
      rowsPerPage: 50,
      fontSize: 16,
      displayColumns: [
        'machineName',
        'equipmentManagementNumber',
        'inspectionAt',
        'inspector',
        'inspectionItem',
        'inspectionResult',
      ],
      headerFixed: true,
    },
  };
}
