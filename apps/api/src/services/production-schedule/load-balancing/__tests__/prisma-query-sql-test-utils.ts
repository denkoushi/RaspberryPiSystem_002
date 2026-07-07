import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';

function flattenPrismaSqlArg(arg: unknown): string {
  if (arg == null) return '';
  if (typeof arg === 'object' && 'strings' in arg && 'values' in arg) {
    const frag = arg as { strings: readonly string[]; values: readonly unknown[] };
    return frag.strings.reduce((acc, chunk, i) => acc + chunk + flattenPrismaSqlArg(frag.values[i]), '');
  }
  return String(arg);
}

export function captureTaggedTemplateQuerySql(): string {
  const args = vi.mocked(prisma.$queryRaw).mock.calls[0] ?? [];
  const strings = args[0] as TemplateStringsArray;
  const values = args.slice(1);
  expect(strings).toBeDefined();
  return strings.reduce((acc, chunk, i) => acc + chunk + flattenPrismaSqlArg(values[i]), '').toLowerCase();
}
