import { PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID } from './constants.js';

export function buildProductionScheduleOrderSupplementDashboardDefinition() {
  return {
    name: 'ProductionSchedule_OrderSupplement',
    description: '生産日程補助（個数・予定着手日・予定完了日）',
    gmailSubjectPattern: '部品納期個数',
    enabled: true,
    ingestMode: 'DEDUP' as const,
    dedupKeyColumns: ['ProductNo', 'FSIGENCD', 'FKOJUN'],
    dateColumnName: null,
    displayPeriodDays: 365,
    emptyMessage: '補助データはありません',
    columnDefinitions: [
      {
        internalName: 'FKOJUN',
        displayName: '工順',
        csvHeaderCandidates: ['工順', 'FKOJUN'],
        dataType: 'string',
        order: 0,
      },
      {
        internalName: 'ProductNo',
        displayName: '製造オーダー番号',
        csvHeaderCandidates: ['製造オーダー番号', '製造order番号', 'ProductNo', 'FSEZONO'],
        dataType: 'string',
        order: 1,
      },
      {
        internalName: 'FSIGENCD',
        displayName: '資源CD',
        csvHeaderCandidates: ['資源CD', 'FSIGENCD', 'FKOTEICD'],
        dataType: 'string',
        order: 2,
      },
      {
        internalName: 'plannedQuantity',
        displayName: '指示数',
        csvHeaderCandidates: ['指示数', 'FKOJUNSIJISU'],
        dataType: 'number',
        order: 3,
        required: false,
      },
      {
        internalName: 'plannedStartDate',
        displayName: '着手日',
        csvHeaderCandidates: ['着手日', 'FKOJUNSTTYOTEIYMD'],
        dataType: 'string',
        order: 4,
        required: false,
      },
      {
        internalName: 'plannedEndDate',
        displayName: '完了日',
        csvHeaderCandidates: ['完了日', 'FKOJUNENDYOTEIYMD'],
        dataType: 'string',
        order: 5,
        required: false,
      },
    ],
    templateType: 'TABLE' as const,
    templateConfig: {
      rowsPerPage: 50,
      fontSize: 14,
      displayColumns: ['FKOJUN', 'ProductNo', 'FSIGENCD', 'plannedQuantity', 'plannedStartDate', 'plannedEndDate'],
      headerFixed: true,
    },
  };
}

export async function ensureProductionScheduleOrderSupplementDashboard(
  prismaClient: {
    csvDashboard: {
      upsert: (args: {
        where: { id: string };
        update: ReturnType<typeof buildProductionScheduleOrderSupplementDashboardDefinition>;
        create: { id: string } & ReturnType<typeof buildProductionScheduleOrderSupplementDashboardDefinition>;
      }) => Promise<unknown>;
    };
  }
): Promise<void> {
  const definition = buildProductionScheduleOrderSupplementDashboardDefinition();
  await prismaClient.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID },
    update: definition,
    create: {
      id: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
      ...definition,
    },
  });
}
