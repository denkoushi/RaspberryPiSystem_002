/** Fixed Gmail CSV route for the scawSTFUTEKIGO full snapshot. */
export const SCAW_STFUTEKIGO_DASHBOARD_ID = '3b1a4089-3274-448b-9f4e-ec20c294fe27';
export const SCAW_STFUTEKIGO_SUBJECT_PATTERN = 'scawSTFUTEKIGO';
export const SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_ID = 'csv-import-scaw-stfutekigo';
export const SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_CRON = '35 10 * * *';

/** The source headers are deliberately kept at the normalizer/dashboard boundary. */
export const SCAW_STFUTEKIGO_SOURCE_COLUMNS = [
  'FKIINBUSHOCD',
  'FBUSHOMEI',
  'FFUTEKIGOSU',
  'FBIKO',
  'FFUTEKIGONAIYO',
  'FZESEINAIYO1',
  'FZESEINAIYO2',
  'FSHOTINAIYO',
  'FHAKKENYMD',
  'FUPDTEDT',
  'FSEZONO',
  'FSEIBAN',
  'FFUTEKIGOHINCD',
  'FFUTEKIGONO',
  'FSHOTIYMD',
  'FZUMENNO',
] as const;

export type ScawStfutekigoSourceColumn = (typeof SCAW_STFUTEKIGO_SOURCE_COLUMNS)[number];
