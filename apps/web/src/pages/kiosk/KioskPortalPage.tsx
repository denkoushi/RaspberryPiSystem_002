import { normalizeKioskHeaderTabOrder } from '@raspi-system/shared-types';
import { Link, useOutletContext } from 'react-router-dom';

import { useKioskConfig } from '../../api/hooks';
import { KIOSK_HEADER_TAB_LABELS } from '../../features/kiosk/kioskHeaderTabs/kioskHeaderTabLabels';
import { resolveKioskHeaderTabPath } from '../../features/kiosk/kioskHeaderTabs/kioskHeaderTabRoutes';
import { useKioskDueManagementNavigation } from '../../features/kiosk/kioskHeaderTabs/useKioskDueManagementNavigation';
import { groupKioskPortalTabs } from '../../features/kiosk/portal/kioskPortalGroups';
import { KioskPortalIcon } from '../../features/kiosk/portal/KioskPortalIcon';
import { useProcedureBoardAccess } from '../../features/procedure-board/procedureBoardApi';

import type { KioskPortalGroup } from '../../features/kiosk/portal/kioskPortalGroups';
import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

export function KioskPortalPage() {
  const { portalLargeScreen: largeScreen } = useOutletContext<{ portalLargeScreen: boolean }>();
  const { data: config, isError } = useKioskConfig();
  const { navigateToDueManagement, isPending } = useKioskDueManagementNavigation();
  const procedureBoardAccess = useProcedureBoardAccess();
  const visibleIds = normalizeKioskHeaderTabOrder(config?.navTabOrder ?? [])
    .filter((id) => !config?.portalHiddenTabIds?.includes(id));
  const groups = groupKioskPortalTabs(visibleIds);

  if (!config) return <p role="status" className="p-8 text-inv-muted">{isError ? 'ポータル設定を読み込めませんでした。接続を確認してください。' : '読み込み中…'}</p>;
  if (!visibleIds.length && procedureBoardAccess.data !== true) return <p className="p-8 text-xl text-inv-muted">出すカードがありません。上の歯車で選んでください</p>;

  const card = (id: KioskReorderableHeaderTabId, group: KioskPortalGroup) => {
    const className = `relative flex shrink-0 flex-col items-center justify-center gap-3 rounded-xl border border-inv-line2 bg-inv-s2 px-2 font-bold text-inv-text hover:bg-inv-s3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan ${group.hoverBorder} ${largeScreen ? 'h-[184px] w-[262px] text-[26px]' : 'h-[126px] w-[178px] text-[18px]'}`;
    const content = <>
      {largeScreen && <span className={`absolute left-4 top-3 text-sm font-semibold ${group.tint}`}>{group.label}</span>}
      <KioskPortalIcon tabId={id} className={`${largeScreen ? 'mt-4 h-[60px] w-[60px]' : 'h-10 w-10'} ${group.tint}`} />
      <span className="whitespace-nowrap leading-tight">{KIOSK_HEADER_TAB_LABELS[id]}</span>
    </>;
    return id === 'due_management'
      ? <button key={id} type="button" className={className} onClick={() => void navigateToDueManagement()} disabled={isPending}>{content}</button>
      : <Link key={id} to={resolveKioskHeaderTabPath(id, config.defaultMode)} className={className}>{content}</Link>;
  };
  const procedureBoardCard = procedureBoardAccess.data === true ? <Link to="/kiosk/procedure-board"
    className={`relative flex shrink-0 flex-col items-center justify-center gap-3 rounded-xl border border-inv-line2 bg-inv-s2 px-2 font-bold text-inv-text hover:bg-inv-s3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan ${largeScreen ? 'h-[184px] w-[262px] text-[26px]' : 'h-[126px] w-[178px] text-[18px]'}`}>
    <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" className={largeScreen ? 'h-[60px] w-[60px]' : 'h-10 w-10'}><rect x="5" y="7" width="38" height="34" rx="2"/><path d="M18 7v34M30 7v34M8 16h7M21 16h6M33 16h7M8 24h7M21 24h6"/></svg>
    <span className="whitespace-nowrap leading-tight">手順づくり</span>
  </Link> : null;
  return <div className="flex min-h-0 flex-1 items-center justify-center bg-inv-bg px-6 py-6">
    {largeScreen ? <div className="grid grid-cols-[repeat(6,262px)] gap-4" aria-label="ポータルのカード">
      {groups.flatMap((group) => group.tabIds.map((id) => card(id, group)))}{procedureBoardCard}
    </div> : <div className="flex flex-col gap-4" aria-label="ポータルのカード">
      {groups.map((group) => <section key={group.label} aria-label={group.label} className="flex items-center gap-5">
        <h2 className={`w-28 shrink-0 text-sm font-semibold ${group.tint}`}>{group.label}</h2>
        <div className="flex gap-3">{group.tabIds.map((id) => card(id, group))}</div>
      </section>)}
      {procedureBoardCard && <section className="flex items-center gap-5"><div className="w-28 shrink-0" />{procedureBoardCard}</section>}
    </div>}
  </div>;
}
