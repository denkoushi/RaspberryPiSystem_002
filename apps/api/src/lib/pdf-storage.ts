import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { convertPdfToImages } from './pdf-converter.js';

/**
 * PDF保存のベースディレクトリ
 */
const STORAGE_BASE_DIR = process.env.PDF_STORAGE_DIR || '/opt/RaspberryPiSystem_002/storage';
const PDFS_DIR = path.join(STORAGE_BASE_DIR, 'pdfs');
export const PDF_PAGES_DIR = path.join(STORAGE_BASE_DIR, 'pdf-pages');

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
    await fs.mkdir(PDF_PAGES_DIR, { recursive: true });
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

  /**
   * PDFを画像に変換してページURL一覧を取得
   * 
   * @param pdfId PDFのID
   * @param pdfFilePath PDFファイルのパス
   * @returns ページ画像のURL一覧
   */
  static async convertPdfToPages(pdfId: string, pdfFilePath: string): Promise<string[]> {
    const outputDir = path.join(PDF_PAGES_DIR, pdfId);
    
    // 既に変換済みの場合は既存の画像を返す
    try {
      const existingFiles = await fs.readdir(outputDir);
      const pageFiles = existingFiles
        .filter((file) => file.endsWith('.jpg') || file.endsWith('.jpeg'))
        .sort((a, b) => {
          const pageA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
          const pageB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
          return pageA - pageB;
        });
      
      if (pageFiles.length > 0) {
        return pageFiles.map((file) => `/api/storage/pdf-pages/${pdfId}/${file}`);
      }
    } catch (error) {
      // ディレクトリが存在しない場合は変換を実行
    }

    try {
      // 環境変数でDPIを設定可能（デフォルト: 150、4K表示の場合は300推奨）
      const dpi = parseInt(process.env.SIGNAGE_PDF_DPI || '150', 10);
      await convertPdfToImages(pdfFilePath, outputDir, {
        prefix: pdfId,
        format: 'jpeg',
        dpi,
        quality: 85,
      });
      
      // 変換された画像ファイルを取得
      const files = await fs.readdir(outputDir);
      const pageFiles = files
        .filter((file) => file.endsWith('.jpg') || file.endsWith('.jpeg'))
        .sort((a, b) => {
          const pageA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
          const pageB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
          return pageA - pageB;
        });

      return pageFiles.map((file) => `/api/storage/pdf-pages/${pdfId}/${file}`);
    } catch (error) {
      // 変換に失敗した場合は空配列を返す
      console.error('PDF変換エラー:', error);
      return [];
    }
  }

  /**
   * PDFページ画像を削除
   * 
   * @param pdfId PDFのID
   */
  static async deletePdfPages(pdfId: string): Promise<void> {
    const outputDir = path.join(PDF_PAGES_DIR, pdfId);
    
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch (error) {
      // ディレクトリが存在しない場合は無視
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

