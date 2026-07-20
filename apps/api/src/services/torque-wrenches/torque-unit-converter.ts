import { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';

export type CanonicalTorqueUnit = 'N·m' | 'kgf·cm';

const NEWTON_METRE_TOKENS = new Set(['NM', 'N-M', 'N·M', 'N・M']);
const KGF_CENTIMETRE_TOKENS = new Set(['KGFCM', 'KGF-CM', 'KGF·CM', 'KGF・CM']);
const KGF_CM_TO_NM = new Prisma.Decimal('0.0980665');

function normalizeUnitToken(unit: string): string {
  return unit.normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
}

export class UnsupportedTorqueUnitError extends ApiError {
  constructor(unit: string) {
    super(422, `未対応のトルク単位です: ${unit}`, { unit }, 'UNSUPPORTED_TORQUE_UNIT');
  }
}

export class TorqueUnitConverter {
  static canonicalUnit(unit: string): CanonicalTorqueUnit {
    const token = normalizeUnitToken(unit);
    if (NEWTON_METRE_TOKENS.has(token)) return 'N·m';
    if (KGF_CENTIMETRE_TOKENS.has(token)) return 'kgf·cm';
    throw new UnsupportedTorqueUnitError(unit);
  }

  static toNewtonMetres(value: Prisma.Decimal.Value, unit: string): Prisma.Decimal {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite()) {
      throw new ApiError(400, 'トルク値が不正です');
    }
    return this.canonicalUnit(unit) === 'N·m' ? decimal : decimal.mul(KGF_CM_TO_NM);
  }

  static equalInNewtonMetres(
    left: { value: Prisma.Decimal.Value; unit: string },
    right: { value: Prisma.Decimal.Value; unit: string }
  ): boolean {
    return this.toNewtonMetres(left.value, left.unit).equals(this.toNewtonMetres(right.value, right.unit));
  }
}
