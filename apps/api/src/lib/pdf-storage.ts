import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * PDF保存のベースディレクトリ
 */
const STORAGE_BASE_DIR = process.env.PDF_STORAGE_DIR || '/opt/RaspberryPiSystem_002/storage';
const PDFS_DIR = path.join(STORAGE_BASE_DIR, 'pdfs');

/**
 * PDFファイルのパス情報
 */
export interface PdfPathInfo {
  id: string;
  filename: string;
  filePath: string;
  relativePath: string;
}

/**
 * PDFストレージユーティリティ
 * 
 * PDFの保存・削除・パス生成を提供する。
 */
export class PdfStorage {
  /**
   * ストレージディレクトリを初期化する
   */
  static async initialize(): Promise<void> {
    await fs.mkdir(PDFS_DIR, { recursive: true });
  }

  /**
   * PDFファイルのパス情報を生成する
   * 
   * @param originalFilename 元のファイル名
   * @returns パス情報
   */
  static generatePdfPath(originalFilename: string): PdfPathInfo {
    const id = randomUUID();
    const ext = path.extname(originalFilename);
    const basename = path.basename(originalFilename, ext);
    const sanitizedBasename = basename.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${sanitizedBasename}_${id}${ext}`;
    
    const filePath = path.join(PDFS_DIR, filename);
    const relativePath = `/api/storage/pdfs/${filename}`;

    return {
      id,
      filename,
      filePath,
      relativePath,
    };
  }

  /**
   * PDFを保存する
   * 
   * @param originalFilename 元のファイル名
   * @param pdfBuffer PDFファイルのBuffer
   * @returns パス情報
   */
  static async savePdf(
    originalFilename: string,
    pdfBuffer: Buffer
  ): Promise<PdfPathInfo> {
    const pathInfo = this.generatePdfPath(originalFilename);

    // ディレクトリを作成（存在しない場合）
    await fs.mkdir(PDFS_DIR, { recursive: true });

    // ファイルを保存
    await fs.writeFile(pathInfo.filePath, pdfBuffer);

    return pathInfo;
  }

  /**
   * PDFを削除する
   * 
   * @param pdfUrl PDFのURL（例: /api/storage/pdfs/filename.pdf）
   */
  static async deletePdf(pdfUrl: string): Promise<void> {
    // URLからファイルパスを抽出
    const filename = path.basename(pdfUrl);
    const fullPath = path.join(PDFS_DIR, filename);

    // ファイルを削除（存在しない場合はエラーを無視）
    try {
      await fs.unlink(fullPath);
    } catch (error) {
      // ファイルが存在しない場合は無視
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * PDFファイルを読み込む
   * 
   * @param pdfUrl PDFのURL（例: /api/storage/pdfs/filename.pdf）
   * @returns PDFのBuffer
   */
  static async readPdf(pdfUrl: string): Promise<Buffer> {
    // URLからファイルパスを抽出
    const filename = path.basename(pdfUrl);
    const fullPath = path.join(PDFS_DIR, filename);

    return await fs.readFile(fullPath);
  }
}

