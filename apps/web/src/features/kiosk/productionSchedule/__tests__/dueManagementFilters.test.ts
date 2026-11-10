import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DUE_MANAGEMENT_FILTERS_STATE,
  hasDueManagementResourceFilter,
  resolveDueManagementResourceCategory,
  sanitizeDueManagementFiltersState,
  toDueManagementFilterParams,
  toggleDueManagementCuttingFilter,
  toggleDueManagementGrindingFilter,
  type DueManagementFiltersState,
} from '../dueManagementFilters';

const state = (partial: Partial<DueManagementFiltersState>): DueManagementFiltersState => ({
  ...DEFAULT_DUE_MANAGEMENT_FILTERS_STATE,
  ...partial,
});

describe('dueManagementFilters', () => {
  describe('sanitizeDueManagementFiltersState', () => {
    it.each([null, undefined, 'string', 42, []])('不正な保存値 %p は既定値に戻す', (value) => {
      expect(sanitizeDueManagementFiltersState(value)).toEqual(DEFAULT_DUE_MANAGEMENT_FILTERS_STATE);
    });

    it('資源CDは trim し、真偽値は厳密に true のときだけ採用する', () => {
      expect(
        sanitizeDueManagementFiltersState({
          selectedResourceCd: '  305 ',
          showGrindingResources: 'true',
          showCuttingResources: 1,
        })
      ).toEqual({ selectedResourceCd: '305', showGrindingResources: false, showCuttingResources: false });
      expect(sanitizeDueManagementFiltersState({ selectedResourceCd: 305, showCuttingResources: true })).toEqual({
        selectedResourceCd: '',
        showGrindingResources: false,
        showCuttingResources: true,
      });
    });

    it('研削・切削が両方 true の矛盾状態は両方 false にし、資源CDは残す', () => {
      expect(
        sanitizeDueManagementFiltersState({
          selectedResourceCd: 'A1',
          showGrindingResources: true,
          showCuttingResources: true,
        })
      ).toEqual({ selectedResourceCd: 'A1', showGrindingResources: false, showCuttingResources: false });
    });
  });

  describe('resolveDueManagementResourceCategory / toDueManagementFilterParams', () => {
    it('片方だけ true のときだけカテゴリを返す', () => {
      expect(resolveDueManagementResourceCategory(state({ showGrindingResources: true }))).toBe('grinding');
      expect(resolveDueManagementResourceCategory(state({ showCuttingResources: true }))).toBe('cutting');
      expect(resolveDueManagementResourceCategory(state({}))).toBeUndefined();
      expect(
        resolveDueManagementResourceCategory(state({ showGrindingResources: true, showCuttingResources: true }))
      ).toBeUndefined();
    });

    it('空の資源CDは undefined として API パラメータに渡す', () => {
      expect(toDueManagementFilterParams(state({ showCuttingResources: true }))).toEqual({
        resourceCd: undefined,
        resourceCategory: 'cutting',
      });
      expect(toDueManagementFilterParams(state({ selectedResourceCd: '581' }))).toEqual({
        resourceCd: '581',
        resourceCategory: undefined,
      });
    });
  });

  describe('hasDueManagementResourceFilter', () => {
    it('空白のみの資源CDはフィルタ無し扱い', () => {
      expect(hasDueManagementResourceFilter(state({ selectedResourceCd: '   ' }))).toBe(false);
      expect(hasDueManagementResourceFilter(state({}))).toBe(false);
    });

    it('資源CDかカテゴリのどちらかがあればフィルタ有り', () => {
      expect(hasDueManagementResourceFilter(state({ selectedResourceCd: '305' }))).toBe(true);
      expect(hasDueManagementResourceFilter(state({ showGrindingResources: true }))).toBe(true);
    });
  });

  describe('toggle', () => {
    it('研削を ON にすると切削は OFF になり、資源CDは保持される', () => {
      expect(
        toggleDueManagementGrindingFilter(state({ selectedResourceCd: 'X', showCuttingResources: true }))
      ).toEqual({ selectedResourceCd: 'X', showGrindingResources: true, showCuttingResources: false });
    });

    it('切削を ON にすると研削は OFF になる', () => {
      expect(toggleDueManagementCuttingFilter(state({ showGrindingResources: true }))).toEqual(
        state({ showCuttingResources: true })
      );
    });

    it('ON のものを再度押すと OFF に戻り、他方は変更しない', () => {
      expect(toggleDueManagementGrindingFilter(state({ showGrindingResources: true }))).toEqual(state({}));
      expect(toggleDueManagementCuttingFilter(state({ showCuttingResources: true }))).toEqual(state({}));
    });

    it('入力 state を破壊しない', () => {
      const before = state({ showGrindingResources: true });
      toggleDueManagementCuttingFilter(before);
      expect(before).toEqual(state({ showGrindingResources: true }));
    });
  });
});
