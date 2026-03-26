import { execFile } from 'child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import type { OcrEnginePort, OcrResult } from '../ports/ocr-engine.port.js';

const execFileAsync = promisify(execFile);

const SUBPROC_MAX_BUFFER = 50 * 1024 * 1024;
const DEFAULT_OCR_ENGINE_TIMEOUT_MS = 180_000;
const DEFAULT_OCR_RASTER_TIMEOUT_MS = 120_000;
const DEFAULT_RASTER_DPI = 150;

type OcrFailureCategory =
  | 'COMMAND_NOT_FOUND'
  | 'EMPTY_OUTPUT'
  | 'RASTER_FAILED'
  | 'INVALID_CONFIG'
  | 'EXECUTION_FAILED';

type NdlOcrRuntimeConfig = {
  legacyStdoutEnabled: boolean;
  legacyCommand: string;
  rasterDpi: number;
  ocrEngineTimeoutMs: number;
  ocrRasterTimeoutMs: number;
  ndlCli: string;
  ndlScript: string | null;
  ndlPython: string;
};

class OcrOutputEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrOutputEmptyError';
  }
}

class OcrConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrConfigError';
  }
}

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function resolveRuntimeConfig(legacyCommand: string): NdlOcrRuntimeConfig {
  const normalizedLegacyCommand = legacyCommand.trim();
  if (!normalizedLegacyCommand) {
    throw new OcrConfigError('KIOSK_DOCUMENT_OCR_COMMAND が空です');
  }
  const ndlCli = (process.env.KIOSK_DOCUMENT_NDLOCR_CLI || 'ndlocr-lite').trim();
  if (!ndlCli) {
    throw new OcrConfigError('KIOSK_DOCUMENT_NDLOCR_CLI が空です');
  }
  const ndlScriptRaw = (process.env.KIOSK_DOCUMENT_NDLOCR_SCRIPT || '').trim();
  const ndlPython = (process.env.KIOSK_DOCUMENT_NDLOCR_PYTHON || 'python3').trim();
  if (!ndlPython) {
    throw new OcrConfigError('KIOSK_DOCUMENT_NDLOCR_PYTHON が空です');
  }
  return {
    legacyStdoutEnabled: envFlag('KIOSK_DOCUMENT_OCR_LEGACY_STDOUT'),
    legacyCommand: normalizedLegacyCommand,
    rasterDpi: parsePositiveIntEnv('KIOSK_DOCUMENT_OCR_RASTER_DPI', DEFAULT_RASTER_DPI),
    ocrEngineTimeoutMs: parsePositiveIntEnv(
      'KIOSK_DOCUMENT_OCR_ENGINE_TIMEOUT_MS',
      DEFAULT_OCR_ENGINE_TIMEOUT_MS,
    ),
    ocrRasterTimeoutMs: parsePositiveIntEnv(
      'KIOSK_DOCUMENT_OCR_RASTER_TIMEOUT_MS',
      DEFAULT_OCR_RASTER_TIMEOUT_MS,
    ),
    ndlCli,
    ndlScript: ndlScriptRaw.length > 0 ? ndlScriptRaw : null,
    ndlPython,
  };
}

function classifyOcrFailure(error: unknown): OcrFailureCategory {
  if (error instanceof OcrOutputEmptyError) return 'EMPTY_OUTPUT';
  if (error instanceof OcrConfigError) return 'INVALID_CONFIG';
  if (error instanceof Error && /pdftoppm/i.test(error.message)) return 'RASTER_FAILED';
  const e = error as { code?: string; message?: string } | undefined;
  if (e?.code === 'ENOENT') return 'COMMAND_NOT_FOUND';
  if (typeof e?.message === 'string' && /ENOENT|not found|spawn\s+\S+\s+ENOENT/i.test(e.message)) {
    return 'COMMAND_NOT_FOUND';
  }
  return 'EXECUTION_FAILED';
}

function pageIndexFromFilename(name: string): number {
  const m = name.match(/-(\d+)\.(?:png|jpe?g|tif|tiff|bmp)$/i);
  if (m) return parseInt(m[1], 10);
  const m2 = name.match(/(\d+)\.(?:png|jpe?g|tif|tiff|bmp)$/i);
  if (m2) return parseInt(m2[1], 10);
  return Number.MAX_SAFE_INTEGER;
}

function sortRasterPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const na = pageIndexFromFilename(basename(a));
    const nb = pageIndexFromFilename(basename(b));
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

async function collectOutputTexts(outDir: string): Promise<string> {
  const names = await readdir(outDir);
  const txts = names.filter((n) => n.toLowerCase().endsWith('.txt'));
  if (txts.length === 0) {
    throw new OcrOutputEmptyError('OCR出力ディレクトリに .txt がありません');
  }
  txts.sort((a, b) => {
    const sa = basename(a, '.txt');
    const sb = basename(b, '.txt');
    return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
  });
  const chunks: string[] = [];
  for (const n of txts) {
    const raw = await readFile(join(outDir, n), 'utf8');
    chunks.push(raw.trimEnd());
  }
  return chunks.filter((c) => c.length > 0).join('\n\n');
}

