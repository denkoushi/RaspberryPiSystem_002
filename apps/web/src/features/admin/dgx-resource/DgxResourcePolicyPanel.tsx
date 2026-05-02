import { DgxResourceProfilePanel } from './DgxResourceProfilePanel';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
  onControlUiError: (message: string | null) => void;
};

/** 運用プロファイル（SET_POLICY）のみ */
export function DgxResourcePolicyPanel(props: Props) {
  return (
    <DgxResourceProfilePanel overview={props.overview} onControlUiError={props.onControlUiError} />
  );
}
