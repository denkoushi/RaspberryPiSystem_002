import { DgxResourceProfilePanel } from './DgxResourceProfilePanel';

import type { DgxResourceActionBody, DgxResourceOverview } from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
  onControlUiError: (message: string | null) => void;
  postDgxAction?: (body: DgxResourceActionBody) => Promise<unknown>;
  actionBusy?: boolean;
};

/** 運用プロファイル（SET_POLICY）のみ */
export function DgxResourcePolicyPanel(props: Props) {
  return (
    <DgxResourceProfilePanel
      overview={props.overview}
      onControlUiError={props.onControlUiError}
      postDgxAction={props.postDgxAction}
      actionBusy={props.actionBusy}
    />
  );
}
