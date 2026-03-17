export const PRODUCT_NO_MAX_LENGTH = 10;
export const PRODUCT_NO_MIN_PREFIX_LENGTH = 5;

export const sanitizeProductNoInput = (value: string): string =>
  value.replace(/\D/g, '').slice(0, PRODUCT_NO_MAX_LENGTH);

export const appendProductNoDigit = (current: string, digit: string): string => {
  if (!/^\d$/.test(digit)) return current;
  if (current.length >= PRODUCT_NO_MAX_LENGTH) return current;
  return `${current}${digit}`;
};

export const backspaceProductNoInput = (current: string): string =>
  current.length > 0 ? current.slice(0, -1) : current;

export const hasValidProductNoPrefix = (value: string): boolean =>
  sanitizeProductNoInput(value).length >= PRODUCT_NO_MIN_PREFIX_LENGTH;
