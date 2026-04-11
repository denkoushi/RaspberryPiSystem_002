import { createWorker, PSM } from 'tesseract.js';

import type { ImageOcrInput, ImageOcrPort, ImageOcrResult } from '../ports/image-ocr.port.js';

type Worker = Awaited<ReturnType<typeof createWorker>>;
type WorkerParams = Parameters<Worker['setParameters']>[0];

const ENG_ALNUM_WHITELIST = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz:-_.';
const DIGIT_WHITELIST = '0123456789';

/**
 * tesseract.js による画像 OCR。
 * 現品票向けに用途別プロファイル（言語・PSM・whitelist）を切り替える。
 */
export class TesseractJsImageOcrAdapter implements ImageOcrPort {
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
    }
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

  private defaultJpnEngParams(): WorkerParams {
    return {
      tessedit_pageseg_mode: PSM.AUTO,
      user_defined_dpi: '300'
    };
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
