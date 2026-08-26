import type { TorqueTrainingCatalogRegistrationOptions } from './torque-training-catalog-registration.service.js';

export type ParsedTorqueTrainingCatalogArguments = TorqueTrainingCatalogRegistrationOptions;

function takeOptionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function appendValues(target: string[], raw: string): void {
  for (const value of raw.split(',')) {
    const trimmed = value.trim();
    if (trimmed) target.push(trimmed);
  }
}

export function parseTorqueTrainingCatalogArguments(
  argv: readonly string[]
): ParsedTorqueTrainingCatalogArguments {
  const wrenchSerialNumbers: string[] = [];
  const legacyM5Codes: string[] = [];
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--wrench-serial' || argument === '--wrench-serial-number') {
      appendValues(wrenchSerialNumbers, takeOptionValue(argv, index, argument));
      index += 1;
      continue;
    }
    if (argument.startsWith('--wrench-serial=')) {
      appendValues(wrenchSerialNumbers, argument.slice('--wrench-serial='.length));
      continue;
    }
    if (argument.startsWith('--wrench-serial-number=')) {
      appendValues(wrenchSerialNumbers, argument.slice('--wrench-serial-number='.length));
      continue;
    }
    if (argument === '--legacy-m5-code') {
      appendValues(legacyM5Codes, takeOptionValue(argv, index, argument));
      index += 1;
      continue;
    }
    if (argument.startsWith('--legacy-m5-code=')) {
      appendValues(legacyM5Codes, argument.slice('--legacy-m5-code='.length));
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }

  return { dryRun, wrenchSerialNumbers, legacyM5Codes };
}
