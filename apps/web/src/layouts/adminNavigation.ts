export type AdminNavItem = {
  label: string;
  to: string;
  /** 子ページもこの項目の現在地として扱うパス接頭辞（省略時は `to`） */
  matchPrefix?: string;
};

export type AdminNavGroup = {
  id: string;
  label: string;
  items: AdminNavItem[];
};

export const ADMIN_HOME: AdminNavItem = { label: 'ダッシュボード', to: '/admin' };

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: 'loan-tools',
    label: '貸出・工具',
    items: [
      { label: 'トルクレンチ', to: '/admin/tools/torque-wrenches' },
      { label: '計測機器ジャンル', to: '/admin/tools/measuring-instrument-genres' },
      { label: 'Raspberry Pi在庫', to: '/admin/tools/raspi-inventory' },
      { label: '履歴', to: '/admin/tools/history' },
      { label: '貸出レポート', to: '/admin/reports/loan-report', matchPrefix: '/admin/reports' }
    ]
  },
  {
    id: 'inspection',
    label: '点検',
    items: [
      { label: '点検項目', to: '/admin/tools/inspection-items' },
      { label: '点検記録', to: '/admin/tools/inspection-records' },
      { label: '加工機', to: '/admin/tools/machines' },
      { label: '未点検（加工機）', to: '/admin/tools/machines-uninspected' }
    ]
  },
  {
    id: 'assembly-measurement',
    label: '組立・測定',
    items: [
      { label: '組立例外入力', to: '/admin/tools/assembly-torque-override' },
      { label: '部品測定テンプレ', to: '/admin/tools/part-measurement-templates' },
      { label: '自主検査レビュー', to: '/admin/part-measurement/self-inspection-reviews' }
    ]
  },
  {
    id: 'kiosk-display',
    label: 'キオスク・表示',
    items: [
      { label: 'クライアント端末', to: '/admin/clients' },
      { label: 'キオスク表示設定', to: '/admin/kiosk-settings' },
      { label: '要領書（キオスク）', to: '/admin/kiosk-documents' },
      { label: 'サイネージ', to: '/admin/signage' },
      { label: 'データボード', to: '/admin/data-boards' },
      { label: 'パレット加工機イラスト', to: '/admin/pallet-machine-illustrations' }
    ]
  },
  {
    id: 'ai',
    label: 'AI',
    items: [
      { label: 'DGXリソース', to: '/admin/tools/dgx-resource' },
      { label: 'LocalLLM', to: '/admin/local-llm' },
      { label: '写真持出VLM', to: '/admin/photo-loan-label-reviews' },
      { label: 'ギャラリー教師登録', to: '/admin/photo-gallery-seed' }
    ]
  },
  {
    id: 'system',
    label: 'システム',
    items: [
      { label: 'CSV取り込み', to: '/admin/import' },
      { label: '生産スケジュール設定', to: '/admin/production-schedule-settings' },
      { label: 'Gmail設定', to: '/admin/gmail/config', matchPrefix: '/admin/gmail' },
      { label: 'バックアップ', to: '/admin/backup/targets', matchPrefix: '/admin/backup' },
      { label: 'セキュリティ', to: '/admin/security' }
    ]
  }
];

export type ActiveAdminNav = { group: AdminNavGroup; item: AdminNavItem };

/** 現在のパスに対応するグループと項目。最も長く一致した接頭辞を採用する。 */
export function findActiveAdminNav(pathname: string, groups: AdminNavGroup[] = ADMIN_NAV_GROUPS): ActiveAdminNav | null {
  let best: (ActiveAdminNav & { length: number }) | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      const prefix = item.matchPrefix ?? item.to;
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
      if (!best || prefix.length > best.length) best = { group, item, length: prefix.length };
    }
  }
  return best ? { group: best.group, item: best.item } : null;
}

/** 画面名またはグループ名に `query` を含む項目だけを残す。空のグループは除く。 */
export function filterAdminNavGroups(query: string, groups: AdminNavGroup[] = ADMIN_NAV_GROUPS): AdminNavGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((group) =>
      group.label.toLowerCase().includes(q)
        ? group
        : { ...group, items: group.items.filter((item) => item.label.toLowerCase().includes(q)) }
    )
    .filter((group) => group.items.length > 0);
}
