import { useUnsavedChangesGuard } from '../../navigation/useUnsavedChangesGuard';

export function useInspectionDrawingUnsavedChangesGuard(shouldBlock: boolean): void {
  useUnsavedChangesGuard(shouldBlock);
}
