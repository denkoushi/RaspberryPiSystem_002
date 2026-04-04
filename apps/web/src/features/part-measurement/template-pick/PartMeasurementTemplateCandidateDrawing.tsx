import { usePartMeasurementDrawingBlobUrl } from '../usePartMeasurementDrawingBlobUrl';

type Props = {
  drawingImageRelativePath: string | null | undefined;
  alt: string;
  /** カード内サムネ用 */
  className?: string;
};

/** 図面 Blob URL（キオスク x-client-key 経由） */
export function PartMeasurementTemplateCandidateDrawing({ drawingImageRelativePath, alt, className }: Props) {
  const { blobUrl, error } = usePartMeasurementDrawingBlobUrl(drawingImageRelativePath ?? null);
  if (error) {
    return <div className={className}>{error}</div>;
  }
  if (!blobUrl) {
    return <div className={className}>読込中…</div>;
  }
  return <img src={blobUrl} alt={alt} className={className} draggable={false} />;
}