/**
 * NDLOCR-Lite 連携アダプタ。
 *
 * 既定: PDF を `pdftoppm` でラスタ化し、ページ画像を順序付けたうえで
 * 各ページごとに `ndlocr-lite --sourceimg <png> --output …`（[NDLOCR-Lite README](https://github.com/ndl-lab/ndlocr-lite)）を実行し、
 * 生成された .txt をページ順で結合する（`--sourcedir` の glob 順が不定なため、読み順を固定する）。
 *
 * `KIOSK_DOCUMENT_OCR_LEGACY_STDOUT=true` のときのみ、従来どおり
 * `KIOSK_DOCUMENT_OCR_COMMAND` に PDF パスを1引数渡し、stdout を全文とみなす。
 */
export class NdlOcrEngineAdapter implements OcrEnginePort {
  constructor(
    private readonly legacyCommand = process.env.KIOSK_DOCUMENT_OCR_COMMAND || 'ndlocr-lite',
  ) {}

  async runOcr(pdfPath: string): Promise<OcrResult> {
    try {
      const config = resolveRuntimeConfig(this.legacyCommand);
      if (config.legacyStdoutEnabled) {
        return this.runLegacyStdoutOcr(pdfPath, config);
      }
      return this.runNdlOcrLiteOnPdf(pdfPath, config);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const category = classifyOcrFailure(error);
      logger.error({ err: error, category, pdfPath }, '[KioskDocument] OCR config/runtime resolve failed');
      throw new ApiError(500, 'OCR処理に失敗しました', undefined, 'KIOSK_DOC_OCR_FAILED');
    }
  }

  private async runLegacyStdoutOcr(pdfPath: string, config: NdlOcrRuntimeConfig): Promise<OcrResult> {
    try {
      const { stdout } = await execFileAsync(config.legacyCommand, [pdfPath], {
        timeout: config.ocrEngineTimeoutMs,
        maxBuffer: SUBPROC_MAX_BUFFER,
      });
      const text = stdout?.toString?.() ?? '';
      if (text.trim().length === 0) {
        throw new OcrOutputEmptyError('OCR出力が空です');
      }
      return { text, engine: 'NDLOCR-Lite' };
    } catch (error) {
      const category = classifyOcrFailure(error);
      logger.error(
        { err: error, category, pdfPath, command: config.legacyCommand },
        '[KioskDocument] OCR legacy stdout command failed',
      );
      throw new ApiError(500, 'OCR処理に失敗しました', undefined, 'KIOSK_DOC_OCR_FAILED');
    }
  }

  private async runNdlOcrLiteOnPdf(pdfPath: string, config: NdlOcrRuntimeConfig): Promise<OcrResult> {
    const workRoot = await mkdtemp(join(tmpdir(), 'kiosk-ocr-'));
    const rasterDir = join(workRoot, 'raster');
    const orderedDir = join(workRoot, 'pages');
    const outDir = join(workRoot, 'out');

    try {
      await mkdir(rasterDir, { recursive: true });
      await mkdir(orderedDir, { recursive: true });
      await mkdir(outDir, { recursive: true });

      const prefix = join(rasterDir, 'page');
      await execFileAsync('pdftoppm', ['-png', '-r', String(config.rasterDpi), pdfPath, prefix], {
        timeout: config.ocrRasterTimeoutMs,
        maxBuffer: SUBPROC_MAX_BUFFER,
      });

      const rasterFiles = (await readdir(rasterDir)).filter((n) =>
        /\.(png|jpe?g|tif|tiff|bmp)$/i.test(n),
      );
      if (rasterFiles.length === 0) {
        throw new OcrOutputEmptyError(
          'PDFから画像を生成できませんでした（スキャンPDFでない、またはpdftoppm失敗）',
        );
      }
      const sorted = sortRasterPaths(rasterFiles.map((n) => join(rasterDir, n)));
      let ord = 0;
      for (const src of sorted) {
        ord += 1;
        const dest = join(orderedDir, `p${String(ord).padStart(5, '0')}.png`);
        await copyFile(src, dest);
      }

      const orderedNames = (await readdir(orderedDir))
        .filter((n) => /\.(png|jpe?g|tif|tiff|bmp)$/i.test(n))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      for (const name of orderedNames) {
        const imgPath = join(orderedDir, name);
        const pageArgs = ['--sourceimg', imgPath, '--output', outDir];
        if (config.ndlScript) {
          await execFileAsync(config.ndlPython, [config.ndlScript, ...pageArgs], {
            cwd: dirname(config.ndlScript),
            timeout: config.ocrEngineTimeoutMs,
            maxBuffer: SUBPROC_MAX_BUFFER,
            env: process.env,
          });
        } else {
          await execFileAsync(config.ndlCli, pageArgs, {
            timeout: config.ocrEngineTimeoutMs,
            maxBuffer: SUBPROC_MAX_BUFFER,
            env: process.env,
          });
        }
      }

      const text = (await collectOutputTexts(outDir)).trim();
      if (text.length === 0) {
        throw new OcrOutputEmptyError('OCR出力が空です');
      }
      return { text, engine: 'NDLOCR-Lite' };
    } catch (error) {
      const category = classifyOcrFailure(error);
      logger.error(
        {
          err: error,
          category,
          pdfPath,
          ndlCli: config.ndlCli,
          hasScript: Boolean(config.ndlScript),
          rasterDpi: config.rasterDpi,
        },
        '[KioskDocument] OCR ndlocr-lite pipeline failed',
      );
      throw new ApiError(500, 'OCR処理に失敗しました', undefined, 'KIOSK_DOC_OCR_FAILED');
    } finally {
      await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
