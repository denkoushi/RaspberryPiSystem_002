import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID } from './constants.js';

export function buildProductionScheduleFkobainoDashboardDefinition() {
  return {
    name: 'PurchaseOrder_FKOBAINO',
    description: '購買照会（Gmail件名: FKOBAINO）',
    gmailSubjectPattern: 'FKOBAINO',
    enabled: true,
    ingestMode: 'DEDUP' as const,
    dedupKeyColumns: ['FKOBAINO', 'FHINCD', 'FSEIBAN'],
    dateColumnName: null,
    displayPeriodDays: 365,
    emptyMessage: 'FKOBAINO データはありません',
    columnDefinitions: [
      {
        internalName: 'FKOBAINO',
        displayName: '購買ナンバー',
        csvHeaderCandidates: ['FKOBAINO'],
        dataType: 'string',
        order: 0,
        required: true,
      },
      {
        internalName: 'FHINCD',
        displayName: '購買品コード',
        csvHeaderCandidates: ['FHINCD'],
        dataType: 'string',
        order: 1,
      },
      {
        internalName: 'FSEIBAN',
        displayName: '製番',
        csvHeaderCandidates: ['FSEIBAN'],
        dataType: 'string',
        order: 2,
      },
      {
        internalName: 'FKOBAIHINMEI',
        displayName: '購買品名',
        csvHeaderCandidates: ['FKOBAIHINMEI'],
        dataType: 'string',
        order: 3,
      },
      {
        internalName: 'FUPDTEDT',
        displayName: '更新日時',
        csvHeaderCandidates: ['FUPDTEDT'],
        dataType: 'string',
        order: 4,
        required: false,
      },
      {
        internalName: 'FKENSAOKSU',
        displayName: '検査合格数',
        csvHeaderCandidates: ['FKENSAOKSU'],
        dataType: 'number',
        order: 5,
        required: false,
      },
    ],
    templateType: 'TABLE' as const,
    templateConfig: {
      rowsPerPage: 50,
      fontSize: 14,
      displayColumns: ['FKOBAINO', 'FSEIBAN', 'FHINCD', 'FKOBAIHINMEI', 'FKENSAOKSU'],
      headerFixed: true,
    },
  };
}

export async function ensureProductionScheduleFkobainoDashboard(
  prismaClient: {
    csvDashboard: {
      upsert: (args: {
        where: { id: string };
        update: ReturnType<typeof buildProductionScheduleFkobainoDashboardDefinition>;
        create: { id: string } & ReturnType<typeof buildProductionScheduleFkobainoDashboardDefinition>;
      }) => Promise<unknown>;
    };
  }
): Promise<void> {
  const definition = buildProductionScheduleFkobainoDashboardDefinition();
  await prismaClient.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID },
    update: definition,
    create: {
      id: PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
      ...definition,
    },
  });
}
