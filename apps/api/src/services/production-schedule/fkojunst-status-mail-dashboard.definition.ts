import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';

export function buildProductionScheduleFkojunstStatusMailDashboardDefinition() {
  return {
    name: 'ProductionSchedule_FKOJUNST_Status',
    description: '生産日程 工順ステータス（Gmail件名: FKOJUNST_Status）',
    gmailSubjectPattern: 'FKOJUNST_Status',
    enabled: true,
    ingestMode: 'DEDUP' as const,
    dedupKeyColumns: ['FKOJUN', 'FKOTEICD', 'FSEZONO', 'FUPDTEDT'],
    dateColumnName: null,
    displayPeriodDays: 365,
    emptyMessage: 'FKOJUNST_Status データはありません',
    columnDefinitions: [
      {
        internalName: 'FKOJUN',
        displayName: '工順',
        csvHeaderCandidates: ['FKOJUN'],
        dataType: 'string',
        order: 0,
        required: true,
      },
      {
        internalName: 'FKOJUNST',
        displayName: '工順ステータス',
        csvHeaderCandidates: ['FKOJUNST'],
        dataType: 'string',
        order: 1,
        required: true,
      },
      {
        internalName: 'FKOTEICD',
        displayName: '工程コード',
        csvHeaderCandidates: ['FKOTEICD'],
        dataType: 'string',
        order: 2,
        required: true,
      },
      {
        internalName: 'FSEZONO',
        displayName: '製造order番号',
        csvHeaderCandidates: ['FSEZONO'],
        dataType: 'string',
        order: 3,
        required: true,
      },
      {
        internalName: 'FUPDTEDT',
        displayName: '更新日時',
        csvHeaderCandidates: ['FUPDTEDT'],
        dataType: 'string',
        order: 4,
        required: true,
      },
    ],
    templateType: 'TABLE' as const,
    templateConfig: {
      rowsPerPage: 50,
      fontSize: 14,
      displayColumns: ['FKOJUN', 'FKOJUNST', 'FKOTEICD', 'FSEZONO', 'FUPDTEDT'],
      headerFixed: true,
    },
  };
}

export async function ensureProductionScheduleFkojunstStatusMailDashboard(
  prismaClient: {
    csvDashboard: {
      upsert: (args: {
        where: { id: string };
        update: ReturnType<typeof buildProductionScheduleFkojunstStatusMailDashboardDefinition>;
        create: { id: string } & ReturnType<typeof buildProductionScheduleFkojunstStatusMailDashboardDefinition>;
      }) => Promise<unknown>;
    };
  }
): Promise<void> {
  const definition = buildProductionScheduleFkojunstStatusMailDashboardDefinition();
  await prismaClient.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID },
    update: definition,
    create: {
      id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      ...definition,
    },
  });
}
