import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyExcelExportService } from '../assembly-excel-export.service.js';

type SettingMode = 'BOLT_CONDITION_ONLY' | 'REGISTERED_SETTING' | null;

const SESSION_ID = 'optional-settings-export-session';

function makeSession(mode: SettingMode, setting: {
  lower: number | null;
  nominal: number | null;
  upper: number | null;
  unit: string | null;
}) {
  const bolt = {
    id: 'optional-settings-bolt',
    tighteningId: 'T-001',
    markerNo: 1,
    boltSpec: 'M10x35 SCM435 10.9',
    nominalDiameter: 'M10',
    boltLengthMm: 35,
    material: 'SCM435',
    strengthClass: '10.9',
    nominalTorque: 30,
    lowerLimit: 28,
    upperLimit: 32,
    unit: 'N·m'
  };

  return {
    id: SESSION_ID,
    status: 'COMPLETED',
    productNo: 'OPTIONAL-EXPORT-PRODUCT',
    workId: 'OPTIONAL-EXPORT-WORK',
    nameplateNo: 'OPTIONAL-EXPORT-NAMEPLATE',
    operatorNameSnapshot: 'Export Operator',
    targetUnit: 'OPTIONAL',
    torqueWrenchId: null,
    startedAt: new Date('2026-08-27T00:00:00.000Z'),
    completedAt: new Date('2026-08-27T00:01:00.000Z'),
    cancelledAt: null,
    template: {
      modelCode: 'OPTIONAL-EXPORT-MODEL',
      procedurePattern: 'standard',
      name: 'Optional settings export',
      version: 1,
      procedureDocument: { name: 'Optional settings procedure' },
      areas: [{
        processNo: '1',
        areaName: 'tightening',
        unitCode: 'U1',
        bolts: [bolt]
      }]
    },
    torqueRecords: [{
      templateBoltId: bolt.id,
      accepted: true,
      judgement: 'OK',
      value: 30,
      inputUnit: 'N·m',
      valueNm: 30,
      settingVerificationMode: mode,
      settingLowerLimitSnapshot: setting.lower,
      settingNominalTorqueSnapshot: setting.nominal,
      settingUpperLimitSnapshot: setting.upper,
      settingUnitSnapshot: setting.unit,
      recordedAt: new Date('2026-08-27T00:00:30.000Z'),
      attempt: 1,
      serialNumberSnapshot: 'OPTIONAL-EXPORT-SERIAL',
      manufacturerSnapshot: 'TOHNICHI',
      modelNumberSnapshot: 'OPTIONAL-EXPORT-WRENCH',
      overrideReason: null,
      templateBolt: {
        tighteningId: bolt.tighteningId,
        area: {
          processNo: '1',
          areaName: 'tightening'
        }
      }
    }],
    checkRecords: [],
    restartLogs: [],
    operatorAccesses: [],
    approval: null,
    workUnit: null
  };
}

async function exportWorkbook(session: ReturnType<typeof makeSession>) {
  const getDetail = vi.fn().mockResolvedValue(session);
  const exportTraceabilityForSession = vi.fn().mockResolvedValue(null);
  const service = new AssemblyExcelExportService(
    { getDetail } as unknown as ConstructorParameters<typeof AssemblyExcelExportService>[0],
    { exportTraceabilityForSession } as unknown as ConstructorParameters<typeof AssemblyExcelExportService>[1]
  );

  const buffer = await service.buildSessionWorkbookBuffer(SESSION_ID);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  expect(getDetail).toHaveBeenCalledWith(SESSION_ID);
  expect(exportTraceabilityForSession).toHaveBeenCalledWith(SESSION_ID);
  return workbook;
}

function exportedCell(workbook: ExcelJS.Workbook, header: string, rowNumber = 2): ExcelJS.CellValue {
  const sheet = workbook.getWorksheet('締付実績');
  if (!sheet) throw new Error('締付実績 sheet is missing');

  let columnNumber = 0;
  sheet.getRow(1).eachCell((cell, column) => {
    if (cell.value === header) columnNumber = column;
  });
  if (!columnNumber) throw new Error(`header is missing: ${header}`);
  return sheet.getCell(rowNumber, columnNumber).value;
}

describe('AssemblyExcelExportService optional setting evidence', () => {
  it('labels BOLT setting cells as out of scope while retaining bolt target values', async () => {
    const workbook = await exportWorkbook(makeSession('BOLT_CONDITION_ONLY', {
      lower: null,
      nominal: null,
      upper: null,
      unit: null
    }));

    expect(exportedCell(workbook, '設定照合方式')).toBe('設定照合対象外');
    expect(exportedCell(workbook, '設定下限')).toBe('対象外');
    expect(exportedCell(workbook, '設定規定')).toBe('対象外');
    expect(exportedCell(workbook, '設定上限')).toBe('対象外');
    expect(exportedCell(workbook, '設定単位')).toBe('対象外');
    expect(exportedCell(workbook, '規定')).toBe(30);
    expect(exportedCell(workbook, '下限')).toBe(28);
    expect(exportedCell(workbook, '上限')).toBe(32);
    expect(exportedCell(workbook, '単位')).toBe('N·m');
  });

  it.each([
    { label: 'REGISTERED_SETTING', mode: 'REGISTERED_SETTING' as const },
    { label: 'legacy null', mode: null }
  ])('preserves historical setting values for $label mode', async ({ mode }) => {
    const workbook = await exportWorkbook(makeSession(mode, {
      lower: 29,
      nominal: 31,
      upper: 33,
      unit: 'N·m'
    }));

    expect(exportedCell(workbook, '設定照合方式')).toBe('登録設定を照合');
    expect(exportedCell(workbook, '設定下限')).toBe(29);
    expect(exportedCell(workbook, '設定規定')).toBe(31);
    expect(exportedCell(workbook, '設定上限')).toBe(33);
    expect(exportedCell(workbook, '設定単位')).toBe('N·m');
    expect(exportedCell(workbook, '規定')).toBe(30);
    expect(exportedCell(workbook, '下限')).toBe(28);
    expect(exportedCell(workbook, '上限')).toBe(32);
  });
});
