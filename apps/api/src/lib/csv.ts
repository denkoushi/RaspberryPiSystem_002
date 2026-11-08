export function escapeCsvCell(value: string | number | null | undefined, alwaysQuote = false): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
    text = "'" + text;
  }
  return alwaysQuote || /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
