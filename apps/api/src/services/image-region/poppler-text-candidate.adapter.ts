import { execFile } from 'child_process';
import { promisify } from 'util';

import type { DocumentTextExtractorPort } from '../kiosk-documents/ports/document-text-extractor.port.js';
import type {
  PdfTextCandidateInput,
  PdfTextCandidatePort,
  TextCandidate,
  TextCandidateBounds,
  TextCandidateInput,
  TextCandidatePort
} from './text-candidate.port.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_POPPLER_TEXT_TIMEOUT_MS = 30_000;
export const DEFAULT_POPPLER_TEXT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export type PopplerTextCommandRunnerOptions = {
  timeout: number;
  maxBuffer: number;
};

export type PopplerTextCommandRunner = (
  command: string,
  args: string[],
  options: PopplerTextCommandRunnerOptions
) => Promise<{ stdout: string | Buffer; stderr?: string | Buffer }>;

export type PopplerBboxLayoutTextCandidateAdapterOptions = {
  command?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  runCommand?: PopplerTextCommandRunner;
};

const defaultRunCommand: PopplerTextCommandRunner = async (
  command,
  args,
  options
) => {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    encoding: 'utf8'
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
};

const FULL_PAGE_ROI: TextCandidateBounds = {
  xRatio: 0,
  yRatio: 0,
  widthRatio: 1,
  heightRatio: 1
};

function numberAttribute(
  attributes: Record<string, string>,
  name: string
): number | null {
  const value = Number(attributes[name]);
  return Number.isFinite(value) ? value : null;
}

function parseAttributes(fragment: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z][A-Za-z0-9:_-]*)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fragment)) !== null) {
    attributes[match[1]] = match[3];
  }
  return attributes;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|amp|apos|gt|lt|quot);/gi,
    (entity, token: string) => {
      const normalized = token.toLowerCase();
      if (normalized === 'amp') return '&';
      if (normalized === 'apos') return "'";
      if (normalized === 'gt') return '>';
      if (normalized === 'lt') return '<';
      if (normalized === 'quot') return '"';
      const codePoint = normalized.startsWith('#x')
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return entity;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return entity;
      }
    }
  );
}

function normalizeRoi(value: TextCandidateBounds | undefined): TextCandidateBounds | null {
  if (!value) return FULL_PAGE_ROI;
  const values = [value.xRatio, value.yRatio, value.widthRatio, value.heightRatio];
  if (!values.every((item) => Number.isFinite(item))) return null;
  if (
    value.xRatio < 0 ||
    value.yRatio < 0 ||
    value.widthRatio <= 0 ||
    value.heightRatio <= 0 ||
    value.xRatio + value.widthRatio > 1 ||
    value.yRatio + value.heightRatio > 1
  ) {
    return null;
  }
  return value;
}

function outputText(output: string | Buffer, maxOutputBytes: number): string | null {
  if (Buffer.isBuffer(output)) {
    if (output.byteLength > maxOutputBytes) return null;
    return output.toString('utf8');
  }
  if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > maxOutputBytes) {
    return null;
  }
  return output;
}

function roundedRatio(value: number): number {
  return Number(value.toFixed(8));
}

function candidateFromWord(
  attributes: Record<string, string>,
  textSource: string,
  pageWidth: number,
  pageHeight: number,
  roi: TextCandidateBounds,
  pageIndex: number | null
): TextCandidate | null {
  const xMinAttribute = numberAttribute(attributes, 'xMin');
  const yMinAttribute = numberAttribute(attributes, 'yMin');
  const xMaxAttribute = numberAttribute(attributes, 'xMax');
  const yMaxAttribute = numberAttribute(attributes, 'yMax');
  if (
    xMinAttribute === null ||
    yMinAttribute === null ||
    xMaxAttribute === null ||
    yMaxAttribute === null
  ) {
    return null;
  }

  const xMin = Math.max(0, Math.min(pageWidth, Math.min(xMinAttribute, xMaxAttribute)));
  const yMin = Math.max(0, Math.min(pageHeight, Math.min(yMinAttribute, yMaxAttribute)));
  const xMax = Math.max(0, Math.min(pageWidth, Math.max(xMinAttribute, xMaxAttribute)));
  const yMax = Math.max(0, Math.min(pageHeight, Math.max(yMinAttribute, yMaxAttribute)));
  if (xMax <= xMin || yMax <= yMin) return null;

  const left = Math.max(xMin / pageWidth, roi.xRatio);
  const top = Math.max(yMin / pageHeight, roi.yRatio);
  const right = Math.min(xMax / pageWidth, roi.xRatio + roi.widthRatio);
  const bottom = Math.min(yMax / pageHeight, roi.yRatio + roi.heightRatio);
  if (right <= left || bottom <= top) return null;

  const text = decodeHtmlEntities(textSource).replace(/\s+/g, ' ').trim();
  if (!text) return null;

  return {
    text,
    confidence: null,
    bounds: {
      xRatio: roundedRatio((left - roi.xRatio) / roi.widthRatio),
      yRatio: roundedRatio((top - roi.yRatio) / roi.heightRatio),
      widthRatio: roundedRatio((right - left) / roi.widthRatio),
      heightRatio: roundedRatio((bottom - top) / roi.heightRatio)
    },
    pageIndex,
    source: 'poppler'
  };
}

export type PopplerBboxLayoutParseInput = {
  pageIndex?: number;
  roi?: TextCandidateBounds;
  bbox?: TextCandidateBounds;
};

