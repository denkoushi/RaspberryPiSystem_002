import { useEffect, useMemo, useState } from 'react';

import { useKioskProductionScheduleOrderSearchCandidates } from '../../../api/hooks';

import {
  appendProductNoDigit,
  backspaceProductNoInput,
  hasValidProductNoPrefix,
  sanitizeProductNoInput
} from './productionOrderSearch';

type UseProductionOrderSearchParams = {
  enabled: boolean;
  resourceCds: string[];
  resourceCategory?: 'grinding' | 'cutting';
  machineName?: string;
  onConfirmSelection: (selectedOrderNumbers: string[]) => void;
};

export const useProductionOrderSearch = ({
  enabled,
  resourceCds,
  resourceCategory,
  machineName,
  onConfirmSelection
}: UseProductionOrderSearchParams) => {
  const [isOpen, setIsOpen] = useState(false);
  const [productNoInput, setProductNoInput] = useState('');
  const [selectedPartName, setSelectedPartName] = useState('');
  const [selectedOrderNumbers, setSelectedOrderNumbers] = useState<string[]>([]);

  const sanitizedInput = useMemo(() => sanitizeProductNoInput(productNoInput), [productNoInput]);
  const canFetchCandidates = enabled && isOpen && hasValidProductNoPrefix(sanitizedInput) && resourceCds.length > 0;

  const orderSearchParams = useMemo(
    () =>
      canFetchCandidates
        ? {
            resourceCds: resourceCds.join(','),
            resourceCategory,
            machineName: machineName?.trim() || undefined,
            productNoPrefix: sanitizedInput,
            partName: selectedPartName.trim() || undefined
          }
        : undefined,
    [canFetchCandidates, machineName, resourceCategory, resourceCds, sanitizedInput, selectedPartName]
  );

  const candidatesQuery = useKioskProductionScheduleOrderSearchCandidates(orderSearchParams, {
    enabled: canFetchCandidates
  });

  useEffect(() => {
    if (!hasValidProductNoPrefix(sanitizedInput)) {
      setSelectedPartName('');
      setSelectedOrderNumbers([]);
    }
  }, [sanitizedInput]);

  useEffect(() => {
    setSelectedOrderNumbers([]);
  }, [selectedPartName]);

  const open = () => {
    if (!enabled) return;
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
  };

  const handleInputChange = (next: string) => {
    setProductNoInput(sanitizeProductNoInput(next));
  };

  const appendDigit = (digit: string) => {
    setProductNoInput((current) => appendProductNoDigit(current, digit));
  };

  const backspace = () => {
    setProductNoInput((current) => backspaceProductNoInput(current));
  };

  const clear = () => {
    setProductNoInput('');
    setSelectedPartName('');
    setSelectedOrderNumbers([]);
  };

  const toggleOrderNumber = (productNo: string) => {
    setSelectedOrderNumbers((current) =>
      current.includes(productNo) ? current.filter((value) => value !== productNo) : [...current, productNo]
    );
  };

  const confirm = () => {
    onConfirmSelection(selectedOrderNumbers);
    setIsOpen(false);
  };

  return {
    isOpen,
    open,
    close,
    productNoInput: sanitizedInput,
    setProductNoInput: handleInputChange,
    appendDigit,
    backspace,
    clear,
    selectedPartName,
    setSelectedPartName,
    selectedOrderNumbers,
    toggleOrderNumber,
    confirm,
    canConfirm: selectedOrderNumbers.length > 0,
    canFetchCandidates,
    isLoading: candidatesQuery.isFetching,
    partNameOptions: candidatesQuery.data?.partNameOptions ?? [],
    orders: candidatesQuery.data?.orders ?? []
  };
};
