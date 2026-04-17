import { PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from './constants.js';

export function buildProductionScheduleSeibanMachineNameSupplementDashboardDefinition() {
  return {
    name: 'ProductionSchedule_SeibanMachineNameSupplement',
    description: '生産日程 製番→機種名補完（Gmail件名: FHINMEI_MH_SH）',
    gmailSubjectPattern: 'FHINMEI_MH_SH',
    enabled: true,
    ingestMode: 'APPEND' as const,
    dedupKeyColumns: [] as string[],
    dateColumnName: null,
    displayPeriodDays: 365,
    emptyMessage: '機種名補完データはありません',
    columnDefinitions: [
      {
        internalName: 'FSEIBAN',
        displayName: '製番',
        csvHeaderCandidates: ['FSEIBAN', '製番'],
        dataType: 'string',
        order: 0,
        required: true,
      },
      {
        internalName: 'FHINMEI_MH_SH',
        displayName: '機種名（MH/SH補完）',
        csvHeaderCandidates: ['FHINMEI_MH_SH', '機種名'],
        dataType: 'string',
        order: 1,
        required: true,
      },
    ],
    templateType: 'TABLE' as const,
    templateConfig: {
      rowsPerPage: 50,
      fontSize: 14,
      displayColumns: ['FSEIBAN', 'FHINMEI_MH_SH'],
      headerFixed: true,
    },
  };
}

export async function ensureProductionScheduleSeibanMachineNameSupplementDashboard(
  prismaClient: {
    csvDashboard: {
      upsert: (args: {
        where: { id: string };
        update: ReturnType<typeof buildProductionScheduleSeibanMachineNameSupplementDashboardDefinition>;
        create: { id: string } & ReturnType<typeof buildProductionScheduleSeibanMachineNameSupplementDashboardDefinition>;
      }) => Promise<unknown>;
    };
  }
): Promise<void> {
  const definition = buildProductionScheduleSeibanMachineNameSupplementDashboardDefinition();
  await prismaClient.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
    update: definition,
    create: {
      id: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
      ...definition,
    },
  });
}
