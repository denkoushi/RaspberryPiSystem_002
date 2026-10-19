import { describe, expect, it } from 'vitest';

import { parseTorqueTrainingCatalogArguments } from '../services/torque-training/torque-training-catalog-cli.js';

describe('register torque training catalog arguments', () => {
  it('accepts repeated and comma-separated wrench serial options', () => {
    expect(
      parseTorqueTrainingCatalogArguments([
        '--dry-run',
        '--wrench-serial=702902S,SECOND',
        '--wrench-serial',
        'THIRD',
        '--legacy-m5-code',
        'OLD-CS',
        '--legacy-m5-code=OLD-SUS'
      ])
    ).toEqual({
      dryRun: true,
      wrenchSerialNumbers: ['702902S', 'SECOND', 'THIRD'],
      legacyM5Codes: ['OLD-CS', 'OLD-SUS']
    });
  });

  it('rejects an option without a value or an unknown option', () => {
    expect(() => parseTorqueTrainingCatalogArguments(['--wrench-serial'])).toThrow('requires a value');
    expect(() => parseTorqueTrainingCatalogArguments(['--typo'])).toThrow('unknown option');
  });
});
