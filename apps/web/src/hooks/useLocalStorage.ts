import { useEffect, useState } from 'react';

import { validateAndSanitizeApiKey, validateAndSanitizeUuid } from '../utils/validation';

export function useLocalStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        return JSON.parse(stored) as T;
      } catch {
        return defaultValue;
      }
    }
    return defaultValue;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

/**
 * APIキー用のuseLocalStorage（バリデーション付き）
 */
export function useLocalStorageApiKey(key: string, defaultValue: string) {
  const [value, setValue] = useState<string>(() => {
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as string;
        // 初期読み込み時にバリデーションを適用
        return validateAndSanitizeApiKey(parsed, defaultValue);
      } catch {
        return defaultValue;
      }
    }
    return defaultValue;
  });

  useEffect(() => {
    // バリデーションを適用してから保存
    const sanitized = validateAndSanitizeApiKey(value, defaultValue);
    if (sanitized !== value) {
      // 不正な値が検出された場合は自動修復
      setValue(sanitized);
    }
    localStorage.setItem(key, JSON.stringify(sanitized));
  }, [key, value, defaultValue]);

  const setValueWithValidation = (newValue: string) => {
    const sanitized = validateAndSanitizeApiKey(newValue, defaultValue);
    setValue(sanitized);
  };

  return [value, setValueWithValidation] as const;
}

/**
 * UUID用のuseLocalStorage（バリデーション付き）
 */
export function useLocalStorageUuid(key: string, defaultValue: string = '') {
  const [value, setValue] = useState<string>(() => {
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as string;
        // 初期読み込み時にバリデーションを適用
        return validateAndSanitizeUuid(parsed);
      } catch {
        return defaultValue;
      }
    }
    return defaultValue;
  });

  useEffect(() => {
    // バリデーションを適用してから保存
    const sanitized = validateAndSanitizeUuid(value);
    if (sanitized !== value) {
      // 不正な値が検出された場合は自動修復
      setValue(sanitized);
    }
    localStorage.setItem(key, JSON.stringify(sanitized));
  }, [key, value]);

  const setValueWithValidation = (newValue: string) => {
    const sanitized = validateAndSanitizeUuid(newValue);
    setValue(sanitized);
  };

  return [value, setValueWithValidation] as const;
}
