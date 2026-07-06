export function toHalfWidthAscii(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

export function normalizeAssemblyUpperIdentifier(value: string | null | undefined): string {
  if (value == null) return '';
  return toHalfWidthAscii(String(value)).trim().toUpperCase();
}

export function isAssemblyIdentifierLike(value: string): boolean {
  return /^[A-Z0-9._/-]+$/.test(value);
}
