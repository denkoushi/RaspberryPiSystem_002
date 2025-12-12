import { useState } from 'react';

import { useUnifiedItems } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { UnifiedItem } from '../../api/types';

type CategoryFilter = 'ALL' | 'TOOLS' | 'MEASURING_INSTRUMENTS' | 'RIGGING_GEARS';

export function UnifiedItemsPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const { data, isLoading } = useUnifiedItems({
    search: search || undefined,
    category
  });

  const getTypeLabel = (type: UnifiedItem['type']) => {
    if (type === 'TOOL') return '工具';
    if (type === 'MEASURING_INSTRUMENT') return '計測機器';
    return '吊具';
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      AVAILABLE: '利用可能',
      IN_USE: '使用中',
      MAINTENANCE: 'メンテナンス中',
      RETIRED: '廃棄済み'
    };
    return statusMap[status] || status;
  };

  return (
    <div className="space-y-6">
      <Card title="工具・計測機器・吊具 統合一覧">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="名称または管理番号で検索"
              className="md:max-w-xs"
            />
            <select
              className="rounded border border-white/10 bg-slate-800 px-3 py-2 text-white md:max-w-xs"
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            >
              <option value="ALL">すべて</option>
              <option value="TOOLS">工具のみ</option>
              <option value="MEASURING_INSTRUMENTS">計測機器のみ</option>
              <option value="RIGGING_GEARS">吊具のみ</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <p className="text-white/70">読み込み中...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-white/60">
                <tr>
                  <th className="px-2 py-1">種類</th>
                  <th className="px-2 py-1">名称</th>
                  <th className="px-2 py-1">管理番号</th>
                  <th className="px-2 py-1">カテゴリ</th>
                  <th className="px-2 py-1">保管場所</th>
                  <th className="px-2 py-1">ステータス</th>
                  <th className="px-2 py-1">NFC UID</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="border-t border-white/5">
                    <td className="px-2 py-1">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs ${
                          item.type === 'TOOL'
                            ? 'bg-blue-500/20 text-blue-300'
                            : item.type === 'MEASURING_INSTRUMENT'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-amber-400/20 text-amber-200'
                        }`}
                      >
                        {getTypeLabel(item.type)}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-medium text-white">{item.name}</td>
                    <td className="px-2 py-1 font-mono text-xs">{item.code}</td>
                    <td className="px-2 py-1 text-white/70">{item.category ?? '-'}</td>
                    <td className="px-2 py-1 text-white/70">{item.storageLocation ?? '-'}</td>
                    <td className="px-2 py-1">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs ${
                          item.status === 'AVAILABLE'
                            ? 'bg-green-500/20 text-green-300'
                            : item.status === 'IN_USE'
                              ? 'bg-yellow-500/20 text-yellow-300'
                              : item.status === 'RETIRED'
                                ? 'bg-red-500/20 text-red-300'
                                : 'bg-gray-500/20 text-gray-300'
                        }`}
                      >
                        {getStatusLabel(item.status)}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-mono text-xs text-white/70">
                      {item.nfcTagUid ?? '-'}
                    </td>
                  </tr>
                ))}
                {data?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-4 text-center text-white/70">
                      該当するアイテムがありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
