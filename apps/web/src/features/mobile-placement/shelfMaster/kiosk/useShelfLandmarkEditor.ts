import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';

import { deleteMobilePlacementShelfLandmark, postMobilePlacementShelfLandmark } from '../../../../api/client';
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
        onSelect(added.name);
      }
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.shelfMachines });
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
    } catch (e) {
      setError(isAxiosError(e) && typeof e.response?.data?.message === 'string' ? e.response.data.message : e instanceof Error ? e.message : '目安を更新できませんでした');
      setConfirmDelete(null);
    } finally { setBusy(false); }
  };
  return { name, setName, confirmDelete, setConfirmDelete, busy, error, change };
}
