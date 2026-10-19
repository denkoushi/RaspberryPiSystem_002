import type { SignageWebCapturePreview } from '../../../api/client';

/** 中央の 16:9 表示。配信中の画像、またはページ撮影のプレビュー（隠せる領域の枠つき）。 */
export function HubStage({
  imageUrl,
  alt,
  emptyText,
  note,
  capture,
  onToggleRegion,
}: {
  imageUrl: string | null;
  alt: string;
  emptyText: string;
  note?: string | null;
  capture?: { preview: SignageWebCapturePreview; viewportWidth: number; viewportHeight: number } | null;
  onToggleRegion?: (selector: string) => void;
}) {
  const src = capture ? capture.preview.imageDataUrl : imageUrl;
  return (
    <div className="sh-stage">
      {src ? <img src={src} alt={alt} /> : <div className="sh-stage-empty">{emptyText}</div>}
      {capture &&
        onToggleRegion &&
        capture.preview.regions.map((region) => (
          <button
            key={region.selector}
            type="button"
            className="sh-region"
            style={{
              left: `${(region.x / capture.viewportWidth) * 100}%`,
              top: `${(region.y / capture.viewportHeight) * 100}%`,
              width: `${(region.width / capture.viewportWidth) * 100}%`,
              height: `${(region.height / capture.viewportHeight) * 100}%`,
            }}
            onClick={() => onToggleRegion(region.selector)}
            aria-label={`${region.label} を隠す`}
          >
            <span>{region.label}を隠す</span>
          </button>
        ))}
      {note && <div className="sh-stage-note sh-mono">{note}</div>}
    </div>
  );
}
