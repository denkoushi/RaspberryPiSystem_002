import {
  normalizeWorkInstructionImageName,
  normalizeWorkInstructionPartNumber,
  normalizeWorkInstructionShootingTarget,
  normalizeWorkInstructionSourceIdentity,
  validateSourceToken,
  workInstructionImageComparisonKey
} from './normalization.js';
import type {
  WorkInstructionJsonValue,
  WorkInstructionPacket,
  WorkInstructionSource,
  WorkInstructionStepInput
} from './types.js';

export class WorkInstructionManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkInstructionManifestError';
  }
}

export type ParsedWorkInstructionManifest = Omit<WorkInstructionPacket, 'contentHash'>;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): RecordValue {
  if (!isRecord(value)) throw new WorkInstructionManifestError(`${field} must be an object`);
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new WorkInstructionManifestError(`${field} must be a string`);
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, field);
}

function toJsonValue(value: unknown, path = 'manifest'): WorkInstructionJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new WorkInstructionManifestError(`${path} must contain finite JSON numbers`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
  if (isRecord(value)) {
    const result = Object.create(null) as { [key: string]: WorkInstructionJsonValue };
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) throw new WorkInstructionManifestError(`${path}.${key} must not be undefined`);
      Object.defineProperty(result, key, {
        value: toJsonValue(child, `${path}.${key}`),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return result;
  }
  throw new WorkInstructionManifestError(`${path} must be JSON serializable`);
}

function parseModified(value: unknown): Date {
  const raw = requireString(value, 'source.modified');
  // A timezone is required so a host-local interpretation can never change the
  // revision ordering when the Pi and Power Automate use different locales.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw.trim())) {
    throw new WorkInstructionManifestError('source.modified must include a timezone');
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new WorkInstructionManifestError('source.modified must be a valid date');
  return parsed;
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new WorkInstructionManifestError(`${field} must be a positive integer`);
  }
  return value;
}

function parseSource(value: unknown): WorkInstructionSource {
  const source = requireRecord(value, 'source');
  let identity;
  try {
    identity = normalizeWorkInstructionSourceIdentity({
      system: validateSourceToken(requireString(source.system, 'source.system'), 'source.system'),
      list: validateSourceToken(requireString(source.list, 'source.list'), 'source.list'),
      itemId: parsePositiveInteger(source.item_id, 'source.item_id')
    });
  } catch (error) {
    throw new WorkInstructionManifestError(error instanceof Error ? error.message : 'invalid source');
  }
  return {
    ...identity,
    modified: parseModified(source.modified)
  };
}

function parseSteps(value: unknown): WorkInstructionStepInput[] {
  if (!Array.isArray(value)) throw new WorkInstructionManifestError('steps must be an array');

  const seenSteps = new Set<number>();
  const steps: WorkInstructionStepInput[] = [];
  for (const [index, item] of value.entries()) {
    const step = requireRecord(item, `steps[${index}]`);
    const stepNumber = parsePositiveInteger(step.step, `steps[${index}].step`);
    if (seenSteps.has(stepNumber)) {
      throw new WorkInstructionManifestError(`steps contains duplicate step ${stepNumber}`);
    }
    seenSteps.add(stepNumber);

    const rawImage = optionalString(step.image, `steps[${index}].image`);
    const imageName = rawImage === null ? null : normalizeWorkInstructionImageName(rawImage);
    if (rawImage !== null && imageName !== null && imageName.trim().length === 0) {
      throw new WorkInstructionManifestError(`steps[${index}].image must not be empty`);
    }

    // The same attachment may intentionally be reused by more than one step.
    // Attachment filename uniqueness is checked by the Gmail adapter, where
    // the complete MIME attachment set is available.
    steps.push({
      step: stepNumber,
      text: requireString(step.text, `steps[${index}].text`),
      imageName
    });
  }
  return steps;
}

export function parseWorkInstructionManifest(input: unknown): ParsedWorkInstructionManifest {
  const manifest = requireRecord(input, 'manifest');
  if (manifest.schema_version !== 1) {
    throw new WorkInstructionManifestError('schema_version must be 1');
  }

  const source = parseSource(manifest.source);
  const steps = parseSteps(manifest.steps);
  return {
    source,
    partNumber: normalizeWorkInstructionPartNumber(optionalString(manifest.part_number, 'part_number')),
    shootingTarget: normalizeWorkInstructionShootingTarget(
      optionalString(manifest.shooting_target, 'shooting_target')
    ),
    rawManifest: toJsonValue(input),
    steps
  };
}

export function validateUniqueReferencedImageNames(
  imageNames: ReadonlyArray<string>,
  field = 'attachments'
): void {
  const seen = new Set<string>();
  for (const rawName of imageNames) {
    const name = normalizeWorkInstructionImageName(rawName);
    const key = workInstructionImageComparisonKey(name);
    if (!name || seen.has(key)) throw new WorkInstructionManifestError(`${field} contains duplicate image filename`);
    seen.add(key);
  }
}
