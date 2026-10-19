import { SCAW_STFUTEKIGO_DASHBOARD_ID, SCAW_STFUTEKIGO_SUBJECT_PATTERN } from './constants.js';

export function buildScawStfutekigoDashboardDefinition() {
  const columns = [
    ['originDepartmentCode', '起因部署コード', 'FKIINBUSHOCD'],
    ['originDepartmentName', '起因部署名', 'FBUSHOMEI'],
    ['quantity', '数量', 'FFUTEKIGOSU'],
    ['remarks', '備考/概要', 'FBIKO'],
    ['nonconformityContent', '不適合内容', 'FFUTEKIGONAIYO'],
    ['correctiveContent1', '個別是正内容1', 'FZESEINAIYO1'],
    ['correctiveContent2', '個別是正内容2', 'FZESEINAIYO2'],
    ['dispositionContent', '処置内容', 'FSHOTINAIYO'],
    ['discoveredOn', '発見日', 'FHAKKENYMD'],
    ['sourceUpdatedOn', '更新日', 'FUPDTEDT'],
    ['manufacturingOrderNo', '製造order番号', 'FSEZONO'],
    ['sourceSeiban', '製番', 'FSEIBAN'],
    ['qaIssueCode', '品証独自番号', 'FFUTEKIGOHINCD'],
    ['nonconformityNo', '不適合番号', 'FFUTEKIGONO'],
    ['dispositionOn', '処置日', 'FSHOTIYMD'],
    ['drawingNumber', '図面番号', 'FZUMENNO'],
  ] as const;

  return {
    name: 'ScawStFutekigo',
    description: `不適合全件スナップショット（Gmail件名: ${SCAW_STFUTEKIGO_SUBJECT_PATTERN}）`,
    gmailSubjectPattern: SCAW_STFUTEKIGO_SUBJECT_PATTERN,
    enabled: true,
    ingestMode: 'APPEND' as const,
    dedupKeyColumns: [] as string[],
    dateColumnName: 'discoveredOn',
    displayPeriodDays: 36500,
    emptyMessage: '不適合データはありません',
    columnDefinitions: columns.map(([internalName, displayName, csvHeader]) => ({
      internalName,
      displayName,
      csvHeaderCandidates: [csvHeader],
      // Keep source values as strings: the domain normalizer owns exact Decimal/date parsing.
      dataType: 'string',
      order: columns.findIndex(([name]) => name === internalName),
      required: true,
    })),
    templateType: 'TABLE' as const,
    templateConfig: {
      rowsPerPage: 50,
      fontSize: 14,
      displayColumns: columns.map(([internalName]) => internalName),
      headerFixed: true,
    },
  };
}

export async function ensureScawStfutekigoDashboard(
  prismaClient: {
    csvDashboard: {
      upsert: (args: {
        where: { id: string };
        update: ReturnType<typeof buildScawStfutekigoDashboardDefinition>;
        create: { id: string } & ReturnType<typeof buildScawStfutekigoDashboardDefinition>;
      }) => Promise<unknown>;
    };
  }
): Promise<void> {
  const definition = buildScawStfutekigoDashboardDefinition();
  await prismaClient.csvDashboard.upsert({
    where: { id: SCAW_STFUTEKIGO_DASHBOARD_ID },
    update: definition,
    create: { id: SCAW_STFUTEKIGO_DASHBOARD_ID, ...definition },
  });
}