/**
 * Parses the XML-ish output emitted by `pdftotext -bbox-layout`.
 * Poppler's bbox y coordinates use the same top-left orientation as the
 * normalized coordinates used by the overlay editor.
 */
export function parsePopplerBboxLayout(
  output: string,
  input: PopplerBboxLayoutParseInput = {}
): TextCandidate[] {
  const roi = normalizeRoi(input.roi ?? input.bbox);
  if (!roi) return [];

  const pageMatch = /<page\b([^>]*)>([\s\S]*?)<\/page>/i.exec(output);
  if (!pageMatch) return [];
  const pageAttributes = parseAttributes(pageMatch[1]);
  const pageWidth = numberAttribute(pageAttributes, 'width');
  const pageHeight = numberAttribute(pageAttributes, 'height');
  if (pageWidth === null || pageHeight === null || pageWidth <= 0 || pageHeight <= 0) {
    return [];
  }

  const pageIndex = input.pageIndex ?? null;
  const candidates: TextCandidate[] = [];
  const wordPattern = /<word\b([^>]*)>([\s\S]*?)<\/word>/gi;
  let wordMatch: RegExpExecArray | null;
  while ((wordMatch = wordPattern.exec(pageMatch[2])) !== null) {
    const candidate = candidateFromWord(
      parseAttributes(wordMatch[1]),
      wordMatch[2],
      pageWidth,
      pageHeight,
      roi,
      pageIndex
    );
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

/** Executes the bounded Poppler bbox-layout command for one source page. */
export class PopplerBboxLayoutTextCandidateAdapter
  implements TextCandidatePort, PdfTextCandidatePort
{
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly runCommand: PopplerTextCommandRunner;

  constructor(options: PopplerBboxLayoutTextCandidateAdapterOptions = {}) {
    this.command = options.command?.trim() || 'pdftotext';
    this.timeoutMs =
      Number.isInteger(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
        ? options.timeoutMs!
        : DEFAULT_POPPLER_TEXT_TIMEOUT_MS;
    this.maxOutputBytes =
      Number.isInteger(options.maxOutputBytes) && (options.maxOutputBytes ?? 0) > 0
        ? options.maxOutputBytes!
        : DEFAULT_POPPLER_TEXT_MAX_OUTPUT_BYTES;
    this.runCommand = options.runCommand ?? defaultRunCommand;
  }

  async extractPdfCandidates(input: PdfTextCandidateInput): Promise<TextCandidate[]> {
    return this.extractCandidates(input);
  }

  async extractCandidates(input: TextCandidateInput): Promise<TextCandidate[]> {
    const pdfPath = input.pdfPath?.trim();
    if (!pdfPath) return [];
    const pageIndex = input.pageIndex ?? 0;
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return [];

    try {
      const result = await this.runCommand(
        this.command,
        [
          '-bbox-layout',
          '-f',
          String(pageIndex + 1),
          '-l',
          String(pageIndex + 1),
          pdfPath,
          '-'
        ],
        { timeout: this.timeoutMs, maxBuffer: this.maxOutputBytes }
      );
      const output = outputText(result.stdout, this.maxOutputBytes);
      if (output === null) return [];
      return parsePopplerBboxLayout(output, {
        pageIndex,
        roi: input.roi,
        bbox: input.bbox
      });
    } catch {
      return [];
    }
  }
}

function isLegacyTextExtractor(
  value: PopplerBboxLayoutTextCandidateAdapterOptions | DocumentTextExtractorPort
): value is DocumentTextExtractorPort {
  return 'extractText' in value && typeof value.extractText === 'function';
}

/**
 * Compatibility facade retaining a text-only DocumentTextExtractorPort
 * constructor while the default path uses coordinate-aware bbox-layout.
 */
export class PopplerTextCandidateAdapter
  implements TextCandidatePort, PdfTextCandidatePort
{
  private readonly bboxAdapter: PopplerBboxLayoutTextCandidateAdapter;
  private readonly legacyTextExtractor: DocumentTextExtractorPort | null;

  constructor(
    options: PopplerBboxLayoutTextCandidateAdapterOptions | DocumentTextExtractorPort = {}
  ) {
    this.legacyTextExtractor = isLegacyTextExtractor(options) ? options : null;
    if (this.legacyTextExtractor) {
      this.bboxAdapter = new PopplerBboxLayoutTextCandidateAdapter();
    } else {
      this.bboxAdapter = new PopplerBboxLayoutTextCandidateAdapter(
        options as PopplerBboxLayoutTextCandidateAdapterOptions
      );
    }
  }

  async extractPdfCandidates(input: PdfTextCandidateInput): Promise<TextCandidate[]> {
    return this.extractCandidates(input);
  }

  async extractCandidates(input: TextCandidateInput): Promise<TextCandidate[]> {
    if (!this.legacyTextExtractor) return this.bboxAdapter.extractCandidates(input);
    if (!input.pdfPath?.trim()) return [];
    try {
      const result = await this.legacyTextExtractor.extractText(input.pdfPath);
      return result.text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((text) => ({
          text,
          confidence: null,
          bounds: null,
          pageIndex: input.pageIndex ?? null,
          source: 'poppler' as const
        }));
    } catch {
      return [];
    }
  }
}

export {
  PopplerBboxLayoutTextCandidateAdapter as PdftotextBboxLayoutTextCandidateAdapter,
  PopplerBboxLayoutTextCandidateAdapter as PopplerBBoxLayoutTextCandidateAdapter
};
