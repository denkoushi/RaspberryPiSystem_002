import { describe, expect, it } from 'vitest';

import {
  torqueWrenchModelCreateSchema,
  torqueWrenchModelUpdateSchema
} from '../schemas.js';

const validModes = [undefined, 'REGISTERED_SETTING', 'BOLT_CONDITION_ONLY'] as const;
const invalidModes = [null, 'UNKNOWN_MODE'] as const;

const createModel = (settingVerificationMode?: (typeof validModes)[number]) => ({
  manufacturer: 'TOHNICHI',
  modelNumber: 'CEM3-BTLA',
  torqueMinNm: 1,
  torqueMaxNm: 100,
  ...(settingVerificationMode === undefined ? {} : { settingVerificationMode })
});

describe('torque wrench model settingVerificationMode schema', () => {
  it.each(validModes)('accepts create payload mode %#', (settingVerificationMode) => {
    expect(torqueWrenchModelCreateSchema.safeParse(createModel(settingVerificationMode)).success).toBe(true);
  });

  it.each(validModes)('accepts update payload mode %#', (settingVerificationMode) => {
    expect(torqueWrenchModelUpdateSchema.safeParse({
      modelNumber: 'CEM3-BTLA-UPDATED',
      ...(settingVerificationMode === undefined ? {} : { settingVerificationMode })
    }).success).toBe(true);
  });

  it.each(invalidModes)('rejects create payload mode %#', (settingVerificationMode) => {
    expect(torqueWrenchModelCreateSchema.safeParse({
      ...createModel(),
      settingVerificationMode
    }).success).toBe(false);
  });

  it.each(invalidModes)('rejects update payload mode %#', (settingVerificationMode) => {
    expect(torqueWrenchModelUpdateSchema.safeParse({
      modelNumber: 'CEM3-BTLA-UPDATED',
      settingVerificationMode
    }).success).toBe(false);
  });
});
