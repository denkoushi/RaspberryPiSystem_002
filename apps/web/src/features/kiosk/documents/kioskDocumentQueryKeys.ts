/**
 * React Query キー（要領書キオスク）。invalidate のプレフィックスと整合させる。
 */
export function kioskDocumentDetailQueryKey(id: string | null) {
  return ['kiosk-document', id] as const;
}
