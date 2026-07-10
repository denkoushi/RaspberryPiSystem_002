/**
 * キオスク UI パフォーマンス計測用のローカル検証データを投入する。
 *
 * 実行例:
 *   cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return \
 *     PHOTO_STORAGE_DIR=/path/to/tmp/perf-storage \
 *     PDF_STORAGE_DIR=/path/to/tmp/perf-storage \
 *     pnpm exec tsx ../../scripts/perf/seed-kiosk-perf-data.ts
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { extractInspectionDrawingAsciiDigits } from '@raspi-system/shared-types';

import { prisma } from '../../apps/api/src/lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
} from '../../apps/api/src/services/production-schedule/constants.js';
import { normalizeMachineNameForCompare } from '../../apps/api/src/services/production-schedule/machine-name-compare.js';

const PERF_PREFIX = 'PERF-';
const LB_DATA_HASH_PREFIX = 'perf-lb-';
const RESOURCE_CDS = ['1', '2', '3', '4', '5', '6'] as const;
const ROWS_PER_RESOURCE = 200;
const KIOSK_DOC_TOTAL = 300;
const KIOSK_DOC_ORDER_COUNT = 20;
const PDF_PAGES_PER_ORDER_DOC = 5;
const DRAWING_COUNT = 6;
const SHEET_COUNT = 3;
const SELF_INSPECTION_COUNT = 3;

const MACHINE_NAME = `${PERF_PREFIX}MACHINE-A`;
const MACHINE_NAME_KEY = normalizeMachineNameForCompare(MACHINE_NAME);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

type SeedManifest = {
  seededAt: string;
  leaderboardRowCount: number;
  resourceCds: string[];
  drawingFilenames: string[];
  partMeasurementSheetIds: string[];
  selfInspectionSessionIds: string[];
  assemblyWorkSessionId: string | null;
  assemblyTemplateId: string | null;
  kioskDocumentCount: number;
  orderKioskDocumentIds: string[];
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} が未設定です`);
  }
  return value;
}

function getPhotoStorageDir(): string {
  return requireEnv('PHOTO_STORAGE_DIR');
}

function getPdfStorageDir(): string {
  return requireEnv('PDF_STORAGE_DIR');
}

function getDrawingsDir(): string {
  return path.join(getPhotoStorageDir(), 'part-measurement-drawings');
}

function getAssemblyProcedureImagesDir(): string {
  return path.join(getPhotoStorageDir(), 'assembly-procedure-images');
}

function getPdfsDir(): string {
  return path.join(getPdfStorageDir(), 'pdfs');
}

function getPdfPagesDir(): string {
  return path.join(getPdfStorageDir(), 'pdf-pages');
}

function manifestPath(): string {
  return path.join(getPdfStorageDir(), 'perf-seed-manifest.json');
}

function buildDummyJapaneseText(targetBytes = 30 * 1024): string {
  const chunk =
    '性能検証用の組立要領書本文です。トルク締付順序・安全確認・部品番号・注意事項を記載します。';
  const unit = Buffer.byteLength(chunk, 'utf8');
  return chunk.repeat(Math.ceil(targetBytes / unit)).slice(0, targetBytes);
}

async function generateNoiseJpeg(
  width: number,
  height: number,
  minBytes: number,
  maxBytes: number,
  seed: number,
): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = 0; i < raw.length; i += 1) {
    raw[i] = Math.floor(rand() * 256);
  }

  let quality = 88;
  let buffer = await sharp(raw, { raw: { width, height, channels } })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (buffer.length < minBytes && quality < 100) {
    quality += 2;
    buffer = await sharp(raw, { raw: { width, height, channels } })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  if (buffer.length > maxBytes) {
    quality = Math.max(55, quality - 10);
    buffer = await sharp(raw, { raw: { width, height, channels } })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  return buffer;
}

async function ensureDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(getDrawingsDir(), { recursive: true }),
    fs.mkdir(getAssemblyProcedureImagesDir(), { recursive: true }),
    fs.mkdir(getPdfsDir(), { recursive: true }),
    fs.mkdir(getPdfPagesDir(), { recursive: true }),
  ]);
}

async function seedLeaderboardRows(): Promise<number> {
  const existing = await prisma.csvDashboardRow.count({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      dataHash: { startsWith: LB_DATA_HASH_PREFIX },
    },
  });
  if (existing >= RESOURCE_CDS.length * ROWS_PER_RESOURCE) {
    console.log(`[leaderboard] skip: ${existing} rows already present`);
    await ensureFkojunstMailForPerfRows();
    return existing;
  }

  if (existing > 0) {
    console.log(`[leaderboard] partial data (${existing}); re-seeding PERF rows`);
    const perfRows = await prisma.csvDashboardRow.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        dataHash: { startsWith: LB_DATA_HASH_PREFIX },
      },
      select: { id: true },
    });
    const ids = perfRows.map((r) => r.id);
    await prisma.productionScheduleFkojunstMailStatus.deleteMany({
      where: { csvDashboardRowId: { in: ids } },
    });
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.productionScheduleResourceMaster.createMany({
    data: RESOURCE_CDS.map((resourceCd) => ({
      resourceCd,
      resourceName: `${PERF_PREFIX}Resource-${resourceCd}`,
      resourceClassCd: 'M02',
      resourceGroupCd: 'G1',
    })),
    skipDuplicates: true,
  });

  const chunkSize = 200;
  const allRows: Array<{
    csvDashboardId: string;
    occurredAt: Date;
    dataHash: string;
    rowData: Record<string, string>;
  }> = [];

  for (const resourceCd of RESOURCE_CDS) {
    for (let index = 0; index < ROWS_PER_RESOURCE; index += 1) {
      const productNo = `P${resourceCd}${String(index).padStart(4, '0')}`;
      allRows.push({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(Date.UTC(2026, 5, Number(resourceCd), 0, 0, index)),
        dataHash: `${LB_DATA_HASH_PREFIX}${resourceCd}-${String(index).padStart(4, '0')}`,
        rowData: {
          ProductNo: productNo,
          FSEIBAN: `${PERF_PREFIX}S${resourceCd}-${String(index).padStart(5, '0')}`,
          FHINCD: `${PERF_PREFIX}H${resourceCd}-${String(index).padStart(4, '0')}`,
          FHINMEI: `${PERF_PREFIX}Part ${resourceCd}-${index}`,
          FSIGENCD: resourceCd,
          FKOJUN: '10',
          FKOJUNST: 'S',
          progress: '',
        },
      });
    }
  }

  for (let offset = 0; offset < allRows.length; offset += chunkSize) {
    await prisma.csvDashboardRow.createMany({
      data: allRows.slice(offset, offset + chunkSize),
      skipDuplicates: true,
    });
  }

  await ensureFkojunstMailForPerfRows();
  console.log(`[leaderboard] inserted ${allRows.length} rows`);
  return allRows.length;
}

async function ensureFkojunstMailForPerfRows(): Promise<void> {
  const rows = await prisma.csvDashboardRow.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      dataHash: { startsWith: LB_DATA_HASH_PREFIX },
    },
    select: { id: true, rowData: true },
  });
  if (rows.length === 0) return;

  const existingMail = await prisma.productionScheduleFkojunstMailStatus.count({
    where: { csvDashboardRowId: { in: rows.map((r) => r.id) } },
  });
  if (existingMail >= rows.length) {
    console.log(`[leaderboard] fkojunst mail status already present (${existingMail})`);
    return;
  }

  await prisma.productionScheduleFkojunstMailStatus.createMany({
    data: rows.map((row) => {
      const rd = row.rowData as Record<string, string | undefined>;
      return {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        fkojun: rd.FKOJUN ?? '10',
        fkoteicd: (rd.FSIGENCD ?? '').trim().toUpperCase(),
        fsezono: rd.ProductNo ?? '',
        statusCode: 'S',
        sourceUpdatedAt: new Date('2026-06-01T00:00:00.000Z'),
      };
    }),
    skipDuplicates: true,
  });
  console.log(`[leaderboard] ensured fkojunst mail status for ${rows.length} rows`);
}

async function createDrawingImage(index: number): Promise<{ filename: string; relativePath: string }> {
  const filename = `${PERF_PREFIX.toLowerCase()}drawing-${index}.jpg`;
  const fullPath = path.join(getDrawingsDir(), filename);
  try {
    await fs.access(fullPath);
    return {
      filename,
      relativePath: `/api/storage/part-measurement-drawings/${filename}`,
    };
  } catch {
    // generate below
  }

  const buffer = await generateNoiseJpeg(3508, 2480, 3 * 1024 * 1024, 6 * 1024 * 1024, 10_000 + index);
  await fs.writeFile(fullPath, buffer);
  console.log(`[drawings] wrote ${filename} (${buffer.length} bytes)`);
  return {
    filename,
    relativePath: `/api/storage/part-measurement-drawings/${filename}`,
  };
}

async function seedPartMeasurementData(): Promise<{
  drawingFilenames: string[];
  sheetIds: string[];
  selfInspectionSessionIds: string[];
}> {
  const existingVisual = await prisma.partMeasurementVisualTemplate.findFirst({
    where: { name: { startsWith: `${PERF_PREFIX}Drawing-` } },
    select: { id: true, name: true, drawingImageRelativePath: true },
  });

  const drawingFilenames: string[] = [];
  const visualTemplates: Array<{ id: string; relativePath: string }> = [];

  if (existingVisual) {
    const allVisuals = await prisma.partMeasurementVisualTemplate.findMany({
      where: { name: { startsWith: `${PERF_PREFIX}Drawing-` } },
      orderBy: { name: 'asc' },
    });
    for (const vt of allVisuals) {
      const filename = path.basename(vt.drawingImageRelativePath);
      drawingFilenames.push(filename);
      visualTemplates.push({ id: vt.id, relativePath: vt.drawingImageRelativePath });
    }
    console.log(`[part-measurement] reuse ${visualTemplates.length} visual templates`);
  } else {
    for (let i = 0; i < DRAWING_COUNT; i += 1) {
      const { filename, relativePath } = await createDrawingImage(i);
      drawingFilenames.push(filename);
      const name = `${PERF_PREFIX}Drawing-${i + 1}`;
      const vt = await prisma.partMeasurementVisualTemplate.create({
        data: {
          name,
          searchDigits: extractInspectionDrawingAsciiDigits(name),
          drawingImageRelativePath: relativePath,
          isActive: true,
        },
      });
      visualTemplates.push({ id: vt.id, relativePath });
    }
  }

  const sheetIds: string[] = [];
  const selfInspectionSessionIds: string[] = [];

  for (let i = 0; i < SHEET_COUNT; i += 1) {
    const fhincd = `${PERF_PREFIX}FHINCD-SHEET-${i + 1}`;
    const resourceCd = `${PERF_PREFIX}RES-${i + 1}`.slice(0, 30);
    const productNo = `${PERF_PREFIX}PN-SHEET-${i + 1}`;

    let template = await prisma.partMeasurementTemplate.findFirst({
      where: { fhincd, processGroup: 'GRINDING', resourceCd, name: { startsWith: PERF_PREFIX } },
    });

    if (!template) {
      template = await prisma.partMeasurementTemplate.create({
        data: {
          fhincd,
          processGroup: 'GRINDING',
          resourceCd,
          name: `${PERF_PREFIX}InspectionTemplate-${i + 1}`,
          visualTemplateId: visualTemplates[i % visualTemplates.length]?.id,
          items: {
            create: [
              {
                sortOrder: 0,
                datumSurface: 'A',
                measurementPoint: 'P1',
                measurementLabel: '寸法1',
                displayMarker: '1',
                markerXRatio: '0.25',
                markerYRatio: '0.35',
                nominalValue: '10',
                lowerLimit: '9.8',
                upperLimit: '10.2',
                allowNegative: false,
                decimalPlaces: 2,
              },
            ],
          },
        },
      });
    }

    let pmSession = await prisma.partMeasurementSession.findUnique({
      where: {
        productNo_processGroup_resourceCd: {
          productNo,
          processGroup: 'GRINDING',
          resourceCd,
        },
      },
    });
    if (!pmSession) {
      pmSession = await prisma.partMeasurementSession.create({
        data: { productNo, processGroup: 'GRINDING', resourceCd },
      });
    }

    let sheet = await prisma.partMeasurementSheet.findFirst({
      where: { sessionId: pmSession.id, fhincd, templateId: template.id },
    });
    if (!sheet) {
      sheet = await prisma.partMeasurementSheet.create({
        data: {
          status: 'DRAFT',
          productNo,
          fseiban: `${PERF_PREFIX}SEIBAN-SHEET-${i + 1}`,
          fhincd,
          fhinmei: `${PERF_PREFIX}SheetPart-${i + 1}`,
          processGroupSnapshot: 'GRINDING',
          resourceCdSnapshot: resourceCd,
          sessionId: pmSession.id,
          templateId: template.id,
          quantity: 1,
        },
      });
    }
    sheetIds.push(sheet.id);
  }

  for (let i = 0; i < SELF_INSPECTION_COUNT; i += 1) {
    const suffix = String(i + 1);
    const fhincd = `${PERF_PREFIX}FHINCD-SI-${suffix}`;
    const resourceCd = `${PERF_PREFIX}RES-SI-${suffix}`.slice(0, 30);
    const businessKey = `${PERF_PREFIX}self-inspection:${suffix}`;

    let template = await prisma.partMeasurementTemplate.findFirst({
      where: { fhincd, processGroup: 'CUTTING', resourceCd, name: { startsWith: PERF_PREFIX } },
    });
    if (!template) {
      template = await prisma.partMeasurementTemplate.create({
        data: {
          fhincd,
          processGroup: 'CUTTING',
          resourceCd,
          name: `${PERF_PREFIX}SelfInspectionTemplate-${suffix}`,
          selfInspectionMode: 'FIXED_COUNT',
          selfInspectionFixedCount: 1,
          visualTemplateId: visualTemplates[i % visualTemplates.length]?.id,
          items: {
            create: [
              {
                sortOrder: 0,
                datumSurface: 'A',
                measurementPoint: 'P1',
                measurementLabel: '寸法1',
                displayMarker: '1',
                markerXRatio: '0.2',
                markerYRatio: '0.4',
                nominalValue: '10',
                lowerLimit: '9.8',
                upperLimit: '10.2',
                allowNegative: false,
                decimalPlaces: 2,
              },
            ],
          },
        },
      });
    }

    let session = await prisma.selfInspectionSession.findUnique({
      where: { sessionBusinessKey: businessKey },
    });
    if (!session) {
      session = await prisma.selfInspectionSession.create({
        data: {
          sessionBusinessKey: businessKey,
          templateId: template.id,
          productNo: `${PERF_PREFIX}PN-SI-${suffix}`,
          processGroup: 'CUTTING',
          resourceCd,
          fhincd,
          fhinmei: `${PERF_PREFIX}SelfInspectionPart-${suffix}`,
          machineName: MACHINE_NAME,
          plannedQuantity: 1,
          expectedEntryCount: 1,
          startedAt: new Date(),
        },
      });
    }
    selfInspectionSessionIds.push(session.id);
  }

  console.log(
    `[part-measurement] sheets=${sheetIds.length}, selfInspectionSessions=${selfInspectionSessionIds.length}`,
  );
  return { drawingFilenames, sheetIds, selfInspectionSessionIds };
}

async function writePdfPageImages(kioskDocumentId: string, pageCount: number, seed: number): Promise<void> {
  const pagesDir = path.join(getPdfPagesDir(), kioskDocumentId);
  await fs.mkdir(pagesDir, { recursive: true });

  for (let page = 1; page <= pageCount; page += 1) {
    const pagePath = path.join(pagesDir, `page-${page}.jpg`);
    try {
      const stat = await fs.stat(pagePath);
      if (stat.size >= 300 * 1024) continue;
    } catch {
      // generate
    }
    const buffer = await generateNoiseJpeg(1240, 1754, 300 * 1024, 1024 * 1024, seed * 100 + page);
    await fs.writeFile(pagePath, buffer);
  }
}

async function seedKioskAndAssemblyData(): Promise<{
  kioskDocumentCount: number;
  orderKioskDocumentIds: string[];
  assemblyWorkSessionId: string | null;
  assemblyTemplateId: string | null;
}> {
  const dummyText = buildDummyJapaneseText();
  const existingCount = await prisma.kioskDocument.count({
    where: { title: { startsWith: `${PERF_PREFIX}KioskDoc-` } },
  });

  let orderDocIds: string[] = [];

  if (existingCount >= KIOSK_DOC_TOTAL) {
    console.log(`[kiosk-documents] skip: ${existingCount} docs already present`);
    orderDocIds = (
      await prisma.assemblyProcedureOrderItem.findMany({
        where: { set: { machineNameKey: MACHINE_NAME_KEY } },
        orderBy: { sortOrder: 'asc' },
        select: { kioskDocumentId: true },
      })
    ).map((item) => item.kioskDocumentId);
  } else {
    if (existingCount > 0) {
      const oldDocs = await prisma.kioskDocument.findMany({
        where: { title: { startsWith: `${PERF_PREFIX}KioskDoc-` } },
        select: { id: true },
      });
      const oldIds = oldDocs.map((d) => d.id);
      await prisma.assemblyProcedureOrderItem.deleteMany({ where: { kioskDocumentId: { in: oldIds } } });
      await prisma.kioskDocument.deleteMany({ where: { id: { in: oldIds } } });
    }

    await fs.mkdir(getPdfsDir(), { recursive: true });
    const pdfStub = Buffer.from('%PDF-1.4 perf stub\n');

    const createdDocIds: string[] = [];
    for (let i = 0; i < KIOSK_DOC_TOTAL; i += 1) {
      const id = randomUUID();
      const seq = String(i + 1).padStart(4, '0');
      const filename = `${PERF_PREFIX.toLowerCase()}kiosk-${seq}.pdf`;
      const filePath = path.join(getPdfsDir(), filename);
      await fs.writeFile(filePath, pdfStub);

      await prisma.kioskDocument.create({
        data: {
          id,
          title: `${PERF_PREFIX}KioskDoc-${seq}`,
          displayTitle: `${PERF_PREFIX}Doc ${seq}`,
          filename,
          filePath,
          sourceType: 'MANUAL',
          enabled: true,
          ocrStatus: 'COMPLETED',
          pageCount: i < KIOSK_DOC_ORDER_COUNT ? PDF_PAGES_PER_ORDER_DOC : 1,
          extractedText: dummyText,
          confirmedDocumentNumber: `${PERF_PREFIX}DOC-${seq}`,
          confirmedSummaryText: `${PERF_PREFIX}Summary ${seq}`,
        },
      });
      createdDocIds.push(id);

      if (i < KIOSK_DOC_ORDER_COUNT) {
        await writePdfPageImages(id, PDF_PAGES_PER_ORDER_DOC, i + 1);
      }
    }

    orderDocIds = createdDocIds.slice(0, KIOSK_DOC_ORDER_COUNT);
    console.log(`[kiosk-documents] inserted ${KIOSK_DOC_TOTAL} documents`);
  }

  let orderSet = await prisma.assemblyProcedureOrderSet.findUnique({
    where: { machineNameKey: MACHINE_NAME_KEY },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  if (!orderSet || orderSet.items.length < KIOSK_DOC_ORDER_COUNT) {
    if (orderDocIds.length < KIOSK_DOC_ORDER_COUNT) {
      orderDocIds = (
        await prisma.kioskDocument.findMany({
          where: { title: { startsWith: `${PERF_PREFIX}KioskDoc-` } },
          orderBy: { title: 'asc' },
          take: KIOSK_DOC_ORDER_COUNT,
          select: { id: true },
        })
      ).map((d) => d.id);
    }

    orderSet = await prisma.assemblyProcedureOrderSet.upsert({
      where: { machineNameKey: MACHINE_NAME_KEY },
      create: { machineName: MACHINE_NAME, machineNameKey: MACHINE_NAME_KEY },
      update: { machineName: MACHINE_NAME },
      include: { items: true },
    });

    await prisma.assemblyProcedureOrderItem.deleteMany({ where: { setId: orderSet.id } });
    await prisma.assemblyProcedureOrderItem.createMany({
      data: orderDocIds.slice(0, KIOSK_DOC_ORDER_COUNT).map((kioskDocumentId, idx) => ({
        setId: orderSet!.id,
        kioskDocumentId,
        sortOrder: idx + 1,
        label: `${PERF_PREFIX}Order-${idx + 1}`,
      })),
    });

    for (let idx = 0; idx < Math.min(KIOSK_DOC_ORDER_COUNT, orderDocIds.length); idx += 1) {
      await writePdfPageImages(orderDocIds[idx]!, PDF_PAGES_PER_ORDER_DOC, idx + 100);
    }
    console.log(`[assembly-order] configured ${KIOSK_DOC_ORDER_COUNT} docs for ${MACHINE_NAME}`);
  } else {
    console.log(`[assembly-order] reuse existing order set (${orderSet.items.length} items)`);
    for (const item of orderSet.items) {
      await writePdfPageImages(item.kioskDocumentId, PDF_PAGES_PER_ORDER_DOC, item.sortOrder + 200);
    }
    orderDocIds = orderSet.items.map((item) => item.kioskDocumentId);
  }

  let procedureDoc = await prisma.assemblyProcedureDocument.findFirst({
    where: { name: `${PERF_PREFIX}ProcedureDoc` },
  });
  if (!procedureDoc) {
    const procFilename = `${PERF_PREFIX.toLowerCase()}procedure.jpg`;
    const procPath = path.join(getAssemblyProcedureImagesDir(), procFilename);
    const procBuffer = await generateNoiseJpeg(800, 600, 80 * 1024, 400 * 1024, 42);
    await fs.writeFile(procPath, procBuffer);
    procedureDoc = await prisma.assemblyProcedureDocument.create({
      data: {
        name: `${PERF_PREFIX}ProcedureDoc`,
        imageRelativePath: `/api/storage/assembly-procedure-images/${procFilename}`,
        isActive: true,
      },
    });
  }

  let template = await prisma.assemblyTemplate.findFirst({
    where: { modelCode: MACHINE_NAME, isActive: true },
    orderBy: { version: 'desc' },
  });
  if (!template) {
    template = await prisma.assemblyTemplate.create({
      data: {
        modelCode: MACHINE_NAME,
        procedurePattern: '標準',
        name: `${PERF_PREFIX}AssemblyTemplate`,
        procedureDocumentId: procedureDoc.id,
        areas: {
          create: [
            {
              sortOrder: 0,
              processNo: '1',
              areaCode: 'A1',
              areaName: `${PERF_PREFIX}Area`,
              unitCode: 'U1',
              requireManualAdvance: true,
              bolts: {
                create: [
                  {
                    sortOrder: 0,
                    tighteningId: `${PERF_PREFIX}BOLT-1`,
                    markerNo: 1,
                    xRatio: '0.25',
                    yRatio: '0.25',
                    boltSpec: 'M8x16',
                    nominalTorque: '10',
                    lowerLimit: '9',
                    upperLimit: '11',
                    unit: 'N-m',
                  },
                ],
              },
            },
          ],
        },
      },
    });
  }

  let workSession = await prisma.assemblyWorkSession.findFirst({
    where: { templateId: template.id, productNo: `${PERF_PREFIX}ASM-001`, status: 'IN_PROGRESS' },
  });
  if (!workSession) {
    workSession = await prisma.assemblyWorkSession.create({
      data: {
        templateId: template.id,
        productNo: `${PERF_PREFIX}ASM-001`,
        serialNo: `${PERF_PREFIX}SN-001`,
        nameplateNo: `${PERF_PREFIX}NP-001`,
        operatorNameSnapshot: `${PERF_PREFIX}Operator`,
        targetUnit: MACHINE_NAME,
        torqueWrenchId: `${PERF_PREFIX}WRENCH-1`,
        status: 'IN_PROGRESS',
      },
    });
  }

  const totalDocs = await prisma.kioskDocument.count({
    where: { title: { startsWith: `${PERF_PREFIX}KioskDoc-` } },
  });

  return {
    kioskDocumentCount: totalDocs,
    orderKioskDocumentIds: orderDocIds,
    assemblyWorkSessionId: workSession.id,
    assemblyTemplateId: template.id,
  };
}

async function writeManifest(manifest: SeedManifest): Promise<void> {
  await fs.writeFile(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[manifest] wrote ${manifestPath()}`);
}

async function main(): Promise<void> {
  console.log(`[seed] repoRoot=${repoRoot}`);
  console.log(`[seed] PHOTO_STORAGE_DIR=${getPhotoStorageDir()}`);
  console.log(`[seed] PDF_STORAGE_DIR=${getPdfStorageDir()}`);

  await ensureDirs();

  const dashboard = await prisma.csvDashboard.findUnique({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true, name: true },
  });
  if (!dashboard) {
    throw new Error(
      `Production schedule dashboard (${PRODUCTION_SCHEDULE_DASHBOARD_ID}) がありません。migrate deploy + seed を先に実行してください。`,
    );
  }

  const leaderboardRowCount = await seedLeaderboardRows();
  const partMeasurement = await seedPartMeasurementData();
  const assembly = await seedKioskAndAssemblyData();

  const manifest: SeedManifest = {
    seededAt: new Date().toISOString(),
    leaderboardRowCount,
    resourceCds: [...RESOURCE_CDS],
    drawingFilenames: partMeasurement.drawingFilenames,
    partMeasurementSheetIds: partMeasurement.sheetIds,
    selfInspectionSessionIds: partMeasurement.selfInspectionSessionIds,
    assemblyWorkSessionId: assembly.assemblyWorkSessionId,
    assemblyTemplateId: assembly.assemblyTemplateId,
    kioskDocumentCount: assembly.kioskDocumentCount,
    orderKioskDocumentIds: assembly.orderKioskDocumentIds,
  };

  await writeManifest(manifest);

  console.log('\n=== PERF seed complete ===');
  console.log(JSON.stringify(manifest, null, 2));
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
