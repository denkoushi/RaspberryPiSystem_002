import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';

import { ProcedureVideoPlayer } from './ProcedureVideoPlayer';

import type { ProcedureVideoSummaryDto } from './procedure-video-types';

export function ProcedureVideoPlaybackDialog({ video, onClose }: { video: ProcedureVideoSummaryDto; onClose: () => void }) {
  return <Dialog isOpen onClose={onClose} title={video.title} size="lg" className="overflow-y-auto">
    <ProcedureVideoPlayer video={video} />
    <Button className="mt-3 min-h-11" onClick={onClose}>閉じる</Button>
  </Dialog>;
}
