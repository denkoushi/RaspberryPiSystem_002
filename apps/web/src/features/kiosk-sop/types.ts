export type KioskSopSheetDescriptor = Readonly<{
  id: string;
  label: string;
}>;

export type KioskSopManual = Readonly<{
  id: string;
  title: string;
  sourceHtml: string;
  sheets: readonly KioskSopSheetDescriptor[];
}>;

export type KioskSopManualId = 'inspection-drawing' | 'assembly-procedure-template';
