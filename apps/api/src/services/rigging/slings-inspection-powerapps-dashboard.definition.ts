import {
  RIGGING_SLINGS_INSPECTION_GMAIL_SUBJECT,
  RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID,
} from './constants.js';

export function buildRiggingSlingsInspectionPowerappsDashboardDefinition() {
  return {
    name: 'RiggingSlingsInspection_PowerApps',
    description: '吊具点検記録（PowerApps / Gmail件名: slingsInspectionRecord_PowerApps）',
    gmailSubjectPattern: RIGGING_SLINGS_INSPECTION_GMAIL_SUBJECT,
    enabled: true,
    ingestMode: 'APPEND' as const,
    dedupKeyColumns: [] as string[],
    dateColumnName: 'inspectedAt',
    displayPeriodDays: 7,
    emptyMessage: '吊具点検記録はありません',
    columnDefinitions: [
      {
        internalName: 'itemName',
        displayName: '品名',
        csvHeaderCandidates: ['ItemName', 'itemName'],
        dataType: 'string',
        order: 0,
        required: false,
      },
      {
        internalName: 'idNum',
        displayName: '旧番号',
        csvHeaderCandidates: ['ID_num', 'idNum'],
        dataType: 'string',
        order: 1,
        required: false,
      },
      {
        internalName: 'inspectorName',
        displayName: '点検者',
        csvHeaderCandidates: ['name', 'inspectorName'],
        dataType: 'string',
        order: 2,
        required: true,
      },
      {
        internalName: 'result',
        displayName: '結果',
        csvHeaderCandidates: ['result'],
        dataType: 'string',
        order: 3,
        required: true,
      },
      {
        internalName: 'inspectedAt',
        displayName: '点検日時',
        csvHeaderCandidates: ['date', 'inspectedAt'],
        dataType: 'date',
        order: 4,
        required: true,
      },
      {
        internalName: 'locationName',
        displayName: '場所名',
        csvHeaderCandidates: ['locationName'],
        dataType: 'string',
        order: 5,
        required: false,
      },
      {
        internalName: 'locationNo',
        displayName: '場所番号',
        csvHeaderCandidates: ['locationNo'],
        dataType: 'string',
        order: 6,
        required: false,
      },
      {
        internalName: 'managementNumber',
        displayName: '管理番号',
        csvHeaderCandidates: ['control_num', 'managementNumber'],
        dataType: 'string',
        order: 7,
        required: false,
      },
    ],
    templateType: 'TABLE' as const,
    templateConfig: {
      rowsPerPage: 50,
      fontSize: 14,
      displayColumns: [
        'itemName',
        'managementNumber',
        'idNum',
        'inspectorName',
        'result',
        'inspectedAt',
        'locationName',
      ],
      headerFixed: true,
    },
  };
}

export async function ensureRiggingSlingsInspectionPowerappsDashboard(
  prismaClient: {
    csvDashboard: {
      upsert: (args: {
        where: { id: string };
        update: ReturnType<typeof buildRiggingSlingsInspectionPowerappsDashboardDefinition>;
        create: { id: string } & ReturnType<typeof buildRiggingSlingsInspectionPowerappsDashboardDefinition>;
      }) => Promise<unknown>;
    };
  }
): Promise<void> {
  const definition = buildRiggingSlingsInspectionPowerappsDashboardDefinition();
  await prismaClient.csvDashboard.upsert({
    where: { id: RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID },
    update: definition,
    create: {
      id: RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID,
      ...definition,
    },
  });
}

export { RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID };
