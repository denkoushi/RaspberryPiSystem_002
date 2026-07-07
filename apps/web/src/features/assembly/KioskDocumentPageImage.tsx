import { resolveKioskDocumentPageImageUrl } from '../../api/domains/signage';
import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import type { ReactNode } from 'react';

export function isAssemblyProcedureImagePath(imagePath: string): boolean {
  return imagePath.includes('/storage/assembly-procedure-images/');
}

type KioskDocumentPageImageProps = {
  pageUrl: string;
  alt?: string;
  className?: string;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
};

export function KioskDocumentPageImage({
  pageUrl,
  alt = '',
  className,
  loadingFallback = null,
  errorFallback = null
}: KioskDocumentPageImageProps) {
  const protectedPath = isAssemblyProcedureImagePath(pageUrl);
  const { blobUrl, error } = useProtectedImageBlobUrl(protectedPath ? pageUrl : null);

  if (protectedPath) {
    if (error) {
      return <>{errorFallback ?? <p className="text-sm text-red-600">{error}</p>}</>;
    }
    if (!blobUrl) {
      return <>{loadingFallback}</>;
    }
    return <img src={blobUrl} alt={alt} className={className} draggable={false} />;
  }

  return (
    <img
      src={resolveKioskDocumentPageImageUrl(pageUrl)}
      alt={alt}
      className={className}
      draggable={false}
    />
  );
}
