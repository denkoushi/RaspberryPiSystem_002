import { useProtectedImageBlobUrl } from '../hooks/useProtectedImageBlobUrl';

type ProtectedImageProps = {
  imagePath: string | null | undefined;
  alt: string;
  className?: string;
  emptyFallback?: string | null;
  errorFallback?: string | null;
};

export function ProtectedImage(props: ProtectedImageProps) {
  const { imagePath, alt, className, emptyFallback = null, errorFallback = '画像の読み込みに失敗しました' } = props;
  const { blobUrl, error } = useProtectedImageBlobUrl(imagePath);

  if (!imagePath?.trim()) {
    return emptyFallback ? <p className="mt-2 text-sm text-slate-600">{emptyFallback}</p> : null;
  }

  if (error || !blobUrl) {
    return errorFallback ? <p className="mt-2 text-sm text-red-600">{errorFallback}</p> : null;
  }

  return <img src={blobUrl} alt={alt} className={className} />;
}
