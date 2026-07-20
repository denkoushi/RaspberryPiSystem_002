import ExcelJS from 'exceljs';
import { ApiError } from '../../lib/errors.js';
import { AssemblyTraceabilityService } from './assembly-traceability.service.js';
import { AssemblyWorkSessionService, type AssemblyWorkSessionDetail } from './assembly-work-session.service.js';

function fmtDate(date: Date | null | undefined): string {
  return date ? date.toISOString().replace('T', ' ').slice(0, 19) : '';
}

function decimalNumber(value: { toString(): string } | number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function latestAcceptedRecordByBolt(session: AssemblyWorkSessionDetail): Map<string, AssemblyWorkSessionDetail['torqueRecords'][number]> {
  const result = new Map<string, AssemblyWorkSessionDetail['torqueRecords'][number]>();
  for (const record of session.torqueRecords) {
    if (record.accepted && record.judgement === 'OK') {
      result.set(record.templateBoltId, record);
    }
  }
  return result;
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE5E7EB' }
  };
  row.alignment = { vertical: 'middle' };
}

export class AssemblyExcelExportService {
  constructor(
    private readonly sessionService = new AssemblyWorkSessionService(),
    private readonly traceabilityService = new AssemblyTraceabilityService()
  ) {}

  async buildSessionWorkbookBuffer(sessionId: string): Promise<Buffer> {
    const session = await this.sessionService.getDetail(sessionId);
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');
    const traceability = await this.traceabilityService.exportTraceabilityForSession(sessionId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'RaspberryPiSystem_002';
    workbook.created = new Date();
    workbook.modified = new Date();

    this.addSummarySheet(workbook, session, traceability);
    this.addResultSheet(workbook, session);
    this.addNgHistorySheet(workbook, session);
    this.addTraceabilityHistorySheet(workbook, traceability);

    const raw = await workbook.xlsx.writeBuffer();
    return Buffer.from(raw);
  }

  private addSummarySheet(
    workbook: ExcelJS.Workbook,
    session: AssemblyWorkSessionDetail,
    traceability: Awaited<ReturnType<AssemblyTraceabilityService['exportTraceabilityForSession']>>
  ): void {
    const sheet = workbook.addWorksheet('概要');
    sheet.columns = [
      { header: '項目', key: 'label', width: 24 },
      { header: '内容', key: 'value', width: 44 }
    ];
    styleHeader(sheet.getRow(1));
    const rows = [
      ['作業ID', session.id],
      ['状態', session.status],
      ['型番/FHINCD', session.template.modelCode],
      ['手順パターン', session.template.procedurePattern],
      ['テンプレート名', `${session.template.name} v${session.template.version}`],
      ['製番/M番号', session.productNo],
      ['作業用ID', session.workId],
      ['正式ID', traceability?.root.formalIdentifier?.formalId ?? ''],
      ['銘板No.', session.nameplateNo],
      ['作業者', session.operatorNameSnapshot],
      ['対象ユニット', session.targetUnit],
      ['使用トルクレンチ', session.torqueWrenchId],
      ['開始日時', fmtDate(session.startedAt)],
      ['完了日時', fmtDate(session.completedAt)],
      ['取消日時', fmtDate(session.cancelledAt)],
      ['手順書', session.template.procedureDocument.name]
    ];
    rows.forEach(([label, value]) => sheet.addRow({ label, value }));
  }

  private addTraceabilityHistorySheet(
    workbook: ExcelJS.Workbook,
    traceability: Awaited<ReturnType<AssemblyTraceabilityService['exportTraceabilityForSession']>>
  ): void {
    const sheet = workbook.addWorksheet('構成・正式ID履歴');
    sheet.columns = [
      { header: '種別', key: 'kind', width: 16 },
      { header: '親作業用ID', key: 'parentWorkId', width: 22 },
      { header: '子作業用ID', key: 'childWorkId', width: 22 },
      { header: '正式ID', key: 'formalId', width: 22 },
      { header: '登録日時', key: 'createdAt', width: 22 },
      { header: '解除・訂正日時', key: 'endedAt', width: 22 },
      { header: '理由', key: 'reason', width: 30 },
      { header: '操作者', key: 'actor', width: 18 }
    ];
    styleHeader(sheet.getRow(1));
    if (!traceability) return;
    for (const link of traceability.compositionHistory) {
      sheet.addRow({
        kind: '構成',
        parentWorkId: link.parentWorkId,
        childWorkId: link.childWorkId,
        createdAt: fmtDate(link.linkedAt),
        endedAt: fmtDate(link.unlinkedAt),
        reason: link.unlinkReason ?? '',
        actor: link.linkedByUsernameSnapshot ?? ''
      });
    }
    for (const assignment of traceability.formalIdentifierHistory) {
      sheet.addRow({
        kind: '正式ID',
        parentWorkId: traceability.root.workUnit.workId,
        formalId: assignment.formalId,
        createdAt: fmtDate(assignment.assignedAt),
        endedAt: fmtDate(assignment.supersededAt),
        reason: assignment.supersedeReason ?? '',
        actor: assignment.assignedByUsernameSnapshot ?? ''
      });
    }
  }

  private addResultSheet(workbook: ExcelJS.Workbook, session: AssemblyWorkSessionDetail): void {
    const sheet = workbook.addWorksheet('締付実績');
    sheet.columns = [
      { header: '工程No.', key: 'processNo', width: 12 },
      { header: 'エリア', key: 'areaName', width: 22 },
      { header: 'ユニット', key: 'unitCode', width: 14 },
      { header: '締付ID', key: 'tighteningId', width: 20 },
      { header: '丸数字', key: 'markerNo', width: 10 },
      { header: 'ボルト仕様', key: 'boltSpec', width: 22 },
      { header: '呼び径', key: 'nominalDiameter', width: 12 },
      { header: '長さ(mm)', key: 'boltLengthMm', width: 12 },
      { header: '材質', key: 'material', width: 14 },
      { header: '強度区分', key: 'strengthClass', width: 12 },
      { header: '規定', key: 'nominalTorque', width: 12 },
      { header: '下限', key: 'lowerLimit', width: 12 },
      { header: '上限', key: 'upperLimit', width: 12 },
      { header: '単位', key: 'unit', width: 10 },
      { header: '実測値', key: 'value', width: 12 },
      { header: '実測単位', key: 'inputUnit', width: 12 },
      { header: '実測値(N·m)', key: 'valueNm', width: 14 },
      { header: '判定', key: 'judgement', width: 10 },
      { header: '製造番号', key: 'serialNumber', width: 18 },
      { header: 'メーカー', key: 'manufacturer', width: 18 },
      { header: '型番', key: 'modelNumber', width: 18 },
      { header: '設定下限', key: 'settingLower', width: 12 },
      { header: '設定規定', key: 'settingNominal', width: 12 },
      { header: '設定上限', key: 'settingUpper', width: 12 },
      { header: '設定単位', key: 'settingUnit', width: 12 },
      { header: '管理者例外理由', key: 'overrideReason', width: 28 },
      { header: '締付日時', key: 'recordedAt', width: 22 },
      { header: 'attempt', key: 'attempt', width: 10 }
    ];
    styleHeader(sheet.getRow(1));
    const latestByBolt = latestAcceptedRecordByBolt(session);
    for (const area of session.template.areas) {
      for (const bolt of area.bolts) {
        const record = latestByBolt.get(bolt.id);
        sheet.addRow({
          processNo: area.processNo,
          areaName: area.areaName,
          unitCode: area.unitCode,
          tighteningId: bolt.tighteningId,
          markerNo: bolt.markerNo,
          boltSpec: bolt.boltSpec,
          nominalDiameter: bolt.nominalDiameter ?? '',
          boltLengthMm: decimalNumber(bolt.boltLengthMm),
          material: bolt.material ?? '',
          strengthClass: bolt.strengthClass ?? '',
          nominalTorque: decimalNumber(bolt.nominalTorque),
          lowerLimit: decimalNumber(bolt.lowerLimit),
          upperLimit: decimalNumber(bolt.upperLimit),
          unit: bolt.unit,
          value: decimalNumber(record?.value),
          inputUnit: record?.inputUnit ?? '',
          valueNm: decimalNumber(record?.valueNm),
          judgement: record?.judgement ?? '未入力',
          serialNumber: record?.serialNumberSnapshot ?? '',
          manufacturer: record?.manufacturerSnapshot ?? '',
          modelNumber: record?.modelNumberSnapshot ?? '',
          settingLower: decimalNumber(record?.settingLowerLimitSnapshot),
          settingNominal: decimalNumber(record?.settingNominalTorqueSnapshot),
          settingUpper: decimalNumber(record?.settingUpperLimitSnapshot),
          settingUnit: record?.settingUnitSnapshot ?? '',
          overrideReason: record?.overrideReason ?? '',
          recordedAt: fmtDate(record?.recordedAt),
          attempt: record?.attempt ?? ''
        });
      }
    }
    sheet.getColumn('nominalTorque').numFmt = '0.000';
    sheet.getColumn('lowerLimit').numFmt = '0.000';
    sheet.getColumn('upperLimit').numFmt = '0.000';
    sheet.getColumn('value').numFmt = '0.000';
    sheet.getColumn('valueNm').numFmt = '0.000000';
  }

  private addNgHistorySheet(workbook: ExcelJS.Workbook, session: AssemblyWorkSessionDetail): void {
    const sheet = workbook.addWorksheet('NG履歴');
    sheet.columns = [
      { header: '締付ID', key: 'tighteningId', width: 20 },
      { header: '工程No.', key: 'processNo', width: 12 },
      { header: 'エリア', key: 'areaName', width: 22 },
      { header: 'attempt', key: 'attempt', width: 10 },
      { header: '実測値', key: 'value', width: 12 },
      { header: '実測単位', key: 'inputUnit', width: 12 },
      { header: '実測値(N·m)', key: 'valueNm', width: 14 },
      { header: '製造番号', key: 'serialNumber', width: 18 },
      { header: 'メーカー', key: 'manufacturer', width: 18 },
      { header: '型番', key: 'modelNumber', width: 18 },
      { header: '判定', key: 'judgement', width: 10 },
      { header: '無視理由', key: 'ignoredReason', width: 24 },
      { header: '入力元', key: 'inputSource', width: 12 },
      { header: '管理者例外理由', key: 'overrideReason', width: 28 },
      { header: '日時', key: 'recordedAt', width: 22 }
    ];
    styleHeader(sheet.getRow(1));
    for (const record of session.torqueRecords) {
      if (record.judgement === 'OK') continue;
      sheet.addRow({
        tighteningId: record.templateBolt.tighteningId,
        processNo: record.templateBolt.area.processNo,
        areaName: record.templateBolt.area.areaName,
        attempt: record.attempt,
        value: decimalNumber(record.value),
        inputUnit: record.inputUnit ?? '',
        valueNm: decimalNumber(record.valueNm),
        serialNumber: record.serialNumberSnapshot ?? '',
        manufacturer: record.manufacturerSnapshot ?? '',
        modelNumber: record.modelNumberSnapshot ?? '',
        judgement: record.judgement,
        ignoredReason: record.ignoredReason ?? '',
        inputSource: record.inputSource,
        overrideReason: record.overrideReason ?? '',
        recordedAt: fmtDate(record.recordedAt)
      });
    }
    sheet.getColumn('value').numFmt = '0.000';
    sheet.getColumn('valueNm').numFmt = '0.000000';
  }
}
