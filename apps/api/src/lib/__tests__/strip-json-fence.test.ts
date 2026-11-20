import { describe, expect, it } from 'vitest';

import { stripJsonFence } from '../strip-json-fence.js';

describe('stripJsonFence', () => {
  it('removes a json fence', () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('removes a bare fence and keeps plain text unchanged', () => {
    expect(stripJsonFence('```\n{"a":1}```')).toBe('{"a":1}');
    expect(stripJsonFence('  {"a":1} ')).toBe('{"a":1}');
  });
});
