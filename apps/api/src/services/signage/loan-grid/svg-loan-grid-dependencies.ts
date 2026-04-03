/**
 * FS / image encoding hooks for legacy SVG loan grid (DIP).
 */
export type SvgLoanGridDependencies = {
  escapeXml: (value: string) => string;
  generateId: (prefix: string) => string;
  encodeLocalImageAsBase64: (
    localPath: string,
    width: number,
    height: number,
    fit: 'cover' | 'contain'
  ) => Promise<string | null>;
  resolveThumbnailLocalPath: (thumbnailUrl: string) => string | null;
};
