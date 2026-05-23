import { shelfMasterTheme } from '../theme/shelfMasterTheme';

type Props = {
  statusText: string;
};

export function ShelfRelocateDock({ statusText }: Props) {
  return <p className={shelfMasterTheme.relocateStatus}>{statusText}</p>;
}
