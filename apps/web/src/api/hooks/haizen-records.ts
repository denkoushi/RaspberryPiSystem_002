import { useQuery } from '@tanstack/react-query';

import { api } from '../http';

import type { HaizenOrderTrail, HaizenVerifyRecord } from '../../features/kiosk/haizen/haizenRecordTypes';

export function useHaizenVerifyRecords(days: 1 | 7 | 30) {
  return useQuery({
    queryKey: ['mobile-placement', 'verify-records', days],
    queryFn: async () => (await api.get<{ records: HaizenVerifyRecord[] }>('/mobile-placement/verify-records', { params: { days } })).data,
    refetchInterval: 60_000
  });
}

export function useHaizenOrderTrail(orderNo: string | null) {
  return useQuery({
    queryKey: ['mobile-placement', 'order-trail', orderNo],
    queryFn: async () => (await api.get<{ trail: HaizenOrderTrail | null }>('/mobile-placement/order-trail', { params: { order: orderNo } })).data,
    enabled: /^\d{10}$/.test(orderNo ?? ''),
    refetchInterval: 60_000
  });
}
