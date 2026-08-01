import { createHash } from 'node:crypto';

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function stableJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, normalize(nested)]));
    }
    return input;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}
