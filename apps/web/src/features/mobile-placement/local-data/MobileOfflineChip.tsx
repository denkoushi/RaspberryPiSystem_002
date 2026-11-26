import { useServerUnreachableOnWifi } from '../sync/networkGate';
import { hp } from '../ui/haizenPhoneTokens';

export function MobileOfflineChip({ offline, updatedAt }: { offline: boolean; updatedAt?: string }) {
  const serverUnreachableOnWifi = useServerUnreachableOnWifi();
  if (!offline || serverUnreachableOnWifi) return null;
  const date = updatedAt ? new Date(updatedAt) : null;
  const suffix = date && !Number.isNaN(date.getTime()) ? ` ${date.getMonth() + 1}/${date.getDate()}` : '';
  return <span className={`${hp.chip} inline-flex items-center !text-[var(--hp-ng)]`}>圏外{suffix}</span>;
}
