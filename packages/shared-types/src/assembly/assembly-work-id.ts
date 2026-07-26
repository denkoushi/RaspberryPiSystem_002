export const ASSEMBLY_IDENTIFIER_MAX_LENGTH = 120;
export const ASSEMBLY_LOT_MAX_QUANTITY = 500;
export const ASSEMBLY_WORK_ID_SEQUENCE_DIGITS = 3;

export function toHalfWidthAscii(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

export function normalizeAssemblyUpperIdentifier(value: string | null | undefined): string {
  if (value == null) return '';
  return toHalfWidthAscii(String(value)).trim().toUpperCase();
}

export function isAssemblyIdentifierLike(value: string): boolean {
  return /^[A-Z0-9._/-]+$/.test(value);
}

/**
 * 製番とロット数から、組立作業用IDを `製番-001` 形式で決定的に生成する。
 *
 * 入力値の業務エラーへの変換は利用側で行えるよう、純粋なRangeErrorとして返す。
 */
export function buildAssemblyLotWorkIds(
  productNoInput: string,
  expectedQuantity: number
): string[] {
  const productNo = normalizeAssemblyUpperIdentifier(productNoInput);
  if (!productNo) {
    throw new RangeError('製番が必要です');
  }
  if (
    !Number.isInteger(expectedQuantity) ||
    expectedQuantity < 1 ||
    expectedQuantity > ASSEMBLY_LOT_MAX_QUANTITY
  ) {
    throw new RangeError(`ロット数は1〜${ASSEMBLY_LOT_MAX_QUANTITY}の整数で指定してください`);
  }

  const workIds = Array.from({ length: expectedQuantity }, (_, index) => {
    const sequence = String(index + 1).padStart(ASSEMBLY_WORK_ID_SEQUENCE_DIGITS, '0');
    return `${productNo}-${sequence}`;
  });
  if (workIds.some((workId) => workId.length > ASSEMBLY_IDENTIFIER_MAX_LENGTH)) {
    throw new RangeError(`自動発行する作業用IDは${ASSEMBLY_IDENTIFIER_MAX_LENGTH}文字以内にしてください`);
  }
  return workIds;
}

