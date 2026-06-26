export function normalizeManufacturingOrderScanText(value: string): string {
  return value.trim().replace(/\u3000/g, ' ');
}
