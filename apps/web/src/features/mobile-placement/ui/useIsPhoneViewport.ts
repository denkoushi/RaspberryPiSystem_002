import { useMediaQuery } from '../../../hooks/useMediaQuery';

export function useIsPhoneViewport() {
  return useMediaQuery('(max-width: 767px)');
}
