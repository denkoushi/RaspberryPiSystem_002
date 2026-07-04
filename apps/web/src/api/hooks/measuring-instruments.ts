import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getMeasuringInstruments,
  getMeasuringInstrument,
  getMeasuringInstrumentGenres,
  createMeasuringInstrumentGenre,
  updateMeasuringInstrumentGenre,
  deleteMeasuringInstrumentGenre,
  uploadMeasuringInstrumentGenreImage,
  deleteMeasuringInstrumentGenreImage,
  createMeasuringInstrument,
  updateMeasuringInstrument,
  deleteMeasuringInstrument,
  getInspectionItems,
  getGenreInspectionItems,
  createGenreInspectionItem,
  getMeasuringInstrumentInspectionProfile,
  createInspectionItem,
  updateInspectionItem,
  deleteInspectionItem,
  getInstrumentTags,
  createInstrumentTag,
  deleteInstrumentTag,
  getInspectionRecords,
  createInspectionRecord,
  borrowMeasuringInstrument,
  returnMeasuringInstrument,
  type MeasuringInstrumentInput
} from '../client';

import type {
  MeasuringInstrumentStatus,
  InspectionItem,
  MeasuringInstrumentGenre,
  MeasuringInstrumentBorrowPayload,
  MeasuringInstrumentReturnPayload,
  InspectionRecordCreatePayload
} from '../types';

export function useMeasuringInstruments(filters?: { search?: string; status?: MeasuringInstrumentStatus }) {
  return useQuery({
    queryKey: ['measuring-instruments', filters],
    queryFn: () => getMeasuringInstruments(filters),
    placeholderData: (previous) => previous
  });
}

export function useMeasuringInstrument(id?: string) {
  return useQuery({
    queryKey: ['measuring-instrument', id],
    queryFn: () => getMeasuringInstrument(id!),
    enabled: !!id
  });
}

export function useMeasuringInstrumentGenres() {
  return useQuery({
    queryKey: ['measuring-instrument-genres'],
    queryFn: () => getMeasuringInstrumentGenres()
  });
}

export function useMeasuringInstrumentGenreMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['measuring-instrument-genres'] });
    queryClient.invalidateQueries({ queryKey: ['measuring-instruments'] });
  };
  const create = useMutation({
    mutationFn: (payload: { name: string }) => createMeasuringInstrumentGenre(payload),
    onSuccess: invalidate
  });
  const update = useMutation({
    mutationFn: ({
      genreId,
      payload
    }: {
      genreId: string;
      payload: Partial<Pick<MeasuringInstrumentGenre, 'name' | 'imageUrlPrimary' | 'imageUrlSecondary'>>;
    }) => updateMeasuringInstrumentGenre(genreId, payload),
    onSuccess: invalidate
  });
  const remove = useMutation({
    mutationFn: (genreId: string) => deleteMeasuringInstrumentGenre(genreId),
    onSuccess: invalidate
  });
  const uploadImage = useMutation({
    mutationFn: ({ genreId, slot, image }: { genreId: string; slot: 1 | 2; image: File }) =>
      uploadMeasuringInstrumentGenreImage(genreId, slot, image),
    onSuccess: invalidate
  });
  const deleteImage = useMutation({
    mutationFn: ({ genreId, slot }: { genreId: string; slot: 1 | 2 }) =>
      deleteMeasuringInstrumentGenreImage(genreId, slot),
    onSuccess: invalidate
  });
  return { create, update, remove, uploadImage, deleteImage };
}

export function useMeasuringInstrumentMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: MeasuringInstrumentInput) => createMeasuringInstrument(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['measuring-instruments'] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: MeasuringInstrumentInput }) =>
      updateMeasuringInstrument(id, payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['measuring-instruments'] });
      queryClient.invalidateQueries({ queryKey: ['measuring-instrument', vars.id] });
      // rfidTagUid はタグテーブル側で管理されるため、タグ一覧も更新する
      queryClient.invalidateQueries({ queryKey: ['instrument-tags', vars.id] });
    }
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteMeasuringInstrument(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['measuring-instruments'] })
  });
  return { create, update, remove };
}

// 点検項目

export function useInspectionItems(measuringInstrumentId?: string) {
  return useQuery({
    queryKey: ['inspection-items', measuringInstrumentId],
    queryFn: () => getInspectionItems(measuringInstrumentId!),
    enabled: !!measuringInstrumentId
  });
}

export function useInspectionItemMutations(measuringInstrumentId: string) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: Partial<InspectionItem>) => createInspectionItem(measuringInstrumentId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inspection-items', measuringInstrumentId] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<InspectionItem> }) =>
      updateInspectionItem(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inspection-items', measuringInstrumentId] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteInspectionItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inspection-items', measuringInstrumentId] })
  });
  return { create, update, remove };
}

export function useGenreInspectionItems(genreId?: string) {
  return useQuery({
    queryKey: ['genre-inspection-items', genreId],
    queryFn: () => getGenreInspectionItems(genreId!),
    enabled: !!genreId
  });
}

export function useGenreInspectionItemMutations(genreId: string) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: Partial<InspectionItem>) => createGenreInspectionItem(genreId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['genre-inspection-items', genreId] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<InspectionItem> }) =>
      updateInspectionItem(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['genre-inspection-items', genreId] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteInspectionItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['genre-inspection-items', genreId] })
  });
  return { create, update, remove };
}

export function useMeasuringInstrumentInspectionProfile(measuringInstrumentId?: string) {
  return useQuery({
    queryKey: ['measuring-instrument-inspection-profile', measuringInstrumentId],
    queryFn: () => getMeasuringInstrumentInspectionProfile(measuringInstrumentId!),
    enabled: !!measuringInstrumentId
  });
}

// RFIDタグ

export function useInstrumentTags(measuringInstrumentId?: string) {
  return useQuery({
    queryKey: ['instrument-tags', measuringInstrumentId],
    queryFn: () => getInstrumentTags(measuringInstrumentId!),
    enabled: !!measuringInstrumentId
  });
}

export function useInstrumentTagMutations(measuringInstrumentId: string) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (rfidTagUid: string) => createInstrumentTag(measuringInstrumentId, rfidTagUid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instrument-tags', measuringInstrumentId] })
  });
  const remove = useMutation({
    mutationFn: (tagId: string) => deleteInstrumentTag(tagId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instrument-tags', measuringInstrumentId] })
  });
  return { create, remove };
}

// 点検記録

export function useInspectionRecords(
  measuringInstrumentId?: string,
  filters?: { startDate?: string; endDate?: string; employeeId?: string; result?: string }
) {
  return useQuery({
    queryKey: ['inspection-records', measuringInstrumentId, filters],
    queryFn: () => getInspectionRecords(measuringInstrumentId!, filters),
    enabled: !!measuringInstrumentId
  });
}

export function useInspectionRecordCreate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: InspectionRecordCreatePayload) => createInspectionRecord(payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['inspection-records', vars.measuringInstrumentId] });
    }
  });
}

// 計測機器の持出/返却

export function useBorrowMeasuringInstrument(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MeasuringInstrumentBorrowPayload) => borrowMeasuringInstrument(payload, clientKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loans'] })
  });
}

export function useReturnMeasuringInstrument(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MeasuringInstrumentReturnPayload) => returnMeasuringInstrument(payload, clientKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loans'] })
  });
}
