import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import type { CsvImportConfigService } from '../csv-import-config.service.js';
import { MeasuringInstrumentCsvImporter } from '../importers/measuring-instrument.js';

const mocks = vi.hoisted(() => ({
  measuringInstrument: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  measuringInstrumentTag: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  loan: { findMany: vi.fn() },
  inspectionRecord: { findMany: vi.fn() },
  machineNfcTag: { findUnique: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => {
  const tx = {
    measuringInstrument: mocks.measuringInstrument,
    measuringInstrumentTag: mocks.measuringInstrumentTag,
    machineNfcTag: mocks.machineNfcTag,
  };
  return {
    prisma: {
      measuringInstrument: mocks.measuringInstrument,
      loan: mocks.loan,
      inspectionRecord: mocks.inspectionRecord,
      $transaction: async (run: (client: unknown) => unknown) => run(tx),
    },
  };
});

const config = { getEffectiveConfig: vi.fn() };
const importer = () => new MeasuringInstrumentCsvImporter(config as unknown as CsvImportConfigService);
const csv = (text: string) => Buffer.from(text, 'utf-8');

describe('MeasuringInstrumentCsvImporter.parse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.getEffectiveConfig.mockResolvedValue(null);
  });

  it('parses ISO calibration dates and normalizes status case-insensitively', async () => {
    const rows = await importer().parse(
      csv('name,managementNumber,calibrationExpiryDate,status\nノギス,MI-001,2026-03-31,maintenance\n'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].calibrationExpiryDate).toEqual(new Date('2026-03-31T00:00:00.000Z'));
    expect(rows[0].status).toBe('MAINTENANCE');
  });

  it('turns blank or unparseable calibration dates into null instead of failing the row', async () => {
    const rows = await importer().parse(
      csv('name,managementNumber,calibrationExpiryDate\nA,MI-001,\nB,MI-002,令和8年3月31日\nC,MI-003,2026-13-45\n'),
    );
    expect(rows.map(row => row.calibrationExpiryDate)).toEqual([null, null, null]);
  });

  it('defaults blank or unknown status to AVAILABLE', async () => {
    const rows = await importer().parse(csv('name,managementNumber,status\nA,MI-001,\nB,MI-002,校正中\nC,MI-003,RETIRED\n'));
    expect(rows.map(row => row.status)).toEqual(['AVAILABLE', 'AVAILABLE', 'RETIRED']);
  });

  it('defaults status to AVAILABLE when the column is missing', async () => {
    const rows = await importer().parse(csv('name,managementNumber\nA,MI-001\n'));
    expect(rows[0]).toEqual({ name: 'A', managementNumber: 'MI-001', calibrationExpiryDate: null, status: 'AVAILABLE' });
  });

  it.each([
    ['blank name', 'name,managementNumber\n,MI-001', '名称は必須です'],
    ['blank managementNumber', 'name,managementNumber\nノギス,', '管理番号は必須です'],
  ])('rejects rows with %s', async (_label, body, message) => {
    const error = await importer().parse(csv(`${body}\n`)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toContain('計測機器CSVの2行目でエラー');
    expect((error as ApiError).message).toContain(message);
  });

  it('rejects a CSV without the name column at all', async () => {
    const error = await importer().parse(csv('managementNumber\nMI-001\n')).catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toContain('計測機器CSVの2行目でエラー');
    expect((error as ApiError).message).toContain('"name"');
  });
});

describe('MeasuringInstrumentCsvImporter.import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.machineNfcTag.findUnique.mockResolvedValue(null);
    mocks.measuringInstrumentTag.findUnique.mockResolvedValue(null);
    mocks.loan.findMany.mockResolvedValue([]);
    mocks.inspectionRecord.findMany.mockResolvedValue([]);
  });

  it('creates instrument and its RFID tag', async () => {
    mocks.measuringInstrument.findUnique.mockResolvedValue(null);
    mocks.measuringInstrument.create.mockResolvedValue({ id: 'mi-new' });
    const rows = await importer().parse(csv('name,managementNumber,rfidTagUid,department\nノギス,MI-001, E200AA ,品証\n'));
    const summary = await importer().import(rows, false);

    expect(summary).toEqual({ processed: 1, created: 1, updated: 0 });
    expect(mocks.measuringInstrument.create).toHaveBeenCalledWith({
      data: {
        name: 'ノギス',
        managementNumber: 'MI-001',
        storageLocation: undefined,
        department: '品証',
        measurementRange: undefined,
        calibrationExpiryDate: undefined,
        status: 'AVAILABLE',
      },
    });
    expect(mocks.measuringInstrumentTag.create).toHaveBeenCalledWith({ data: { measuringInstrumentId: 'mi-new', rfidTagUid: 'E200AA' } });
  });

  it('rejects duplicate RFID UIDs within a CSV (trimmed) before the transaction', async () => {
    const error = await importer()
      .import(
        [
          { name: 'A', managementNumber: 'MI-001', rfidTagUid: 'E2', status: 'AVAILABLE', calibrationExpiryDate: null },
          { name: 'B', managementNumber: 'MI-002', rfidTagUid: 'E2 ', status: 'AVAILABLE', calibrationExpiryDate: null },
        ],
        false,
      )
      .catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toBe('CSV内でrfidTagUidが重複しています: rfidTagUid="E2" (managementNumber: MI-001, MI-002)');
    expect(mocks.measuringInstrument.findUnique).not.toHaveBeenCalled();
  });

  it('rejects creating with a tag that belongs to another instrument and names that instrument', async () => {
    mocks.measuringInstrument.findUnique
      .mockResolvedValueOnce(null) // lookup by managementNumber
      .mockResolvedValueOnce({ id: 'mi-other', managementNumber: 'MI-999' }); // tag owner
    mocks.measuringInstrumentTag.findUnique.mockResolvedValue({ measuringInstrumentId: 'mi-other', rfidTagUid: 'E2' });
    const error = await importer()
      .import([{ name: 'A', managementNumber: 'MI-001', rfidTagUid: 'E2', status: 'AVAILABLE', calibrationExpiryDate: null }], false)
      .catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toBe('rfidTagUid="E2"は既に他の計測機器（managementNumber: MI-999）で使用されています。');
    expect(mocks.measuringInstrument.create).not.toHaveBeenCalled();
  });

  it('rejects updating with a tag owned by another instrument', async () => {
    mocks.measuringInstrument.findUnique.mockResolvedValue({ id: 'mi-1', managementNumber: 'MI-001', name: 'A', status: 'AVAILABLE' });
    mocks.measuringInstrumentTag.findUnique.mockResolvedValue({ measuringInstrumentId: 'mi-other', rfidTagUid: 'E2' });
    const error = await importer()
      .import([{ name: 'A', managementNumber: 'MI-001', rfidTagUid: 'E2', status: 'AVAILABLE', calibrationExpiryDate: null }], false)
      .catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(400);
    // NOTE: possible bug: the message names the instrument being updated (MI-001), not the tag owner (mi-other),
    // so operators are pointed at the wrong record.
    expect((error as ApiError).message).toBe('rfidTagUid="E2"は既に他の計測機器（managementNumber: MI-001）で使用されています。');
    expect(mocks.measuringInstrument.update).not.toHaveBeenCalled();
  });

  it('skips the update when the diff is empty and upserts the tag for the same instrument', async () => {
    mocks.measuringInstrumentTag.findUnique.mockResolvedValue({ measuringInstrumentId: 'mi-1', rfidTagUid: 'E2' });
    const rows = await importer().parse(
      csv('name,managementNumber,storageLocation,department,measurementRange,rfidTagUid\nA,MI-001,棚1,品証,0-150mm,E2\n'),
    );
    // The DB row has no calibrationExpiryDate key so `undefined` matches; with a real null it would not (see next test).
    mocks.measuringInstrument.findUnique.mockResolvedValue({
      id: 'mi-1', managementNumber: 'MI-001', name: 'A', storageLocation: '棚1', department: '品証',
      measurementRange: '0-150mm', status: 'AVAILABLE',
    });
    const summary = await importer().import(rows, false);
    expect(summary).toEqual({ processed: 1, created: 0, updated: 0 });
    expect(mocks.measuringInstrument.update).not.toHaveBeenCalled();
    expect(mocks.measuringInstrumentTag.upsert).toHaveBeenCalledWith({
      where: { rfidTagUid: 'E2' },
      update: { measuringInstrumentId: 'mi-1' },
      create: { measuringInstrumentId: 'mi-1', rfidTagUid: 'E2' },
    });
  });

  it('reports an update when DB optional fields are null and the CSV omits them', async () => {
    mocks.measuringInstrument.findUnique.mockResolvedValue({
      id: 'mi-1', managementNumber: 'MI-001', name: 'A', storageLocation: null, department: null,
      measurementRange: null, calibrationExpiryDate: null, status: 'AVAILABLE',
    });
    const summary = await importer().import(
      [{ name: 'A', managementNumber: 'MI-001', status: 'AVAILABLE', calibrationExpiryDate: null }],
      false,
    );
    // NOTE: possible bug: `?? undefined` vs DB null is never Object.is-equal, so an identical re-import
    // counts as updated and issues an update whose fields are all undefined (a no-op write in Prisma).
    expect(summary.updated).toBe(1);
    expect(mocks.measuringInstrument.update).toHaveBeenCalledWith({
      where: { managementNumber: 'MI-001' },
      data: { storageLocation: undefined, department: undefined, measurementRange: undefined, calibrationExpiryDate: undefined },
    });
  });

  it('counts an unchanged calibration date as an update because Date objects are compared by identity', async () => {
    mocks.measuringInstrument.findUnique.mockResolvedValue({
      id: 'mi-1', managementNumber: 'MI-001', name: 'A', calibrationExpiryDate: new Date('2026-03-31T00:00:00Z'), status: 'AVAILABLE',
    });
    const summary = await importer().import(
      [{ name: 'A', managementNumber: 'MI-001', status: 'AVAILABLE', calibrationExpiryDate: new Date('2026-03-31T00:00:00Z') }],
      false,
    );
    // NOTE: possible bug: buildUpdateDiff uses Object.is, so equal dates always look changed
    // and re-imports of identical CSVs inflate `updated` and issue no-op writes.
    expect(summary.updated).toBe(1);
    expect(mocks.measuringInstrument.update).toHaveBeenCalledWith({
      where: { managementNumber: 'MI-001' },
      data: { calibrationExpiryDate: new Date('2026-03-31T00:00:00Z') },
    });
  });

  it('does not remove an existing tag when the CSV rfidTagUid is blank', async () => {
    mocks.measuringInstrument.findUnique.mockResolvedValue({ id: 'mi-1', managementNumber: 'MI-001', name: 'A', status: 'AVAILABLE' });
    await importer().import([{ name: 'A', managementNumber: 'MI-001', rfidTagUid: '', status: 'AVAILABLE', calibrationExpiryDate: null }], false);
    // NOTE: possible bug: the "空文字の場合はタグを削除" branch is unreachable because blank UIDs become null first.
    expect(mocks.measuringInstrumentTag.deleteMany).not.toHaveBeenCalled();
    expect(mocks.measuringInstrumentTag.upsert).not.toHaveBeenCalled();
  });

  it('blocks UIDs already bound to a machine NFC tag', async () => {
    mocks.machineNfcTag.findUnique.mockResolvedValue({ id: 'm1' });
    const error = await importer()
      .import([{ name: 'A', managementNumber: 'MI-001', rfidTagUid: 'E2', status: 'AVAILABLE', calibrationExpiryDate: null }], false)
      .catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(409);
    expect(mocks.measuringInstrument.findUnique).not.toHaveBeenCalled();
  });

  it('replaceExisting protects instruments with active loans or inspection records', async () => {
    mocks.loan.findMany.mockResolvedValue([{ measuringInstrumentId: 'mi-loan' }, { measuringInstrumentId: null }]);
    mocks.inspectionRecord.findMany.mockResolvedValue([{ measuringInstrumentId: 'mi-insp' }, { measuringInstrumentId: 'mi-loan' }]);
    mocks.measuringInstrument.findUnique.mockResolvedValue(null);
    mocks.measuringInstrument.create.mockResolvedValue({ id: 'new' });
    await importer().import([{ name: 'A', managementNumber: 'MI-001', status: 'AVAILABLE', calibrationExpiryDate: null }], true);
    expect(mocks.loan.findMany).toHaveBeenCalledWith({ where: { returnedAt: null }, select: { measuringInstrumentId: true } });
    expect(mocks.measuringInstrument.deleteMany).toHaveBeenCalledWith({ where: { id: { notIn: ['mi-loan', 'mi-insp'] } } });
  });

  it('replaceExisting deletes all instruments when nothing is protected', async () => {
    mocks.measuringInstrument.findUnique.mockResolvedValue(null);
    mocks.measuringInstrument.create.mockResolvedValue({ id: 'new' });
    await importer().import([{ name: 'A', managementNumber: 'MI-001', status: 'AVAILABLE', calibrationExpiryDate: null }], true);
    expect(mocks.measuringInstrument.deleteMany).toHaveBeenCalledWith();
  });
});
