import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { deleteMobilePlacementShelfLandmark, postMobilePlacementShelfLandmark } from '../../../../api/client';
import { getApiErrorMessage } from '../../../../api/errors';
import { mobilePlacementQueryKeys } from '../../mobilePlacementQueryKeys';

export function useShelfLandmarkEditor({ onSelect, onDelete }: { onSelect: (name: string) => void; onDelete: (name: string) => void }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = async (deleting?: string) => {
    if (busy || (!deleting && !name.trim())) return;
    setBusy(true); setError(null);
    try {
      if (deleting) {
        await deleteMobilePlacementShelfLandmark(deleting);
        onDelete(deleting);
        setConfirmDelete(null);
      } else {
        const added = await postMobilePlacementShelfLandmark(name.trim());
        await client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.shelfMachines });
        onSelect(added.name);
      }
      if (deleting) void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.shelfMachines });
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
    } catch (e) {
      setError(getApiErrorMessage(e, '目安を更新できませんでした'));
      setConfirmDelete(null);
    } finally { setBusy(false); }
  };
  return { name, setName, confirmDelete, setConfirmDelete, busy, error, change };
}
