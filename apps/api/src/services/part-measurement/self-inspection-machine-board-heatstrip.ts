import { Prisma } from '@prisma/client';

import type { HeatstripCellTone } from './self-inspection-machine-board.types.js';

export type HeatstripToleranceItem = {
  lowerLimit: Prisma.Decimal | null;
  upperLimit: Prisma.Decimal | null;
  nominalValue: Prisma.Decimal | null;
  decimalPlaces: number;
  depthMode?: 'MEASURED' | 'THROUGH' | string | null;
};

export type HeatstripCellResolution = {
  tone: HeatstripCellTone;
  displayValue: string | null;
};

function formatDecimalValue(value: Prisma.Decimal, decimalPlaces: number): string {
  return value.toDecimalPlaces(decimalPlaces, Prisma.Decimal.ROUND_HALF_UP).toString();
}

export function resolveHeatstripCellTone(
  value: Prisma.Decimal | null,
  item: HeatstripToleranceItem
): HeatstripCellResolution {
  if (value == null) {
    return { tone: 'missing', displayValue: null };
  }

  const displayValue = formatDecimalValue(value, item.decimalPlaces);

  if (String(item.depthMode ?? 'MEASURED').toUpperCase() === 'THROUGH') {
    return { tone: 'ok', displayValue };
  }

  if (item.lowerLimit == null || item.upperLimit == null) {
    return { tone: 'neutral', displayValue };
  }

  const lower = item.lowerLimit;
  const upper = item.upperLimit;
  const lo = lower.lessThanOrEqualTo(upper) ? lower : upper;
  const hi = lower.lessThanOrEqualTo(upper) ? upper : lower;

  if (value.lessThan(lo) || value.greaterThan(hi)) {
    return { tone: 'out_of_tolerance', displayValue };
  }

  const range = hi.minus(lo);
  if (range.isZero()) {
    return { tone: 'center', displayValue };
  }

  const position = value.minus(lo).dividedBy(range).toNumber();

  let distFromCenter: number;
  const nominal = item.nominalValue;
  if (nominal != null && nominal.greaterThanOrEqualTo(lo) && nominal.lessThanOrEqualTo(hi)) {
    const centerPos = nominal.minus(lo).dividedBy(range).toNumber();
    distFromCenter = Math.abs(position - centerPos);
  } else {
    distFromCenter = Math.abs(position - 0.5);
  }

  if (position <= 0.15 || position >= 0.85 || distFromCenter > 0.35) {
    return { tone: 'edge', displayValue };
  }

  return { tone: 'center', displayValue };
}
