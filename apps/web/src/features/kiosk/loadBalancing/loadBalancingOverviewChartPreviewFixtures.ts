import { mapOverviewResourceChartRows } from './mapOverviewResourceChartRows';

import type { OverviewChartRow } from './mapOverviewResourceChartRows';

/** 開発プレビュー用 — overview API 相当の resourceNameMap（実装パイプライン検証用） */
const previewResourceNameMapSeed: Record<string, string[]> = {
  '589': ['PSG206'],
  '021': ['HCN4000NEO 1号機'],
  '581': ['PSG-2015'],
  '502': ['大隈MCR-A5C'],
  '060': ['立型(MV50/80)'],
  '503': ['5軸加工機 (MU-4000V)'],
  '080': ['立型(FJV60/80)'],
  '501': ['東芝MPE-2130'],
  '033': ['横型(ニイガタN7)'],
  '035': ['横型(新潟HN80C)'],
  '051': ['立型(FANUCロボドリル1号機)'],
  '052': ['立型(FANUCロボドリル2号機)'],
  '070': ['立型(大隈MB46VA)'],
  '071': ['立型(大隈MB46VAE)'],
  '120': ['旋盤'],
  '130': ['NC旋盤(クイックターン)'],
  '587': ['FJV50/80'],
  '586': ['FJV60'],
  '504': ['平面研削盤'],
  '500': ['5軸加工機'],
  '021B': ['ROBODRILL']
};

const previewResourceSeeds: Array<{
  resourceCd: string;
  requiredMinutes: number;
  availableMinutes: number;
  overMinutes: number;
}> = [
  { resourceCd: '589', requiredMinutes: 72000, availableMinutes: 12000, overMinutes: 60000 },
  { resourceCd: '021', requiredMinutes: 68000, availableMinutes: 18000, overMinutes: 50000 },
  { resourceCd: '581', requiredMinutes: 64000, availableMinutes: 22000, overMinutes: 42000 },
  { resourceCd: '502', requiredMinutes: 60000, availableMinutes: 24000, overMinutes: 36000 },
  { resourceCd: '060', requiredMinutes: 56000, availableMinutes: 26000, overMinutes: 30000 },
  { resourceCd: '503', requiredMinutes: 52000, availableMinutes: 28000, overMinutes: 24000 },
  { resourceCd: '080', requiredMinutes: 48000, availableMinutes: 30000, overMinutes: 18000 },
  { resourceCd: '501', requiredMinutes: 44000, availableMinutes: 32000, overMinutes: 12000 },
  { resourceCd: '033', requiredMinutes: 40000, availableMinutes: 34000, overMinutes: 6000 },
  { resourceCd: '035', requiredMinutes: 38000, availableMinutes: 36000, overMinutes: 2000 },
  { resourceCd: '051', requiredMinutes: 36000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '052', requiredMinutes: 34000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '070', requiredMinutes: 32000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '071', requiredMinutes: 30000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '120', requiredMinutes: 28000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '130', requiredMinutes: 26000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '587', requiredMinutes: 24000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '586', requiredMinutes: 22000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '504', requiredMinutes: 20000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '500', requiredMinutes: 18000, availableMinutes: 36000, overMinutes: 0 },
  { resourceCd: '021B', requiredMinutes: 16000, availableMinutes: 36000, overMinutes: 0 }
];

/** 上位 48 件 — `mapOverviewResourceChartRows` 経由（本番と同じ変換） */
export function buildLoadBalancingOverviewChartPreviewRows(): OverviewChartRow[] {
  const resources = [...previewResourceSeeds];
  const resourceNameMap: Record<string, string[]> = { ...previewResourceNameMapSeed };
  while (resources.length < 48) {
    const index = resources.length + 1;
    const resourceCd = String(600 + index);
    resourceNameMap[resourceCd] = [`資源ラベル${index}`];
    resources.push({
      resourceCd,
      requiredMinutes: Math.max(8000, 15000 - index * 120),
      availableMinutes: 36000,
      overMinutes: 0
    });
  }

  return mapOverviewResourceChartRows(resources, resourceNameMap);
}
