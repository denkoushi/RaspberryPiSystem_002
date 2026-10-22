// Material and finished parts can share a name despite having different part codes.
export const normalizePartName = (name: string): string => name.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
