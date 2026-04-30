import { PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID } from './constants.js';

export function buildProductionScheduleCustomerScawDashboardDefinition() {
  return {
    name: 'ProductionSchedule_CustomerSCAW',
    description: '生産日程 製番→顧客名（Gmail件名: CustomerSCAW）',
    gmailSubjectPattern: 'CustomerSCAW',
    enabled: true,
    ingestMode: 'APPEND' as const,
    dedupKeyColumns: [] as string[],
    dateColumnName: null,
    displayPeriodDays: 365,
    emptyMessage: 'CustomerSCAW データはありません',
    columnDefinitions: [
      {
        internalName: 'Customer',
        displayName: '顧客',
        csvHeaderCandidates: ['Customer', '顧客'],
        dataType: 'string',
        order: 0,
        required: true,
      },
      {
        internalName: 'FANKENMEI',
        displayName: '機種名（顧客SCAW）',
        csvHeaderCandidates: ['FANKENMEI'],
        dataType: 'string',
        order: 1,
        required: true,
      },
      {
        internalName: 'FANKENYMD',
        displayName: '顧客SCAW基準日',
        csvHeaderCandidates: ['FANKENYMD'],
        dataType: 'string',
        order: 2,
        required: false,
      },
    ],
    templateType: 'TABLE' as const,
    templateConfig: {
      rowsPerPage: 50,
      fontSize: 14,
      displayColumns: ['Customer', 'FANKENMEI', 'FANKENYMD'],
      headerFixed: true,
    },
  };
}

export async function ensureProductionScheduleCustomerScawDashboard(
  prismaClient: {
    csvDashboard: {
      upsert: (args: {
        where: { id: string };
        update: ReturnType<typeof buildProductionScheduleCustomerScawDashboardDefinition>;
        create: { id: string } & ReturnType<typeof buildProductionScheduleCustomerScawDashboardDefinition>;
      }) => Promise<unknown>;
    };
  }
): Promise<void> {
  const definition = buildProductionScheduleCustomerScawDashboardDefinition();
  await prismaClient.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID },
    update: definition,
    create: {
      id: PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID,
      ...definition,
    },
  });
}
