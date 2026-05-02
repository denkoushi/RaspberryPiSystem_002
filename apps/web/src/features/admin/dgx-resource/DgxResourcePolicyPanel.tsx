import { DgxResourceProfilePanel } from './DgxResourceProfilePanel';
import { DgxResourceRuntimeControlPanel } from './DgxResourceRuntimeControlPanel';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

type ConfirmStopOpts = {
  title: string;
  description?: string;
  tone?: 'danger' | 'primary';
};

type Props = {
  overview: DgxResourceOverview;
  onPolicyError: (message: string | null) => void;
  confirmStop: (opts: ConfirmStopOpts) => Promise<boolean>;
};

/** 運用プロファイル + ランタイム起停の合成（責務分離済みコンポジット） */
export function DgxResourcePolicyPanel(props: Props) {
  return (
    <div className="flex flex-col gap-2">
      <DgxResourceProfilePanel overview={props.overview} onPolicyError={props.onPolicyError} />
      <DgxResourceRuntimeControlPanel
        overview={props.overview}
        onPolicyError={props.onPolicyError}
        confirmStop={props.confirmStop}
      />
    </div>
  );
}
