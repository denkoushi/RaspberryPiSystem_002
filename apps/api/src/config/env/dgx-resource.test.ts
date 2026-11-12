import { describe, expect, it } from 'vitest';

import { dgxResourceEnvShape } from './dgx-resource.js';

describe('business switch flags', () => {
  it.each([[undefined, false], ['false', false], ['true', true]] as const)(
    'BUSINESS_DEEPSEEK_SWITCH_ENABLED parses %s as %s', (value, expected) => {
      expect(dgxResourceEnvShape.BUSINESS_DEEPSEEK_SWITCH_ENABLED.parse(value)).toBe(expected);
    });

  it.each(['0', '1'])('BUSINESS_DEEPSEEK_SWITCH_ENABLED rejects %s', (value) => {
    expect(dgxResourceEnvShape.BUSINESS_DEEPSEEK_SWITCH_ENABLED.safeParse(value).success).toBe(false);
  });

  it.each([[undefined, false], ['false', false], ['0', false], ['true', true], ['1', true]] as const)(
    'BUSINESS_QWEN38_SWITCH_ENABLED parses %s as %s', (value, expected) => {
      expect(dgxResourceEnvShape.BUSINESS_QWEN38_SWITCH_ENABLED.parse(value)).toBe(expected);
    });
});
