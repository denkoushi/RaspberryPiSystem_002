import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { POLL_MS } from '../../lib/admin-polling-intervals';
import {
  getSystemInfo,
  importMaster,
  importMasterSingle,
  getDeployStatus,
  getNetworkModeStatus
} from '../client';

export function useImportMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importMaster,
    onSuccess: () => {
      // インポート成功後、employeesとitemsのクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    }
  });
}

export function useImportMasterSingle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importMasterSingle,
    onSuccess: (_, variables) => {
      // インポート成功後、該当するデータタイプのクエリを無効化して最新データを取得
      if (variables.type === 'employees') {
        queryClient.invalidateQueries({ queryKey: ['employees'] });
      } else if (variables.type === 'items') {
        queryClient.invalidateQueries({ queryKey: ['items'] });
      } else if (variables.type === 'measuringInstruments') {
        queryClient.invalidateQueries({ queryKey: ['measuringInstruments'] });
      } else if (variables.type === 'riggingGears') {
        queryClient.invalidateQueries({ queryKey: ['riggingGears'] });
      } else if (variables.type === 'machines') {
        queryClient.invalidateQueries({ queryKey: ['machines'] });
        queryClient.invalidateQueries({ queryKey: ['machines-uninspected'] });
      }
    }
  });
}

/**
 * システム情報（CPU温度・負荷）を取得するフック
 * 10秒間隔で自動更新
 */

export function useSystemInfo() {
  return useQuery({
    queryKey: ['system-info'],
    queryFn: getSystemInfo,
    refetchInterval: POLL_MS.systemInfo, // 負荷軽減のため既定を緩和（管理画面中心）
    staleTime: 3000, // 3秒間はキャッシュを使用
    refetchOnWindowFocus: true, // ウィンドウフォーカス時に更新
  });
}

export function useNetworkModeStatus() {
  return useQuery({
    queryKey: ['network-mode-status'],
    queryFn: getNetworkModeStatus,
    refetchInterval: 30_000,
    staleTime: 10_000,
    refetchOnWindowFocus: true
  });
}

export function useDeployStatus() {
  return useQuery({
    queryKey: ['deploy-status'],
    queryFn: getDeployStatus,
    refetchInterval: POLL_MS.deployStatus, // メンテ状態を比較的早く反映しつつポーリング頻度は緩和
    staleTime: 0, // キャッシュを無効化して常に最新データを取得
    refetchOnWindowFocus: true
  });
}

// デジタルサイネージ関連のフック
