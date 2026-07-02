import { createWorker, PSM } from 'tesseract.js';

import type { ImageOcrInput, ImageOcrPort, ImageOcrResult } from '../ports/image-ocr.port.js';
import type {
  ImageOcrLayoutPort,
  ImageOcrLayoutResult,
  ImageOcrLayoutWord
} from '../ports/image-ocr-layout.port.js';

type Worker = Awaited<ReturnType<typeof createWorker>>;
type WorkerParams = Parameters<Worker['setParameters']>[0];

const ENG_ALNUM_WHITELIST = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz:-_.';
const DIGIT_WHITELIST = '0123456789';
const DRAWING_DIMENSION_WHITELIST = '0123456789.,+-';

/**
 * tesseract.js による画像 OCR。
 * 現品票向けに用途別プロファイル（言語・PSM・whitelist）を切り替える。
 */
export class TesseractJsImageOcrAdapter implements ImageOcrPort, ImageOcrLayoutPort {
  private workerJpnEngPromise: Promise<Worker> | null = null;
  private workerEngPromise: Promise<Worker> | null = null;

  async runOcrOnImage(input: ImageOcrInput): Promise<ImageOcrResult> {
    if (input.profile == null) {
      return this.runLegacyJpnEng(input);
    }
    switch (input.profile) {
      case 'actualSlipLabels':
        return this.runActualSlipLabels(input);
      case 'actualSlipManufacturingDigits':
        return this.runActualSlipManufacturingDigits(input);
      case 'actualSlipAuxiliaryAlnum':
        return this.runActualSlipAuxiliaryAlnum(input);
      case 'partMeasurementDrawingDimensions':
        return this.runPartMeasurementDrawingDimensions(input);
    }
  }

  async runLayoutOcrOnImage(input: ImageOcrInput): Promise<ImageOcrLayoutResult> {
    const worker =
      input.profile === 'partMeasurementDrawingDimensions'
        ? await this.getWorkerEng()
        : await this.getWorkerJpnEng();
    await worker.setParameters(this.paramsForProfile(input.profile));
    const { data } = await worker.recognize(input.imageBytes);
    return {
      text: data.text.trim(),
      engine: 'tesseract.js',
      words: this.extractWords(data)
    };
  }

  /** 従来どおり単一パス jpn+eng（profile 省略時の互換） */
  private async runLegacyJpnEng(input: ImageOcrInput): Promise<ImageOcrResult> {
    const worker = await this.getWorkerJpnEng();
    await worker.setParameters(this.defaultJpnEngParams());
    const {
      data: { text }
    } = await worker.recognize(input.imageBytes);
    return {
      text: text.trim(),
      engine: 'tesseract.js'
    };
  }

  private async runActualSlipLabels(input: ImageOcrInput): Promise<ImageOcrResult> {
    const worker = await this.getWorkerJpnEng();
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      user_defined_dpi: '300'
    });
    const {
      data: { text }
    } = await worker.recognize(input.imageBytes);
    return {
      text: text.trim(),
      engine: 'tesseract.js'
    };
  }

  private async runActualSlipManufacturingDigits(input: ImageOcrInput): Promise<ImageOcrResult> {
    const worker = await this.getWorkerEng();
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: DIGIT_WHITELIST,
      user_defined_dpi: '300'
    });
    const {
      data: { text }
    } = await worker.recognize(input.imageBytes);
    return {
      text: text.trim(),
      engine: 'tesseract.js'
    };
  }

  private async runActualSlipAuxiliaryAlnum(input: ImageOcrInput): Promise<ImageOcrResult> {
    const worker = await this.getWorkerEng();
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: ENG_ALNUM_WHITELIST,
      user_defined_dpi: '300'
    });
    const {
      data: { text }
    } = await worker.recognize(input.imageBytes);
    return {
      text: text.trim(),
      engine: 'tesseract.js'
    };
  }

  private async runPartMeasurementDrawingDimensions(input: ImageOcrInput): Promise<ImageOcrResult> {
    const worker = await this.getWorkerEng();
    await worker.setParameters(this.partMeasurementDrawingParams());
    const {
      data: { text }
    } = await worker.recognize(input.imageBytes);
    return {
      text: text.trim(),
      engine: 'tesseract.js'
    };
  }

  private defaultJpnEngParams(): WorkerParams {
    return {
      tessedit_pageseg_mode: PSM.AUTO,
      user_defined_dpi: '300'
    };
  }

  private partMeasurementDrawingParams(): WorkerParams {
    return {
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: DRAWING_DIMENSION_WHITELIST,
      user_defined_dpi: '300'
    };
  }

  private paramsForProfile(profile: ImageOcrInput['profile']): WorkerParams {
    switch (profile) {
      case 'actualSlipLabels':
        return {
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          user_defined_dpi: '300'
        };
      case 'actualSlipManufacturingDigits':
        return {
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          tessedit_char_whitelist: DIGIT_WHITELIST,
          user_defined_dpi: '300'
        };
      case 'actualSlipAuxiliaryAlnum':
        return {
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          tessedit_char_whitelist: ENG_ALNUM_WHITELIST,
          user_defined_dpi: '300'
        };
      case 'partMeasurementDrawingDimensions':
        return this.partMeasurementDrawingParams();
      default:
        return this.defaultJpnEngParams();
    }
  }

  private extractWords(data: unknown): ImageOcrLayoutWord[] {
    const words = (data as { words?: unknown }).words;
    if (!Array.isArray(words)) {
      return [];
    }
    return words.flatMap((word): ImageOcrLayoutWord[] => {
      if (!word || typeof word !== 'object') return [];
      const w = word as {
        text?: unknown;
        confidence?: unknown;
        bbox?: { x0?: unknown; y0?: unknown; x1?: unknown; y1?: unknown };
      };
      const text = typeof w.text === 'string' ? w.text.trim() : '';
      const bbox = w.bbox;
      const x0 = Number(bbox?.x0);
      const y0 = Number(bbox?.y0);
      const x1 = Number(bbox?.x1);
      const y1 = Number(bbox?.y1);
      if (!text || !Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
        return [];
      }
      const confidence = Number(w.confidence);
      return [
        {
          text,
          confidence: Number.isFinite(confidence) ? confidence : null,
          bbox: { x0, y0, x1, y1 }
        }
      ];
    });
  }

  private async getWorkerJpnEng(): Promise<Worker> {
    if (!this.workerJpnEngPromise) {
      this.workerJpnEngPromise = createWorker('jpn+eng');
    }
    return this.workerJpnEngPromise;
  }

  private async getWorkerEng(): Promise<Worker> {
    if (!this.workerEngPromise) {
      this.workerEngPromise = createWorker('eng');
    }
    return this.workerEngPromise;
  }
}
