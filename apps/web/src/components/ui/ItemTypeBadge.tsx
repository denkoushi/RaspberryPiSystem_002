import clsx from 'clsx';

import type { UnifiedItem } from '../../api/types';

interface ItemTypeBadgeProps {
  type: UnifiedItem['type'];
  label?: string;
  className?: string;
}

export function ItemTypeBadge({ type, label, className }: ItemTypeBadgeProps) {
  const getTypeConfig = () => {
    switch (type) {
      case 'TOOL':
        return {
          bg: 'bg-blue-500',
          text: 'text-white',
          border: 'border-blue-700',
          icon: '🔧',
          defaultLabel: '工具'
        };
      case 'MEASURING_INSTRUMENT':
        return {
          bg: 'bg-purple-600',
          text: 'text-white',
          border: 'border-purple-800',
          icon: '📏',
          defaultLabel: '計測機器'
        };
      case 'RIGGING_GEAR':
        return {
          bg: 'bg-orange-500',
          text: 'text-white',
          border: 'border-orange-700',
          icon: '⚙️',
          defaultLabel: '吊具'
        };
    }
  };

  const config = getTypeConfig();
  const displayLabel = label || config.defaultLabel;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border-2 px-2 py-0.5 text-sm font-bold shadow-lg',
        config.bg,
        config.text,
        config.border,
        className
      )}
    >
      <span>{config.icon}</span>
      <span>{displayLabel}</span>
    </span>
  );
}
