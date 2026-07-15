import ExcelJS from 'exceljs';
import { ApiError } from '../../lib/errors.js';
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
  constructor(private readonly sessionService = new AssemblyWorkSessionService()) {}

  async buildSessionWorkbookBuffer(sessionId: string): Promise<Buffer> {
    const session = await this.sessionService.getDetail(sessionId);
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'RaspberryPiSystem_002';
    workbook.created = new Date();
    workbook.modified = new Date();

    this.addSummarySheet(workbook, session);
    this.addResultSheet(workbook, session);
    this.addNgHistorySheet(workbook, session);

    const raw = await workbook.xlsx.writeBuffer();
    return Buffer.from(raw);
  }

  private addSummarySheet(workbook: ExcelJS.Workbook, session: AssemblyWorkSessionDetail): void {
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
      ['シリアルNo.', session.serialNo],
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

  private addResultSheet(workbook: ExcelJS.Workbook, session: AssemblyWorkSessionDetail): void {
    const sheet = workbook.addWorksheet('締付実績');
    sheet.columns = [
      { header: '工程No.', key: 'processNo', width: 12 },
      { header: 'エリア', key: 'areaName', width: 22 },
      { header: 'ユニット', key: 'unitCode', width: 14 },
      { header: '締付ID', key: 'tighteningId', width: 20 },
      { header: '丸数字', key: 'markerNo', width: 10 },
      { header: 'ボルト仕様', key: 'boltSpec', width: 22 },
      { header: '規定', key: 'nominalTorque', width: 12 },
      { header: '下限', key: 'lowerLimit', width: 12 },
      { header: '上限', key: 'upperLimit', width: 12 },
      { header: '単位', key: 'unit', width: 10 },
      { header: '実測値', key: 'value', width: 12 },
      { header: '判定', key: 'judgement', width: 10 },
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
          nominalTorque: decimalNumber(bolt.nominalTorque),
          lowerLimit: decimalNumber(bolt.lowerLimit),
          upperLimit: decimalNumber(bolt.upperLimit),
          unit: bolt.unit,
          value: decimalNumber(record?.value),
          judgement: record?.judgement ?? '未入力',
          recordedAt: fmtDate(record?.recordedAt),
          attempt: record?.attempt ?? ''
        });
      }
    }
    sheet.getColumn('nominalTorque').numFmt = '0.000';
    sheet.getColumn('lowerLimit').numFmt = '0.000';
    sheet.getColumn('upperLimit').numFmt = '0.000';
    sheet.getColumn('value').numFmt = '0.000';
  }

  private addNgHistorySheet(workbook: ExcelJS.Workbook, session: AssemblyWorkSessionDetail): void {
    const sheet = workbook.addWorksheet('NG履歴');
    sheet.columns = [
      { header: '締付ID', key: 'tighteningId', width: 20 },
      { header: '工程No.', key: 'processNo', width: 12 },
      { header: 'エリア', key: 'areaName', width: 22 },
      { header: 'attempt', key: 'attempt', width: 10 },
      { header: '実測値', key: 'value', width: 12 },
      { header: '判定', key: 'judgement', width: 10 },
      { header: '無視理由', key: 'ignoredReason', width: 24 },
      { header: '入力元', key: 'inputSource', width: 12 },
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
        judgement: record.judgement,
        ignoredReason: record.ignoredReason ?? '',
        inputSource: record.inputSource,
        recordedAt: fmtDate(record.recordedAt)
      });
    }
    sheet.getColumn('value').numFmt = '0.000';
  }
}
