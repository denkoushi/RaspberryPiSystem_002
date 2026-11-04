export type KioskSopSheetDescriptor = Readonly<{
  id: string;
  label: string;
}>;

export type KioskSopManual = Readonly<{
  id: string;
  title: string;
  /** Resolves the generated manual HTML; shared and cached across callers. */
  loadSourceHtml: () => Promise<string>;
  /** The manual HTML once loaded, otherwise undefined. */
  peekSourceHtml: () => string | undefined;
  sheets: readonly KioskSopSheetDescriptor[];
}>;

export type KioskSopManualId = 'inspection-drawing' | 'assembly-procedure-template';
