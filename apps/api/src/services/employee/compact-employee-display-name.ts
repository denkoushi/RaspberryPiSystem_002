/**
 * 従業員 displayName の照合用キー。
 * CSV 由来（スペースなし）とマスタ（スペースあり）を同一視するため、全空白を除去する。
 */
export function compactEmployeeDisplayName(input: string | null | undefined): string {
  if (!input) {
    return '';
  }
  return input.replace(/[\s\u3000]/g, '').trim().toLowerCase();
}
