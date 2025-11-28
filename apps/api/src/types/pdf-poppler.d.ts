declare module 'pdf-poppler' {
  interface ConvertOptions {
    format: 'png' | 'jpg' | 'jpeg';
    out_dir: string;
    out_prefix: string;
    page?: number | null;
  }

  interface PdfConverter {
    convert(pdfPath: string, options: ConvertOptions): Promise<void>;
  }

  const pdf: PdfConverter;
  export default pdf;
}

